// Executes the checkpointable part of the delivery pipeline. The runner selects
// the first stage that still needs work and may stop after one explicitly chosen
// stage. Successful stages write durable evidence before returning.
import { copyTemplate } from "./template.js";
import { writeManifest } from "./write.js";
import { runBuild } from "./build.js";
import { callLLM } from "./llm.js";
import { runSpecWorkflow } from "./spec-workflow.js";
import {
  clearRepairState,
  loadSpecCheckpoint,
  readBuildLog,
  readRepairState,
  writeBuildLog,
  writeOutputCheckpoint,
  writeRepairState,
  writeSpecCheckpoint,
} from "./checkpoints.js";

export const MAX_ATTEMPTS = 3;

const GENERATION_STAGES = ["mobile-spec", "implementation", "build"];

function isInfrastructureBuildFailure(result) {
  if (result?.infrastructureError) return true;
  return /spawn\s+(?:npm|npm\.cmd)\s+ENOENT|\/usr\/bin\/env:\s*node:\s*(?:No such file|not found)/i.test(String(result?.log || result || ""));
}

function stageIndex(stage) {
  return GENERATION_STAGES.indexOf(stage);
}

export async function generate({
  requirement,
  outDir,
  openaiApiKey,
  model,
  onProgress,
  specWorkRoot,
  signal,
  startStage = "mobile-spec",
  stopAfterStage = "build",
  resume = true,
}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const startIndex = stageIndex(startStage);
  const stopIndex = stageIndex(stopAfterStage);
  if (startIndex < 0 || stopIndex < startIndex) throw new Error(`invalid generation stage range: ${startStage} -> ${stopAfterStage}`);
  if (!specWorkRoot) throw new Error("Mobile Spec workflow is required for every generation");

  let sw;
  if (startStage === "mobile-spec") {
    progress({ stage: "spec-workflow" });
    sw = await runSpecWorkflow({
      requirement,
      workRoot: specWorkRoot,
      apiKey: openaiApiKey,
      model,
      onProgress: progress,
      signal,
      resume,
    });
    if (!sw.ok) throw new Error(`Mobile Spec workflow failed: ${sw.reason || "workflow did not complete"}`);
    await writeSpecCheckpoint({ specWorkRoot, requirement, workflowResult: sw });
  } else {
    sw = await loadSpecCheckpoint({ specWorkRoot, requirement });
    if (!sw) throw new Error("a successful Mobile Spec checkpoint is required before this stage");
  }

  if (stopAfterStage === "mobile-spec") {
    return { ok: true, outDir, buildOk: false, attempts: 0, manifest: null, specWorkflowOk: true, completedStage: "mobile-spec" };
  }

  if (startStage === "build") {
    const savedRepair = resume ? await readRepairState({ outDir, requirement, stage: "build" }) : null;
    const savedBuildLog = resume ? await readBuildLog(outDir) : "";
    let repairError = savedRepair?.error || "";
    let attemptOffset = savedRepair?.attempts || 0;
    let lastBuild = null;
    let manifest = null;

    if (!savedRepair) {
      progress({ stage: "build", phase: "start", attempt: 1 });
      lastBuild = await runBuild(outDir, { signal });
      await writeBuildLog(outDir, lastBuild.log);
      if (lastBuild.ok) {
        await writeOutputCheckpoint({ outDir, requirement, stage: "build" });
        await clearRepairState(outDir);
        progress({ stage: "done", phase: "complete", attempt: 1 });
        return {
          ok: true,
          outDir,
          buildOk: true,
          attempts: 1,
          buildLog: lastBuild.log,
          manifest: null,
          specWorkflowOk: true,
          completedStage: "build",
        };
      }
      repairError = lastBuild.log;
      attemptOffset = 1;
      await writeRepairState({ outDir, requirement, stage: "build", error: repairError, attempts: attemptOffset });
      if (isInfrastructureBuildFailure(lastBuild)) {
        return {
          ok: false,
          infrastructureError: true,
          outDir,
          buildOk: false,
          attempts: attemptOffset,
          buildLog: repairError,
          manifest: null,
          specWorkflowOk: true,
          completedStage: "build",
        };
      }
      progress({ stage: "retry", phase: "start", attempt: attemptOffset, buildOk: false });
    } else {
      if (isInfrastructureBuildFailure(repairError) || isInfrastructureBuildFailure(savedBuildLog)) {
        const retryAttempt = attemptOffset + 1;
        progress({ stage: "build", phase: "infrastructure-retry", attempt: retryAttempt });
        lastBuild = await runBuild(outDir, { signal });
        await writeBuildLog(outDir, lastBuild.log);
        if (lastBuild.ok) {
          await writeOutputCheckpoint({ outDir, requirement, stage: "build" });
          await clearRepairState(outDir);
          progress({ stage: "done", phase: "complete", attempt: retryAttempt });
          return {
            ok: true,
            outDir,
            buildOk: true,
            attempts: retryAttempt,
            buildLog: lastBuild.log,
            manifest: null,
            specWorkflowOk: true,
            completedStage: "build",
          };
        }
        repairError = lastBuild.log;
        attemptOffset = retryAttempt;
        await writeRepairState({ outDir, requirement, stage: "build", error: repairError, attempts: attemptOffset });
        if (isInfrastructureBuildFailure(lastBuild)) {
          return {
            ok: false,
            infrastructureError: true,
            outDir,
            buildOk: false,
            attempts: attemptOffset,
            buildLog: repairError,
            manifest: null,
            specWorkflowOk: true,
            completedStage: "build",
          };
        }
      }
      progress({ stage: "retry", phase: "resume", attempt: attemptOffset, buildOk: false });
    }

    copyTemplate(outDir);
    let localAttempt = 0;
    while (localAttempt < MAX_ATTEMPTS) {
      localAttempt += 1;
      const attempt = attemptOffset + localAttempt;
      progress({ stage: "llm", phase: "start", attempt });
      try {
        manifest = await callLLM({
          requirement,
          attempt,
          prevBuildError: repairError,
          apiKey: openaiApiKey,
          model,
          specAnchor: sw.specMd,
          proposalAnchor: sw.proposalMd,
          designAnchor: sw.designMd,
          tasksAnchor: sw.tasksMd,
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        repairError = `SiteManifest validation failed while repairing build: ${reason}`;
        await writeRepairState({ outDir, requirement, stage: "build", error: repairError, attempts: attempt });
        progress({ stage: "retry", phase: "manifest", attempt, reason, buildOk: false });
        continue;
      }
      progress({
        stage: "llm",
        phase: "complete",
        attempt,
        fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
        routeCount: Array.isArray(manifest.navRoutes) ? manifest.navRoutes.length : 0,
      });
      try {
        progress({ stage: "write", phase: "start", attempt });
        await writeManifest(outDir, manifest);
      } catch (error) {
        if (signal?.aborted) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        repairError = `Writing repaired SiteManifest failed: ${reason}`;
        await writeRepairState({ outDir, requirement, stage: "build", error: repairError, attempts: attempt });
        progress({ stage: "retry", phase: "manifest", attempt, reason, buildOk: false });
        continue;
      }
      signal?.throwIfAborted();
      await writeOutputCheckpoint({ outDir, requirement, stage: "implementation" });
      progress({ stage: "write", phase: "complete", attempt, fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0 });

      progress({ stage: "build", phase: "start", attempt });
      lastBuild = await runBuild(outDir, { signal });
      await writeBuildLog(outDir, lastBuild.log);
      if (lastBuild.ok) {
        await writeOutputCheckpoint({ outDir, requirement, stage: "build" });
        await clearRepairState(outDir);
        progress({ stage: "done", phase: "complete", attempt });
        return {
          ok: true,
          outDir,
          buildOk: true,
          attempts: attempt,
          buildLog: lastBuild.log,
          manifest,
          specWorkflowOk: true,
          completedStage: "build",
        };
      }
      repairError = lastBuild.log;
      await writeRepairState({ outDir, requirement, stage: "build", error: repairError, attempts: attempt });
      progress({ stage: "retry", phase: "start", attempt, buildOk: false });
    }

    return {
      ok: false,
      outDir,
      buildOk: false,
      attempts: attemptOffset + localAttempt,
      buildLog: lastBuild?.log || repairError,
      manifest,
      specWorkflowOk: true,
      completedStage: "implementation",
    };
  }

  copyTemplate(outDir);
  const savedRepair = resume ? await readRepairState({ outDir, requirement, stage: "implementation" }) : null;
  let localAttempt = 0;
  let attempt = savedRepair?.attempts || 0;
  let prevBuildError = savedRepair?.error || "";
  let repairStage = "implementation";
  let manifest = null;
  let lastBuild = null;

  while (localAttempt < MAX_ATTEMPTS) {
    localAttempt += 1;
    attempt = (savedRepair?.attempts || 0) + localAttempt;
    progress({ stage: "llm", phase: "start", attempt });
    try {
      manifest = await callLLM({
        requirement,
        attempt,
        prevBuildError,
        apiKey: openaiApiKey,
        model,
        specAnchor: sw.specMd,
        proposalAnchor: sw.proposalMd,
        designAnchor: sw.designMd,
        tasksAnchor: sw.tasksMd,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      prevBuildError = `SiteManifest validation failed: ${reason}`;
      await writeRepairState({ outDir, requirement, stage: repairStage, error: prevBuildError, attempts: attempt });
      progress({ stage: "retry", phase: "manifest", attempt, reason, buildOk: false });
      continue;
    }
    progress({
      stage: "llm",
      phase: "complete",
      attempt,
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
      routeCount: Array.isArray(manifest.navRoutes) ? manifest.navRoutes.length : 0,
    });

    progress({ stage: "write", phase: "start", attempt });
    try {
      await writeManifest(outDir, manifest);
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      prevBuildError = `Writing SiteManifest failed: ${reason}`;
      await writeRepairState({ outDir, requirement, stage: repairStage, error: prevBuildError, attempts: attempt });
      progress({ stage: "retry", phase: "manifest", attempt, reason, buildOk: false });
      continue;
    }
    signal?.throwIfAborted();
    await writeOutputCheckpoint({ outDir, requirement, stage: "implementation" });
    progress({ stage: "write", phase: "complete", attempt, fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0 });

    if (stopAfterStage === "implementation") {
      await clearRepairState(outDir);
      return {
        ok: true,
        outDir,
        buildOk: false,
        attempts: attempt,
        buildLog: "",
        manifest,
        specWorkflowOk: true,
        completedStage: "implementation",
      };
    }

    progress({ stage: "build", phase: "start", attempt });
    lastBuild = await runBuild(outDir, { signal });
    await writeBuildLog(outDir, lastBuild.log);
    if (lastBuild.ok) {
      await writeOutputCheckpoint({ outDir, requirement, stage: "build" });
      await clearRepairState(outDir);
      progress({ stage: "done", phase: "complete", attempt });
      return {
        ok: true,
        outDir,
        buildOk: true,
        attempts: attempt,
        buildLog: lastBuild.log,
        manifest,
        specWorkflowOk: true,
        completedStage: "build",
      };
    }
    prevBuildError = lastBuild.log;
    repairStage = "build";
    await writeRepairState({ outDir, requirement, stage: "build", error: prevBuildError, attempts: attempt });
    if (isInfrastructureBuildFailure(lastBuild)) {
      return {
        ok: false,
        infrastructureError: true,
        outDir,
        buildOk: false,
        attempts: attempt,
        buildLog: prevBuildError,
        manifest,
        specWorkflowOk: true,
        completedStage: "build",
      };
    }
    progress({ stage: "retry", phase: "start", attempt, buildOk: false });
  }

  return {
    ok: false,
    outDir,
    buildOk: false,
    attempts: attempt,
    buildLog: lastBuild?.log || prevBuildError,
    manifest,
    specWorkflowOk: true,
    completedStage: "implementation",
  };
}
