---
name: dspec-change
description: 记录 DSpec 开发中的方案变化并同步 stale artifacts。用于已确认的方案变化；不要用于普通代码编辑。
license: MIT
---

# DSpec Change

处理 coding 或其他阶段发现的方案变化；由 workflow sidecar 和本 skill 同步，不调用旧 OpenSpec skill。

## 按需读取

仅当本次执行对应 agentAction 时，读取 [references/agent-actions.md](references/agent-actions.md)。

## 输入与边界

- 必需输入：change、原因、发现 stage、实际或计划变化的文件；缺少会影响同步范围的信息时确认，不猜测产品决策。
- `dspec-change` 只处理相对已确认 artifacts 的偏离，普通 tasks 实现不属于 change。调用 onChange 前先比较现有 Proposal / Specs / Design / Tasks，声明所有不再准确或完整的 artifact；不得等文档先被修改后才靠路径分类：
  - 业务目标、范围或不做什么变化：`proposal`；范围内的用户行为、业务规则或验收变化：`specs`；
  - 技术契约、架构、数据流、状态模型、兼容或识别策略变化：`design`；
  - 仅执行步骤、拆分或顺序变化：`tasks`；
  - 现有文档仍准确的普通实现修正：`code`。
- `--artifact` 是语义影响声明，可重复；`--file` 记录实际或计划变化路径。Design 变化会通过依赖自动使 Task/Coding 下游 stale，不需要把普通下游依赖伪报为需求变化。
- `onChange` 返回的 `changedArtifacts`、`owningStage`、`staleStages` 是权威结果。
- 由 onChange action 调用时直接使用 `inputs.deterministic`，不得再次调用 onChange；用户直接调用且无结果时只调用一次。
- 只修改确认影响的 artifacts/code，不扩大需求或重构无关代码。

## 流程

1. 明确变化原因、文件和影响 artifact；无法判断哪个现有 artifact 会失真时确认，不默认归为 code。
2. 复用现有结果，或执行一次：
   ```bash
   dspec workflow hook --name onChange --change <change> --stage <stage> --artifact <artifact> [--artifact <artifact> ...] --file <path> --reason "<reason>" --json
   ```
   顶层 `ok: false` 时停止并报告。
3. 使用响应的 `storage.changesFile` 作为唯一记录路径，确认已写入；不得自行拼接用户目录或 project hash。
4. 从 `owningStage` 开始逐 stage 恢复。每次先执行 `preStage` 与 `dspec workflow plan --stage <stage> --change <change> --json`，以 `plan.replay` 为重放契约；顶层 `ok: false` 时停止，不写输出。`replay.replayable: false` 时不得重做 action：Verify 必须交给 `dspec-verify` 创建 fresh subagent，Archive 交给 `dspec-archive`；旧 `apply-verify` schema 合并了 Verify 时先执行 `dspec update`，不得由本 skill 直接验证。
5. 对每个 `replay.preHooks` 执行 `dspec workflow hook --name <preHook> --stage <stage> --change <change> --json`。通过后根据 `changedArtifacts` / `staleStages` 精准同步当前 stage 的 artifacts/code 与可重放 action 输出。生成或重写 artifact 前执行 `openspec instructions <artifact> --change <change>`；代码变化只重过 coding/apply，随后停止并交给 `dspec-verify`。影响集合之外不修改，需要新增产品决策时确认。
6. proposal/specs/design 变化后执行当前 review instructions；进入 design 重放时更新 `review.md` 和唯一 `status: pass|blocked`，不复用旧 review。未同步 design/review 时不得提前把 design gate 标为通过。
7. 当前 stage 完整同步后，按 `replay.nodes` 顺序执行 `dspec workflow hook --name postNode --stage <stage> --node <node> --file <actual-output-path> --change <change> --json`；多文件节点重复传入 `--file`。全部通过后执行 `dspec workflow hook --name <replay.postHook> --stage <stage> --change <change> --json`。不得硬编码 design 或从 artifact 名猜 node；proposal/specs、design/review、tasks、apply 使用各自 stage plan 返回的节点，Verify 不由本 skill 执行。
8. gate 通过后执行 `dspec workflow next --change <change> --json`。若返回 stage 的受影响输出也已由本 skill 完整同步，则重新执行第 4—8 步；否则停止并从该 stage 对应 skill 继续。已通过 gate 的 stage 不重复执行；gate 失败或同步不完整时从当前失败 stage 恢复，不得退回已通过的 `owningStage` 或自行标 done。
9. 对应 agentAction 时按 reference 回写 pass/failed；blocking action 失败时停止，不用 skipped 隐藏失败。

## 输出

总结原因、`changes.jsonl` 记录、已同步/未同步文件、review、已重新通过的 stage gate、剩余 staleStages、agentAction 和下一步。
