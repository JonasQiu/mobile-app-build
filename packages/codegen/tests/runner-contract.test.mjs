import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerUrl = new URL("../runner.mjs", import.meta.url);

test("trusted runner is asynchronous, authenticated, and evidence gated", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  assert.match(runner, /CODEX_RUNNER_TOKEN/);
  assert.match(runner, /RUNNER_CALLBACK_TOKEN/);
  assert.match(runner, /setImmediate\(resolveExecution\)/);
  assert.match(runner, /then\(\(\) => executeJob\(job, controller\)\)/);
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
  assert.match(runner, /waitForPublicUrl\(url,\s*\{/);
  assert.match(runner, /CODEGEN_DEPLOYMENT_HEALTH_TIMEOUT_MS/);
  assert.match(runner, /公网健康检查第 \$\{attempt\} 次/);
  assert.match(runner, /if \(deployment\).*deployment\.stop\(\)/s);
  assert.match(runner, /!job\.forceRerun && await hasDeploymentCheckpoint\(outDir, specWorkRoot, job\.requirement\)/);
  assert.match(runner, /继续部署，无需重复生成/);
  assert.match(runner, /CODEGEN_DEPLOYMENT_PROVIDER === "cloudflare-quick-tunnel"/);
  assert.match(runner, /req\.url\?\.startsWith\("\/jobs\/"\)/);
  assert.match(runner, /CODEGEN_DISABLE_CALLBACK === "1"/);
  assert.match(runner, /function updateJob\(projectId, patch, eventMessage\)/);
  assert.match(runner, /function reportProgress\(projectId, event, jobId\)/);
  assert.match(runner, /events: events\.slice\(-24\)/);
  assert.match(runner, /progress: 100/);
});

test("trusted runner can cooperatively pause and cleanly rerun a job", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  assert.match(runner, /const jobControllers = new Map\(\)/);
  assert.match(runner, /const jobExecutions = new Map\(\)/);
  assert.match(runner, /const pauseMatch = req\.method === "POST"/);
  assert.match(runner, /\/pause/);
  assert.match(runner, /controller\.abort\(new DOMException\("execution paused", "AbortError"\)\)/);
  assert.match(runner, /status: "paused"/);
  assert.match(runner, /callback\(job\.callbackUrl, \{ status: "paused", stage: "paused" \}\)/);
  assert.match(runner, /forceRerun: body\?\.forceRerun === true/);
  assert.match(runner, /signal,/);
});
