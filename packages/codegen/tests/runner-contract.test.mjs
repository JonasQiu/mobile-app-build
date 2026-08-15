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
  assert.match(runner, /CODEGEN_DEPLOYMENT_TUNNEL_ATTEMPTS/);
  assert.match(runner, /for \(let deploymentAttempt = 1; deploymentAttempt <= DEPLOYMENT_TUNNEL_ATTEMPTS/);
  assert.match(runner, /部署地址 \$\{deploymentAttempt\}\/\$\{DEPLOYMENT_TUNNEL_ATTEMPTS\} · 公网健康检查第 \$\{attempt\} 次/);
  assert.match(runner, /正在自动更换地址，已成功的规格、实现和构建不会重跑/);
  assert.match(runner, /if \(deployment\).*deployment\.stop\(\)/s);
  assert.match(runner, /inspectCheckpoints\(\{ outDir, specWorkRoot, requirement: job\.requirement \}\)/);
  assert.match(runner, /已复用“\$\{stageLabel\(stage\)\}”成功检查点，不重复执行/);
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
  assert.match(runner, /\["continue", "rerun", "step"\]/);
  assert.match(runner, /targetStage/);
  assert.match(runner, /signal,/);
});

test("trusted runner supports single-stage execution and artifact reads", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  assert.match(runner, /status: "checkpointed"/);
  assert.match(runner, /writeDeploymentEvidence/);
  assert.match(runner, /readStageArtifacts/);
  assert.match(runner, /const artifactMatch/);
  assert.match(runner, /mobile-spec\|implementation\|build\|deployment/);
  assert.match(runner, /执行实现前需要成功的 Mobile Spec 检查点/);
  assert.match(runner, /执行构建前需要成功的实现检查点/);
});

test("failed steps resume in place while only an explicit rerun clears work", async () => {
  const runner = await readFile(runnerUrl, "utf8");
  const generate = await readFile(new URL("../src/generate.js", import.meta.url), "utf8");
  const stepBranch = runner.slice(runner.indexOf('} else if (job.mode === "step")'), runner.indexOf("} else {", runner.indexOf('} else if (job.mode === "step")')));
  const continueBranch = runner.slice(runner.indexOf("} else {", runner.indexOf('} else if (job.mode === "step")')), runner.indexOf("throwIfPaused(signal);", runner.indexOf("} else {", runner.indexOf('} else if (job.mode === "step")'))));
  assert.doesNotMatch(stepBranch, /await rm\(/);
  assert.doesNotMatch(stepBranch, /invalidateOutputAfter/);
  assert.doesNotMatch(continueBranch, /await rm\(/);
  assert.match(runner, /resume: job\.mode !== "rerun"/);
  assert.match(runner, /checkpoints\.includes\(target\)/);
  assert.match(runner, /直接复用检查点，不重新执行/);
  assert.match(generate, /readRepairState\(\{ outDir, requirement, stage: "build" \}\)/);
  assert.match(generate, /prevBuildError: repairError/);
  assert.match(generate, /writeRepairState\(\{ outDir, requirement, stage: "build"/);
});
