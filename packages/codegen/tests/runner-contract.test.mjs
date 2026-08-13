import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerUrl = new URL("../runner.mjs", import.meta.url);

test("trusted runner is asynchronous, authenticated, and evidence gated", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  assert.match(runner, /CODEX_RUNNER_TOKEN/);
  assert.match(runner, /RUNNER_CALLBACK_TOKEN/);
  assert.match(runner, /setImmediate\(\(\) => executeJob\(job\)\)/);
  assert.match(runner, /status:\s*"delivered"/);
  assert.match(runner, /mobileSpecPassed:\s*true/);
  assert.match(runner, /buildPassed:\s*true/);
  assert.match(runner, /deployPassed:\s*true/);
  assert.match(runner, /DeploymentProvider is not configured/);
  assert.doesNotMatch(runner, /send\(res, 200, \{\s*ok: true,\s*previewUrl/s);
});

test("trusted runner fails closed when required secrets are missing", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  assert.match(runner, /if \(!RUNNER_TOKEN \|\| !supplied \|\| !timingSafeEqual/);
  assert.match(runner, /send\(res, 401, \{ error: "unauthorized runner request" \}\)/);
  assert.match(runner, /!CALLBACK_TOKEN \|\| \(!process\.env\.OPENAI_API_KEY && !process\.env\.CODEX_BIN\)/);
  assert.match(runner, /send\(res, 503, \{ error: "runner secrets are incomplete" \}\)/);
  assert.match(runner, /waitForPublicUrl\(url\)/);
  assert.match(runner, /CODEGEN_DEPLOYMENT_PROVIDER === "cloudflare-quick-tunnel"/);
  assert.match(runner, /req\.url\?\.startsWith\("\/jobs\/"\)/);
  assert.match(runner, /CODEGEN_DISABLE_CALLBACK === "1"/);
});
