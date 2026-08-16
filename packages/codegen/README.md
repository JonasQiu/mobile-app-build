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
7. 由 DeploymentProvider 发布，使用外部 HTTPS URL 做健康检查；系统 DNS 未同步时以公共 DNS 解析结果验证同一 URL，临时地址仍不可用时只更换部署隧道，不重新生成或构建。
8. 仅当三项 evidence 为真时返回 `delivered`。

运行中的 job 可通过受鉴权的暂停接口中断；Runner 会把中断信号传递到 Mobile Spec、Codex/OpenAI、npm、构建、隧道和健康检查。每个成功阶段都会写入绑定需求哈希的本地检查点。“继续”从首个未完成阶段或其失败位置开始，“重跑”清除检查点并从头执行；`step + targetStage` 对成功阶段直接复用，对失败阶段原地续修。

不存在 Mobile Spec 跳过、业务主题示例兜底、localhost 交付或站内假预览。

## Runner API

- `GET /health`：Provider 和部署配置健康状态。
- `POST /jobs`：提交异步任务，需要 Bearer token。
- `GET /jobs/{projectId}`：读取 `status`、`stage`、`progress`、`message`、最近 `events`、错误或交付证据。
- `POST /jobs/{projectId}/pause`：暂停 `queued/running` job，幂等返回 `paused`。
- `POST /jobs/{projectId}/artifacts/{stage}`：服务端携带原始需求读取受信任步骤产物；不直接暴露给浏览器。

状态中的事件只保留最近 24 条且当前为内存数据；Codex 生成、结构化结果、文件校验写入、构建修复与部署节点都有明确 message。正式 Cloud Runner 应持久化到控制面事件库。

Manifest 规范化会确定性合并重复的导航 href；若合并后不足 4 个不同路由或其他结构约束不通过，Runner 会把真实校验错误反馈给 Codex，最多重新生成三次，而不是在第一次重复路由时直接终止任务。

失败上下文写入需求哈希绑定的 `.mobile-build-repair.json`。实现失败会把结构校验或写入错误交回 Codex；构建失败会把真实构建日志交回 Codex。下一次继续或构建单步从该诊断开始修复，不先重复一次已知失败的构建。新 manifest 记录 `generatedFiles`，定向修复时删除旧清单中已移除的文件，避免遗留路由再次触发重复 route。

Runner 会分别校验 Mobile Spec、实现、构建、部署检查点；继续执行时跳过所有已成功阶段。Mobile Spec 另用 `mobile-spec-progress.json` 保存 propose/design/task 成功前缀、尝试次数和最近 gate 错误，失败后只重做当前子阶段。升级前工作区若包含需求一致的完整规格、manifest 和生产构建，会自动补写 marker，不触发重复构建。规格步骤保存五份 Markdown 文档，实现保存 manifest，构建保存真实日志，部署保存 URL 与健康检查证据。单步执行实现、构建或部署时，前置检查点缺失会明确失败。

启用 `CODEGEN_AUTO_PUBLIC_TUNNEL=1` 后，Runner 会为自身控制 API 建立公网入口，控制隧道退出会自动重建。本机恢复接口 `POST /control-endpoint/rotate` 只接受 `CODEGEN_CONTROL_PLANE_URL` 对应的浏览器 Origin，并支持 Private Network Access 预检；它轮换隧道并返回新 `/jobs` 地址与 Runner 实例编号，由控制面完成公网身份和健康检查后登记。该机制只解决 Runner 临时入口漂移，不会把 Quick Tunnel 变成具有 SLA 的生产服务。

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
| `CODEGEN_CONTROL_PLANE_URL` | 无 | 本机恢复接口允许的控制站 Origin |
| `CODEGEN_AUTO_PUBLIC_TUNNEL` | 未设置 | `1` 时自动维护 Runner 自身的公网控制隧道 |
| `CODEGEN_TIMEOUT_MS` | `600000` | 一次完整生成超时 |
| `CODEGEN_DEPLOYMENT_HEALTH_TIMEOUT_MS` | `120000` | 公网部署健康检查总等待时间；由多个临时部署地址共享 |
| `CODEGEN_DEPLOYMENT_TUNNEL_ATTEMPTS` | `3` | 总时限内最多创建的临时部署地址数，范围 1–5 |
| `CODEGEN_PUBLIC_DNS_SERVERS` | `1.1.1.1,8.8.8.8` | 系统 DNS 无法解析新部署域名时使用的公共 DNS 服务器 |
| `CODEGEN_DISABLE_CALLBACK` | 未设置 | `1` 时由控制站主动拉取状态 |
| `CODEGEN_DEPLOYMENT_PROVIDER` | 无 | 部署 Provider；当前验收值可为 `cloudflare-quick-tunnel` |
| `CODEGEN_TUNNEL_BIN` | 无 | Quick Tunnel 使用的 `cloudflared` 路径 |
| `CODEGEN_HEALTHCHECK_BIN` | 无 | 可选系统级健康检查命令（当前使用 curl）；DNS、连接与 HTTP 失败会进入 Runner 实时消息，公共 DNS 仍无法通过时自动换址 |

## CLI 与测试

```bash
OPENAI_API_KEY=... node bin/generate.mjs "做一个社区咖啡店官网" --out /tmp/coffee-site
npm test
```

`--serve` 与内部 localhost 只用于本地检查，不能作为最终交付地址。

## macOS 常驻服务

开发验收机可将 Runner 注册为当前用户的 LaunchAgent，使 Codex 会话结束或 Runner 异常退出后自动恢复：

```bash
packages/codegen/scripts/install-runner-service.sh /tmp/mobile-build-runner.env
```

安装器会把环境文件以 `0600` 权限保存到用户配置目录，把 `cloudflared` 复制到稳定位置，并创建 `com.siteforge.runner` 常驻服务。LaunchAgent 的 `PATH` 会显式包含当前 Node/npm 目录，构建器也会优先使用 `process.execPath` 同目录的 npm，避免服务环境出现 `spawn npm ENOENT`。密钥和二进制均不会提交到 Git。电脑重启后 Runner 会自动启动；如果 Quick Tunnel 地址变化，页面点击“修复连接”即可从本机 Runner 取得并登记新地址。

Runner 会区分页面代码错误和执行环境错误。npm 无法启动时不会调用 Codex 修改页面；环境恢复后直接重试 `npm ci`，并复用已成功的 Mobile Spec 与实现检查点。
