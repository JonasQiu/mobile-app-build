---
name: dspec-design
description: 生成 DSpec design 与 review 并通过设计 gate。用于技术方案阶段；不要用于需求提案或编码。
license: MIT
---

# DSpec Design

完成 design stage，并在本 skill 内直接生成 review；不调用旧 OpenSpec skill。

## 文档读取规则

| 文档 / 材料 | 读取要求 | 作用 | 读取规则 |
|---|---|---|---|
| `proposal.md` | 必读 | 定义为什么做、做什么、不做什么 | 作为需求范围边界，不得扩大或改写 |
| `specs/**/*.md` | 必读 | 定义页面详细需求、行为与验收 | 每条 Requirement 必须被实现方案覆盖 |
| 原始 PRD / 用户或 PM 明确确认 | 涉及静态内容时必读 | 定义静态文案、业务含义和产品内容 | 只补充内容事实，不绕过 Proposal / Specs 扩大需求 |
| 后端技术方案 | 已登记且与本次方案相关时必读 | 提供服务依赖、处理链路与降级约束 | 只读当前 change 相关章节 |
| 接口文档 | 涉及接口且已提供时必读 | 提供协议、字段、错误码与异常处理 | 与真实接口数据交叉确认 |
| 真实接口返回 / 联调数据 | 涉及动态内容且可获取时必读 | 定义动态字段、状态、枚举与展示值 | 以真实数据为准，不用设计稿示例替代 |
| 现状代码 | 必读 | 确认现状、复用能力与代码落点 | 只读当前 change 相关范围 |
| 项目规则与上下文文档 | AGENTS / config 指定时必读 | 提供模块边界、术语、机制和编码约束 | 只读路由到的相关文档 |
| 设计稿链接 / 截图 / 设计还原产物 | 涉及 UI 时必读 | 提供布局、颜色、字号、间距、图形和视觉层级等样式证据 | 不作为文案、业务含义、字段、状态、枚举或展示值的事实来源 |
| Proposal 登记的其他实现材料 | 与本次方案相关时必读 | 补充实现证据 | 只读相关材料 |

## 执行约束

- Proposal、Specs 是需求范围、行为与验收的权威输入；原始 PRD 只补充静态内容事实，不得重新解释或扩大需求。
- 设计稿只决定样式；静态内容以 PRD / 用户或 PM 明确确认为准，动态内容以真实接口返回 / 联调数据为准。设计稿示例与这些来源不一致、缺省或不完整时，Agent 按此优先级直接处理，不询问用户，也不记为风险。
- 只有权威内容来源本身缺失或互相冲突、且会影响方案定案时，才记录来源、影响和 Owner；不得静默改写需求。
- 任一 hook 返回非空 `agentActions` 时，读取 [references/agent-actions.md](references/agent-actions.md) 并按协议处理；为空时不读取。
- hook 顶层 `ok: false` 时停止；`deterministic.monitor` 不表示中心已接收或判定通过，失败只报 warning，不覆盖 gate，也不由 DSpec 重试。

## 流程

1. 执行 `preStage --stage design`；顶层 ok 且 blocking actions 完成后，执行 `dspec workflow plan --stage design --change <change> --json` 核对依赖、artifacts、路径和 gate。
2. 执行 `openspec instructions design --change <change>`，严格按“文档读取规则”读取输入并写 `design.md`：
   - 模板目标、权威输入、内容边界、提示和自检只能保留为 HTML comment 或在生成时省略，不得改写为 Design 的可见正文。
   - H5 Design 先给出评审摘要与整体方案，按模板固定生成 Mermaid 实现流程图，按语义标题组织实现改动并覆盖页面和 shared Specs；关键设计使用语义标题。Native 按当前模板组织。
   - 只在实现方案中记录会影响设计的证据与结论；材料读取路径、读取状态及无设计影响的材料只写阶段输出摘要。
3. 确认文件非空，对实际路径执行 `postNode --stage design --node design`；失败时修复，不进入 review。
4. 刷新 OpenSpec status，确认 review ready；否则停止并报告依赖。
5. 执行 `openspec instructions review --change <change>`，读取 proposal/specs/design 并写 `review.md`，末尾输出唯一 `status: pass|blocked`。
6. 对 review 实际路径执行 `postNode review`；通过后执行 `postStage design`。
7. 只有 postStage 顶层 ok 且 `deterministic.check.ok: true` 才进入 task；否则列出 checks、来源和 owning artifact。

## 输出

总结 design/review、已读 / 未读输入、内容裁决、冲突与未决问题、review status、agentActions、gate 结果和恢复步骤。
