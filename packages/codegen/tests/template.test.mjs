import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { copyTemplate, TEMPLATE_DIR } from "../src/template.js";

test("copyTemplate copies the scaffold without node_modules / .next / .git", () => {
  const out = join(tmpdir(), `mbcodegen-template-${randomUUID()}`);
  try {
    copyTemplate(out);
    assert.ok(existsSync(join(out, "package.json")), "package.json copied");
    assert.ok(existsSync(join(out, "app", "page.tsx")), "app/page.tsx copied");
    assert.ok(existsSync(join(out, "app", "layout.tsx")), "app/layout.tsx copied");
    assert.ok(existsSync(join(out, "tsconfig.json")), "tsconfig.json copied");
    assert.ok(!existsSync(join(out, "node_modules")), "node_modules must NOT be copied");
    assert.ok(!existsSync(join(out, ".next")), ".next must NOT be copied");
    assert.ok(!existsSync(join(out, ".git")), ".git must NOT be copied");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("TEMPLATE_DIR points at a real templates/next-web dir", () => {
  assert.ok(existsSync(TEMPLATE_DIR), `template dir exists: ${TEMPLATE_DIR}`);
  assert.ok(existsSync(join(TEMPLATE_DIR, "package.json")));
});
