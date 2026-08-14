# API 与事件协议

## 1. 协议原则

- 浏览器只提交需求和启动任务，不能写入 `delivered` 或部署 URL。
- Runner API 只接受 Bearer token，状态读取也必须鉴权。
- `projectId` 同时是控制站项目和 Runner job 的幂等键。
- 当前用服务端轮询同步；未来 SSE/WebSocket 仍复用相同 job 字段。
- 错误文本可展示，但不得包含 Secret、完整系统路径或未经裁剪的模型输入。

## 2. 服务连接

控制面与执行面分离，服务之间全部通过 HTTPS + 凭证连接，无长连接：

```mermaid
flowchart LR
  B[Browser] -->|"Cookie Session"| W[Web Worker 控制面]
  W -->|"D1 binding (env.DB)"| D[(Cloudflare D1)]
  W -->|"Bearer CODEX_RUNNER_TOKEN"| R[Node Runner]
  R -->|"Bearer RUNNER_CALLBACK_TOKEN"| W
  R --> C[Codex CLI / OpenAI API]
  R --> P[DeploymentProvider]
```

| 连接 | 方式 | 说明 |
|---|---|---|
| 浏览器 → 控制面 | HttpOnly Cookie | 15 秒轮询 `GET /api/projects` 获取进度 |
| 控制面 → D1 | Worker binding | `env.DB` 直连，不走网络 |
| 控制面 → Runner | `CODEX_RUNNER_URL` + `CODEX_RUNNER_TOKEN` | 派发、暂停、拉取状态与读取阶段产物 |
| Runner → 控制面 | `RUNNER_CALLBACK_TOKEN` | 交付结果回调 `/api/v1/projects/{id}/delivery` |

三个环境变量（`CODEX_RUNNER_URL` / `CODEX_RUNNER_TOKEN` / `RUNNER_CALLBACK_TOKEN`）任一缺失时派发路由直接返回 `503 EXECUTOR_OFFLINE`，不会伪造任务。Runner token 永不下发给浏览器。

