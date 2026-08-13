# Coding 中的方案变化

仅在开发中发现需求、接口、状态或方案变化时读取。

1. 立即停止当前编码和任务勾选，把 change、原因、发现 stage=`coding`、实际或计划变化文件交给已安装的 `dspec-change`；不得先用代码文件路径调用 onChange，把方案变化默认归为 code。
2. `dspec-change` 负责比较现有 artifacts、声明语义影响并调用一次 onChange；需要新增产品决策或影响范围不明确时等待确认。
3. blocking 的 dspec-change action 完成后执行 `dspec workflow status --change <change> --json`。
4. dspec-change 已重新通过 gate 的 stage 不重复执行对应 skill；从 status/next 返回的第一个 stale、rejected 或 ready stage 恢复。
5. 不得越过剩余 stale stage 继续实现或自行把阶段标为 done。
