import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectCheckpoints,
  readStageArtifacts,
  writeBuildLog,
  writeDeploymentEvidence,
  writeOutputCheckpoint,
  writeSpecCheckpoint,
} from "../src/checkpoints.js";

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

    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "mobile-build-manifest.json"), "{\"files\":[]}");
    await writeOutputCheckpoint({ outDir, requirement, stage: "implementation" });
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec", "implementation"]);

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
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement }), ["mobile-spec", "implementation", "build", "deployment"]);
    assert.deepEqual(await inspectCheckpoints({ outDir, specWorkRoot, requirement: "另一个需求" }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
