> **目标**：把已通过 Review 的行为契约和实现方案拆成可独立完成、可验证、可追踪的开发任务。
> **权威输入**：`specs/**/*.md` 定义行为，`design.md` 定义实现，`review.md` 必须已通过。
> **内容边界**：不得把未解决的 Review 问题藏进任务，不得新增需求或设计决策。每个任务必须使用 `- [ ] X.Y 任务描述` 格式并包含明确完成标准。

## 1. 契约与准备

- [ ] 1.1 确认接口契约和 Mock 数据可用
- [ ] 1.2 确认设计稿、交互、文案和资源可用
- [ ] 1.3 新增或更新 API client / service 定义
- [ ] 1.4 新增开关、实验或兼容保护

## 2. 前端实现

- [ ] 2.1 实现数据流和状态管理
- [ ] 2.2 实现 UI 组件和页面集成
- [ ] 2.3 实现 UI 状态：loading、empty、success、error、timeout、degraded、feature flag off、permission、compatibility（按需求实际情况覆盖，不涉及的状态注明"无"）
- [ ] 2.4 实现埋点、日志和诊断信息

## 3. Coding 收口

> 本节不是 task checkbox。Task 阶段按 dspec-task 的最小读取规则填写真实命令；存在适用命令时不得写 N/A，不存在或不适用时记录查找依据。Coding 在实现完成后依次执行自动代码审查与修复、开发 Server 启动与启动问题修复、lint 与 lint 问题修复，再通过 apply gate。

| 收口项 | 项目上下文 / 命令 | 本次结论 | 完成证据 |
|---|---|---|---|
| 自动代码审查 | 当前完整 diff + Specs / Design | 必需 | <finding、修复与复审结论> |
| 开发 Server 启动 / smoke | <启动命令 + ready 条件 / URL，或“无”及依据> | 必需 / N/A | <退出码、端口、ready 日志、页面或 health check> |
| lint | <lint 命令 / 配置，或“无”及依据> | 必需 / N/A | <退出码与输出摘要> |

## 4. Verify 计划

> 每次 Verify 的 AI CR 必需且覆盖完整实现 diff，Specs scenario 必需覆盖受影响场景；自动化命令、开发 Server、集成 / 交互 / 真机验证和 Mock 根据改动范围、项目已有基建与 Design 验证方案选择“必需 / 定点 / N/A”。N/A 必须记录不存在对应基建或本次不适用的证据；应执行但因依赖、凭证、网络或环境不可用时属于 Verify environment failure，不得写成 N/A。Verify 独立复跑 Coding 收口中的适用命令，不接手未完成的 apply 或 Coding 收口。

| 验证类型 | 基建证据 / 命令 | 本次结论 | 预期证据 / 风险 |
|---|---|---|---|
| AI CR | <已安装 capability / 完整 diff> | 必需（全量） | <finding 与结论> |
| Specs scenario | <受影响 Requirement / Scenario> | 必需（受影响场景） | <逐项覆盖证据> |
| 独立复验：lint / unit / typecheck / build | <引用 Coding 收口命令并补充其他已有命令，或“无”> | 必需 / 定点 / N/A | <退出码与输出> |
| 开发 Server 启动 / smoke | <引用 Coding 收口命令与 ready 条件> | 必需 / 定点 / N/A | <端口、ready 日志、页面或 health check> |
| 集成 / 交互 / 真机验证 | <已有工具 / 环境，或“无”> | 必需 / 定点 / N/A | <场景证据> |
| Mock | <已有工具 / 数据机制，或“无”> | 必需 / 定点 / N/A | <说明> |

## 5. 实现记录

- 已修改文件与实现说明：<Coding 回填>
- 未完成实现、已知风险和对应 Owner：<Coding 回填>
