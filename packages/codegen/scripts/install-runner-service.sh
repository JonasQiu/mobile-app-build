#!/bin/zsh
set -euo pipefail

service_label="com.siteforge.runner"
script_dir="${0:A:h}"
codegen_dir="${script_dir:h}"
repo_dir="${codegen_dir:h:h}"
source_env="${1:-/tmp/mobile-build-runner.env}"
config_dir="${HOME}/.config/siteforge"
state_dir="${HOME}/.local/share/siteforge"
agent_dir="${HOME}/Library/LaunchAgents"
stable_env="${config_dir}/runner.env"
stable_tunnel="${state_dir}/cloudflared"
plist_path="${agent_dir}/${service_label}.plist"
node_bin="$(realpath "$(command -v node)")"

if [[ ! -f "${source_env}" ]]; then
  print -u2 "Runner environment file not found: ${source_env}"
  exit 1
fi

tunnel_source=""
while IFS='=' read -r key value; do
  if [[ "${key}" == "CODEGEN_TUNNEL_BIN" ]]; then
    tunnel_source="${value}"
    break
  fi
done < "${source_env}"

if [[ -z "${tunnel_source}" || ! -x "${tunnel_source}" ]]; then
  print -u2 "CODEGEN_TUNNEL_BIN is missing or not executable"
  exit 1
fi

mkdir -p "${config_dir}" "${state_dir}" "${agent_dir}"
install -m 700 "${tunnel_source}" "${stable_tunnel}"

env_tmp="$(mktemp "${config_dir}/runner.env.XXXXXX")"
awk -F= -v stable_tunnel="${stable_tunnel}" '
  $1 == "CODEGEN_TUNNEL_BIN" { print "CODEGEN_TUNNEL_BIN=" stable_tunnel; replaced = 1; next }
  { print }
  END { if (!replaced) print "CODEGEN_TUNNEL_BIN=" stable_tunnel }
' "${source_env}" > "${env_tmp}"
chmod 600 "${env_tmp}"
mv "${env_tmp}" "${stable_env}"

cat > "${plist_path}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${service_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${codegen_dir}/runner.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${codegen_dir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEGEN_LOCAL_ENV_FILE</key>
    <string>${stable_env}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${state_dir}/runner.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${state_dir}/runner.stderr.log</string>
</dict>
</plist>
PLIST
chmod 600 "${plist_path}"

domain="gui/$(id -u)"
launchctl bootout "${domain}/${service_label}" >/dev/null 2>&1 || true
loaded=false
for attempt in 1 2 3; do
  if launchctl bootstrap "${domain}" "${plist_path}" >/dev/null 2>&1; then
    loaded=true
    break
  fi
  sleep 1
done
if [[ "${loaded}" != "true" ]]; then
  print -u2 "Failed to load ${service_label} after 3 attempts"
  exit 1
fi
launchctl kickstart -k "${domain}/${service_label}"

print "SiteForge Runner service installed"
print "Repository: ${repo_dir}"
print "Service: ${service_label}"
