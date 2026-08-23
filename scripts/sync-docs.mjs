#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRevision = process.env.DOCS_SOURCE_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

async function text(path) {
  return readFile(join(root, path), "utf8");
}

function yes(source, pattern) {
  return pattern.test(source) ? "已实现" : "未检测到";
}

const [app, projects, projectDelete, jobs, pause, artifacts, previewApproval, runnerRecover, runnerEndpoint, runner, generate, preview, checkpoints, specWorkflow, manifest, serverAuth] = await Promise.all([
  text("apps/web/app/MobileBuildApp.tsx"),
  text("apps/web/app/api/projects/route.ts"),
  text("apps/web/app/api/projects/[projectId]/route.ts"),
  text("apps/web/app/api/v1/projects/[projectId]/jobs/route.ts"),
  text("apps/web/app/api/v1/projects/[projectId]/pause/route.ts"),
  text("apps/web/app/api/v1/projects/[projectId]/artifacts/[stage]/route.ts"),
  text("apps/web/app/api/v1/projects/[projectId]/preview-approval/route.ts"),
  text("apps/web/app/api/v1/runner/recover/route.ts"),
  text("apps/web/app/lib/runner-endpoint.ts"),
  text("packages/codegen/runner.mjs"),
  text("packages/codegen/src/generate.js"),
  text("packages/codegen/src/preview.js"),
  text("packages/codegen/src/checkpoints.js"),
  text("packages/codegen/src/spec-workflow.js"),
  text("packages/codegen/src/manifest-schema.js"),
  text("apps/web/app/lib/server-auth.ts"),
]);

const facts = [
  ["历史项目详情", yes(app, /function openProject\(item: ProjectRecord\)/), "历史条目恢复需求、状态、消息与交付入口"],
  ["实时进度 UI", yes(app, /className="live-progress"/), "七阶段、百分比、当前 message、最近事件"],
  ["15 秒状态同步", yes(app, /POLL_INTERVAL_MS = 15_000/), "统一同步所有进行中项目"],
  ["Codex 详细事件", yes(runner, /Codex 已返回结构化实现/), "生成、文件校验、写入、构建修复与部署消息"],
  ["历史记录删除", yes(projectDelete, /export async function DELETE/), "按用户隔离，进行中任务拒绝删除"],
  ["并发执行上限", yes(jobs, /MAX_ACTIVE_PROJECTS = 2/), "服务端原子占位，平台共享 Runner 最多两个进行中项目"],
  ["暂停与继续执行", yes(app + pause + runner, /暂停执行[\s\S]*status = 'paused'[\s\S]*jobControllers/), "Runner 中断当前子进程；继续复用成功检查点，重跑才从头执行"],
  ["单步执行", yes(app + jobs + runner, /label: "规格"[\s\S]*label: "预览"[\s\S]*targetStage[\s\S]*mode === "step"/), "规格、预览、实现、构建、部署可单独指定"],
  ["阶段检查点", yes(checkpoints, /findLegacySpecMarker/), "成功步骤按需求哈希持久化，旧产物自动迁移，后续继续不重复构建"],
  ["失败步骤原地续修", yes(runner + generate + specWorkflow, /直接复用检查点，不重新执行[\s\S]*readRepairState[\s\S]*mobile-spec-progress\.json/), "Mobile Spec 复用成功子阶段；Codex/构建沿用最近错误定向修复；仅重跑清空"],
  ["产物预览", yes(app + artifacts + checkpoints, /MarkdownPreview[\s\S]*readStageArtifacts/), "步骤文件可独立读取，Markdown 与 SVG 可视化预览"],
  ["生成前多图确认", yes(app + jobs + previewApproval + runner + generate + preview, /preview-option-grid[\s\S]*PREVIEW_APPROVAL_REQUIRED[\s\S]*selected_preview_id[\s\S]*awaiting_approval[\s\S]*readApprovedPreview[\s\S]*format: "svg"/), "Mobile Spec 后生成 3 份 SVG；D1 持久确认；双重校验后才进入 Codex"],
  ["沉浸式方向评审", yes(app, /sanitizeReviewSvg[\s\S]*role="dialog"[\s\S]*PREVIEW_CANVASES\.map/), "复用当前批次 3 份 SVG；三种模拟画布、键盘/焦点导航、安全失败关闭与唯一选择状态"],
  ["可信状态同步", yes(projects, /executionEvents/), "控制站服务端轮询 Runner，不接受浏览器终态"],
  ["受信任派发", yes(jobs, /CODEX_RUNNER_TOKEN/), "服务端 Bearer token 派发"],
  ["Runner 自动换址", yes(app + runnerRecover + runnerEndpoint + runner, /修复连接[\s\S]*registerRunnerEndpoint[\s\S]*maintainRunnerEndpoint[\s\S]*control-endpoint\/rotate/), "Runner 自动维护控制隧道；点击修复连接后从本机取得新地址，经服务端身份与健康检查后重派原任务"],
  ["Runner message 流", yes(runner, /function reportProgress\(projectId, event, jobId\)/), "progress/message/events，最近 24 条"],
  ["Mobile Spec 硬门禁", yes(generate, /Mobile Spec workflow is required/), "缺少或失败时停止生成"],
  ["交付 evidence", yes(runner, /mobileSpecPassed: true[\s\S]*buildPassed: true[\s\S]*deployPassed: true/), "三项证据齐全才 delivered"],
  ["生成文件安全", yes(manifest, /validateManifest/), "路径、路由、必需文件、外部字体约束"],
  ["D1 persistence", yes(serverAuth, /project_preview_approvals/), "项目、历史与预览审批持久化"],
];

const sources = [app, projects, projectDelete, jobs, pause, artifacts, previewApproval, runnerRecover, runnerEndpoint, runner, generate, preview, checkpoints, specWorkflow, manifest, serverAuth].join("\n");
const digest = createHash("sha256").update(sources).digest("hex").slice(0, 16);
const body = `# 实现状态快照

> 此文件由 \`node scripts/sync-docs.mjs\` 从源码生成。请勿手工编辑；叙述性设计请修改其他文档。

同步源提交：\`${sourceRevision}\`

源码事实指纹：\`${digest}\`

| 能力 | 状态 | 源码事实 |
|---|---|---|
${facts.map(([name, status, detail]) => `| ${name} | ${status} | ${detail} |`).join("\n")}

## 固定边界

- Runner job/message/events 当前为内存状态，不具备重启恢复。
- Runner 控制通道的 Quick Tunnel 可自动登记与轮换，但仍无 SLA；生成站点的 Quick Tunnel 也只用于开发与验收，不是生产 DeploymentProvider。
- 检查点与产物当前持久化在 Runner 本地工作区；Runner job/message/events 仍未进入共享数据库。
- Desktop Agent、源码 ZIP、跨 Runner 迁移和进程重启后自动接管执行中任务当前未实现。
- 浏览器无权写入 delivered 或部署 URL。
`;

const output = join(root, "docs", "实现状态快照.md");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, body, "utf8");
console.log(relative(root, output));
