import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const EXECUTION_STAGES = ["mobile-spec", "implementation", "build", "deployment"];

const SPEC_MARKER = "mobile-build-checkpoint.json";
const OUTPUT_MARKER = ".mobile-build-checkpoint.json";
const BUILD_LOG = ".mobile-build-build.log";
const DEPLOYMENT_EVIDENCE = ".mobile-build-deployment.json";
const REPAIR_STATE = ".mobile-build-repair.json";
const MAX_ARTIFACT_CHARS = 120_000;

export function hashRequirement(requirement) {
  return createHash("sha256").update(String(requirement || "").trim()).digest("hex");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readArtifact(path) {
  const content = await readFile(path, "utf8");
  if (content.length <= MAX_ARTIFACT_CHARS) return content;
  return `${content.slice(0, MAX_ARTIFACT_CHARS)}\n\n> 预览已截断，仅展示前 ${MAX_ARTIFACT_CHARS} 个字符。`;
}

export async function writeSpecCheckpoint({ specWorkRoot, requirement, workflowResult }) {
  const marker = {
    schemaVersion: 1,
    requirementHash: hashRequirement(requirement),
    completedStages: ["mobile-spec"],
    change: workflowResult.change,
    pageSpecId: workflowResult.pageSpecId,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(join(specWorkRoot, SPEC_MARKER), marker);
  return marker;
}

export async function loadSpecCheckpoint({ specWorkRoot, requirement }) {
  let marker = await readJson(join(specWorkRoot, SPEC_MARKER));
  if (!marker || marker.requirementHash !== hashRequirement(requirement) || !marker.change || !marker.pageSpecId) {
    marker = await findLegacySpecMarker({ specWorkRoot, requirement });
    if (!marker) return null;
    await writeJson(join(specWorkRoot, SPEC_MARKER), marker);
  }
  const base = join(specWorkRoot, "openspec", "changes", marker.change);
  const paths = {
    proposalMd: join(base, "proposal.md"),
    specMd: join(base, "specs", marker.pageSpecId, "spec.md"),
    designMd: join(base, "design.md"),
    reviewMd: join(base, "review.md"),
    tasksMd: join(base, "tasks.md"),
  };
  try {
    const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readArtifact(path)]));
    const artifacts = Object.fromEntries(entries);
    if (Object.values(artifacts).some((content) => !String(content).trim())) return null;
    return { ok: true, ...artifacts, change: marker.change, pageSpecId: marker.pageSpecId, stageResults: {}, checkpointed: true };
  } catch {
    return null;
  }
}

async function findLegacySpecMarker({ specWorkRoot, requirement }) {
  try {
    const requirementFiles = (await readdir(join(specWorkRoot, "requirements"))).filter((name) => name.endsWith(".md")).sort();
    let change = "";
    for (const name of requirementFiles) {
      const saved = await readFile(join(specWorkRoot, "requirements", name), "utf8");
      if (saved.trim() === String(requirement || "").trim()) {
        change = name.slice(0, -3);
        break;
      }
    }
    if (!change) return null;
    const specsRoot = join(specWorkRoot, "openspec", "changes", change, "specs");
    const entries = await readdir(specsRoot, { withFileTypes: true });
    const pageSpecId = entries.filter((entry) => entry.isDirectory() && existsSync(join(specsRoot, entry.name, "spec.md")))
      .map((entry) => entry.name).sort()[0];
    if (!pageSpecId) return null;
    return {
      schemaVersion: 1,
      requirementHash: hashRequirement(requirement),
      completedStages: ["mobile-spec"],
      change,
      pageSpecId,
      migratedFromLegacy: true,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function validOutputMarker(outDir, requirement) {
  const marker = await readJson(join(outDir, OUTPUT_MARKER));
  if (!marker || marker.requirementHash !== hashRequirement(requirement) || !Array.isArray(marker.completedStages)) return null;
  return marker;
}

export async function writeOutputCheckpoint({ outDir, requirement, stage }) {
  if (!EXECUTION_STAGES.includes(stage) || stage === "mobile-spec") throw new Error(`invalid output checkpoint stage: ${stage}`);
  const current = await validOutputMarker(outDir, requirement);
  const completed = new Set(current?.completedStages || []);
  completed.add(stage);
  const marker = {
    schemaVersion: 1,
    requirementHash: hashRequirement(requirement),
    completedStages: EXECUTION_STAGES.filter((item) => completed.has(item)),
    updatedAt: new Date().toISOString(),
  };
  await writeJson(join(outDir, OUTPUT_MARKER), marker);
  return marker;
}

export async function invalidateOutputAfter({ outDir, requirement, stage }) {
  const current = await validOutputMarker(outDir, requirement);
  if (!current) return;
  const keepIndex = EXECUTION_STAGES.indexOf(stage);
  await writeJson(join(outDir, OUTPUT_MARKER), {
    ...current,
    completedStages: current.completedStages.filter((item) => EXECUTION_STAGES.indexOf(item) <= keepIndex),
    updatedAt: new Date().toISOString(),
  });
}

export async function writeBuildLog(outDir, log) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, BUILD_LOG), String(log || ""), "utf8");
}

