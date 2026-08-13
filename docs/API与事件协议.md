# API 与事件协议

## 1. 协议目标

协议层必须与 Next.js、Codex、Vercel、Cloudflare 等具体实现解耦。所有请求携带版本，所有会改变状态的操作支持幂等，所有长任务通过事件流观察。

公共约定：

- API 前缀：`/api/v1`。
- 内容类型：`application/json; charset=utf-8`。
- 时间：UTC ISO 8601。
- ID：不可猜测的带前缀字符串，如 `prj_`、`job_`、`att_`、`evt_`。
- 写请求通过 `Idempotency-Key` 防止手机网络重试造成重复任务。
- 错误使用稳定 `code`，人类可读 `message` 只用于展示。

## 2. 当前 MVP API

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| `POST` | `/api/auth/login` | 已实现 | 账号密码登录并设置安全 Cookie |
| `POST` | `/api/auth/logout` | 已实现 | 撤销当前 Session |
| `GET` | `/api/auth/session` | 已实现 | 获取当前登录用户 |
| `GET` | `/api/projects` | 已实现 | 查询最近 20 个项目摘要 |
| `POST` | `/api/projects` | 已实现 | 保存原始需求草稿 |
| `PATCH` | `/api/projects` | 已实现 | MVP 项目摘要更新；真实任务后续迁移到 `/api/v1` |

这些接口用于当前演示，真实执行闭环应迁移到下面的版本化资源 API。

## 3. 目标资源 API

### 项目与消息

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/v1/projects` | 创建逻辑项目 |
| `GET` | `/api/v1/projects` | 分页查询项目 |
| `GET` | `/api/v1/projects/{projectId}` | 获取项目、最新状态和交付摘要 |
| `POST` | `/api/v1/projects/{projectId}/messages` | 添加需求或继续修改消息 |
| `GET` | `/api/v1/projects/{projectId}/messages` | 查询对话与需求来源 |
| `POST` | `/api/v1/projects/{projectId}/archive` | 归档项目，不删除源码 |

### 计划与审批

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/v1/projects/{projectId}/plans` | 创建 planning attempt |
| `GET` | `/api/v1/plans/{planId}` | 获取方案卡和 Mobile Spec artifact 引用 |
| `POST` | `/api/v1/plans/{planId}/approve` | 确认方案版本 |
| `POST` | `/api/v1/approvals/{approvalId}/resolve` | 同意或拒绝敏感动作 |

### 构建任务

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/v1/projects/{projectId}/jobs` | 从已确认方案创建任务 |
| `GET` | `/api/v1/jobs/{jobId}` | 获取任务和当前 attempt |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | 幂等取消任务 |
| `POST` | `/api/v1/jobs/{jobId}/retry` | 从指定 checkpoint 创建新 attempt |
| `GET` | `/api/v1/jobs/{jobId}/events` | SSE 事件流，支持游标恢复 |

### 产物与部署

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/v1/checkpoints/{checkpointId}` | 获取 manifest 与验证摘要 |
| `POST` | `/api/v1/checkpoints/{checkpointId}/download` | 生成短时 ZIP 下载地址 |
| `GET` | `/api/v1/deployments/{deploymentId}` | 查询部署与健康状态 |

站内 `/preview` 演示入口已移除。真实任务必须把完整需求交给 Mobile Spec，生成 Proposal、Specs、Design、Review 和 Tasks，再由 Agent 在隔离工作区实现；`previewUrl` 只能在真实构建通过且 DeploymentProvider 返回外部地址后写入。

### 设备

