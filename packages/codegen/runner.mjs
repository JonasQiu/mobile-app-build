// Trusted Node runner for the production control plane. It executes one job
// asynchronously and reports stage/evidence to the server-owned callback.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "./src/generate.js";
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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const WORK_ROOT = join(repoRoot, ".codegen", "work");
const SPEC_WORK_ROOT = join(repoRoot, ".codegen", "spec");
const configuredPort = process.env.CODEGEN_RUNNER_PORT;
const PORT = configuredPort === undefined ? 5174 : Number(configuredPort);
const GENERATION_TIMEOUT_MS = Number(process.env.CODEGEN_TIMEOUT_MS) || 600_000;
const DEPLOYMENT_HEALTH_TIMEOUT_MS = Math.max(30_000, Number(process.env.CODEGEN_DEPLOYMENT_HEALTH_TIMEOUT_MS) || 120_000);
const RUNNER_TOKEN = process.env.CODEX_RUNNER_TOKEN || "";
const CALLBACK_TOKEN = process.env.RUNNER_CALLBACK_TOKEN || "";
const jobs = new Map();
const previews = new Map();

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

function reportProgress(projectId, event) {
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
  } else if (event.stage === "build" && event.phase === "start") {
    message = `正在安装锁定依赖并执行生产构建（第 ${event.attempt} 次）`;
  } else if (event.stage === "done") {
    message = `生产构建已通过（第 ${event.attempt} 次），准备部署`;
  } else if (event.stage === "retry") {
    message = `生产构建未通过，Codex 将读取真实构建日志并开始第 ${Number(event.attempt) + 1} 次修复`;
  }
  updateJob(projectId, { status: "running", stage, progress, kind: event.ok === false ? "warning" : "progress" }, message);
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

async function hasDeploymentCheckpoint(outDir, specWorkRoot, requirement) {
  if (!existsSync(join(outDir, ".next", "BUILD_ID")) || !existsSync(join(outDir, "node_modules", ".bin", "next"))) {
    return false;
  }
  const requirementDir = join(specWorkRoot, "requirements");
  let files;
  try {
    files = await readdir(requirementDir);
  } catch {
    return false;
  }
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    try {
      if ((await readFile(join(requirementDir, file), "utf8")).trim() === requirement.trim()) return true;
    } catch {
      // A partial checkpoint is not safe to resume.
    }
  }
  return false;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
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

async function callback(callbackUrl, body) {
  if (process.env.CODEGEN_DISABLE_CALLBACK === "1") return;
  const headers = { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" };
  if (process.env.SITES_BYPASS_TOKEN) {
    headers["OAI-Sites-Authorization"] = `Bearer ${process.env.SITES_BYPASS_TOKEN}`;
  }
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`control-plane callback failed (HTTP ${response.status})`);
}

async function deployPreview(preview) {
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
      const tunnel = await startQuickTunnel(preview.previewUrl);
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

async function executeJob(job) {
  updateJob(job.projectId, { id: job.id, status: "running", stage: "mobile-spec", progress: 7 }, "Runner 已接收任务，开始生成 Mobile Spec");
  const slug = slugify(job.projectId);
  const outDir = join(WORK_ROOT, slug);
  const specWorkRoot = join(SPEC_WORK_ROOT, slug);
  let deployment = null;
  try {
    const resumable = await hasDeploymentCheckpoint(outDir, specWorkRoot, job.requirement);
    let result;
    if (resumable) {
      result = { ok: true, outDir, attempts: 0 };
      updateJob(job.projectId, {
        status: "running",
        stage: "deployment",
        progress: 90,
      }, "检测到同一需求已通过 Mobile Spec 和生产构建，继续部署，无需重复生成");
    } else {
      await rm(outDir, { recursive: true, force: true });
      await callback(job.callbackUrl, { status: "building", stage: "mobile-spec" });
      result = await withTimeout(generate({
        requirement: job.requirement,
        outDir,
        specWorkRoot,
        openaiApiKey: process.env.OPENAI_API_KEY,
        onProgress: (event) => reportProgress(job.projectId, event),
      }), GENERATION_TIMEOUT_MS, "generation");
      if (!result.ok) throw new Error(`build failed after ${result.attempts} attempts`);
    }

    updateJob(job.projectId, { status: "running", stage: "deployment", progress: PROGRESS.deployment[0] }, PROGRESS.deployment[1]);
    await callback(job.callbackUrl, { status: "building", stage: "deployment" });
    const previous = previews.get(slug);
    if (previous) previous.stop();
    const preview = await startPreview(result.outDir);
    deployment = await deployPreview(preview);
    previews.set(slug, deployment);
    const url = deployment.url;
    await waitForPublicUrl(url, {
      timeoutMs: DEPLOYMENT_HEALTH_TIMEOUT_MS,
      isAlive: deployment.isAlive,
      onAttempt: ({ attempt, status, error }) => {
        const detail = status ? `HTTP ${status}` : error || "暂未收到公网响应";
        const passed = status > 0 && status < 500;
        updateJob(job.projectId, {
          status: "running",
          stage: "deployment",
          progress: passed ? 98 : Math.min(97, 92 + attempt),
          kind: passed ? "progress" : "warning",
        }, `公网健康检查第 ${attempt} 次：${detail}${passed ? "，检查通过" : "，等待后重试"}`);
      },
    });
    await callback(job.callbackUrl, {
      status: "delivered",
      stage: "delivered",
      url,
      evidence: { mobileSpecPassed: true, buildPassed: true, deployPassed: true },
    });
    updateJob(job.projectId, {
      id: job.id,
      status: "delivered",
      stage: "delivered",
      progress: 100,
      url,
      evidence: { mobileSpecPassed: true, buildPassed: true, deployPassed: true },
    }, PROGRESS.delivered[1]);
  } catch (error) {
    if (deployment) {
      if (previews.get(slug) === deployment) previews.delete(slug);
      deployment.stop();
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
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, {
      ok: Boolean(RUNNER_TOKEN && CALLBACK_TOKEN && (process.env.OPENAI_API_KEY || process.env.CODEX_BIN)),
      deploymentProviderConfigured: Boolean(process.env.CODEGEN_PUBLIC_PREVIEW_BASE_URL || process.env.CODEGEN_DEPLOYMENT_PROVIDER),
    });
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
  if (!projectId || !requirement || !callbackUrl.startsWith("https://")) {
    send(res, 400, { error: "projectId, requirement, and HTTPS callbackUrl are required" });
    return;
  }
  const existing = jobs.get(projectId);
  if (existing && existing.status === "running") {
    send(res, 202, { job: existing });
    return;
  }
  const job = { id: `job_${crypto.randomUUID()}`, projectId, requirement, callbackUrl };
  jobs.delete(projectId);
  updateJob(projectId, {
    id: job.id,
    status: "queued",
    stage: "mobile-spec",
    progress: PROGRESS.queued[0],
  }, PROGRESS.queued[1]);
  setImmediate(() => executeJob(job));
  send(res, 202, { job: jobs.get(projectId) });
});

function shutdown() {
  for (const preview of previews.values()) preview.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, "127.0.0.1", () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`trusted codegen runner listening on http://127.0.0.1:${listeningPort}`);
});
