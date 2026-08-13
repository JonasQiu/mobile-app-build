import { spawn } from "node:child_process";
import { basename } from "node:path";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function recentLog(log, lineCount = 10) {
  return log.trim().split("\n").slice(-lineCount).join("\n");
}

export async function startQuickTunnel(localUrl, { timeoutMs = 90_000 } = {}) {
  const command = process.env.CODEGEN_TUNNEL_BIN;
  if (!command) throw new Error("CODEGEN_TUNNEL_BIN is not configured");
  const isCloudflared = basename(command).startsWith("cloudflared");
  const args = isCloudflared
    ? ["tunnel", "--url", localUrl, "--no-autoupdate"]
    : ["tunnel", "quick-start", localUrl];
  const child = spawn(command, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  let closed = false;
  child.stdout.on("data", (chunk) => { log = (log + chunk.toString("utf8")).slice(-32_000); });
  child.stderr.on("data", (chunk) => { log = (log + chunk.toString("utf8")).slice(-32_000); });
  child.on("close", () => { closed = true; });
  const stop = () => {
    if (closed) return;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1500).unref();
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    const connectorReady = /Registered tunnel connection/i.test(log);
    if (match && (!isCloudflared || connectorReady)) {
      return {
        url: match[0],
        child,
        stop,
        isAlive: () => !closed && child.exitCode === null,
        diagnostics: () => recentLog(log),
      };
    }
    if (closed) break;
    await sleep(250);
  }
  stop();
  const detail = recentLog(log);
  throw new Error(`temporary deployment tunnel failed${detail ? `: ${detail}` : ""}`);
}

function curlProbe(url) {
  const command = process.env.CODEGEN_HEALTHCHECK_BIN;
  if (!command) return null;
  return new Promise((resolveProbe) => {
    const child = spawn(command, [
      "-sS",
      "-L",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "--connect-timeout",
      "8",
      "--max-time",
      "12",
      url,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveProbe(result);
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish({ status: 0, error: error.message, exitCode: null }));
    child.on("close", (code) => {
      const status = Number(Buffer.concat(stdout).toString("utf8"));
      const detail = Buffer.concat(stderr).toString("utf8").trim().split("\n").at(-1) || "";
      finish({
        status: Number.isInteger(status) ? status : 0,
        error: code === 0 ? "" : detail || `curl exited with code ${code}`,
        exitCode: code,
      });
    });
  });
}

async function defaultProbe(url) {
  const curlResult = await curlProbe(url);
  if (curlResult !== null) return curlResult;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal });
    return { status: response.status, error: "", exitCode: null };
  } catch (error) {
    return {
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      exitCode: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForPublicUrl(url, {
  timeoutMs = 120_000,
  retryDelayMs = 1_000,
  isAlive,
  onAttempt,
  probe = defaultProbe,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastError = "";
  let attempts = 0;
  while (Date.now() < deadline) {
    if (isAlive && !isAlive()) {
      throw new Error("deployment tunnel exited before health check completed");
    }
    attempts += 1;
    let result;
    try {
      result = await probe(url);
    } catch (error) {
      result = { status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    lastStatus = Number(result?.status) || 0;
    lastError = String(result?.error || "");
    onAttempt?.({
      attempt: attempts,
      status: lastStatus,
      error: lastError,
      elapsedMs: Math.max(0, timeoutMs - Math.max(0, deadline - Date.now())),
    });
    if (lastStatus > 0 && lastStatus < 500) return lastStatus;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(remainingMs, retryDelayMs * Math.min(attempts, 4)));
  }
  const detail = lastStatus
    ? `last response HTTP ${lastStatus}`
    : lastError || "no HTTP response received";
  throw new Error(`deployment health check failed after ${attempts} attempts: ${detail}`);
}
