#!/usr/bin/env node
/**
 * dspec SDD 观察兜底 hook（observe）—— 纯工具级被动观测
 *
 * 定位：**机制强制兜底层**，补全主动埋点（dspec monitor，由 skills 显式调）的漏埋。
 *   - 主动埋点（phase 级）由各 DSpec stage skill 在 phase 边界显式调 `dspec monitor`，
 *     走公司 eval-emit → skillshub（权威骨架）。
 *   - 本 hook 由 Claude Code / Codex hooks 运行时触发，
 *     不依赖 LLM，记工具级/产物级被动事件（source: dspec-observe，落本地 jsonl），
 *     与 monitor 的 phase 级事件互补：消费者用 monitor 的 phase 区间作骨架，用本层事件
 *     验证 / 填充；若本层捕获到关键产物写入但 monitor 无对应 phase 事件 → 漏埋信号。
 *
 * 绝不 block、绝不改 SDD 流程；非 openspec/changes/** 早退；任何异常静默。
 * 数据通路：本地 events.jsonl（SSOT）；可选转发到自建后台——仅当显式设置
 * `DSPEC_OBSERVE_FORWARD_URL` 时，经 curl push（与 monitor 的公司 eval-emit 链路
 * 物理隔离，互不影响）。项目索引见 ~/.dspec/obs/projects.json。
 * DSPEC_VERSION 为占位符，install-hooks.js 拷贝时替换。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const DSPEC_OBSERVE_TAG = 'dspec-observe';
const DSPEC_VERSION = '__DSPEC_VERSION__';
// 默认不上报；显式设置 DSPEC_OBSERVE_FORWARD_URL 才会经 curl push 到自建后台。
// 与 monitor 的公司 eval-emit 链路物理隔离，改这里不影响公司埋点。
const FORWARD_URL = process.env.DSPEC_OBSERVE_FORWARD_URL || '';

// ────────────────────────────── 公共维度 ──────────────────────────────

/**
 * observe 数据根：~/.dspec/obs/（DSPEC_HOME_OVERRIDE 可重定向，与 monitor.js 一致）。
 * 事件不落业务项目，统一放用户级目录，按项目 cwd 哈希分子目录隔离。
 */
function getObsHome() {
  const home = process.env.DSPEC_HOME_OVERRIDE || os.homedir();
  return path.join(home, '.dspec', 'obs');
}

/**
 * 项目 cwd → 稳定短哈希（sha1 前 12 位），用作 observe 子目录名。
 */
function projectHash(cwd) {
  return crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}

function workflowProjectKey(cwd) {
  let root = path.resolve(cwd);
  try {
    root = fs.realpathSync(root);
  } catch {
    /* 使用规范化绝对路径 */
  }
  return crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
}

/**
 * 返回某项目的 observe 目录：~/.dspec/obs/<hash>/，并在 ~/.dspec/obs/projects.json
 * 索引里登记 hash → { cwd, updated_at }（读-改-写，容忍并发追加，不覆盖其他项目）。
 */
function getObsRoot(cwd) {
  const hash = projectHash(cwd);
  registerProject(hash, cwd);
  return path.join(getObsHome(), hash);
}

/**
 * 幂等登记项目索引：~/.dspec/obs/projects.json = { "<hash>": { cwd, updated_at } }。
 * 失败静默（索引缺失不影响事件落盘，仅影响后台反查项目名）。
 */
function registerProject(hash, cwd) {
  try {
    const dir = getObsHome();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'projects.json');
    let index = {};
    try {
      index = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!index || typeof index !== 'object') index = {};
    } catch {
      index = {};
    }
    index[hash] = { cwd, updated_at: nowIso() };
    fs.writeFileSync(file, JSON.stringify(index, null, 2), 'utf8');
  } catch {
    /* 静默 */
  }
}

function readProjectContext(cwd) {
  try {
    const cfg = path.join(cwd, 'openspec', 'config.yaml');
    if (!fs.existsSync(cfg)) return {};
    const text = fs.readFileSync(cfg, 'utf8');
    const out = {};
    const sm = text.match(/^schema:\s*([\w-]+)/m);
    if (sm) out.schema = sm[1];
    const pm = text.match(/^platform:\s*([\w-]+)/m);
    if (pm) out.platform = pm[1];
    if (!out.platform && out.schema === 'h5-sdd') out.platform = 'h5';
    return out;
  } catch {
    return {};
  }
}

