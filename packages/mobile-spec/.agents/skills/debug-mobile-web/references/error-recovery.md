# WebLens 错误恢复

只根据 stdout JSON 的 `error.code` 和 `retryable` 恢复；stderr 仅作诊断。
Session 断线后 fail closed，不编辑私有状态、不手工连接 Worker IPC。

## Device 与依赖

| 错误码 | 动作 |
|---|---|
| `DEPENDENCY_UNAVAILABLE` | 按平台运行 `doctor --json`；缺少 iwdp 或 ADB 时停止并请用户安装对应依赖。 |
| `DEPENDENCY_VERSION_UNSUPPORTED` | 报告当前和已验证版本，不绕过门禁。 |
| `DEVICE_NOT_BOOTED` | 请用户启动目标 Simulator，再运行 `devices`。 |
| `DEVICE_NOT_FOUND` | 重新运行 `devices`；检查 USB 或 boot 状态。 |
| `DEVICE_NOT_TRUSTED` | 请用户完成设备与 Mac 的信任，不修改 pair record。 |
| `DEVICE_LOCKED` | 请用户解锁并保持页面可检查，再运行 `targets`。 |
| `DEVICE_DISCONNECTED` | 结束旧 Session；恢复连接后重新发现 Device 和 Target。 |
| `WEB_INSPECTOR_UNAVAILABLE` | 确认页面已打开且允许检查，以 `targets` 为准。 |
| `WEBVIEW_DEBUGGING_UNAVAILABLE` | 确认 Android App 主动启用 WebView debugging 且页面已创建；不修改 App 或系统设置。 |

`doctor` 的 `ok: true` 不代表 ready，也不能证明设备实时解锁或一定存在可检查
页面；同时检查 `data.ready`、平台连接器和 support 状态。Android
unauthorized/offline 统一依据 Device 状态与公开错误，不读取 raw serial。

## Target

| 错误码 | 动作 |
|---|---|
| `TARGET_NOT_FOUND` | 重新运行 `targets`，确认页面仍打开。 |
| `TARGET_AMBIGUOUS` | 展示候选并请求选择，绝不默认第一项。 |
| `TARGET_STALE` | 丢弃旧 Target 和文档级 ID，重新运行 `targets`。 |
| `TARGET_BUSY` | 用 `sessions` 检查 owner，不抢占未知 Session。 |

## Session

| 错误码 | 动作 |
|---|---|
| `SESSION_NOT_FOUND` | 丢弃旧 ID，重新发现 Target 并 attach。 |
| `SESSION_NOT_READY` | 读取 `session status`；已失败则重新发现，不循环重试。 |
| `SESSION_EXPIRED` | 丢弃 Session 内全部 ID，重新发现并 attach。 |
| `SESSION_BUSY` | 等待有界操作完成后重试一次，不并发发送协议操作。 |
| `SESSION_VERSION_MISMATCH` | attach 和后续命令使用同一 CLI 版本。 |
| `SESSION_AUTH_FAILED` | 停止使用该 Session，不读取或修改状态文件。 |
| `REQUEST_NOT_IN_SESSION` | 不读取 body，只使用原存活 Session 的 Request ID。 |

## 命令与协议

| 错误码 | 动作 |
|---|---|
| `INVALID_ARGUMENT` | 读取当前 `--help` 修正参数。 |
| `CONNECTION_FAILED` | 检查 Device/页面生命周期，丢弃失败 Session，重新发现；仅在 `retryable: true` 时重试一次。 |
| `PROTOCOL_ERROR` | 保留有界错误和 capability，不自动改用 `raw`。 |
| `TIMEOUT` | 仅在 Target identity 仍可证明且 `retryable: true` 时重试一次。 |
| `CAPABILITY_UNSUPPORTED` | 报告不支持，不用 eval/`raw` 伪造。 |
| `PERMISSION_DENIED` | 请求必要授权，不改变系统安全配置。 |
| `OUTPUT_LIMIT_EXCEEDED` | 缩小 depth/limit，或使用 CLI 提供的 Artifact。 |
| `INTERNAL_ERROR` | 保留脱敏复现步骤，停止自动恢复并报告 CLI 缺陷。 |

## 清理

正常路径使用 `detach`。detach 失败或异常退出时先运行：

```bash
weblens sessions --all --json
```

只有 CLI 报告与当前任务对应的 terminal/expired Session 或可清理自有残留时
才运行 `weblens cleanup --json`。禁止按进程名 kill、删除未知资源、编辑
私有状态、在 stale 后按 title/URL 静默重连，或跨 Session 复用 Request ID；
Android 不执行 `adb kill-server`、`forward --remove-all` 或
`reverse --remove-all`。
