# Spec: <页面名称或共享规则域>

<!--
以下是生成约束，不在 Spec 渲染结果中展示：
- **目标**：在 Proposal 确认的“做什么 / 不做什么”边界内，按页面直接记录详细需求并形成可测试的行为契约。
- **权威输入**：文末状态为 `ready` 的 `proposal.md` 定义为什么做、做什么、不做什么；PRD 与用户 / PM 明确确认定义受影响页面、模块、产品组件、用户故事、具体需求、业务规则、验收场景和异常边界。页面 Spec 只写当前 page-spec-id 的需求；共享 Spec 只写当前 shared Spec ID 的跨页面规则。
- **评审边界**：Specs 是 Agent、测试和一致性检查使用的派生产物，不要求 RD 单独评审。RD 只需确认 Proposal 没有重大问题，并重点评审 Design。
- **内容边界**：只描述具体要改什么以及系统应该做什么，不从 Design、接口文档或代码反推需求。不得超出 Proposal 的“做什么 / 不做什么”边界。行为事实不足时停止并报告，不生成猜测性规格；只有缺失事实会改变 Proposal 的三项结论时，才回到 Proposal 增加未决问题并标记为 `blocked`。
- **格式约束**：OpenSpec 的 `## ADDED/MODIFIED/REMOVED/RENAMED Requirements`、`### Requirement:` 和 `#### Scenario:` 标题层级不得改变。Requirement 的第一段必须是包含 MUST 或 SHALL 的规范行为；需求详情与来源写在规范行为之后。
- 最终 Spec 只保留本次 change 实际涉及的变更章节；不涉及的 ADDED、MODIFIED、REMOVED 或 RENAMED 章节及其示例必须删除。

根据 PRD 与用户 / PM 确认划分受影响页面。每个页面只生成一个 `specs/<page-spec-id>/spec.md`，H1 写页面名称，目录名使用稳定的 kebab-case Spec ID；只有无法归属单一页面的规则可以使用 `specs/shared-<domain>/spec.md`。OpenSpec 只识别 `specs/` 下一层目录中的 `spec.md`，不得增加页面以下的目录层级。
页面 Spec 只覆盖当前 H1 页面；共享 Spec 只覆盖当前 shared Spec ID 的跨页面规则，不得复制页面 Spec 已定义的行为。
ADDED 与 MODIFIED 内的 Requirement 分别按模块 → 产品组件顺序连续排列；同一路径的 Requirement 必须相邻，不在章节之间混排，也不在本文件复制产品层级树。
产品组件是可选层级：Requirement 描述整个模块或横跨多个产品组件时省略；能够归属单个产品组件时必须填写，不得因为信息缺失而省略。
模块、产品组件不得使用额外 Markdown 标题分组，否则会破坏 OpenSpec Requirement 边界；使用每条 Requirement 内的「需求范围」表达归属。共享 Spec 无法归属单一模块或产品组件时，需求范围填写对应规则域，并在需求来源后增加「影响页面」。
Requirement 名称只描述稳定行为，不包含页面路径，避免产品层级调整被误判为 Requirement 重命名。
-->

## ADDED Requirements

### Requirement: <稳定的行为名称>

系统 MUST <可观察、可验证的行为>。

**需求改动点**：<直接说明本次新增、修改、移除或重命名什么>
**需求类型**：新增
**需求范围**：<模块> → <产品组件（可选）>
**用户故事 / 预期结果**：作为 <用户>，我希望 <能力或行为变化>，从而 <用户可感知结果>
**需求来源**：<PRD 章节 / 用户或 PM 明确确认>

<!-- 仅 shared Spec 增加：**影响页面**：<页面 / 模块 / 产品组件>；页面 Spec 删除此行。 -->

#### Scenario: <场景名称>

- **WHEN** <条件>
- **THEN** <期望结果>
- **AND** <补充结果，可选>

## MODIFIED Requirements

<!--
从 openspec/specs/<page-spec-id-or-shared-spec-id>/spec.md 复制完整已有 Requirement 后再修改。
Requirement 标题必须保持与已有规格完全一致；不得只写局部差异。
规范行为仍放在需求详情之前，并保留所有仍然有效的 Scenario。
Requirement 使用与 ADDED 相同的「需求改动点」「需求类型：修改」「需求范围」「用户故事 / 预期结果」「需求来源」格式，并按模块 → 产品组件（可选）连续排列。
-->

## REMOVED Requirements

<!-- 每个移除项使用已有 Requirement 的完整名称，并填写 Reason 和 Migration。 -->

### Requirement: <已有 Requirement 的完整名称>

**Reason**：<移除原因>
**Migration**：<迁移或替代行为；无迁移时说明影响>

## RENAMED Requirements

<!-- 仅行为名称变化且行为本身不变时使用。 -->

- FROM: `### Requirement: <原名称>`
- TO: `### Requirement: <新名称>`
