// Runs `npm install` then `npm run build` (== `next build`) inside the
// generated project, streaming combined output to a buffer. Returns a concise
// result: ok flag, exit code, and the tail of the log (enough to feed back to
// the model on retry or to surface in the UI on hard failure).
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const PHASE_TIMEOUT_MS = 180_000;
const LOG_TAIL_BYTES = 6 * 1024;

function run(cmd, args, cwd, extraEnv) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      rejectP(new Error(`timed out after ${PHASE_TIMEOUT_MS}ms`));
    }, PHASE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectP(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code: code ?? -1, stdout, stderr });
    });
  });
}

function tail(text, bytes = LOG_TAIL_BYTES) {
  if (text.length <= bytes) return text;
  return `…(truncated, showing last ${bytes} chars)…\n` + text.slice(text.length - bytes);
}

export async function runBuild(outDir) {
  const cwd = resolve(outDir);
  const extraEnv = { CI: "1", NEXT_TELEMETRY_DISABLED: "1" };
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

  let install;
  try {
    install = await run(npmBin, ["install", "--no-audit", "--no-fund"], cwd, extraEnv);
  } catch (err) {
    return { ok: false, exitCode: null, log: `npm install ${err.message}` };
  }
  if (install.code !== 0) {
    return {
      ok: false,
      exitCode: install.code,
      log: tail(`$ npm install\n${install.stdout}\n${install.stderr}`),
    };
  }

  let build;
  try {
    build = await run(npmBin, ["run", "build"], cwd, extraEnv);
  } catch (err) {
    return {
      ok: false,
      exitCode: null,
      log: tail(`$ npm install\n${install.stdout}\n${install.stderr}\n$ npm run build\n${err.message}`),
    };
  }

  const log = tail(
    `$ npm install\n${install.stdout}\n${install.stderr}\n$ npm run build\n${build.stdout}\n${build.stderr}`,
  );
  return { ok: build.code === 0, exitCode: build.code, log };
}

// Exposed for tests that want to assert the helper itself.
export { tail as tailLog };
