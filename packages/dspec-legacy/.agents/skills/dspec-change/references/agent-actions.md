# AgentActions 处理协议

仅在 hook 返回非空 `agentActions` 时读取并执行。

1. 只调用 action 明确声明的 capability，并原样传入 `inputs`；不得从说明推断额外命令或写入。
2. 每个 action 使用 `mktemp` 在系统临时目录创建唯一 JSON summary，至少包含 `status`、`action`、`message`、`changedFiles`、`remainingIssues`。
3. 临时 summary 不得写入业务仓库、`openspec/` 或 `~/.dspec/workflow/`。
4. 调用 `dspec workflow complete-agent-action --change <change> --hook <hook> --action <id> --result <pass|failed|skipped> --summary-file <temp-json> --json` 回写。
5. 完成回写尝试后，只删除本次创建的精确临时文件。
6. required action 不得 skipped；blocking action 失败时停止当前阶段。非阻塞 action 失败可以继续，但必须记录为补偿项。

