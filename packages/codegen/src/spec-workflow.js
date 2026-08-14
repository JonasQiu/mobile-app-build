// Drives the full mobile-spec OpenSpec workflow (propose -> design -> task) for
// a requirement, in an isolated workspace, via the mobile-spec bin run as a
// subprocess. The LLM authoring lives in spec-llm.js; this module owns workspace
// bootstrap, the subprocess helper, and the stage-driving loop with gate-
// enforced retry. No OpenAI calls here.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { hashRequirement } from "./checkpoints.js";
import { authorProposal, authorDesign, authorTasks } from "./spec-llm.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

export const MOBILE_SPEC_BIN = join(repoRoot, "packages", "mobile-spec", "bin", "mobile-spec.js");
const SPEC_PROGRESS_MARKER = "mobile-spec-progress.json";
const SPEC_STAGES = ["propose", "design", "task"];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function readSpecProgress({ workRoot, requirement, change }) {
  const state = await readJson(join(workRoot, SPEC_PROGRESS_MARKER));
  if (!state || state.requirementHash !== hashRequirement(requirement) || state.change !== change) return null;
  if (!Array.isArray(state.completedStages) || state.completedStages.some((stage) => !SPEC_STAGES.includes(stage))) return null;
  if (state.completedStages.some((stage, index) => stage !== SPEC_STAGES[index])) return null;
  const completed = [...state.completedStages];
  return { ...state, completedStages: completed };
}

export async function writeSpecProgress({ workRoot, requirement, change, pageSpecId, completedStages, stageAttempts = {}, lastStage = null, lastError = "" }) {
  const state = {
    schemaVersion: 1,
    requirementHash: hashRequirement(requirement),
    change,
    pageSpecId,
    completedStages: SPEC_STAGES.filter((stage) => completedStages.includes(stage)),
    stageAttempts,
    lastStage,
    lastError: String(lastError || "").slice(-12_000),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, SPEC_PROGRESS_MARKER), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

async function loadCompletedArtifacts({ workRoot, change, state }) {
  const completed = new Set(state.completedStages);
  const pageSpecId = state.pageSpecId || "site";
  const base = join(workRoot, "openspec", "changes", change);
  const result = { proposalMd: "", specMd: "", designMd: "", reviewMd: "", tasksMd: "", pageSpecId };
  if (completed.has("propose")) {
    result.proposalMd = await readFile(join(base, "proposal.md"), "utf8");
    result.specMd = await readFile(join(base, "specs", pageSpecId, "spec.md"), "utf8");
  }
  if (completed.has("design")) {
    result.designMd = await readFile(join(base, "design.md"), "utf8");
    result.reviewMd = await readFile(join(base, "review.md"), "utf8");
  }
  if (completed.has("task")) result.tasksMd = await readFile(join(base, "tasks.md"), "utf8");
  const required = completed.has("task")
    ? [result.proposalMd, result.specMd, result.designMd, result.reviewMd, result.tasksMd]
    : completed.has("design")
      ? [result.proposalMd, result.specMd, result.designMd, result.reviewMd]
      : completed.has("propose") ? [result.proposalMd, result.specMd] : [];
  if (required.some((content) => !String(content).trim())) throw new Error("Mobile Spec 子阶段检查点缺少产物");
  return result;
}

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const digest = [...new TextEncoder().encode(String(value || ""))]
    .reduce((hash, byte) => Math.imul(hash ^ byte, 16777619) >>> 0, 2166136261)
    .toString(36)
    .slice(0, 8);
  return `${base || "site"}-${digest}`;
}

// Per-generation isolation: redirect the sidecar home AND skip the blocking
// monitor spawnSync (workflow.js:2290-2310 has no timeout; SKIP_MONITOR is the
// load-bearing guard). SKIP_EVAL is defensive (only init reads it; we skip init).
export function mobileSpecEnv(specWorkspace) {
  return {
    ...process.env,
    MOBILE_SPEC_HOME_OVERRIDE: join(specWorkspace, ".mobilespec"),
    MOBILE_SPEC_WORKFLOW_SKIP_MONITOR: "1",
  };
}

