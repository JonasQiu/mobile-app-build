import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

// root = apps/web/ (this file lives in apps/web/tests/)
const root = new URL("../", import.meta.url);
// From apps/web/ it is two levels up to the repo root, then into packages/codegen.
const codegen = new URL("../../packages/codegen/", root);

test("mobile input preserves the requirement instead of selecting a keyword template", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  assert.match(app, /TEXT \+ LINKS/);
  assert.match(app, /只保存原始需求/);
  assert.match(app, /不会匹配模板/);
  assert.match(app, /await runProject\(data\.project\.id\)/);
  assert.doesNotMatch(app, /function buildPlan/);
  assert.doesNotMatch(app, /previewKindForPrompt/);
  assert.doesNotMatch(app, /const FILES/);
  assert.doesNotMatch(app, /const LOGS/);
});

test("the hosted control surface has no built-in generated-project preview route", async () => {
  await assert.rejects(access(new URL("app/preview/page.tsx", root)));
  await assert.rejects(access(new URL("app/preview/PreviewProject.tsx", root)));
});

test("the browser dispatches a server-side job and never calls localhost", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  assert.match(app, /api\/v1\/projects/);
  assert.match(app, /\/jobs/);
  assert.doesNotMatch(app, /RUNNER_URL/);
  assert.doesNotMatch(app, /localhost:5174/);
  await assert.rejects(access(new URL("app/api/generate/route.ts", root)));
  await access(new URL("app/api/v1/projects/[projectId]/jobs/route.ts", root));
  const jobsRoute = await readFile(new URL("app/api/v1/projects/[projectId]/jobs/route.ts", root), "utf8");
  assert.match(jobsRoute, /resolveRunnerEndpoint/);
  assert.match(jobsRoute, /CODEX_RUNNER_TOKEN/);
  assert.match(jobsRoute, /healthUrl/);
  assert.match(jobsRoute, /EXECUTOR_UNHEALTHY/);
  assert.match(jobsRoute, /EXECUTOR_UNREACHABLE/);
  assert.match(jobsRoute, /响应缺少任务编号/);
  assert.doesNotMatch(jobsRoute, /callbackToken.*JSON\.stringify/s);
  await access(new URL("package.json", codegen));
  await access(new URL("src/generate.js", codegen));
});

test("expired runner endpoints can self-register, rotate, and be repaired from the UI", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const endpoint = await readFile(new URL("app/lib/runner-endpoint.ts", root), "utf8");
  const heartbeat = await readFile(new URL("app/api/v1/runner/heartbeat/route.ts", root), "utf8");
  const recover = await readFile(new URL("app/api/v1/runner/recover/route.ts", root), "utf8");
  assert.match(app, /修复连接/);
  assert.match(app, /\/api\/v1\/runner\/recover/);
  assert.match(endpoint, /runner_endpoints/);
  assert.match(endpoint, /rotate_requested_at/);
  assert.match(heartbeat, /RUNNER_CALLBACK_TOKEN/);
  assert.match(heartbeat, /registerRunnerEndpoint/);
  assert.match(recover, /requestRunnerRotation/);
});

test("only a trusted evidence callback may mark a project delivered", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const projectsRoute = await readFile(new URL("app/api/projects/route.ts", root), "utf8");
  const deliveryRoute = await readFile(new URL("app/api/v1/projects/[projectId]/delivery/route.ts", root), "utf8");
  assert.doesNotMatch(app, /method:\s*"PATCH"/);
  assert.match(projectsRoute, /客户端不能直接标记交付/);
  assert.match(deliveryRoute, /RUNNER_CALLBACK_TOKEN/);
  assert.match(deliveryRoute, /export async function GET/);
  assert.match(deliveryRoute, /oai-authenticated-user-email/);
  assert.match(deliveryRoute, /mobileSpecPassed/);
  assert.match(deliveryRoute, /buildPassed/);
  assert.match(deliveryRoute, /deployPassed/);
  assert.match(deliveryRoute, /url\.protocol === "https:"/);
  assert.match(deliveryRoute, /url\.hostname !== controlHostname/);
});

test("project polling synchronizes trusted runner evidence before delivery", async () => {
  const projectsRoute = await readFile(new URL("app/api/projects/route.ts", root), "utf8");
  assert.match(projectsRoute, /resolveRunnerEndpoint/);
  assert.match(projectsRoute, /jobs\/\$\{encodeURIComponent\(project\.id\)\}/);
  assert.match(projectsRoute, /mobileSpecPassed/);
  assert.match(projectsRoute, /buildPassed/);
  assert.match(projectsRoute, /deployPassed/);
  assert.match(projectsRoute, /validDeliveryUrl\(job\.url\)/);
  assert.match(projectsRoute, /executionProgress/);
  assert.match(projectsRoute, /executionMessage/);
  assert.match(projectsRoute, /executionEvents/);
});

test("history opens project details and execution view renders live progress messages", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  assert.match(app, /function openProject\(item: ProjectRecord\)/);
  assert.match(app, /onClick=\{\(\) => openProject\(item\)\}/);
  assert.match(app, /className="live-progress"/);
  assert.match(app, /className="live-console"/);
  assert.match(app, /POLL_INTERVAL_MS = 15_000/);
  assert.match(app, /每 15 秒同步/);
  assert.doesNotMatch(app, /return isExternalDeliveryUrl\(item\.previewUrl\) \? <a className="project-row"/);
});