function extractChangeId(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const m = filePath.match(/openspec[\\/]changes[\\/]+([^\\/]+)/);
  return m ? m[1] : null;
}

function extractArchiveChangeId(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const m = filePath.match(/archive[\\/]+\d{4}-\d{2}-\d{2}-([^\\/]+)/);
  return m ? m[1] : null;
}

function extractWangyueId(changeId) {
  if (!changeId || typeof changeId !== 'string') return null;
  const m = changeId.match(/^r-([a-z]+-\d+)/);
  return m ? m[1] : null;
}

function inferArtifact(filePath, changeId) {
  if (!filePath) return null;
  const re = new RegExp(
    'openspec[\\\\/]changes[\\\\/]' + escapeRegExp(changeId) + '[\\\\/](.+)$'
  );
  const m = filePath.match(re);
  const rel = m ? m[1].replace(/\\/g, '/') : '';
  const base = path.basename(rel);
  if (base === 'proposal.md') return 'proposal';
  if (base === 'design.md') return 'design';
  if (base === 'tasks.md') return 'tasks';
  if (base === 'review.md') return 'review';
  if (base === 'change-log.md') return 'change-log';
  if (base === '.openspec.yaml') return 'meta';
  if (rel.startsWith('specs/') && base === 'spec.md') return 'specs';
  return null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断 file_path 是否落在 <cwd>/docs/ 目录内（规范化后比较，防御 `..` 越界）。
 * docs/* 是 SDD 流程约定的项目上下文知识库（glossary / route-map / api-map 等），
 * 捕获对它的 Read 以观测 design 等 phase 的上下文使用情况。
 */
function isDocsPath(filePath, cwd) {
  if (!filePath || typeof filePath !== 'string') return false;
  const docsRoot = path.resolve(cwd, 'docs');
  let abs;
  try {
    abs = path.resolve(cwd, filePath);
  } catch {
    return false;
  }
  // 必须严格位于 docs/ 之下（docsRoot + 分隔符前缀），避免 `..` 逃逸或 docs 同名文件
  const prefix = docsRoot + path.sep;
  return abs === docsRoot || abs.startsWith(prefix);
}

/**
 * 递归扫描 <cwd>/docs/ 下的 .md 文件，返回相对 cwd 的路径 + 字节数。
 * 用作「未读取 docs」候选集基线：与同 session 的 sdd.context.read 做差集 = 没用哪些。
 * 限制：只采 .md（context 文档约定为 md）；跳过 node_modules / .git 等。
 */
function scanDocsInventory(cwd) {
  const docsRoot = path.join(cwd, 'docs');
  const out = [];
  if (!fs.existsSync(docsRoot)) return out;
  const SKIP = new Set(['node_modules', '.git', '.DS_Store']);
  let stack = [docsRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push({ path: rel(full, cwd), ...docsFileMeta(full) });
      }
    }
  }
  return out;
}

// ────────────────────────────── 结构化提取 ──────────────────────────────

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function extractReview(filePath, schema) {
  const text = safeRead(filePath);
  if (!text) return { status: null };
  const visibleText = text.replace(/<!--[\s\S]*?-->/g, '');
  const lines = visibleText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const statusLines = lines.filter((line) => /^`?status:\s*(pass|blocked)`?$/i.test(line));
  const lastStatus = (lines.at(-1) || '').match(/^`?status:\s*(pass|blocked)`?$/i);
  const explicitStatus = statusLines.length === 1 && lastStatus
    ? lastStatus[1].toLowerCase()
    : null;
  const counts = { OB: 0, CT: 0, MS: 0, UT: 0, AM: 0 };
  const dimMap = { '越界': 'OB', '矛盾': 'CT', '遗漏': 'MS', '不可追踪': 'UT', '模糊项': 'AM' };
  for (const line of lines) {
    const m = line.match(/^\|\s*(越界|矛盾|遗漏|不可追踪|模糊项)\s*\|\s*(\d+)\s*\|/);
    if (m) {
      const key = dimMap[m[1]];
      if (key) counts[key] = Number(m[2]);
    }
  }
  const severity = firstMatch(visibleText, /\*\*Severity[：:]\s*([^*]+?)\*\*/);

  if (schema === 'native-sdd') {
    const verdict = firstMatch(visibleText, /结论[：:]\s*(通过|不通过)/);
    const allow = firstMatch(visibleText, /是否允许进入\s*tasks[：:]\s*(是|否)/i);
    return {
      verdict: verdict || null,
      allow_tasks: allow === '是' ? true : allow === '否' ? false : null,
      status: statusLines.length
        ? explicitStatus
        : (verdict === '通过' ? 'pass' : verdict === '不通过' ? 'blocked' : null),
      severity: severity ? severity.trim() : null,
      counts,
    };
  }
  return { status: explicitStatus, severity: severity ? severity.trim() : null, counts };
}

