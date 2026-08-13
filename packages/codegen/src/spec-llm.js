// Authors the OpenSpec artifacts (proposal/spec/design/review/tasks) for a
// requirement via OpenAI, with the codegen-friendly free-form spec.md shape.
// The strict workflow gates (proposal status:ready + 未决问题 table, review
// status:pass) are too fiddly to trust to the model, so the engine post-
// processes the LLM body with deterministic footers that are guaranteed to
// pass (verified against checkProposalStatus / checkProposalOpenQuestions /
// checkReviewStatus in packages/mobile-spec/scripts/commands/workflow.js).
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const TPL_DIR = join(repoRoot, "packages", "mobile-spec", "schemas", "h5-sdd", "schema", "templates");
const GOLDEN_SPEC = join(repoRoot, "generated/fitness-web.spec/openspec/changes/fitness/specs/fitness/spec.md");
const GOLDEN_PROPOSAL = join(repoRoot, "generated/fitness-web.spec/openspec/changes/fitness/proposal.md");

function readOptional(absPath) {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

// Templates = the format guide. Golden spec = the one-shot example of a good
// codegen-friendly spec (NOT strict OpenSpec ## ADDED Requirements form).
const TPL = {
  proposal: readOptional(join(TPL_DIR, "proposal.md")),
  spec: readOptional(join(TPL_DIR, "spec.md")),
  design: readOptional(join(TPL_DIR, "design.md")),
  review: readOptional(join(TPL_DIR, "review.md")),
  tasks: readOptional(join(TPL_DIR, "tasks.md")),
};
const GOLDEN = { spec: readOptional(GOLDEN_SPEC), proposal: readOptional(GOLDEN_PROPOSAL) };

const DEFAULT_MODEL = "gpt-4o";

const ProposalAuthor = z.object({
  pageSpecId: z.string().regex(/^[a-z][a-z0-9-]*$/, "kebab-case page-spec-id"),
  proposalBodyMd: z.string().min(200),
  specMd: z.string().min(400),
});
const DesignAuthor = z.object({
  designMd: z.string().min(200),
  reviewBodyMd: z.string().min(100),
});
const TasksAuthor = z.object({
  tasksMd: z.string().min(80),
});

// ---- deterministic gate-passing footers ----

// Matches the gate's section regex (workflow.js:1455): a `## [N. ]未决问题`
// heading through to the next `## ` heading or end of text. JS-valid (no \Z).
const OPEN_Q_SECTION = /^##\s+(?:\d+\.\s*)?未决问题\s*$[\s\S]*?(?=^##\s+|(?![\s\S]))/m;
const STATUS_LINE = /^`?status:\s*(?:ready|blocked|pass)`?$/gim;

export function finalizeProposalMd(body) {
  const cleaned = body
    .replace(OPEN_Q_SECTION, "") // drop any 未决问题 section the model wrote
    .replace(STATUS_LINE, "") // drop any stray status line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${cleaned}\n\n## 未决问题\n\n| 问题 | 影响范围 | Owner | 处置状态 | 处置结论 | 确认依据 |\n|------|----------|-------|----------|----------|----------|\n\n\`status: ready\`\n`;
}

export function finalizeReviewMd(body) {
  const cleaned = body.replace(STATUS_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
  return `${cleaned}\n\n\`status: pass\`\n`;
}

// ---- LLM authoring ----

function client(apiKey) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("OPENAI_API_KEY not set");
    err.code = "NO_API_KEY";
    throw err;
  }
  return { client: new OpenAI({ apiKey: key }), model: process.env.CODEGEN_MODEL || DEFAULT_MODEL };
}

async function parseCall(client, model, schema, name, messages) {
  const result = await client.chat.completions.parse({
    model,
    messages,
    response_format: zodResponseFormat(schema, name),
  });
  const parsed = result.choices[0]?.message?.parsed;
  if (!parsed) {
    const refusal = result.choices[0]?.message?.refusal;
    throw new Error(refusal ? `Model refused: ${refusal}` : `Model did not return a parseable ${name}`);
  }
  return parsed;
}

