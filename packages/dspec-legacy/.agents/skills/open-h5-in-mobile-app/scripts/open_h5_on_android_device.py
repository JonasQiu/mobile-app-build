#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Optional, Union
from urllib.parse import urlparse

from mobile_h5_common import (
    build_deeplink_from_table,
    build_deeplink_from_template,
    load_app_definition,
    validate_h5_url,
)


ANDROID_PLATFORM = "android-device"


@dataclass
class AdbSelection:
    path: str
    source: str
    sdk_root: str
    version: str


@dataclass
class DeviceInfo:
    serial: str
    state: str
    details: dict[str, str]
    is_emulator: Optional[bool] = None


@dataclass
class ApkInfo:
    apk_path: str
    package_name: str
    version_name: str
    version_code: str
    minimum_sdk: str
    target_sdk: str
    metadata_tool: str


class UserFacingError(Exception):
    def __init__(self, message: str, **details):
        super().__init__(message)
        self.details = details


def run_command(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=check, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def command_error(result: Union[subprocess.CompletedProcess, subprocess.CalledProcessError]) -> dict:
    return {
        "command": result.cmd if isinstance(result, subprocess.CalledProcessError) else result.args,
        "returncode": result.returncode,
        "stdout": result.stdout or "",
        "stderr": result.stderr or "",
    }


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value or ""))


def read_local_properties_sdk(start: Path) -> list[Path]:
    roots: list[Path] = []
    for directory in (start.resolve(), *start.resolve().parents):
        properties = directory / "local.properties"
        if not properties.is_file():
            continue
        for line in properties.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.startswith("sdk.dir="):
                continue
            value = line.split("=", 1)[1].replace("\\:", ":").replace("\\\\", "\\")
            roots.append(Path(value).expanduser())
    return roots


def read_android_studio_sdk_paths() -> list[Path]:
    config_root = Path.home() / "Library" / "Application Support" / "Google"
    if not config_root.is_dir():
        return []

    paths: list[Path] = []
    config_files = sorted(config_root.glob("AndroidStudio*/options/android.sdk.path.xml"), reverse=True)
    config_files += sorted(config_root.glob("AndroidStudio*/options/other.xml"), reverse=True)
    patterns = (
        re.compile(r'androidSdkAbsolutePath"\s+value="([^"]+)"'),
        re.compile(r'"android\.sdk\.path"\s*:\s*"([^"]+)"'),
    )
    for config_file in config_files:
        text = config_file.read_text(encoding="utf-8", errors="replace")
        for pattern in patterns:
            for value in pattern.findall(text):
                expanded = value.replace("$USER_HOME$", str(Path.home()))
                paths.append(Path(expanded).expanduser())
    return paths


def adb_candidates(explicit_adb: Optional[str], cwd: Path) -> list[tuple[Path, str]]:
    if explicit_adb:
        return [(Path(explicit_adb).expanduser(), "explicit")]

    candidates: list[tuple[Path, str]] = []
    for env_name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(env_name):
            candidates.append((Path(os.environ[env_name]).expanduser() / "platform-tools" / "adb", env_name))
    candidates.extend((root / "platform-tools" / "adb", "local.properties") for root in read_local_properties_sdk(cwd))
    candidates.extend((root / "platform-tools" / "adb", "android-studio") for root in read_android_studio_sdk_paths())
    candidates.extend(
        [
            (Path.home() / "Library" / "Android" / "sdk" / "platform-tools" / "adb", "macos-default"),
            (Path.home() / "Android" / "Sdk" / "platform-tools" / "adb", "android-default"),
        ]
    )
    path_adb = shutil.which("adb")
    if path_adb:
        candidates.append((Path(path_adb), "PATH"))

    deduplicated: list[tuple[Path, str]] = []
    seen: set[str] = set()
    for path, source in candidates:
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        deduplicated.append((Path(resolved), source))
    return deduplicated


def select_adb(explicit_adb: Optional[str], cwd: Path) -> AdbSelection:
    candidates = adb_candidates(explicit_adb, cwd)
    for path, source in candidates:
        if not path.is_file() or not os.access(path, os.X_OK):
            continue
        version = run_command([str(path), "version"]).stdout.strip()
        sdk_root = str(path.parent.parent) if path.parent.name == "platform-tools" else ""
        return AdbSelection(
            path=str(path),
            source=source,
            sdk_root=sdk_root,
            version=version,
        )

    raise UserFacingError(
        "未找到可执行的 adb。请在 Android Studio 的 SDK Tools 中安装 Android SDK Platform-Tools，"
        "或通过 --adb 指定完整路径。",
        checked=[str(path) for path, _ in candidates],
    )


