"use strict";

/**
 * mobile-spec monitor —— 公司 eval-emit 的薄适配器
 *
 * Mobile Spec 只在 workflow 边界调用公司的五类信号。传输、重试、产物指纹比对和通过/返工
 * 判定均由公司链路负责；本模块不实现 outbox、自动重试或 validate 去重。eval-emit
 * 失败只输出 EVAL_EMIT_FAILED warning，不阻断 SDD workflow；MOBILE_SPEC_EVAL_SKIP=1 可禁用。
 * 本地状态仅用于绑定 requirement、避免明显重复 start，以及为本地看板保留区间。
 *
 * 调用入口统一由 `mobile-spec workflow hook` 持有，stage skill 不直接编排信号。
 *
 * exit code 语义(命令层据此决策):
 *   0 = ok / idempotent skip(PHASE_ALREADY_OPEN / SPEC_ALREADY_OPEN)
 *   1 = 违规(SPEC_NOT_OPEN / UNKNOWN_PHASE / UNKNOWN_ARTIFACT / 参数缺失)
 *   2 = 需用户确认(PHASE_END_CONFIRM_REQUIRED / SESSION_BIND_REQUIRED)—— 用 AskUserQuestion
 *
 * 状态落点:`~/.mobile-spec/monitor/state/`(MOBILE_SPEC_HOME_OVERRIDE 可隔离),与事件落点(项目级)分离:
 * 状态需跨 session 全局唯一(按 repoKey+reqKey 归因),事件是项目级时序流。
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// phase 与 schema.workflow.stages 对齐；artifact 保持公司协议要求的固定枚举。
const PHASE_ORDER = ["propose", "design", "task", "coding", "verify", "archive"];
const ARTIFACTS = new Set(["proposal", "specs", "design", "review", "tasks", "verify"]);
const LEGACY_PHASE_TO_STAGE = {
  new: "propose",
  proposal: "propose",
  specs: "propose",
  review: "design",
  apply: "coding",
};
const EVENT_SOURCE = "mobile-spec-monitor";
const DEFAULT_WORKFLOW = "Mobile Spec";

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** mobile-spec 状态根:~/.mobile-spec/monitor/(MOBILE_SPEC_HOME_OVERRIDE 可重定向,与 register-schema 一致)。 */
function dataRoot() {
  const home = process.env.MOBILE_SPEC_HOME_OVERRIDE || os.homedir();
  return path.join(home, ".mobile-spec", "monitor");
}

function stateRoot() {
  return path.join(dataRoot(), "state");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function repoKey() {
  return sha256(repoRoot()).slice(0, 16);
}

function requirementKey(requirement) {
  return sha256(requirement).slice(0, 24);
}

function repoStateDir() {
  return path.join(stateRoot(), "repos", repoKey());
}

function requirementStatePath(requirement) {
  return path.join(repoStateDir(), "requirements", `${requirementKey(requirement)}.json`);
}

function currentSessionId() {
  return (
    process.env.MOBILE_SPEC_MONITOR_SESSION_ID ||
    process.env.HYPER_MONITOR_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    process.env.CLAUDE_CONVERSATION_ID ||
    process.env.CLAUDE_THREAD_ID ||
    process.env.CODEX_SESSION_ID ||
    process.env.CODEX_THREAD_ID ||
    `repo-${repoKey()}`
  );
}

function sessionStatePath() {
  return path.join(stateRoot(), "sessions", `${sha256(currentSessionId()).slice(0, 24)}.json`);
}

function loadRequirementState(requirement) {
  const state = readJson(requirementStatePath(requirement), null);
  if (!state) return null;
  const phases = {};
  for (const [phase, entries] of Object.entries(state.phases || {})) {
    const stage = LEGACY_PHASE_TO_STAGE[phase] || phase;
    phases[stage] = phases[stage] || [];
    if (Array.isArray(entries)) phases[stage].push(...entries);
  }
  for (const entries of Object.values(phases)) {
    entries.sort((a, b) => String(a.started_at || "").localeCompare(String(b.started_at || "")));
  }
  return {
    ...state,
    current_phase: LEGACY_PHASE_TO_STAGE[state.current_phase] || state.current_phase,
    phases,
  };
}

function saveRequirementState(state) {
  state.repo_root = repoRoot();
  state.repo_key = repoKey();
  state.updated_at = nowIso();
  writeJson(requirementStatePath(state.requirement_id), state);
}

function loadSessionBinding() {
  return readJson(sessionStatePath(), null);
}

function saveSessionBinding(binding) {
  binding.session_id = currentSessionId();
  binding.repo_root = repoRoot();
  binding.repo_key = repoKey();
  binding.updated_at = nowIso();
  writeJson(sessionStatePath(), binding);
}

function listOpenRequirements() {
  const dir = path.join(repoStateDir(), "requirements");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(dir, name), null))
    .filter((state) => state && state.spec_open && !state.spec_ended_at)
    .sort((a, b) => String(a.requirement_id).localeCompare(String(b.requirement_id)));
}

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function printStatus(status, fields = {}) {
  console.log(
    [status, ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)].join(" ")
  );
}

