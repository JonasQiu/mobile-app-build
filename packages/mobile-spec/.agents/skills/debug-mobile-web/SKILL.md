---
name: debug-mobile-web
description: 使用 WebLens CLI 无 GUI、结构化地调试移动端 Web 页面、端内 H5 和 WebView。适用于已验证的 iOS Simulator WKWebView、iOS 真机 Mobile Safari、Android 真机 Debug WebView 或已启动的 Android Emulator Debug WebView：发现页面、执行只读 JavaScript、查询 DOM、读取 localStorage/sessionStorage、采集 Console 与 Fetch/XHR Network、按需读取失败响应体和截图，以及诊断 Device、Target、Session、ADB 或 Inspector 连接问题。当用户要求排查移动端网页报错、白屏、状态异常、接口失败或比较双端页面行为时使用；页面尚未打开时可先组合 open-h5-in-mobile-app。本 Skill 不负责原生 UI 操作、代码修改、AVD 生命周期管理或未经验证的平台支持。
---

# 调试移动端 Web 页面

## 职责

使用 WebLens 的版本化 JSON CLI 完成 WebView 内部诊断。把设备发现、协议
连接、Target identity、Session、事件关联、脱敏和资源清理交给 CLI；不要
临时编写 iwdp、WebSocket 或 WebKit 协议客户端。

页面尚未打开且 `$open-h5-in-mobile-app` 支持当前平台时，先用它把页面置于
可检查状态；在 Android Emulator 上，它只负责已启动实例中的宿主 App 安装与
deeplink，不负责 AVD 生命周期。本 Skill 只从 WebLens discovery 开始，不复制
原生 App 或 AVD 操作。

## 开始前

先按 [CLI 与平台依赖](references/cli.md) 验证 `weblens`、JSON Schema 和目标
平台依赖。所有 WebLens 命令增加 `--json`，只解析 stdout 的单个 JSON 文档；
stderr 仅作为诊断信息。

自动运行 `devices` 和 `targets` 获取 Device、系统 build 和 Target，不向用户
询问可以发现的值。只有候选无法根据用户意图区分，或需要解锁、信任、打开
页面、复现等物理操作时才请求用户输入。

## 核心流程

1. 验证 CLI；首次使用、环境变化或连接异常时运行 `doctor`。
2. 运行 `devices`，按用户指定的平台和连接方式选择 Device。
3. 运行 `targets --device <id>`，按 App、title 和 URL 意图选择 Target。
4. 多个候选都可能正确时展示脱敏事实并请求选择，绝不默认第一个。
5. 根据任务选择单次 `--target` 或显式 `--session`。
6. 先收集低风险证据，再按需增加 Console、Network、response body 或只读
   eval。
7. 根据直接证据给出结论、限制和验证范围。
8. 显式 Session 无论成功或失败都执行 `detach`。

按 Device 的 `platform` 选择且只读取一个平台工作流：

- iOS：读取 [iOS 调试工作流](references/ios-workflows.md)。
- Android：读取 [Android 调试工作流](references/android-workflows.md)。

命令非零退出或返回 `ok: false` 时按
[错误恢复](references/error-recovery.md)处理。

## 选择连接模式

仅执行一个读取动作且不需要事件关联时使用 `--target`，例如 capabilities、
query、有界 dom、Storage key、简短只读 eval 或 screenshot。

出现以下任一情况时先 `attach`：

- 需要两个或以上调试动作。
- 需要用户或 UI 工具操作前后的证据。
- 需要 Console、Network 或 response body。
- 需要跨 CLI 调用保持同一 Target identity。

同一 Device + Target 不创建多个活跃 Session。attach 前检查 `sessions`，
不得抢占或 detach 无法证明属于当前任务的 Session。

## 证据与权限

按 capabilities/DOM/Storage key → Console → Network metadata → error response
body → 只读 eval 的顺序逐步扩大数据范围。默认不采集 response body、
protocol trace、Cookie 或完整 Storage value。

- capability 不支持时明确报告，不用 eval 或 `raw` 伪造等价能力。
- 不把 `raw` 当作常规 fallback。
- 长或敏感表达式使用 `--expression-file` 或 stdin；临时文件设为 `0600`，
  使用后删除。
- 未经用户明确授权，不执行点击、提交、Storage 写入、全局变量覆写或其他
  改变页面状态的 JavaScript。
- 遵守 CLI 的有界输出、脱敏、Artifact 和 TTL，不在回答或仓库中泄露完整
  敏感 URL、token、body 或 raw Device ID。

## 标识与清理

- Target reference、Node/Object/Request ID 都是短生命周期标识。
- reload、导航、页面替换或 Target generation 变化后丢弃旧文档级标识。
- Request ID 只在创建它的存活 Session 中有效。
- 事件读取始终推进 `data.cursor.nextAfter`；`cursor.gap: true` 时报告证据
  不完整。
- Session 断线后 fail closed；重新运行 `targets`，不按相似 URL/title
  静默重连。
- 正常结束只使用 `detach`。仅在 CLI 报告自有异常残留时运行 `cleanup`；
  不读取私有状态或按进程名 kill iwdp、Node、ADB。

## 支持边界

以当前 CLI 的 `doctor`、Device 事实和 capability 为准。当前只编排精确验证
组合中的 iOS Simulator WKWebView、iOS 真机 Mobile Safari、Android 真机
Debug WebView 和已启动的 Android Emulator Debug WebView。不得把 Safari
结果外推为真机 App WKWebView，也不得把参考 Android 结果外推到其他
OEM/image/provider、Work Profile 或无线 ADB。

## 结果交付

报告 CLI 版本、平台和连接方式、Target 选择依据、Session 模式、直接调试
证据、gap/truncated/Artifact/capability 限制、detach 结果和结论适用范围。
不要把推断表述成已验证事实。
