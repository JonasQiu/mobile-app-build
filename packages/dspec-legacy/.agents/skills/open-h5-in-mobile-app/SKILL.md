---
name: open-h5-in-mobile-app
description: 在 iOS Simulator 或 Android 真机中获取、安装或启动移动端宿主 App，并通过 debug deeplink、自定义 URL Scheme 或 App/Universal Link 打开 H5 页面。当前端开发需要在滴滴车主等端内 App 中预览、联调或打开 H5，或需要从本地/Cooper 获取安装包并安装到目标设备时使用；若用户明确指定 iOS 真机、Android Emulator 或系统浏览器，则不要使用。
---

# 在移动端宿主 App 中打开 H5

## 范围

将目标环境准备到可预览状态：为 iOS Simulator 或 Android 真机安装/启动宿主 App，并把目标 H5 URL 通过 deeplink 路由进 App。

打开 deeplink 后即停止。不要自动选择后续页面检查、UI 操作、Web Inspector、CDP、H5Lens、断言或修复流程。

## 必需输入

先从用户消息、仓库上下文、设备环境和本地文件获取；只有缺少必需值时才询问。

- H5：接受 `http://`、`https://` 页面 URL，也接受已经内嵌页面 URL 的完整 deeplink。
- 平台：`ios-simulator` 或 `android-device`。
- App 来源，使用一种：本地安装包、工程构建产物、已安装 App 标识，或 Cooper 安装包。
- App 名称/别名：用于读取 `references/apps.md` 中的平台标识与 deeplink 模板。
- 目标设备：可选。优先使用用户给出的 Simulator UDID/name 或 ADB serial；未给出时只在候选唯一时自动选择。
- 登录状态：可选。页面需要登录或已被登录页拦截时，提示用户使用测试账号或自行登录；不要索取或使用生产账号。

## 平台选择

按以下顺序选择平台：

1. 使用用户明确指定的平台。
2. `.app`、包含 simulator `.app` 的 ZIP、Xcode project/workspace 指向 `ios-simulator`；`.apk` 指向 `android-device`。
3. Simulator UDID/name 指向 `ios-simulator`；ADB serial 指向 `android-device`。
4. 仍无法唯一确定时询问用户。

不要因为当前机器缺少 Xcode 或 ADB 而自动切换平台。如果用户给出多个可能的 App 来源或多个目标设备，先让用户选择。

## 工作流

1. 盘点 H5 URL、完整 deeplink、App 名称、平台、安装包、已安装 App 标识和目标设备。
2. 读取 `references/apps.md`，按 App 名称/别名和平台选择唯一配置。完整 deeplink 原样使用；H5 URL 按模板替换：`{encodedUrl}` 使用完整 URL 编码，`{url}` 使用原始 URL，`XXXX` 视为 `{encodedUrl}`。
3. 用户没有提供本地来源且 App 尚未安装时，读取 `references/cooper-packages.md` 并按平台获取安装包。Cooper 不可用或仍无法唯一选择文件时停止，不要猜测。
4. `ios-simulator`：读取 `references/ios-simulator.md`，运行 `scripts/open_h5_in_ios_simulator.py`。
5. `android-device`：读取 `references/android-device.md`，运行 `scripts/open_h5_on_android_device.py`。
6. 打开失败时报告原始命令结果和实际 deeplink。除非用户明确要求，不要改走手动 UI 导航。
7. 报告平台、设备名称/标识、App 来源、bundle ID/package name、H5 URL、实际 deeplink、脚本执行动作和所有假设。App 来自 Cooper 时报告目录与文件名，但不要报告临时签名 URL。

## 首次启动与登录

首次安装或启动可能出现用户协议、隐私说明、权限、跟踪授权或 OEM 安装确认，并截断第一次 deeplink。说明这一可能性；用户完成必要引导后，重新发送同一 deeplink。

页面依赖登录态且被登录页拦截时，提示用户使用测试账号或自行完成登录。登录 UI 操作不属于本 Skill；只有用户明确要求时才交给合适的 UI 操作能力，登录完成后再发送同一 deeplink。

## 约束

- 不启动或管理 H5 dev server，除非用户明确要求。
- 不检查页面是否正确，不点击 App UI，不断言渲染文本，不调试 WebView 内部。
- 不修改 App 工程，除非用户明确要求构建或修改。
- 不支持 iOS 真机、Android Emulator、`.ipa`、`.aab`、`.apks` 或拆分 APK。
- 不把 secret、登录 token 或私密 query 参数写入 `references/apps.md` 等可复用配置。
- 不在日志、结果、脚本或 reference 中记录测试账号和密码；凭据只用于用户明确授权的当前任务。
- 不自动安装/更新 Xcode、Android Studio、ADB 或其他系统工具。
