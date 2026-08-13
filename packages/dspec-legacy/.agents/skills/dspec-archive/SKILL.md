---
name: dspec-archive
description: 归档 DSpec change 并完成后置上下文同步。用于 archive 阶段；不要用于普通文件移动或备份。
license: MIT
---

# DSpec Archive

完成 archive stage。归档只通过 OpenSpec CLI，不调用旧 OpenSpec skill。

## 按需读取

仅当 hook 返回非空 `agentActions` 时，读取 [references/agent-actions.md](references/agent-actions.md)。

## 执行约束

- 每次 hook 检查顶层 `ok`；false 时停止。监控项 `deterministic.monitor` 不表示中心已接收或判定通过，失败只报告 warning，不覆盖业务 gate，也不由 DSpec 重试。
- `deterministic.rules` 只做配置检查；仅执行明确点名的已安装 skill、command 或 script。
- archive 不可原地撤销。执行前解析唯一源目录和目标目录，确认目标不存在，不覆盖已有归档。

## 流程

1. 执行 `preStage --stage archive`，再执行 `preArchive --stage archive`；只有顶层 ok、blocking actions 完成且 `deterministic.verifyDone: true` 才继续。
2. 确认唯一源目录 `openspec/changes/<change>` 和当日目标 `openspec/changes/archive/YYYY-MM-DD-<change>`，然后执行：
   ```bash
   openspec archive <change> -y
   ```
   CLI 缺失、不支持 archive、校验/权限失败或目标冲突时停止；不得通过 `mv`、复制目录或 `--no-validate` 绕过。
3. 获得唯一实际归档路径后，依次执行 `postNode archive`、`postStage archive`、`postArchive`；只在前一步 ok 时继续。
4. 处理 postArchive：
   - 明确点名同步 skill 的 rule 必须执行；普通规则只检查并摘要。
   - 归档本身不因后置动作失败而回滚；同步、required action 或规则未完成时，生命周期保持开放并记录补偿项。
5. 用 `mktemp` 创建唯一 finalize summary：
   - 所有后置动作完成才写 `status: "pass"`，否则写 failed。
   - 调用 `finalizeArchive --summary-file <temp-json>` 后，只删除本次创建的精确临时文件。
   - 只有 finalize 顶层 ok 才关闭 archive phase 与 spec；失败时不得另调 monitor 或伪造闭合，修复后用新的 pass summary 重试。

## 输出

总结归档路径、gate/checks、rules、agentActions、finalize 结果和补偿项。后置动作失败时明确写出「archive 已完成、后置动作未完成、生命周期尚未关闭」。
