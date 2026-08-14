# @mobile-app-build/codegen

受信任 Node Runner：**需求 → Codex/OpenAI → Mobile Spec → Next.js 源码 → 可复现构建 → DeploymentProvider → HTTPS 健康检查**。

Runner 必须运行在具备文件系统、子进程和外网能力的独立环境中，不能嵌入 `apps/web` 的 Cloudflare Worker。

## 执行顺序

1. 鉴权接收 `POST /jobs`，按 `projectId` 幂等入队。
2. 创建隔离 Mobile Spec 工作区。
3. 生成并门禁验证 Proposal、Specs、Design、Review、Tasks。
4. 调用本机已登录 Codex CLI，或使用 `OPENAI_API_KEY` 调用 Structured Outputs。
5. 从中立模板写入 requirement-specific `SiteManifest` 与 `mobile-build-manifest.json`。
6. 执行 `npm ci --no-audit --no-fund` 和 `npm run build`；失败日志最多触发三轮修复。
7. 由 DeploymentProvider 发布，使用外部 HTTPS URL 做健康检查。
8. 仅当三项 evidence 为真时返回 `delivered`。

运行中的 job 可通过受鉴权的暂停接口中断；Runner 会把中断信号传递到 Mobile Spec、Codex/OpenAI、npm、构建、隧道和健康检查。每个成功阶段都会写入绑定需求哈希的本地检查点。“继续”从首个未完成阶段开始，“重跑”清除检查点并从头执行；`step + targetStage` 只执行指定阶段并保存产物。

不存在 Mobile Spec 跳过、业务主题示例兜底、localhost 交付或站内假预览。

## Runner API

- `GET /health`：Provider 和部署配置健康状态。
- `POST /jobs`：提交异步任务，需要 Bearer token。
- `GET /jobs/{projectId}`：读取 `status`、`stage`、`progress`、`message`、最近 `events`、错误或交付证据。
- `POST /jobs/{projectId}/pause`：暂停 `queued/running` job，幂等返回 `paused`。
- `POST /jobs/{projectId}/artifacts/{stage}`：服务端携带原始需求读取受信任步骤产物；不直接暴露给浏览器。

状态中的事件只保留最近 24 条且当前为内存数据；Codex 生成、结构化结果、文件校验写入、构建修复与部署节点都有明确 message。正式 Cloud Runner 应持久化到控制面事件库。

Manifest 规范化会确定性合并重复的导航 href；若合并后不足 4 个不同路由或其他结构约束不通过，Runner 会把真实校验错误反馈给 Codex，最多重新生成三次，而不是在第一次重复路由时直接终止任务。

Runner 会分别校验 Mobile Spec、实现、构建、部署检查点；继续执行时跳过所有已成功阶段。规格步骤保存五份 Markdown 文档，实现保存 manifest，构建保存真实日志，部署保存 URL 与健康检查证据。单步执行实现、构建或部署时，前置检查点缺失会明确失败。

## 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `CODEX_RUNNER_TOKEN` | 无 | `/jobs` Bearer token |
| `RUNNER_CALLBACK_TOKEN` | 无 | 可选回调 token；即使禁用回调，当前 Runner 健康门禁仍要求配置 |
| `CODEX_BIN` | 无 | Codex CLI 绝对路径；没有 API Key 时使用 |
| `CODEX_WORKDIR` | 当前目录 | Codex 只读结构化调用工作目录 |
| `OPENAI_API_KEY` | 无 | 可选 OpenAI API Provider |
| `CODEGEN_MODEL` | `gpt-4o` | OpenAI Structured Outputs 模型 |
| `CODEX_MODEL` | Codex 默认 | Codex CLI 模型覆盖 |
| `CODEGEN_RUNNER_PORT` | `5174` | Runner 监听端口 |
| `CODEGEN_TIMEOUT_MS` | `600000` | 一次完整生成超时 |
| `CODEGEN_DEPLOYMENT_HEALTH_TIMEOUT_MS` | `120000` | 公网部署健康检查总等待时间；单次网络探测有独立超时并自动重试 |
| `CODEGEN_DISABLE_CALLBACK` | 未设置 | `1` 时由控制站主动拉取状态 |
| `CODEGEN_DEPLOYMENT_PROVIDER` | 无 | 部署 Provider；当前验收值可为 `cloudflare-quick-tunnel` |
| `CODEGEN_TUNNEL_BIN` | 无 | Quick Tunnel 使用的 `cloudflared` 路径 |
| `CODEGEN_HEALTHCHECK_BIN` | 无 | 可选系统级健康检查命令（当前使用 curl）；DNS、连接与 HTTP 失败会进入 Runner 实时消息 |

## CLI 与测试

```bash
OPENAI_API_KEY=... node bin/generate.mjs "做一个社区咖啡店官网" --out /tmp/coffee-site
npm test
```

`--serve` 与内部 localhost 只用于本地检查，不能作为最终交付地址。
