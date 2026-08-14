import { spawn } from "node:child_process";
import { basename } from "node:path";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("execution paused", "AbortError");
}

function abortableSleep(ms, signal) {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolveSleep, rejectSleep) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function recentLog(log, lineCount = 10) {
  return log.trim().split("\n").slice(-lineCount).join("\n");
}

export async function startQuickTunnel(localUrl, { timeoutMs = 90_000, signal } = {}) {
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
    if (signal?.aborted) {
      stop();
      throw abortError(signal);
    }
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
    try {
      await abortableSleep(250, signal);
    } catch (error) {
      stop();
      throw error;
    }
  }
  stop();
  const detail = recentLog(log);
  throw new Error(`temporary deployment tunnel failed${detail ? `: ${detail}` : ""}`);
}

function curlProbe(url, signal) {
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
      signal?.removeEventListener("abort", onAbort);
      resolveProbe(result);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish({ status: 0, error: "execution paused", exitCode: null, aborted: true });
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
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function defaultProbe(url, signal) {
  const curlResult = await curlProbe(url, signal);
  if (curlResult !== null) return curlResult;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const onAbort = () => controller.abort(abortError(signal));
  signal?.addEventListener("abort", onAbort, { once: true });
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
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function waitForPublicUrl(url, {
  timeoutMs = 120_000,
  retryDelayMs = 1_000,
  isAlive,
  onAttempt,
  probe = defaultProbe,
  signal,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastError = "";
  let attempts = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("execution paused", "AbortError");
    if (isAlive && !isAlive()) {
      throw new Error("deployment tunnel exited before health check completed");
    }
    attempts += 1;
    let result;
    try {
      result = await probe(url, signal);
    } catch (error) {
      result = { status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("execution paused", "AbortError");
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
    const delayMs = Math.min(remainingMs, retryDelayMs * Math.min(attempts, 4));
    await abortableSleep(delayMs, signal);
  }
  const detail = lastStatus
    ? `last response HTTP ${lastStatus}`
    : lastError || "no HTTP response received";
  throw new Error(`deployment health check failed after ${attempts} attempts: ${detail}`);
}
