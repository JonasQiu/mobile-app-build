# App 配置

按 App 和平台分别维护标识与 debug deeplink。`{encodedUrl}` 表示完整 URL 编码后的 H5 URL，`{url}` 表示原始 H5 URL。

| App | Platform | 别名/关键词 | App 标识 | Deeplink 模板 | URL 处理 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 滴滴车主 | ios-simulator | unidriver, 司机端, 车主端 | — | `unidriver://web?url={encodedUrl}` | encode | bundle ID 从 simulator `.app` 读取；使用已安装 App 时由用户提供。 |
| 滴滴车主 | android-device | unidriver, 司机端, 车主端 | `com.sdu.didi.gsui` | `unidriver://web?url={encodedUrl}` | encode | Android Manifest 已声明 `unidriver` VIEW/BROWSABLE intent filter。 |

用户给出 `unidriver://web?url=XXXX` 时，将 `XXXX` 规范成 `{encodedUrl}` 后再替换。