export async function writeDeploymentEvidence(outDir, evidence) {
  await writeJson(join(outDir, DEPLOYMENT_EVIDENCE), evidence);
}

export async function readDeploymentEvidence(outDir) {
  return readJson(join(outDir, DEPLOYMENT_EVIDENCE));
}

export async function readRepairState({ outDir, requirement, stage }) {
  const state = await readJson(join(outDir, REPAIR_STATE));
  if (!state || state.requirementHash !== hashRequirement(requirement) || state.stage !== stage || !state.error) return null;
  return state;
}

export async function writeRepairState({ outDir, requirement, stage, error, attempts = 1 }) {
  const state = {
    schemaVersion: 1,
    requirementHash: hashRequirement(requirement),
    stage,
    error: String(error || "").slice(-24_000),
    attempts,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(join(outDir, REPAIR_STATE), state);
  return state;
}

export async function clearRepairState(outDir) {
  await rm(join(outDir, REPAIR_STATE), { force: true });
}

export async function inspectCheckpoints({ outDir, specWorkRoot, requirement }) {
  const completed = [];
  const spec = await loadSpecCheckpoint({ specWorkRoot, requirement });
  if (spec) completed.push("mobile-spec");
  let marker = await validOutputMarker(outDir, requirement);
  if (!marker && spec && existsSync(join(outDir, "mobile-build-manifest.json"))) {
    await writeOutputCheckpoint({ outDir, requirement, stage: "implementation" });
    if (existsSync(join(outDir, ".next", "BUILD_ID")) && existsSync(join(outDir, "node_modules", ".bin", "next"))) {
      await writeOutputCheckpoint({ outDir, requirement, stage: "build" });
    }
    marker = await validOutputMarker(outDir, requirement);
  }
  if (marker?.completedStages.includes("implementation") && existsSync(join(outDir, "mobile-build-manifest.json"))) {
    completed.push("implementation");
  }
  if (marker?.completedStages.includes("build")
    && existsSync(join(outDir, ".next", "BUILD_ID"))
    && existsSync(join(outDir, "node_modules", ".bin", "next"))) {
    completed.push("build");
  }
  if (marker?.completedStages.includes("deployment") && existsSync(join(outDir, DEPLOYMENT_EVIDENCE))) {
    completed.push("deployment");
  }
  return EXECUTION_STAGES.filter((stage) => completed.includes(stage));
}

export async function readStageArtifacts({ outDir, specWorkRoot, requirement, stage }) {
  const checkpoints = await inspectCheckpoints({ outDir, specWorkRoot, requirement });
  if (!EXECUTION_STAGES.includes(stage)) throw new Error("unknown execution stage");
  if (!checkpoints.includes(stage)) return { stage, checkpointed: false, artifacts: [] };

  if (stage === "mobile-spec") {
    const spec = await loadSpecCheckpoint({ specWorkRoot, requirement });
    return {
      stage,
      checkpointed: true,
      artifacts: [
        ["proposal.md", "Proposal", spec.proposalMd],
        ["spec.md", "页面规格", spec.specMd],
        ["design.md", "设计说明", spec.designMd],
        ["review.md", "设计评审", spec.reviewMd],
        ["tasks.md", "执行任务", spec.tasksMd],
      ].map(([name, label, content]) => ({ name, label, format: "markdown", content })),
    };
  }
  if (stage === "implementation") {
    return {
      stage,
      checkpointed: true,
      artifacts: [{
        name: "mobile-build-manifest.json",
        label: "生成文件清单",
        format: "json",
        content: await readArtifact(join(outDir, "mobile-build-manifest.json")),
      }],
    };
  }
  if (stage === "build") {
    return {
      stage,
      checkpointed: true,
      artifacts: [{ name: "build.log", label: "生产构建日志", format: "text", content: await readArtifact(join(outDir, BUILD_LOG)) }],
    };
  }
  return {
    stage,
    checkpointed: true,
    artifacts: [{ name: "deployment.json", label: "部署与健康检查证据", format: "json", content: await readArtifact(join(outDir, DEPLOYMENT_EVIDENCE)) }],
  };
}
