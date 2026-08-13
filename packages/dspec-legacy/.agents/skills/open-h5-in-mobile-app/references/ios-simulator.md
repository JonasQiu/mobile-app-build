# iOS Simulator

## 输入与环境

使用以下一种 App 来源：simulator `.app`、包含一个 simulator `.app` 的 ZIP、Xcode project/workspace 加 scheme，或已安装 App 的 bundle ID。

要求安装完整 Xcode 和 iOS Simulator runtime。只有 Command Line Tools 不够；缺失时提示安装 Xcode，或切换到 `/Applications/Xcode.app/Contents/Developer`。

不要接受 `.ipa`。普通分发 ipa 是真机产物，不能安装到 Simulator；要求 `*-iphonesimulator` 构建的 `.app`、包含它的 ZIP，或 Xcode 工程。

## 执行

默认运行：

```bash
python3 <skill-root>/scripts/open_h5_in_ios_simulator.py \
  --app /path/to/App.app \
  --app-name 滴滴车主 \
  --h5-url https://example.com
```

- ZIP 使用 `--app-archive /path/to/package.zip`，不要猜测内部 `.app` 路径。
- 已安装 App 使用 `--bundle-id <bundle-id>`。
- 指定 Simulator 使用 `--simulator <udid-or-name>`。
- Xcode 工程先用普通 `xcodebuild` 产出 simulator `.app`，再调用脚本。
- 脚本比较 bundle ID、短版本和 build 号；相同时跳过安装，`--force-install` 可强制安装。
- 恰好一个已启动 iPhone Simulator 时自动选择；多个已启动设备时要求用户指定；没有已启动设备时选择满足 MinimumOSVersion 的最新可用 iPhone Simulator。
- 默认把 Simulator.app 拉到前台；用户明确不需要时传 `--no-show-simulator`。

首次安装或启动可能被用户协议、隐私说明或权限引导截断。用户完成必要引导后，重新发送同一 deeplink。
