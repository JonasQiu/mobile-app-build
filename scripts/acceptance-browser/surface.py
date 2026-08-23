#!/usr/bin/env python3
"""Run a disposable loopback-only Chrome DevTools Protocol surface.

The surface always uses a fresh temporary profile. It never attaches to an
existing browser profile and never reads browser credentials or storage.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
DEFAULT_TARGET = "https://mobile-app-build-mvp.long229260097.chatgpt.site/"
DEFAULT_CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
RUNTIME_ROOT = Path(tempfile.gettempdir()) / f"siteforge-acceptance-cdp-{os.getuid()}"
STATE_PATH = RUNTIME_ROOT / "state.json"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def process_group_alive(pgid: int) -> bool:
    if pgid <= 0:
        return False
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def terminate_group(pgid: int, timeout: float = 8.0) -> None:
    if pgid <= 0 or pgid == os.getpgrp():
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not process_group_alive(pgid):
            return
        time.sleep(0.1)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        return


def guarded_cleanup() -> None:
    expected_parent = Path(tempfile.gettempdir()).resolve()
    resolved = RUNTIME_ROOT.resolve()
    if resolved.parent != expected_parent or not resolved.name.startswith("siteforge-acceptance-cdp-"):
        raise RuntimeError(f"refusing to clean unexpected runtime root: {resolved}")
    if not RUNTIME_ROOT.exists():
        return
    last_error: OSError | None = None
    for _ in range(40):
        try:
            shutil.rmtree(RUNTIME_ROOT)
            return
        except FileNotFoundError:
            return
        except OSError as exc:
            last_error = exc
            time.sleep(0.1)
    if last_error is not None:
        raise last_error


def load_state() -> dict[str, Any] | None:
    if not STATE_PATH.is_file():
        return None
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def fetch_json(url: str, timeout: float = 5.0) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def endpoint_status(url: str, timeout: float = 3.0) -> int:
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url, headers={"User-Agent": "SiteForge-Acceptance-Surface/1.0"})
    try:
        with opener.open(request, timeout=timeout) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)


def free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        return int(server.getsockname()[1])


def sanitized_environment() -> dict[str, str]:
    allowed = ("HOME", "LANG", "LC_ALL", "PATH", "TMPDIR")
    environment = {key: os.environ[key] for key in allowed if key in os.environ}
    environment.update({
        "NODE_ENV": "production",
        "WRANGLER_WRITE_LOGS": "false",
        "WRANGLER_LOG_PATH": str(RUNTIME_ROOT / "wrangler"),
        "MINIFLARE_REGISTRY_PATH": str(RUNTIME_ROOT / "miniflare"),
    })
    return environment


def spawn_local_production() -> dict[str, Any]:
    server = WEB_ROOT / "node_modules" / ".bin" / "vinext"
    build_id_path = WEB_ROOT / "dist" / "server" / "BUILD_ID"
    if not server.is_file() or not build_id_path.is_file():
        raise RuntimeError("current production build or vinext runtime is missing")
    port = free_loopback_port()
    log_path = RUNTIME_ROOT / "production.log"
    log = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        [str(server), "start", "--hostname", "127.0.0.1", "--port", str(port)],
        cwd=WEB_ROOT,
        env=sanitized_environment(),
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        text=True,
    )
    log.close()
    url = f"http://127.0.0.1:{port}/"
    deadline = time.monotonic() + 20
    last_error = ""
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        try:
            status = endpoint_status(url)
            return {
                "pid": process.pid,
                "pgid": os.getpgid(process.pid),
                "url": url,
                "initial_status": status,
                "build_id": build_id_path.read_text(encoding="utf-8").strip(),
                "log": str(log_path),
            }
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
            time.sleep(0.2)
    detail = log_path.read_text(encoding="utf-8", errors="replace")[-1200:]
    terminate_group(os.getpgid(process.pid) if process_alive(process.pid) else process.pid)
    raise RuntimeError(f"local production server did not become ready: {last_error}; {detail}")


def spawn_chrome(chrome: Path, target: str, headful: bool) -> dict[str, Any]:
    if not chrome.is_file() or not os.access(chrome, os.X_OK):
        raise RuntimeError(f"Chrome executable is unavailable: {chrome}")
    profile = RUNTIME_ROOT / "profile"
    log_path = RUNTIME_ROOT / "chrome.log"
    command = [
        str(chrome),
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--metrics-recording-only",
        "--disable-breakpad",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        f"--user-data-dir={profile}",
        "--window-size=1280,900",
    ]
    if not headful:
        command.append("--headless=new")
    command.append(target)
    log = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        command,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        text=True,
    )
    log.close()
    active_port = profile / "DevToolsActivePort"
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if active_port.is_file():
            port = int(active_port.read_text(encoding="utf-8").splitlines()[0])
            version = fetch_json(f"http://127.0.0.1:{port}/json/version")
            return {
                "pid": process.pid,
                "pgid": os.getpgid(process.pid),
                "port": port,
                "cdp_url": f"http://127.0.0.1:{port}",
                "browser": version.get("Browser", ""),
                "protocol": version.get("Protocol-Version", ""),
                "websocket_available": bool(version.get("webSocketDebuggerUrl")),
                "profile": str(profile),
                "log": str(log_path),
            }
        if process.poll() is not None:
            break
        time.sleep(0.1)
    detail = log_path.read_text(encoding="utf-8", errors="replace")[-1200:]
    if process_alive(process.pid):
        terminate_group(os.getpgid(process.pid))
    raise RuntimeError(f"Chrome CDP endpoint did not become ready: {detail}")


def start(args: argparse.Namespace) -> int:
    existing = load_state()
    if existing and process_alive(int(existing.get("chrome", {}).get("pid", 0))):
        emit({"ok": False, "error": "surface_already_running", "state": existing})
        return 2
    if RUNTIME_ROOT.exists():
        guarded_cleanup()
    RUNTIME_ROOT.mkdir(mode=0o700)
    server: dict[str, Any] | None = None
    chrome: dict[str, Any] | None = None
    try:
        target = args.target
        if args.local_production:
            server = spawn_local_production()
            target = str(server["url"])
        chrome = spawn_chrome(Path(args.chrome).expanduser().resolve(), target, args.headful)
        state = {
            "created_at_ms": int(time.time() * 1000),
            "runtime_root": str(RUNTIME_ROOT),
            "mode": "headful" if args.headful else "headless",
            "target": target,
            "local_production": server,
            "chrome": chrome,
        }
        STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        STATE_PATH.chmod(0o600)
        emit({"ok": True, "state": state, "probe_command": "node scripts/acceptance-browser/cdp-probe.mjs"})
        return 0
    except Exception as exc:
        if chrome:
            terminate_group(int(chrome.get("pgid", 0)))
        if server:
            terminate_group(int(server.get("pgid", 0)))
        try:
            guarded_cleanup()
        except OSError:
            pass
        emit({"ok": False, "error": str(exc)})
        return 1


def status() -> int:
    state = load_state()
    if not state:
        emit({"ok": True, "running": False})
        return 0
    chrome = state.get("chrome", {})
    cdp_url = str(chrome.get("cdp_url", ""))
    cdp_ready = False
    if cdp_url:
        try:
            cdp_ready = bool(fetch_json(f"{cdp_url}/json/version").get("webSocketDebuggerUrl"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            cdp_ready = False
    local = state.get("local_production") or {}
    server_alive = process_alive(int(local.get("pid", 0))) if local else None
    emit({
        "ok": True,
        "running": process_alive(int(chrome.get("pid", 0))) and cdp_ready,
        "cdp_ready": cdp_ready,
        "local_production_running": server_alive,
        "state": state,
    })
    return 0


def stop() -> int:
    state = load_state()
    if not state:
        emit({"ok": True, "stopped": True, "already_absent": True})
        return 0
    chrome = state.get("chrome", {})
    local = state.get("local_production") or {}
    terminate_group(int(chrome.get("pgid", 0)))
    if local:
        terminate_group(int(local.get("pgid", 0)))
    guarded_cleanup()
    emit({"ok": True, "stopped": True, "profile_removed": True})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    start_parser = subparsers.add_parser("start", help="start the disposable CDP surface")
    start_parser.add_argument("--target", default=DEFAULT_TARGET)
    start_parser.add_argument("--chrome", default=os.environ.get("CHROME_BIN", str(DEFAULT_CHROME)))
    start_parser.add_argument("--headful", action="store_true", help="show Chrome for a human-only login")
    start_parser.add_argument(
        "--local-production",
        action="store_true",
        help="serve the current apps/web/dist build on loopback and open it",
    )
    subparsers.add_parser("status", help="show surface and endpoint health")
    subparsers.add_parser("stop", help="stop processes and delete the temporary profile")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "start":
        return start(args)
    if args.command == "status":
        return status()
    if args.command == "stop":
        return stop()
    raise AssertionError(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
