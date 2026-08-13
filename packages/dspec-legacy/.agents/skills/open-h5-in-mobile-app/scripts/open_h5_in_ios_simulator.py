#!/usr/bin/env python3
import argparse
import json
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

from mobile_h5_common import build_deeplink_from_table, build_deeplink_from_template, validate_h5_url


@dataclass
class AppInfo:
    app_path: str
    bundle_id: str
    display_name: str
    executable: str
    short_version: str
    build_version: str
    minimum_os_version: str
    supported_platforms: list[str]
    url_schemes: list[str]
    executable_arch: str


class UserFacingError(Exception):
    def __init__(self, message: str, **details):
        super().__init__(message)
        self.details = details


def run_command(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=check, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def command_error(exc: subprocess.CalledProcessError) -> dict:
    return {
        "command": exc.cmd,
        "returncode": exc.returncode,
        "stdout": exc.stdout or "",
        "stderr": exc.stderr or "",
    }


def read_plist(path: Path) -> dict:
    with path.open("rb") as f:
        return plistlib.load(f)


def executable_arch(app_path: Path, executable: str) -> str:
    executable_path = app_path / executable
    if not executable_path.exists():
        return "missing"
    for command in (["lipo", "-info", str(executable_path)], ["file", str(executable_path)]):
        try:
            result = run_command(command)
            return result.stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue
    return "unknown"


def read_app_info(app_path: Path) -> AppInfo:
    app_path = app_path.expanduser().resolve()
    plist = read_plist(app_path / "Info.plist")
    url_schemes: list[str] = []
    for item in plist.get("CFBundleURLTypes", []):
        url_schemes.extend(item.get("CFBundleURLSchemes", []))

    executable = plist.get("CFBundleExecutable", "")
    return AppInfo(
        app_path=str(app_path),
        bundle_id=plist.get("CFBundleIdentifier", ""),
        display_name=plist.get("CFBundleDisplayName") or plist.get("CFBundleName", ""),
        executable=executable,
        short_version=plist.get("CFBundleShortVersionString", ""),
        build_version=plist.get("CFBundleVersion", ""),
        minimum_os_version=plist.get("MinimumOSVersion", ""),
        supported_platforms=plist.get("CFBundleSupportedPlatforms", []),
        url_schemes=url_schemes,
        executable_arch=executable_arch(app_path, executable),
    )


def extract_app_archive(archive_path: Path, destination: Path) -> Path:
    archive_path = archive_path.expanduser().resolve()
    if not archive_path.is_file():
        raise UserFacingError("找不到 App 安装包压缩文件。", archive_path=str(archive_path))
    if not zipfile.is_zipfile(archive_path):
        raise UserFacingError("安装包必须是包含 simulator .app 的 ZIP 文件。", archive_path=str(archive_path))

    destination = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            member_path = (destination / member.filename).resolve()
            if member_path != destination and destination not in member_path.parents:
                raise UserFacingError("ZIP 中包含不安全的路径，已停止解压。", member=member.filename)
        archive.extractall(destination)

    apps = sorted(
        path for path in destination.rglob("*.app")
        if path.is_dir() and "__MACOSX" not in path.parts and not any(parent.suffix == ".app" for parent in path.parents)
    )
    if not apps:
        raise UserFacingError("ZIP 中没有找到 .app。请提供包含 simulator .app 的安装包。", archive_path=str(archive_path))
    if len(apps) > 1:
        raise UserFacingError("ZIP 中包含多个 .app，无法确定宿主 App。", apps=[str(path) for path in apps])
    return apps[0]


def is_simulator_app(app_info: AppInfo) -> bool:
    return "iPhoneSimulator" in app_info.supported_platforms


def same_version(local: AppInfo, installed: AppInfo) -> bool:
    return (
        local.bundle_id == installed.bundle_id
        and local.short_version == installed.short_version
        and local.build_version == installed.build_version
    )


def ensure_xcode_available() -> dict:
    install_hint = (
        "请先安装完整 Xcode，并在 Xcode Settings > Platforms 中安装 iOS Simulator runtime；"
        "如果已安装 Xcode，请运行 sudo xcode-select -s /Applications/Xcode.app/Contents/Developer。"
    )
    try:
        developer_dir = run_command(["xcode-select", "-p"]).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise UserFacingError(f"未找到 Xcode 开发目录。{install_hint}", cause=str(exc))

    try:
        simctl_path = run_command(["xcrun", "--find", "simctl"]).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise UserFacingError(f"未找到 simctl，无法操作 iOS Simulator。{install_hint}", developer_dir=developer_dir, cause=str(exc))

    return {"developer_dir": developer_dir, "simctl": simctl_path}


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value or ""))


def runtime_version(runtime: str) -> str:
    match = re.search(r"iOS[- ]([0-9][0-9.\-]*)", runtime)
    if not match:
        return ""
    return match.group(1).replace("-", ".")


