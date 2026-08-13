import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const provider = await readFile(new URL("../src/codex-cli.js", import.meta.url), "utf8");

test("Codex provider uses ephemeral read-only structured output", () => {
  assert.match(provider, /"--ephemeral"/);
  assert.match(provider, /"--sandbox", "read-only"/);
  assert.match(provider, /"--output-schema", schemaPath/);
  assert.match(provider, /schema\.parse\(JSON\.parse\(raw\)\)/);
  assert.doesNotMatch(provider, /dangerously-bypass/);
});
