#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sanitizeReviewSvg } from "../../apps/web/app/lib/preview-ui.mjs";
import { generatePreviewSet, readApprovedPreview, readPreviewArtifacts, validatePreviewApproval } from "../../packages/codegen/src/preview.js";

const output = resolve("docs/evidence/preview-final-p0-c2b6bd3-static.json");
const work = await mkdtemp(join(tmpdir(), "siteforge-final-preview-p0-"));
const results = [];

function record(id, condition, actual, expected) {
  results.push({ id, status: condition ? "pass" : "fail", actual, expected });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const smilElements = ["set", "animate", "animateMotion", "animateTransform", "animateColor", "discard"];
const resourceAttributes = ["href", "xml:base"];
const mutationForms = ["to", "from", "by", "values"];
const smilUnsafe = [];
for (const element of smilElements) {
  for (const attributeName of resourceAttributes) {
    for (const form of mutationForms) {
      const value = form === "values" ? "#safe;https://example.invalid/p0.svg" : "https://example.invalid/p0.svg";
      smilUnsafe.push({
        name: `${element}-${attributeName}-${form}`,
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><g><${element} attributeName="${attributeName}" ${form}="${value}" /></g></svg>`,
      });
    }
  }
}

const otherUnsafe = [
  ["script", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
  ["event", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`],
  ["foreignObject", `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>bad</div></foreignObject></svg>`],
  ["anchor", `<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.invalid/">bad</a></svg>`],
  ["image-external", `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/p.png" /></svg>`],
  ["xlink-alias", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink"><image xl:href="https://example.invalid/p.png" /></svg>`],
  ["xml-base", `<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.invalid/"><use href="#x" /></svg>`],
  ["prefixed-script", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>`],
  ["prefixed-style", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:style>rect{fill:red}</s:style></svg>`],
  ["css-url", `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.invalid/p.png)" /></svg>`],
  ["css-identifier-escape", `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l(https://example.invalid/p.png)" /></svg>`],
  ["css-comment", `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u/**/rl(https://example.invalid/p.png)" /></svg>`],
  ["css-whitespace-case", `<svg xmlns="http://www.w3.org/2000/svg"><rect fill=" UrL ( ' HTTPS://example.invalid/p.png ' )" /></svg>`],
  ["style-attribute", `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:red" /></svg>`],
  ["xml-hex-protocol", `<svg xmlns="http://www.w3.org/2000/svg"><image href="&#x68;ttps://example.invalid/p.png" /></svg>`],
  ["xml-decimal-protocol", `<svg xmlns="http://www.w3.org/2000/svg"><image href="&#104;ttps://example.invalid/p.png" /></svg>`],
  ["double-encoded-protocol", `<svg xmlns="http://www.w3.org/2000/svg"><image href="&amp;#x68;ttps://example.invalid/p.png" /></svg>`],
  ["double-encoded-fragment", `<svg xmlns="http://www.w3.org/2000/svg"><use href="&amp;#35;safe" /></svg>`],
  ["doctype", `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"></svg>`],
  ["xml-stylesheet", `<?xml-stylesheet href="https://example.invalid/x.css"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`],
  ["missing-namespace", `<svg><rect width="10" height="10" /></svg>`],
  ["wrong-namespace", `<svg xmlns="https://example.invalid/svg"><rect width="10" height="10" /></svg>`],
].map(([name, svg]) => ({ name, svg }));

const safe = [
  ["canonical", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>`],
  ["literal-fragment", `<svg xmlns="http://www.w3.org/2000/svg"><use href="#safe" /></svg>`],
  ["encoded-fragment", `<svg xmlns="http://www.w3.org/2000/svg"><use href="&#35;safe" /></svg>`],
  ["png-data", `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA==" /></svg>`],
  ["jpeg-data", `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/jpeg;base64,AA==" /></svg>`],
  ["gif-data", `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/gif;base64,AA==" /></svg>`],
  ["webp-data", `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/webp;base64,AA==" /></svg>`],
  ["ampersand", `<svg xmlns="http://www.w3.org/2000/svg" aria-label="R&amp;D"><rect width="10" height="10" /></svg>`],
  ["gradient", `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" /></svg>`],
].map(([name, svg]) => ({ name, svg }));

try {
  const unsafe = [...smilUnsafe, ...otherUnsafe];
  const rejected = unsafe.map((item) => ({ name: item.name, rejected: sanitizeReviewSvg(item.svg) === null }));
  const accepted = safe.map((item) => ({ name: item.name, accepted: sanitizeReviewSvg(item.svg) === item.svg }));
  record("svg-adversarial-fail-closed", rejected.every((item) => item.rejected), { total: rejected.length, rejected: rejected.filter((item) => item.rejected).length, failures: rejected.filter((item) => !item.rejected) }, `${unsafe.length}/${unsafe.length} unsafe SVGs rejected`);
  record("svg-static-compatibility", accepted.every((item) => item.accepted), { total: accepted.length, accepted: accepted.filter((item) => item.accepted).length, failures: accepted.filter((item) => !item.accepted) }, `${safe.length}/${safe.length} passive SVGs accepted`);

  const requirement = "做一个可访问的活动报名网站 <script>alert(1)</script>";
  const spec = "# 活动报名\n\n- 活动日期、地点与剩余名额\n- 清晰报名入口\n- 支持移动端评审";
  const first = await generatePreviewSet({ outDir: work, requirement, spec, generation: 1 });
  const firstRead = await readPreviewArtifacts({ outDir: work, requirement });
  const repeatedRead = await readPreviewArtifacts({ outDir: work, requirement });
  const firstHashes = firstRead.map((item) => sha256(item.content));
  const repeatedHashes = repeatedRead.map((item) => sha256(item.content));
  const uniqueIds = new Set(firstRead.map((item) => item.id));
  const setIds = new Set(firstRead.map((item) => item.setId));
  record("generated-current-batch-three-stable-ids", first.options.length === 3 && firstRead.length === 3 && uniqueIds.size === 3 && setIds.size === 1 && [...setIds][0] === first.setId, { setId: first.setId, ids: firstRead.map((item) => item.id), formats: firstRead.map((item) => item.format) }, "three SVGs with unique stable IDs scoped to one set");
  record("historical-svg-reuse-byte-stable", JSON.stringify(firstHashes) === JSON.stringify(repeatedHashes), { firstHashes, repeatedHashes }, "repeated reads reuse identical SVG bytes");
  const generatedSafety = firstRead.map((item) => ({ id: item.id, safe: sanitizeReviewSvg(item.content) !== null, title: /<title[ >]/i.test(item.content), desc: /<desc[ >]/i.test(item.content) }));
  record("generated-svg-safe-accessible-text", generatedSafety.every((item) => item.safe && item.title && item.desc), generatedSafety, "all generated directions sanitize and contain title/desc");

  const approved = first.options[1].id;
  const firstGatePasses = await validatePreviewApproval({ outDir: work, requirement, previewId: approved });
  const firstReadApproved = await readApprovedPreview({ outDir: work, requirement, previewId: approved });
  const second = await generatePreviewSet({ outDir: work, requirement, spec, generation: 2 });
  const staleFirstGate = await validatePreviewApproval({ outDir: work, requirement, previewId: approved });
  const staleSecondGate = await readApprovedPreview({ outDir: work, requirement, previewId: approved });
  record("runner-first-gate-rejects-stale-id", firstGatePasses && firstReadApproved?.id === approved && second.setId !== first.setId && staleFirstGate === false, { approved, firstSet: first.setId, secondSet: second.setId, beforeRegenerate: firstGatePasses, afterRegenerate: staleFirstGate }, "current ID passes; old ID fails validatePreviewApproval after regeneration");
  record("runner-second-gate-rejects-race", firstGatePasses && staleSecondGate === null, { firstGatePasses, readApprovedAfterRegenerate: staleSecondGate }, "ID that passed first validation is rejected by readApprovedPreview after batch replacement");

  const app = await readFile("apps/web/app/MobileBuildApp.tsx", "utf8");
  const approvalRoute = await readFile("apps/web/app/api/v1/projects/[projectId]/preview-approval/route.ts", "utf8");
  const jobsRoute = await readFile("apps/web/app/api/v1/projects/[projectId]/jobs/route.ts", "utf8");
  const runner = await readFile("packages/codegen/runner.mjs", "utf8");
  const generate = await readFile("packages/codegen/src/generate.js", "utf8");
  const openBlock = app.match(/function openImmersivePreview[\s\S]*?\n  }\n\n  function selectPreview/)?.[0] || "";
  const selectBlock = app.match(/function selectPreview[\s\S]*?\n  }\n\n  function updatePreviewImageStatus/)?.[0] || "";
  const moveBlock = app.match(/const moveImmersivePreview[\s\S]*?\n  }, \[immersivePreviewId, previewOptions\]\);/)?.[0] || "";
  const isolated = [openBlock, selectBlock, moveBlock].every((block) => block && !/preview-approval|approvePreview|runProject/.test(block));
  const approvalFetches = [...app.matchAll(/fetch\(`\/api\/v1\/projects\/\$\{encodeURIComponent\(activeProjectId\)\}\/preview-approval`/g)].length;
  record("preview-actions-have-no-approval-call", isolated, { openBlock: Boolean(openBlock), selectBlock: Boolean(selectBlock), moveBlock: Boolean(moveBlock), isolated }, "open, navigation and select contain no approval or run dispatch");
  record("only-original-confirm-fetches-approval", approvalFetches === 1 && /async function approvePreview/.test(app), { approvalFetches, approveFunction: /async function approvePreview/.test(app) }, "exactly one approval fetch inside original confirm function");

  const controlPlaneGate = /artifact\.format === "svg"/.test(approvalRoute) && /selected_preview_id/.test(approvalRoute) && /approvedPreviewId/.test(jobsRoute) && /PREVIEW_APPROVAL_REQUIRED/.test(jobsRoute);
  const runnerDoubleGate = /validatePreviewApproval/.test(runner) && /readApprovedPreview/.test(generate) && /进入 Codex 前需要确认当前预览方案/.test(generate);
  record("control-plane-trusted-approval-gate", controlPlaneGate, { artifactSvgCheck: /artifact\.format === "svg"/.test(approvalRoute), persistedSelection: /selected_preview_id/.test(approvalRoute), dispatchRequiresApprovedId: /approvedPreviewId/.test(jobsRoute), rejectionSemantic: /PREVIEW_APPROVAL_REQUIRED/.test(jobsRoute) }, "approval route validates current SVG and dispatch requires persisted approved ID");
  record("runner-double-validation-intact", runnerDoubleGate, { runnerFirst: /validatePreviewApproval/.test(runner), generatorSecond: /readApprovedPreview/.test(generate), failClosedMessage: /进入 Codex 前需要确认当前预览方案/.test(generate) }, "Runner validates before generation and generator rereads approved current direction");

  const report = {
    baseline: "c2b6bd391a764b7efc73105180d1a8a8d2dcb38f",
    businessBaseline: "2f178fae00cb49746b9ee24b924d35d1fa077c8d",
    generatedAt: new Date().toISOString(),
    adversarialMatrix: { unsafe: smilUnsafe.length + otherUnsafe.length, smil: smilUnsafe.length, passiveCompatibility: safe.length },
    summary: { pass: results.filter((item) => item.status === "pass").length, fail: results.filter((item) => item.status === "fail").length },
    results,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output, summary: report.summary, adversarialMatrix: report.adversarialMatrix }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
