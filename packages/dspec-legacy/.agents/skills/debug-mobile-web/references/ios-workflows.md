# iOS 调试工作流

## 目录

1. [发现 Device 与 Target](#发现-device-与-target)
2. [单次只读诊断](#单次只读诊断)
3. [显式 Session](#显式-session)
4. [Console 与 Network](#console-与-network)
5. [失败响应体](#失败响应体)
6. [Reload 与截图](#reload-与截图)
7. [能力衔接](#能力衔接)

## 发现 Device 与 Target

```bash
weblens devices --json
weblens targets --device <device-id> --json
```

- Simulator：选择符合用户意图的 booted iPhone Simulator。
- 真机：只选择用户明确连接的 USB Device，并保持设备解锁。
- 多个 Device 或 Target 均可能正确时，展示脱敏候选并请求选择。
- 按 App、title、URL 匹配意图，但不把 title/URL 当作连续性证明。
- Target reference 有 TTL；发现后立即执行命令或 attach。

真机首次连接或发现异常时补充：

```bash
weblens doctor --device <device-id> --json
```

## 单次只读诊断

仅需一个结果时使用 `--target`，CLI 会创建并清理隐式临时 Session：

```bash
weblens capabilities --target <target-id> --json
weblens eval --target <target-id> --expression 'document.title' --json
weblens query --target <target-id> --selector '#status' --json
weblens dom --target <target-id> --depth 3 --json
weblens storage --target <target-id> --type local --json
weblens screenshot --target <target-id> --json
```

Storage 默认只取 key，确需值时才增加 `--include-values`。长或敏感表达式使用
`--expression-file` 或 stdin；默认只执行无副作用表达式。

## 显式 Session

两个以上动作、跨用户操作取证或事件采集使用 Session。先检查冲突：

```bash
weblens sessions --json
weblens attach --target <target-id> --ttl 15m --json
```

从 `data.debugSession.id` 读取 Session ID，并以 attach 返回的 capabilities
作为初始能力快照；不要无理由立即重复探测。后续命令统一使用
`--session <session-id>`：

```bash
weblens query --session <session-id> --selector '#status' --json
weblens storage --session <session-id> --type session --json
```

任务结束或后续命令失败时都执行：

```bash
weblens detach --session <session-id> --json
```

## Console 与 Network

在需要捕获的操作发生前启用所需事件域：

```bash
weblens attach \
  --target <target-id> \
  --console \
  --network \
  --ttl 15m \
  --json
```

先建立事件基线：

```bash
weblens session events \
  --session <session-id> \
  --after 0 \
  --json
```

保存 `data.cursor.nextAfter`。复现后读取新增事件：

```bash
weblens session events \
  --session <session-id> \
  --after <next-after> \
  --wait 5s \
  --json
```

每次推进到最新 `nextAfter`。`cursor.gap: true` 时报告缓存缺口，不把当前事件
称为完整记录。

## 失败响应体

只在任务需要时，于复现前启用 error body policy：

```bash
weblens attach \
  --target <target-id> \
  --network \
  --response-bodies errors \
  --ttl 15m \
  --json
```

从该 Session 的失败 Network response 事件取得 Request ID，再读取：

```bash
weblens response-body \
  --session <session-id> \
  --request <request-id> \
  --json
```

不能在 `none` policy 后事后读取，也不能跨 Session 或 Target generation 复用
Request ID。大响应只使用 CLI 摘要或受控 Artifact。

## Reload 与截图

```bash
weblens reload --session <session-id> --json
weblens screenshot --session <session-id> --json
```

reload、导航或页面替换会推进 Target generation，并使旧 Node、Remote
Object 和 Request ID 失效；重新 query/dom/eval。Session 失败或
`TARGET_STALE` 时重新运行 `targets`，不按相似 URL 自动重连。

截图是 Web 内容的 node/page snapshot，不是原生 App 全屏截图。报告 CLI
返回的 scope、格式、尺寸和 Artifact 路径。

## 能力衔接

- Simulator 页面尚未打开：先使用 `$open-h5-in-mobile-app`。
- 原生登录、导航或控件操作：在用户授权范围内使用合适的 UI 自动化能力，
  并在操作前让 WebLens Session ready。
- 真机：让用户把可检查页面置于前台；本 Skill 不启动 Safari 或 App。
- 前端修复：先交付调试证据，只有用户要求修改代码时再变更源码。
