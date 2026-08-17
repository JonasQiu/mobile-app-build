import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generatePreviewSet, readApprovedPreview, readPreviewArtifacts, validatePreviewApproval } from "../src/preview.js";

test("preview stage creates three safe requirement-specific SVG choices", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "mobile-build-previews-"));
  const requirement = "做一个活动报名网站 <script>alert(1)</script>";
  try {
    const manifest = await generatePreviewSet({
      outDir,
      requirement,
      spec: "# 活动报名\n\n- 展示活动日期与地点\n- 提供报名入口\n- 展示剩余名额",
      generation: 1,
    });
    assert.equal(manifest.options.length, 3);
    assert.equal(new Set(manifest.options.map((option) => option.id)).size, 3);
    const artifacts = await readPreviewArtifacts({ outDir, requirement });
    assert.equal(artifacts.length, 3);
    assert.ok(artifacts.every((artifact) => artifact.format === "svg"));
    assert.ok(artifacts.every((artifact) => artifact.content.includes("活动报名")));
    assert.ok(artifacts.every((artifact) => !artifact.content.includes("<script>")));
    const approved = manifest.options[1];
    assert.equal(await validatePreviewApproval({ outDir, requirement, previewId: approved.id }), true);
    assert.equal(await validatePreviewApproval({ outDir, requirement, previewId: "stale-preview" }), false);
    assert.equal((await readApprovedPreview({ outDir, requirement, previewId: approved.id }))?.title, approved.title);
    const firstImages = artifacts.map((artifact) => artifact.content);
    const regenerated = await generatePreviewSet({ outDir, requirement, spec: "# 活动报名\n\n- 展示活动日期与地点" });
    const regeneratedArtifacts = await readPreviewArtifacts({ outDir, requirement });
    assert.notEqual(regenerated.setId, manifest.setId);
    assert.ok(regeneratedArtifacts.some((artifact, index) => artifact.content !== firstImages[index]));
    assert.equal(await validatePreviewApproval({ outDir, requirement, previewId: approved.id }), false);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
