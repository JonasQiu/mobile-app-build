import { spawn } from "node:child_process";
import { basename } from "node:path";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export async function startQuickTunnel(localUrl, { timeoutMs = 60_000 } = {}) {
  const command = process.env.CODEGEN_TUNNEL_BIN;
  if (!command) throw new Error("CODEGEN_TUNNEL_BIN is not configured");
  const args = basename(command).startsWith("cloudflared")
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
    if (match) return { url: match[0], child, stop };
    if (closed) break;
    await sleep(250);
  }
  stop();
  const detail = log.trim().split("\n").slice(-10).join("\n");
  throw new Error(`temporary deployment tunnel failed${detail ? `: ${detail}` : ""}`);
}

function curlStatus(url) {
  const command = process.env.CODEGEN_HEALTHCHECK_BIN;
  if (!command) return null;
  return new Promise((resolveStatus) => {
    const child = spawn(command, ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", url], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => resolveStatus(0));
    child.on("close", (code) => {
      const status = Number(Buffer.concat(chunks).toString("utf8"));
      resolveStatus(code === 0 && Number.isInteger(status) ? status : 0);
    });
  });
}

export async function waitForPublicUrl(url, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const curlResult = await curlStatus(url);
      if (curlResult !== null) {
        lastStatus = curlResult;
        if (curlResult > 0 && curlResult < 500) return curlResult;
      } else {
        const response = await fetch(url, { redirect: "manual" });
        lastStatus = response.status;
        if (response.status < 500) return response.status;
      }
    } catch {
      // Tunnel DNS and edge routing may take a few seconds to converge.
    }
    await sleep(500);
  }
  throw new Error(`deployment health check failed${lastStatus ? ` (HTTP ${lastStatus})` : ""}`);
}
