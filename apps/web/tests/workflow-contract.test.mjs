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
  assert.match(jobsRoute, /CODEX_RUNNER_URL/);
  assert.match(jobsRoute, /CODEX_RUNNER_TOKEN/);
  assert.doesNotMatch(jobsRoute, /callbackToken.*JSON\.stringify/s);
  await access(new URL("package.json", codegen));
  await access(new URL("src/generate.js", codegen));
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
  assert.match(projectsRoute, /CODEX_RUNNER_URL/);
  assert.match(projectsRoute, /jobs\/\$\{encodeURIComponent\(project\.id\)\}/);
  assert.match(projectsRoute, /mobileSpecPassed/);
  assert.match(projectsRoute, /buildPassed/);
  assert.match(projectsRoute, /deployPassed/);
  assert.match(projectsRoute, /validDeliveryUrl\(job\.url\)/);
});