def simulator_candidates_from_data(data: dict) -> list[dict]:
    candidates: list[dict] = []
    for runtime, devices in data.get("devices", {}).items():
        if "iOS" not in runtime:
            continue
        for device in devices:
            name = device.get("name", "")
            udid = device.get("udid", "")
            if not udid or "iPhone" not in name or not device.get("isAvailable", True):
                continue
            candidates.append(
                {
                    "name": name,
                    "udid": udid,
                    "state": device.get("state", ""),
                    "runtime": runtime,
                    "runtime_version": runtime_version(runtime),
                }
            )
    return candidates


def format_simulator(candidate: dict) -> str:
    runtime = candidate.get("runtime_version") or candidate.get("runtime", "")
    return f"{candidate.get('name')} {runtime} {candidate.get('state')} {candidate.get('udid')}"


def select_simulator_from_data(data: dict, minimum_os_version: str = "") -> dict:
    candidates = simulator_candidates_from_data(data)
    minimum = version_tuple(minimum_os_version)
    if minimum:
        candidates = [candidate for candidate in candidates if version_tuple(candidate["runtime_version"]) >= minimum]

    if not candidates:
        suffix = f" 且系统版本 >= {minimum_os_version}" if minimum_os_version else ""
        raise ValueError(f"没有找到可用的 iPhone Simulator{suffix}。请先在 Xcode 中安装 iOS Simulator runtime。")

    booted = [candidate for candidate in candidates if candidate["state"] == "Booted"]
    if len(booted) == 1:
        return booted[0]
    if len(booted) > 1:
        choices = "; ".join(format_simulator(candidate) for candidate in booted)
        raise ValueError(f"检测到多个已启动的 iPhone Simulator，请通过 --simulator 指定 UDID。候选：{choices}")

    candidates.sort(key=lambda candidate: (version_tuple(candidate["runtime_version"]), candidate["name"], candidate["udid"]), reverse=True)
    return candidates[0]


def select_simulator(minimum_os_version: str = "") -> dict:
    result = run_command(["xcrun", "simctl", "list", "devices", "available", "-j"])
    return select_simulator_from_data(json.loads(result.stdout), minimum_os_version)


def get_installed_app_path(simulator: str, bundle_id: str) -> Optional[Path]:
    result = run_command(["xcrun", "simctl", "get_app_container", simulator, bundle_id, "app"], check=False)
    if result.returncode != 0:
        return None
    path = result.stdout.strip()
    return Path(path) if path else None


def boot_simulator(simulator: str) -> None:
    result = run_command(["xcrun", "simctl", "boot", simulator], check=False)
    stderr = result.stderr.lower()
    if result.returncode != 0 and "already booted" not in stderr and "current state: booted" not in stderr:
        raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
    run_command(["xcrun", "simctl", "bootstatus", simulator, "-b"])


def install_app(simulator: str, app_path: Path) -> None:
    run_command(["xcrun", "simctl", "install", simulator, str(app_path)])


def is_app_running(simulator: str, bundle_id: str) -> bool:
    result = run_command(["xcrun", "simctl", "spawn", simulator, "launchctl", "list"], check=False)
    if result.returncode != 0:
        return False
    return f"UIKitApplication:{bundle_id}[" in result.stdout


def launch_app(simulator: str, bundle_id: str) -> subprocess.CompletedProcess:
    return run_command(["xcrun", "simctl", "launch", "--terminate-running-process", simulator, bundle_id])


def open_deeplink(simulator: str, deeplink: str) -> None:
    run_command(["xcrun", "simctl", "openurl", simulator, deeplink])


def show_simulator() -> None:
    run_command(["open", "-a", "Simulator"])


def default_apps_path() -> Path:
    return Path(__file__).resolve().parents[1] / "references" / "apps.md"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install/launch an iOS Simulator app and open an H5 deeplink.")
    parser.add_argument("--simulator", help="Simulator UDID/name. If omitted, the script auto-selects one available iPhone Simulator.")
    parser.add_argument("--app", help="Path to simulator .app.")
    parser.add_argument("--app-archive", help="Path to a ZIP containing exactly one simulator .app.")
    parser.add_argument("--bundle-id", help="Bundle ID when launching an already installed app or overriding .app metadata.")
    parser.add_argument("--h5-url", help="H5 URL to inject into the deeplink template.")
    parser.add_argument("--deeplink", help="Complete deeplink to open. If provided, no table lookup is used.")
    parser.add_argument("--deeplink-template", help="Inline deeplink template containing {encodedUrl}, {url}, or XXXX.")
    parser.add_argument("--app-name", help="App name or alias used to find a template in apps.md.")
    parser.add_argument(
        "--apps-table",
        "--deeplinks-table",
        dest="apps_table",
        default=str(default_apps_path()),
        help="Path to apps.md.",
    )
    parser.add_argument("--force-install", action="store_true", help="Install even when the same version/build is already installed.")
    parser.add_argument("--no-show-simulator", action="store_true", help="Do not bring Simulator.app to the foreground.")
    parser.add_argument("--dry-run", action="store_true", help="Resolve inputs and print the planned actions without running simctl mutations.")
    return parser.parse_args()


