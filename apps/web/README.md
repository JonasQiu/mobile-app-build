# Mobile Build Web

移动端控制站，负责 ChatGPT 登录、需求与历史记录、任务派发、Runner 状态同步、实时进度/message 和交付 URL 展示。它不执行 Codex、文件写入、依赖安装或构建。

## 用户能力

- 输入完整需求并创建项目。
- 从历史列表点击进入任一项目详情，并删除非进行中记录。
- 查看六阶段进度、百分比、当前 message 和最近事件，包括 Codex 生成与构建修复详情。
- 执行中每 15 秒刷新一次服务端可信状态。
- 共享 Runner 全站最多 2 个进行中任务，并发限制由服务端原子门禁执行。
- 交付完成后从详情打开独立 HTTPS 页面。
- 失败项目显示真实失败信息；“继续”或对应单步会沿用 Runner 保存的失败上下文续修，“重跑”才清空并从头执行。
- 已成功的单步点击不会重新构建；已有交付检查点时保留原交付 URL。
- Runner 临时入口经服务端身份与健康检查后登记到 D1；连接错误时展示“修复连接”，从本机 Runner 自动换址后重派原任务。

## 安全边界

- 浏览器只能创建项目和请求派发任务。
- 首页与业务 API 必须存在 Sites 注入的 ChatGPT 用户身份；稳定用户 ID 映射为 D1 所有者，所有项目和产物查询按所有者隔离。
- ChatGPT 账号仅用于认证，不提供模型或构建能力；Codex、Runner、构建和部署均使用平台统一配置。
- `PATCH /api/projects` 始终拒绝客户端写入终态。
- 控制站服务端使用 `CODEX_RUNNER_TOKEN` 拉取 Runner 状态。
- 只有 `mobileSpecPassed`、`buildPassed`、`deployPassed` 和外部 HTTPS URL 同时有效，D1 才记录 `delivered`。
- 站内 `/preview`、localhost 和控制站自身域名都不能作为交付 URL。

## 技术形态

- Next.js App Router 风格页面与 Route Handlers。
- vinext / Vite 输出 Cloudflare Workers 兼容产物。
- Cloudflare D1 保存 users 和 projects；sessions 仅为旧表兼容保留。
- `.openai/hosting.json` 记录 Sites project 与逻辑 `DB` binding。
- OpenAI Sites 公开入口 + 调度层托管的 Sign in with ChatGPT；匿名访问在页面和 API 两层被拒绝。

## 运行与验证

要求 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
npm run build
npm run lint
node --test tests/*.test.mjs
```

常用环境变量：

| 变量 | 用途 |
|---|---|
| `CODEX_RUNNER_URL` | Runner 的 HTTPS `/jobs` 冷启动回退地址；D1 已验证地址优先 |
| `CODEX_RUNNER_TOKEN` | 控制站调用 Runner 的 Bearer token |
| `RUNNER_CALLBACK_TOKEN` | 兼容可信回调接口；当前线上主要使用主动拉取 |
| `SITE_OWNER_EMAIL` | 将原站点所有者的 ChatGPT 邮箱映射到旧用户主键，保留既有历史项目 |

配套文档：

- [文档中心](../../docs/文档中心.md)
- [API 与事件协议](../../docs/API与事件协议.md)
- [开发、验证与部署手册](../../docs/开发验证与部署手册.md)
