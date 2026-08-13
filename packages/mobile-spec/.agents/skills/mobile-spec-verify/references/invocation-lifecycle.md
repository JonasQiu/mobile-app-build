# Verify invocation 生命周期

仅在 `preStage` 已成功创建 invocation，后续编排或协议步骤失败时读取。

1. 记录实际失败步骤与原因，执行：
   ```bash
   mobile-spec workflow hook --name abortVerifyInvocation --stage verify --change <change> --failure-step <step> --reason <失败原因> --json
   ```
2. hook 成功后确认 invocation 为 `aborted`、`checksUpdated: false`、`currentUpdated: false`；已归档时还必须是 `workflowImpact: none`。
3. 停止当前调用，不执行 `postStage`，不回滚已发生的产品文件变化。用户之后再次调用 `mobile-spec-verify` 才创建新 invocation。

`postStage` 只收口 `postNode` 已接受的当前 repairAttempt 结果：pass 为 `done`，fail 为 `rejected`。缺少合法结果、profile 或 provenance 无效、subagent/结果不可用、`postNode` 失败，以及修复记录后尚未完成复验，都属于 `aborted`，不得伪装成 Verify gate 失败。
