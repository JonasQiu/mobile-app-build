import assert from "node:assert/strict";
import test from "node:test";

import { healthcheckCurlArgs, quickTunnelCommand, waitForPublicUrl } from "../src/tunnel.js";

test("cloudflared quick tunnels use HTTP/2 for reliable connector registration", () => {
  const command = quickTunnelCommand("/opt/bin/cloudflared", "http://127.0.0.1:4173");

  assert.equal(command.isCloudflared, true);
  assert.deepEqual(command.args, [
    "tunnel",
    "--url",
    "http://127.0.0.1:4173",
    "--no-autoupdate",
    "--protocol",
    "http2",
  ]);
});

test("health checks can pin a public DNS result without changing the delivery URL", () => {
  const args = healthcheckCurlArgs("https://generated.example/path", "104.16.230.132");

  assert.deepEqual(args.slice(-3), [
    "--resolve",
    "generated.example:443:104.16.230.132",
    "https://generated.example/path",
  ]);
});

test("public health check retries transient network and edge failures", async () => {
  const results = [
    { status: 0, error: "Could not resolve host" },
    { status: 502, error: "" },
    { status: 200, error: "" },
  ];
  const attempts = [];

  const status = await waitForPublicUrl("https://example.test", {
    timeoutMs: 1_000,
    retryDelayMs: 1,
    probe: async () => results.shift(),
    onAttempt: (attempt) => attempts.push(attempt),
  });

  assert.equal(status, 200);
  assert.deepEqual(attempts.map((attempt) => attempt.status), [0, 502, 200]);
  assert.equal(attempts[0].error, "Could not resolve host");
});

test("public health check reports the final network diagnostic", async () => {
  await assert.rejects(
    waitForPublicUrl("https://example.test", {
      timeoutMs: 8,
      retryDelayMs: 1,
      probe: async () => ({ status: 0, error: "Could not resolve host" }),
    }),
    /deployment health check failed after \d+ attempts: Could not resolve host/,
  );
});

test("public health check fails immediately when the deployment exits", async () => {
  await assert.rejects(
    waitForPublicUrl("https://example.test", {
      isAlive: () => false,
      probe: async () => ({ status: 200, error: "" }),
    }),
    /deployment tunnel exited before health check completed/,
  );
});

test("public health check stops retrying when the job is paused", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const waiting = waitForPublicUrl("https://example.test", {
    timeoutMs: 5_000,
    retryDelayMs: 1_000,
    signal: controller.signal,
    probe: async () => ({ status: 0, error: "still starting" }),
  });
  setTimeout(() => controller.abort(new DOMException("execution paused", "AbortError")), 10);
  await assert.rejects(waiting, (error) => error?.name === "AbortError");
  assert.ok(Date.now() - startedAt < 500, "pause should interrupt the retry delay");
});
