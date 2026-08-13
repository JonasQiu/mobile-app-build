# Mobile Build Web

移动端控制站，负责登录、需求与历史记录、任务派发、Runner 状态同步、实时进度/message 和交付 URL 展示。它不执行 Codex、文件写入、依赖安装或构建。

## 用户能力

- 输入完整需求并创建项目。
- 从历史列表点击进入任一项目详情，并删除非进行中记录。
- 查看六阶段进度、百分比、当前 message 和最近事件，包括 Codex 生成与构建修复详情。
- 执行中每 15 秒刷新一次服务端可信状态。
- 每个用户最多 2 个进行中任务，并发限制由服务端原子门禁执行。
- 交付完成后从详情打开独立 HTTPS 页面。
- 失败项目显示真实失败信息并允许重新执行。

## 安全边界

- 浏览器只能创建项目和请求派发任务。
- `PATCH /api/projects` 始终拒绝客户端写入终态。
- 控制站服务端使用 `CODEX_RUNNER_TOKEN` 拉取 Runner 状态。
- 只有 `mobileSpecPassed`、`buildPassed`、`deployPassed` 和外部 HTTPS URL 同时有效，D1 才记录 `delivered`。
- 站内 `/preview`、localhost 和控制站自身域名都不能作为交付 URL。

## 技术形态

- Next.js App Router 风格页面与 Route Handlers。
- vinext / Vite 输出 Cloudflare Workers 兼容产物。
- Cloudflare D1 保存 users、sessions 和 projects。
- `.openai/hosting.json` 记录 Sites project 与逻辑 `DB` binding。
- OpenAI Sites 外层访问控制 + 应用内 MVP Session。

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
| `CODEX_RUNNER_URL` | Runner 的 HTTPS `/jobs` 地址 |
| `CODEX_RUNNER_TOKEN` | 控制站调用 Runner 的 Bearer token |
| `RUNNER_CALLBACK_TOKEN` | 兼容可信回调接口；当前线上主要使用主动拉取 |

配套文档：

- [文档中心](../../docs/文档中心.md)
- [API 与事件协议](../../docs/API与事件协议.md)
- [开发、验证与部署手册](../../docs/开发验证与部署手册.md)
