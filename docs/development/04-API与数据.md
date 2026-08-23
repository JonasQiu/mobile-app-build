# API 与数据

本文只保留开发时最常用的接口和数据约束。完整请求体、响应示例与错误语义见 [API 与事件协议](../API与事件协议.md)。

## 1. 连接关系

| 调用方 | 被调用方 | 鉴权 |
|---|---|---|
| 浏览器 | Web 控制面 | Sites 托管的 ChatGPT 登录身份 |
| Web 控制面 | D1 | Worker `env.DB` binding |
| Web 控制面 | Runner | `CODEX_RUNNER_TOKEN` Bearer Token |
| Runner | Web 回调/登记 API | `RUNNER_CALLBACK_TOKEN`，受限站点还需 Sites 外层授权 |
| 浏览器 | 本机 Runner 恢复接口 | 严格 Origin 与 Private Network CORS，仅用于人工修复连接 |

Runner Token 不得返回浏览器。

## 2. 控制面 API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/auth/session` | 获取当前 ChatGPT 用户会话 |
| `GET` | `/api/projects` | 查询当前用户项目并同步 Runner 状态 |
| `POST` | `/api/projects` | 保存完整需求并创建 queued 项目 |
| `DELETE` | `/api/projects/{projectId}` | 删除当前用户的非进行中项目 |
| `POST` | `/api/v1/projects/{projectId}/jobs` | 派发 continue、rerun 或 step |
| `POST` | `/api/v1/projects/{projectId}/pause` | 请求 Runner 真实暂停 |
| `GET` | `/api/v1/projects/{projectId}/artifacts/{stage}` | 代理读取阶段产物 |
| `POST` | `/api/v1/projects/{projectId}/preview-approval` | 校验并保存预览方案确认 |
| `POST/GET` | `/api/v1/projects/{projectId}/delivery` | Runner 回调或可信需求读取 |
| `GET/POST` | `/api/v1/runner/recover` | 查询或人工恢复 Runner 连接 |
| `POST` | `/api/v1/runner/register` | Runner 自动登记新 Endpoint |

`PATCH /api/projects` 固定返回 403，用于阻止浏览器伪造交付终态。

## 3. Runner API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/health` | 检查 Runner 和 Deployment Provider 配置 |
| `POST` | `/jobs` | 创建异步任务，`projectId` 为幂等键 |
| `GET` | `/jobs/{projectId}` | 查询 job、阶段、进度、消息、事件和 evidence |
| `POST` | `/jobs/{projectId}/pause` | 中断 queued/running job |
| `POST` | `/jobs/{projectId}/artifacts/{stage}` | 使用原始需求哈希读取可信产物 |
| `POST` | `/control-endpoint/rotate` | 本机创建新的 Runner 控制 Tunnel |

任务创建的核心字段：

```json
{
  "projectId": "prj_...",
  "requirement": "完整原始需求",
  "callbackUrl": "https://control.example/api/v1/projects/prj_.../delivery",
  "mode": "continue",
  "targetStage": null,
  "previousDeliveryUrl": null,
  "approvedPreviewId": null,
  "regeneratePreview": false
}
```

## 4. D1 表

| 表 | 用途 |
|---|---|
| `users` | 稳定 ChatGPT 身份到站内用户的映射 |
| `sessions` | 旧本地会话兼容表，当前认证不读取 |
| `projects` | 需求、项目状态、当前阶段和交付 URL |
| `project_preview_approvals` | 当前 preview set、pending/approved 和 selected preview |
| `runner_endpoints` | 最新验证通过的 Runner 地址、实例 ID 和登记时间 |

Schema 定义在 `apps/web/db/schema.ts`，migration 位于 `apps/web/drizzle/`。运行时兼容建表位于 `apps/web/app/lib/server-auth.ts`；当前阶段修改表结构时三处必须保持一致。

## 5. 存储边界

| 数据 | 当前位置 |
|---|---|
| 项目终态和 URL | D1 |
| 预览审批事实 | D1 |
| 当前 job、progress、message、events | Runner 内存 |
| Mobile Spec、SVG、Manifest、构建日志、部署 evidence | Runner 本地工作区 |

预览 SVG 不写入 D1，D1 只保存审批事实。Runner job 也未持久化，因此 Runner 重启后需要重新派发，但需求哈希一致时可以复用本地成功检查点。

## 6. 必须保持的不变量

- 所有项目、审批和产物操作都绑定当前用户所有权；
- `projectId` 同时是控制面项目键和 Runner 幂等键；
- 只有服务端可以写入 `delivered`、evidence 和 URL；
- 预览确认必须属于当前需求和当前 preview set；
- delivered URL 必须是外部 HTTPS，且不能是 localhost、控制站自身或 `/preview`；
- Runner Endpoint 必须通过公网健康和实例身份验证后才能写入 D1；
- Secret 不进入 D1 业务表、事件 payload、产物或日志。

## 7. 修改协议时的同步项

1. 修改控制面 Route Handler 与 Runner 实现；
2. 更新 Web 和 Runner 契约测试；
3. 更新 [API 与事件协议](../API与事件协议.md)；
4. 如果涉及 Schema，生成并检查 migration；
5. 如果涉及 UI 状态，同步更新 [执行工作流](03-执行工作流.md) 和产品说明；
6. 运行文档检查，确认没有断链和敏感值。
