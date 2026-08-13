# Verify finding 处理协议

仅在合法的 subagent 结果包含 blocking findings 时读取。

1. 逐条判断 blocking finding 是否确定。只有证据可复现、根因与修改边界明确、有足够证据选择安全方案，且不涉及需求、方案或外部授权时，才属于确定性问题；其余均按不确定性问题处理。
2. 仅当全部 blocking findings 都是确定性的 `implementation` 问题，且可在各自 `affectedFiles` 内安全修复时，coordinator 才自动修复。只要混有不确定、`environment`、`requirements` 或越界问题，就不得部分修复；直接按下表结束当前 invocation。不得修改 Mobile Spec artifacts、补做 tasks 或顺手重构，subagent 始终只读。
3. 修改后把全部实际变更文件作为重复 `--file` 参数调用：
   ```bash
   mobile-spec workflow hook --name recordVerifyRepair --stage verify --change <change> --file <changed-file> --json
   ```
   hook 只在当前 `repairAttempts < maxRepairAttempts`（目前上限为 2）、最新结果的全部 blocking findings 均为 implementation、文件未越界且产品 hash 确实变化时通过。
4. hook 通过后，旧结果立即失效。沿用响应中的 invocationId 和 repairAttempt，生成新 runId 与 `mode: initial` profile，创建全新隔离 subagent 复验；不得重跑 `preStage`、`preVerify` 或 Verify skill，不得复用旧结论或把修复者自检当成独立证据。

## 停止与收口

| 条件 | 动作 | invocation 终态 |
| --- | --- | --- |
| 全部 blocking findings 可自动修复，且仍有次数 | 修复、调用 `recordVerifyRepair`，成功后用新 subagent 复验 | 保持 `active` |
| 混有不确定、environment、requirements、越界或缺少授权的问题 | 不做部分修复；执行一次 `postStage`。需要用户决策时说明问题、已知与未知、待确认决策，并给出建议方案及其影响或备选 | `rejected` |
| 最终复验仍失败、无产品文件改动、无进展或达到上限 | 执行一次 `postStage` 并停止 | `rejected` |
| `recordVerifyRepair` 返回 false | 不再修复或复验；基于最后一个合法失败结果执行一次 `postStage`，并如实说明当前代码是否已变化且未经复验 | `rejected` |

当前 invocation 最多自动修复 2 次，即“初次 Verify → 修复 1 → 复验 → 修复 2 → 最终复验”。该上限只约束本次调用；用户再次调用 `mobile-spec-verify` 才创建新 invocation 并重新计数。若修复成功记录后尚未产生合法复验结果便发生 profile、subagent 或 `postNode` 中断，按主流程执行 `abortVerifyInvocation`，不得用旧失败结果 `postStage`。

已归档 change 使用相同 finding 处理协议，但 `recordVerifyRepair` 和后续复验只能更新 audit sidecar；不得更新 current、phase、历史 Verify node/check 或 Archive 状态。
