// Starts a built Next.js project with `next start` on an ephemeral port and
// waits until it answers, returning a stop handle. Uses the project's own
// node_modules/.bin/next so no global install or npx network hop is needed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve, join } from "node:path";

const sleep = (ms) => new Promise((r) => {
  setTimeout(r, ms);
});

function pickPort() {
  return new Promise((resolveP, rejectP) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectP);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolveP(port));
    });
  });
}

export async function startPreview(outDir, { port } = {}) {
  const chosenPort = port || (await pickPort());
  const cwd = resolve(outDir);
  const nextBin = join(cwd, "node_modules", ".bin", "next");
  const previewUrl = `http://localhost:${chosenPort}`;

  const child = spawn(nextBin, ["start", "-p", String(chosenPort)], {
    cwd,
    stdio: "ignore",
    windowsHide: true,
    detached: false,
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  };

  // Wait for the server to answer (any non-5xx is fine; redirects are normal).
  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline) {
    await sleep(500);
    try {
      const res = await fetch(previewUrl, { redirect: "manual" });
      if (res.status < 500) {
        healthy = true;
        break;
      }
    } catch {
      /* still booting */
    }
  }
  if (!healthy) {
    stop();
    throw new Error(`preview did not become healthy at ${previewUrl}`);
  }

  return { previewUrl, port: chosenPort, child, stop };
}
