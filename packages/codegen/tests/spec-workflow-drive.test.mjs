// Keystone no-key test: drives the propose stage through the REAL mobile-spec
// gates (no OpenAI) by feeding the golden fitness proposal/spec directly and
// appending the deterministic finalizeProposalMd footer. Proves end-to-end that
// the driving loop + deterministic footers satisfy checkProposalStatus +
// checkProposalOpenQuestions. (design/task stages need the LLM and aren't driven here.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createSpecWorkspace, runMobileSpec, mobileSpecEnv } from "../src/spec-workflow.js";
import { finalizeProposalMd } from "../src/spec-llm.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const GOLDEN_PROPOSAL = join(repoRoot, "generated/fitness-web.spec/openspec/changes/fitness/proposal.md");
const GOLDEN_SPEC = join(repoRoot, "generated/fitness-web.spec/openspec/changes/fitness/specs/fitness/spec.md");

const CHANGE = "fitness";
const PAGE_SPEC_ID = "fitness";

function hookArgs(name, extra = []) {
  return ["workflow", "hook", "--name", name, "--change", CHANGE, ...extra, "--json"];
}

async function writeArtifact(root, relPath, content) {
  const abs = join(root, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function findChecksFile(root, name) {
  const stack = [join(root, ".mobilespec")];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === name) return p;
    }
  }
  return null;
}

test("propose stage passes the real gates with a finalized golden proposal + golden spec", async () => {
  const goldenProposal = readFileSync(GOLDEN_PROPOSAL, "utf8");
  const goldenSpec = readFileSync(GOLDEN_SPEC, "utf8");
  // The golden proposal has NO footer — finalize appends the deterministic
  // 未决问题 table + status:ready that the strict gates require.
  const proposalMd = finalizeProposalMd(goldenProposal);

  const root = join(tmpdir(), `mbcodegen-spec-drive-${randomUUID()}`);
  try {
    await createSpecWorkspace({ workRoot: root, requirement: "健身课程预订网站", change: CHANGE });
    const env = mobileSpecEnv(root);
    const ms = (args) => runMobileSpec(args, { cwd: root, env });

    const reqFile = `requirements/${CHANGE}.md`;
    const preNew = await ms(hookArgs("preNew", ["--text-file", reqFile]));
    assert.notEqual(preNew.json?.ok, false, "preNew must succeed");

    const postNew = await ms(hookArgs("postNew", ["--text-file", reqFile]));
    assert.notEqual(postNew.json?.ok, false, "postNew must succeed");

    await ms(hookArgs("preStage", ["--stage", "propose"]));

    const proposalPath = `openspec/changes/${CHANGE}/proposal.md`;
    const specPath = `openspec/changes/${CHANGE}/specs/${PAGE_SPEC_ID}/spec.md`;
    await writeArtifact(root, proposalPath, proposalMd);
    await writeArtifact(root, specPath, goldenSpec);

    const postNodeProposal = await ms(hookArgs("postNode", ["--stage", "propose", "--node", "proposal", "--file", proposalPath]));
    assert.equal(postNodeProposal.json?.deterministic?.gate?.ok, true, "node gate proposal-status must pass");

    const postNodeSpecs = await ms(hookArgs("postNode", ["--stage", "propose", "--node", "specs", "--file", specPath]));
    assert.notEqual(postNodeSpecs.json?.ok, false, "specs node must accept the non-empty spec");

    const postStage = await ms(hookArgs("postStage", ["--stage", "propose"]));
    assert.equal(postStage.json?.ok, true, "propose postStage must report ok");
    assert.equal(postStage.json?.deterministic?.check?.ok, true, "the propose stage gate (check) must pass");

    // postStage also persists checks/propose.json — prove it was written.
    const persisted = await findChecksFile(root, "propose.json");
    assert.ok(persisted, "checks/propose.json must be persisted by postStage");
    const persistedJson = JSON.parse(readFileSync(persisted, "utf8"));
    assert.equal(persistedJson.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
