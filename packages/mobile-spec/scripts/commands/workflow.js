'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const { getUserSchemasDir } = require('../schema/register');
const {
  getWorkflowHome,
  getProjectWorkflowDir,
  getCurrentFile,
  getChangeSidecarDir,
  migrateLegacyWorkflowState,
} = require('../workflow/storage');

const STAGE_ALIASES = {
  proposal: 'propose',
  propose: 'propose',
  requirements: 'propose',
  design: 'design',
  task: 'task',
  tasks: 'task',
  build: 'coding',
  coding: 'coding',
  verify: 'verify',
  verification: 'verify',
  archive: 'archive',
};

const STALE_STAGE_BY_ARTIFACT = {
  proposal: 'propose',
  specs: 'propose',
  design: 'design',
  review: 'design',
  tasks: 'task',
  code: 'coding',
  archive: 'archive',
};
const CHANGE_ARTIFACTS = new Set(Object.keys(STALE_STAGE_BY_ARTIFACT));

const MONITOR_ARTIFACT_BY_NODE = {
  proposal: 'proposal',
  specs: 'specs',
  design: 'design',
  review: 'review',
  task: 'tasks',
  apply: 'tasks',
  verify: 'verify',
};

const POST_NODE_BY_ARTIFACT = {
  tasks: 'task',
};

const PRE_HOOK_BY_ACTION = {
  apply: 'preApply',
  archive: 'preArchive',
};

const NON_REPLAYABLE_ACTIONS = new Set(['verify', 'archive']);
const VERIFY_PROFILE_VERSION = 2;
const VERIFY_INVOCATION_VERSION = 1;
const VERIFY_MAX_REPAIR_ATTEMPTS = 2;
const VERIFY_CAPABILITY_IDS = ['ai-cr', 'spec-scenarios', 'automated-checks'];
const VERIFY_FULL_VERIFICATION_TRIGGERS = [
  'public-api-or-contract',
  'shared-module',
  'dependency-or-lockfile',
  'build-configuration',
  'security-sensitive',
  'impact-unclear',
];

function cmdWorkflow(argv, options = {}) {
  const command = argv[0];
  const rest = argv.slice(1);
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp(options.stdout || process.stdout);
    return;
  }

  const args = parseArgs(rest);
  let result;
  if (command === 'status') result = commandStatus(args);
  else if (command === 'activate') result = commandActivate(args);
  else if (command === 'check') result = commandCheck(args);
  else if (command === 'current') result = commandCurrent(args);
  else if (command === 'hook') result = commandHook(args);
  else if (command === 'complete-agent-action') result = commandCompleteAgentAction(args);
  else if (command === 'plan') result = commandPlan(args);
  else if (command === 'next') result = commandNext(args);
  else {
    throw new Error(`[mobile-spec] 未知 workflow 命令：${command}`);
  }

  writeResult(result, args.json, options.stdout || process.stdout);
  if (result && result.ok === false && options.setExitCode !== false) process.exitCode = 1;
  return result;
}

function parseArgs(argv) {
  const out = { json: false, files: [], artifacts: [], sources: [], positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--change') out.change = argv[++i];
    else if (arg === '--stage') out.stage = argv[++i];
    else if (arg === '--node') out.node = argv[++i];
    else if (arg === '--file') out.files.push(argv[++i]);
    else if (arg === '--artifact') out.artifacts.push(argv[++i]);
    else if (arg === '--name') out.name = argv[++i];
    else if (arg === '--hook') out.hook = argv[++i];
    else if (arg === '--action') out.action = argv[++i];
    else if (arg === '--result') out.result = argv[++i];
    else if (arg === '--failure-step') out.failureStep = argv[++i];
    else if (arg === '--summary-file') out.summaryFile = argv[++i];
    else if (arg === '--reason') out.reason = argv[++i];
    else if (arg === '--source' || arg === '--requirement-source' || arg === '--prd-source') {
      const source = argv[++i];
      out.sources.push(source);
      out.source = source;
    }
    else if (arg === '--text') out.text = argv[++i];
    else if (arg === '--text-file') out.textFile = argv[++i];
    else out.positional.push(arg);
  }
  if (!out.change && out.positional[0]) out.change = out.positional[0];
  return out;
}

function printHelp(stdout) {
  stdout.write(`
Usage: mobile-spec workflow <command> [options]

Commands:
  status [--change <name>] [--json]
  activate --stage <stage> [--change <name>]
  check --stage <stage> [--change <name>]
  current [--json]
  hook --name <hook> --change <name> [--stage <stage>] [--node <node>] [--artifact <id>] [--file <path>] [--failure-step <step>] [--reason <text>] [--text <requirement>|--text-file <path>] [--source <url> ...] --json
  complete-agent-action --change <name> --hook <hook> --action <id> --result pass|failed|skipped --summary-file <json>
  plan --stage <stage> --change <name> --json
  next [--change <name>] --json
`);
}

function writeResult(result, json, stdout) {
  if (json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!result) return;
  if (result.command === 'status') {
    stdout.write(renderStatus(result));
    return;
  }
  stdout.write(`${result.ok === false ? '[mobile-spec] failed' : '[mobile-spec] ok'} ${result.message || ''}\n`);
}

function renderStatus(result) {
  const lines = [`[mobile-spec] workflow status${result.change ? `: ${result.change}` : ''}`];
  for (const item of result.stages || []) {
    const active = item.active ? '(active)' : '';
    const reason = item.reason ? `  ${item.reason}` : '';
    lines.push(`  ${item.label || item.stage}  ${item.status}${active}${reason}`);
  }
  if (result.next) lines.push(`\nnext: ${result.next.label || result.next.stage}`);
  return `${lines.join('\n')}\n`;
}

function commandStatus(args) {
  const ctx = loadContext();
  const change = resolveChange(ctx, args.change);
  const stages = deriveStatuses(ctx, change);
  return {
    ok: true,
    command: 'status',
    change,
    current: readCurrent(ctx),
    stages,
    next: selectNextStage(stages),
    storage: storagePaths(ctx, change),
  };
}

function commandActivate(args) {
  const ctx = loadContext();
  const stage = normalizeStage(args.stage);
  const change = resolveChange(ctx, args.change, { required: true });
  const statuses = deriveStatuses(ctx, change);
  const target = statuses.find((item) => item.stage === stage);
  if (!target) throw new Error(`[mobile-spec] schema.workflow.stages 中不存在 stage：${stage}`);
  if (target.status === 'blocked') {
    return {
      ok: false,
      command: 'activate',
      change,
      stage,
      message: target.reason || '前置阶段未完成',
      storage: storagePaths(ctx, change, stage),
    };
  }
  writeCurrent(ctx, {
    change,
    stage,
    label: target.label || stage,
    activated_at: new Date().toISOString(),
  });
  return {
    ok: true,
    command: 'activate',
    change,
    stage,
    label: target.label || stage,
    storage: storagePaths(ctx, change, stage),
  };
}

function commandCurrent() {
  const ctx = loadContext();
  const current = readCurrent(ctx);
  return {
    ok: true,
    command: 'current',
    current,
    storage: storagePaths(ctx, current && current.change, current && current.stage),
  };
}

function commandPlan(args) {
  const ctx = loadContext();
  const stage = normalizeStage(args.stage);
  const change = resolveChange(ctx, args.change, { required: true });
  return {
    ok: true,
    command: 'plan',
    change,
    ...buildPlan(ctx, stage, change),
    storage: storagePaths(ctx, change, stage),
  };
}

function commandNext(args) {
  const ctx = loadContext();
  const change = resolveChange(ctx, args.change);
  const stages = deriveStatuses(ctx, change);
  return {
    ok: true,
    command: 'next',
    change,
    next: selectNextStage(stages),
    storage: storagePaths(ctx, change),
  };
}

function selectNextStage(stages) {
  return stages.find((stage) => (
    stage.status === 'ready' ||
    stage.status === 'rejected' ||
    (
      stage.status === 'stale' &&
      !/^upstream\b/.test(stage.reason || '')
    )
  )) || null;
}

function commandCheck(args) {
  const ctx = loadContext();
  const stage = normalizeStage(args.stage);
  const change = resolveChange(ctx, args.change, { required: true });
  const archived = isChangeArchived(ctx, change);
  if (archived && stage !== 'archive') {
    const check = readCheck(ctx, change, stage);
    if (check && check.ok === true) {
      return {
        ok: true,
        command: 'check',
        change,
        stage,
        check,
        archived: true,
        message: 'archived change; recorded gate pass',
        storage: storagePaths(ctx, change, stage),
      };
    }
  }
  const check = runStageCheck(ctx, stage, change);
  writeCheck(ctx, change, stage, check);
  return {
    ok: check.ok,
    command: 'check',
    change,
    stage,
    check,
    message: check.ok ? 'gate pass' : 'gate failed',
    storage: storagePaths(ctx, change, stage),
  };
}

