# 望岳需求源

仅在新建/修订 artifact 且来源是望岳链接时读取。

1. 链接必须解析出 `wangyueId` / `requirementId`；失败时停止并要求正确链接。
2. 已安装且可用 `ddp` 时，只读取望岳 ID、负责人和需求 Cooper 链接；不读取望岳正文或其他关联材料。
3. 获取需求 Cooper 链接后，按 [cooper-source.md](cooper-source.md) 读取需求内容。
4. `ddp` 未安装、失败、无权限或未返回需求 Cooper 链接时，不强制安装：保留链接、ID 和失败原因；已有文本来源足以确定范围和验收时继续，否则要求提供需求 Cooper PRD、导出正文或粘贴正文；补充材料仍归属于原望岳需求。
5. 记录 `preferredCapability`、`actualReadPath`、失败原因、已获取字段和未获取字段。能力缺失本身不构成 gate 失败；所有路径失败或核心事实不足才阻断。
6. PRD 缺口会改变范围或验收时先确认，不猜测创建 artifact。
