// No-key tests for the spec-workflow plumbing: workspace bootstrap, the
// runMobileSpec subprocess helper (JSON parsing on success AND on a gate
// failure with non-zero exit — the load-bearing contract that gate errors
// reach the retry loop), and per-workspace sidecar isolation.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createSpecWorkspace, runMobileSpec, mobileSpecEnv } from "../src/spec-workflow.js";

function tmpRoot() {
  return join(tmpdir(), `mbcodegen-spec-ws-${randomUUID()}`);
}

function hookArgs(name, change, extra = []) {
  return ["workflow", "hook", "--name", name, "--change", change, ...extra, "--json"];
}

test("createSpecWorkspace writes config.yaml (schema: h5-sdd) and the requirement source", async () => {
  const root = tmpRoot();
  try {
    await createSpecWorkspace({ workRoot: root, requirement: "做一个咖啡店官网", change: "coffee" });
    const cfg = await readFile(join(root, "openspec", "config.yaml"), "utf8");
    assert.match(cfg, /schema:\s*h5-sdd/);
    const req = await readFile(join(root, "requirements", "coffee.md"), "utf8");
    assert.equal(req.trim(), "做一个咖啡店官网");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runMobileSpec parses JSON on a successful hook (exit 0)", async () => {
  const root = tmpRoot();
  try {
    await createSpecWorkspace({ workRoot: root, requirement: "做一个咖啡店官网", change: "coffee" });
    const env = mobileSpecEnv(root);
    const res = await runMobileSpec(hookArgs("preNew", "coffee", ["--text-file", "requirements/coffee.md"]), {
      cwd: root,
      env,
    });
    assert.equal(res.ok, true);
    assert.equal(res.exitCode, 0);
    assert.ok(res.json, "json must be parsed on success");
    assert.notEqual(res.json.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runMobileSpec parses JSON EVEN WHEN the gate fails (non-zero exit) — gate errors reach the retry loop", async () => {
  const root = tmpRoot();
  try {
    await createSpecWorkspace({ workRoot: root, requirement: "做一个咖啡店官网", change: "coffee" });
    const env = mobileSpecEnv(root);
    const ms = (args) => runMobileSpec(args, { cwd: root, env });

    // Full bootstrap + into the propose stage.
    await ms(hookArgs("preNew", "coffee", ["--text-file", "requirements/coffee.md"]));
    await ms(hookArgs("postNew", "coffee", ["--text-file", "requirements/coffee.md"]));
    await ms(hookArgs("preStage", "coffee", ["--stage", "propose"]));

    // Write a proposal body with NO status:ready line -> the proposal-status
    // gate must fail. This is a gate failure (JSON emitted), not a throw.
    const propPath = join(root, "openspec", "changes", "coffee", "proposal.md");
    await mkdir(dirname(propPath), { recursive: true });
    await writeFile(propPath, "## 做什么\n\n一个没有 status 行的非法 proposal。\n", "utf8");

    const res = await ms(hookArgs("postNode", "coffee", ["--stage", "propose", "--node", "proposal", "--file", "openspec/changes/coffee/proposal.md"]));
    assert.notEqual(res.exitCode, 0, "gate failure must surface as non-zero exit");
    assert.ok(res.json, "json MUST still be parsed on a gate failure");
    assert.equal(res.json.ok, false);
    const gate = res.json.deterministic?.gate;
    assert.ok(gate, "postNode must expose the node gate deterministically");
    assert.equal(gate.ok, false, "proposal-status gate must fail without a status:ready line");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two workspaces get isolated sidecar state via MOBILE_SPEC_HOME_OVERRIDE", async () => {
  const w1 = tmpRoot();
  const w2 = tmpRoot();
  try {
    await createSpecWorkspace({ workRoot: w1, requirement: "咖啡店", change: "coffee" });
    await createSpecWorkspace({ workRoot: w2, requirement: "花店", change: "flowers" });
    for (const w of [w1, w2]) {
      const env = mobileSpecEnv(w);
      await runMobileSpec(hookArgs("preNew", w === w1 ? "coffee" : "flowers", ["--text-file", `requirements/${w === w1 ? "coffee" : "flowers"}.md`]), {
        cwd: w,
        env,
      });
      // The override target itself becomes the sidecar home -> per-workspace dir.
      assert.ok(existsSync(join(w, ".mobilespec")), "each workspace gets its own .mobilespec home");
    }
    assert.notEqual(w1, w2);
  } finally {
    await rm(w1, { recursive: true, force: true });
    await rm(w2, { recursive: true, force: true });
  }
});

test("runMobileSpec rejects immediately when the job is paused", async () => {
  const root = tmpRoot();
  await mkdir(root, { recursive: true });
  const controller = new AbortController();
  controller.abort(new DOMException("execution paused", "AbortError"));
  try {
    await assert.rejects(
      runMobileSpec(["--help"], { cwd: root, env: mobileSpecEnv(root), signal: controller.signal }),
      (error) => error?.name === "AbortError",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