// Create the minimal OpenSpec workspace. loadContext only needs
// openspec/config.yaml with a `schema` field; the h5-sdd schema is resolved via
// the mobile-spec __dirname fallback, so we never run `init` (avoids its
// process.exit hazard and skill installs).
export async function createSpecWorkspace({ workRoot, requirement, change }) {
  await mkdir(join(workRoot, "openspec"), { recursive: true });
  await mkdir(join(workRoot, "requirements"), { recursive: true });
  await writeFile(join(workRoot, "openspec", "config.yaml"), "schema: h5-sdd\n", "utf8");
  await writeFile(join(workRoot, "requirements", `${change}.md`), String(requirement || "").trim() + "\n", "utf8");
  return { specWorkspace: workRoot, change };
}

// Spawn `node <bin> workflow ... --json`. CRITICAL: --json result is printed on
// stdout EVEN WHEN the exit code is 1 (cmdWorkflow sets exitCode on ok:false),
// so we parse stdout regardless of exit code — that's how gate errors reach the
// retry loop.
export function runMobileSpec(args, { cwd, env, timeoutMs = 60_000, signal } = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [MOBILE_SPEC_BIN, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      const error = signal?.reason instanceof Error ? signal.reason : new DOMException("execution paused", "AbortError");
      finish(rejectP, error);
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
      killTimer.unref();
    };
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
      finish(resolveP, { ok: false, json: null, exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", () => {
      finish(resolveP, { ok: false, json: null, exitCode: null, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      const json = parseJsonLoose(stdout);
      const hookOk = json && json.ok !== false;
      finish(resolveP, { ok: code === 0 && hookOk, json, exitCode: code, stdout, stderr });
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Tolerant JSON extraction: writeResult prints a pretty-printed JSON object,
// but be defensive against stray log lines around it.
function parseJsonLoose(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function writeArtifact(specWorkspace, relPath, content) {
  const abs = resolve(specWorkspace, relPath);
  const rel = relative(specWorkspace, abs);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Refusing to write outside spec workspace: ${relPath}`);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return abs;
}

function hookArgs(name, change, extra = []) {
  return ["workflow", "hook", "--name", name, "--change", change, ...extra, "--json"];
}

// Collect the failing gate messages from a postStage check, to feed back on retry.
function gateMessages(check) {
  if (!check) return [];
  if (Array.isArray(check.checks)) {
    const msgs = check.checks.filter((c) => c && c.ok === false).map((c) => c.message).filter(Boolean);
    if (msgs.length) return msgs;
  }
  return check.message ? [check.message] : [];
}

// Drive one stage. `authorAndWrite(attempt, prevGateError)` authors the stage's
// artifacts, writes them into specWorkspace, and RETURNS the node/file pairs it
// produced (as [{node, relPath}]) — necessary for the propose stage, whose spec
// path depends on pageSpecId which is only known after authoring.
async function runStage(specWorkspace, env, change, stageId, authorAndWrite, onProgress, signal, maxRetries = 2, initialGateError = "", attemptOffset = 0) {
  const ms = (args) => runMobileSpec(args, { cwd: specWorkspace, env, signal });
  const maxAttempts = maxRetries + 1;

  const preStage = await ms(hookArgs("preStage", change, ["--stage", stageId]));
  if (!preStage.ok) {
    return { ok: false, attempts: attemptOffset, check: null, reason: preStage.json?.message || preStage.stderr || `${stageId} preStage failed` };
  }

  let attempt = 0;
  let prevGateError = initialGateError;
  let check = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    signal?.throwIfAborted();
    const currentAttempt = attemptOffset + attempt;
    let nodes;
    try {
      nodes = await authorAndWrite(currentAttempt, prevGateError);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      prevGateError = error instanceof Error ? error.message : String(error);
      onProgress({ stage: `spec-${stageId}`, attempt: currentAttempt, ok: false, reason: prevGateError });
      continue;
    }
    let nodeFailure = "";
    for (const { node, relPath } of nodes) {
      const postNode = await ms(hookArgs("postNode", change, ["--stage", stageId, "--node", node, "--file", relPath]));
      if (!postNode.ok) {
        nodeFailure = postNode.json?.message || postNode.stderr || `${node} gate failed`;
        break;
      }
    }
    if (nodeFailure) {
      prevGateError = nodeFailure;
      onProgress({ stage: `spec-${stageId}`, attempt: currentAttempt, ok: false, reason: prevGateError });
      continue;
    }
    const post = await ms(hookArgs("postStage", change, ["--stage", stageId]));
    check = post.json?.deterministic?.check ?? null;
    if (check?.ok) {
      onProgress({ stage: `spec-${stageId}`, attempt: currentAttempt, ok: true });
      return { ok: true, attempts: currentAttempt, check };
    }
    prevGateError = gateMessages(check).join("\n") || "stage gate failed";
    onProgress({ stage: `spec-${stageId}`, attempt: currentAttempt, ok: false, reason: prevGateError });
  }
  return { ok: false, attempts: attemptOffset + attempt, check, reason: prevGateError };
}

export async function runSpecWorkflow({
  requirement,
  workRoot,
  apiKey,
  model,
  onProgress,
  change,
  maxRetriesPerStage = 2,
  signal,
  resume = false,
}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  if (!existsSync(MOBILE_SPEC_BIN)) {
    return { ok: false, reason: `mobile-spec bin not found at ${MOBILE_SPEC_BIN}` };
  }
  const changeName = change || slugify(requirement);
  signal?.throwIfAborted();
  let resumeState = resume ? await readSpecProgress({ workRoot, requirement, change: changeName }) : null;
  let resumedArtifacts = null;
  if (resumeState) {
    try {
      resumedArtifacts = await loadCompletedArtifacts({ workRoot, change: changeName, state: resumeState });
    } catch {
      resumeState = null;
    }
  }
  if (!resumeState) {
    await rm(workRoot, { recursive: true, force: true });
    signal?.throwIfAborted();
  }
  await createSpecWorkspace({ workRoot, requirement, change: changeName });
  const specWorkspace = workRoot;
  const env = mobileSpecEnv(specWorkspace);

  const ms = (args) => runMobileSpec(args, { cwd: specWorkspace, env, signal });
  const reqFile = `requirements/${changeName}.md`;

  // --- bootstrap: validate + ingest the requirement source ---
  // resolveChange returns the explicit --change without touching the filesystem,
  // and ensureChangeSidecar only creates the state dir — so the source change
  // dir (openspec/changes/<change>/) need not exist yet; it's created lazily
  // when the propose artifacts are written below.
  if (!resumeState) {
    const preNew = await ms(hookArgs("preNew", changeName, ["--text-file", reqFile]));
    if (!preNew.ok) {
      return { ok: false, reason: `preNew failed: ${preNew.json?.message || preNew.stderr.slice(-400)}` };
    }
    const postNew = await ms(hookArgs("postNew", changeName, ["--text-file", reqFile]));
    if (!postNew.ok) {
      return { ok: false, reason: `postNew failed: ${postNew.json?.message || postNew.stderr.slice(-400)}` };
    }
    resumeState = await writeSpecProgress({
      workRoot,
      requirement,
      change: changeName,
      pageSpecId: "site",
      completedStages: [],
    });
  }

  const completedStages = [...resumeState.completedStages];
  const stageAttempts = { ...(resumeState.stageAttempts || {}) };
  const stageResults = Object.fromEntries(completedStages.map((stage) => [stage, { ok: true, checkpointed: true, attempts: stageAttempts[stage] || 0 }]));
  let proposalMd = resumedArtifacts?.proposalMd || "";
  let specMd = resumedArtifacts?.specMd || "";
  let pageSpecId = resumedArtifacts?.pageSpecId || resumeState.pageSpecId || "site";
  let designMd = resumedArtifacts?.designMd || "";
  let reviewMd = resumedArtifacts?.reviewMd || "";
  let tasksMd = resumedArtifacts?.tasksMd || "";

  const saveProgress = async (lastStage = null, lastError = "") => {
    resumeState = await writeSpecProgress({
      workRoot,
      requirement,
      change: changeName,
      pageSpecId,
      completedStages,
      stageAttempts,
      lastStage,
      lastError,
    });
  };

  // --- PROPOSE: proposal.md + specs/<id>/spec.md ---
  if (completedStages.includes("propose")) {
    progress({ stage: "spec-propose", phase: "reused", ok: true, attempt: stageAttempts.propose || 0 });
  } else {
    progress({ stage: "spec-propose", phase: "start" });
    const propose = await runStage(
    specWorkspace,
    env,
    changeName,
    "propose",
    async (attempt, prevGateError) => {
      const authored = await authorProposal({ requirement, apiKey, model, attempt, prevGateError, signal });
      pageSpecId = authored.pageSpecId || pageSpecId;
      proposalMd = authored.proposalMd;
      specMd = authored.specMd;
      const proposalPath = `openspec/changes/${changeName}/proposal.md`;
      const specPath = `openspec/changes/${changeName}/specs/${pageSpecId}/spec.md`;
      await writeArtifact(specWorkspace, proposalPath, proposalMd);
      await writeArtifact(specWorkspace, specPath, specMd);
      return [
        { node: "proposal", relPath: proposalPath },
        { node: "specs", relPath: specPath },
      ];
    },
    progress,
    signal,
    maxRetriesPerStage,
    resumeState.lastStage === "propose" ? resumeState.lastError : "",
    stageAttempts.propose || 0,
    );
    stageResults.propose = propose;
    stageAttempts.propose = propose.attempts;
    if (!propose.ok) {
      await saveProgress("propose", propose.reason);
      return { ok: false, reason: `propose stage failed: ${propose.reason || "gate"}`, stageResults, change: changeName, pageSpecId };
    }
    completedStages.push("propose");
    await saveProgress();
  }

  // --- DESIGN: design.md + review.md ---
  if (completedStages.includes("design")) {
    progress({ stage: "spec-design", phase: "reused", ok: true, attempt: stageAttempts.design || 0 });
  } else {
    progress({ stage: "spec-design", phase: "start" });
    const design = await runStage(
    specWorkspace,
    env,
    changeName,
    "design",
    async (attempt, prevGateError) => {
      const authored = await authorDesign({ requirement, proposalMd, specMd, apiKey, model, attempt, prevGateError, signal });
      designMd = authored.designMd;
      reviewMd = authored.reviewMd;
      const designPath = `openspec/changes/${changeName}/design.md`;
      const reviewPath = `openspec/changes/${changeName}/review.md`;
      await writeArtifact(specWorkspace, designPath, designMd);
      await writeArtifact(specWorkspace, reviewPath, reviewMd);
      return [
        { node: "design", relPath: designPath },
        { node: "review", relPath: reviewPath },
      ];
    },
    progress,
    signal,
    maxRetriesPerStage,
    resumeState.lastStage === "design" ? resumeState.lastError : "",
    stageAttempts.design || 0,
    );
    stageResults.design = design;
    stageAttempts.design = design.attempts;
    if (!design.ok) {
      await saveProgress("design", design.reason);
      return { ok: false, reason: `design stage failed: ${design.reason || "gate"}`, stageResults, change: changeName, pageSpecId };
    }
    completedStages.push("design");
    await saveProgress();
  }

  // --- TASK: tasks.md ---
  if (completedStages.includes("task")) {
    progress({ stage: "spec-task", phase: "reused", ok: true, attempt: stageAttempts.task || 0 });
  } else {
    progress({ stage: "spec-task", phase: "start" });
    const task = await runStage(
    specWorkspace,
    env,
    changeName,
    "task",
    async (attempt, prevGateError) => {
      const authored = await authorTasks({
        requirement,
        proposalMd,
        specMd,
        designMd,
        apiKey,
        model,
        attempt,
        prevGateError,
        signal,
      });
      tasksMd = authored.tasksMd;
      const tasksPath = `openspec/changes/${changeName}/tasks.md`;
      await writeArtifact(specWorkspace, tasksPath, tasksMd);
      return [{ node: "task", relPath: tasksPath }];
    },
    progress,
    signal,
    maxRetriesPerStage,
    resumeState.lastStage === "task" ? resumeState.lastError : "",
    stageAttempts.task || 0,
    );
    stageResults.task = task;
    stageAttempts.task = task.attempts;
    if (!task.ok) {
      await saveProgress("task", task.reason);
      return { ok: false, reason: `task stage failed: ${task.reason || "gate"}`, stageResults, change: changeName, pageSpecId };
    }
    completedStages.push("task");
    await saveProgress();
  }

  return {
    ok: true,
    specMd,
    proposalMd,
    designMd,
    reviewMd,
    tasksMd,
    change: changeName,
    pageSpecId,
    stageResults,
  };
}
