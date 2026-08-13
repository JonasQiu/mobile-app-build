// Keystone no-key test: drive the propose stage through the real Mobile Spec
// gates using a neutral requirement-specific proposal and spec.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createSpecWorkspace, runMobileSpec, mobileSpecEnv } from "../src/spec-workflow.js";
import { finalizeProposalMd } from "../src/spec-llm.js";

const CHANGE = "coffee-site";
const PAGE_SPEC_ID = "coffee-site";
const REQUIREMENT = "做一个社区咖啡店官网，展示菜单、门店时间、品牌故事和联系方式";

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
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name === name) return path;
    }
  }
  return null;
}

test("propose stage passes the real gates with neutral requirement-specific artifacts", async () => {
  const proposalMd = finalizeProposalMd(`# Proposal\n\n## 为什么做\n\n帮助附近顾客快速了解门店信息并决定到店。\n\n## 做什么\n\n- 交付菜单、营业时间、品牌故事和联系方式页面。\n\n## 不做什么\n\n- 不接入在线支付、会员或真实订单系统。`);
  const specMd = `# Spec: 社区咖啡店官网\n\n## 页面与路由\n\n- / 首页\n- /menu 菜单\n- /story 品牌故事\n- /contact 联系方式\n\n## 验收标准\n\n- 所有页面必须展示与原始需求一致的真实中文内容。\n- 移动端与桌面端均可使用导航访问所有路由。\n`;
  const root = join(tmpdir(), `mbcodegen-spec-drive-${randomUUID()}`);
  try {
    await createSpecWorkspace({ workRoot: root, requirement: REQUIREMENT, change: CHANGE });
    const env = mobileSpecEnv(root);
    const ms = (args) => runMobileSpec(args, { cwd: root, env });
    const reqFile = `requirements/${CHANGE}.md`;
    assert.notEqual((await ms(hookArgs("preNew", ["--text-file", reqFile]))).json?.ok, false);
    assert.notEqual((await ms(hookArgs("postNew", ["--text-file", reqFile]))).json?.ok, false);
    await ms(hookArgs("preStage", ["--stage", "propose"]));
    const proposalPath = `openspec/changes/${CHANGE}/proposal.md`;
    const specPath = `openspec/changes/${CHANGE}/specs/${PAGE_SPEC_ID}/spec.md`;
    await writeArtifact(root, proposalPath, proposalMd);
    await writeArtifact(root, specPath, specMd);
    assert.equal((await ms(hookArgs("postNode", ["--stage", "propose", "--node", "proposal", "--file", proposalPath]))).json?.deterministic?.gate?.ok, true);
    assert.notEqual((await ms(hookArgs("postNode", ["--stage", "propose", "--node", "specs", "--file", specPath]))).json?.ok, false);
    const postStage = await ms(hookArgs("postStage", ["--stage", "propose"]));
    assert.equal(postStage.json?.deterministic?.check?.ok, true);
    const persisted = await findChecksFile(root, "propose.json");
    assert.ok(persisted);
    assert.equal(JSON.parse(readFileSync(persisted, "utf8")).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
