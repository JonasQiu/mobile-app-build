# Android 调试工作流

## 环境与发现

```bash
weblens doctor --platform android --json
weblens devices --platform android --json
weblens doctor --platform android --device <device-id> --json
weblens targets --device <device-id> --json
```

- 只选择 `platform: android`、`available: true` 的候选。真机要求
  `connection: device`；M3 已验证基线还要求 `connectionMode: usb`。
  Emulator 要求 `connection: simulator`，并且必须已由用户或测试环境启动。
- App 必须主动启用 WebView debugging；WebLens 不修改 App 或系统设置。
- 多个 Device/Target 均可能正确时展示脱敏候选并请求选择，不默认第一个。
- 不读取或输出 raw ADB serial；后续只使用 WebLens opaque Device ID。
- Target reference 有 TTL，发现后立即 attach 或执行单次命令。

真机或已启动的 Emulator 中页面尚未出现时，使用 `$open-h5-in-mobile-app`
安装/启动宿主并打开用户指定页面，随后重新运行 `targets`。该 Skill 不管理
AVD 生命周期；Emulator 尚未启动时，请用户或测试 Harness 先启动并等待开机。
不要自行启动 AVD、拼 deeplink 或复用旧 Target。

## 调试命令

单次只读诊断与显式 Session 的命令语义和 iOS 一致：

```bash
weblens capabilities --target <target-id> --json
weblens eval --target <target-id> --expression 'document.title' --json
weblens query --target <target-id> --selector '#status' --json
weblens dom --target <target-id> --depth 3 --json
weblens storage --target <target-id> --type local --json
weblens screenshot --target <target-id> --json

weblens attach \
  --target <target-id> \
  --console --network --response-bodies errors \
  --ttl 15m --json
weblens session events --session <session-id> --after 0 --json
weblens response-body --session <session-id> --request <request-id> --json
weblens detach --session <session-id> --json
```

只需一个读取动作时使用 `--target`；两个以上动作、需要复现操作或事件关联时
使用 Session。response body 只读取失败请求且必须属于当前存活 Session。

## Android 生命周期

- App/WebView 重建后 PID、socket、CDP page target 和 Target reference 都可能
  变化；收到 `TARGET_STALE` 或 Session failed 后重新 discovery/attach。
- App 后台不等于 Target 已销毁，以 Session 状态和命令结果为准。
- USB/ADB 恢复后重新运行 `devices` 和 `targets`，不复用断线前引用。
- Emulator cold boot、Quick Boot、snapshot restore 或 ADB transport 变化后，
  丢弃旧 Session/Target，重新运行 `devices`、`targets` 和 `attach`。
- 第二个 Session 返回 `TARGET_BUSY` 时不抢占未知 owner。
- 正常路径只用 `detach`；CLI 自有异常残留才用 `cleanup`。
- 不运行 `adb kill-server`、`forward --remove-all`、`reverse --remove-all`，不按
  进程名 kill ADB、WebLens Worker 或业务 App。

## 支持边界

当前正式支持只覆盖 `doctor` 报告为 `supported` 的精确 Android 组合。Android
Emulator 仅覆盖 WebLens 0.6.0 验证的 API 35 Google APIs arm64 image、固定
Emulator/ADB/WebView provider 组合；Skill 不创建、启动、停止 AVD，也不安装
Probe Host。其他 OEM/image/provider、Work Profile、多 Android user、无线 ADB、
Chrome tab、原生网络和 Debugger/断点不在当前保证范围。
