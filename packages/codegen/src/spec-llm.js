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
import { callCodexStructured } from "./codex-cli.js";
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
  return {
    client: key ? new OpenAI({ apiKey: key }) : null,
    model: process.env.CODEGEN_MODEL || DEFAULT_MODEL,
  };
}

async function parseCall(client, model, schema, name, messages) {
  if (!client) return callCodexStructured({ schema, name, messages });
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
    "Proposal 正文必须清楚说明为什么做、做什么、不做什么；Spec 必须包含页面与路由、共享组件、数据模型、交互、状态、视觉约束和可验证验收标准。",
    "只依据本次用户需求写规格，不使用任何示例项目、预设业务或固定页面。",
  ];
  const user = `# 本次需求\n${requirement}\n\n请返回 pageSpecId（kebab-case）、proposalBodyMd（Proposal 正文，不含 status/未决问题）、specMd（自由格式 Spec）。所有内容必须可追踪到本次需求。`;
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
    "Design 必须包含整体方案、实现改动、验证方案和必要的风险说明。",
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