function countTasks(filePath) {
  const text = safeRead(filePath);
  if (!text) return { total: 0, done: 0, remaining: 0 };
  let total = 0;
  let done = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^[-*]\s+\[[\sx]]/i.test(line)) total++;
    if (/^[-*]\s+\[x]/i.test(line)) done++;
  }
  return { total, done, remaining: total - done };
}

function countChangeLogEntries(filePath) {
  const text = safeRead(filePath);
  if (!text) return 0;
  const m = text.match(/^##\s+\[\d{4}-\d{2}-\d{2}/gm);
  return m ? m.length : 0;
}

function safeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function docsFileMeta(filePath) {
  const text = safeRead(filePath);
  if (text == null) {
    return { bytes: safeBytes(filePath), line_count: null, content_hash: null };
  }
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    line_count: countLines(text),
    content_hash: sha256(text),
  };
}

function countLines(text) {
  if (text === '') return 0;
  return String(text).split(/\r?\n/).length;
}

function sha256(content) {
  try {
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

function normalizePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function docsReadRange(toolInput, lineCount) {
  const offset = normalizePositiveInt(toolInput && toolInput.offset);
  const limit = normalizePositiveInt(toolInput && toolInput.limit);
  const total = Number.isFinite(lineCount) ? lineCount : null;
  if (total === 0) return { line_start: null, line_end: null };

  const lineStart = offset || 1;
  if (total != null && lineStart > total) {
    return { line_start: lineStart, line_end: null };
  }

  let lineEnd = limit ? lineStart + limit - 1 : total;
  if (total != null && lineEnd != null) lineEnd = Math.min(lineEnd, total);
  return { line_start: lineStart, line_end: lineEnd };
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

// ────────────────────────────── session 状态 ──────────────────────────────

function writeSessionState(cwd, sessionId, stage, changeIdArg) {
  try {
    const dir = getObsRoot(cwd);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `session-${sanitize(sessionId)}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ stage, change_id_arg: changeIdArg || null, start_ts: nowIso() }),
      'utf8'
    );
  } catch {
    /* 静默 */
  }
}

function readSessionState(cwd, sessionId) {
  try {
    const file = path.join(getObsRoot(cwd), `session-${sanitize(sessionId)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 读取 workflow sidecar 当前激活的 change。
 *
 * workflow current 是阶段执行时由 CLI 维护的控制面状态，比 UserPromptSubmit 的自然语言
 * 解析更可靠；observe 脚本保持零三方依赖，因此只解析 change / stage 两个简单 YAML 标量。
 */
function readWorkflowCurrentState(cwd) {
  try {
    const home = process.env.DSPEC_HOME_OVERRIDE || os.homedir();
    const file = path.join(
      home,
      '.dspec',
      'workflow',
      'projects',
      workflowProjectKey(cwd),
      'current.yaml'
    );
    if (!fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'utf8');
    const readScalar = (key) => {
      const match = text.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
      if (!match) return null;
      let value = match[1].trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      return value || null;
    };
    return { change: readScalar('change'), stage: readScalar('stage') };
  } catch {
    return {};
  }
}

function readWorkflowCurrent(cwd) {
  return readWorkflowCurrentState(cwd).change || null;
}

function readWorkflowRequirementSource(cwd, changeId) {
  if (!isChangeId(changeId)) return null;
  try {
    const home = process.env.DSPEC_HOME_OVERRIDE || os.homedir();
    const file = path.join(
      home,
      '.dspec',
      'workflow',
      'projects',
      workflowProjectKey(cwd),
      'changes',
      changeId,
      'source.json'
    );
    if (!fs.existsSync(file)) return null;
    const source = JSON.parse(fs.readFileSync(file, 'utf8'));
    const requirementId = isChangeId(source && source.requirementId)
      ? source.requirementId
      : null;
    const sourceWangyueId =
      source && typeof source.wangyueId === 'string' && /^[a-z]+-\d+$/i.test(source.wangyueId)
        ? source.wangyueId.toLowerCase()
        : null;
    const wangyueId =
      sourceWangyueId ||
      extractWangyueId(String(requirementId || '').toLowerCase());
    if (!requirementId && !wangyueId) return null;
    return { requirement_id: requirementId, wangyue_id: wangyueId };
  } catch {
    return null;
  }
}

function normalizeKnowledgeStage(stage) {
  const value = String(stage || '').trim().toLowerCase();
  if (value === 'proposal' || value === 'propose') return 'proposal';
  if (value === 'design') return 'design';
  if (value === 'task') return 'task';
  if (value === 'coding') return 'coding';
  if (value === 'verify') return 'verify';
  if (value === 'archive') return 'archive';
  return null;
}

function contextStage(session, current) {
  const sessionStage = normalizeKnowledgeStage(session && (session.stage || session.command));
  if (sessionStage) return sessionStage;
  if (session) return normalizeKnowledgeStage(current && current.stage);
  return null;
}

function isChangeId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function contextForChange(ctx, cwd, changeId) {
  const source = readWorkflowRequirementSource(cwd, changeId);
  return {
    ...ctx,
    change_id: changeId,
    requirement_id: source ? source.requirement_id : null,
    attribution_source: source ? 'workflow-source' : null,
    wangyue_id: (source && source.wangyue_id) || extractWangyueId(changeId),
  };
}

/**
 * 读取 monitor 的 session 绑定。绑定只在 repo_root 与当前项目一致且 recording=true 时有效，
 * 避免同一用户的其他项目/会话串线。
 */
function readMonitorSessionBinding(cwd, sessionId) {
  if (!sessionId) return null;
  try {
    const home = process.env.DSPEC_HOME_OVERRIDE || os.homedir();
    const file = path.join(
      home,
      '.dspec',
      'monitor',
      'state',
      'sessions',
      `${sha256(sessionId).slice(0, 24)}.json`
    );
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state || state.recording !== true || !isChangeId(state.requirement_id)) return null;
    if (state.repo_root && path.resolve(state.repo_root) !== path.resolve(cwd)) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * change 是业务主键，session 只是归因证据。优先使用当前 session 的显式参数，其次使用
 * monitor session binding；只有已被识别为 DSpec 的 session 才允许降级到项目 current。
 */
function resolveAttribution(cwd, sessionId) {
  const session = readSessionState(cwd, sessionId);
  const current = readWorkflowCurrentState(cwd);
  const stage = contextStage(session, current);
  const sessionChange = session && session.change_id_arg;
  if (isChangeId(sessionChange)) {
    const source = readWorkflowRequirementSource(cwd, sessionChange);
    return {
      change_id: sessionChange,
      requirement_id: source ? source.requirement_id : null,
      attribution_source: 'session-explicit',
      stage,
    };
  }
  const binding = readMonitorSessionBinding(cwd, sessionId);
  if (binding) {
    return {
      change_id: null,
      requirement_id: binding.requirement_id,
      attribution_source: 'monitor-binding',
      stage,
    };
  }
  if (session && isChangeId(current.change)) {
    const source = readWorkflowRequirementSource(cwd, current.change);
    return {
      change_id: current.change,
      requirement_id: source ? source.requirement_id : null,
      attribution_source: 'workflow-current',
      stage,
    };
  }
  return {
    change_id: null,
    requirement_id: null,
    attribution_source: null,
    stage,
  };
}

function resolveActiveChangeId(cwd, sessionId) {
  const attribution = resolveAttribution(cwd, sessionId);
  return attribution.change_id || attribution.requirement_id || null;
}

function sanitize(s) {
  return String(s || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

// ────────────────────────────── openspec status 快照 ──────────────────────────────

function snapshotStatus(cwd, changeId) {
  if (!changeId) return null;
  let parsed = null;
  try {
    const r = spawnSync('openspec', ['status', '--change', changeId, '--json'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (r && r.status === 0 && r.stdout) parsed = JSON.parse(r.stdout);
  } catch {
    parsed = null;
  }
  const out = {};
  if (parsed) {
    if (typeof parsed.isComplete === 'boolean') out.isComplete = parsed.isComplete;
    if (Array.isArray(parsed.artifacts)) {
      out.artifacts = parsed.artifacts.map((a) => ({ id: a && a.id, status: a && a.status }));
    }
  }
  const tasksFile = path.join(cwd, 'openspec', 'changes', changeId, 'tasks.md');
  if (fs.existsSync(tasksFile)) Object.assign(out, countTasks(tasksFile));
  return Object.keys(out).length ? out : null;
}

// ────────────────────────────── 事件构造与分发 ──────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function baseEvent(ctx, extra) {
  const ev = {
    ts: nowIso(),
    source: DSPEC_OBSERVE_TAG,
    dspec_version: DSPEC_VERSION,
    session_id: ctx.session_id || null,
    cwd: ctx.cwd || null,
    schema: ctx.schema || null,
    platform: ctx.platform || null,
    change_id: ctx.change_id || null,
    requirement_id: ctx.requirement_id || null,
    attribution_source: ctx.attribution_source || null,
    stage: normalizeKnowledgeStage(ctx.stage),
    wangyue_id: ctx.wangyue_id || null,
  };
  return Object.assign(ev, extra);
}

function parseStagePrompt(prompt) {
  const text = String(prompt || '');
  const xmlCommand = text.match(
    /<command-(?:message|name)>\s*\/?dspec-(proposal|design|task|coding|verify|archive|change)\s*<\/command-(?:message|name)>/i
  );
  if (xmlCommand) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/i);
    return {
      stage: xmlCommand[1].toLowerCase(),
      rest: args ? args[1].trim() : '',
    };
  }
  const direct = text.match(/^\s*[$/]?dspec-(proposal|design|task|coding|verify|archive|change)\b/i);
  if (!direct) return null;
  return {
    stage: direct[1].toLowerCase(),
    rest: text.slice(direct[0].length).trim(),
  };
}

function handleEvent(payload) {
  const events = [];
  if (!payload || typeof payload !== 'object') return events;

  const cwd = payload.cwd || process.cwd();
  const ctx0 = { cwd, session_id: payload.session_id || null, ...readProjectContext(cwd) };
  const name = payload.hook_event_name;

  if (name === 'UserPromptSubmit') {
    const request = parseStagePrompt(payload.prompt);
    if (!request) return events;
    const { stage, rest } = request;
    const changeIdArg = rest ? rest.split(/\s+/)[0].replace(/^["']|["']$/g, '') : null;
    const validChangeId = isChangeId(changeIdArg) ? changeIdArg : null;
    writeSessionState(cwd, ctx0.session_id, stage, validChangeId);
    const ctx = validChangeId
      ? contextForChange(ctx0, cwd, validChangeId)
      : ctx0;
    events.push(
      baseEvent(ctx, { event: 'sdd.stage.request', stage, change_id_arg: validChangeId })
    );
    return events;
  }

  if (name === 'PostToolUse') {
    const tool = payload.tool_name;
    const ti = payload.tool_input || {};

    if (['Write', 'Edit', 'MultiEdit'].includes(tool)) {
      const fp = ti.file_path;
      if (!fp) return events;
      if (/openspec[\\/]changes[\\/]archive[\\/]/.test(fp)) {
        const cid = extractArchiveChangeId(fp);
        const ctx = contextForChange(ctx0, cwd, cid);
        events.push(
          baseEvent(ctx, {
            event: 'sdd.change.archived',
            archive_path: rel(fp, cwd),
            artifact: 'archived',
          })
        );
        return events;
      }
      const changeId = extractChangeId(fp);
      if (!changeId || changeId === 'archive') return events;
      const artifact = inferArtifact(fp, changeId);
      if (!artifact) return events;
      const ctx = contextForChange(ctx0, cwd, changeId);
      const relp = rel(fp, cwd);

      if (artifact === 'review') {
        events.push(
          baseEvent(ctx, {
            event: 'sdd.review.gate',
            artifact,
            path: relp,
            ...extractReview(fp, ctx.schema),
          })
        );
      } else if (artifact === 'tasks') {
        events.push(
          baseEvent(ctx, { event: 'sdd.task.progress', artifact, path: relp, ...countTasks(fp) })
        );
      } else if (artifact === 'change-log') {
        events.push(
          baseEvent(ctx, {
            event: 'sdd.change.log',
            artifact,
            path: relp,
            entries: countChangeLogEntries(fp),
          })
        );
      } else {
        events.push(
          baseEvent(ctx, {
            event: 'sdd.artifact.written',
            artifact,
            path: relp,
            op: opFromTool(tool),
            bytes: safeBytes(fp),
          })
        );
      }
      // 注：产物节点（proposal/specs/design/review/tasks）的 phase 事件由 skill 显式调
      // dspec monitor 负责（时机精确到"开始创建产物/创建结束"）。observe 只记被动观测事件
      //（artifact.written / review.gate / task.progress），不驱动 phase 状态机——避免把
      // phase.start/end 压成瞬时点（文件写完那一刻）导致 phase 区间失真。
      return events;
    }

    if (tool === 'Bash') {
      const cmd = String(ti.command || ti.cmd || '');
      const mn = cmd.match(/openspec\s+new\s+change\s+["']?([^"'\s]+)/);
      if (mn) {
        const cid = mn[1];
        const ctx = contextForChange(ctx0, cwd, cid);
        events.push(baseEvent(ctx, { event: 'sdd.change.created', change_id_created: cid }));
      }
      const ma = cmd.match(
        /mv\s+["']?([^"'\s]*openspec[\\/]changes[\\/][^"'\s]+)["']?\s+["']?([^"'\s]*openspec[\\/]changes[\\/]archive[^"'\s]+)/
      );
      if (ma) {
        const cid = extractChangeId(ma[1]);
        const ctx = contextForChange(ctx0, cwd, cid);
        events.push(
          baseEvent(ctx, {
            event: 'sdd.change.archived',
            source_path: rel(ma[1], cwd),
            archive_path: rel(ma[2], cwd),
          })
        );
      }
      for (const fp of extractDocsReadPaths(cmd, cwd)) {
        const attribution = resolveAttribution(cwd, ctx0.session_id);
        const cid = attribution.change_id || attribution.requirement_id;
        events.push(
          baseEvent(
            {
              ...ctx0,
              ...attribution,
              wangyue_id: extractWangyueId(cid),
            },
            {
              event: 'sdd.context.read',
              path: rel(fp, cwd),
              ...docsFileMeta(fp),
              line_start: null,
              line_end: null,
              read_via: 'Bash',
            }
          )
        );
      }
      return events;
    }

    // docs/* 上下文知识库读取观测：优先用 workflow current 归因，归档后降级到 session。
    // 捕获对项目 docs/ 的 Read，为 design 等 phase 的上下文使用分析提供事实数据。
    if (tool === 'Read') {
      const fp = ti.file_path;
      if (!fp || !isDocsPath(fp, cwd)) return events;
      const attribution = resolveAttribution(cwd, ctx0.session_id);
      const cid = attribution.change_id || attribution.requirement_id;
      const ctx = {
        ...ctx0,
        ...attribution,
        wangyue_id: extractWangyueId(cid),
      };
      const meta = docsFileMeta(fp);
      events.push(
        baseEvent(ctx, {
          event: 'sdd.context.read',
          path: rel(fp, cwd),
          ...meta,
          ...docsReadRange(ti, meta.line_count),
        })
      );
      return events;
    }

    return events;
  }

  if (name === 'Stop') {
    const sess = readSessionState(cwd, ctx0.session_id);
    const attribution = resolveAttribution(cwd, ctx0.session_id);
    const cid = attribution.change_id || attribution.requirement_id;
    const ctx = { ...ctx0, ...attribution, wangyue_id: extractWangyueId(cid) };
    const snap = snapshotStatus(cwd, attribution.change_id);
    events.push(
      baseEvent(ctx, {
        event: 'sdd.round.snapshot',
        stage: (sess && (sess.stage || sess.command)) || null,
        ...(snap || {}),
      })
    );
    // docs/ 上下文知识库全量快照：作为「没用哪些」候选集基线。
    // 查询侧用同 session 的 sdd.context.read（已读）与此 inventory（全集）做差集。
    const inventory = scanDocsInventory(cwd);
    if (inventory.length) {
      events.push(baseEvent(ctx, { event: 'sdd.context.inventory', docs: inventory }));
    }
    return events;
  }

  return events;
}

function opFromTool(tool) {
  if (tool === 'Write') return 'write';
  if (tool === 'Edit' || tool === 'MultiEdit') return 'edit';
  return String(tool || '').toLowerCase();
}

function rel(fp, cwd) {
  try {
    const r = path.relative(cwd, fp);
    return r ? r : fp;
  } catch {
    return fp;
  }
}

function extractDocsReadPaths(command, cwd) {
  const text = String(command || '');
  if (!/\b(cat|sed|head|tail|awk|nl|bat|rg|grep)\b|git\s+(show|diff|grep)\b/.test(text)) {
    return [];
  }
  const paths = new Set();
  const re = /(?:^|[\s"'=])((?:\.\/)?docs\/[^\s"'|;&<>]+\.md)\b/g;
  let match;
  while ((match = re.exec(text))) {
    const abs = path.resolve(cwd, match[1]);
    if (isDocsPath(abs, cwd) && fs.existsSync(abs)) paths.add(abs);
  }
  return Array.from(paths);
}

// ────────────────────────────── 落盘 + 转发 ──────────────────────────────

function appendEvents(cwd, events) {
  if (!events || !events.length) return;
  try {
    const dir = getObsRoot(cwd);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'events.jsonl');
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(f, lines);
  } catch {
    /* 静默 */
  }
}

function forward(event) {
  // 默认不上报（仅落本地）。显式设置 DSPEC_OBSERVE_FORWARD_URL 才经 curl push 到自建后台。
  if (!FORWARD_URL) return;
  if (process.env.DSPEC_OBSERVE_DISABLE_FORWARD === '1') return;
  try {
    const body = JSON.stringify(event);
    const cp = spawn(
      'curl',
      [
        '-s',
        '-X',
        'POST',
        FORWARD_URL,
        '-H',
        'Content-Type: application/json',
        '-H',
        `X-Claude-PID: ${process.ppid || process.pid}`,
        '--data-binary',
        body,
        '--max-time',
        '2',
      ],
      { detached: true, stdio: 'ignore' }
    );
    cp.unref();
  } catch {
    /* 静默 */
  }
}

// ────────────────────────────── 入口 ──────────────────────────────

function main() {
  let raw = '';
  if (process.stdin.isTTY === true) return;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    raw += c;
  });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(raw || '{}');
      const events = handleEvent(payload);
      if (events.length) {
        appendEvents(payload.cwd || process.cwd(), events);
        events.forEach(forward);
      }
      const output = hookSuccessOutput(payload);
      if (output) process.stdout.write(output);
    } catch {
      /* 静默 */
    }
  });
  setTimeout(() => {}, 0);
}

function hookSuccessOutput(payload) {
  return payload && payload.hook_event_name === 'Stop' && payload.turn_id ? '{}\n' : '';
}

if (require.main === module) {
  main();
}

module.exports = {
  handleEvent,
  appendEvents,
  forward,
  baseEvent,
  readProjectContext,
  getObsHome,
  getObsRoot,
  projectHash,
  registerProject,
  extractChangeId,
  extractArchiveChangeId,
  extractWangyueId,
  inferArtifact,
  extractReview,
  countTasks,
  countChangeLogEntries,
  snapshotStatus,
  writeSessionState,
  readSessionState,
  readWorkflowCurrentState,
  readWorkflowCurrent,
  readWorkflowRequirementSource,
  normalizeKnowledgeStage,
  readMonitorSessionBinding,
  resolveAttribution,
  resolveActiveChangeId,
  isDocsPath,
  scanDocsInventory,
  docsFileMeta,
  docsReadRange,
  extractDocsReadPaths,
  parseStagePrompt,
  hookSuccessOutput,
  sha256,
  DSPEC_OBSERVE_TAG,
  DSPEC_VERSION,
};