/**
 * 转发给公司 eval-emit(wyc-ai-coding-insight 插件的 wrapper,上报 skillshub 公司平台)。
 * exit 0 只表示本地命令执行成功，不代表中心已经接收、持久化或完成判定。
 * 失败只 warning,绝不阻断 workflow(且事件无本地副本)。
 * MOBILE_SPEC_EVAL_SKIP=1 禁用;eval-emit 不在 PATH 时提示跑 `mobile-spec install-monitor`。
 */
function runEvalEmit(argv) {
  if (process.env.MOBILE_SPEC_EVAL_SKIP === "1") {
    return false;
  }
  try {
    execFileSync("eval-emit", argv, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (error) {
    const detail =
      error && error.code === "ENOENT"
        ? "eval-emit not on PATH (run `mobile-spec install-monitor` to install wyc-ai-coding-insight)"
        : (error && error.message) || String(error);
    printStatus("EVAL_EMIT_FAILED", { event: argv[0] || "", detail });
    return false;
  }
}

/**
 * 事件出口(纯公司):只转发 eval-emit 上报 skillshub;无本地副本。
 * 接收 argv。失败只 warning,不阻断 workflow(且事件无副本)。
 * observe 被动兜底事件协议不匹配 eval-emit,仍由 observe.js 独立落本地。
 */
function emitEvent(argv) {
  const event = argv[0] || "";
  printStatus("EVENT_EMIT_START", { event, args: argv.slice(1).join(" ") });
  const ok = runEvalEmit(argv);
  if (ok) printStatus("EVAL_EMIT_COMMAND_SUCCEEDED", { event });
  return ok;
}

function resolveRequirement(parsed) {
  if (parsed.requirement) return parsed.requirement;
  const binding = loadSessionBinding();
  if (binding && binding.recording === false) {
    printStatus("SESSION_RECORDING_DISABLED");
    return null;
  }
  if (binding && binding.recording && binding.requirement_id) {
    return binding.requirement_id;
  }
  printStatus("SESSION_BIND_REQUIRED", { session_id: currentSessionId() });
  const open = listOpenRequirements();
  for (const item of open) {
    printStatus("OPEN_REQUIREMENT", {
      requirement: item.requirement_id,
      current_phase: item.current_phase || "",
    });
  }
  process.exitCode = 2;
  return undefined;
}

function ensureRecording(parsed) {
  const requirement = resolveRequirement(parsed);
  if (requirement === null) {
    printStatus("RECORDING_DISABLED");
    return null;
  }
  return requirement;
}

function getPhaseIndex(phase) {
  return PHASE_ORDER.indexOf(phase);
}

function lastPhaseEntry(state, phase) {
  const entries = state.phases && state.phases[phase];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries[entries.length - 1];
}

function commandBindSession(args) {
  const parsed = parseArgs(args);
  if (parsed.none) {
    saveSessionBinding({ recording: false, reason: "unrelated", bound_at: nowIso() });
    printStatus("SESSION_RECORDING_DISABLED");
    return;
  }

  if (parsed.requirement) {
    const state = loadRequirementState(parsed.requirement);
    if (!state || !state.spec_open || state.spec_ended_at) {
      printStatus("UNKNOWN_OPEN_REQUIREMENT", { requirement: parsed.requirement });
      process.exitCode = 1;
      return;
    }
    saveSessionBinding({
      recording: true,
      requirement_id: parsed.requirement,
      bound_at: nowIso(),
    });
    printStatus("SESSION_BOUND", { requirement: parsed.requirement });
    return;
  }

  const binding = loadSessionBinding();
  if (binding && binding.recording === false) {
    printStatus("SESSION_RECORDING_DISABLED");
    return;
  }
  if (binding && binding.recording && binding.requirement_id) {
    printStatus("SESSION_ALREADY_BOUND", { requirement: binding.requirement_id });
    return;
  }

  const open = listOpenRequirements();
  if (open.length === 0) {
    printStatus("NO_OPEN_REQUIREMENTS");
    return;
  }

  printStatus("SESSION_BIND_REQUIRED", { count: open.length });
  for (const item of open) {
    printStatus("OPEN_REQUIREMENT", {
      requirement: item.requirement_id,
      current_phase: item.current_phase || "",
    });
  }
  process.exitCode = 2;
}

function commandSpecStart(args) {
  const parsed = parseArgs(args);
  const requirement = parsed.requirement;
  if (!requirement) {
    console.error("spec.start requires --requirement <id>");
    process.exitCode = 1;
    return;
  }

  const existing = loadRequirementState(requirement);
  if (existing && existing.spec_open && !existing.spec_ended_at) {
    saveSessionBinding({ recording: true, requirement_id: requirement, bound_at: nowIso() });
    printStatus("SPEC_ALREADY_OPEN", { requirement, eval_emit: "skipped" });
    return;
  }
  if (existing && existing.spec_ended_at) {
    printStatus("SPEC_ALREADY_ENDED", { requirement, eval_emit: "skipped" });
    process.exitCode = 1;
    return;
  }

  const workflow = parsed.workflow || DEFAULT_WORKFLOW;
  emitEvent(["spec.start", "--workflow", workflow, "--requirement", requirement]);
  const state = {
    requirement_id: requirement,
    spec_open: true,
    spec_started_at: nowIso(),
    spec_ended_at: null,
    current_phase: null,
    phase_started_at: null,
    phases: {},
    last_validates: {},
  };
  saveRequirementState(state);
  saveSessionBinding({ recording: true, requirement_id: requirement, bound_at: nowIso() });
  printStatus("SPEC_STARTED", { requirement });
}

function commandPhaseStart(phase, args) {
  const parsed = parseArgs(args);
  const requirement = ensureRecording(parsed);
  if (requirement === undefined || requirement === null) return;

  const state = loadRequirementState(requirement);
  if (!state || !state.spec_open || state.spec_ended_at) {
    printStatus("SPEC_NOT_OPEN", { requirement });
    process.exitCode = 1;
    return;
  }

  const phaseIndex = getPhaseIndex(phase);
  if (phaseIndex === -1) {
    printStatus("UNKNOWN_PHASE", { phase });
    process.exitCode = 1;
    return;
  }

  if (state.current_phase) {
    if (state.current_phase === phase) {
      printStatus("PHASE_ALREADY_OPEN", { requirement, phase, eval_emit: "skipped" });
      return;
    }
    printStatus("PHASE_END_CONFIRM_REQUIRED", {
      requirement,
      current_phase: state.current_phase,
      requested_phase: phase,
    });
    process.exitCode = 2;
    return;
  }

  emitEvent(["phase.start", "--phase", phase]);
  const at = nowIso();
  state.current_phase = phase;
  state.phase_started_at = at;
  state.phases = state.phases || {};
  state.phases[phase] = state.phases[phase] || [];
  state.phases[phase].push({ started_at: at, ended_at: null });
  saveRequirementState(state);
  printStatus("PHASE_STARTED", { requirement, phase });
}

function commandPhaseEnd(phase, args) {
  const parsed = parseArgs(args);
  const requirement = ensureRecording(parsed);
  if (requirement === undefined || requirement === null) return;

  const state = loadRequirementState(requirement);
  if (!state || !state.spec_open || state.spec_ended_at) {
    printStatus("SPEC_NOT_OPEN", { requirement });
    process.exitCode = 1;
    return;
  }
  if (state.current_phase !== phase) {
    printStatus("PHASE_END_MISMATCH", {
      requirement,
      current_phase: state.current_phase || "",
      requested_phase: phase,
    });
    process.exitCode = 1;
    return;
  }

  emitEvent(["phase.end", "--phase", phase]);
  const at = nowIso();
  const entry = lastPhaseEntry(state, phase);
  if (entry) entry.ended_at = at;
  state.current_phase = null;
  state.phase_started_at = null;
  saveRequirementState(state);
  printStatus("PHASE_ENDED", { requirement, phase });
}

function commandValidate(artifact, args) {
  const parsed = parseArgs(args);
  const requirement = ensureRecording(parsed);
  if (requirement === undefined || requirement === null) return;
  if (!artifact) {
    console.error("validate requires an artifact name");
    process.exitCode = 1;
    return;
  }
  if (!ARTIFACTS.has(artifact)) {
    printStatus("UNKNOWN_ARTIFACT", { artifact });
    process.exitCode = 1;
    return;
  }
  if (!parsed.file) {
    console.error("validate requires --file <path>");
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(process.cwd(), parsed.file);
  if (!fs.existsSync(file)) {
    printStatus("VALIDATE_FILE_NOT_FOUND", { artifact, file });
    process.exitCode = 1;
    return;
  }

  const state = loadRequirementState(requirement);
  if (!state || !state.spec_open || state.spec_ended_at) {
    printStatus("SPEC_NOT_OPEN", { requirement });
    process.exitCode = 1;
    return;
  }

  state.last_validates = state.last_validates || {};
  emitEvent(["validate", "--artifact", artifact, "--file", file]);
  const legacy = state.last_validates[artifact];
  if (legacy && legacy.content_hash) {
    state.last_validates[artifact] = { [legacy.file]: legacy };
  } else {
    state.last_validates[artifact] = legacy || {};
  }
  state.last_validates[artifact][file] = {
    file,
    reported_at: nowIso(),
  };
  saveRequirementState(state);
  printStatus("VALIDATE_REPORTED", { requirement, artifact });
}

function commandSpecEnd(args) {
  const parsed = parseArgs(args);
  const requirement = ensureRecording(parsed);
  if (requirement === undefined || requirement === null) return;

  const state = loadRequirementState(requirement);
  if (!state || !state.spec_open || state.spec_ended_at) {
    printStatus("SPEC_NOT_OPEN", { requirement });
    process.exitCode = 1;
    return;
  }
  if (state.current_phase) {
    printStatus("PHASE_END_CONFIRM_REQUIRED", {
      requirement,
      current_phase: state.current_phase,
      requested_phase: "spec.end",
    });
    process.exitCode = 2;
    return;
  }

  emitEvent(["spec.end"]);
  state.spec_open = false;
  state.spec_ended_at = nowIso();
  saveRequirementState(state);
  printStatus("SPEC_ENDED", { requirement });
}

function printHelp() {
  console.log(`
Usage: mobile-spec monitor <command> [options]

Commands:
  bind-session [--requirement <id> | --none]
  spec.start --requirement <id> [--workflow <name>]
  phase.start <propose|design|task|coding|verify|archive> [--requirement <id>]
  phase.end <propose|design|task|coding|verify|archive> [--requirement <id>]
  validate <proposal|specs|design|review|tasks|verify> --file <path> [--requirement <id>]
  spec.end [--requirement <id>]

Exit codes: 0=ok/skipped, 1=violation(not auto-fixed), 2=confirm required(ask user)

Compatibility aliases: spec-start, phase-start, phase-end, spec-end
`);
}

function monitor(args) {
  const command = args[0];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "bind-session") return commandBindSession(args.slice(1));
  if (command === "spec.start" || command === "spec-start") return commandSpecStart(args.slice(1));
  if (command === "phase.start" || command === "phase-start")
    return commandPhaseStart(args[1], args.slice(2));
  if (command === "phase.end" || command === "phase-end")
    return commandPhaseEnd(args[1], args.slice(2));
  if (command === "validate") return commandValidate(args[1], args.slice(2));
  if (command === "spec.end" || command === "spec-end") return commandSpecEnd(args.slice(1));

  console.error(`Unknown monitor command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

module.exports = {
  monitor,
  // 导出便于测试
  parseArgs,
  emitEvent,
  runEvalEmit,
  dataRoot,
  stateRoot,
  repoKey,
  requirementKey,
  requirementStatePath,
  sessionStatePath,
  currentSessionId,
  loadRequirementState,
  loadSessionBinding,
  PHASE_ORDER,
  EVENT_SOURCE,
};
