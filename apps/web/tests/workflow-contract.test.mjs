import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

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
