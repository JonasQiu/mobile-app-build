---
name: mobile-spec-proposal
description: 创建或继续 Mobile Spec change，生成 proposal 与 specs。用于需求提案和规格阶段；不要用于技术设计或编码。
license: MIT
---

# Mobile Spec Proposal

完成 propose stage。新建 change 接受直接文本、项目内需求文件和一个或多个补充链接；文本与链接可组合使用。继续已有 change 复用已记录来源，也可合并本次补充材料。

`proposal.md` 是唯一需要 RD 重点确认的文档；Specs 在 Proposal ready 后自动派生，不要求 RD 单独评审。

## 文档读取规则

| 文档 / 材料 | 读取要求 | 作用 | 读取规则 |
|---|---|---|---|
| 用户直接输入 / 需求文件 | 提供时必读 | 定义本次诉求、范围与验收事实 | 作为有效需求来源；按 [text-source.md](references/text-source.md) 处理 |
| HTTP(S) 链接 | 提供且与需求相关时必读 | 补充公开产品、文档或内容事实 | 按 [url-source.md](references/url-source.md) 处理；失败时保留链接和原因，不覆盖有效文本来源 |
| 用户 / PM 明确确认 | 提供时必读 | 补充需求事实 | 只采信明确确认，不推断 |
| 现状代码 | 满足读取条件时必读 | 佐证存量行为与兼容现状 | 仅涉及存量行为、问题修复、兼容边界或 PRD 无法说明现状时最小读取；不反推需求 |
| 后端技术方案 | 提供时必登记、禁读 | Design 后端输入 | 只登记链接 / 标识与类型；不打开或读取链接内容 |
| 接口文档 / 其他实现方案 | 提供时必登记、禁读 | Design 实现输入 | 只登记链接 / 标识与类型；不打开或读取链接内容 |
| 设计稿链接 | 提供时必登记、禁读 | Design 样式输入 | 只登记链接 / 标识与类型；不打开或读取链接内容 |
| 设计稿截图 | 提供时必读 | PRD 改动点的样式补充 | 样式以截图为准，文案、逻辑以 PRD 为准 |

## 执行约束

- Proposal 仅在为什么做、做什么、不做什么明确且每条未决问题均已处置时 `ready`。存在 `待确认` 时必须 `blocked`；RD 确认后续补充并记录安排和依据，也视为已处置。
- `deterministic.rules` 只做约束检查；只有规则明确点名已安装 skill、command 或 script 时才执行。
- 任一 hook 返回非空 `agentActions` 时，读取 [references/agent-actions.md](references/agent-actions.md) 并按协议处理；为空时不读取。
- hook 顶层 `ok: false` 时停止；`deterministic.monitor` 只表示本地事件记录结果，不覆盖业务 gate。

## 流程

1. 执行 `openspec status --change <change> --json` 判断 change：
   - 成功表示继续已有 change，同时读取 `mobile-spec workflow status --change <change> --json`，只使用其 `storage.*` 路径。
   - 只有明确 change not found 才进入新建；其他错误停止。
   - “继续”分支不得执行 `preNew`、`openspec new change` 或 `postNew`，不得覆盖已有 requirement source。
2. 已有 change 按状态幂等恢复：
   - workflow propose 与 OpenSpec proposal/specs 都 done 时不重写，调用 `mobile-spec workflow next --change <change> --json` 后返回。
   - workflow ready 但 artifacts 已 done 时，补开 `preStage`，用实际路径重放 `postNode` / `postStage`，再调用 next。
   - stale/rejected 从第一个受影响 artifact 继续，保留其他非空 artifact。
3. 需要生成或修订时解析来源：
   - 新建必须至少有非空文本 / 项目内需求文件，或一个可读取的 HTTP(S) 需求链接。
   - 直接文本与链接同时存在时全部登记并读取。文本定义用户当前诉求，链接补充权威细节；事实冲突且影响范围或验收时写入未决问题并停止 ready，不静默取舍。
   - 继续时按“本次显式输入 → `storage.requirementSourceFile` → 已有 proposal 来源”复用。
   - 无法获得可读取来源或核心 PRD 事实会改变范围/验收时停止，不猜测、不创建 artifact。
   - 严格按“文档读取规则”处理材料。
4. 仅在“新建”分支依次执行：
   ```bash
   mobile-spec workflow hook --name preNew --change <change> --text-file "requirements/<change>.md" [--source "<url>" ...] --json
   openspec new change <change>
   mobile-spec workflow hook --name postNew --change <change> --text-file "requirements/<change>.md" [--source "<url>" ...] --json
   ```
   仅当前一步成功且 blocking actions 完成时继续。`postNew` 还必须返回 `deterministic.sourceStored: true`，并以 `storage.requirementSourceFile` 为准。
5. 执行 `preStage --stage proposal`；通过后执行 `mobile-spec workflow plan --stage proposal --change <change> --json`，核对 artifacts、依赖、路径和 gate。
6. 执行 `openspec instructions proposal --change <change>` 并写 `proposal.md`：
   - 模板的目标、权威输入、内容边界、提示和自检只能保留为 HTML comment 或在生成时省略，不得变成可见正文。
   - 输入材料登记直接文本 / 需求文件、所有原始链接、类型和后续用途；未提供的来源元数据不能作为阻断原因。
   - H5 与 Native Proposal 都只写为什么做、做什么、不做什么；页面路由和详细需求不写入 Proposal，直接进入对应 Spec。
   - 实际读取路径、读取降级、已获取/未获取字段属于执行追踪信息，不写入 `proposal.md`。
   - 逐条记录未决问题的处置状态、处置结论和确认依据；无未决问题时保留表头并删除示例行。
   - 只有 RD 重点确认项完整，且所有未决问题均为 `已解决` 或 `已确认后续补充` 时写唯一 `status: ready`。
7. 对 proposal 实际路径执行 `postNode --stage proposal --node proposal`。`status: blocked`、缺失状态、重复状态、未决问题仍为 `待确认` 或处置缺少结论/确认依据均返回 `ok: false`；此时停止，不进入 Specs。
8. 确认 specs ready，执行 `openspec instructions specs --change <change>`：
   - H5 与 Native 均在 Proposal 的“做什么 / 不做什么”边界内，依据已读取的 PRD 与用户 / PM 确认划分页面，为每个页面选择稳定 Spec ID 并写 `specs/<page-spec-id>/spec.md`；跨页规则只写唯一 `specs/shared-<domain>/spec.md`。
   - 按当前 spec template 将受影响页面和详细需求写入对应 Spec；不得用实现材料补新需求。
   - MODIFIED/REMOVED/RENAMED 指向已有 main spec。对应存量 Requirement 尚未按页面或 shared 规则域归属时停止并要求单独迁移，不用 ADDED 制造重复。
   - 行为事实不足时停止并报告，不在 Proposal 补写行为细节；只有缺失事实会改变为什么做、做什么或不做什么时，才回写 Proposal 为 blocked。格式问题由 Agent 修正。
9. 执行 `openspec validate <change> --type change --strict --json`。通过后对每个生成的 spec 文件执行 `postNode specs`；任一失败都不执行 postStage。
10. 执行 `postStage --stage proposal`；只有顶层 `ok: true` 才调用 `mobile-spec workflow next --change <change> --json`。

## 输出

总结 change、全部文本与链接来源、读取路径、已读需求与设计稿截图、未读链接类 Design 输入、Proposal 状态、Specs、rules、agentActions、gate 结果与下一阶段。不得要求 RD 逐份确认 Specs；失败时列出原因、影响和恢复步骤。