def parse_adb_devices(output: str) -> list[DeviceInfo]:
    devices: list[DeviceInfo] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("List of devices") or line.startswith("*"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        details: dict[str, str] = {}
        for token in parts[2:]:
            if ":" in token:
                key, value = token.split(":", 1)
                details[key] = value
        devices.append(DeviceInfo(serial=parts[0], state=parts[1], details=details))
    return devices


def list_devices(adb_path: str) -> list[DeviceInfo]:
    result = run_command([adb_path, "devices", "-l"])
    return parse_adb_devices(result.stdout)


def probe_is_emulator(adb_path: str, serial: str) -> bool:
    if serial.startswith("emulator-"):
        return True
    result = run_command([adb_path, "-s", serial, "shell", "getprop", "ro.kernel.qemu"], check=False)
    return result.returncode == 0 and result.stdout.strip() == "1"


def annotate_device_kinds(adb_path: str, devices: list[DeviceInfo]) -> list[DeviceInfo]:
    for device in devices:
        if device.state == "device":
            device.is_emulator = probe_is_emulator(adb_path, device.serial)
    return devices


def format_device(device: DeviceInfo) -> str:
    model = device.details.get("model", "unknown-model")
    kind = "emulator" if device.is_emulator else "physical" if device.is_emulator is False else "unknown"
    return f"{device.serial} {device.state} {model} {kind}"


def select_device_from_data(devices: list[DeviceInfo], explicit_serial: Optional[str] = None) -> DeviceInfo:
    if explicit_serial:
        matches = [device for device in devices if device.serial == explicit_serial]
        if not matches:
            raise ValueError(f"找不到指定 Android 设备：{explicit_serial}")
        selected = matches[0]
        if selected.state != "device":
            raise ValueError(f"指定设备不可用：{format_device(selected)}")
        if selected.is_emulator:
            raise ValueError("当前 Skill 只支持 Android 真机，不支持 Android Emulator。")
        return selected

    physical = [device for device in devices if device.state == "device" and device.is_emulator is False]
    if len(physical) == 1:
        return physical[0]
    if len(physical) > 1:
        choices = "; ".join(format_device(device) for device in physical)
        raise ValueError(f"检测到多个已授权 Android 真机，请通过 --device 指定 serial。候选：{choices}")

    unavailable = [device for device in devices if device.state != "device"]
    if unavailable:
        choices = "; ".join(format_device(device) for device in unavailable)
        raise ValueError(f"没有已授权的 Android 真机。请解锁设备并确认 USB 调试授权。设备：{choices}")
    raise ValueError("没有检测到 Android 真机。请连接设备并启用 USB 调试。")


def find_latest_tool(candidates: list[Path], version_part: Callable[[Path], str]) -> Optional[Path]:
    available = [path for path in candidates if path.is_file() and os.access(path, os.X_OK)]
    if not available:
        return None
    available.sort(key=lambda path: (version_part(path) == "latest", version_tuple(version_part(path))), reverse=True)
    return available[0]


def find_apkanalyzer(sdk_root: Optional[Path]) -> Optional[Path]:
    path_tool = shutil.which("apkanalyzer")
    candidates = list(sdk_root.glob("cmdline-tools/*/bin/apkanalyzer")) if sdk_root else []
    if path_tool:
        candidates.append(Path(path_tool))
    return find_latest_tool(candidates, lambda path: path.parts[-3] if len(path.parts) >= 3 else "")


def find_aapt(sdk_root: Optional[Path]) -> Optional[Path]:
    path_tool = shutil.which("aapt")
    candidates = list(sdk_root.glob("build-tools/*/aapt")) if sdk_root else []
    if path_tool:
        candidates.append(Path(path_tool))
    return find_latest_tool(candidates, lambda path: path.parent.name)


def read_with_apkanalyzer(tool: Path, apk_path: Path) -> dict[str, str]:
    commands = {
        "package_name": "application-id",
        "version_name": "version-name",
        "version_code": "version-code",
        "minimum_sdk": "min-sdk",
        "target_sdk": "target-sdk",
    }
    values: dict[str, str] = {}
    for key, command in commands.items():
        result = run_command([str(tool), "manifest", command, str(apk_path)], check=False)
        values[key] = result.stdout.strip() if result.returncode == 0 else ""
    return values


def parse_aapt_badging(output: str) -> dict[str, str]:
    def match(pattern: str) -> str:
        found = re.search(pattern, output)
        return found.group(1) if found else ""

    return {
        "package_name": match(r"package:\s+name='([^']+)'"),
        "version_code": match(r"versionCode='([^']*)'"),
        "version_name": match(r"versionName='([^']*)'"),
        "minimum_sdk": match(r"sdkVersion:'([^']*)'"),
        "target_sdk": match(r"targetSdkVersion:'([^']*)'"),
    }


def read_apk_info(apk_path: Path, sdk_root: Optional[Path], package_fallback: str = "") -> ApkInfo:
    apk_path = apk_path.expanduser().resolve()
    if not apk_path.is_file():
        raise UserFacingError("找不到 APK 文件。", apk_path=str(apk_path))
    if apk_path.suffix.lower() != ".apk":
        raise UserFacingError("Android 真机安装包必须是单个 .apk 文件。", apk_path=str(apk_path))

    values: dict[str, str] = {}
    metadata_tool = ""
    apkanalyzer = find_apkanalyzer(sdk_root)
    if apkanalyzer:
        values = read_with_apkanalyzer(apkanalyzer, apk_path)
        if values.get("package_name"):
            metadata_tool = str(apkanalyzer)
    if not values.get("package_name"):
        aapt = find_aapt(sdk_root)
        if aapt:
            result = run_command([str(aapt), "dump", "badging", str(apk_path)], check=False)
            if result.returncode == 0:
                values = parse_aapt_badging(result.stdout)
                metadata_tool = str(aapt)

    package_name = values.get("package_name", "") or package_fallback
    return ApkInfo(
        apk_path=str(apk_path),
        package_name=package_name,
        version_name=values.get("version_name", ""),
        version_code=values.get("version_code", ""),
        minimum_sdk=values.get("minimum_sdk", ""),
        target_sdk=values.get("target_sdk", ""),
        metadata_tool=metadata_tool,
    )


def classify_install_failure(output: str) -> str:
    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in output:
        return "APK 与已安装 App 签名不一致。为避免清空登录态，本 Skill 不会自动卸载旧 App。"
    if "INSTALL_FAILED_VERSION_DOWNGRADE" in output:
        return "APK 版本低于已安装版本；确认需要降级后传入 --allow-downgrade。"
    if "INSTALL_FAILED_NO_MATCHING_ABIS" in output:
        return "APK 不包含当前设备支持的 ABI。"
    if "INSTALL_FAILED_OLDER_SDK" in output:
        return "设备 Android 版本低于 APK 的最低系统要求。"
    if "INSTALL_FAILED_INSUFFICIENT_STORAGE" in output:
        return "设备存储空间不足。"
    if "INSTALL_FAILED_TEST_ONLY" in output:
        return "APK 标记为 testOnly；当前命令已使用 -t，仍失败时请检查设备策略。"
    return "ADB 安装 APK 失败。"


def install_apk(adb_path: str, serial: str, apk_path: Path, allow_downgrade: bool) -> subprocess.CompletedProcess:
    command = [adb_path, "-s", serial, "install", "-r", "-t"]
    if allow_downgrade:
        command.append("-d")
    command.append(str(apk_path))
    result = run_command(command, check=False)
    if result.returncode != 0 or "Failure [" in f"{result.stdout}\n{result.stderr}":
        output = f"{result.stdout}\n{result.stderr}"
        raise UserFacingError(classify_install_failure(output), **command_error(result))
    return result


def is_package_installed(adb_path: str, serial: str, package_name: str) -> bool:
    result = run_command([adb_path, "-s", serial, "shell", "pm", "path", package_name], check=False)
    return result.returncode == 0 and any(line.startswith("package:") for line in result.stdout.splitlines())


def resolve_activity(adb_path: str, serial: str, deeplink: str, package_name: str) -> str:
    command = [
        adb_path,
        "-s",
        serial,
        "shell",
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-a",
        "android.intent.action.VIEW",
        "-c",
        "android.intent.category.BROWSABLE",
        "-d",
        deeplink,
        package_name,
    ]
    result = run_command(command, check=False)
    output = result.stdout.strip()
    if result.returncode != 0 or not output or "No activity found" in output:
        return ""
    return output.splitlines()[-1]


def open_deeplink(adb_path: str, serial: str, deeplink: str, package_name: str) -> subprocess.CompletedProcess:
    command = [
        adb_path,
        "-s",
        serial,
        "shell",
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.VIEW",
        "-c",
        "android.intent.category.BROWSABLE",
        "-d",
        deeplink,
        package_name,
    ]
    result = run_command(command, check=False)
    output = f"{result.stdout}\n{result.stderr}"
    if result.returncode != 0 or "unable to resolve Intent" in output or re.search(r"(^|\n)Error:", output):
        raise UserFacingError("目标 App 无法处理该 deeplink。", deeplink=deeplink, **command_error(result))
    return result


def default_apps_path() -> Path:
    return Path(__file__).resolve().parents[1] / "references" / "apps.md"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install an APK on an Android device and open an H5 deeplink.")
    parser.add_argument("--device", help="ADB serial. If omitted, exactly one authorized physical device is required.")
    parser.add_argument("--adb", help="Path to adb. If omitted, Android SDK and PATH locations are searched.")
    parser.add_argument("--apk", help="Path to a single APK. If omitted, an already installed package is used.")
    parser.add_argument("--package-name", help="Android package name; overrides APK or apps.md metadata.")
    parser.add_argument("--h5-url", help="H5 URL to inject into the deeplink template.")
    parser.add_argument("--deeplink", help="Complete deeplink to open. If provided, no table lookup is used.")
    parser.add_argument("--deeplink-template", help="Inline deeplink template containing {encodedUrl}, {url}, or XXXX.")
    parser.add_argument("--app-name", help="App name or alias used to find Android metadata in apps.md.")
    parser.add_argument("--apps-table", "--deeplinks-table", dest="apps_table", default=str(default_apps_path()), help="Path to apps.md.")
    parser.add_argument("--allow-downgrade", action="store_true", help="Allow adb install -d for an intentional downgrade.")
    parser.add_argument("--dry-run", action="store_true", help="Resolve inputs and print planned actions without installing or opening a URL.")
    return parser.parse_args()


def resolve_deeplink(args: argparse.Namespace) -> Optional[str]:
    if args.deeplink:
        deeplink = args.deeplink
    elif not args.h5_url:
        return None
    else:
        validate_h5_url(args.h5_url)
        if args.deeplink_template:
            deeplink = build_deeplink_from_template(args.deeplink_template, args.h5_url)
        elif args.app_name:
            deeplink = build_deeplink_from_table(Path(args.apps_table), args.app_name, args.h5_url, ANDROID_PLATFORM)
        else:
            raise ValueError("提供 --h5-url 时还需要 --app-name 或 --deeplink-template")

    if not urlparse(deeplink).scheme:
        raise ValueError("deeplink 必须包含 URL scheme")
    return deeplink


def main() -> int:
    args = parse_args()
    adb = select_adb(args.adb, Path.cwd())
    devices = annotate_device_kinds(adb.path, list_devices(adb.path))
    device = select_device_from_data(devices, args.device)

    app_definition = load_app_definition(Path(args.apps_table), args.app_name, ANDROID_PLATFORM) if args.app_name else None
    configured_package = app_definition.app_identifier if app_definition else ""
    apk_path = Path(args.apk).expanduser().resolve() if args.apk else None
    sdk_root = Path(adb.sdk_root) if adb.sdk_root else None
    apk_info = read_apk_info(apk_path, sdk_root, configured_package) if apk_path else None
    package_name = args.package_name or (apk_info.package_name if apk_info else "") or configured_package
    if not package_name:
        raise UserFacingError(
            "无法确定 Android package name。请提供 --package-name，或安装 Android SDK Command-line Tools 以解析 APK。"
        )

    deeplink = resolve_deeplink(args)
    installed_before = is_package_installed(adb.path, device.serial, package_name)
    if not apk_path and not installed_before:
        raise UserFacingError("目标 App 尚未安装，且未提供 APK。", package_name=package_name, device=device.serial)

    result = {
        "platform": ANDROID_PLATFORM,
        "adb": asdict(adb),
        "device": asdict(device),
        "app_source": {"type": "apk", "path": str(apk_path)} if apk_path else {"type": "installed"},
        "app_definition": asdict(app_definition) if app_definition else None,
        "apk": asdict(apk_info) if apk_info else None,
        "package_name": package_name,
        "installed_before": installed_before,
        "allow_downgrade": args.allow_downgrade,
        "deeplink": deeplink,
        "resolved_activity": "",
        "dry_run": args.dry_run,
        "actions": [],
    }

    if args.dry_run:
        if apk_path:
            result["actions"].append("install")
        if deeplink:
            result["actions"].append("open_deeplink")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if apk_path:
        install = install_apk(adb.path, device.serial, apk_path, args.allow_downgrade)
        result["actions"].append("install")
        result["install_stdout"] = install.stdout.strip()
        result["install_stderr"] = install.stderr.strip()

    if deeplink:
        result["resolved_activity"] = resolve_activity(adb.path, device.serial, deeplink, package_name)
        opened = open_deeplink(adb.path, device.serial, deeplink, package_name)
        result["actions"].append("open_deeplink")
        result["open_stdout"] = opened.stdout.strip()
        result["open_stderr"] = opened.stderr.strip()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UserFacingError as exc:
        payload = {"error": "input_error", "message": str(exc), **exc.details}
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(2)
    except ValueError as exc:
        payload = {"error": "input_error", "message": str(exc)}
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(2)
    except subprocess.CalledProcessError as exc:
        payload = {"error": "command_failed", **command_error(exc)}
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(exc.returncode)
