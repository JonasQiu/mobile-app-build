# SiteForge AI 开发文档

这套文档面向需要阅读、运行、修改和交付 SiteForge AI 的开发者。目标是用最短路径说明“代码在哪里、服务怎么启动、任务如何流转、失败去哪里排查”。产品背景和完整设计论证仍保留在上层文档中。

## 1. 推荐阅读顺序

1. [系统架构](01-系统架构.md)：先理解控制面、执行面和可信边界。
2. [本地开发](02-本地开发.md)：安装依赖并启动 Web 与 Runner。
3. [执行工作流](03-执行工作流.md)：理解预览确认、检查点、单步、继续和重跑。
4. [API 与数据](04-API与数据.md)：修改接口、状态或数据库前阅读。
5. [测试与排障](05-测试与排障.md)：验证改动并按阶段定位问题。
6. [部署与运维](06-部署与运维.md)：发布控制站、维护 Runner 和处理临时 Tunnel。

## 2. 十分钟建立项目认知

SiteForge AI 把一条自然语言需求转换成真实可访问的网站：

```text
需求
  → Mobile Spec
  → 3 份视觉预览
  → 用户确认
  → Codex 实现
  → npm 生产构建
  → 部署与公网健康检查
  → 返回 HTTPS URL
```

仓库包含两个必须分开运行的核心服务：

| 服务 | 目录 | 职责 |
|---|---|---|
| Web 控制面 | `apps/web/` | ChatGPT 登录、项目、历史、审批、任务派发、状态和产物展示 |
| Trusted Runner | `packages/codegen/` | Mobile Spec、Codex、文件写入、依赖安装、构建、部署和健康检查 |

辅助模块：

| 模块 | 目录 | 职责 |
|---|---|---|
| Mobile Spec | `packages/mobile-spec/` | 规格 Schema、模板、阶段门禁和工作流状态 |
| 生成模板 | `templates/next-web/` | 新网站的中立 Next.js 工程基线 |
| 文档工具 | `scripts/` | 实现状态同步、断链和敏感信息检查 |

## 3. 当前实现边界

- 控制站托管在 OpenAI Sites，数据持久化使用 D1。
- 当前 Runner 是受控 macOS 机器上的常驻 Node.js 进程，不是 Cloud Runner。
- Runner 执行中的 job、message 和 event 保存在内存；成功检查点与产物保存在 Runner 本地工作区。
- 当前生成网站使用 Cloudflare Quick Tunnel 提供临时验收 URL，没有固定域名和 SLA。
- Cloudflare Pages、R2、持久任务事件、共享产物存储和 Runner Pool 尚未接入。

不要把规划能力写成已实现功能。当前事实以 [实现状态快照](../实现状态快照.md) 和源码为准。

## 4. 最常用命令

```bash
cd apps/web
npm ci
npm run dev
```

```bash
cd packages/codegen
npm ci
npm run start:runner
```

```bash
cd apps/web
npm run build
npm run lint
node --test tests/*.test.mjs

cd ../../packages/codegen
npm test

cd ../mobile-spec
npm test

cd ../..
node scripts/check-docs.mjs
```

Runner 启动前需要配置凭证、Agent Provider 和 Deployment Provider，不能直接照抄无值环境变量运行。完整配置见 [本地开发](02-本地开发.md)。

## 5. 修改内容与必读文档

| 改动类型 | 必读 |
|---|---|
| 页面、交互、轮询 | [执行工作流](03-执行工作流.md)、[MVP 产品说明](../MVP产品说明.md) |
| API、状态字段、错误码 | [API 与数据](04-API与数据.md)、[完整 API 与事件协议](../API与事件协议.md) |
| D1 Schema、身份、审批 | [API 与数据](04-API与数据.md)、[数据模型](../数据模型.md) |
| Runner、检查点、Codex | [系统架构](01-系统架构.md)、[执行工作流](03-执行工作流.md) |
| 构建、Tunnel、部署 | [测试与排障](05-测试与排障.md)、[部署与运维](06-部署与运维.md) |
| Secret 或权限 | [安全与运维方案](../安全与运维方案.md) |

## 6. 开发原则

- 浏览器不能写入 `delivered`、evidence 或交付 URL。
- 未确认当前预览方案时，不能启动 Codex、构建或部署。
- “继续”复用成功检查点；“重跑”才允许清空检查点。
- 页面展示的进度、消息和终态必须来自 Runner 或服务端可信数据。
- localhost、控制站自身地址和站内 `/preview` 不能作为交付 URL。
- Quick Tunnel 只能描述为开发或验收能力。
- Secret 不进入源码、日志、文档、截图或 Git。
