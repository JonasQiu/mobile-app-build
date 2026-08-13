# Tasks

> **目标**：把已通过 Review 的行为契约和实现方案拆成可独立完成、可验证、可追踪的开发任务。
> **权威输入**：`specs/**/*.md` 定义行为，`design.md` 定义实现，`review.md` 必须已通过。
> **内容边界**：不得把未解决的 Review 问题藏进任务，不得新增需求、设计决策或 Patch 计划。每个任务必须使用 `- [ ] X.Y 任务描述` 格式并包含明确完成标准；上下文正文只在 archive 后同步。

## 1. 准备与定位

- [ ] 1.1 读取 proposal.md、specs/、design.md、review.md，确认 review 结论为通过。
- [ ] 1.2 按 design.md 的上下文读取清单复核主工程 AGENTS、业务线 Index 和相关 Pod docs。
- [ ] 1.3 确认预计修改文件、只读参考文件和禁止修改范围。

## 2. 实现

- [ ] 2.1 <实现任务，写明文件 / 类 / 完成标准>
- [ ] 2.2 <实现任务，写明文件 / 类 / 完成标准>

## 3. Coding 收口

> 本节不是 task checkbox。Task 阶段按 dspec-task 的最小读取规则填写真实命令；Coding 在实现完成后执行自动代码审查与修复，再执行静态检查 / lint。

| 收口项 | 项目上下文 / 命令 | 本次结论 | 完成证据 |
|---|---|---|---|
| 自动代码审查 | 当前完整 diff + Specs / Design | 必需 | <finding、修复与复审结论> |
| 静态检查 / lint | <真实命令 / 配置，或“无”及依据> | 必需 / N/A | <退出码与输出摘要> |

## 4. Verify 计划

> 每次 Verify 的 AI CR 必需且覆盖完整实现 diff，Specs scenario 必需覆盖受影响场景；静态检查、Native 编译、测试 / 真机 / Mock 根据改动范围、项目已有基建与 Design 验证方案选择“必需 / 定点 / N/A”。N/A 必须记录不存在对应基建或本次不适用的证据；应执行但因依赖、凭证、网络或环境不可用时属于 Verify environment failure，不得写成 N/A。Verify 独立复跑 Coding 收口中的适用命令，不接手未完成的 apply 或 Coding 收口。

| 验证类型 | 基建证据 / 命令 | 本次结论 | 预期证据 / 风险 |
|---|---|---|---|
| AI CR | <已安装 capability / 完整 diff> | 必需（全量） | <finding 与结论> |
| 独立复验：静态检查 / 格式化 | <已有命令 / 配置，或“无”> | 必需 / 定点 / N/A | <退出码与输出> |
| Native 编译 | <workspace / scheme / module 与命令，或“无”> | 必需 / 定点 / N/A | <构建结果> |
| Specs scenario | <受影响 Requirement / Scenario + 测试 / 真机 / Mock 环境> | 必需（受影响场景） | <逐项覆盖证据> |

<!-- 本节只规划 verify，不生成 checkbox；验证是否通过由 dspec-verify 和 verify gate 判定。 -->

## 5. Archive 上下文同步范围

> Task 阶段根据 Design 记录预计范围；本节不是 checkbox，不属于 Coding 或 Verify，也不参与 gate。`dspec-archive` 在归档后以实际实现为准确认并同步，Task 阶段不得修改主工程或子组件 docs、AGENTS.md、业务线 Index.md。

- 预计需要同步的接口、状态、页面、埋点、配置等稳定信息：<范围>
- 预计涉及的主工程 / 子组件 docs、AGENTS.md、业务线 Index.md：<路径>
