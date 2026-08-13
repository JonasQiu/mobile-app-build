---
name: mobile-spec-sync-context
description: 将已落地的 H5 Mobile Spec 变更同步到 docs。用于 archive 后的上下文回写；不要用于修改业务代码。
category: Workflow
tags: [workflow, context, sync, experimental]
---

# H5 Context Sync

把已完成变更的稳定设计信息精准同步到现有 `docs/` 上下文。

## 按需读取

仅当发现实际候选写入时，读取 [references/write-preview.md](references/write-preview.md)，展示预览并取得写入范围确认。

## 权威输入与边界

- 稳定行为以已落地代码和 main spec 为准；design/proposal/delta specs 解释变更意图。冲突时不写，列为待确认。
- 只写 `docs/index.md` 路由命中的现有 context 文件；新建文档、路由不命中或范围不确定时确认。
- 不执行任意规则文本，不修改业务代码，不回滚 archive。
- postArchive 明确调用只授权上下文同步，不授权猜测内容或扩大范围。

## 流程

1. 确定 change：
   - 已指定则使用；未指定时运行 `openspec list --json` 并列出最近归档，要求用户选择，不自动选择。
   - 定位活跃目录或唯一归档目录；多个日期匹配时确认。
2. 读取存在的 proposal/design/delta specs；归档超过 30 天时先确认已实际落地。
3. 读取 `docs/index.md` 路由表，根据 design 影响路径确定候选 context 文件；路由不命中不猜测。
4. 读取候选 docs 和相关 `openspec/specs/<capability>/spec.md`，与已落地代码核对稳定行为。
5. 只追加或精准修改 why、关键约定、边界和定位入口；不镜像函数签名、字段和文件路径，不写不确定信息，保持原格式并保证幂等。
6. 有候选写入时按 reference 展示 diff 并确认范围；无法交互则停止，把等待确认列为补偿项。
7. 逐文件精准编辑，每次编辑后重新读取目标片段。失败时保留已完成编辑，不自动回滚，记录补偿项。
8. 输出来源、已更新文件、跳过依据、失败与补偿。archive 已完成时同步失败也不回滚。

## 输出

总结 change、更新文件和内容、跳过文件及依据、待确认问题和补偿项。
