// Unit test of the deterministic gate-passing footers. These footers are the
// reliability core: the strict proposal/review gates (single status line, 未决问题
// table separator regex) are too fiddly to trust to the LLM, so the engine
// post-processes the body. Here we assert the structural invariants the gates
// check (verified against checkProposalStatus / checkProposalOpenQuestions /
// checkReviewStatus in packages/mobile-spec/scripts/commands/workflow.js).
// The end-to-end proof against the REAL gates lives in spec-workflow-drive.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { finalizeProposalMd, finalizeReviewMd } from "../src/spec-llm.js";

const STATUS_LINE = /^[`]?status:\s*(?:ready|blocked|pass)[`]?\s*$/gim;
const OPEN_Q_SECTION = /^##\s+(?:\d+\.\s*)?未决问题\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/m;

function statusLineCount(md) {
  return (md.match(STATUS_LINE) || []).length;
}

function parseOpenQuestionsTable(md) {
  const m = md.match(OPEN_Q_SECTION);
  if (!m) return null;
  const rows = m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  return rows;
}

test("finalizeProposalMd appends exactly one status:ready as the last non-empty line", () => {
  const out = finalizeProposalMd("# Why\n\n做一个小站。\n\n## 做什么\n\n- A\n- B\n");
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(lines[lines.length - 1], "`status: ready`");
  assert.equal(statusLineCount(out), 1);
});

test("finalizeProposalMd emits a valid 未决问题 table (header columns + separator, zero data rows ok)", () => {
  const out = finalizeProposalMd("正文内容，足够长以满足最低长度要求，这里只是占位正文内容。\n");
  const rows = parseOpenQuestionsTable(out);
  assert.ok(rows, "未决问题 section must exist");
  assert.ok(rows.length >= 2, "must have a header and a separator row");
  const [header, separator] = rows;
  for (const col of ["问题", "处置状态", "处置结论", "确认依据"]) {
    assert.ok(header.includes(col), `header must contain ${col}`);
  }
  const headerCells = header.split("|").filter((c) => c.trim() !== "");
  const sepCells = separator.split("|").filter((c) => c.trim() !== "");
  assert.equal(sepCells.length, headerCells.length, "separator must have same column count as header");
  for (const cell of sepCells) {
    assert.match(cell, /^:?-{3,}:?$/, "separator cell must be a markdown table divider");
  }
  // header + separator only, no data rows — gate accepts this.
  assert.equal(rows.length, 2);
});

test("finalizeProposalMd is idempotent and strips any LLM-written status / 未决问题", () => {
  const messy = [
    "## 背景\n\n需求描述，足够长的正文内容以超过最低门槛。\n",
    "## 未决问题\n\n| 问题 | 处置状态 |\n|------|----------|\n| x | 已解决 |\n",
    "`status: ready`\n",
  ].join("\n");
  const once = finalizeProposalMd(messy);
  const twice = finalizeProposalMd(once);
  assert.equal(twice, once, "finalizing an already-finalized proposal must not change it");
  assert.equal(statusLineCount(once), 1, "exactly one status line after cleanup");
  // The LLM's data row must be gone — only the engine's empty table remains.
  const rows = parseOpenQuestionsTable(once);
  assert.equal(rows.length, 2);
});

test("finalizeReviewMd appends exactly one status:pass as the last line", () => {
  const out = finalizeReviewMd("## 评审\n\n五维评审结论：无越界、无矛盾。\n");
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(lines[lines.length - 1], "`status: pass`");
  assert.equal(statusLineCount(out), 1);
});

test("finalizeReviewMd strips a stray LLM status line before re-appending the canonical one", () => {
  const out = finalizeReviewMd("结论 ok\n\nstatus: blocked\n");
  assert.equal(statusLineCount(out), 1);
  assert.doesNotMatch(out, /status: blocked/);
});
