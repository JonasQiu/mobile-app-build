// Orchestrates the full pipeline:
//   phase 1 (optional): requirement -> mobile-spec workflow (propose->design->
//     task) authors a requirement-specific spec, validated through real gates.
//   phase 2: scaffold -> (LLM [anchored on the authored spec] -> write -> build)
//     up to MAX_ATTEMPTS times, feeding the previous build error back to the model.
// Phase 1 is a quality enhancer, not a hard prerequisite: on any failure it
// degrades to the static fitness anchor and reports specWorkflowOk:false.
// CODEGEN_NO_SPEC=1 (or skipWorkflow) short-circuits phase 1 entirely.
// Returns a result object the runner/CLI can hand to the caller.
import { copyTemplate } from "./template.js";
import { writeManifest } from "./write.js";
import { runBuild } from "./build.js";
import { callLLM } from "./llm.js";
import { runSpecWorkflow } from "./spec-workflow.js";

export const MAX_ATTEMPTS = 3;

export async function generate({
  requirement,
  outDir,
  openaiApiKey,
  model,
  onProgress,
  specWorkRoot,
  skipWorkflow = false,
}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};

  // --- phase 1: author a requirement-specific spec through mobile-spec ---
  let specAnchor = "";
  let proposalAnchor = "";
  let designAnchor = "";
  let specWorkflowOk = false;
  let degradedReason = "";
  const wantSpec = !skipWorkflow && !process.env.CODEGEN_NO_SPEC && openaiApiKey && specWorkRoot;
  if (wantSpec) {
    progress({ stage: "spec-workflow" });
    try {
      const sw = await runSpecWorkflow({
        requirement,
        workRoot: specWorkRoot,
        apiKey: openaiApiKey,
        model,
        onProgress: progress,
      });
      if (sw.ok) {
        specWorkflowOk = true;
        specAnchor = sw.specMd;
        proposalAnchor = sw.proposalMd;
        designAnchor = sw.designMd;
      } else {
        degradedReason = sw.reason || "spec workflow did not complete";
      }
    } catch (e) {
      degradedReason = `spec workflow threw: ${e?.message || String(e)}`;
    }
    if (!specWorkflowOk) {
      progress({ stage: "spec-degraded", reason: degradedReason });
    }
  }

  // --- phase 2: scaffold + code-gen ---
  copyTemplate(outDir);

  let attempt = 0;
  let prevBuildError = "";
  let manifest = null;
  let lastBuild = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    progress({ stage: "llm", attempt });
    manifest = await callLLM({
      requirement,
      attempt,
      prevBuildError,
      apiKey: openaiApiKey,
      model,
      specAnchor,
      proposalAnchor,
      designAnchor,
    });

    progress({ stage: "write", attempt });
    await writeManifest(outDir, manifest);

    progress({ stage: "build", attempt });
    lastBuild = await runBuild(outDir);
    if (lastBuild.ok) {
      progress({ stage: "done", attempt });
      return {
        ok: true,
        outDir,
        buildOk: true,
        attempts: attempt,
        buildLog: lastBuild.log,
        manifest,
        specWorkflowOk,
        degradedReason,
      };
    }
    prevBuildError = lastBuild.log;
    progress({ stage: "retry", attempt, buildOk: false });
  }

  return {
    ok: false,
    outDir,
    buildOk: false,
    attempts: attempt,
    buildLog: lastBuild?.log ?? "",
    manifest,
    specWorkflowOk,
    degradedReason,
  };
}