function commandHook(args) {
  const ctx = loadContext();
  const hook = args.name;
  if (!hook) throw new Error('[mobile-spec] workflow hook 缺少 --name');
  const change = resolveChange(ctx, args.change, { required: hook !== 'current' && hook !== 'preNew' });
  const stage = args.stage ? normalizeStage(args.stage) : null;
  let deterministic = {};
  let ok = true;
  let message = '';
  let dynamicAgentActions = [];

  if (change && hook !== 'preNew') ensureChangeSidecar(ctx, change);
  const archivedVerifyAudit = stage === 'verify' && isChangeArchived(ctx, change);

  if (hook === 'preNew') {
    const sourceResult = parseRequirementSources(args);
    ok = sourceResult.ok;
    message = sourceResult.ok ? '' : sourceResult.message;
    deterministic = {
      rules: rulesForHook(ctx, 'preNew'),
      sourceRequired: true,
      acceptedSourceTypes: ['text', 'text-file', 'link', 'composite'],
      requirementSource: sourceResult.source || null,
      sourceError: sourceResult.ok ? null : sourceResult.message,
    };
  } else if (hook === 'postNew') {
    const hasSourceInput = Boolean(args.text || args.textFile || args.sources.length);
    const sourceResult = hasSourceInput ? parseRequirementSources(args) : { ok: true, source: null };
    if (!sourceResult.ok) {
      ok = false;
      message = sourceResult.message;
      deterministic = {
        sourceStored: false,
        sourceError: sourceResult.message,
      };
    } else {
      if (sourceResult.source) writeRequirementSource(ctx, change, sourceResult.source);
      const requirement = sourceResult.source && sourceResult.source.requirementId
        ? sourceResult.source.requirementId
        : monitorRequirement(ctx, change);
      const first = firstStage(ctx);
      writeCurrent(ctx, { change, stage: first.id, label: first.label, activated_at: new Date().toISOString() });
      appendEvent(ctx, change, { type: 'workflow.postNew', stage: first.id });
      deterministic = {
        currentUpdated: true,
        sidecarInitialized: true,
        sourceStored: Boolean(sourceResult.source),
        requirementSource: sourceResult.source || readRequirementSource(ctx, change),
        rules: rulesForHook(ctx, 'preNew'),
        events: ['workflow.postNew'],
        monitor: [runMonitor(ctx, ['spec.start', '--requirement', requirement])],
      };
    }
  } else if (hook === 'preStage') {
    if (!stage) throw new Error('[mobile-spec] preStage 缺少 --stage');
    const statuses = deriveStatuses(ctx, change);
    const target = statuses.find((item) => item.stage === stage);
    if (!target) throw new Error(`[mobile-spec] schema.workflow.stages 中不存在 stage：${stage}`);
    const upstreamStale = target.status === 'stale' && /^upstream\b/.test(target.reason || '');
    let verifyInvocation = null;
    if (target.status === 'blocked' || upstreamStale) {
      ok = false;
      message = target.reason || `stage ${stage} ${target.status}`;
    } else {
      if (stage === 'verify') verifyInvocation = beginVerifyInvocation(ctx, change);
      if (!archivedVerifyAudit) {
        writeCurrent(ctx, { change, stage, label: target.label || stage, activated_at: new Date().toISOString() });
      }
    }
    const requirement = monitorRequirement(ctx, change);
    deterministic = {
      currentUpdated: ok && !archivedVerifyAudit,
      archivedAudit: archivedVerifyAudit,
      workflowImpact: archivedVerifyAudit ? 'none' : 'stage',
      stageStatus: target.status,
      ...(stage === 'verify' ? { verifyInvocation } : {}),
      plan: buildPlan(ctx, stage, change),
      monitor: ok && !archivedVerifyAudit
        ? [
          runMonitor(ctx, ['spec.start', '--requirement', requirement]),
          runMonitor(ctx, ['phase.start', stage, '--requirement', requirement]),
        ]
        : [],
    };
  } else if (hook === 'postNode') {
    if (!stage || !args.node) throw new Error('[mobile-spec] postNode 缺少 --stage 或 --node');
    const files = args.files.length ? args.files : [];
    const nodeResult = writeNodeResult(ctx, change, stage, args.node, files, {
      verifyAudit: archivedVerifyAudit,
    });
    const gate = nodeResult.ok ? runNodeGate(ctx, stage, args.node, change, nodeResult) : null;
    if (!archivedVerifyAudit) {
      appendEvent(ctx, change, { type: 'workflow.postNode', stage, node: args.node, files });
    }
    ok = nodeResult.ok && (!gate || gate.ok);
    const verifyRun = ok && stage === 'verify' && args.node === 'verify'
      ? recordVerifyRun(ctx, change)
      : null;
    if (verifyRun && !verifyRun.ok) ok = false;
    deterministic = {
      archivedAudit: archivedVerifyAudit,
      workflowImpact: archivedVerifyAudit ? 'none' : 'stage',
      nodeResult,
      gate,
      ...(verifyRun ? { verifyRun, verifyInvocation: verifyRun.invocation } : {}),
      events: archivedVerifyAudit ? [] : ['workflow.postNode'],
      monitor: archivedVerifyAudit ? [] : monitorValidateFiles(ctx, change, args.node, files),
    };
    message = ok
      ? ''
      : (!nodeResult.ok ? 'node output missing or empty' : (verifyRun && verifyRun.message) || gate.message);
  } else if (hook === 'postStage') {
    if (!stage) throw new Error('[mobile-spec] postStage 缺少 --stage');
    const finishReady = stage === 'verify' ? verifyInvocationFinishReadiness(ctx, change) : { ok: true };
    if (!finishReady.ok) {
      ok = false;
      message = finishReady.message;
      deterministic = {
        archivedAudit: archivedVerifyAudit,
        workflowImpact: archivedVerifyAudit ? 'none' : 'stage',
        verifyInvocation: finishReady.invocation,
        checksUpdated: false,
        events: [],
        monitor: [],
      };
    } else {
      const check = runStageCheck(ctx, stage, change);
      if (!archivedVerifyAudit) writeCheck(ctx, change, stage, check);
      const verifyInvocation = stage === 'verify'
        ? finishVerifyInvocation(ctx, change, check.ok ? 'done' : 'rejected')
        : null;
      if (!archivedVerifyAudit) {
        appendEvent(ctx, change, { type: 'workflow.postStage', stage, ok: check.ok });
      }
      ok = check.ok;
      deterministic = {
        archivedAudit: archivedVerifyAudit,
        workflowImpact: archivedVerifyAudit ? 'none' : 'stage',
        check,
        ...(stage === 'verify' ? { verifyInvocation } : {}),
        checksUpdated: !archivedVerifyAudit,
        events: archivedVerifyAudit ? [] : ['workflow.postStage'],
        monitor: check.ok && stage !== 'archive' && !archivedVerifyAudit
          ? [runMonitor(ctx, ['phase.end', stage, '--requirement', monitorRequirement(ctx, change)])]
          : [],
      };
      message = check.ok ? '' : 'stage gate failed';
    }
  } else if (hook === 'abortVerifyInvocation') {
    if (stage !== 'verify') throw new Error('[mobile-spec] abortVerifyInvocation 必须指定 --stage verify');
    const aborted = abortVerifyInvocation(ctx, change, args.failureStep, args.reason);
    ok = aborted.ok;
    message = aborted.message || '';
    const events = aborted.ok && !archivedVerifyAudit ? ['workflow.verifyInvocationAborted'] : [];
    if (events.length) {
      appendEvent(ctx, change, {
        type: 'workflow.verifyInvocationAborted',
        stage: 'verify',
        invocationId: aborted.invocation.invocationId,
        failureStep: aborted.invocation.abort.failureStep,
        reason: aborted.invocation.abort.reason,
      });
    }
    deterministic = {
      archivedAudit: archivedVerifyAudit,
      workflowImpact: archivedVerifyAudit ? 'none' : 'invocation-only',
      verifyInvocation: aborted.invocation,
      currentUpdated: false,
      checksUpdated: false,
      events,
      monitor: [],
    };
  } else if (hook === 'recordVerifyRepair') {
    if (stage !== 'verify') throw new Error('[mobile-spec] recordVerifyRepair 必须指定 --stage verify');
    const repair = recordVerifyRepair(ctx, change, args.files);
    ok = repair.ok;
    message = repair.message || '';
    deterministic = {
      archivedAudit: archivedVerifyAudit,
      workflowImpact: archivedVerifyAudit ? 'none' : 'stage',
      repair,
      verifyInvocation: repair.invocation,
      events: repair.ok && !archivedVerifyAudit ? ['workflow.verifyRepairRecorded'] : [],
    };
    if (repair.ok && !archivedVerifyAudit) {
      appendEvent(ctx, change, {
        type: 'workflow.verifyRepairRecorded',
        stage: 'verify',
        invocationId: repair.invocation.invocationId,
        repairAttempt: repair.invocation.repairAttempts,
      });
    }
  } else if (hook === 'preArchive') {
    const statuses = deriveStatuses(ctx, change);
    const coding = statuses.find((item) => item.stage === 'coding');
    const verify = statuses.find((item) => item.stage === 'verify');
    const verifyStagePresent = Boolean(ctx.workflow.stages.verify);
    const codingDone = Boolean(coding && coding.status === 'done');
    const verifyDone = verifyStagePresent
      ? Boolean(verify && verify.status === 'done')
      : codingDone;
    ok = verifyDone;
    message = ok ? '' : (verifyStagePresent ? 'verify stage is not done' : 'coding stage is not done');
    deterministic = {
      codingDone,
      verifyDone,
      verifyStagePresent,
    };
  } else if (hook === 'preVerify') {
    const statuses = deriveStatuses(ctx, change);
    const coding = statuses.find((item) => item.stage === 'coding');
    const invocation = readVerifyInvocation(ctx, change);
    const codingDone = Boolean(coding && coding.status === 'done');
    const invocationActive = Boolean(invocation && invocation.status === 'active');
    ok = codingDone && invocationActive;
    message = !codingDone
      ? 'coding stage is not done'
      : (invocationActive ? '' : 'verify invocation is not active; run preStage first');
    deterministic = {
      archivedAudit: archivedVerifyAudit,
      workflowImpact: archivedVerifyAudit ? 'none' : 'stage',
      codingDone,
      invocationActive,
      verifyInvocation: verifyInvocationSummary(invocation),
      rules: rulesForHook(ctx, 'preVerify'),
    };
  } else if (hook === 'preApply') {
    const statuses = deriveStatuses(ctx, change);
    const task = statuses.find((item) => item.stage === 'task');
    ok = Boolean(task && task.status === 'done');
    message = ok ? '' : 'task stage is not done';
    deterministic = { taskDone: ok, rules: rulesForHook(ctx, 'preApply') };
  } else if (hook === 'postArchive') {
    appendEvent(ctx, change, { type: 'workflow.postArchive', stage: 'archive' });
    deterministic = {
      currentClosed: false,
      rules: rulesForHook(ctx, 'postArchive'),
      events: ['workflow.postArchive'],
      monitor: [],
    };
  } else if (hook === 'finalizeArchive') {
    if (stage !== 'archive') throw new Error('[mobile-spec] finalizeArchive 必须指定 --stage archive');
    const archiveCheck = readCheck(ctx, change, 'archive');
    const postArchiveRecorded = hasWorkflowEvent(ctx, change, 'workflow.postArchive');
    const summary = readJsonIfExists(args.summaryFile);
    const summaryStatus = String(summary && summary.status || '').toLowerCase();
    const summaryShapeValid = Boolean(
      summary &&
      typeof summary.action === 'string' &&
      typeof summary.message === 'string' &&
      Array.isArray(summary.changedFiles) &&
      Array.isArray(summary.remainingIssues)
    );
    const summaryPassed = summaryShapeValid && summaryStatus === 'pass';
    const archivePassed = Boolean(archiveCheck && archiveCheck.ok === true);
    ok = archivePassed && postArchiveRecorded && summaryPassed;
    if (!archivePassed) message = 'archive stage check missing or failed';
    else if (!postArchiveRecorded) message = 'postArchive hook has not completed';
    else if (!summary) message = 'finalizeArchive requires a readable --summary-file';
    else if (!summaryShapeValid) message = 'archive summary must include action, message, changedFiles and remainingIssues';
    else if (!summaryPassed) message = `archive post actions not complete: status=${summaryStatus || 'missing'}`;

    const requirement = monitorRequirement(ctx, change);
    const monitorResults = ok
      ? [
        runMonitor(ctx, ['phase.end', 'archive', '--requirement', requirement]),
        runMonitor(ctx, ['spec.end', '--requirement', requirement]),
      ]
      : [];
    if (ok) {
      clearCurrentIfMatch(ctx, change);
      appendEvent(ctx, change, { type: 'workflow.finalizeArchive', stage: 'archive' });
    }
    deterministic = {
      archiveCheckPassed: archivePassed,
      postArchiveRecorded,
      summaryShapeValid,
      summaryPassed,
      summary,
      currentClosed: ok,
      events: ok ? ['workflow.finalizeArchive'] : [],
      monitor: monitorResults,
    };
  } else if (hook === 'onChange') {
    const changeRecord = recordChange(ctx, change, stage, args.files, args.artifacts, args.reason);
    const current = readCurrent(ctx);
    const monitorResults = stage && current && current.change === change && current.stage === stage
      ? [runMonitor(ctx, ['phase.end', stage, '--requirement', monitorRequirement(ctx, change)])]
      : [];
    deterministic = { ...changeRecord, monitor: monitorResults };
    appendEvent(ctx, change, { type: 'workflow.onChange', stage, staleStages: changeRecord.staleStages });
  } else {
    throw new Error(`[mobile-spec] 未知 workflow hook：${hook}`);
  }

  return {
    ok,
    command: 'hook',
    hook,
    change,
    stage,
    message,
    deterministic,
    agentActions: [
      ...resolveAgentActions(ctx, hook, { change, stage, deterministic }),
      ...dynamicAgentActions,
    ],
    storage: storagePaths(ctx, change, stage, args.node),
  };
}

