// Trusted Node runner for the production control plane. It executes one job
// asynchronously and reports stage/evidence to the server-owned callback.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "./src/generate.js";
import {
  EXECUTION_STAGES,
  inspectCheckpoints,
  readDeploymentEvidence,
  readStageArtifacts,
  writeDeploymentEvidence,
  writeOutputCheckpoint,
} from "./src/checkpoints.js";
import { startPreview } from "./src/serve.js";
import { startQuickTunnel, waitForPublicUrl } from "./src/tunnel.js";

const localEnvFile = process.env.CODEGEN_LOCAL_ENV_FILE || "/tmp/mobile-build-runner.env";
if (existsSync(localEnvFile)) {
  for (const line of readFileSync(localEnvFile, "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

// launchd starts user agents with a minimal PATH. Keep the directory that owns
// the current Node binary visible to npm/codex/next scripts whose shebang uses
// `/usr/bin/env node`, even when the Runner itself was launched by absolute path.
const nodeBinDir = dirname(process.execPath);
const inheritedPath = process.env.PATH || "";
if (!inheritedPath.split(delimiter).includes(nodeBinDir)) {
  process.env.PATH = [nodeBinDir, inheritedPath].filter(Boolean).join(delimiter);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const WORK_ROOT = join(repoRoot, ".codegen", "work");
const SPEC_WORK_ROOT = join(repoRoot, ".codegen", "spec");
const configuredPort = process.env.CODEGEN_RUNNER_PORT;
const PORT = configuredPort === undefined ? 5174 : Number(configuredPort);
const GENERATION_TIMEOUT_MS = Number(process.env.CODEGEN_TIMEOUT_MS) || 600_000;
const DEPLOYMENT_HEALTH_TIMEOUT_MS = Math.max(30_000, Number(process.env.CODEGEN_DEPLOYMENT_HEALTH_TIMEOUT_MS) || 120_000);
const configuredTunnelAttempts = Number(process.env.CODEGEN_DEPLOYMENT_TUNNEL_ATTEMPTS);
const DEPLOYMENT_TUNNEL_ATTEMPTS = Number.isFinite(configuredTunnelAttempts) && configuredTunnelAttempts > 0
  ? Math.min(5, Math.floor(configuredTunnelAttempts))
  : 3;
const DEPLOYMENT_HEALTH_ATTEMPT_TIMEOUT_MS = Math.max(
  10_000,
  Math.floor(DEPLOYMENT_HEALTH_TIMEOUT_MS / DEPLOYMENT_TUNNEL_ATTEMPTS),
);
const RUNNER_TOKEN = process.env.CODEX_RUNNER_TOKEN || "";
const CALLBACK_TOKEN = process.env.RUNNER_CALLBACK_TOKEN || "";
const jobs = new Map();
const jobControllers = new Map();
const jobExecutions = new Map();
const previews = new Map();
const RUNNER_INSTANCE_ID = `runner_${crypto.randomUUID()}`;
const CONTROL_PLANE_URL = String(process.env.CODEGEN_CONTROL_PLANE_URL || "").trim();
const AUTO_PUBLIC_TUNNEL = process.env.CODEGEN_AUTO_PUBLIC_TUNNEL === "1";
const RUNNER_PUBLIC_HEALTH_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.CODEGEN_RUNNER_PUBLIC_HEALTH_INTERVAL_MS) || 30_000,
);
const RUNNER_REGISTRATION_REFRESH_MS = Math.max(
  RUNNER_PUBLIC_HEALTH_INTERVAL_MS,
  Number(process.env.CODEGEN_RUNNER_REGISTRATION_REFRESH_MS) || 300_000,
);
let runnerEndpointTunnel = null;
let runnerEndpointChange = null;
let registeredRunnerEndpoint = "";
let registeredRunnerAt = 0;
let runnerListeningPort = PORT;
let shuttingDown = false;

const PROGRESS = {
  queued: [4, "任务已进入执行队列"],
  "spec-workflow": [9, "正在初始化 Mobile Spec 工作区"],
  "spec-propose": [18, "正在生成 Proposal 与页面规格"],
  "spec-design": [36, "正在生成 Design 并执行设计评审"],
  "spec-task": [52, "正在拆解可执行任务并通过门禁"],
  llm: [64, "Mobile Spec 已通过，Codex 正在实现页面"],
  write: [72, "正在写入完整项目文件"],
  build: [80, "正在安装锁定依赖并执行生产构建"],
  retry: [76, "构建未通过，Codex 正在根据真实日志修复"],
  done: [88, "生产构建已通过，准备部署"],
  deployment: [92, "正在发布独立站点并执行公网健康检查"],
  delivered: [100, "部署和健康检查均已通过"],
  checkpointed: [88, "单步执行完成，检查点与产物已保存"],
  paused: [0, "执行已暂停，可从成功检查点继续"],
  failed: [100, "执行失败，未生成交付 URL"],
};

function updateJob(projectId, patch, eventMessage) {
  const current = jobs.get(projectId) || {};
  const message = eventMessage || patch.message || current.message || "";
  const events = Array.isArray(current.events) ? [...current.events] : [];
  if (message && events.at(-1)?.message !== message) {
    events.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      message,
      stage: patch.stage || current.stage || "queued",
      kind: patch.kind || "progress",
      progress: Number.isFinite(patch.progress) ? patch.progress : current.progress || 0,
    });
  }
  const next = { ...current, ...patch, message, events: events.slice(-24), updatedAt: new Date().toISOString() };
  jobs.set(projectId, next);
  return next;
}

