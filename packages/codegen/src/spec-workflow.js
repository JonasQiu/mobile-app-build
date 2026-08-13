// Drives the full mobile-spec OpenSpec workflow (propose -> design -> task) for
// a requirement, in an isolated workspace, via the mobile-spec bin run as a
// subprocess. The LLM authoring lives in spec-llm.js; this module owns workspace
// bootstrap, the subprocess helper, and the stage-driving loop with gate-
// enforced retry. No OpenAI calls here.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { authorProposal, authorDesign, authorTasks } from "./spec-llm.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

export const MOBILE_SPEC_BIN = join(repoRoot, "packages", "mobile-spec", "bin", "mobile-spec.js");

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "change";
}

// Per-generation isolation: redirect the sidecar home AND skip the blocking
// monitor spawnSync (workflow.js:2290-2310 has no timeout; SKIP_MONITOR is the
// load-bearing guard). SKIP_EVAL is defensive (only init reads it; we skip init).
export function mobileSpecEnv(specWorkspace) {
  return {
    ...process.env,
    MOBILE_SPEC_HOME_OVERRIDE: join(specWorkspace, ".mobilespec"),
    MOBILE_SPEC_WORKFLOW_SKIP_MONITOR: "1",
    MOBILE_SPEC_SKIP_EVAL: "1",
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
export function runMobileSpec(args, { cwd, env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [MOBILE_SPEC_BIN, ...args], {
      cwd,
      env,
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
      resolveP({ ok: false, json: null, exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolveP({ ok: false, json: null, exitCode: null, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const json = parseJsonLoose(stdout);
      const hookOk = json && json.ok !== false;
      resolveP({ ok: code === 0 && hookOk, json, exitCode: code, stdout, stderr });
    });
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
async function runStage(specWorkspace, env, change, stageId, authorAndWrite, onProgress, maxRetries = 2) {
  const ms = (args) => runMobileSpec(args, { cwd: specWorkspace, env });
  const maxAttempts = maxRetries + 1;

  await ms(hookArgs("preStage", change, ["--stage", stageId]));

  let attempt = 0;
  let prevGateError = "";
  let check = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    const nodes = await authorAndWrite(attempt, prevGateError);
    for (const { node, relPath } of nodes) {
      await ms(hookArgs("postNode", change, ["--stage", stageId, "--node", node, "--file", relPath]));
    }
    const post = await ms(hookArgs("postStage", change, ["--stage", stageId]));
    check = post.json?.deterministic?.check ?? null;
    if (check?.ok) {
      onProgress({ stage: `spec-${stageId}`, attempt, ok: true });
      return { ok: true, attempts: attempt, check };
    }
    prevGateError = gateMessages(check).join("\n") || "stage gate failed";
    onProgress({ stage: `spec-${stageId}`, attempt, ok: false, reason: prevGateError });
  }
  return { ok: false, attempts: attempt, check, reason: prevGateError };
}

export async function runSpecWorkflow({
  requirement,
  workRoot,
  apiKey,
  model,
  onProgress,
  change,
  maxRetriesPerStage = 2,
}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  if (!existsSync(MOBILE_SPEC_BIN)) {
    return { ok: false, reason: `mobile-spec bin not found at ${MOBILE_SPEC_BIN}` };
  }
  const changeName = change || slugify(requirement);
  await rm(workRoot, { recursive: true, force: true });
  await createSpecWorkspace({ workRoot, requirement, change: changeName });
  const specWorkspace = workRoot;
  const env = mobileSpecEnv(specWorkspace);

  const ms = (args) => runMobileSpec(args, { cwd: specWorkspace, env });
  const reqFile = `requirements/${changeName}.md`;

  // --- bootstrap: validate + ingest the requirement source ---
  // resolveChange returns the explicit --change without touching the filesystem,
  // and ensureChangeSidecar only creates the state dir — so the source change
  // dir (openspec/changes/<change>/) need not exist yet; it's created lazily
  // when the propose artifacts are written below.
  const preNew = await ms(hookArgs("preNew", changeName, ["--text-file", reqFile]));
  if (preNew.json?.ok === false) {
    return { ok: false, reason: `preNew failed: ${preNew.json.message || preNew.stderr.slice(-400)}` };
  }
  const postNew = await ms(hookArgs("postNew", changeName, ["--text-file", reqFile]));
  if (postNew.json?.ok === false) {
    return { ok: false, reason: `postNew failed: ${postNew.json.message || postNew.stderr.slice(-400)}` };
  }

  const stageResults = {};
  let proposalMd = "";
  let specMd = "";
  let pageSpecId = "site";
  let designMd = "";
  let reviewMd = "";
  let tasksMd = "";

  // --- PROPOSE: proposal.md + specs/<id>/spec.md ---
  progress({ stage: "spec-propose", phase: "start" });
  const propose = await runStage(
    specWorkspace,
    env,
    changeName,
    "propose",
    async () => {
      const authored = await authorProposal({ requirement, apiKey, model });
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
    maxRetriesPerStage,
  );
  stageResults.propose = propose;
  if (!propose.ok) {
    return { ok: false, reason: `propose stage failed: ${propose.reason || "gate"}`, stageResults, change: changeName, pageSpecId };
  }

  // --- DESIGN: design.md + review.md ---
  progress({ stage: "spec-design", phase: "start" });
  const design = await runStage(
    specWorkspace,
    env,
    changeName,
    "design",
    async () => {
      const authored = await authorDesign({ requirement, proposalMd, specMd, apiKey, model });
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
    maxRetriesPerStage,
  );
  stageResults.design = design;
  if (!design.ok) {
    return { ok: false, reason: `design stage failed: ${design.reason || "gate"}`, stageResults, change: changeName, pageSpecId };
  }

  // --- TASK: tasks.md ---
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
      });
      tasksMd = authored.tasksMd;
      const tasksPath = `openspec/changes/${changeName}/tasks.md`;
      await writeArtifact(specWorkspace, tasksPath, tasksMd);
      return [{ node: "task", relPath: tasksPath }];
    },
    progress,
    maxRetriesPerStage,
  );
  stageResults.task = task;
  if (!task.ok) {
    return { ok: false, reason: `task stage failed: ${task.reason || "gate"}`, stageResults, change: changeName, pageSpecId };
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
