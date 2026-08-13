---
name: mobile-spec-coding
description: 完成 Mobile Spec apply、代码审查修复和项目收口。用于 Coding；不要代替 Verify。
license: MIT
---

# Mobile Spec Coding

完成 apply 及其代码收口；不调用旧 OpenSpec skill。

## 按需读取

- 仅当 hook 返回非空 `agentActions` 时，读取 [references/agent-actions.md](references/agent-actions.md)。
- 仅在开发中发现需求、接口、状态或方案变化时，读取 [references/change-handling.md](references/change-handling.md)。

## 执行约束

- Coding 以 `tasks.md` 为实现范围，`proposal.md`、`specs/`、`design.md`、`review.md` 为约束。
- checkbox 只表示 apply 实现；兼容已有 `tasks.md` 时仍执行其中全部 checkbox，不把遗留任务留给 Verify。代码审查、开发服务启动和 lint 以 `tasks.md` 的“Coding 收口”表为执行输入，不要求生成 checkbox。
- 代码审查发现确定性问题时，按证据自行修复；不确定性问题不得猜测，须向用户说明问题、已知与未知、待确认决策，并给出建议方案及其影响或备选，确认前停止相关修改。
- `deterministic.rules` 只做配置检查；仅执行明确点名的已安装 skill、command 或 script。
- 每次 hook 检查顶层 `ok`；false 时停止。监控项 `deterministic.monitor` 不表示中心已接收或判定通过，失败只报告 warning，不覆盖业务 gate，也不由 Mobile Spec 重试。

## 流程

1. 依次执行 `preStage --stage coding` 与 `preApply --stage coding`；两者顶层 ok 且 blocking actions 完成后，执行 `mobile-spec workflow plan --stage coding --change <change> --json`，核对依赖和 apply 输出路径。
2. 读取 `proposal.md`、`specs/`、`design.md`、`review.md` 和 `tasks.md`，按 tasks 中所有 checkbox 完成 apply；不得修改需求或扩大任务。实际完成后才勾为 `- [x]`；失败、跳过或部分完成保持未勾选并记录原因。
3. apply 完成后开始一轮收口：自动审查当前完整实现 diff 是否忠实满足 Specs/Design，以及正确性、回归、安全和兼容风险，并按上述代码审查规则处理 findings。需求或方案变化按 change handling 停止。
4. 按 `tasks.md`“Coding 收口”依次执行适用命令：存在开发服务项时先启动并检查 ready 条件，再执行静态检查或 lint。开发服务启动命令必须在沙箱外执行：首次运行即使用当前执行环境提供的提权或沙箱外执行能力，不得先在沙箱内试跑；无法申请、用户拒绝或授权失败时，记录 `environment` failure 并停止启动项，不得退回沙箱内运行。命令暴露本次实现的确定性问题时自行修复；一旦修改产品文件，立即结束本轮并按步骤 5 重入，不在当前项原地重跑。未修改产品文件时，可在补齐一次环境准备后重跑失败命令一次。仍失败、属于环境或既有无关问题时保留证据并停止，不得修改无关代码。必需命令缺失或 N/A 没有查找依据时停止，不得猜测替代命令。
5. 一轮是步骤 3–4 的完整序列。产品文件变化后，停止本轮启动的服务并从步骤 3 开始下一轮；总计最多执行 3 轮。同一问题无新增证据、修复未产生产品文件改动或 3 轮后仍未通过时停止。无论重入、停止或通过 gate，都只清理由本轮启动的进程。最后一轮无产品改动且全部通过时，将 findings、修复、命令、退出码和 ready 证据回填“Coding 收口”。Coding 不生成最终验证结论；`mobile-spec-verify` 仍独立复审和复验。
6. 所有 checkbox 完成、代码审查无阻断项且适用的启动与 lint 命令通过后，依次执行：
   ```bash
   mobile-spec workflow hook --name postNode --stage coding --node apply --file openspec/changes/<change>/tasks.md --change <change> --json
   mobile-spec workflow hook --name postStage --stage coding --change <change> --json
   ```
   仅当前一步 ok 时继续；postStage 失败时保留真实 tasks 状态，不进入 verify。

## 输出

总结完成/未完成任务、代码审查与修复轮次、启动和 lint 命令及退出码、agentActions、apply gate 依据、剩余风险和进入 `mobile-spec-verify` 的条件。