function commandCompleteAgentAction(args) {
  const ctx = loadContext();
  const change = resolveChange(ctx, args.change, { required: true });
  if (!args.hook || !args.action || !args.result) {
    throw new Error('[mobile-spec] complete-agent-action 缺少 --hook / --action / --result');
  }
  const allowed = new Set(['pass', 'failed', 'skipped']);
  if (!allowed.has(args.result)) {
    throw new Error('[mobile-spec] --result 只能是 pass / failed / skipped');
  }
  const summary = readJsonIfExists(args.summaryFile);
  const row = {
    ts: new Date().toISOString(),
    change,
    hook: args.hook,
    action: args.action,
    result: args.result,
    summary,
  };
  appendJsonl(agentActionsFile(ctx, change), row);
  return {
    ok: args.result !== 'failed',
    command: 'complete-agent-action',
    change,
    action: args.action,
    result: args.result,
    message: '',
    storage: storagePaths(ctx, change),
  };
}

function loadContext(cwd = process.cwd()) {
  const projectRoot = findProjectRoot(cwd);
  const openspecDir = path.join(projectRoot, 'openspec');
  const configFile = path.join(openspecDir, 'config.yaml');
  if (!fs.existsSync(configFile)) {
    throw new Error(`[mobile-spec] 未找到 openspec/config.yaml：${configFile}`);
  }
  const config = yaml.load(fs.readFileSync(configFile, 'utf8')) || {};
  const schemaName = config.schema;
  if (!schemaName) throw new Error('[mobile-spec] openspec/config.yaml 缺少 schema 字段');
  const schemaFile = resolveSchemaFile(projectRoot, schemaName);
  const schema = yaml.load(fs.readFileSync(schemaFile, 'utf8')) || {};
  if (!schema.workflow || !schema.workflow.stages) {
    throw new Error(`[mobile-spec] schema 缺少 workflow.stages：${schemaFile}`);
  }
  migrateLegacyWorkflowState(projectRoot);
  return {
    projectRoot,
    openspecDir,
    config,
    schemaName,
    schemaFile,
    schema,
    workflow: schema.workflow,
    platform: config.platform || (schemaName === 'h5-sdd' ? 'h5' : 'native'),
  };
}

function findProjectRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, 'openspec', 'config.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

function resolveSchemaFile(projectRoot, schemaName) {
  const candidates = [
    path.join(projectRoot, 'openspec', 'schemas', schemaName, 'schema.yaml'),
    path.resolve(__dirname, '..', '..', 'schemas', schemaName, 'schema', 'schema.yaml'),
    path.join(getUserSchemasDir(), schemaName, 'schema.yaml'),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error(`[mobile-spec] 找不到 schema.yaml：${schemaName}`);
  return found;
}

function normalizeStage(stage) {
  if (!stage) throw new Error('[mobile-spec] 缺少 --stage');
  const normalized = STAGE_ALIASES[String(stage).trim()];
  if (!normalized) throw new Error(`[mobile-spec] 未知 stage：${stage}`);
  return normalized;
}

function firstStage(ctx) {
  const entries = Object.entries(ctx.workflow.stages);
  if (!entries.length) throw new Error('[mobile-spec] workflow.stages 为空');
  const [id, stage] = entries[0];
  return { id, label: stage.label || id };
}

function stageEntries(ctx) {
  return Object.entries(ctx.workflow.stages).map(([id, stage]) => ({ id, ...stage }));
}

function resolveChange(ctx, change, options = {}) {
  if (change) return change;
  const current = readCurrent(ctx);
  if (current && current.change) return current.change;
  const changesDir = path.join(ctx.openspecDir, 'changes');
  const changes = fs.existsSync(changesDir)
    ? fs.readdirSync(changesDir).filter((name) => !name.startsWith('.') && fs.statSync(path.join(changesDir, name)).isDirectory())
    : [];
  if (changes.length === 1) return changes[0];
  if (options.required) throw new Error('[mobile-spec] 缺少 --change，且无法从 current 或唯一 change 推断');
  return null;
}

function buildPlan(ctx, stageId, change) {
  const stage = ctx.workflow.stages[stageId];
  if (!stage) throw new Error(`[mobile-spec] schema.workflow.stages 中不存在 stage：${stageId}`);
  const archivedAudit = stageId === 'verify' && isChangeArchived(ctx, change);
  const artifacts = (stage.artifacts || []).map((id) => {
    const artifact = findArtifact(ctx, id);
    return {
      id,
      outputPath: artifact ? artifactOutputDisplay(ctx, change, artifact) : null,
      dependencies: artifact && Array.isArray(artifact.requires) ? artifact.requires : [],
      gate: stage.gate && stage.gate.artifact === id ? stage.gate.type : undefined,
    };
  });
  const actions = (stage.actions || []).map((id) => {
    const action = { id, outputPath: actionOutputDisplay(ctx, change, id) };
    if (stageId === 'verify' && id === 'verify') {
      action.execution = {
        executor: 'subagent',
        required: true,
        freshContext: true,
        productMutation: 'forbidden',
        writeScope: 'verification-artifacts-only',
        abortHook: 'abortVerifyInvocation',
      };
      action.coordinatorRepair = {
        owner: 'coordinator',
        trigger: 'all-deterministic-implementation-findings',
        productMutation: 'allowed',
        writeScope: 'finding-affected-files',
        recordHook: 'recordVerifyRepair',
        maxAttemptsPerInvocation: VERIFY_MAX_REPAIR_ATTEMPTS,
        reverifyWithFreshSubagent: true,
        stopConditions: [
          'mixed-or-uncertain-finding',
          'missing-safe-mutation-authority',
          'no-product-file-change',
          'no-progress',
          'attempt-limit',
        ],
      };
      action.verification = buildVerifyPlanPolicy(ctx, change);
    }
    return action;
  });
  const unsupportedActions = actions
    .filter((action) => NON_REPLAYABLE_ACTIONS.has(action.id))
    .map((action) => action.id);
  const preHooks = actions
    .map((action) => (
      action.id === 'verify' && stageId === 'verify'
        ? 'preVerify'
        : PRE_HOOK_BY_ACTION[action.id]
    ))
    .filter(Boolean);
  return {
    stage: stageId,
    label: stage.label || stageId,
    title: stage.title || stage.label || stageId,
    executionMode: archivedAudit ? 'archived-audit' : 'workflow-stage',
    workflowImpact: archivedAudit ? 'none' : 'stage',
    requires: stage.requires || [],
    artifacts,
    actions,
    gate: stage.gate || null,
    rules: rulesForStage(ctx, stageId),
    replay: {
      replayable: unsupportedActions.length === 0,
      preHooks: [...new Set(preHooks)],
      nodes: [
        ...artifacts.map((artifact) => ({
          node: POST_NODE_BY_ARTIFACT[artifact.id] || artifact.id,
          source: 'artifact',
          id: artifact.id,
          outputPath: artifact.outputPath,
        })),
        ...actions.map((action) => ({
          node: action.id,
          source: 'action',
          id: action.id,
          outputPath: action.outputPath,
        })),
      ],
      postHook: 'postStage',
      unsupportedActions,
    },
  };
}

function buildVerifyPlanPolicy(ctx, change) {
  const invocation = readVerifyInvocation(ctx, change);
  return {
    policyVersion: VERIFY_PROFILE_VERSION,
    profilePath: verifyProfileFile(ctx, change),
    decisionOwner: 'coordinator',
    subagentMayEscalateOnly: true,
    unavailableRequiredCapability: 'environment-fail',
    recommendedMode: 'initial',
    invocation: verifyInvocationSummary(invocation),
    initial: {
      aiCr: { selection: 'required', scope: 'full' },
      specScenarios: { selection: 'required', scope: 'affected' },
      automatedChecks: { selection: 'required|targeted|n-a', scope: 'full|affected|none' },
    },
    fullVerificationTriggers: VERIFY_FULL_VERIFICATION_TRIGGERS,
  };
}

function rulesForStage(ctx, stageId) {
  if (stageId === 'propose') return rulesForHook(ctx, 'preNew');
  if (stageId === 'coding') return rulesForHook(ctx, 'preApply');
  if (stageId === 'verify') return rulesForHook(ctx, 'preVerify');
  if (stageId === 'archive') return rulesForHook(ctx, 'postArchive');
  return [];
}

function rulesForHook(ctx, hook) {
  const rules = ctx.config && ctx.config.rules;
  if (!rules || typeof rules !== 'object') return [];
  const matchedKey = Object.keys(rules).find((key) => key.toLowerCase() === String(hook).toLowerCase());
  if (!matchedKey) return [];
  const value = rules[matchedKey];
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

function parseRequirementSources(args, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const inlineText = typeof args.text === 'string' ? args.text.trim() : '';
  let fileText = '';
  let textFile = null;

  if (args.textFile) {
    const resolved = path.resolve(projectRoot, args.textFile);
    const relativePath = path.relative(projectRoot, resolved);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return { ok: false, message: 'mobile-spec-proposal --text-file must stay inside the project workspace' };
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { ok: false, message: `mobile-spec-proposal text file not found: ${relativePath || args.textFile}` };
    }
    if (fs.statSync(resolved).size > 200 * 1024) {
      return { ok: false, message: 'mobile-spec-proposal text file exceeds 200 KiB' };
    }
    fileText = fs.readFileSync(resolved, 'utf8').trim();
    textFile = relativePath || path.basename(resolved);
  }

  const textParts = [inlineText, fileText].filter(Boolean);
  const links = [];
  for (const value of args.sources || []) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) continue;
    if (!/^https?:\/\/\S+$/i.test(raw)) {
      return { ok: false, message: `mobile-spec-proposal source must be an http(s) link: ${raw}` };
    }
    const lower = raw.toLowerCase();
    const wangyueId = extractWangyueIdFromSource(raw);
    const isCooper = lower.includes('cooper.');
    const isWangyue = Boolean(wangyueId) || lower.includes('wangyue') || lower.includes('ddp');
    if (isWangyue && !wangyueId) {
      return { ok: false, message: `cannot parse Wangyue ID from source link: ${raw}` };
    }
    links.push({
      type: isCooper ? 'cooper' : isWangyue ? 'wangyue' : 'web',
      url: raw,
      ...(isCooper ? { cooperUrl: raw } : {}),
      ...(wangyueId ? { wangyueId, requirementId: requirementIdFromWangyueId(wangyueId) } : {}),
    });
  }

  if (!textParts.length && !links.length) {
    return {
      ok: false,
      message: 'mobile-spec-proposal requires requirement text (--text or --text-file) and/or at least one --source link',
    };
  }

  const firstRequirementLink = links.find((link) => link.requirementId);
  const type = textParts.length && links.length ? 'composite' : textParts.length ? 'text' : 'link';
  return {
    ok: true,
    source: {
      type,
      text: textParts.join('\n\n'),
      textFile,
      links,
      url: links[0] ? links[0].url : null,
      cooperUrl: (links.find((link) => link.cooperUrl) || {}).cooperUrl || null,
      wangyueId: firstRequirementLink ? firstRequirementLink.wangyueId : null,
      requirementId: firstRequirementLink ? firstRequirementLink.requirementId : null,
    },
  };
}

function extractWangyueIdFromSource(source) {
  const raw = String(source || '');
  const sequence = raw.match(/(?:^|[^a-z0-9])(?:r-)?(wyc-\d+)(?:[^a-z0-9]|$)/i);
  if (sequence) return sequence[1].toLowerCase();

  const query = raw.match(/[?&](?:requirementId|demandId|resourceId|sequence|id)=(?:R-)?(?:WYC-)?(\d{4,})\b/i);
  if (query) return `wyc-${query[1]}`;

  return null;
}

