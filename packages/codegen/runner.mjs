// Trusted Node runner for the production control plane. It executes one job
// asynchronously and reports stage/evidence to the server-owned callback.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
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
const RUNNER_TOKEN = process.env.CODEX_RUNNER_TOKEN || "";
const CALLBACK_TOKEN = process.env.RUNNER_CALLBACK_TOKEN || "";
const jobs = new Map();
const previews = new Map();

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
    return { url: base.toString().replace(/\/$/, ""), stop: () => preview.stop() };
  }
  if (process.env.CODEGEN_DEPLOYMENT_PROVIDER === "cloudflare-quick-tunnel") {
    const tunnel = await startQuickTunnel(preview.previewUrl);
    return { url: tunnel.url, stop: () => { tunnel.stop(); preview.stop(); } };
  }
  preview.stop();
  throw new Error("DeploymentProvider is not configured; refusing to return localhost");
}

async function executeJob(job) {
  jobs.set(job.projectId, { id: job.id, status: "running", stage: "mobile-spec" });
  const slug = slugify(job.projectId);
  const outDir = join(WORK_ROOT, slug);
  const specWorkRoot = join(SPEC_WORK_ROOT, slug);
  try {
    await rm(outDir, { recursive: true, force: true });
    await callback(job.callbackUrl, { status: "building", stage: "mobile-spec" });
    const result = await withTimeout(generate({
      requirement: job.requirement,
      outDir,
      specWorkRoot,
      openaiApiKey: process.env.OPENAI_API_KEY,
      onProgress: ({ stage }) => {
        if (stage === "llm" || stage === "write") jobs.set(job.projectId, { id: job.id, status: "running", stage: "implementation" });
        if (stage === "build") jobs.set(job.projectId, { id: job.id, status: "running", stage: "build" });
      },
    }), GENERATION_TIMEOUT_MS, "generation");
    if (!result.ok) throw new Error(`build failed after ${result.attempts} attempts`);

    await callback(job.callbackUrl, { status: "building", stage: "deployment" });
    const previous = previews.get(slug);
    if (previous) previous.stop();
    const preview = await startPreview(result.outDir);
    const deployment = await deployPreview(preview);
    previews.set(slug, deployment);
    const url = deployment.url;
    await waitForPublicUrl(url);
    await callback(job.callbackUrl, {
      status: "delivered",
      stage: "delivered",
      url,
      evidence: { mobileSpecPassed: true, buildPassed: true, deployPassed: true },
    });
    jobs.set(job.projectId, {
      id: job.id,
      status: "delivered",
      stage: "delivered",
      url,
      evidence: { mobileSpecPassed: true, buildPassed: true, deployPassed: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    jobs.set(job.projectId, { id: job.id, status: "failed", stage: "failed", error: message });
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
  jobs.set(projectId, { id: job.id, status: "queued", stage: "mobile-spec" });
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
