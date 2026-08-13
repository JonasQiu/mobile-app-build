# Mobile Spec 完整替换技术方案

## 1. 目标与当前结论

目标不是把 `dspec` 字样改成 `mobile-spec`，而是在完全不依赖滴滴内网、私有账号、私有 SDK 和隐含组织知识的环境中，保留原有规格驱动交付能力及其可验证行为。

当前仓库已经完成：

- 冻结 `packages/dspec-legacy` 作为 `@didi/dspec@1.11.0` 行为基线。
- 建立 `packages/mobile-spec` 工作副本并修改包名、CLI 和主要 stage skill 名称。
- 保留 H5、iOS、Android、Harmony schema 与生命周期骨架。

当前仍不能称为完整替换。扫描显示工作副本仍包含望岳、Cooper、SkillHub、Omega、私有 JSBridge、私有导航、WebLens、内网 registry、滴滴宿主 App 与专属字段等依赖和语义。

## 2. 不可丢失的能力

Mobile Spec 稳定版必须保留以下行为：

- `init`、`update`、`upgrade`、`clean`、`workflow`、`obs` CLI 能力。
- H5、iOS、Android、Harmony schema 注册与项目初始化。
- Proposal、Specs、Design、Review、Tasks、Coding、Verify、Archive、Context Sync 阶段。
- 每个阶段的输入、输出 artifact、gate、stale 判定、重入和失败恢复。
- Agent skills、hooks、观测事件、dashboard 和版本升级语义。
- 需求来源追溯、变更归因、验证证据和归档补偿。
- 能力缺失时明确 blocked，不能静默跳过或把必需机制降级为说明文字。

## 3. 新的四层结构

```text
mobile-spec core
├── Workflow Kernel       # 状态、stage、gate、artifact、恢复、归档
├── Skills                # 自包含文本流程与判断规则
├── Capability Protocols  # 文档、设计、调试、桥接、分析、预览等接口
└── Adapters              # 公开默认实现和可选平台实现
```

### Workflow Kernel

只处理确定性状态和文件，不知道 Cooper、望岳、Codex、Claude、Vercel 或滴滴 App。它负责：

- artifact schema 和版本。
- stage 进入、完成、blocked、stale 和重跑。
- gate 的机器可判定输入输出。
- checkpoint、幂等、锁和 crash recovery。
- 事件 envelope、观察指标和 archive 补偿。

### Skills

每个 Skill 必须包含完整、可独立阅读的工作方法，不假设调用者知道滴滴流程。Skill 负责语义判断和任务编排，但必须通过 Capability Protocol 调用外部能力。

### Capability Protocols

建议首批接口：

- `RequirementSource`：文本、Markdown、文件、HTTP URL、文档平台。
- `DesignSource`：图片、设计文件、URL 和设计平台结构化内容。
- `AgentRuntime`：推理、工具请求、继续、取消和用量。
- `VerificationRunner`：独立、可追溯的验证执行。
- `WebDebugAdapter`：浏览器、WebView、console、network 和 screenshot。
- `AppLauncher`：模拟器/真机发现、安装和打开 URL。
- `AppBridgeAdapter`：Web 标准 fallback 和宿主容器桥接。
- `AnalyticsAdapter`：事件 schema、开发实现、测试 sink 和第三方 SDK。
- `AssetResolver`：本地资产、用户 URL、公开字体和许可证信息。
- `ObservationSink`：本地 JSONL 默认实现和可选 OpenTelemetry/Webhook。

### Adapters

公开包必须自带可以离线或使用公开工具运行的默认 Adapter。例如：

- RequirementSource：pasted text、Markdown、local file、HTTP。
- Analytics：console/test sink + 自定义函数接口。
- WebDebug：Playwright 和 Chrome DevTools Protocol。
- AppLauncher：`xcrun simctl`、`adb` 和用户提供的安装包。
- Observation：本地 JSONL + 静态 dashboard。
- Bridge：标准 Web API + 用户提供的 adapter manifest。

滴滴实现只能存在于独立私有包中，例如 `@company/mobile-spec-didi-adapters`，不能从公开核心隐式加载。

## 4. 统一 artifact 与来源模型

替换专属字段：

```yaml
source:
  provider: text | file | url | document-platform | issue-tracker | custom
  external_id: optional-string
  uri: optional-string
  title: optional-string
  revision: optional-string
  digest: sha256
  retrieved_at: iso-time
  metadata: {}
```

`wangyue_id`、`cooper_url` 等旧字段迁移到 `source.provider`、`external_id`、`uri` 和 namespaced `metadata`。核心逻辑只使用通用字段；旧字段只在一次性 migration reader 中识别。

## 5. Stage 契约

每个 stage 都必须定义：

- `inputs`：所需 artifact、source、工具能力和前置 gate。
- `outputs`：文件路径、schema 版本和内容约束。
- `entryGate`：是否允许开始。
- `completionGate`：如何机器判定完成。
- `staleOn`：哪些输入变化会使输出失效。
- `resume`：中断后从哪里继续。
- `events`：开始、完成、blocked 和验证证据。

示例：

```yaml
id: proposal
inputs:
  - requirement_source
outputs:
  - proposal.md
  - specs/**/*.md
completion_gate:
  checks:
    - source_digest_recorded
    - goals_and_non_goals_present
    - behavioral_scenarios_present
    - unresolved_critical_questions_zero
stale_on:
  - requirement_source.digest_changed
```