function reportProgress(projectId, event, jobId) {
  if (jobId && jobs.get(projectId)?.id !== jobId) return;
  const [progress, baseMessage] = PROGRESS[event.stage] || [10, `正在执行 ${event.stage}`];
  const attempt = Number(event.attempt) > 1 ? `（第 ${event.attempt} 次）` : "";
  const gate = event.ok === true ? "，门禁已通过" : event.ok === false ? "，门禁未通过，正在修正" : "";
  const eventStage = String(event.stage || "unknown");
  const stage = eventStage.startsWith("spec-") || eventStage === "spec-workflow"
    ? "mobile-spec"
    : eventStage === "llm" || eventStage === "write" || eventStage === "retry"
      ? "implementation"
      : eventStage === "done" ? "build" : eventStage;
  let message = `${baseMessage}${attempt}${gate}`;
  if (event.stage === "llm" && event.phase === "start") {
    message = `Codex 正在读取已通过门禁的 Mobile Spec，并生成页面源码（第 ${event.attempt} 次）`;
  } else if (event.stage === "llm" && event.phase === "complete") {
    message = `Codex 已返回结构化实现：${event.fileCount || 0} 个文件、${event.routeCount || 0} 个导航页面`;
  } else if (event.stage === "write" && event.phase === "start") {
    message = "正在校验 Codex 输出的路径、路由、文件数量和外部资源约束";
  } else if (event.stage === "write" && event.phase === "complete") {
    message = `Codex 输出校验通过，已安全写入 ${event.fileCount || 0} 个项目文件`;
  } else if (event.stage === "build" && event.phase === "infrastructure-retry") {
    message = "检测到上次是构建环境错误，正在保留页面实现并直接重试 npm ci";
  } else if (event.stage === "build" && event.phase === "start") {
    message = `正在安装锁定依赖并执行生产构建（第 ${event.attempt} 次）`;
  } else if (event.stage === "done") {
    message = `生产构建已通过（第 ${event.attempt} 次），准备部署`;
  } else if (event.stage === "retry") {
    if (event.phase === "manifest") {
      const detail = String(event.reason || "结构化输出不符合约束").slice(0, 180);
      message = `Codex 输出未通过结构校验：${detail}；正在开始第 ${Number(event.attempt) + 1} 次生成`;
    } else {
      message = `生产构建未通过，Codex 将读取真实构建日志并开始第 ${Number(event.attempt) + 1} 次修复`;
    }
  } else if (event.phase === "reused" && eventStage.startsWith("spec-")) {
    const label = { "spec-propose": "Proposal 与页面规格", "spec-design": "Design 与设计评审", "spec-task": "任务拆解" }[eventStage] || eventStage;
    message = `${label}已通过，复用子阶段检查点，不重新生成`;
  }
  updateJob(projectId, { status: "running", stage, progress, kind: event.ok === false ? "warning" : "progress" }, message);
}

