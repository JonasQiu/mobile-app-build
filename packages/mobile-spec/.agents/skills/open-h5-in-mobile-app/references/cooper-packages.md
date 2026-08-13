# Cooper 安装包

只有用户未指定本地安装包或已安装 App 时，才从 Cooper 获取安装包。先确认当前环境存在 Cooper MCP 团队空间目录和文件下载能力；不可用时请求用户提供本地安装包，不要通过浏览器抓取团队空间。

## 安装包位置

团队空间：

- 首页：`https://cooper.didichuxing.com/team-file/2208772493025/home`
- `spaceId`：`2208772493025`

滴滴车主：

- iOS Simulator：从空间根目录进入 `/滴滴车主/iOS/`，只考虑包含 simulator `.app` 的 `.zip`。
- Android 真机：使用目录 `https://cooper.didichuxing.com/team-file/2208772493025/2209099200995`，只考虑单个 `.apk`。
- Android 目录标识：`2209099200995`。先根据当前 Cooper MCP 的工具参数做一次只读目录查询；如果该标识不能直接作为父目录参数，则从 `parentId=0` 遍历并用目录链接核对，不要猜测参数语义。

## 文件选择

1. 按目标平台过滤扩展名：iOS 只选 `.zip`，Android 只选 `.apk`。不要选择 `.ipa`、`.aab`、`.apks` 或拆分 APK。
2. 从扩展名前、由 `-` 或 `_` 分隔的点分数字版本提取版本，例如 `DiSpecialDriver-9.3.10.70916521.zip` 中的 `9.3.10.70916521`。
3. 按整数分段比较版本并选择最高版本，不要按字符串或 `modify_time` 判断版本新旧。
4. 最高版本对应多个文件时，选择 `modify_time` 最新的一个并说明。
5. 文件名无法识别版本时：目录中只有一个候选文件则使用；有多个候选文件则列出名称并让用户选择。
6. `*-default` 只做兜底，不参与版本排序。只有不存在可识别版本的文件时才使用唯一的 default；多个 default 时让用户选择。

## 下载与交付

1. 调用 Cooper 文件下载能力取得临时签名 URL，并下载到临时目录。
2. 不要在回复、日志、脚本或可复用配置中输出或持久化签名 URL。
3. iOS ZIP 直接传给 `open_h5_in_ios_simulator.py --app-archive <path>`；脚本负责安全解压和 simulator 平台校验。
4. Android APK 直接传给 `open_h5_on_android_device.py --apk <path>`；不要先解压 APK。
5. 使用结束后删除临时下载文件和解压目录。
