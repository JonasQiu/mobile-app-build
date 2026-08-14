# @mobile-app-build/mobile-spec

Mobile Spec 是仓库自研的规格驱动工作流，面向 H5、iOS、Android 和 Harmony 项目管理 Proposal、Specs、Design、Review、Tasks、Coding、Verify 与 Archive 阶段。

核心能力包括：

- 文本、项目内文件和 HTTP(S) URL 需求来源。
- 阶段状态、artifact、gate、stale 判定与失败恢复。
- H5 与 Native Schema 注册。
- Claude Code / Codex file-based skills 安装。
- 本地 workflow sidecar 与 JSONL 观测事件。

## 开发

要求 Node.js 18+：

```bash
npm ci
npm test
```

常用命令：

```bash
node bin/mobile-spec.js --help
node bin/mobile-spec.js init /tmp/test-project -p h5 --tools claude,codex
node bin/mobile-spec.js update /tmp/test-project
node bin/mobile-spec.js clean
```

创建需求时可组合用户原文、项目内文件和补充链接：

```bash
mobile-spec workflow hook --name preNew --change first-build \
  --text-file requirements/first-build.md \
  --source "https://example.com/reference" --json
```

`MOBILE_SPEC_HOME_OVERRIDE` 用于指定 Schema、workflow sidecar 和本地事件的用户级存储根目录。

## 目录

```text
bin/                    # CLI 入口
scripts/commands/       # init、update、clean、upgrade、workflow
scripts/install/        # Agent skills 安装
scripts/schema/         # Schema 注册与用户级目录管理
scripts/workflow/       # 状态、gate 与 sidecar
scripts/monitor.js      # 本地阶段事件记录
schemas/                # 平台 Schema、模板与配置
.agents/                # 随包发布的阶段 Skills
test/                   # Node.js 行为测试
```