function requirementIdFromWangyueId(wangyueId) {
  return `R-${String(wangyueId).toUpperCase()}`;
}

function findArtifact(ctx, id) {
  return (ctx.schema.artifacts || []).find((item) => item.id === id) || null;
}

function artifactOutputDisplay(ctx, change, artifact) {
  const generated = artifact.generates || '';
  const display = generated
    .replace(/\*\*\/\*/g, '<path>')
    .replace(/\*/g, '<name>');
  return path.posix.join('openspec', 'changes', change, display);
}

function actionOutputDisplay(ctx, change, id) {
  if (id === 'verify') return verifyResultFile(ctx, change);
  if (id === 'apply') return path.posix.join('openspec', 'changes', change, 'tasks.md');
  if (id === 'archive') return path.posix.join('openspec', 'changes', 'archive', `<date>-${change}`);
  return null;
}

function storagePaths(ctx, change, stage, node) {
  const workflowHome = getWorkflowHome();
  const projectDir = getProjectWorkflowDir(ctx.projectRoot);
  const changeSidecarDir = change ? getChangeSidecarDir(ctx.projectRoot, change) : null;
  const archivedVerifyAudit = Boolean(changeSidecarDir && stage === 'verify' && isChangeArchived(ctx, change));
  const verifyDir = changeSidecarDir
    ? (archivedVerifyAudit ? verifyStateDir(ctx, change) : changeSidecarDir)
    : null;
  const nodesDir = changeSidecarDir
    ? (archivedVerifyAudit ? path.join(verifyDir, 'nodes') : path.join(changeSidecarDir, 'nodes'))
    : null;
  return {
    workflowHome,
    projectsIndexFile: path.join(workflowHome, 'projects.json'),
    projectDir,
    currentFile: getCurrentFile(ctx.projectRoot),
    changeDir: changeSidecarDir,
    checksDir: changeSidecarDir ? path.join(changeSidecarDir, 'checks') : null,
    checkFile: changeSidecarDir && stage ? path.join(changeSidecarDir, 'checks', `${stage}.json`) : null,
    nodesDir,
    nodeFile: nodesDir && node ? path.join(nodesDir, `${node}.json`) : null,
    eventsFile: changeSidecarDir ? path.join(changeSidecarDir, 'events.jsonl') : null,
    agentActionsFile: changeSidecarDir ? path.join(changeSidecarDir, 'agent-actions.jsonl') : null,
    requirementSourceFile: changeSidecarDir ? path.join(changeSidecarDir, 'source.json') : null,
    verifyInvocationFile: verifyDir ? path.join(verifyDir, 'verify-invocation.json') : null,
    verifyProfileFile: verifyDir ? path.join(verifyDir, 'verify-profile.json') : null,
    verifyResultFile: verifyDir ? path.join(verifyDir, 'verify-result.json') : null,
    changesFile: changeSidecarDir ? path.join(changeSidecarDir, 'changes.jsonl') : null,
  };
}

function verifyStateDir(ctx, change) {
  const root = sidecarDir(ctx, change);
  return isChangeArchived(ctx, change) ? path.join(root, 'verify-audit') : root;
}

function verifyInvocationFile(ctx, change) {
  return path.join(verifyStateDir(ctx, change), 'verify-invocation.json');
}

function verifyProfileFile(ctx, change) {
  return path.join(verifyStateDir(ctx, change), 'verify-profile.json');
}

function verifyResultFile(ctx, change) {
  return path.join(verifyStateDir(ctx, change), 'verify-result.json');
}

function readVerifyInvocation(ctx, change) {
  return readJsonIfExists(verifyInvocationFile(ctx, change));
}

