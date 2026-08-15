# Mobile Build

Mobile Build 是一个移动端网站生成控制台：用户输入一句完整需求，系统通过受信任 Runner 执行 **需求 → Codex → Mobile Spec → 页面实现 → 生产构建 → 部署 → HTTPS URL**。

当前版本已经移除关键词模板、健身示例项目、前端计时假进度、示例日志和站内 `/preview` 伪交付。执行页每 15 秒同步 Runner 真实消息，运行中的任务可暂停；同一对话会复用成功步骤，失败步骤保留错误与子阶段进度并原地修复，只有“重跑”才清除检查点。规格、实现、构建、部署支持单步执行，各步骤产物可独立查看，Markdown 文档直接渲染预览。历史记录支持删除，每用户最多同时执行 2 个需求。只有 Mobile Spec、生产构建、部署和公网健康检查全部通过，项目才进入 `delivered`。

## 当前链路

```text
Mobile Web（OpenAI Sites + D1）
  -> POST /api/v1/projects/{projectId}/jobs
  -> Trusted Node Runner
       -> Codex CLI 或 OpenAI API Structured Outputs
       -> Mobile Spec Proposal / Specs / Design / Review / Tasks 门禁
       -> 中立 Next.js 模板 + requirement-specific SiteManifest
       -> npm ci + next build（失败最多修复三轮）
       -> DeploymentProvider + HTTPS health check
  <- GET /api/projects 主动同步 Runner progress / message / evidence
  -> 历史项目详情与独立交付 URL
```

## 已实现

- MVP 账号登录、7 天 HttpOnly 会话和 D1 项目持久化。
- 完整原始需求保存，不做关键词分类或固定业务模板匹配。
- 历史记录点击进入项目详情，恢复需求、状态、消息和交付入口。
- 六阶段实时进度：需求、Mobile Spec、Codex、构建、部署、完成。
- Runner 百分比、当前 message 与最近消息流，每 15 秒由服务端可信同步；外层访问策略阻断主动回调时，失败/暂停记录也会从 Runner 终态自动校正。
- 输入框上方提供“继续、重跑、规格、实现、构建、部署”快捷按钮；成功单步直接复用，失败单步从该步骤的失败位置续修。
- 真实暂停会向 Runner 发送中断信号并终止当前 Codex、Mobile Spec、安装、构建或健康检查子进程。
- 成功步骤写入需求哈希检查点；Mobile Spec 额外记录 Proposal、Design、Tasks 子阶段，Codex/构建记录最近诊断。“继续”从首个未完成或失败位置开始，“重跑”清除旧检查点并完整执行。升级前已有的完整规格、manifest 和生产构建会在首次读取时自动迁移为检查点。
- Mobile Spec 的 Proposal、Spec、Design、Review、Tasks 以 Markdown 预览；实现清单、构建日志和部署证据也按步骤查看。
- Mobile Spec 是硬门禁；缺少 artifacts 或 gate 失败时停止。
- `npm ci`、`next build`、跨任务保留真实错误日志的 Codex 定向修复，以及外部 HTTPS 健康检查；Quick Tunnel 使用 HTTP/2，系统 DNS 未同步时以公共 DNS 结果完成同一 URL 的 HTTPS 验证，地址或连接仍不可用时在总时限内自动换址，不重跑已成功的规格、实现和构建。修复 manifest 时会清理旧清单遗留的路由文件。
- 客户端无权把项目标记为已交付或写入 URL。

## 当前边界

- 线上控制站托管在 OpenAI Sites：<https://mobile-app-build-mvp.long229260097.chatgpt.site>。
- 当前 Runner 是本机常驻 Node 进程，通过鉴权 HTTPS 入口供控制站调用；不是长期 Cloud Runner。
- 当前生成站点使用 Cloudflare Quick Tunnel，仅适合开发和验收，无持久 URL 与 SLA；不得作为生产托管宣传。
- Runner job、progress 和 message 当前保存在 Runner 内存；成功检查点和产物保存在 Runner 工作区。Runner 重启后可复用已成功阶段，但执行中消息与进程不能恢复。
- 共享 artifact store、ZIP 下载、取消、持久事件库、跨 Runner 接管和正式部署 Provider 尚未实现。
- `@mobile-app-build/mobile-spec` 是仓库自研的规格工作流；当前 Web 链路已投入使用，原生平台能力仍在持续完善。

## 目录

- `apps/web/`：移动端控制站、认证、项目 API、历史详情与实时执行 UI。
- `packages/codegen/`：受信任 Node Runner、Codex/OpenAI Provider、Mobile Spec、生成、构建和部署检查。
- `templates/next-web/`：中立 Next.js 生成模板。
- `packages/mobile-spec/`：自研 Mobile Spec 工作流、门禁、Schema 与阶段 Skills。
- `docs/`：产品、架构、协议、数据、安全、部署和路线图文档。

## 本地开发

Web 和 Runner 是两个进程。Web 运行在 Cloudflare Workers 兼容环境，不能直接创建文件或启动构建进程。

```bash
cd apps/web
npm ci
npm run dev
```

```bash
cd packages/codegen
npm ci
CODEX_RUNNER_TOKEN=... \
RUNNER_CALLBACK_TOKEN=... \
CODEX_BIN=/path/to/codex \
CODEGEN_RUNNER_PORT=5174 \
node runner.mjs
```

也可配置 `OPENAI_API_KEY`，让结构化生成直接使用 OpenAI API。部署必须额外配置真实 `DeploymentProvider`；localhost 永远不能写入交付 URL。

## 验证

```bash
cd apps/web
npm run build
npm run lint
node --test tests/*.test.mjs

cd ../../packages/codegen
npm test
```

完整入口见 [文档中心](docs/文档中心.md)。
