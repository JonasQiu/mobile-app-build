// Runs a reproducible install then `npm run build` (== `next build`) inside the
// generated project, streaming combined output to a buffer. Returns a concise
// result: ok flag, exit code, and the tail of the log (enough to feed back to
// the model on retry or to surface in the UI on hard failure).
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const PHASE_TIMEOUT_MS = 180_000;
const LOG_TAIL_BYTES = 6 * 1024;

function run(cmd, args, cwd, extraEnv, signal) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer;
    const stopChild = (killSignal) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch {
        try { child.kill(killSignal); } catch { /* already dead */ }
      }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      stopChild("SIGTERM");
      const error = signal?.reason instanceof Error ? signal.reason : new DOMException("execution paused", "AbortError");
      finish(rejectP, error);
      killTimer = setTimeout(() => stopChild("SIGKILL"), 1500);
      killTimer.unref?.();
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      stopChild("SIGKILL");
      finish(rejectP, new Error(`timed out after ${PHASE_TIMEOUT_MS}ms`));
    }, PHASE_TIMEOUT_MS);
    child.on("error", (err) => {
      finish(rejectP, err);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      finish(resolveP, { code: code ?? -1, stdout, stderr });
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function tail(text, bytes = LOG_TAIL_BYTES) {
  if (text.length <= bytes) return text;
  return `…(truncated, showing last ${bytes} chars)…\n` + text.slice(text.length - bytes);
}

export async function runBuild(outDir, { signal } = {}) {
  const cwd = resolve(outDir);
  const extraEnv = { CI: "1", NEXT_TELEMETRY_DISABLED: "1" };
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

  let install;
  try {
    install = await run(npmBin, ["ci", "--no-audit", "--no-fund"], cwd, extraEnv, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return { ok: false, exitCode: null, log: `npm ci ${err.message}` };
  }
  if (install.code !== 0) {
    return {
      ok: false,
      exitCode: install.code,
      log: tail(`$ npm ci\n${install.stdout}\n${install.stderr}`),
    };
  }

  let build;
  try {
    build = await run(npmBin, ["run", "build"], cwd, extraEnv, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      ok: false,
      exitCode: null,
      log: tail(`$ npm ci\n${install.stdout}\n${install.stderr}\n$ npm run build\n${err.message}`),
    };
  }

  const log = tail(
    `$ npm ci\n${install.stdout}\n${install.stderr}\n$ npm run build\n${build.stdout}\n${build.stderr}`,
  );
  return { ok: build.code === 0, exitCode: build.code, log };
}

// Exposed for tests that want to assert the helper itself.
export { tail as tailLog };
