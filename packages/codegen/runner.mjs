// Local HTTP runner: stands in for the (still-unimplemented) cloud agent while
// we develop. The apps/web UI POSTs /generate here; this process runs the
// codegen engine and serves the built app via `next start`, returning a
// localhost preview URL. Dev-only — do NOT expose this publicly.
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "./src/generate.js";
import { startPreview } from "./src/serve.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const WORK_ROOT = join(repoRoot, ".codegen", "work");
const SPEC_WORK_ROOT = join(repoRoot, ".codegen", "spec");

const PORT = Number(process.env.CODEGEN_RUNNER_PORT) || 5174;
const ALLOWED_ORIGIN = process.env.CODEGEN_WEB_ORIGIN || "http://localhost:5173";
// Phase 1 (mobile-spec workflow: ~3 LLM calls + subprocess gates) + phase 2
// (up to 3 code-gen + build rounds) can exceed 5 min; default to 10.
const GENERATION_TIMEOUT_MS = Number(process.env.CODEGEN_TIMEOUT_MS) || 600_000;

// slug -> { stop, previewUrl }
const previews = new Map();

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "site";
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
  res.end(payload);
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

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true, openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY) });
    return;
  }

  if (req.method === "POST" && req.url === "/generate") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      send(res, 400, { ok: false, error: "invalid JSON body" });
      return;
    }
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      send(res, 400, { ok: false, error: "prompt is required" });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      send(res, 500, { ok: false, error: "OPENAI_API_KEY not set on the runner" });
      return;
    }

    const slug = slugify(body.projectName || prompt);
    const outDir = join(WORK_ROOT, slug);
    const specWorkRoot = join(SPEC_WORK_ROOT, slug);
    try {
      await rm(outDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    let result;
    try {
      result = await withTimeout(
        generate({
          requirement: prompt,
          outDir,
          specWorkRoot,
          openaiApiKey: process.env.OPENAI_API_KEY,
          model: body.model || undefined,
        }),
        GENERATION_TIMEOUT_MS,
        "generation",
      );
    } catch (err) {
      send(res, 500, { ok: false, error: err.message, buildLog: "" });
      return;
    }

    if (!result.ok) {
      send(res, 500, {
        ok: false,
        error: `build failed after ${result.attempts} attempt(s)`,
        buildLog: result.buildLog,
      });
      return;
    }

    try {
      // Stop any previous preview for this slug before starting a fresh one.
      const prev = previews.get(slug);
      if (prev) prev.stop();
      const preview = await startPreview(result.outDir);
      previews.set(slug, { stop: preview.stop, previewUrl: preview.previewUrl });
      send(res, 200, {
        ok: true,
        previewUrl: preview.previewUrl,
        buildOk: true,
        attempts: result.attempts,
        specWorkflowOk: result.specWorkflowOk,
        degradedReason: result.degradedReason,
      });
    } catch (err) {
      send(res, 500, { ok: false, error: `build ok but preview failed: ${err.message}`, buildLog: result.buildLog });
    }
    return;
  }

  send(res, 404, { ok: false, error: "not found" });
});

function shutdown() {
  for (const { stop } of previews.values()) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`codegen runner on http://localhost:${PORT} (CORS ${ALLOWED_ORIGIN})`);
  // eslint-disable-next-line no-console
  console.log(`work dir: ${WORK_ROOT}`);
});
