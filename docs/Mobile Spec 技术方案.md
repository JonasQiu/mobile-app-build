# Mobile Spec 技术方案

更新日期：2026-08-14

## 1. 定位

Mobile Spec 是 Mobile Build 自研的规格驱动交付引擎。它把自然语言需求转成 Proposal、Specs、Design、Review 和 Tasks，并由确定性 gate 决定是否允许进入 Codex 实现、生产构建与部署。

当前 Web 生成链路已正式使用这套流程；iOS、Android 和 Harmony 已具备 Schema 与生命周期骨架，平台级构建和验证能力按路线图持续完善。

## 2. 核心结构

```text
Mobile Spec
├── Workflow Kernel   # stage、gate、artifact、stale、恢复与归档
├── Source Model      # 文本、文件和 HTTP(S) URL
├── Platform Schema   # H5、iOS、Android、Harmony
├── Stage Skills      # Proposal、Design、Task、Coding、Verify、Archive
└── Local Evidence    # sidecar、检查结果和 JSONL 事件
```

Workflow Kernel 只处理确定性状态与文件。Stage Skills 负责语义判断和任务编排，所有完成状态最终由 Kernel 根据结构化 sidecar、artifact 内容和 gate 结果判定。

## 3. 需求来源模型

Mobile Spec 接受三类来源：

- 用户直接输入的文本。
- 项目工作区内的 Markdown 或文本文件。
- 一个或多个 HTTP(S) 补充链接。

标准来源记录：

```yaml
source:
  type: text | link | composite
  text: optional-string
  textFile: optional-project-relative-path
  links:
    - type: url
      url: https://example.com/reference
  capturedAt: iso-time
```

来源解析执行工作区边界、文件大小和 URL 协议校验。多来源冲突且会改变范围或验收时，Proposal 必须记录未决问题并停止 ready。

## 4. Stage 与 artifact

| Stage | 主要输出 | 完成门禁 |
|---|---|---|
| Propose | `proposal.md`、`specs/**/*.md` | 目标、范围、行为与未决问题完整 |
| Design | `design.md`、`review.md` | 技术方案完整且独立评审通过 |
| Task | `tasks.md` | 任务可执行、路径和验证命令明确 |
| Coding | 页面源码与任务勾选 | 实现与生产构建通过 |
| Verify | 验证结果与证据 | 必需检查全部通过 |
| Archive | 归档与上下文同步 | artifact、事件和补偿项收口 |

每个 Stage 都定义输入、输出、entry gate、completion gate、stale 条件和恢复策略。模型或 Skill 不能自行宣告门禁通过。

## 5. Web 生成集成

Runner 为每个项目创建隔离工作区，并按以下顺序执行：

1. 保存用户原始需求文件。
2. 创建 H5 Schema 工作区。
3. 执行 Propose，生成 Proposal 与 Specs 并通过 gate。
4. 执行 Design，生成 Design 与 Review 并通过 gate。
5. 执行 Task，生成 Tasks 并通过 gate。
6. 将通过门禁的 artifact 提供给 Codex 生成页面。
7. 执行文件校验、`npm ci`、生产构建、部署与公网健康检查。

任一 Mobile Spec artifact 缺失、状态错误或 gate 失败时，Runner 停止后续实现，不生成交付 URL。

Mobile Spec 全部通过后，Runner 写入绑定原始需求 SHA-256 的规格检查点，记录 `change` 与 `pageSpecId`。继续执行只有在 marker 和 Proposal、Spec、Design、Review、Tasks 五份文件都存在且非空时才复用；单独重跑规格会清除下游实现、构建和部署检查点。

控制站的步骤产物面板通过受鉴权 Runner 接口读取这五份 `.md` 文件，并在浏览器中安全渲染 Markdown；不允许浏览器传入任意文件路径。

## 6. 状态与本地证据

Workflow 状态保存在：

```text
~/.mobile-spec/workflow/projects/<project-hash>/
├── current.yaml
└── changes/<change-id>/
    ├── source.json
    ├── checks/*.json
    ├── events.jsonl
    └── agent-actions.jsonl
```

阶段观测事件保存在 `~/.mobile-spec/monitor/`。Runner 通过 `MOBILE_SPEC_HOME_OVERRIDE` 为每个任务指定独立目录，避免并发任务互相污染。

## 7. Schema 与 Skills

`packages/mobile-spec/schemas/` 保存平台 Schema、模板和配置；`.agents/` 保存可安装的阶段 Skills。公共 Skills 适用于所有平台，H5 清单额外包含通用字体能力。

来源、平台和 Agent 差异通过显式配置处理，不在核心流程中写入业务模板或固定产品知识。

## 8. 验证体系

- Unit：来源解析、路径隔离、状态转换和 gate。
- Contract：Stage 输入输出、artifact 路径和 sidecar 字段。
- Fixture E2E：每个平台完整生命周期。
- Runner E2E：需求到 Mobile Spec、Codex、生产构建和部署。
- Residue scan：包名、URL、模板和文档的一致性检查。

## 9. 当前边界

- Web Proposal、Specs、Design、Review、Tasks 已接入真实生成链路。
- 原生平台当前提供 Schema 和阶段骨架，尚未接入云端原生构建环境。
- Workflow sidecar 与事件当前存储在 Runner 文件系统，持久任务服务尚未实现。
- 稳定版本发布前还需完成全平台 fixtures、恢复测试和跨 Agent 合同测试。
