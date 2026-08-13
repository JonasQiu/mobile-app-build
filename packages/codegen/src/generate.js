// Orchestrates the full pipeline:
//   phase 1 (required): requirement -> mobile-spec workflow (propose->design->
//     task) authors a requirement-specific spec, validated through real gates.
//   phase 2: scaffold -> (Codex/OpenAI [anchored on the authored spec] -> write -> build)
//     up to MAX_ATTEMPTS times, feeding the previous build error back to the model.
// Phase 1 is a hard delivery gate. If Mobile Spec fails, no code is generated
// and no URL can be returned.
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
}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};

  // --- phase 1: author a requirement-specific spec through mobile-spec ---
  let specAnchor = "";
  let proposalAnchor = "";
  let designAnchor = "";
  let tasksAnchor = "";
  let specWorkflowOk = false;
  if (!specWorkRoot) {
    throw new Error("Mobile Spec workflow is required for every generation");
  }
  progress({ stage: "spec-workflow" });
  const sw = await runSpecWorkflow({
    requirement,
    workRoot: specWorkRoot,
    apiKey: openaiApiKey,
    model,
    onProgress: progress,
  });
  if (!sw.ok) throw new Error(`Mobile Spec workflow failed: ${sw.reason || "workflow did not complete"}`);
  specWorkflowOk = true;
  specAnchor = sw.specMd;
  proposalAnchor = sw.proposalMd;
  designAnchor = sw.designMd;
  tasksAnchor = sw.tasksMd;

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
      tasksAnchor,
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
  };
}
