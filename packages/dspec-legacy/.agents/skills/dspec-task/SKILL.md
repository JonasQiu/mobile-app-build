---
name: dspec-task
description: 基于已通过的 DSpec 设计和项目上下文生成 tasks.md 与 Coding 收口命令。用于 task 拆解阶段；不要用于直接编码。
license: MIT
---

# DSpec Task

完成 task stage，不调用旧 OpenSpec skill。

## 按需读取

- 生成前执行 `openspec instructions tasks --change <change>`，其当前输出是内容和格式权威来源。
- 仅当 hook 返回非空 `agentActions` 时，读取 [references/agent-actions.md](references/agent-actions.md)。

## 执行约束

每次 hook 检查顶层 `ok`；false 时停止。监控项 `deterministic.monitor` 不表示中心已接收或判定通过，失败只报告 warning，不覆盖业务 gate，也不由 DSpec 重试。

## 流程

1. 执行 `preStage --stage task`；顶层 ok 且 blocking actions 完成后，执行 `dspec workflow plan --stage task --change <change> --json` 核对依赖、artifacts、路径和 `review.md` gate。
2. 执行 tasks instructions，读取 specs、design 和 `review.md` dependencies，写 `tasks.md`。
3. checkbox 只拆解 apply 实现，使用 `- [ ] X.Y 任务描述` 或 `- [x] X.Y 任务描述` 格式；代码审查、项目收口命令和 Verify 计划写入模板指定的非 checkbox 表格，不生成验证任务 checkbox。兼容已有 `tasks.md` 时，任何遗留 checkbox 仍由 Coding 执行，不能留给 Verify。
4. 为填写“Coding 收口”，先读取作用于目标改动路径的最近 `AGENTS.md`，再检查对应模块的脚本清单或构建配置。只有这些文件明确引用 README/docs，或命令含义与 ready 条件仍无法确定时，才最小读取被引用的相关段落；不得遍历通用 docs 或无关模块。H5 填写开发服务启动命令、ready 条件和 lint，Native 填写静态检查或 lint。存在命令时不得写 N/A；不存在或不适用时记录查找依据，不得虚构命令或新增跨平台表项。
5. 对 tasks 实际路径执行 `postNode --stage task --node task`；通过后执行 `postStage --stage task`。
6. postStage 失败时列出 `deterministic.check.checks` 的格式或依赖问题，不进入 coding。

## 输出

总结任务数量、覆盖范围、agentActions、阻塞项、task gate 依据和恢复步骤。
