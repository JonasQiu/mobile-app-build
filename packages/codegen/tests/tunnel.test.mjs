import assert from "node:assert/strict";
import test from "node:test";

import { waitForPublicUrl } from "../src/tunnel.js";

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