Skill 的文字结果不能自己宣告 gate 通过；Kernel 根据结构化 sidecar 和文件内容执行确定性校验。

## 6. Skill 完整替换标准

每个 stage 或专门能力至少包含：

```text
skill-name/
├── SKILL.md              # 触发条件、完整流程、边界、失败恢复
├── references/           # 公开协议和平台无关知识
├── schemas/              # 输入输出 JSON Schema
├── scripts/              # 确定性检查或转换，不承载隐含知识
└── evals/                # 触发、流程、行为与失败场景
```

验收 Skill 时同时检查：

- 没接触过旧 DSpec 的 Agent 能仅依靠 Skill 完成流程。
- 外部能力缺失时给出通用替代或明确 blocked，不要求内网账号。
- 关键判断有 schema、脚本或 fixture 证据，不只依赖模型自述。
- Codex、Claude Code 和中立测试 harness 至少各跑一条兼容用例。

## 7. 专属能力替换映射

| 当前专属能力 | 通用核心 | 公开默认实现 | 私有扩展位置 |
|---|---|---|---|
| 望岳需求 | `RequirementSource` | 文本、文件、URL、通用 issue adapter | 独立望岳 adapter |
| Cooper PRD/安装包 | `DocumentSource` / `ArtifactSource` | Markdown、HTTP、local file | 独立 Cooper adapter |
| Omega 埋点 | `AnalyticsAdapter` | console/test sink、custom callback | 独立业务 SDK adapter |
| `@didi/*` bridge | `AppBridgeAdapter` | Web API fallback、custom manifest | 独立宿主 bridge adapter |
| 沉浸式顶导 | `NavigationShellAdapter` | CSS safe-area + Web header | 独立宿主导航 adapter |
| WebLens | `WebDebugAdapter` | Playwright、CDP、ADB/simctl | 可选 WebLens adapter |
| 滴滴 App 打开/扫码 | `AppLauncher` / `PreviewProvider` | 浏览器、二维码、模拟器、用户 APK/APP | 独立 App catalog adapter |
| SkillHub eval | `EvalRunner` / `ObservationSink` | Node test、JSONL、HTML dashboard | 可选企业 eval adapter |
| 内网字体/CDN | `AssetResolver` | 本地/用户 URL/公开字体 | 私有资产 adapter |

## 8. 迁移步骤

### Phase A：建立可执行基线

1. 冻结 legacy 包，不再直接修改。
2. 为所有 CLI、stage、gate、hook 和 dashboard 建立 golden fixtures。
3. 记录正常、blocked、stale、crash resume、verify fail 和 archive fail 的输出。
4. 扫描依赖、域名、包名、字段和 Skill 中的隐含知识。

### Phase B：先抽 Kernel 和通用数据模型

1. 把 workflow storage、stage transition、gate、事件和 obs 字段改为中立 schema。
2. 加入旧状态 migration reader；所有新写入只产生新格式。
3. 保持 legacy fixture 与新 fixture 并跑，比较行为而非文本完全相同。

### Phase C：逐类替换外部能力

按 RequirementSource → AgentRuntime → Verification → Observation → Web Debug → App Launcher → Bridge/Analytics/Asset 的顺序替换。每一类必须先有公开默认实现，再移除核心中的专属逻辑。

### Phase D：重写 Skills

逐个重写 Proposal、Design、Task、Coding、Verify、Archive、Sync Context 以及平台技能。避免一次性批量搜索替换；每个 Skill 独立通过触发、流程、失败和端到端 eval。

### Phase E：全平台验证与发布

1. H5/Next.js fixture 先通过。
2. iOS、Android、Harmony 在公开 SDK 和工具链环境通过。
3. 升级、降级、clean、obs、dashboard 和跨 Agent 兼容通过。
4. 残留扫描为零，生成 SBOM 和许可证报告。
5. 只在矩阵全部完成后解除 `private` 并发布稳定包。

## 9. 自动验证体系

测试分四层：

- Unit：ID、source、storage、gate、migration、event 和 adapter contract。
- Contract：所有 Adapter 使用同一套 conformance tests。
- Fixture E2E：每个平台完整生命周期，比较 artifacts、状态和证据。
- Clean-room：全新用户目录、公共 registry、无内网 DNS、无私有环境变量。

残留 gate 至少扫描：

- `didi`、`xiaojukeji`、`wangyue`、`cooper`、`omega`、`skillshub` 和已知内网域名。
- `@didi/*` 与私有 registry。
- 绝对用户目录、公司 App 标识、专属 deeplink 和业务事件 ID。
- 旧字段如 `wangyue_id` 的新写入。

允许的唯一命中位置是 legacy 快照、迁移 fixture 和明确标注的兼容 reader；公开运行时代码、默认 Skills、模板和文档不得命中。

## 10. 完整替换完成定义

只有同时满足以下条件才可宣布完成：

- Mobile Spec 完整替换矩阵每一项标记完成并链接自动测试。
- 每个原 stage、gate、hook、CLI 和 Skill 有可运行对应物。
- 每个专属能力有公开默认实现或清晰的可选 Adapter，不存在静默降级。
- H5、iOS、Android、Harmony clean-room E2E 通过。
- 安装、update、upgrade、obs 和 archive 行为通过恢复测试。
- 公开包 runtime、Skills、schema、模板和默认配置的内网残留为零。
- 包发布前仍通过与 legacy 行为基线的差异审查。

在此之前，`packages/mobile-spec` 必须保持内部工作副本状态，不得以“已改名”作为完成证明。