## 3. 控制站 API（当前实现）

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/api/auth/login` | 登录并创建 HttpOnly Session |
| `POST` | `/api/auth/logout` | 撤销当前 Session |
| `GET` | `/api/auth/session` | 读取当前用户 |
| `GET` | `/api/projects` | 查询项目，并为执行中项目同步 Runner 状态 |
| `POST` | `/api/projects` | 保存完整需求，创建 `queued` 项目 |
| `DELETE` | `/api/projects/{projectId}` | 删除当前用户的非进行中历史项目 |
| `PATCH` | `/api/projects` | 始终返回 `403`，禁止浏览器伪造终态 |
| `POST` | `/api/v1/projects/{projectId}/jobs` | 服务端派发受信任 Runner |
| `POST` | `/api/v1/projects/{projectId}/pause` | 校验项目所有权并要求 Runner 真实暂停 |
| `GET` | `/api/v1/projects/{projectId}/artifacts/{stage}` | 校验所有权后读取指定步骤产物 |
| `POST` | `/api/v1/projects/{projectId}/delivery` | 兼容 Runner 回调，需要 callback token |
| `GET` | `/api/v1/projects/{projectId}/delivery` | 受信任 Runner 或 Sites owner 读取项目需求 |

### `GET /api/projects` 项目结构

```json
{
  "id": "prj_...",
  "name": "创建一个咖啡馆官网",
  "prompt": "创建一个咖啡馆官网……",
  "status": "building",
  "currentStage": "mobile-spec",
  "previewUrl": null,
  "updatedAt": "2026-08-14T00:00:00Z",
  "executionProgress": 36,
  "executionMessage": "正在生成 Design 并执行设计评审",
  "executionEvents": [
    { "id": "...", "at": "2026-08-14T00:00:00Z", "stage": "mobile-spec", "kind": "progress", "progress": 4, "message": "任务已进入执行队列" }
  ],
  "executionCheckpoints": ["mobile-spec"]
}
```

`executionProgress`、`executionMessage`、`executionEvents`、`executionCheckpoints` 当前由控制站查询 Runner 后临时附加，不写入 projects 表。响应还包含 `executionCapacity: { active, max: 2 }`。项目状态、最后阶段与 URL 写入 D1。

当用户已有 2 个 `dispatching/building` 项目时，`POST /api/projects` 和 jobs 派发返回 `409 EXECUTION_LIMIT_REACHED`。jobs 路由使用单条条件 UPDATE 原子占用名额，防止并发请求绕过计数。

`DELETE /api/projects/{projectId}` 只删除当前用户拥有的记录；`dispatching/building` 项目返回 409，避免 Runner 继续执行但控制面记录消失。`ready/paused` 不占执行名额，可删除、继续、重跑或单步执行。

## 4. Runner API（当前实现）

### 健康检查

`GET /health`

```json
{ "ok": true, "deploymentProviderConfigured": true }
```

控制站在占用执行名额前先请求该接口，10 秒内不可达、返回非 JSON、`ok` 为 false 或未配置 DeploymentProvider 时直接返回 503，项目保持原状态。这样失效的 Runner 地址不会把项目卡在 `dispatching`。

### 创建任务

`POST /jobs`

Headers：

```text
Authorization: Bearer <CODEX_RUNNER_TOKEN>
Idempotency-Key: project-<projectId>
Content-Type: application/json
```

Body：

```json
{
  "projectId": "prj_...",
  "requirement": "完整原始需求",
  "instructions": "服务端执行约束",
  "callbackUrl": "https://control.example/api/v1/projects/prj_.../delivery",
  "mode": "continue",
  "targetStage": null
}
```

`mode` 可为 `continue | rerun | step`。`continue` 校验需求哈希并复用成功检查点；`rerun` 清除工作区后完整执行；`step` 必须指定 `mobile-spec | implementation | build | deployment` 之一，前置检查点不足时失败。返回 `202` 与异步 job；相同 `projectId` 正在运行时返回现有 job。已交付任务使用 `continue` 且 Runner 仍持有相同 job 时直接返回原交付，不重新构建。

兼容升级前工作区：若需求文件内容一致、五份规格文档完整、manifest 存在，并且 `.next/BUILD_ID` 与 Next 可执行文件存在，Runner 会一次性写入新 marker，把现有成功结果作为 Mobile Spec、implementation、build 检查点复用。

控制站只在收到 JSON 响应且 `job.id` 存在时把项目更新为 `building`。Runner 拒绝请求、返回非 JSON 或缺少任务编号时释放本次派发占位，并返回可诊断的错误码与 HTTP 状态。

### 查询任务

`GET /jobs/{projectId}`

```json
{
  "job": {
    "id": "job_...",
    "status": "running",
    "stage": "implementation",
    "progress": 64,
    "message": "Mobile Spec 已通过，Codex 正在实现页面",
    "checkpoints": ["mobile-spec"],
    "events": [
      { "id": "...", "at": "2026-08-14T00:00:00Z", "message": "Runner 已接收任务" }
    ],
    "updatedAt": "2026-08-14T00:00:00Z"
  }
}
```

终态成功还包含：

```json
{
  "status": "delivered",
  "stage": "delivered",
  "progress": 100,
  "url": "https://generated.example",
  "evidence": {
    "mobileSpecPassed": true,
    "buildPassed": true,
    "deployPassed": true
  }
}
```

失败包含 `status: "failed"`、`stage: "failed"` 和裁剪后的 `error`。

单步成功包含 `status: "checkpointed"`、指定 `stage` 和已完成的 `checkpoints`，控制面将项目写为 `ready`，不生成交付 URL。

若 Codex 返回重复 `navRoutes.href`，Runner 在 Manifest 规范化阶段保留第一项并去重；仍有至少 4 个不同路由时继续构建，不足 4 个或存在其他结构错误时把诊断作为下一次生成输入，最多尝试三次。每次结构重试都写入 `implementation` 阶段的 warning event。

### 暂停任务

`POST /jobs/{projectId}/pause`

需要 Runner Bearer token。只有 `queued/running` job 可暂停；Runner 立即把 job 标记为 `paused`，同时通过 `AbortController` 中断当前 Mobile Spec、Codex/OpenAI 调用、依赖安装、生产构建、临时部署或健康检查，并回调控制面写入 `paused`。重复暂停幂等返回 `202`；不存在或已进入其他终态时返回 `404/409`。

### 读取步骤产物

`POST /jobs/{projectId}/artifacts/{stage}` 仅接受 Runner Bearer token，并由控制面在 body 中传入项目原始需求做哈希校验。`mobile-spec` 返回 Proposal、Spec、Design、Review、Tasks 五份 `format: markdown` 文件；`implementation` 返回生成清单；`build` 返回真实构建日志；`deployment` 返回 URL 与健康检查证据。浏览器只访问所有权隔离的控制站 GET 代理。

## 5. 进度与 message 映射

| 内部事件 | 对外阶段 | 进度 | message 含义 |
|---|---|---:|---|
| queued | mobile-spec | 4 | 已进入队列 |
| spec-workflow | mobile-spec | 9 | 初始化规格工作区 |
| spec-propose | mobile-spec | 18 | Proposal 与 Specs |
| spec-design | mobile-spec | 36 | Design 与 Review |
| spec-task | mobile-spec | 52 | Tasks 与 gate |
| llm | implementation | 64 | Codex 生成页面 |
| write | implementation | 72 | 写入项目文件 |
| retry | implementation | 76 | 根据构建日志修复 |
| build | build | 80 | 安装依赖和生产构建 |
| done | build | 88 | 构建完成 |
| checkpointed | 指定步骤 | 88 | 单步成功，产物已保存 |
| deployment | deployment | 92 | 发布与健康检查 |
| delivered | delivered | 100 | 三项 evidence 通过 |
| failed | failed | 100 | 失败且无交付 URL |

进度代表阶段性里程碑，不是模型 token 或墙钟时间的线性百分比。

## 6. 数据模型与处理

### 存储分工

| 存储位置 | 数据内容 | 角色 |
|---|---|---|
| Cloudflare D1 | users / sessions / projects 表 | 项目**终态**来源（source of truth） |
| Runner 内存 | job / progress / message / events / evidence | **执行中**状态来源，重启即丢失 |
| Runner 工作区 | requirement-scoped checkpoints / Markdown / manifest / build log / deployment evidence | 成功阶段复用与产物查看 |

Schema 双份维护：Drizzle 定义在 `apps/web/db/schema.ts`（迁移文件在 `drizzle/`），运行时幂等建表在 `apps/web/app/lib/server-auth.ts` 的 `ensureDatabase()`，两处需人工保持一致。

### 表结构

**users**：`id`（`usr_` 前缀）、`username` / `username_normalized`（小写归一化，唯一索引，登录键）、`password_hash` / `password_salt` / `password_iterations`（PBKDF2-SHA256，100k 迭代）、`status`（登录时校验 `active`）。

**sessions**：`id`（`ses_` + UUID）、`token_hash`（会话 token 的 SHA-256，**明文不入库**，唯一索引）、`user_id`、`expires_at`（7 天）、`last_seen_at`、`revoked_at`。

**projects**：`id`（`prj_` + UUID）、`owner_user_id`（所有查询带此条件做行级隔离）、`name`（≤100 字符）、`prompt`（≤4000 字符）、`status`、`current_stage`、`preview_url`（仅 delivered 时写入）、`created_at` / `updated_at`（索引 `(owner_user_id, updated_at DESC)`）。

### 核心数据流

1. **提交**：校验会话与输入长度 → 容量检查（每用户 < 2 个进行中）→ INSERT `queued` 记录，不触发执行。
2. **派发**：原子抢占名额（单条条件 UPDATE，靠 `meta.changes` 判断成败）置 `dispatching` → 带 `Idempotency-Key` POST 给 Runner → 返回 202 置 `building`；派发失败回滚原状态；响应未知则保持 `dispatching` 占位交给轮询收敛。
3. **同步**：`GET /api/projects` 对执行中项目并发拉取 Runner，按返回状态更新 D1（见下表）；progress / message / events 只透传不落库（message 截断 600 字符、events 取末 12 条）；Runner 读失败静默忽略，**绝不发明终态**；`dispatching` 超 2 分钟未确认批量置 failed 释放名额。
4. **回调**：Runner 带 token 回调 delivery 路由，timing-safe 比对通过且校验齐全才写终态，与轮询互为冗余的两条终态通道。

### 状态机

```mermaid
stateDiagram-v2
  [*] --> queued: POST /api/projects
  queued --> dispatching: 原子抢占名额
  dispatching --> building: Runner 接受任务 (202)
  dispatching --> queued: 派发失败回滚
  dispatching --> failed: 2 分钟未确认 / Runner 报 failed
  building --> building: 轮询更新 current_stage
  building --> ready: 单步执行成功
  building --> delivered: evidence 齐全 + URL 校验通过
  building --> failed: 任一阶段失败 / evidence 缺失
  ready --> dispatching: 继续 / 重跑 / 单步
  failed --> dispatching: 继续 / 重跑 / 单步
