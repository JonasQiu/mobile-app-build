# WebLens CLI 与平台依赖

本文件是 CLI 检测、安装、Schema 兼容性和平台外部依赖的唯一规则。Skill
不依赖仓库源码路径、本地 tarball 或包装脚本。

## 支持契约

```text
CLI 最低版本：0.6.0
CLI JSON Schema：1.0
Node.js：>=22.0.0
```

每次任务先运行：

```bash
command -v weblens
weblens version --json
```

要求 stdout JSON 的 `ok: true`、版本不低于 `0.6.0` 且
`schemaVersion: "1.0"`。stderr 不用于推断协议状态。

## 安装或升级

CLI 缺失或版本过低时，先告知用户安装会写入 npm 全局 prefix，再从滴滴
内部源安装固定版本并复检：

```bash
node --version
npm --version
npm install --global @didi/weblens@0.6.0 \
  --registry=http://npm.intra.xiaojukeji.com
weblens version --json
```

- 不使用 `sudo`，不修改全局 npm registry。
- 不从仓库源码或本地 tarball 安装，不用 `npx` 运行跨命令 Session。
- 不生成临时 CDP、WIP、iwdp 或 WebSocket 客户端。
- 已安装更高版本时不降级；Schema 兼容且命令能力满足任务即可继续。

## doctor 与平台连接器

首次使用、安装或升级后、Xcode/runtime/iwdp/ADB/Device 环境变化，或遇到
依赖和连接错误时按目标平台运行：

```bash
weblens doctor --platform ios --json
weblens doctor --platform android --json
```

`ok: true` 不代表环境可用。检查：

- `data.ready`
- `data.checks.iwdp.status`、路径、版本及依赖版本
- `data.support.status` 和已验证 connector 版本

npm 包不包含 `ios_webkit_debug_proxy` 及其原生依赖。CLI 负责启动、watchdog
和清理；Skill 不手工启动或终止 iwdp。

iwdp 为 `unavailable` 时停止 iOS 调试并说明它是外部系统依赖。本机已有
Homebrew 时请用户执行：

```bash
brew install ios-webkit-debug-proxy
```

等待用户确认后重新运行 `doctor`。不要自动安装 Homebrew/iwdp，也不要改用
源码或自制协议客户端。当前精确验证版本为 iwdp `1.9.2`；其他组合服从
`data.support.status`，`unverified` 不得表述为 `supported`。

Android 依赖本机已有可执行 ADB，并要求目标 App 主动启用 WebView debugging。
CLI 负责 socket discovery、随机 loopback forward、watchdog 和精确清理；Skill
不执行 `adb kill-server`、`forward --remove-all` 或手工创建调试连接。

ADB 缺失时停止 Android 调试，请用户通过团队标准 Android SDK 安装流程补齐；
不要自动下载 SDK 或修改全局环境。设备 unauthorized/offline、没有调试 socket
或精确版本未验证时，以 `doctor`、`devices`、`targets` 和错误码为准。

## 不兼容

版本或 Schema 不兼容、安装后复检失败、`doctor` 不 ready，或支持状态明确为
unsupported 时停止调试，报告实际版本、Schema、退出码和脱敏错误，不绕过
CLI 的版本、capability 或连接门禁。