function writeVerifyInvocation(ctx, change, invocation) {
  const file = verifyInvocationFile(ctx, change);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(invocation, null, 2)}\n`, 'utf8');
  return invocation;
}

function verifyInvocationSummary(invocation) {
  if (!invocation || typeof invocation !== 'object') return null;
  return {
    invocationId: invocation.invocationId,
    status: invocation.status,
    repairAttempts: invocation.repairAttempts,
    maxRepairAttempts: invocation.maxRepairAttempts,
    lastRunId: invocation.lastRunId || null,
    workflowImpact: invocation.workflowImpact || 'stage',
    ...(invocation.abort ? { abort: invocation.abort } : {}),
  };
}

function beginVerifyInvocation(ctx, change) {
  const archivedAudit = isChangeArchived(ctx, change);
  const previous = readVerifyInvocation(ctx, change);
  const now = new Date().toISOString();
  const invocation = writeVerifyInvocation(ctx, change, {
    version: VERIFY_INVOCATION_VERSION,
    invocationId: crypto.randomUUID(),
    status: 'active',
    repairAttempts: 0,
    maxRepairAttempts: VERIFY_MAX_REPAIR_ATTEMPTS,
    workflowImpact: archivedAudit ? 'none' : 'stage',
    lastRunId: null,
    runs: [],
    repairs: [],
    startedAt: now,
    updatedAt: now,
  });
  if (!archivedAudit) {
    const priorCheck = readCheck(ctx, change, 'verify');
    if (priorCheck) {
      writeCheck(ctx, change, 'verify', {
        ...priorCheck,
        stale: true,
        staleReason: 'new verify invocation started',
        invalidated_at: now,
      });
    }
    appendEvent(ctx, change, {
      type: 'workflow.verifyInvocationStarted',
      stage: 'verify',
      invocationId: invocation.invocationId,
      previousInvocationId: previous ? previous.invocationId : null,
    });
  }
  return verifyInvocationSummary(invocation);
}

function finishVerifyInvocation(ctx, change, status) {
  const invocation = readVerifyInvocation(ctx, change);
  if (!invocation) return null;
  const finishedAt = new Date().toISOString();
  const updated = writeVerifyInvocation(ctx, change, {
    ...invocation,
    status,
    finishedAt,
    updatedAt: finishedAt,
  });
  return verifyInvocationSummary(updated);
}

function verifyInvocationFinishReadiness(ctx, change) {
  const invocation = readVerifyInvocation(ctx, change);
  const summary = verifyInvocationSummary(invocation);
  if (!invocation || invocation.status !== 'active') {
    return {
      ok: false,
      message: 'active verify invocation required before postStage',
      invocation: summary,
    };
  }
  const runs = Array.isArray(invocation.runs) ? invocation.runs : [];
  const run = runs.at(-1);
  if (
    !run ||
    run.runId !== invocation.lastRunId ||
    run.repairAttempt !== invocation.repairAttempts
  ) {
    return {
      ok: false,
      message: 'fresh valid verify run required before postStage; abort the invocation on orchestration failure',
      invocation: summary,
    };
  }
  return { ok: true, invocation: summary };
}

function abortVerifyInvocation(ctx, change, failureStep, reason) {
  const invocation = readVerifyInvocation(ctx, change);
  const summary = verifyInvocationSummary(invocation);
  if (!invocation || invocation.status !== 'active') {
    return { ok: false, message: 'active verify invocation required before abort', invocation: summary };
  }
  const normalizedStep = String(failureStep || '').trim();
  const normalizedReason = String(reason || '').trim();
  if (!normalizedStep || !normalizedReason) {
    return {
      ok: false,
      message: 'abortVerifyInvocation requires --failure-step and --reason',
      invocation: summary,
    };
  }
  const abortedAt = new Date().toISOString();
  const updated = writeVerifyInvocation(ctx, change, {
    ...invocation,
    status: 'aborted',
    abort: {
      failureStep: normalizedStep,
      reason: normalizedReason,
      abortedAt,
    },
    updatedAt: abortedAt,
  });
  return { ok: true, invocation: verifyInvocationSummary(updated) };
}

function recordVerifyRun(ctx, change) {
  const invocation = readVerifyInvocation(ctx, change);
  const verifyFile = verifyResultFile(ctx, change);
  const result = readJsonIfExists(verifyFile);
  if (!invocation || invocation.status !== 'active') {
    return {
      ok: false,
      message: 'active verify invocation missing',
      invocation: verifyInvocationSummary(invocation),
    };
  }

  const runId = String(result && result.runId || '').trim();
  const existingRuns = Array.isArray(invocation.runs) ? invocation.runs : [];
  if (existingRuns.some((run) => run.runId === runId)) {
    return {
      ok: false,
      message: `verify runId already recorded: ${runId}`,
      invocation: verifyInvocationSummary(invocation),
    };
  }

  const findings = Array.isArray(result && result.findings) ? result.findings : [];
  const blockingFindings = findings.filter((finding) => finding && finding.blocking === true);
  const affectedFiles = [...new Set(blockingFindings.flatMap((finding) => finding.affectedFiles || []))].sort();
  const findingFingerprint = blockingFindings.length
    ? digestValue(blockingFindings.map((finding) => ({
      id: finding.id,
      failureClass: normalizeVerifyFailureClass(finding.failureClass),
      evidence: finding.evidence,
      affectedFiles: [...(finding.affectedFiles || [])].sort(),
    })))
    : null;
  const fileHashes = hashProjectRelativeFiles(ctx, affectedFiles);
  const run = {
    runId,
    repairAttempt: result.verificationProfile.repairAttempt,
    status: result.status,
    failureClass: normalizeVerifyFailureClass(result.failureClass),
    findingFingerprint,
    affectedFiles,
    fileHashes,
    productHash: digestValue(fileHashes),
    recordedAt: new Date().toISOString(),
  };
  const updated = writeVerifyInvocation(ctx, change, {
    ...invocation,
    lastRunId: runId,
    runs: [...existingRuns, run],
    updatedAt: run.recordedAt,
  });
  return {
    ok: true,
    run,
    invocation: verifyInvocationSummary(updated),
  };
}

function recordVerifyRepair(ctx, change, files) {
  const invocation = readVerifyInvocation(ctx, change);
  const summary = verifyInvocationSummary(invocation);
  if (!invocation || invocation.status !== 'active') {
    return { ok: false, message: 'active verify invocation missing', invocation: summary };
  }
  if (invocation.repairAttempts >= invocation.maxRepairAttempts) {
    return { ok: false, message: 'verify repair attempt limit reached', invocation: summary };
  }

  const runs = Array.isArray(invocation.runs) ? invocation.runs : [];
  const run = runs.at(-1);
  if (!run || run.status !== 'fail' || run.repairAttempt !== invocation.repairAttempts) {
    return { ok: false, message: 'fresh failed verify run required before repair', invocation: summary };
  }

  const verifyResult = readJsonIfExists(verifyResultFile(ctx, change));
  const blockingFindings = Array.isArray(verifyResult && verifyResult.findings)
    ? verifyResult.findings.filter((finding) => finding && finding.blocking === true)
    : [];
  if (!blockingFindings.length || blockingFindings.some((finding) => (
    normalizeVerifyFailureClass(finding.failureClass) !== 'implementation'
  ))) {
    return {
      ok: false,
      message: 'only deterministic implementation findings are repairable',
      invocation: summary,
    };
  }

  const allowedFiles = [...new Set(run.affectedFiles || [])].sort();
  if (!allowedFiles.length || allowedFiles.some(isMobileSpecArtifactPath)) {
    return {
      ok: false,
      message: 'repair requires finding-scoped product files',
      invocation: summary,
    };
  }
  const rawDeclaredFiles = (files || []).map((file) => String(file || '').trim());
  if (!rawDeclaredFiles.length || rawDeclaredFiles.some((file) => !isSafeProjectRelativePath(file))) {
    return { ok: false, message: 'recordVerifyRepair requires project-relative --file values', invocation: summary };
  }
  const declaredFiles = [...new Set(rawDeclaredFiles.map((file) => path.normalize(file)))].sort();
  const outsideScope = declaredFiles.filter((file) => !allowedFiles.includes(file));
  if (outsideScope.length) {
    return {
      ok: false,
      message: `repair files outside finding scope: ${outsideScope.join(', ')}`,
      invocation: summary,
    };
  }

  const currentHashes = hashProjectRelativeFiles(ctx, allowedFiles);
  const changedFiles = allowedFiles.filter((file) => currentHashes[file] !== run.fileHashes[file]);
  if (!changedFiles.length) {
    return { ok: false, message: 'verify repair made no product file changes', invocation: summary };
  }
  const undeclaredFiles = changedFiles.filter((file) => !declaredFiles.includes(file));
  if (undeclaredFiles.length) {
    return {
      ok: false,
      message: `changed repair files were not declared: ${undeclaredFiles.join(', ')}`,
      invocation: summary,
    };
  }

  const repairAttempt = invocation.repairAttempts + 1;
  const recordedAt = new Date().toISOString();
  const repair = {
    repairAttempt,
    sourceRunId: run.runId,
    findingFingerprint: run.findingFingerprint,
    changedFiles,
    beforeProductHash: run.productHash,
    afterProductHash: digestValue(currentHashes),
    recordedAt,
  };
  const updated = writeVerifyInvocation(ctx, change, {
    ...invocation,
    repairAttempts: repairAttempt,
    repairs: [...(Array.isArray(invocation.repairs) ? invocation.repairs : []), repair],
    updatedAt: recordedAt,
  });
  return {
    ok: true,
    repair,
    invocation: verifyInvocationSummary(updated),
  };
}

function isMobileSpecArtifactPath(file) {
  const normalized = path.normalize(file);
  return normalized === 'openspec' || normalized.startsWith(`openspec${path.sep}`);
}

function hashProjectRelativeFiles(ctx, files) {
  const hashes = {};
  for (const file of [...new Set(files)].sort()) {
    const absolute = path.resolve(ctx.projectRoot, file);
    if (!fs.existsSync(absolute)) hashes[file] = 'missing';
    else if (fs.statSync(absolute).isDirectory()) hashes[file] = hashFiles([absolute]);
    else hashes[file] = digestValue(fs.readFileSync(absolute));
  }
  return hashes;
}

function digestValue(value) {
  const input = Buffer.isBuffer(value) ? value : canonicalJson(value);
  return `sha256:${crypto.createHash('sha256').update(input).digest('hex')}`;
}

function deriveStatuses(ctx, change) {
  const current = readCurrent(ctx);
  const archived = change ? isChangeArchived(ctx, change) : false;
  const archivedCheck = archived ? readCheck(ctx, change, 'archive') : null;
  const archivedComplete = Boolean(archivedCheck && archivedCheck.ok === true);
  const completed = new Set();
  const statusByStage = {};
  const rows = [];
  for (const stage of stageEntries(ctx)) {
    const requires = stage.requires || [];
    const staleBy = requires.filter((dep) => statusByStage[dep] === 'stale');
    const blockedBy = requires.filter((dep) => !completed.has(dep) && statusByStage[dep] !== 'stale');
    let status;
    let reason = '';
    const check = change ? readCheck(ctx, change, stage.id) : null;
    const stale = change && check && !archived ? isCheckStale(ctx, change, check) : false;
    if (archivedComplete && !check) {
      status = 'done';
      completed.add(stage.id);
    } else if (blockedBy.length) {
      status = 'blocked';
      reason = `waiting for ${blockedBy.join(', ')}`;
    } else if (staleBy.length) {
      status = 'stale';
      reason = `upstream ${staleBy.join(', ')} stale`;
    } else if (stale) {
      status = 'stale';
      reason = stale;
    } else if (check && check.ok === false) {
      status = 'rejected';
      reason = firstFailedCheck(check);
    } else if (check && check.ok === true) {
      status = 'done';
      completed.add(stage.id);
    } else {
      status = 'ready';
    }
    statusByStage[stage.id] = status;
    rows.push({
      stage: stage.id,
      label: stage.label || stage.id,
      status,
      active: Boolean(current && current.change === change && current.stage === stage.id),
      reason,
    });
  }
  return rows;
}

function firstFailedCheck(check) {
  const failed = (check.checks || []).find((item) => !item.ok);
  return failed ? `${failed.id} failed${failed.message ? `: ${failed.message}` : ''}` : 'gate failed';
}

function runStageCheck(ctx, stageId, change) {
  const stage = ctx.workflow.stages[stageId];
  if (!stage) throw new Error(`[mobile-spec] schema.workflow.stages 中不存在 stage：${stageId}`);
  ensureChangeSidecar(ctx, change);

  const checks = [];
  for (const artifactId of stage.artifacts || []) {
    const files = artifactFiles(ctx, change, artifactId);
    checks.push({
      id: `artifact:${artifactId}`,
      ok: files.length > 0 && files.every((file) => isNonEmptyFile(file)),
      files: files.map((file) => relative(ctx.projectRoot, file)),
    });
  }

  if (stage.gate && stage.gate.type === 'proposal-status') {
    checks.push(checkProposalStatus(ctx, change));
    checks.push(checkProposalOpenQuestions(ctx, change));
  }
  if (stage.gate && stage.gate.type === 'review-status') checks.push(checkReviewStatus(ctx, change));
  if (stage.gate && stage.gate.type === 'task-format') checks.push(checkTaskFormat(ctx, change));
  if (stage.gate && stage.gate.type === 'apply') checks.push(checkApply(ctx, change));
  if (stage.gate && stage.gate.type === 'verify') checks.push(checkVerify(ctx, change, { requireSubagent: true }));
  if (stage.gate && stage.gate.type === 'apply-verify') checks.push(checkApplyVerify(ctx, change));
  if ((stage.actions || []).includes('archive')) checks.push(checkArchiveComplete(ctx, change));

  const inputs = hashInputsForStage(ctx, change, stage);
  const outputs = hashOutputsForStage(ctx, change, stage);
  const ok = checks.every((item) => item.ok);
  return {
    stage: stageId,
    label: stage.label || stageId,
    ok,
    inputs,
    outputs,
    checks,
    stale: false,
    staleReason: null,
    updated_at: new Date().toISOString(),
  };
}

function runNodeGate(ctx, stageId, node, change, nodeResult = null) {
  const stage = ctx.workflow.stages[stageId];
  if (!stage || !stage.gate) return null;
  if (stage.gate.type === 'verify' && node === 'verify') {
    const verifyFile = verifyResultFile(ctx, change);
    const submittedFiles = Array.isArray(nodeResult && nodeResult.absoluteFiles)
      ? nodeResult.absoluteFiles.map((file) => path.resolve(file))
      : [];
    const errors = [];
    if (submittedFiles.length !== 1 || submittedFiles[0] !== path.resolve(verifyFile)) {
      errors.push('verify node must submit storage.verifyResultFile');
    }
    const subagentResult = validateVerifySubagentResult(
      ctx,
      change,
      verifyFile,
      readJsonIfExists(verifyFile),
    );
    errors.push(...subagentResult.errors);
    return {
      id: 'gate:verify-subagent-result',
      ok: errors.length === 0,
      value: { subagentResultValid: errors.length === 0 },
      message: errors.length
        ? `verify-result.json invalid subagent result: ${errors.join(', ')}`
        : null,
    };
  }
  if (stage.gate.artifact !== node) return null;
  if (stage.gate.type === 'proposal-status') {
    const statusGate = checkProposalStatus(ctx, change);
    return statusGate.ok ? checkProposalOpenQuestions(ctx, change) : statusGate;
  }
  return null;
}

function checkProposalStatus(ctx, change) {
  const file = path.join(artifactBaseDir(ctx, change), 'proposal.md');
  const text = readText(file).replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) || '';
  const statusPattern = /^(?:status:\s*(ready|blocked)|`status:\s*(ready|blocked)`)$/i;
  const match = lastLine.match(statusPattern);
  const statusLines = lines.filter((line) => statusPattern.test(line));
  const valid = Boolean(match && statusLines.length === 1);
  const status = match ? (match[1] || match[2]).toLowerCase() : null;
  return {
    id: 'gate:proposal-status',
    ok: Boolean(valid && status === 'ready'),
    value: status,
    message: valid
      ? (status === 'ready' ? null : 'proposal status is blocked')
      : 'proposal.md must end with exactly one status: ready|blocked line',
  };
}

function checkProposalOpenQuestions(ctx, change) {
  const file = path.join(artifactBaseDir(ctx, change), 'proposal.md');
  const text = readText(file).replace(/<!--[\s\S]*?-->/g, '');
  const section = text.match(
    /^##\s+(?:\d+\.\s*)?未决问题\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/m,
  );
  if (!section) {
    return {
      id: 'gate:proposal-open-questions',
      ok: false,
      value: null,
      message: 'proposal.md must contain an open questions disposition table',
    };
  }

  const lines = section[1].split(/\r?\n/);
  const parsedRows = lines.map((line) => splitMarkdownTableRow(line));
  const headerIndex = parsedRows.findIndex((cells) => {
    if (!cells) return false;
    const headings = cells.map(normalizeMarkdownCell);
    return ['问题', '处置状态', '处置结论', '确认依据']
      .every((heading) => headings.includes(heading));
  });
  const header = headerIndex >= 0 ? parsedRows[headerIndex] : null;
  const separator = headerIndex >= 0
    ? parsedRows.slice(headerIndex + 1).find((cells) => cells && cells.some(Boolean))
    : null;
  if (!header || !separator || separator.length !== header.length
    || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return {
      id: 'gate:proposal-open-questions',
      ok: false,
      value: null,
      message: 'proposal open questions must use the required disposition table',
    };
  }

  const headerMap = Object.fromEntries(
    header.map((cell, index) => [normalizeMarkdownCell(cell), index]),
  );
  const separatorIndex = parsedRows.indexOf(separator);
  const rows = parsedRows
    .slice(separatorIndex + 1)
    .filter((cells) => cells && cells.some((cell) => cell.trim()));
  const unresolved = [];
  const incomplete = [];
  const settledStatuses = new Set(['已解决', '已确认后续补充']);

  rows.forEach((cells, index) => {
    const row = index + 1;
    const question = cells[headerMap['问题']] || '';
    const status = normalizeMarkdownCell(cells[headerMap['处置状态']] || '');
    const resolution = cells[headerMap['处置结论']] || '';
    const evidence = cells[headerMap['确认依据']] || '';
    if (!settledStatuses.has(status)) {
      unresolved.push({ row, question: question.trim(), status: status || null });
      return;
    }
    if (![question, resolution, evidence].every(hasConcreteMarkdownValue)) {
      incomplete.push({ row, question: question.trim(), status });
    }
  });

  let message = null;
  if (unresolved.length) {
    message = `proposal has unresolved questions at row(s): ${unresolved.map((item) => item.row).join(', ')}`;
  } else if (incomplete.length) {
    message = `proposal question dispositions need a question, conclusion and confirmation evidence at row(s): ${incomplete.map((item) => item.row).join(', ')}`;
  }
  return {
    id: 'gate:proposal-open-questions',
    ok: unresolved.length === 0 && incomplete.length === 0,
    value: {
      total: rows.length,
      unresolved,
      incomplete,
    },
    message,
  };
}

function splitMarkdownTableRow(line) {
  const value = line.trim();
  if (!value.startsWith('|') || !value.endsWith('|')) return null;

  const cells = [];
  let cell = '';
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function normalizeMarkdownCell(value) {
  return String(value || '').trim().replace(/^`|`$/g, '').replace(/\s+/g, '');
}

function hasConcreteMarkdownValue(value) {
  const normalized = normalizeMarkdownCell(value);
  return Boolean(
    normalized
    && !/^(?:-|—|无|不适用|n\/a)$/i.test(normalized)
    && !/[<>]/.test(normalized)
  );
}

function checkReviewStatus(ctx, change) {
  const file = path.join(artifactBaseDir(ctx, change), 'review.md');
  const text = readText(file).replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) || '';
  const match = lastLine.match(/^`?status:\s*(pass|blocked)`?$/i);
  const statusLines = lines.filter((line) => /^`?status:\s*(pass|blocked)`?$/i.test(line));
  const valid = Boolean(match && statusLines.length === 1);
  return {
    id: 'gate:review-status',
    ok: Boolean(valid && match[1].toLowerCase() === 'pass'),
    value: match ? match[1].toLowerCase() : null,
    message: valid
      ? (match[1].toLowerCase() === 'pass' ? null : 'review status is blocked')
      : 'review.md must end with exactly one status: pass|blocked line',
  };
}

function checkTaskFormat(ctx, change) {
  const file = applyFiles(ctx, change)[0];
  const text = readText(file);
  const checkboxLines = text.split(/\r?\n/).filter((line) => /^-\s+\[[ xX]\]/.test(line));
  const tasks = checkboxLines.filter((line) => /^-\s+\[[ xX]\]\s+\d+\.\d+\s+\S/.test(line));
  const malformed = checkboxLines.filter((line) => !tasks.includes(line));
  return {
    id: 'gate:task-format',
    ok: tasks.length > 0 && malformed.length === 0,
    value: tasks.length,
    malformed,
    message: tasks.length === 0
      ? 'tasks.md must contain checkbox tasks like - [ ] 1.1 ...'
      : (malformed.length ? 'all checkbox tasks must use - [ ] X.Y description format' : null),
  };
}

function checkApply(ctx, change) {
  const tasksFile = applyFiles(ctx, change)[0];
  const text = readText(tasksFile);
  const taskLines = text.split(/\r?\n/).filter((line) => /^-\s+\[[ xX]\]\s+\d+\.\d+\s+\S/.test(line));
  const unchecked = taskLines.filter((line) => /^-\s+\[\s\]/.test(line));
  return {
    id: 'gate:apply',
    ok: taskLines.length > 0 && unchecked.length === 0,
    value: { tasks: taskLines.length, unchecked: unchecked.length },
    message: taskLines.length === 0
      ? 'tasks.md must contain implementation tasks'
      : (unchecked.length ? 'all implementation tasks must be checked' : null),
  };
}

function checkVerify(ctx, change, options = {}) {
  const verifyFile = verifyResultFile(ctx, change);
  const verify = readJsonIfExists(verifyFile);
  const verifyOk = options.requireSubagent
    ? Boolean(verify && verify.status === 'pass')
    : Boolean(verify && (verify.ok === true || verify.status === 'pass' || verify.result === 'pass'));
  const subagentResult = options.requireSubagent
    ? validateVerifySubagentResult(ctx, change, verifyFile, verify)
    : { ok: true, errors: [] };
  return {
    id: 'gate:verify',
    ok: verifyOk && subagentResult.ok,
    value: {
      verifyOk,
      ...(options.requireSubagent ? { subagentResultValid: subagentResult.ok } : {}),
    },
    message: !subagentResult.ok
      ? `verify-result.json invalid subagent result: ${subagentResult.errors.join(', ')}`
      : (verifyOk ? null : 'verify-result.json must contain ok=true or status/result=pass'),
  };
}

function checkApplyVerify(ctx, change) {
  const apply = checkApply(ctx, change);
  const verify = checkVerify(ctx, change, { requireSubagent: false });
  return {
    id: 'gate:apply-verify',
    ok: apply.ok && verify.ok,
    value: {
      tasks: apply.value.tasks,
      unchecked: apply.value.unchecked,
      verifyOk: verify.value.verifyOk,
    },
    message: apply.message || verify.message,
  };
}

function checkArchiveComplete(ctx, change) {
  const node = readNodeResult(ctx, change, 'archive');
  return {
    id: 'gate:archive-complete',
    ok: Boolean(node && node.ok),
    value: node ? node.files : [],
    message: node && node.ok ? null : 'archive node result missing',
  };
}

function hashInputsForStage(ctx, change, stage) {
  const out = {};
  const artifactIds = new Set();
  for (const artifactId of stage.artifacts || []) {
    const artifact = findArtifact(ctx, artifactId);
    for (const dep of artifact && artifact.requires ? artifact.requires : []) artifactIds.add(dep);
  }
  for (const depStage of stage.requires || []) {
    const prev = ctx.workflow.stages[depStage];
    for (const artifactId of (prev && prev.artifacts) || []) artifactIds.add(artifactId);
    for (const actionId of (prev && prev.actions) || []) artifactIds.add(actionId);
  }
  for (const id of artifactIds) out[id] = hashEntity(ctx, change, id);
  return out;
}

function hashOutputsForStage(ctx, change, stage) {
  const out = {};
  for (const artifactId of stage.artifacts || []) out[artifactId] = hashEntity(ctx, change, artifactId);
  for (const actionId of stage.actions || []) out[actionId] = hashEntity(ctx, change, actionId);
  return out;
}

function hashEntity(ctx, change, id) {
  let files = [];
  if (findArtifact(ctx, id)) files = artifactFiles(ctx, change, id);
  else if (id === 'apply') files = applyFiles(ctx, change);
  else if (id === 'verify') {
    files = [
      verifyProfileFile(ctx, change),
      verifyResultFile(ctx, change),
    ];
  }
  else if (id === 'archive') {
    const node = readNodeResult(ctx, change, 'archive');
    files = node && Array.isArray(node.absoluteFiles) ? node.absoluteFiles : [];
  }
  return hashFiles(files);
}

function applyFiles(ctx, change) {
  const activeTasks = path.join(changeDir(ctx, change), 'tasks.md');
  if (fs.existsSync(activeTasks)) return [activeTasks];
  const archived = archivedChangeDir(ctx, change);
  return archived ? [path.join(archived, 'tasks.md')] : [activeTasks];
}

function artifactFiles(ctx, change, artifactId) {
  const artifact = findArtifact(ctx, artifactId);
  if (!artifact) return [];
  const base = artifactBaseDir(ctx, change);
  const generates = artifact.generates || '';
  if (generates.includes('**')) {
    const dir = path.join(base, generates.split('/**')[0]);
    return listFiles(dir).filter((file) => file.endsWith('.md'));
  }
  if (generates.includes('*')) {
    const dir = path.join(base, path.dirname(generates));
    const suffix = path.basename(generates).replace('*', '');
    return listFiles(dir).filter((file) => file.endsWith(suffix));
  }
  const file = path.join(base, generates);
  return fs.existsSync(file) ? [file] : [];
}

function artifactBaseDir(ctx, change) {
  const active = changeDir(ctx, change);
  if (fs.existsSync(active)) return active;
  return archivedChangeDir(ctx, change) || active;
}

function archivedChangeDir(ctx, change) {
  const node = readNodeResult(ctx, change, 'archive');
  const candidates = [];
  if (node && Array.isArray(node.absoluteFiles)) candidates.push(...node.absoluteFiles);
  const archiveRoot = path.join(ctx.openspecDir, 'changes', 'archive');
  if (fs.existsSync(archiveRoot)) {
    const suffix = `-${change}`;
    for (const entry of fs.readdirSync(archiveRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith(suffix)) {
        candidates.push(path.join(archiveRoot, entry.name));
      }
    }
  }
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isDirectory()) || null;
}

function isChangeArchived(ctx, change) {
  const node = readNodeResult(ctx, change, 'archive');
  return Boolean(
    node &&
    node.ok === true &&
    archivedChangeDir(ctx, change)
  );
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

function hashFiles(files) {
  const existing = expandHashFiles(files).sort();
  if (!existing.length) return null;
  const h = crypto.createHash('sha256');
  for (const file of existing) {
    h.update(path.resolve(file));
    h.update('\0');
    h.update(fs.readFileSync(file));
    h.update('\0');
  }
  return `sha256:${h.digest('hex')}`;
}

function expandHashFiles(files) {
  const out = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    if (stat.isDirectory()) out.push(...listFiles(file));
    else if (stat.isFile()) out.push(file);
  }
  return out;
}

function isCheckStale(ctx, change, check) {
  if (check.stale === true) return check.staleReason || 'stage invalidated by change';
  const stage = ctx.workflow.stages[check.stage];
  if (!stage) return 'stage removed from schema';
  const inputs = hashInputsForStage(ctx, change, stage);
  const outputs = hashOutputsForStage(ctx, change, stage);
  for (const [key, value] of Object.entries(check.inputs || {})) {
    if (inputs[key] !== value) return `input ${key} changed`;
  }
  for (const [key, value] of Object.entries(check.outputs || {})) {
    if (outputs[key] !== value) return `output ${key} changed`;
  }
  return false;
}

function writeNodeResult(ctx, change, stage, node, files, options = {}) {
  const absoluteFiles = files.map((file) => path.resolve(ctx.projectRoot, file));
  const resolved = absoluteFiles.filter((file) => fs.existsSync(file));
  const ok = absoluteFiles.length > 0 && resolved.length === absoluteFiles.length && resolved.every(pathExistsNonEmpty);
  const result = {
    stage,
    node,
    ok,
    files: absoluteFiles.map((file) => relative(ctx.projectRoot, file)),
    absoluteFiles,
    hash: hashFiles(resolved),
    updated_at: new Date().toISOString(),
  };
  const dir = options.verifyAudit
    ? path.join(verifyStateDir(ctx, change), 'nodes')
    : path.join(sidecarDir(ctx, change), 'nodes');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${node}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function readNodeResult(ctx, change, node) {
  return readJsonIfExists(path.join(sidecarDir(ctx, change), 'nodes', `${node}.json`));
}

function recordChange(ctx, change, stage, files, artifacts, reason) {
  const declaredArtifacts = normalizeChangeArtifacts(artifacts);
  const inferredArtifacts = files.length ? inferChangedArtifacts(ctx, change, files) : [];
  const changedArtifacts = declaredArtifacts.length
    ? [...new Set([...declaredArtifacts, ...inferredArtifacts])]
    : inferChangedArtifacts(ctx, change, files);
  const stageOrder = new Map(stageEntries(ctx).map((item, index) => [item.id, index]));
  const owningStages = [...new Set(changedArtifacts.map((id) => STALE_STAGE_BY_ARTIFACT[id] || stage || 'coding'))]
    .sort((left, right) => (
      (stageOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (stageOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    ));
  const staleStages = downstreamStages(ctx, owningStages);
  const row = {
    ts: new Date().toISOString(),
    change,
    changedArtifacts,
    changedFiles: files.map((file) => relative(ctx.projectRoot, path.resolve(ctx.projectRoot, file))),
    owningStage: owningStages[0] || stage || 'coding',
    staleStages,
    reason: reason || '方案变更',
  };
  appendJsonl(path.join(sidecarDir(ctx, change), 'changes.jsonl'), row);
  invalidateStageChecks(ctx, change, row);
  return row;
}

function normalizeChangeArtifacts(artifacts) {
  const normalized = artifacts.map((artifact) => String(artifact || '').trim());
  const invalid = normalized.filter((artifact) => !CHANGE_ARTIFACTS.has(artifact));
  if (invalid.length) {
    throw new Error(
      `[mobile-spec] --artifact 仅支持 ${[...CHANGE_ARTIFACTS].join(' / ')}，收到：${invalid.join(', ')}`,
    );
  }
  return [...new Set(normalized)];
}

function invalidateStageChecks(ctx, change, row) {
  for (const stage of row.staleStages) {
    const check = readCheck(ctx, change, stage);
    if (!check) continue;
    writeCheck(ctx, change, stage, {
      ...check,
      stale: true,
      staleReason: `change recorded for ${row.changedArtifacts.join(', ')}`,
      invalidated_at: row.ts,
    });
  }
}

function inferChangedArtifacts(ctx, change, files) {
  if (!files.length) return ['code'];
  const dir = changeDir(ctx, change);
  const out = new Set();
  for (const file of files) {
    const abs = path.resolve(ctx.projectRoot, file);
    const relToChange = relative(dir, abs);
    if (relToChange === 'proposal.md') out.add('proposal');
    else if (relToChange.startsWith(`specs${path.sep}`) || relToChange.startsWith('specs/')) out.add('specs');
    else if (relToChange === 'design.md') out.add('design');
    else if (relToChange === 'review.md') out.add('review');
    else if (relToChange === 'tasks.md') out.add('tasks');
    else out.add('code');
  }
  return [...out];
}

function downstreamStages(ctx, owningStages) {
  const entries = stageEntries(ctx);
  const selected = new Set();
  let changed = true;
  for (const stage of owningStages) selected.add(stage);
  while (changed) {
    changed = false;
    for (const stage of entries) {
      if (selected.has(stage.id)) continue;
      if ((stage.requires || []).some((dep) => selected.has(dep))) {
        selected.add(stage.id);
        changed = true;
      }
    }
  }
  return entries.filter((stage) => selected.has(stage.id)).map((stage) => stage.id);
}

function resolveAgentActions(ctx, hook, envelope) {
  const configured = ctx.workflow.hookConfig && ctx.workflow.hookConfig[hook] && ctx.workflow.hookConfig[hook].agentActions;
  if (!Array.isArray(configured)) return [];
  return configured.map((action) => {
    const copy = { ...action };
    if (copy.skillByPlatform) {
      copy.skill = copy.skillByPlatform[ctx.platform] || copy.skillByPlatform.native || copy.skillByPlatform.default || null;
      delete copy.skillByPlatform;
    }
    copy.inputs = { ...(copy.inputs || {}), change: envelope.change, stage: envelope.stage, platform: ctx.platform };
    if (envelope.deterministic) copy.inputs.deterministic = envelope.deterministic;
    return copy;
  }).filter((action) => action.skill || action.type !== 'skill');
}

function normalizeVerifyFailureClass(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'implementation') return 'implementation';
  if (normalized === 'environment') return 'environment';
  if (normalized === 'requirements') return 'requirements';
  if (normalized === 'none') return 'none';
  return 'unclassified';
}

function normalizeVerifyCapabilities(capabilities) {
  if (Array.isArray(capabilities)) return capabilities;
  if (!capabilities || typeof capabilities !== 'object') return [];
  return VERIFY_CAPABILITY_IDS
    .filter((id) => capabilities[id] && typeof capabilities[id] === 'object')
    .map((id) => ({ id, ...capabilities[id] }));
}

function isVerifySubagentExecutor(executor) {
  if (executor === 'subagent') return true;
  if (!executor || typeof executor !== 'object') return false;
  const role = String(executor.role || executor.type || executor.executor || '').toLowerCase();
  return role.includes('subagent');
}

function effectiveVerifyRepairAttempt(result, resultProfile) {
  if (Number.isInteger(result.repairAttempt)) return result.repairAttempt;
  if (resultProfile && Number.isInteger(resultProfile.repairAttempt)) {
    return resultProfile.repairAttempt;
  }
  return null;
}

function validateVerifySubagentResult(ctx, change, verifyResultFile, verifyResult) {
  const result = verifyResult && typeof verifyResult === 'object' ? verifyResult : {};
  const status = String(result.status || '').trim().toLowerCase();
  const failureClass = normalizeVerifyFailureClass(result.failureClass);
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const blockingFindings = findings.filter((finding) => finding && finding.blocking === true);
  const errors = [];
  const storedProfile = readJsonIfExists(verifyProfileFile(ctx, change));
  const resultProfile = result.verificationProfile;
  const repairAttempt = effectiveVerifyRepairAttempt(result, resultProfile);
  if (!String(result.runId || '').trim()) errors.push('runId missing');
  if (!String(result.invocationId || '').trim()) errors.push('invocationId missing');
  if (!Number.isInteger(repairAttempt) || repairAttempt < 0) {
    errors.push('repairAttempt invalid');
  }
  if (!isVerifySubagentExecutor(result.executor)) errors.push('executor must be subagent');
  if (path.resolve(String(result.outputPath || '')) !== path.resolve(verifyResultFile)) {
    errors.push('outputPath mismatch');
  }
  if (!Array.isArray(result.changedProductFiles) || result.changedProductFiles.length !== 0) {
    errors.push('changedProductFiles must be empty');
  }
  if (!Array.isArray(result.findings)) errors.push('findings must be an array');
  if (!['pass', 'fail'].includes(status)) errors.push('status must be pass or fail');
  if (Object.hasOwn(result, 'ok') && result.ok !== (status === 'pass')) {
    errors.push('ok conflicts with status');
  }
  if (Object.hasOwn(result, 'result') &&
    String(result.result || '').trim().toLowerCase() !== status) {
    errors.push('result conflicts with status');
  }
  if (status === 'pass' && failureClass !== 'none') errors.push('pass requires failureClass none');
  if (status === 'pass' && blockingFindings.length > 0) errors.push('pass cannot contain blocking findings');
  if (status === 'fail' && !['implementation', 'environment', 'requirements'].includes(failureClass)) {
    errors.push('fail requires a supported failureClass');
  }
  if (status === 'fail' && blockingFindings.length === 0) errors.push('fail requires blocking findings');
  if (!storedProfile || typeof storedProfile !== 'object') {
    errors.push('verify-profile.json missing');
  }
  if (!resultProfile || typeof resultProfile !== 'object') {
    errors.push('verificationProfile missing');
  } else {
    if (result.invocationId !== resultProfile.invocationId) {
      errors.push('invocationId conflicts with verificationProfile');
    }
    if (repairAttempt !== resultProfile.repairAttempt) {
      errors.push('repairAttempt conflicts with verificationProfile');
    }
    if (storedProfile && canonicalJson(storedProfile) !== canonicalJson(resultProfile)) {
      errors.push('verificationProfile must match verify-profile.json');
    }
    errors.push(...validateVerifyProfile(ctx, change, resultProfile, result.runId));
  }
  errors.push(...validateVerifyCapabilityResults(resultProfile, result.capabilityResults, status, result.commands));
  const findingIds = [];
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object') {
      errors.push('finding must be an object');
      continue;
    }
    const id = String(finding.id || '').trim();
    if (!id) errors.push('finding id missing');
    else findingIds.push(id);
    if (typeof finding.blocking !== 'boolean') errors.push(`finding ${id || '<unknown>'} blocking must be boolean`);
    const findingClass = normalizeVerifyFailureClass(finding.failureClass);
    if (!['implementation', 'environment', 'requirements', 'none'].includes(findingClass)) {
      errors.push(`finding ${id || '<unknown>'} failureClass invalid`);
    }
    if (finding.blocking === true && findingClass === 'none') {
      errors.push(`blocking finding ${id || '<unknown>'} requires a failureClass`);
    }
    if (!String(finding.evidence || '').trim()) errors.push(`finding ${id || '<unknown>'} evidence missing`);
    if (!Array.isArray(finding.affectedFiles) || !finding.affectedFiles.every(isSafeProjectRelativePath)) {
      errors.push(`finding ${id || '<unknown>'} affectedFiles must contain project-relative paths`);
    }
  }
  if (new Set(findingIds).size !== findingIds.length) errors.push('finding ids must be unique');
  return { ok: errors.length === 0, errors };
}

function validateVerifyProfile(ctx, change, profile, runId) {
  const errors = [];
  const invocation = readVerifyInvocation(ctx, change);
  const mode = String(profile.mode || '').trim().toLowerCase();
  const riskLevel = String(profile.riskLevel || '').trim().toLowerCase();
  const fullReasons = Array.isArray(profile.fullVerificationReasons)
    ? profile.fullVerificationReasons.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const capabilities = normalizeVerifyCapabilities(profile.capabilities);
  if (profile.policyVersion !== VERIFY_PROFILE_VERSION) {
    errors.push(`verificationProfile policyVersion must be ${VERIFY_PROFILE_VERSION}`);
  }
  if (!String(profile.runId || '').trim() || profile.runId !== runId) {
    errors.push('verificationProfile runId mismatch');
  }
  if (!invocation || typeof invocation !== 'object') {
    errors.push('active verify invocation missing');
  } else {
    if (profile.invocationId !== invocation.invocationId) {
      errors.push('verificationProfile invocationId mismatch');
    }
    if (!Number.isInteger(profile.repairAttempt) || profile.repairAttempt !== invocation.repairAttempts) {
      errors.push('verificationProfile repairAttempt mismatch');
    }
    const lastRun = Array.isArray(invocation.runs) ? invocation.runs.at(-1) : null;
    if (
      lastRun &&
      lastRun.repairAttempt < invocation.repairAttempts &&
      profile.runId === lastRun.runId
    ) {
      errors.push('verificationProfile runId must change after repair');
    }
  }
  if (profile.selectedBy !== 'coordinator') {
    errors.push('verificationProfile selectedBy must be coordinator');
  }
  if (mode !== 'initial') {
    errors.push('verificationProfile mode must be initial');
  }
  if (!['low', 'medium', 'high', 'unknown'].includes(riskLevel)) {
    errors.push('verificationProfile riskLevel invalid');
  }
  if (!Array.isArray(profile.fullVerificationReasons) ||
    profile.fullVerificationReasons.length !== fullReasons.length) {
    errors.push('fullVerificationReasons must contain non-empty strings');
  }
  if (new Set(fullReasons).size !== fullReasons.length) {
    errors.push('fullVerificationReasons must be unique');
  }
  if (fullReasons.some((reason) => !VERIFY_FULL_VERIFICATION_TRIGGERS.includes(reason))) {
    errors.push('fullVerificationReasons contains unsupported trigger');
  }
  if (['high', 'unknown'].includes(riskLevel) && fullReasons.length === 0) {
    errors.push(`${riskLevel} risk requires fullVerificationReasons`);
  }
  const capabilityIds = capabilities.map((item) => item && item.id);
  if (capabilities.length !== VERIFY_CAPABILITY_IDS.length ||
    !VERIFY_CAPABILITY_IDS.every((id) => capabilityIds.includes(id)) ||
    new Set(capabilityIds).size !== capabilityIds.length) {
    errors.push(`verificationProfile capabilities must be ${VERIFY_CAPABILITY_IDS.join(', ')}`);
  }
  const forceFull = (
    ['high', 'unknown'].includes(riskLevel) ||
    fullReasons.length > 0
  );
  for (const capability of capabilities) {
    if (!capability || typeof capability !== 'object') continue;
    const id = capability.id;
    const selection = String(capability.selection || '').trim().toLowerCase();
    const scope = String(capability.scope || '').trim().toLowerCase();
    const targets = Array.isArray(capability.targets)
      ? capability.targets.filter((item) => typeof item === 'string' && item.trim())
      : [];
    if (!VERIFY_CAPABILITY_IDS.includes(id)) continue;
    if (!['required', 'targeted', 'n-a'].includes(selection)) {
      errors.push(`verificationProfile ${id} selection invalid`);
    }
    if (!['full', 'affected', 'none'].includes(scope)) {
      errors.push(`verificationProfile ${id} scope invalid`);
    }
    if (!String(capability.reason || '').trim()) {
      errors.push(`verificationProfile ${id} reason missing`);
    }
    if (!Array.isArray(capability.targets) || capability.targets.length !== targets.length) {
      errors.push(`verificationProfile ${id} targets must contain non-empty strings`);
    }
    if (selection === 'n-a') {
      if (id !== 'automated-checks') errors.push(`${id} cannot be n-a`);
      if (scope !== 'none' || targets.length !== 0) {
        errors.push(`verificationProfile ${id} n-a requires scope none and empty targets`);
      }
    } else if (scope === 'none' || targets.length === 0) {
      errors.push(`verificationProfile ${id} selected capability requires scope and targets`);
    }
    if (selection === 'targeted' && scope !== 'affected') {
      errors.push(`verificationProfile ${id} targeted selection requires affected scope`);
    }
    if (id === 'ai-cr') {
      if (selection !== 'required') errors.push('ai-cr must be required');
      if (scope !== 'full') errors.push('initial ai-cr must use full scope');
    }
    if (id === 'spec-scenarios') {
      if (selection !== 'required') errors.push('spec-scenarios must be required');
      if (!['affected', 'full'].includes(scope)) {
        errors.push('spec-scenarios must use affected or full scope');
      }
    }
    if (forceFull && (selection !== 'required' || scope !== 'full')) {
      errors.push(`verificationProfile ${id} must use required/full for full verification`);
    }
  }
  return errors;
}

function validateVerifyCapabilityResults(profile, capabilityResults, overallStatus, topLevelCommands = []) {
  const errors = [];
  const planned = profile ? normalizeVerifyCapabilities(profile.capabilities) : [];
  const results = Array.isArray(capabilityResults) ? capabilityResults : [];
  const resultIds = results.map((item) => item && item.id);
  if (results.length !== VERIFY_CAPABILITY_IDS.length ||
    !VERIFY_CAPABILITY_IDS.every((id) => resultIds.includes(id)) ||
    new Set(resultIds).size !== resultIds.length) {
    errors.push(`capabilityResults must be ${VERIFY_CAPABILITY_IDS.join(', ')}`);
  }
  const scopeRank = { none: 0, affected: 1, full: 2 };
  for (const result of results) {
    if (!result || typeof result !== 'object' || !VERIFY_CAPABILITY_IDS.includes(result.id)) continue;
    const status = String(result.status || '').trim().toLowerCase();
    const scope = String(result.scope || '').trim().toLowerCase();
    const evidence = Array.isArray(result.evidence)
      ? result.evidence.filter((item) => typeof item === 'string' && item.trim())
      : [];
    const plan = planned.find((item) => item && item.id === result.id);
    if (!['pass', 'fail', 'n-a'].includes(status)) {
      errors.push(`capabilityResult ${result.id} status invalid`);
    }
    if (!Object.hasOwn(scopeRank, scope)) {
      errors.push(`capabilityResult ${result.id} scope invalid`);
    }
    if (!Array.isArray(result.evidence) || result.evidence.length !== evidence.length || evidence.length === 0) {
      errors.push(`capabilityResult ${result.id} evidence missing`);
    }
    if (status === 'n-a') {
      if (!plan || plan.selection !== 'n-a') {
        errors.push(`capabilityResult ${result.id} cannot downgrade to n-a`);
      }
      if (scope !== 'none') errors.push(`capabilityResult ${result.id} n-a requires scope none`);
      if (Array.isArray(result.commands) && result.commands.length > 0) {
        errors.push(`capabilityResult ${result.id} n-a cannot contain commands`);
      }
    } else if (scope === 'none') {
      errors.push(`capabilityResult ${result.id} executed capability requires scope`);
    } else if (plan && Object.hasOwn(scopeRank, scope) &&
      scopeRank[scope] < scopeRank[plan.scope]) {
      errors.push(`capabilityResult ${result.id} cannot reduce planned scope`);
    }
    const commands = Array.isArray(result.commands) ? result.commands : [];
    const effectiveCommands = (
      result.id === 'automated-checks' &&
      commands.length === 0 &&
      Array.isArray(topLevelCommands)
    ) ? topLevelCommands : commands;
    if (result.id === 'automated-checks' && status !== 'n-a') {
      if ((!Array.isArray(result.commands) || commands.length === 0) &&
        (!Array.isArray(topLevelCommands) || topLevelCommands.length === 0)) {
        errors.push('automated-checks result requires commands');
      }
      for (const command of effectiveCommands) {
        const commandStatus = String(command && command.status || '').trim().toLowerCase();
        if (!command || typeof command !== 'object' || !String(command.command || '').trim()) {
          errors.push('automated-checks command missing');
          continue;
        }
        if (!['pass', 'fail'].includes(commandStatus)) {
          errors.push(`automated-checks command ${command.command} status invalid`);
        }
        if (!Object.hasOwn(command, 'exitCode')) {
          errors.push(`automated-checks command ${command.command} exitCode missing`);
        } else if (command.exitCode !== null && !Number.isInteger(command.exitCode)) {
          errors.push(`automated-checks command ${command.command} exitCode invalid`);
        } else if (Number.isInteger(command.exitCode) &&
          commandStatus === 'pass' &&
          command.exitCode !== 0) {
          errors.push(`automated-checks command ${command.command} pass requires exitCode 0`);
        } else if (Number.isInteger(command.exitCode) &&
          commandStatus === 'fail' &&
          command.exitCode === 0) {
          errors.push(`automated-checks command ${command.command} fail cannot use exitCode 0`);
        }
        if (!String(command.evidence || '').trim()) {
          errors.push(`automated-checks command ${command.command} evidence missing`);
        }
      }
      if (status === 'pass' && effectiveCommands.some((command) => (
        String(command && command.status || '').trim().toLowerCase() === 'fail'
      ))) {
        errors.push('automated-checks pass conflicts with failed command');
      }
      if (status === 'fail' && !effectiveCommands.some((command) => (
        String(command && command.status || '').trim().toLowerCase() === 'fail'
      ))) {
        errors.push('automated-checks fail requires a failed command');
      }
    }
  }
  const failedCapabilities = results.filter((item) => item && item.status === 'fail');
  if (overallStatus === 'pass' && failedCapabilities.length > 0) {
    errors.push('pass cannot contain failed capabilityResults');
  }
  if (overallStatus === 'fail' && failedCapabilities.length === 0) {
    errors.push('fail requires a failed capabilityResult');
  }
  return errors;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSafeProjectRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value.trim());
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

function monitorValidateFiles(ctx, change, node, files) {
  const artifact = MONITOR_ARTIFACT_BY_NODE[node];
  if (!artifact) return [];
  const requirement = monitorRequirement(ctx, change);
  return files
    .map((file) => path.resolve(ctx.projectRoot, file))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .map((file) => runMonitor(ctx, ['validate', artifact, '--file', file, '--requirement', requirement]));
}

function runMonitor(ctx, args) {
  if (process.env.MOBILE_SPEC_WORKFLOW_SKIP_MONITOR === '1') {
    return { ok: true, skipped: true, reason: 'MOBILE_SPEC_WORKFLOW_SKIP_MONITOR=1', args };
  }
  const bin = path.resolve(__dirname, '..', '..', 'bin', 'mobile-spec.js');
  const result = spawnSync(process.execPath, [bin, 'monitor', ...args], {
    cwd: ctx.projectRoot,
    env: { ...process.env },
    encoding: 'utf8',
  });
  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const emitFailed = /(?:^|\n)EVAL_EMIT_FAILED\b/.test(stdout);
  const emitSucceeded = /(?:^|\n)EVAL_EMIT_COMMAND_SUCCEEDED\b/.test(stdout);
  return {
    ok: result.status === 0,
    emitOk: emitFailed ? false : (emitSucceeded ? true : null),
    status: result.status,
    args,
    stdout,
    stderr,
  };
}

function readCurrent(ctx) {
  const file = currentFile(ctx);
  if (!fs.existsSync(file)) return null;
  return yaml.load(fs.readFileSync(file, 'utf8')) || null;
}

function writeCurrent(ctx, current) {
  fs.mkdirSync(path.dirname(currentFile(ctx)), { recursive: true });
  fs.writeFileSync(currentFile(ctx), yaml.dump(current, { lineWidth: 120 }), 'utf8');
}

function clearCurrentIfMatch(ctx, change) {
  const current = readCurrent(ctx);
  if (current && current.change === change) fs.rmSync(currentFile(ctx), { force: true });
}

function currentFile(ctx) {
  return getCurrentFile(ctx.projectRoot);
}

function checkFile(ctx, change, stage) {
  return path.join(sidecarDir(ctx, change), 'checks', `${stage}.json`);
}

function readCheck(ctx, change, stage) {
  return readJsonIfExists(checkFile(ctx, change, stage));
}

function writeCheck(ctx, change, stage, check) {
  const file = checkFile(ctx, change, stage);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(check, null, 2)}\n`, 'utf8');
}