def resolve_deeplink(args: argparse.Namespace) -> Optional[str]:
    if args.deeplink:
        return args.deeplink
    if not args.h5_url:
        return None
    validate_h5_url(args.h5_url)
    if args.deeplink_template:
        return build_deeplink_from_template(args.deeplink_template, args.h5_url)
    if args.app_name:
        return build_deeplink_from_table(Path(args.apps_table), args.app_name, args.h5_url, "ios-simulator")
    return None


def build_actions(show_simulator: bool, should_install: bool, should_launch: bool, deeplink: Optional[str]) -> list[str]:
    actions = ["boot"]
    if show_simulator:
        actions.append("show_simulator")
    if should_install:
        actions.append("install")
    if should_launch:
        actions.append("launch")
    if deeplink:
        actions.append("openurl")
    return actions


def main() -> int:
    args = parse_args()
    xcode = ensure_xcode_available()

    if args.app and args.app_archive:
        raise UserFacingError("--app 和 --app-archive 只能提供一个")

    extracted_dir = tempfile.TemporaryDirectory(prefix="open-h5-ios-") if args.app_archive else None
    app_path = (
        extract_app_archive(Path(args.app_archive), Path(extracted_dir.name))
        if args.app_archive
        else Path(args.app).expanduser().resolve() if args.app else None
    )

    if args.app_archive:
        app_source = {"type": "archive", "path": str(Path(args.app_archive).expanduser().resolve()), "extracted_app": str(app_path)}
    else:
        app_source = {"type": "app", "path": str(app_path)} if app_path else {"type": "installed"}

    local_info = read_app_info(app_path) if app_path else None
    if local_info and not is_simulator_app(local_info):
        raise UserFacingError(
            "当前 App 不是 simulator build，无法安装到 iOS Simulator。请提供 Debug-iphonesimulator 的 .app；普通真机 ipa 不支持。",
            app_path=local_info.app_path,
            supported_platforms=local_info.supported_platforms,
        )

    bundle_id = args.bundle_id or (local_info.bundle_id if local_info else None)
    if not bundle_id:
        raise UserFacingError("--bundle-id is required when --app is not provided")

    if args.simulator:
        simulator = args.simulator
        simulator_selection = {"source": "explicit", "value": args.simulator}
    else:
        selected = select_simulator(local_info.minimum_os_version if local_info else "")
        simulator = selected["udid"]
        simulator_selection = {"source": "auto", **selected}

    installed_path = None if args.dry_run else get_installed_app_path(simulator, bundle_id)
    installed_info = read_app_info(installed_path) if installed_path else None
    should_install = bool(app_path) and (args.force_install or not installed_info or not same_version(local_info, installed_info))
    deeplink = resolve_deeplink(args)
    app_running = False if should_install else is_app_running(simulator, bundle_id)
    should_launch = should_install or not app_running

    result = {
        "xcode": xcode,
        "simulator": simulator,
        "simulator_selection": simulator_selection,
        "bundle_id": bundle_id,
        "app_source": app_source,
        "local_app": asdict(local_info) if local_info else None,
        "installed_app": asdict(installed_info) if installed_info else None,
        "skip_install": bool(app_path) and not should_install,
        "force_install": args.force_install,
        "app_running": app_running,
        "skip_launch": not should_launch,
        "deeplink": deeplink,
        "show_simulator": not args.no_show_simulator,
        "dry_run": args.dry_run,
        "actions": [],
    }

    if args.dry_run:
        result["actions"] = build_actions(not args.no_show_simulator, should_install, should_launch, deeplink)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    boot_simulator(simulator)
    result["actions"].append("boot")

    if not args.no_show_simulator:
        show_simulator()
        result["actions"].append("show_simulator")

    if should_install:
        install_app(simulator, app_path)
        result["actions"].append("install")

    if should_launch:
        launch = launch_app(simulator, bundle_id)
        result["actions"].append("launch")
        result["launch_stdout"] = launch.stdout.strip()
        result["launch_stderr"] = launch.stderr.strip()

    if deeplink:
        try:
            open_deeplink(simulator, deeplink)
            result["actions"].append("openurl")
        except subprocess.CalledProcessError as exc:
            result["openurl_error"] = command_error(exc)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return exc.returncode

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UserFacingError as exc:
        payload = {
            "error": "input_error",
            "message": str(exc),
            **exc.details,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(2)
    except ValueError as exc:
        payload = {
            "error": "input_error",
            "message": str(exc),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(2)
    except subprocess.CalledProcessError as exc:
        payload = {
            "error": "command_failed",
            **command_error(exc),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(exc.returncode)
