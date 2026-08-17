#!/usr/bin/env node
// CLI entry: generate a project from a one-sentence requirement.
//
//   node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen
//   node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen --model gpt-4o --serve
//
// The first run authors a requirement-specific Mobile Spec and three preview
// images, then stops. Re-run with --approve-preview <id> to enter Codex and
// build using the selected direction. The authored spec lands in <out>.spec/.
// Requires OPENAI_API_KEY in the environment. Exits non-zero if the build
// never goes green within MAX_ATTEMPTS.
import { generate, MAX_ATTEMPTS } from "../src/generate.js";
import { startPreview } from "../src/serve.js";

function parseArgs(argv) {
  const out = { requirement: "", out: "", model: "", serve: false, port: 0, approvedPreviewId: "" };
  // Accept both `--flag=value` and `--flag value` forms.
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--out=")) out.out = token.slice("--out=".length);
    else if (token === "--out") out.out = argv[++i];
    else if (token.startsWith("--model=")) out.model = token.slice("--model=".length);
    else if (token === "--model") out.model = argv[++i];
    else if (token.startsWith("--port=")) out.port = Number(token.slice("--port=".length));
    else if (token === "--port") out.port = Number(argv[++i]);
    else if (token.startsWith("--approve-preview=")) out.approvedPreviewId = token.slice("--approve-preview=".length);
    else if (token === "--approve-preview") out.approvedPreviewId = argv[++i];
    else if (token === "--serve") out.serve = true;
    else if (!out.requirement) out.requirement = token;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.requirement || !args.out) {
    console.error('Usage: node bin/generate.mjs "<需求>" --out <dir> [--approve-preview ID] [--model X] [--serve] [--port N]');
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is not set.");
    process.exit(2);
  }

  const result = await generate({
    requirement: args.requirement,
    outDir: args.out,
    specWorkRoot: `${args.out}.spec`,
    openaiApiKey: process.env.OPENAI_API_KEY,
    model: args.model || undefined,
    startStage: args.approvedPreviewId ? "implementation" : "mobile-spec",
    stopAfterStage: args.approvedPreviewId ? "build" : "preview",
    approvedPreviewId: args.approvedPreviewId,
    onProgress: ({ stage, attempt, ok, reason }) => {
      const tail = attempt ? ` attempt ${attempt}/${MAX_ATTEMPTS}` : "";
      const verdict = ok === false && reason ? ` FAILED: ${reason}` : "";
      console.error(`[${stage}]${tail}${verdict}`);
    },
  });

  if (!result.ok) {
    console.error(`\nBuild failed after ${result.attempts} attempt(s). Last log:`);
    console.error(result.buildLog);
    console.log(
      JSON.stringify({
        ok: false,
        outDir: result.outDir,
        attempts: result.attempts,
        specWorkflowOk: result.specWorkflowOk,
      }),
    );
    process.exit(1);
  }

  if (result.completedStage === "preview") {
    console.log(JSON.stringify({ ok: true, outDir: result.outDir, approvalRequired: true, previewArtifacts: `${args.out}/.mobile-build-previews/manifest.json` }, null, 2));
    return;
  }

  let previewUrl = null;
  if (args.serve) {
    const preview = await startPreview(result.outDir, { port: args.port || undefined });
    previewUrl = preview.previewUrl;
    console.error(`Preview: ${previewUrl} (Ctrl+C to stop)`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: result.outDir,
        attempts: result.attempts,
        previewUrl,
        specWorkflowOk: result.specWorkflowOk,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
