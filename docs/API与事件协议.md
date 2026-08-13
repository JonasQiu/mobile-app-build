# API 与事件协议

## 1. 协议原则

- 浏览器只提交需求和启动任务，不能写入 `delivered` 或部署 URL。
- Runner API 只接受 Bearer token，状态读取也必须鉴权。
- `projectId` 同时是控制站项目和 Runner job 的幂等键。
- 当前用服务端轮询同步；未来 SSE/WebSocket 仍复用相同 job 字段。
- 错误文本可展示，但不得包含 Secret、完整系统路径或未经裁剪的模型输入。

## 2. 控制站 API（当前实现）

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
  ]
}
```

`executionProgress`、`executionMessage`、`executionEvents` 当前由控制站查询 Runner 后临时附加，不写入 projects 表；事件可包含 `stage`、`kind`、`progress`。响应还包含 `executionCapacity: { active, max: 2 }`。项目终态与 URL 才写入 D1。

当用户已有 2 个 `dispatching/building` 项目时，`POST /api/projects` 和 jobs 派发返回 `409 EXECUTION_LIMIT_REACHED`。jobs 路由使用单条条件 UPDATE 原子占用名额，防止并发请求绕过计数。

`DELETE /api/projects/{projectId}` 只删除当前用户拥有的记录；`dispatching/building` 项目返回 409，避免 Runner 继续执行但控制面记录消失。

## 3. Runner API（当前实现）

### 健康检查

`GET /health`

```json
{ "ok": true, "deploymentProviderConfigured": true }
```

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
  "callbackUrl": "https://control.example/api/v1/projects/prj_.../delivery"
}
```

返回 `202` 与异步 job；相同 `projectId` 正在运行时返回现有 job。

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

## 4. 进度与 message 映射

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
| deployment | deployment | 92 | 发布与健康检查 |
| delivered | delivered | 100 | 三项 evidence 通过 |
| failed | failed | 100 | 失败且无交付 URL |

进度代表阶段性里程碑，不是模型 token 或墙钟时间的线性百分比。

## 5. 未来协议

生产化后应增加 `jobId` 资源、attempt、cursor-based event stream、cancel、lease、checkpoint、artifact 和 deployment 资源。事件至少应包含 `sequence`、`occurredAt`、`attemptId`、`type`、`payload`，支持断线重放和幂等落库。

当前 Runner 内存事件不能满足重启恢复，不能被当作最终审计日志。
