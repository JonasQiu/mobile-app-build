# DSpec

本项目使用 DSpec 管理需求交付流程（H5 / Android / iOS / Harmony）。

## 目录结构

```text
openspec/
  changes/          # 每个需求变更一个子目录，仅保存可审阅的需求/设计/任务正文
  config.yaml       # 当前项目的 schema、规则与 hook 配置
  README.md         # 本文件
```

DSpec 的 current、checks、events、source、verify 等过程状态统一保存在
`~/.dspec/workflow/projects/<project-hash>/`，不会写入本项目的 `openspec/`。

## 常用 Stage Skill

```text
dspec-proposal <望岳链接|Cooper文档链接> [change-id]  # 读取 PRD，生成 proposal.md + specs/**/*.md
dspec-design <change-id>    # 生成 design.md + review.md
dspec-task <change-id>      # 生成 tasks.md
dspec-coding <change-id>    # 实现任务并勾选 tasks
dspec-verify <change-id>    # 按风险 profile 执行 AI CR、场景与适用自动化检查
dspec-archive <change-id>   # 归档 change，并触发上下文同步 hook
```

开发中方案变化使用 `dspec-change`。

## 初始化 / 升级 schema

如果本地 schema 不是最新版本，执行：

```bash
dspec update
```
