# mobile-app-build

通过移动端对话连接电脑端执行器，从一句自然语言需求生成、验证、构建并部署项目。

当前保留账号登录、需求持久化、`@didi/dspec@1.11.0` 原始快照与 `@mobile-app-build/mobile-spec` 工作副本。移动端不再使用关键词模板、模拟构建日志或站内预览伪装真实交付；真实执行由 Mobile Spec、Agent、验证和部署 Provider 逐步接入。

## 目标形态

```text
移动端 Web
  -> 云端会话 / 鉴权 / 任务协调服务
  -> Agent 执行目标
       -> 云端 Agent（可使用 OpenAI Codex / Agents API 与 Sandbox）
  -> Mobile Spec 规格驱动流程
  -> Next.js 项目初始化 / 依赖安装 / 编码 / 验证 / 构建
  -> 部署平台
  -> 返回可访问 URL
```

## 目录

- `apps/web/`：移动端需求入口（已实现）
- `packages/codegen/`：Node 执行器（需求 → Mobile Spec → OpenAI → Next.js 项目 → 构建）+ 本地开发 runner
- `packages/dspec-legacy/`：保留的 `@didi/dspec@1.11.0` 原始快照
- `packages/mobile-spec/`：`@mobile-app-build/mobile-spec` 通用化工作副本，完成验收前禁止发布
- `docs/文档中心.md`：配套文档总入口与当前实现状态
- `docs/MVP产品说明.md`：MVP 产品范围、用户流程和验收场景
- `docs/总体技术方案.md`：总体架构、执行面和关键技术选型
- `docs/API与事件协议.md`：版本化 API、事件流、结构化动作和错误码
- `docs/数据模型.md`：项目、任务、attempt、checkpoint、审批和部署数据模型
- `docs/Mobile-Spec完整替换技术方案.md`：Mobile Spec Kernel、Skill、Adapter 和完整等价替换方案
- `docs/安全与运维方案.md`：安全、Secret、沙箱、可观测与恢复方案
- `docs/开发验证与部署手册.md`：本地开发、验证、数据库和部署操作手册
- `docs/实施路线图.md`：真实 MVP 与 Mobile Spec 完整替换路线图

> 原计划的 `apps/desktop-agent`（本机执行器）和 `packages/protocol`（独立协议代码包）已移除：协议契约记录在 [API 与事件协议](docs/API与事件协议.md)，本机执行暂未纳入当前范围。

## 当前约束

- DSpec 原始流程能力必须在 Mobile Spec 中完整保留，不以去除内网依赖为由删减或静默降级。
- 公开版默认不依赖滴滴内网、私有账号、私有 SDK 或私有知识库。
- 允许依赖 Node.js、Git、Playwright、Chrome、Xcode、Android SDK、Harmony SDK 等公开可安装的标准本地工具。
- 核心协议与特定 AI 工具解耦；真实执行统一走云端 Agent，其他 Agent 通过适配器接入。

## MVP 能力

- 本地账号密码登录、7 天安全会话和原始需求持久化。
- 纯文本需求，可附加链接作为补充来源；不根据关键词推断页面或实现。
- 仅当真实验证和 DeploymentProvider 成功后，才展示外部项目 URL。

## 本地运行

两个进程：`apps/web`（移动端入口，跑在 workerd）和 codegen runner（独立 Node 进程，负责真实生成与构建）。

```bash
# 1) 移动端 Web
cd apps/web
npm ci
npm run dev                 # http://localhost:5173

# 2) 代码生成 runner（另开一个终端）
cd packages/codegen
npm install
OPENAI_API_KEY=sk-... CODEGEN_MODEL=gpt-4o node runner.mjs   # http://localhost:5174
```

在本地开发环境中，Web 端保存一句需求后可调用 runner：runner 必须先完整执行 Mobile Spec，再调用 OpenAI 生成多页 Next.js 项目，执行 `npm ci` + `next build`。本地 `next start` 地址只用于开发检查，不得写回为交付 URL。

> 当前仓库提供可验证的 Node 执行内核；生产网站必须通过独立 Cloud Runner 与 DeploymentProvider 调用它。`apps/web` 跑在 workerd，无法自己 spawn `npm ci` / `next build`，也不能访问浏览器用户的 `localhost`。

使用已约定的 MVP 账号登录。

## 文档

从 [Mobile Build 文档中心](docs/文档中心.md) 开始阅读。文档明确区分已实现、演示实现和待实现能力，避免把当前交互原型误认为真实构建执行器。
