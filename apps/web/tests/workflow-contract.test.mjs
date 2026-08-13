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
  assert.doesNotMatch(app, /function buildPlan/);
  assert.doesNotMatch(app, /previewKindForPrompt/);
  assert.doesNotMatch(app, /const FILES/);
  assert.doesNotMatch(app, /const LOGS/);
});

test("the hosted control surface has no built-in generated-project preview route", async () => {
  await assert.rejects(access(new URL("app/preview/page.tsx", root)));
  await assert.rejects(access(new URL("app/preview/PreviewProject.tsx", root)));
});

test("generation runs in an external codegen runner, not an apps/web API route", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  // The UI talks to a separate Node runner (workerd can't spawn builds).
  assert.match(app, /RUNNER_URL/);
  assert.match(app, /\/generate/);
  // There must be no in-worker generation route — builds never run inside apps/web.
  await assert.rejects(access(new URL("app/api/generate/route.ts", root)));
  // The external engine package exists in the monorepo.
  await access(new URL("package.json", codegen));
  await access(new URL("src/generate.js", codegen));
});

test("a successful generation marks the project delivered with an external preview URL", async () => {
  const app = await readFile(new URL("app/MobileBuildApp.tsx", root), "utf8");
  // The PATCH that flips the saved requirement into a delivered, externally
  // linkable project (rendered by the existing isExternalDeliveryUrl branch).
  assert.match(app, /status:\s*"delivered"/);
  assert.match(app, /currentStage:\s*"delivered"/);
  assert.match(app, /previewUrl:\s*data\.previewUrl/);
});
