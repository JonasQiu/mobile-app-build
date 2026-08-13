# @mobile-app-build/codegen

Node 执行器：**一句需求 → Mobile Spec → OpenAI 代码生成 → 可复现安装 → Next.js 生产构建**。

它运行在独立 Node 进程中，不能放进 `apps/web` 的 Cloudflare Worker。Worker 只保存项目与任务状态；Cloud Runner 负责文件、子进程和部署。

## 硬性流程

1. 保存完整原始需求。
2. `runSpecWorkflow()` 驱动真实 Mobile Spec：Proposal → Specs → Design/Review → Tasks，并逐阶段执行门禁。
3. 只有全部 Mobile Spec 门禁通过后，才把本次 artifacts 交给模型生成 `SiteManifest`。
4. 生成器从中立 Next.js 模板初始化项目，写入完整源码和 `mobile-build-manifest.json`。
5. 执行 `npm ci` 和 `npm run build`；失败日志回传模型修复，最多三轮。
6. 构建成功的源码由 DeploymentProvider 发布。只有 Provider 返回外部 HTTPS URL 后才可标记为 delivered。

Mobile Spec 是硬门禁，不存在跳过或主题示例兜底。仓库不包含任何业务主题模板；用户需求和本次 Mobile Spec 是唯一产品事实来源。

## 环境

| 变量 | 默认值 | 用途 |
|---|---|---|
| `OPENAI_API_KEY` | 无 | 本地 runner 调用 OpenAI 时必需 |
| `CODEX_RUNNER_TOKEN` | 无 | 控制面调用 Runner 的 Bearer token |
| `RUNNER_CALLBACK_TOKEN` | 无 | Runner 回写控制面的 Bearer token |
| `CODEGEN_MODEL` | `gpt-4o` | 支持 Structured Outputs 的模型 ID |
| `CODEGEN_RUNNER_PORT` | `5174` | 本地 runner 端口 |
| `CODEGEN_WEB_ORIGIN` | `http://localhost:5173` | 本地 CORS 来源 |
| `CODEGEN_TIMEOUT_MS` | `600000` | 单次生成超时 |

## CLI

```bash
OPENAI_API_KEY=sk-... node bin/generate.mjs "做一个社区咖啡店官网" --out /tmp/coffee-site
```

`runner.mjs` 提供受鉴权的异步 `/jobs` 协议，并回写阶段与交付证据。它必须运行在具备 Node、文件系统、子进程和外网能力的常驻执行环境。

`--serve` 与 Runner 内部 localhost 只用于健康检查，不是交付 URL。未接入真实 DeploymentProvider 时任务明确失败，绝不返回 localhost 或站内假预览。

## 测试

```bash
npm ci
npm test
```

测试覆盖 manifest 约束、安全写文件、中立模板复制、Mobile Spec 工作区与真实门禁，以及中立 fixture 的生产构建。
