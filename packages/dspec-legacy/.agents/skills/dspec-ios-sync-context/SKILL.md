---
name: dspec-ios-sync-context
description: 将已落地的 iOS DSpec 变更同步到组件 docs 和必要路由。用于 archive 后回写；不要修改 Pods 副本。
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: dspec
  version: "1.0"
---

# iOS Context Sync

把稳定设计信息同步到 DiDriver iOS 三层上下文：组件 docs 承载业务内容，组件 AGENTS 与业务线 Index 只承载路由。

## 按需读取

仅当候选涉及新增/修改组件 AGENTS、业务线 Index 或跨 Pod 路由时，读取 [references/routing-updates.md](references/routing-updates.md)，按其中边界分类并确认。

## 核心边界

- 普通接口、状态、页面、埋点和配置变化只回写组件 `docs/*.md`。
- 只有路由、路径、摘要或适用范围变化才更新组件 `AGENTS.md` / 业务线 `Index.md`。
- 根 AGENTS 只承载全局规则和业务线入口，默认不修改。
- 不回写 `Pods/` 集成副本，只写真正的本地组件仓库。
- 只同步 artifacts 明确且已落地稳定的信息；不猜测、不镜像代码，保持幂等和最小改动。

## 流程

1. 确定 change：
   - 已指定则使用；未指定时运行 `openspec list --json` 并列出最近归档，要求用户选择，不自动选择。
   - 活跃/归档目录不唯一时确认；归档超过 30 天时先确认代码已落地。
2. 读取存在的 proposal/design/specs/review/tasks。design 缺少组件仓库、修改/只读/禁止范围、上下文清单或必要提交边界时停止补齐，不猜测目标。
3. 按顺序读取根 AGENTS/CLAUDE、业务线 Index、common、组件 AGENTS、组件 docs。路由优先级：design 明确范围 → 根入口 → Index Pod 映射 → 组件关键词路由 → docs 适用范围。
4. 路由不命中时不新建、不猜测，列为待确认。
5. 把接口契约、状态与生命周期、页面/通知/跨 Pod 边界、埋点、配置和 PRD 到代码入口映射写入组件 docs；只记录 why、关键约定、边界和定位入口。
6. 分级候选：
   - 已有 docs 的机制、流程、边界、降级或生命周期变化可以作为核心回写。
   - 任何路由类候选先读取 routing reference。
   - 纯实现细节、未确认信息、Pods 副本和已存在内容跳过。
7. 写入前展示全部候选及跳过项。核心 docs 可直接执行但仍展示预览；路由类必须确认范围。
8. 逐文件精准编辑，保持原 Markdown 风格并复读验证；失败时保留已完成修改，不回滚 archive，记录补偿项。
9. 输出来源、组件 docs、AGENTS、Index 的更新与跳过项，以及需要人工确认的问题。

## 输出

总结 change、各层更新文件和内容、跳过依据、待确认问题、失败和补偿项。
