# @didi/dspec

OpenSpec **dspec** schema 管理 CLI —— 面向 H5 / iOS / Android / Harmony 的需求交付流程包。

DSpec 的安装、接入和使用方式请阅读：[DSpec 使用指南](docs/dspec-user-guide.md)（[HTML 版](docs/dspec-user-guide.html)）。

## 开发

要求 Node.js 18+，安装依赖后可运行全量或单项测试：

```bash
pnpm install
pnpm test
node --test test/register-schema.test.js
```

本地调试常用命令：

```bash
node bin/dspec.js --help
node bin/dspec.js init /tmp/test-project -p h5
node bin/dspec.js init /tmp/test-project -p ios --tools claude,codex
node bin/dspec.js update /tmp/test-project
node bin/dspec.js obs list
node bin/dspec.js clean
```

`DSPEC_HOME_OVERRIDE` 可将 `~/.dspec/` 与 OpenSpec 用户级目录重定向到临时目录，避免本地调试和测试污染真实环境。

### 目录结构

```text
bin/                    # CLI 入口
scripts/
├── commands/           # init、update、clean、upgrade、obs、workflow
├── install/            # agents、hooks、eval monitor 安装器
├── schema/             # schema 注册与用户级目录管理
├── workflow/           # workflow 状态、gate 与 sidecar
├── obs/                # 观测数据读取、整理和看板渲染
└── monitor.js          # SDD 主动埋点状态机
schemas/                # 各平台 schema、模板与配置
.agents/                # 随包发布的 stage skills
test/                   # Node.js 行为测试
```

修改前按范围阅读对应开发文档：

- [仓库架构与 CLI](docs/agent/repository-architecture.md)
- [指令职责与 workflow gate](docs/agent/instruction-ownership.md)
- [change / stale / 重跑流程](docs/agent/change-workflow.md)
- [可观测与 archive 生命周期](docs/agent/observability.md)
- [Schema 与模板发布规则](docs/agent/schema-authoring.md)

## 发布

```bash
pnpm release:beta           # 默认 patch beta：1.0.1 -> 1.0.2-beta.0
pnpm release:beta -- minor  # minor beta：1.0.1 -> 1.1.0-beta.0
pnpm release:beta -- major  # major beta：1.0.1 -> 2.0.0-beta.0
pnpm release                # stable release：由 Nx 按 conventional commits 推断版本
pnpm release -- minor       # stable minor
pnpm release -- major       # stable major
pnpm release:dry -- minor
```