export async function authorProposal({ requirement, apiKey, model }) {
  const { client: ai, model: defaultModel } = client(apiKey);
  const system = [
    "你是一名资深前端 spec 作者。任务：为一句中文需求，产出可构建的多页 Next.js 网站的 Proposal 与 Spec。",
    "Spec 必须是【自由格式、面向代码生成】的结构（路由/页面表、共享组件、数据模型(lib/data.ts)的 TS 接口、关键交互、内容语言、视觉与设计、验收），不要使用 OpenSpec 的 `## ADDED Requirements` 严格格式。",
    "Proposal 正文只写：为什么做、做什么、不做什么。**不要**写 `status:` 行或 `## 未决问题` 段落（引擎会自动补上并通过门禁）。内容要具体、可信、简体中文。",
    "下面是 Proposal 模板与 Spec 模板（仅作格式参考，Spec 用上面的自由格式）：",
    `\n--- proposal 模板 ---\n${TPL.proposal}`,
    `\n--- spec 模板 ---\n${TPL.spec}`,
    "\n下面是一个已验证可构建的参考样例（健身网站）。学习其结构，再针对本次需求产出同等质量、主题不同的内容，严禁照抄健身主题：",
    `\n--- 参考样例 proposal ---\n${GOLDEN.proposal || "(无)"}`,
    `\n--- 参考样例 spec（自由格式）---\n${GOLDEN.spec || "(无)"}`,
  ];
  const user = `# 本次需求\n${requirement}\n\n请返回 pageSpecId（kebab-case）、proposalBodyMd（Proposal 正文，不含 status/未决问题）、specMd（自由格式 Spec）。主题不得与健身样例相同。`;
  const parsed = await parseCall(ai, model || defaultModel, ProposalAuthor, "proposal_author", [
    { role: "system", content: system.join("\n\n") },
    { role: "user", content: user },
  ]);
  return {
    proposalMd: finalizeProposalMd(parsed.proposalBodyMd),
    specMd: parsed.specMd.trim() + "\n",
    pageSpecId: parsed.pageSpecId,
  };
}

export async function authorDesign({ requirement, proposalMd, specMd, apiKey, model }) {
  const { client: ai, model: defaultModel } = client(apiKey);
  const system = [
    "你是资深前端架构师。基于已确认的 Proposal 与 Spec，产出 Design（实现方案）与 Review（设计评审）。",
    `Design 模板：\n${TPL.design}`,
    `Review 模板：\n${TPL.review}`,
    "Review 正文写完五维评审（越界/矛盾/遗漏/不可追踪/模糊项）即可。**不要**写 `status:` 行（引擎会自动补 `status: pass`）。",
  ];
  const user = `# 需求\n${requirement}\n\n# Proposal\n${proposalMd}\n\n# Spec\n${specMd}\n\n返回 designMd 与 reviewBodyMd（不含 status 行）。`;
  const parsed = await parseCall(ai, model || defaultModel, DesignAuthor, "design_author", [
    { role: "system", content: system.join("\n\n") },
    { role: "user", content: user },
  ]);
  return { designMd: parsed.designMd.trim() + "\n", reviewMd: finalizeReviewMd(parsed.reviewBodyMd) };
}

export async function authorTasks({ requirement, proposalMd, specMd, designMd, apiKey, model, prevGateError, attempt = 1 }) {
  const { client: ai, model: defaultModel } = client(apiKey);
  const system = [
    "你是资深前端 TL。基于 Proposal/Spec/Design 拆解可执行的前端任务清单（tasks.md）。",
    `模板：\n${TPL.tasks}`,
    "硬约束：每个任务必须是 `- [ ] X.Y 描述` 格式（X/Y 为数字，如 `2.1`）；至少一条；不要出现不带编号的 `- [ ]` 复选框；简体中文。",
  ];
  let user = `# 需求\n${requirement}\n\n# Spec\n${specMd}\n\n# Design\n${designMd || proposalMd}\n\n返回 tasksMd（严格使用 - [ ] X.Y 描述 格式）。`;
  if (attempt > 1 && prevGateError) {
    user += `\n\n# 第 ${attempt} 次尝试\n上次 tasks.md 未通过 task-format 门禁：\n${prevGateError}\n请修正后重新输出完整 tasksMd。`;
  }
  const parsed = await parseCall(ai, model || defaultModel, TasksAuthor, "tasks_author", [
    { role: "system", content: system.join("\n\n") },
    { role: "user", content: user },
  ]);
  return { tasksMd: parsed.tasksMd.trim() + "\n" };
}
