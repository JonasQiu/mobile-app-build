// Integration test (no API key needed): copies a neutral buildable fixture
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
const FIXTURE = join(here, "fixtures", "buildable-site");

const SKIP = new Set(["node_modules", ".next", ".git", ".turbo", ".openai"]);

test(
  "runBuild goes green on the neutral buildable fixture",
  { timeout: 240_000 },
  async () => {
    assert.ok(existsSync(FIXTURE), `fixture exists: ${FIXTURE}`);
    const out = join(tmpdir(), `mbcodegen-build-${randomUUID()}`);
    const originalPath = process.env.PATH;
    try {
      // launchd user agents receive a minimal PATH that does not include fnm.
      // runBuild must still locate npm next to process.execPath and make `node`
      // available to npm/next shebangs.
      process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
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
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(out, { recursive: true, force: true });
    }
  },
);

test("runBuild classifies a missing npm executable as infrastructure failure", async () => {
  const originalNpmBin = process.env.CODEGEN_NPM_BIN;
  process.env.CODEGEN_NPM_BIN = join(tmpdir(), `missing-npm-${randomUUID()}`);
  try {
    const result = await runBuild(FIXTURE);
    assert.equal(result.ok, false);
    assert.equal(result.infrastructureError, true);
    assert.match(result.log, /npm ci .*ENOENT/);
  } finally {
    if (originalNpmBin === undefined) delete process.env.CODEGEN_NPM_BIN;
    else process.env.CODEGEN_NPM_BIN = originalNpmBin;
  }
});
