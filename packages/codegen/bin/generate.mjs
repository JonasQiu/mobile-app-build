#!/usr/bin/env node
// CLI entry: generate a project from a one-sentence requirement.
//
//   node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen
//   node bin/generate.mjs "做一个咖啡店官网" --out /tmp/gen --model gpt-4o --serve
//
// By default runs the FULL pipeline: phase 1 authors a requirement-specific
// spec through the mobile-spec workflow (propose->design->task), then phase 2
// generates code anchored on it. The authored spec lands in <out>.spec/.
// Requires OPENAI_API_KEY in the environment. Exits non-zero if the build
// never goes green within MAX_ATTEMPTS.
import { generate, MAX_ATTEMPTS } from "../src/generate.js";
import { startPreview } from "../src/serve.js";

function parseArgs(argv) {
  const out = { requirement: "", out: "", model: "", serve: false, port: 0 };
  // Accept both `--flag=value` and `--flag value` forms.
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--out=")) out.out = token.slice("--out=".length);
    else if (token === "--out") out.out = argv[++i];
    else if (token.startsWith("--model=")) out.model = token.slice("--model=".length);
    else if (token === "--model") out.model = argv[++i];
    else if (token.startsWith("--port=")) out.port = Number(token.slice("--port=".length));
    else if (token === "--port") out.port = Number(argv[++i]);
    else if (token === "--serve") out.serve = true;
    else if (!out.requirement) out.requirement = token;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.requirement || !args.out) {
    console.error('Usage: node bin/generate.mjs "<需求>" --out <dir> [--model X] [--serve] [--port N]');
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
