# Android 真机

## 输入与环境

使用以下一种 App 来源：单个 `.apk`，或已安装 App 的 package name。第一版不接受 `.aab`、`.apks`、拆分 APK，也不支持 Android Emulator。

要求安装 Android SDK Platform-Tools，并在真机上启用开发者选项和 USB 调试。设备必须处于 `device` 状态；`unauthorized`、`offline`、多个真机或仅有 Emulator 时停止并说明。

ADB 选择顺序：

1. 用户显式传入的 `--adb`。
2. `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`。
3. 当前目录或父目录 `local.properties` 中的 `sdk.dir`。
4. macOS Android Studio 保存的 SDK 目录。
5. macOS/Android 常见 SDK 目录。
6. `PATH` 中的 `adb`。

整个流程只使用选中的同一个 ADB，并在结果中报告完整路径和版本。不要自动安装或更新 ADB。

## 执行

默认运行：

```bash
python3 <skill-root>/scripts/open_h5_on_android_device.py \
  --apk /path/to/app.apk \
  --app-name 滴滴车主 \
  --h5-url https://example.com
```

- 指定真机使用 `--device <adb-serial>`。
- 已安装 App 使用 `--package-name <package-name>`，不传 `--apk`。
- 指定 ADB 使用 `--adb /path/to/adb`。
- 有 APK 时默认执行 `adb install -r -t`，保留 App 数据并允许 testOnly 开发包。
- 只有用户明确确认降级时才传 `--allow-downgrade`，对应 `adb install -d`。
- 不默认使用 `-g` 授予全部运行时权限。
- 签名不一致时停止，不自动卸载旧 App，避免清空登录态。
- 提供 APK 时始终覆盖安装；Android 开发包可能在内容变化后仍使用相同 versionCode，不能仅按版本跳过。
- 使用限定 package 的 `ACTION_VIEW` + `BROWSABLE` Intent 打开 deeplink，避免误开到浏览器或其他 App。

脚本优先用 `apkanalyzer`，其次用 `aapt` 读取 APK 元数据；工具都不可用时使用 `--package-name` 或 `references/apps.md` 中的配置。

首次安装可能被用户协议、隐私说明、权限或 OEM 的“通过 USB 安装”提示截断。用户完成必要引导后，重新发送同一 deeplink。
