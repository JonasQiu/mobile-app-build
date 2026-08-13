# .agents

`mobile-spec` 的 Agents / Skills 资产目录。`mobile-spec init` / `mobile-spec update` 会按技术栈选择清单，把声明的 file-based skills 安装到目标项目的 `.claude/skills/`，也可通过 `--tools claude,codex` 同步安装到 `.codex/skills/`。

## 文件结构

```text
.agents/
├── README.md
├── base.yaml          # Mobile Spec 公共阶段 skills
├── h5.yaml            # H5 技术栈清单
├── native.yaml        # Native 技术栈清单
├── hooks/             # observe.js，被动观察兜底 hook
└── skills/
    ├── mobile-spec-*/       # Mobile Spec 对外阶段入口与 H5 上下文同步
    └── opsx-*/        # 内部复用的技术栈能力
```

不安装 `/opsx:*` command dispatcher，也不安装旧 `openspec-*` skills；`mobile-spec init/update` 会精确清理 Mobile Spec 历史版本遗留的相关目录。用户只需要调用：

```text
mobile-spec-proposal
mobile-spec-design
mobile-spec-task
mobile-spec-coding
mobile-spec-verify
mobile-spec-archive
```

开发中方案变化使用 `mobile-spec-change`。

## 清单

| 清单 | 适用场景 | 当前内容 |
| --- | --- | --- |
| `base.yaml` | 所有技术栈公共复用 | `mobile-spec-proposal`、`mobile-spec-design`、`mobile-spec-task`、`mobile-spec-coding`、`mobile-spec-verify`、`mobile-spec-archive`、`mobile-spec-change` |
| `h5.yaml` | H5 项目 | `mobile-spec-sync-context`、H5 上下文/字体/顶导/埋点等辅助 skills |
| `native.yaml` | iOS / Android / Harmony 项目 | `mobile-spec-ios-sync-context`、`opsx-sync-context-native`、Native 上下文辅助 skills |

`mobile-spec init` 根据 `--platform` 加载 `base.yaml` 与对应平台清单，合并去重后安装。

## Skill 约定

每个 skill 是一个独立目录，至少包含 `SKILL.md`；条件性细节放入 `references/`：

```text
skills/<skill-name>/
├── SKILL.md
└── references/
    └── <conditional-topic>.md
```

`SKILL.md` frontmatter 至少包含：

```yaml
---
name: mobile-spec-sync-context
description: H5 Mobile Spec archive 后上下文同步。
category: Workflow
tags: [mobile-spec, workflow, context]
---
```

只有声明在某个 `*.yaml` 清单 `skills:` 中的 skill 才会被安装；新增或移除 skill 后必须同步更新清单。

## 维护指引

### 添加新 skill

1. 在 `skills/<skill-name>/SKILL.md` 中实现 skill。
2. 判断适用范围：
   - 全平台通用：加入 `base.yaml`；
   - 仅 H5：加入 `h5.yaml`；
   - 仅 Native：加入 `native.yaml`。
3. 通过 `mobile-spec init /tmp/<demo> -p <platform>` 验证安装结果。
4. 如安装行为变化，补充或更新 `test/cmd-init.test.js`、`test/cmd-update.test.js`。

### 移除 skill

1. 从所有清单的 `skills:` 中移除。
2. 删除 `.agents/skills/<skill-name>/`。
3. 更新 README、schema config 与测试断言，避免继续暴露已移除的 opsx command dispatcher。

### 修改既有 skill

- 核心流程、触发和阻断条件：修改 `SKILL.md`，保持入口精简。
- 只在特定分支需要的细节：放入 `references/`，并在 `SKILL.md` 明确读取条件。
- 输入/输出协议变化：同步更新调用方、workflow hook/gate 约定和测试。

## 与 schema 的边界

- `schemas/<platform>/schema/`：OpenSpec schema、artifact 模板和 Mobile Spec workflow 配置。
- `.agents/`：Agent 可调用的 skills 与 observe hook。

Mobile Spec stage skill 可以调用 OpenSpec CLI / instructions 读写 `openspec/changes/<change>/`，但不依赖旧 OpenSpec skill。阶段状态、gate、stale 和 hook action plan 由 `mobile-spec workflow` sidecar 负责，并统一保存在用户级 `~/.mobile-spec/workflow/projects/<project-hash>/`。

所有 sidecar 路径以 `mobile-spec workflow ... --json` 返回的 `storage.*` 为准，skill 不自行计算 project hash。agentAction 的 summary 中间文件只能创建在系统临时目录，完成回写尝试后删除，不得写入业务仓库。
