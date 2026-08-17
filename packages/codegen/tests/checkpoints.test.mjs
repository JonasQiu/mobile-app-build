import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearRepairState,
  inspectCheckpoints,
  readRepairState,
  readStageArtifacts,
  writeBuildLog,
  writeDeploymentEvidence,
  writeOutputCheckpoint,
  writeRepairState,
  writeSpecCheckpoint,
} from "../src/checkpoints.js";
import { generatePreviewSet } from "../src/preview.js";

test("successful stages create requirement-scoped checkpoints and viewable artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-build-checkpoints-"));
  const outDir = join(root, "out");
  const specWorkRoot = join(root, "spec");
  const requirement = "做一个真实的活动报名页";
  const change = "event-signup";
  const pageSpecId = "landing";
  try {
    const base = join(specWorkRoot, "openspec", "changes", change);
    await mkdir(join(base, "specs", pageSpecId), { recursive: true });
    const docs = {
      proposalMd: "# Proposal\n\n目标",
      specMd: "# Spec\n\n- 报名",
      designMd: "# Design\n\n移动端布局",
      reviewMd: "# Review\n\n通过",
      tasksMd: "# Tasks\n\n1. 实现",
    };
    await Promise.all([
      writeFile(join(base, "proposal.md"), docs.proposalMd),
      writeFile(join(base, "specs", pageSpecId, "spec.md"), docs.specMd),
      writeFile(join(base, "design.md"), docs.designMd),
      writeFile(join(base, "review.md"), docs.reviewMd),
      writeFile(join(base, "tasks.md"), docs.tasksMd),
    ]);
    await writeSpecCheckpoint({ specWorkRoot, requirement, workflowResult: { change, pageSpecId } });
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec"]);

    await generatePreviewSet({ outDir, requirement, spec: docs.specMd, generation: 1 });
    await writeOutputCheckpoint({ outDir, requirement, stage: "preview" });
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec", "preview"]);
    const previewArtifacts = await readStageArtifacts({ outDir, specWorkRoot, requirement, stage: "preview" });
    assert.equal(previewArtifacts.artifacts.length, 3);
    assert.ok(previewArtifacts.artifacts.every((artifact) => artifact.format === "svg"));

    await writeFile(join(outDir, "mobile-build-manifest.json"), "{\"files\":[]}");
    await writeOutputCheckpoint({ outDir, requirement, stage: "implementation" });
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec", "preview", "implementation"]);

    await mkdir(join(outDir, ".next"), { recursive: true });
    await mkdir(join(outDir, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(outDir, ".next", "BUILD_ID"), "build-id");
    await writeFile(join(outDir, "node_modules", ".bin", "next"), "#!/bin/sh\n");
    await writeBuildLog(outDir, "$ npm run build\nBuild complete");
    await writeOutputCheckpoint({ outDir, requirement, stage: "build" });

    const specArtifacts = await readStageArtifacts({ outDir, specWorkRoot, requirement, stage: "mobile-spec" });
    assert.equal(specArtifacts.checkpointed, true);
    assert.equal(specArtifacts.artifacts.length, 5);
    assert.equal(specArtifacts.artifacts[0].format, "markdown");
    const buildArtifacts = await readStageArtifacts({ outDir, specWorkRoot, requirement, stage: "build" });
    assert.match(buildArtifacts.artifacts[0].content, /Build complete/);

    await writeDeploymentEvidence(outDir, { url: "https://example.com", evidence: { deployPassed: true } });
    await writeOutputCheckpoint({ outDir, requirement, stage: "deployment" });
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec", "preview", "implementation", "build", "deployment"]);
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement: "另一个需求" }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy successful workspaces are migrated without rebuilding", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-build-legacy-checkpoints-"));
  const outDir = join(root, "out");
  const specWorkRoot = join(root, "spec");
  const requirement = "升级前已经完成的项目";
  const change = "legacy-site";
  const pageSpecId = "home";
  try {
    const base = join(specWorkRoot, "openspec", "changes", change);
    await mkdir(join(base, "specs", pageSpecId), { recursive: true });
    await mkdir(join(specWorkRoot, "requirements"), { recursive: true });
    await writeFile(join(specWorkRoot, "requirements", `${change}.md`), `${requirement}\n`);
    await Promise.all([
      writeFile(join(base, "proposal.md"), "# Proposal"),
      writeFile(join(base, "specs", pageSpecId, "spec.md"), "# Spec"),
      writeFile(join(base, "design.md"), "# Design"),
      writeFile(join(base, "review.md"), "# Review"),
      writeFile(join(base, "tasks.md"), "# Tasks"),
    ]);
    await mkdir(join(outDir, ".next"), { recursive: true });
    await mkdir(join(outDir, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(outDir, "mobile-build-manifest.json"), "{\"files\":[]}");
    await writeFile(join(outDir, ".next", "BUILD_ID"), "legacy-build");
    await writeFile(join(outDir, "node_modules", ".bin", "next"), "#!/bin/sh\n");

    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec", "implementation", "build"]);
    const artifacts = await readStageArtifacts({ outDir, specWorkRoot, requirement, stage: "mobile-spec" });
    assert.equal(artifacts.checkpointed, true);
    assert.equal(artifacts.artifacts[1].content, "# Spec");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed-step repair context is requirement and stage scoped until cleared", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-build-repair-state-"));
  const requirement = "做一个预约网站";
  try {
    await writeRepairState({
      outDir: root,
      requirement,
      stage: "build",
      error: "Manifest contains duplicate routes: /records, /records",
      attempts: 3,
    });
    const state = await readRepairState({ outDir: root, requirement, stage: "build" });
    assert.equal(state?.attempts, 3);
    assert.match(state?.error || "", /duplicate routes/);
    assert.equal(await readRepairState({ outDir: root, requirement, stage: "implementation" }), null);
    assert.equal(await readRepairState({ outDir: root, requirement: "另一个需求", stage: "build" }), null);
    await clearRepairState(root);
    assert.equal(await readRepairState({ outDir: root, requirement, stage: "build" }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
