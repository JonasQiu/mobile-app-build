// Integration test (no API key needed): copies the golden fitness-web sample
// into a temp dir and runs the real build pipeline (npm install + next build)
// against it. Proves runBuild succeeds on a known-good project, so any failure
// in the full pipeline can be attributed to the LLM's output, not the engine.
import assert from "node:assert/strict";
import { cpSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { runBuild } from "../src/build.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const FIXTURE = join(repoRoot, "generated", "fitness-web");

const SKIP = new Set(["node_modules", ".next", ".git", ".turbo", ".openai"]);

test(
  "runBuild goes green on the golden fitness-web fixture",
  { timeout: 240_000 },
  async () => {
    assert.ok(existsSync(FIXTURE), `fixture exists: ${FIXTURE}`);
    const out = join(tmpdir(), `mbcodegen-build-${randomUUID()}`);
    try {
      cpSync(FIXTURE, out, {
        recursive: true,
        filter: (src) => {
          const rel = relative(FIXTURE, src);
          if (!rel) return true;
          const top = rel.split(sep)[0];
          return !SKIP.has(top);
        },
      });

      const result = await runBuild(out);
      if (!result.ok) {
        // Surface the build log on failure so the test output is actionable.
        console.error("--- build log ---\n" + result.log);
      }
      assert.equal(result.ok, true, `build should succeed (exit ${result.exitCode})`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
);