test("history deletion is ownership-scoped and rejects active projects", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const deleteRoute = await readFile(new URL("app/api/projects/[projectId]/route.ts", root), "utf8");
  assert.match(app, /method: "DELETE"/);
  assert.match(app, /确认删除/);
  assert.match(deleteRoute, /owner_user_id = \?/);
  assert.match(deleteRoute, /status NOT IN \('dispatching', 'building'\)/);
  assert.match(deleteRoute, /进行中的需求不能删除/);
});

test("server atomically enforces a maximum of two active executions", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const projectsRoute = await readFile(new URL("app/api/projects/route.ts", root), "utf8");
  const jobsRoute = await readFile(new URL("app/api/v1/projects/[projectId]/jobs/route.ts", root), "utf8");
  assert.match(projectsRoute, /MAX_ACTIVE_PROJECTS = 2/);
  assert.match(projectsRoute, /EXECUTION_LIMIT_REACHED/);
  assert.match(jobsRoute, /COUNT\(\*\).*status IN \('dispatching', 'building'\)/s);
  assert.match(jobsRoute, /< \?/);
  assert.match(jobsRoute, /SET status = 'dispatching'/);
  assert.match(app, /executionCapacity\.active >= executionCapacity\.max/);
});

test("Codex implementation progress exposes meaningful runner events", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const runner = await readFile(new URL("runner.mjs", codegen), "utf8");
  const generate = await readFile(new URL("src/generate.js", codegen), "utf8");
  assert.match(generate, /phase: "complete"/);
  assert.match(generate, /fileCount/);
  assert.match(runner, /Codex 正在读取已通过门禁的 Mobile Spec/);
  assert.match(runner, /Codex 已返回结构化实现/);
  assert.match(runner, /正在校验 Codex 输出的路径/);
  assert.match(app, /STAGE_LABELS\[event\.stage/);
});

test("running projects can be paused and terminal projects can continue or rerun", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const pauseRoute = await readFile(new URL("app/api/v1/projects/[projectId]/pause/route.ts", root), "utf8");
  const jobsRoute = await readFile(new URL("app/api/v1/projects/[projectId]/jobs/route.ts", root), "utf8");
  const deliveryRoute = await readFile(new URL("app/api/v1/projects/[projectId]/delivery/route.ts", root), "utf8");
  const projectsRoute = await readFile(new URL("app/api/projects/route.ts", root), "utf8");
  assert.match(app, /暂停执行/);
  assert.match(app, /继续执行/);
  assert.match(app, /重跑/);
  assert.match(app, /\/pause/);
  assert.match(pauseRoute, /requireSession/);
  assert.match(pauseRoute, /owner_user_id = \?/);
  assert.match(pauseRoute, /status = 'paused'/);
  assert.match(jobsRoute, /"continue", "rerun", "step"/);
  assert.match(jobsRoute, /targetStage/);
  assert.match(deliveryRoute, /body\?\.status === "paused"/);
  assert.match(projectsRoute, /job\.status === "paused"/);
  assert.match(projectsRoute, /RUNNER_SYNC_STATUSES = \[\.\.\.ACTIVE_PROJECT_STATUSES, "queued", "ready", "paused", "failed"\]/);
});

test("successful stages are reusable, individually executable, and expose Markdown artifacts", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  const projectsRoute = await readFile(new URL("app/api/projects/route.ts", root), "utf8");
  const jobsRoute = await readFile(new URL("app/api/v1/projects/[projectId]/jobs/route.ts", root), "utf8");
  const deliveryRoute = await readFile(new URL("app/api/v1/projects/[projectId]/delivery/route.ts", root), "utf8");
  const artifactRoute = new URL("app/api/v1/projects/[projectId]/artifacts/[stage]/route.ts", root);
  await access(artifactRoute);
  assert.match(app, /label: "继续"/);
  assert.match(app, /label: "重跑"/);
  assert.match(app, /label: "规格"/);
  assert.match(app, /label: "实现"/);
  assert.match(app, /label: "构建"/);
  assert.match(app, /label: "部署"/);
  assert.match(app, /function MarkdownPreview/);
  assert.match(app, /Markdown 预览/);
  assert.match(app, /openArtifacts\(artifactStageKey\)/);
  assert.match(jobsRoute, /复用同一需求中已经成功的步骤/);
  assert.match(deliveryRoute, /body\?\.status === "checkpointed"/);
  assert.match(projectsRoute, /job\.status === "checkpointed"/);
});

test("failed single steps retain their error context and repair in place", async () => {
  const jobsRoute = await readFile(new URL("app/api/v1/projects/[projectId]/jobs/route.ts", root), "utf8");
  const runner = await readFile(new URL("runner.mjs", codegen), "utf8");
  const generate = await readFile(new URL("src/generate.js", codegen), "utf8");
  const specWorkflow = await readFile(new URL("src/spec-workflow.js", codegen), "utf8");
  assert.match(jobsRoute, /失败则沿用该步骤的错误上下文原地修复/);
  assert.match(jobsRoute, /previousDeliveryUrl: project\.previewUrl/);
  assert.match(runner, /finishReusedJob/);
  assert.match(generate, /readRepairState/);
  assert.match(generate, /prevBuildError: repairError/);
  assert.match(specWorkflow, /mobile-spec-progress\.json/);
  assert.match(specWorkflow, /phase: "reused"/);
});