function appendEvent(ctx, change, event) {
  appendJsonl(path.join(sidecarDir(ctx, change), 'events.jsonl'), { ts: new Date().toISOString(), change, ...event });
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function hasWorkflowEvent(ctx, change, type) {
  const file = path.join(sidecarDir(ctx, change), 'events.jsonl');
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).some((line) => {
    if (!line.trim()) return false;
    try {
      return JSON.parse(line).type === type;
    } catch {
      return false;
    }
  });
}

function agentActionsFile(ctx, change) {
  return path.join(sidecarDir(ctx, change), 'agent-actions.jsonl');
}

function requirementSourceFile(ctx, change) {
  return path.join(sidecarDir(ctx, change), 'source.json');
}

function writeRequirementSource(ctx, change, source) {
  const file = requirementSourceFile(ctx, change);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...source, capturedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}

function readRequirementSource(ctx, change) {
  return readJsonIfExists(requirementSourceFile(ctx, change));
}

function monitorRequirement(ctx, change) {
  const source = readRequirementSource(ctx, change);
  return (source && source.requirementId) || change;
}

function ensureChangeSidecar(ctx, change) {
  fs.mkdirSync(sidecarDir(ctx, change), { recursive: true });
  fs.mkdirSync(path.join(sidecarDir(ctx, change), 'checks'), { recursive: true });
}

function sidecarDir(ctx, change) {
  return getChangeSidecarDir(ctx.projectRoot, change);
}

function changeDir(ctx, change) {
  return path.join(ctx.openspecDir, 'changes', change);
}

function isNonEmptyFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0;
}

function pathExistsNonEmpty(file) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  if (stat.isDirectory()) return listFiles(file).length > 0;
  return stat.isFile() && stat.size > 0;
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function readJsonIfExists(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function relative(from, to) {
  return path.relative(from, to) || path.basename(to);
}

module.exports = {
  cmdWorkflow,
  parseArgs,
  loadContext,
  normalizeStage,
  buildPlan,
  deriveStatuses,
  runStageCheck,
  commandHook,
  commandCheck,
  commandStatus,
  parseRequirementSources,
};