> 面向未来的 Desktop Agent，当前未纳入范围。

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/v1/devices/login` | Desktop Agent 同账户登录 |
| `POST` | `/api/v1/devices/pairing-codes` | 创建一次性二维码配对码 |
| `POST` | `/api/v1/devices/pair` | 已登录手机确认配对 |
| `GET` | `/api/v1/devices` | 查询设备、在线状态和能力 |
| `DELETE` | `/api/v1/devices/{deviceId}` | 撤销设备令牌和绑定 |

## 4. 创建任务示例

```json
{
  "planId": "plan_01K...",
  "planVersion": 3,
  "executor": {
    "mode": "auto",
    "preferredDeviceId": null
  },
  "delivery": {
    "environment": "preview",
    "provider": "default"
  },
  "limits": {
    "maxMinutes": 30,
    "maxRepairRounds": 3
  }
}
```

成功返回 `202 Accepted`：

```json
{
  "job": {
    "id": "job_01K...",
    "projectId": "prj_01K...",
    "status": "queued",
    "currentAttemptId": "att_01K..."
  },
  "eventsUrl": "/api/v1/jobs/job_01K.../events"
}
```

## 5. 统一事件 Envelope

```ts
type BuildEvent<T = unknown> = {
  schemaVersion: 1;
  id: string;
  sequence: number;
  type: string;
  occurredAt: string;
  projectId: string;
  jobId: string;
  attemptId: string;
  actor: {
    kind: "user" | "control-plane" | "desktop-agent" | "cloud-runner" | "provider";
    id: string;
  };
  visibility: "summary" | "detail" | "audit";
  payload: T;
};
```

同一 attempt 内 `sequence` 严格递增；消费者按 `id` 去重。事件不可更新，纠正信息通过新事件追加。

## 6. 最小事件目录

| 事件 | 关键字段 | 手机端用途 |
|---|---|---|
| `plan.ready` | `planId`, `version`, `summary`, `questions` | 展示方案卡 |
| `plan.blocked` | `reason`, `question` | 要求补充关键事实 |
| `job.queued` | `executorMode` | 展示等待状态 |
| `attempt.started` | `executorId`, `baseCheckpointId` | 标记真实执行开始 |
| `stage.started` | `stage`, `label` | 推进阶段进度 |
| `stage.completed` | `stage`, `durationMs`, `evidenceRefs` | 完成阶段 |
| `action.requested` | `actionId`, `kind`, `risk` | 审批或审计 |
| `command.started` | `commandId`, `program`, `argsSummary` | 展示安全命令摘要 |
| `command.output` | `commandId`, `stream`, `chunk`, `redacted` | 展开日志 |
| `command.completed` | `exitCode`, `durationMs` | 判断命令结果 |
| `file.changed` | `path`, `operation`, `additions`, `deletions` | 展示文件变化 |
| `verification.completed` | `checks`, `passed` | 展示验证证据 |
| `approval.required` | `approvalId`, `risk`, `summary`, `expiresAt` | 显示确认卡 |
| `checkpoint.created` | `checkpointId`, `contentDigest` | 恢复和下载 |
| `deployment.ready` | `deploymentId`, `url`, `health` | 展示交付 URL |
| `attempt.failed` | `failureClass`, `retryable`, `summary` | 错误恢复 |
| `job.cancelled` | `cancelledBy` | 终止状态 |

## 7. 结构化动作

执行器只接受明确动作类型：

```ts
type ExecutionAction =
  | { kind: "fs.read"; paths: string[] }
  | { kind: "fs.applyPatch"; patch: string }
  | { kind: "process.run"; program: string; args: string[]; cwdRef: string; timeoutMs: number }
  | { kind: "network.fetch"; url: string; method: "GET" | "HEAD" }
  | { kind: "artifact.upload"; artifactType: string; pathRef: string }
  | { kind: "deployment.create"; provider: string; checkpointId: string };
```

禁止把 `curl ... | sh`、未解析的复合 Shell 字符串或宿主机绝对路径当作普通动作透传。策略引擎应对程序、参数、工作区、网络域名、Secret 引用和审批票据分别校验。

## 8. 审批协议

审批记录必须包含：

- 具体动作和影响范围。
- 风险级别：`low`、`medium`、`high`、`critical`。
- 使用的目录、外部账户、Secret 或预计费用。
- 到期时间、一次性 nonce 和绑定的 attempt ID。
- 用户决定与决定时间。

批准票据仅对描述完全一致的单次动作或动作集合有效；修改参数、切换环境或超时后必须重新审批。

## 9. 错误模型

```json
{
  "error": {
    "code": "EXECUTOR_OFFLINE",
    "message": "电脑端 Agent 当前离线",
    "retryable": true,
    "requestId": "req_01K...",
    "details": {
      "deviceId": "dev_01K..."
    }
  }
}
```

首批稳定错误码：`UNAUTHENTICATED`、`FORBIDDEN`、`PLAN_VERSION_CONFLICT`、`APPROVAL_REQUIRED`、`EXECUTOR_OFFLINE`、`CAPABILITY_MISSING`、`WORKSPACE_CONFLICT`、`POLICY_DENIED`、`LIMIT_EXCEEDED`、`VERIFY_FAILED`、`BUILD_FAILED`、`DEPLOY_FAILED`、`CANCELLED`、`INTERNAL_ERROR`。