```

不变量：只有 Runner 回调（带 token）或控制面轮询到可信 Runner 终态两条路能写终态；浏览器侧 `PATCH /api/projects` 始终 403；delivered 必须同时具备 `mobileSpecPassed` / `buildPassed` / `deployPassed` 三项 evidence 且 URL 通过校验，任一缺失按 failed 处理。

### 数据校验汇总

| 数据 | 校验规则 |
|---|---|
| 登录口令 | PBKDF2 100k 迭代 + timing-safe 比对 |
| 会话 token | 只存 SHA-256 哈希；查询时校验未吊销、未过期、用户 active |
| 项目输入 | name ≤ 100 / prompt ≤ 4000，空值拒绝 |
| 执行容量 | 每用户最多 2 个进行中项目，提交与派发两处检查 |
| Runner 消息 | message ≤ 600、events ≤ 12 条、stage ≤ 40、progress 夹在 0-100 |
| 交付 URL | 必须 HTTPS、非 localhost、非控制站自身、非 `/preview` 路径 |
| 回调身份 | `RUNNER_CALLBACK_TOKEN` timing-safe 比对 |

## 7. 未来协议

生产化后应增加 `jobId` 资源、attempt、cursor-based event stream、cancel、lease、checkpoint、artifact 和 deployment 资源。事件至少应包含 `sequence`、`occurredAt`、`attemptId`、`type`、`payload`，支持断线重放和幂等落库。

当前 Runner 内存事件不能满足重启恢复，不能被当作最终审计日志。