function pauseError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("execution paused");
  error.name = "AbortError";
  return error;
}

function throwIfPaused(signal) {
  if (signal?.aborted) throw pauseError(signal);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function slugify(value) {
  const base = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return base || `site-${crypto.randomUUID().slice(0, 8)}`;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function controlPlaneOrigin() {
  if (!CONTROL_PLANE_URL) return null;
  try {
    return new URL(CONTROL_PLANE_URL).origin;
  } catch {
    return null;
  }
}

function localRecoveryCors(req) {
  const allowedOrigin = controlPlaneOrigin();
  if (!allowedOrigin || req.headers.origin !== allowedOrigin) return null;
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    "access-control-allow-private-network": "true",
    vary: "Origin, Access-Control-Request-Private-Network",
  };
}

async function ensureRunnerEndpoint(port, { rotate = false } = {}) {
  if (runnerEndpointChange) return runnerEndpointChange;
  if (!rotate && runnerEndpointTunnel?.isAlive()) {
    return new URL("/jobs", runnerEndpointTunnel.url).toString();
  }
  runnerEndpointChange = (async () => {
    runnerEndpointTunnel?.stop();
    runnerEndpointTunnel = null;
    const tunnel = await startQuickTunnel(`http://127.0.0.1:${port}`);
    if (shuttingDown) {
      tunnel.stop();
      throw new Error("runner is shutting down");
    }
    runnerEndpointTunnel = tunnel;
    const endpoint = new URL("/jobs", tunnel.url).toString();
    console.log(`runner public endpoint ready at ${endpoint}`);
    return endpoint;
  })().finally(() => {
    runnerEndpointChange = null;
  });
  return runnerEndpointChange;
}

async function registerRunnerWithControlPlane(endpoint) {
  if (!CONTROL_PLANE_URL) throw new Error("CODEGEN_CONTROL_PLANE_URL is not configured");
  if (!CALLBACK_TOKEN) throw new Error("RUNNER_CALLBACK_TOKEN is not configured");
  const registerUrl = new URL("/api/v1/runner/register", CONTROL_PLANE_URL);
  const headers = {
    authorization: `Bearer ${CALLBACK_TOKEN}`,
    "content-type": "application/json",
  };
  if (process.env.SITES_BYPASS_TOKEN) {
    headers["OAI-Sites-Authorization"] = `Bearer ${process.env.SITES_BYPASS_TOKEN}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(registerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ endpoint, instanceId: RUNNER_INSTANCE_ID }),
      signal: controller.signal,
    });
    const body = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => null)
      : null;
    if (!response.ok || body?.online !== true) {
      const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
      throw new Error(`control-plane registration failed: ${detail}`);
    }
    registeredRunnerEndpoint = endpoint;
    registeredRunnerAt = Date.now();
    console.log(`runner endpoint registered at control plane: ${endpoint}`);
  } finally {
    clearTimeout(timer);
  }
}

async function maintainRunnerEndpoint(port) {
  while (!shuttingDown) {
    let checkedTunnel = null;
    try {
      const endpoint = await ensureRunnerEndpoint(port);
      checkedTunnel = runnerEndpointTunnel;
      const healthUrl = new URL("/health", endpoint).toString();
      await waitForPublicUrl(healthUrl, {
        timeoutMs: 20_000,
        retryDelayMs: 2_000,
        isAlive: () => Boolean(checkedTunnel?.isAlive() && runnerEndpointTunnel === checkedTunnel),
      });
      if (runnerEndpointTunnel !== checkedTunnel) continue;
      if (registeredRunnerEndpoint !== endpoint || Date.now() - registeredRunnerAt >= RUNNER_REGISTRATION_REFRESH_MS) {
        await registerRunnerWithControlPlane(endpoint).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`runner endpoint registration failed: ${message}`);
        });
      }
      await delay(RUNNER_PUBLIC_HEALTH_INTERVAL_MS);
    } catch (error) {
      if (shuttingDown) break;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`runner endpoint maintenance failed: ${message}`);
      if (runnerEndpointTunnel === checkedTunnel) {
        checkedTunnel?.stop();
        runnerEndpointTunnel = null;
        registeredRunnerEndpoint = "";
      }
      await delay(3_000);
    }
  }
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        rejectBody(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

async function callback(callbackUrl, body, signal) {
  if (process.env.CODEGEN_DISABLE_CALLBACK === "1") return;
  const headers = { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" };
  if (process.env.SITES_BYPASS_TOKEN) {
    headers["OAI-Sites-Authorization"] = `Bearer ${process.env.SITES_BYPASS_TOKEN}`;
  }
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`control-plane callback failed (HTTP ${response.status})`);
}

async function deployPreview(preview, signal) {
  if (process.env.CODEGEN_PUBLIC_PREVIEW_BASE_URL) {
    const base = new URL(process.env.CODEGEN_PUBLIC_PREVIEW_BASE_URL);
    const local = new URL(preview.previewUrl);
    base.port = local.port;
    return {
      url: base.toString().replace(/\/$/, ""),
      stop: () => preview.stop(),
      isAlive: () => preview.isAlive(),
    };
  }
  if (process.env.CODEGEN_DEPLOYMENT_PROVIDER === "cloudflare-quick-tunnel") {
    try {
      const tunnel = await startQuickTunnel(preview.previewUrl, { signal });
      return {
        url: tunnel.url,
        stop: () => { tunnel.stop(); preview.stop(); },
        isAlive: () => tunnel.isAlive() && preview.isAlive(),
        diagnostics: () => tunnel.diagnostics(),
      };
    } catch (error) {
      preview.stop();
      throw error;
    }
  }
  preview.stop();
  throw new Error("DeploymentProvider is not configured; refusing to return localhost");
}

function stopPreview(slug) {
  const previous = previews.get(slug);
  if (!previous) return;
  previews.delete(slug);
  previous.stop();
}

function nextIncompleteStage(checkpoints) {
  return EXECUTION_STAGES.find((stage) => !checkpoints.includes(stage)) || null;
}

function stageLabel(stage) {
  return { "mobile-spec": "规格", implementation: "实现", build: "构建", deployment: "部署" }[stage] || stage;
}

function validPublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname !== "localhost" && !url.pathname.startsWith("/preview");
  } catch {
    return false;
  }
}

async function finishReusedJob(job, { outDir, checkpoints, completedStage, signal }) {
  const stored = checkpoints.includes("deployment") ? await readDeploymentEvidence(outDir) : null;
  const url = validPublicUrl(job.previousDeliveryUrl)
    ? job.previousDeliveryUrl
    : validPublicUrl(stored?.url) ? stored.url : "";
  const evidence = stored?.evidence;
  if (url && evidence?.mobileSpecPassed && evidence.buildPassed && evidence.deployPassed) {
    await callback(job.callbackUrl, { status: "delivered", stage: "delivered", url, evidence }, signal);
    if (jobs.get(job.projectId)?.id !== job.id) return;
    updateJob(job.projectId, {
      id: job.id,
      status: "delivered",
      stage: "delivered",
      progress: 100,
      url,
      evidence,
      checkpoints,
    }, `“${stageLabel(completedStage)}”已成功，复用检查点和现有交付链接，不重新执行`);
    return;
  }
  await callback(job.callbackUrl, { status: "checkpointed", stage: completedStage }, signal);
  if (jobs.get(job.projectId)?.id !== job.id) return;
  updateJob(job.projectId, {
    id: job.id,
    status: "checkpointed",
    stage: completedStage,
    progress: PROGRESS.checkpointed[0],
    checkpoints,
  }, `“${stageLabel(completedStage)}”已成功，直接复用检查点，不重新执行`);
}

async function executeJob(job, controller) {
  const { signal } = controller;
  const slug = slugify(job.projectId);
  const outDir = join(WORK_ROOT, slug);
  const specWorkRoot = join(SPEC_WORK_ROOT, slug);
  let deployment = null;
  try {
    throwIfPaused(signal);
    let checkpoints = await inspectCheckpoints({ outDir, specWorkRoot, requirement: job.requirement });
    let startStage = null;
    let stopAfterStage = "build";
    const shouldDeploy = job.mode !== "step" || job.targetStage === "deployment";

    if (job.mode === "rerun") {
      stopPreview(slug);
      await rm(outDir, { recursive: true, force: true });
      await rm(specWorkRoot, { recursive: true, force: true });
      checkpoints = [];
      startStage = "mobile-spec";
      updateJob(job.projectId, { id: job.id, status: "running", stage: "mobile-spec", progress: 7, checkpoints }, "已清除旧检查点，正在从 Mobile Spec 重新执行完整流程");
    } else if (job.mode === "step") {
      const target = job.targetStage;
      if (checkpoints.includes(target)) {
        await finishReusedJob(job, { outDir, checkpoints, completedStage: target, signal });
        return;
      }
      stopPreview(slug);
      if (target === "mobile-spec") {
        startStage = "mobile-spec";
        stopAfterStage = "mobile-spec";
      } else if (target === "implementation") {
        if (!checkpoints.includes("mobile-spec")) throw new Error("执行实现前需要成功的 Mobile Spec 检查点");
        startStage = "implementation";
        stopAfterStage = "implementation";
      } else if (target === "build") {
        if (!checkpoints.includes("implementation")) throw new Error("执行构建前需要成功的实现检查点");
        startStage = "build";
        stopAfterStage = "build";
      } else if (target === "deployment") {
        if (!checkpoints.includes("build")) throw new Error("执行部署前需要成功的生产构建检查点");
      }
      const progress = { "mobile-spec": 7, implementation: 58, build: 76, deployment: 90 }[target] || 7;
      updateJob(job.projectId, { id: job.id, status: "running", stage: target, progress, checkpoints }, `Runner 已接收“${stageLabel(target)}”单步任务`);
    } else {
      const nextStage = nextIncompleteStage(checkpoints);
      if (!nextStage) {
        await finishReusedJob(job, { outDir, checkpoints, completedStage: "deployment", signal });
        return;
      }
      if (checkpoints.length) {
        for (const stage of checkpoints.filter((item) => item !== "deployment")) {
          updateJob(job.projectId, { id: job.id, status: "running", stage: nextStage, checkpoints }, `已复用“${stageLabel(stage)}”成功检查点，不重复执行`);
        }
      }
      if (nextStage === "mobile-spec") {
        startStage = "mobile-spec";
      } else if (nextStage === "implementation") {
        startStage = "implementation";
      } else if (nextStage === "build") {
        startStage = "build";
      }
      const progress = { "mobile-spec": 7, implementation: 58, build: 76, deployment: 90 }[nextStage] || 7;
      updateJob(job.projectId, { id: job.id, status: "running", stage: nextStage, progress, checkpoints }, checkpoints.length ? `从“${stageLabel(nextStage)}”继续执行` : "Runner 已接收任务，开始生成 Mobile Spec");
    }

    throwIfPaused(signal);
    let result = { ok: true, outDir, attempts: 0 };
    if (startStage) {
      await callback(job.callbackUrl, { status: "building", stage: startStage }, signal);
      throwIfPaused(signal);
      result = await withTimeout(generate({
        requirement: job.requirement,
        outDir,
        specWorkRoot,
        openaiApiKey: process.env.OPENAI_API_KEY,
        onProgress: (event) => reportProgress(job.projectId, event, job.id),
        signal,
        startStage,
        stopAfterStage,
        resume: job.mode !== "rerun",
      }), GENERATION_TIMEOUT_MS, "generation");
      throwIfPaused(signal);
      if (!result.ok) {
        const detail = String(result.buildLog || "").trim().slice(-600);
        if (result.infrastructureError) {
          throw new Error(`构建执行环境不可用${detail ? `：${detail}` : ""}`);
        }
        throw new Error(`失败步骤在 ${result.attempts} 次修复后仍未通过${detail ? `：${detail}` : ""}`);
      }
      checkpoints = await inspectCheckpoints({ outDir, specWorkRoot, requirement: job.requirement });
    }

    if (!shouldDeploy) {
      const completedStage = job.targetStage || result.completedStage;
      const message = `“${stageLabel(completedStage)}”单步执行完成，检查点和产物已保存`;
      await callback(job.callbackUrl, { status: "checkpointed", stage: completedStage }, signal);
      if (jobs.get(job.projectId)?.id !== job.id) return;
      updateJob(job.projectId, {
        id: job.id,
        status: "checkpointed",
        stage: completedStage,
        progress: PROGRESS.checkpointed[0],
        checkpoints,
      }, message);
      return;
    }

    throwIfPaused(signal);
    updateJob(job.projectId, { status: "running", stage: "deployment", progress: PROGRESS.deployment[0] }, PROGRESS.deployment[1]);
    await callback(job.callbackUrl, { status: "building", stage: "deployment" }, signal);
    throwIfPaused(signal);
    stopPreview(slug);
    let url = "";
    for (let deploymentAttempt = 1; deploymentAttempt <= DEPLOYMENT_TUNNEL_ATTEMPTS; deploymentAttempt += 1) {
      throwIfPaused(signal);
      updateJob(job.projectId, {
        status: "running",
        stage: "deployment",
        progress: Math.min(96, 91 + deploymentAttempt),
      }, `正在创建公网部署地址（${deploymentAttempt}/${DEPLOYMENT_TUNNEL_ATTEMPTS}）`);
      const preview = await startPreview(result.outDir);
      try {
        throwIfPaused(signal);
        deployment = await deployPreview(preview, signal);
        throwIfPaused(signal);
        previews.set(slug, deployment);
        url = deployment.url;
        updateJob(job.projectId, {
          status: "running",
          stage: "deployment",
          progress: Math.min(97, 92 + deploymentAttempt),
        }, `部署地址 ${deploymentAttempt}/${DEPLOYMENT_TUNNEL_ATTEMPTS} 已建立，正在执行公网健康检查`);
        await waitForPublicUrl(url, {
          timeoutMs: DEPLOYMENT_HEALTH_ATTEMPT_TIMEOUT_MS,
          isAlive: deployment.isAlive,
          onAttempt: ({ attempt, status, error }) => {
            if (signal.aborted || jobs.get(job.projectId)?.id !== job.id) return;
            const detail = status ? `HTTP ${status}` : error || "暂未收到公网响应";
            const passed = status > 0 && status < 500;
            updateJob(job.projectId, {
              status: "running",
              stage: "deployment",
              progress: passed ? 98 : Math.min(97, 92 + deploymentAttempt + Math.floor(attempt / 4)),
              kind: passed ? "progress" : "warning",
            }, `部署地址 ${deploymentAttempt}/${DEPLOYMENT_TUNNEL_ATTEMPTS} · 公网健康检查第 ${attempt} 次：${detail}${passed ? "，检查通过" : "，等待后重试"}`);
          },
          signal,
        });
        break;
      } catch (error) {
        const failedDeployment = deployment;
        if (failedDeployment) {
          if (previews.get(slug) === failedDeployment) previews.delete(slug);
          failedDeployment.stop();
          deployment = null;
        } else {
          preview.stop();
        }
        throwIfPaused(signal);
        if (deploymentAttempt >= DEPLOYMENT_TUNNEL_ATTEMPTS) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        updateJob(job.projectId, {
          status: "running",
          stage: "deployment",
          progress: Math.min(97, 92 + deploymentAttempt),
          kind: "warning",
        }, `部署地址 ${deploymentAttempt}/${DEPLOYMENT_TUNNEL_ATTEMPTS} 未完成公网注册：${detail.slice(0, 180)}；正在自动更换地址，已成功的规格、实现和构建不会重跑`);
      }
    }
    throwIfPaused(signal);
    const evidence = { mobileSpecPassed: true, buildPassed: true, deployPassed: true };
    await writeDeploymentEvidence(outDir, { url, evidence, checkedAt: new Date().toISOString() });
    await writeOutputCheckpoint({ outDir, requirement: job.requirement, stage: "deployment" });
    checkpoints = await inspectCheckpoints({ outDir, specWorkRoot, requirement: job.requirement });
    await callback(job.callbackUrl, {
      status: "delivered",
      stage: "delivered",
      url,
      evidence,
    }, signal);
    throwIfPaused(signal);
    if (jobs.get(job.projectId)?.id !== job.id) return;
    updateJob(job.projectId, {
      id: job.id,
      status: "delivered",
      stage: "delivered",
      progress: 100,
      url,
      evidence,
      checkpoints,
    }, PROGRESS.delivered[1]);
  } catch (error) {
    if (deployment) {
      if (previews.get(slug) === deployment) previews.delete(slug);
      deployment.stop();
    }
    if (jobs.get(job.projectId)?.id !== job.id) return;
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      const current = jobs.get(job.projectId);
      updateJob(job.projectId, {
        id: job.id,
        status: "paused",
        stage: "paused",
        progress: current?.progress || 0,
        error: null,
        kind: "warning",
      }, PROGRESS.paused[1]);
      await withTimeout(callback(job.callbackUrl, { status: "paused", stage: "paused" }), 5_000, "pause callback").catch(() => undefined);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    updateJob(job.projectId, {
      id: job.id,
      status: "failed",
      stage: "failed",
      progress: 100,
      error: message,
    }, `执行失败：${message}`);
    await callback(job.callbackUrl, { status: "failed", stage: "failed" }).catch(() => undefined);
  } finally {
    if (jobControllers.get(job.projectId) === controller) jobControllers.delete(job.projectId);
  }
}

const server = createServer(async (req, res) => {
  if (req.url === "/control-endpoint/rotate" && req.method === "OPTIONS") {
    const headers = localRecoveryCors(req);
    if (!headers) return send(res, 403, { error: "origin is not allowed" });
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (req.url === "/control-endpoint/rotate" && req.method === "POST") {
    const headers = localRecoveryCors(req);
    if (!headers) return send(res, 403, { error: "origin is not allowed" });
    if (!AUTO_PUBLIC_TUNNEL) return send(res, 503, { error: "Runner 自动公网连接未启用" }, headers);
    try {
      const endpoint = await ensureRunnerEndpoint(runnerListeningPort, { rotate: true });
      return send(res, 200, { endpoint, instanceId: RUNNER_INSTANCE_ID }, headers);
    } catch (error) {
      return send(res, 503, { error: error instanceof Error ? error.message : String(error) }, headers);
    }
  }
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, {
      ok: Boolean(RUNNER_TOKEN && CALLBACK_TOKEN && (process.env.OPENAI_API_KEY || process.env.CODEX_BIN)),
      deploymentProviderConfigured: Boolean(process.env.CODEGEN_PUBLIC_PREVIEW_BASE_URL || process.env.CODEGEN_DEPLOYMENT_PROVIDER),
      instanceId: RUNNER_INSTANCE_ID,
    });
    return;
  }
  const artifactMatch = req.method === "POST" ? req.url?.match(/^\/jobs\/([^/?]+)\/artifacts\/(mobile-spec|implementation|build|deployment)(?:\?.*)?$/) : null;
  if (artifactMatch) {
    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (!RUNNER_TOKEN || !supplied || !timingSafeEqual(RUNNER_TOKEN, supplied)) {
      send(res, 401, { error: "unauthorized runner request" });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      send(res, 400, { error: "invalid JSON body" });
      return;
    }
    const projectId = decodeURIComponent(artifactMatch[1]);
    const requirement = String(body?.requirement || "").trim();
    if (!requirement) {
      send(res, 400, { error: "requirement is required" });
      return;
    }
    const slug = slugify(projectId);
    try {
      const result = await readStageArtifacts({
        outDir: join(WORK_ROOT, slug),
        specWorkRoot: join(SPEC_WORK_ROOT, slug),
        requirement,
        stage: artifactMatch[2],
      });
      send(res, 200, result);
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/jobs/")) {
    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (!RUNNER_TOKEN || !supplied || !timingSafeEqual(RUNNER_TOKEN, supplied)) {
      send(res, 401, { error: "unauthorized runner request" });
      return;
    }
    const projectId = decodeURIComponent(req.url.slice("/jobs/".length));
    const job = jobs.get(projectId);
    send(res, job ? 200 : 404, job ? { job } : { error: "job not found" });
    return;
  }
  const pauseMatch = req.method === "POST" ? req.url?.match(/^\/jobs\/([^/?]+)\/pause(?:\?.*)?$/) : null;
  if (pauseMatch) {
    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    if (!RUNNER_TOKEN || !supplied || !timingSafeEqual(RUNNER_TOKEN, supplied)) {
      send(res, 401, { error: "unauthorized runner request" });
      return;
    }
    const projectId = decodeURIComponent(pauseMatch[1]);
    const job = jobs.get(projectId);
    if (!job) {
      send(res, 404, { error: "job not found" });
      return;
    }
    if (job.status === "paused") {
      send(res, 202, { job });
      return;
    }
    if (!["queued", "running"].includes(job.status)) {
      send(res, 409, { error: `job cannot be paused from ${job.status}` });
      return;
    }
    const controller = jobControllers.get(projectId);
    if (!controller) {
      send(res, 409, { error: "job is no longer running" });
      return;
    }
    updateJob(projectId, { kind: "warning" }, "正在停止当前执行阶段…");
    controller.abort(new DOMException("execution paused", "AbortError"));
    const execution = jobExecutions.get(projectId);
    if (execution?.id === job.id) await execution.promise;
    const paused = jobs.get(projectId);
    if (!paused || paused.id !== job.id || paused.status !== "paused") {
      send(res, 409, { error: "job changed before pause completed" });
      return;
    }
    send(res, 202, { job: paused });
    return;
  }
  if (req.method !== "POST" || req.url !== "/jobs") {
    send(res, 404, { error: "not found" });
    return;
  }
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  if (!RUNNER_TOKEN || !supplied || !timingSafeEqual(RUNNER_TOKEN, supplied)) {
    send(res, 401, { error: "unauthorized runner request" });
    return;
  }
  if (!CALLBACK_TOKEN || (!process.env.OPENAI_API_KEY && !process.env.CODEX_BIN)) {
    send(res, 503, { error: "runner secrets are incomplete" });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: "invalid JSON body" });
    return;
  }
  const projectId = String(body?.projectId || "").trim();
  const requirement = String(body?.requirement || "").trim();
  const callbackUrl = String(body?.callbackUrl || "").trim();
  const requestedMode = body?.forceRerun === true ? "rerun" : String(body?.mode || "continue");
  const mode = ["continue", "rerun", "step"].includes(requestedMode) ? requestedMode : "";
  const targetStage = typeof body?.targetStage === "string" ? body.targetStage : null;
  const previousDeliveryUrl = typeof body?.previousDeliveryUrl === "string" ? body.previousDeliveryUrl : "";
  if (!projectId || !requirement || !callbackUrl.startsWith("https://")) {
    send(res, 400, { error: "projectId, requirement, and HTTPS callbackUrl are required" });
    return;
  }
  if (!mode || (mode === "step" && !EXECUTION_STAGES.includes(targetStage))) {
    send(res, 400, { error: "mode must be continue, rerun, or step with a valid targetStage" });
    return;
  }
  const existing = jobs.get(projectId);
  if (existing && ["queued", "running"].includes(existing.status)) {
    send(res, 202, { job: existing });
    return;
  }
  if (mode === "continue" && existing?.status === "delivered" && existing.requirement === requirement) {
    send(res, 200, { job: existing, reused: true });
    return;
  }
  const job = {
    id: `job_${crypto.randomUUID()}`,
    projectId,
    requirement,
    callbackUrl,
    mode,
    targetStage,
    previousDeliveryUrl,
  };
  jobs.delete(projectId);
  updateJob(projectId, {
    id: job.id,
    requirement,
    status: "queued",
    stage: mode === "step" ? targetStage : "mobile-spec",
    progress: PROGRESS.queued[0],
    mode,
    targetStage,
  }, PROGRESS.queued[1]);
  const controller = new AbortController();
  jobControllers.set(projectId, controller);
  const execution = new Promise((resolveExecution) => setImmediate(resolveExecution))
    .then(() => executeJob(job, controller));
  jobExecutions.set(projectId, { id: job.id, promise: execution });
  execution.finally(() => {
    if (jobExecutions.get(projectId)?.id === job.id) jobExecutions.delete(projectId);
  }).catch(() => undefined);
  send(res, 202, { job: jobs.get(projectId) });
});

function shutdown() {
  shuttingDown = true;
  runnerEndpointTunnel?.stop();
  for (const controller of jobControllers.values()) controller.abort(new DOMException("runner shutting down", "AbortError"));
  for (const preview of previews.values()) preview.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, "127.0.0.1", () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : PORT;
  runnerListeningPort = listeningPort;
  console.log(`trusted codegen runner listening on http://127.0.0.1:${listeningPort}`);
  if (AUTO_PUBLIC_TUNNEL) {
    void maintainRunnerEndpoint(listeningPort).catch((error) => {
      console.error(`runner endpoint loop stopped: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
});
