---
name: mobile-spec-verify
description: 用独立 subagent 审查并验证 Mobile Spec 实现。用于 Verify；不要代替 Coding。
license: MIT
---

# Mobile Spec Verify

## 按需读取

- hook 返回非空 `agentActions` 时读取 [references/agent-actions.md](references/agent-actions.md)。
- 项目存在明确开发 Server 命令且 profile 判定适用时读取 [references/server-verification.md](references/server-verification.md)。
- 合法的 subagent 结果包含 blocking findings 时读取 [references/auto-repair.md](references/auto-repair.md)。
- `preStage` 成功后的编排或协议步骤失败时读取 [references/invocation-lifecycle.md](references/invocation-lifecycle.md)。

## 约束

- coordinator 处理 findings；每轮创建全新隔离 subagent，不得降级代验或补做 `tasks.md` 未完成任务。
- proposal/specs/design/review/tasks 与代码是基线，不得扩大需求或改写方案。subagent 不得修改产品代码、配置或 Mobile Spec artifacts，只写验证产物并报告 `changedProductFiles: []`；coordinator 仅可按 finding 处理协议修复确定性产品问题。
- 每次用户调用都是新的独立复验，由 `preStage` 创建 invocation；内部复验沿用当前 invocation，不得重跑入口。已归档 change 使用 `archived-audit` 模式，能力不变，证据只写 audit sidecar，不得更新 current、phase、历史 node/check 或 Archive 状态。
- `deterministic.rules` 只检查配置；仅执行明确点名的已安装 capability。hook 顶层 `ok: false` 时停止；`deterministic.monitor` 只表示本地事件记录结果，失败只报 warning，不覆盖 gate，也不由 Mobile Spec 重试。

## 流程

1. 先执行 verify `preStage`；失败即停止。成功后执行 `preVerify` 和 plan，核对 `storage.verifyResultFile`、`storage.verifyProfileFile`、`storage.verifyInvocationFile`、`verification.profilePath`、`executor: subagent`、`freshContext: true`、`productMutation: forbidden`、`writeScope: verification-artifacts-only`、`abortHook`，以及 `coordinatorRepair` 的 trigger、writeScope、recordHook、上限和停止条件。已归档还要核对 `executionMode: archived-audit`、`workflowImpact: none`。后续失败按 invocation lifecycle 中止。
2. coordinator 生成唯一 runId，按 tasks Verify 计划、diff、仓库命令、Design 和 plan 写 profile：
   - `ai-cr` 固定为 `required/full`，`spec-scenarios` 固定为 `required/affected`；`automated-checks` 选择 `required/full`、`targeted/affected` 或 `n-a/none`。
   - 公共接口或契约、共享模块、依赖或 lockfile、构建配置、安全敏感逻辑或影响不明确时，三个能力都使用 `required/full`。
   - N/A 只用于无对应基建或本次确实不适用，必须有 reason/evidence；应执行但环境不可用时记为 `environment` failure。
   profile 包含 policyVersion、invocationId、repairAttempt、runId、`selectedBy: coordinator`、`mode: initial`、风险及三个 capability 的决策。记录 profile 与产品文件状态后交给新 subagent。
3. subagent 独立读取基线、diff、仓库说明和 profile，检查 Specs/Design 忠实性及回归、安全、兼容风险：
   - 可以发现风险后扩大 selection 或 scope，但不得缩小或把必需项改成 N/A。
   - 只运行 profile 选中的真实 lint/unit/typecheck/build/集成命令，独立复跑 Coding lint；不得虚构命令。
   - 不得调用 workflow hook、`complete-agent-action`、Coding、archive 或嵌套委派。
   - `verify-result.json` 保留 invocationId、repairAttempt、runId、`verificationProfile`、executor/outputPath/status/failureClass、`capabilityResults`、findings、`changedProductFiles: []` 及验证证据。blocking finding 必须有稳定 id、failureClass、evidence 和项目相对 affectedFiles；pass 使用 none，fail 使用 implementation/environment/requirements。
4. coordinator 比较执行前后的 profile 与产品文件状态，不能只信任 `changedProductFiles` 自报。发现变化、结果不可用、provenance 不匹配、capabilityResults 降级或 verify `postNode` false 时，按 invocation lifecycle 中止；不回滚已发生的产品文件变化。
5. `postNode` 已接受的结果才允许收口：pass 执行 verify `postStage`；未归档通过 gate 后才进入 archive，已归档核对 `archivedAudit: true`、`workflowImpact: none`、`checksUpdated: false`。fail 读取 finding 处理协议，由该协议决定修复并回到步骤 2，或以 `rejected` 结束。有效失败的 `postStage` 返回 `ok: false` 是预期终态。内部复验不得重跑步骤 1、Coding 或 Verify skill。

## 输出

总结 executionMode、invocationId、runId、repairAttempt、profile risk/selection、findings、命令与退出码、Server、scenario、gate、invocation 终态（done/rejected/aborted）、待确认项、剩余风险和停止原因。
