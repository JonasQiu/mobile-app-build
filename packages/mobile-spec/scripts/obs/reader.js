/**
 * mobile-spec obs 读取层（纯函数）
 *
 * 合并两套可观测数据源，输出汇总视图：
 *   - observe 被动层：~/.mobile-spec/obs/<hash>/events.jsonl（工具级/产物级事件）
 *   - monitor 主动层：~/.mobile-spec/monitor/state/repos/<repoKey>/requirements/*.json（phase 区间/validate 状态）
 *
 * 关联桥接：observe.change_id（r-wyc-646025-xxx）↔ monitor.requirement_id（R-WYC-646025）
 * 用 extractWangyueId 归一化到 wyc-646025 做匹配。key 不一致时降级，不报错。
 *
 * 本模块只读、纯函数，不做任何 I/O 副作用（除读取文件）；CLI 渲染/交互在 commands/obs.js。
 * 路径解析复用 observe.js 的 getObsHome / monitor.js 的 dataRoot / stateRoot，统一吃 MOBILE_SPEC_HOME_OVERRIDE。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const obs = require('../../.agents/hooks/observe');
const monitor = require('../monitor');

// ────────────────────────────── 路径/读取原语 ──────────────────────────────

function homeRoot() {
  return process.env.MOBILE_SPEC_HOME_OVERRIDE || os.homedir();
}

function obsHome() {
  return obs.getObsHome();
}

function obsProjectDir(hash) {
  return path.join(obsHome(), hash);
}

function obsEventsFile(hash) {
  return path.join(obsProjectDir(hash), 'events.jsonl');
}

function monitorStateDir() {
  return monitor.stateRoot();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * 逐行读 events.jsonl，返回事件数组（跳过空行/坏行）。
 * @param {string} file events.jsonl 路径
 * @returns {Array<object>}
 */
function readEventsJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* 跳过坏行 */
    }
  }
  return out;
}

// ────────────────────────────── observe 层：项目列表 ──────────────────────────────

/**
 * 读 projects.json 索引，返回 [{hash, cwd, updated_at}]。
 * 索引缺失/损坏时返回空数组（降级）。
 */
function listObsProjects() {
  const idx = readJson(path.join(obsHome(), 'projects.json'), null);
  if (!idx || typeof idx !== 'object') return [];
  const out = [];
  for (const [hash, info] of Object.entries(idx)) {
    if (!info || typeof info !== 'object') continue;
    out.push({
      hash,
      cwd: info.cwd || null,
      updated_at: info.updated_at || null,
    });
  }
  return out.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

/**
 * 数某 hash 的 events.jsonl 的事件数 + 最后一条 ts。
 * 文件不存在/空返回 {count:0, last_ts:null}。
 */
function summarizeObsEvents(hash) {
  const events = readEventsJsonl(obsEventsFile(hash));
  if (!events.length) return { count: 0, last_ts: null };
  let last = events[events.length - 1].ts || null;
  // 扫一遍取最大 ts（append 顺序通常等于 ts 顺序，但保险）
  for (const e of events) {
    if (e.ts && String(e.ts) > String(last || '')) last = e.ts;
  }
  return { count: events.length, last_ts: last };
}

// ────────────────────────────── monitor 层：项目列表（反查 cwd） ──────────────────────────────

/**
 * 遍历 ~/.mobile-spec/monitor/state/repos/<repoKey>/requirements/*.json，
 * 按 repoKey 聚合，从 state.repo_root 反查 cwd。
 * 返回 [{repo_key, cwd, requirements: [{requirement_id, spec_open, current_phase, updated_at}]}]
 *
 * monitor 没有 repoKey→cwd 索引，只能遍历 requirement 文件读 repo_root 字段。
 */
function listMonitorProjects() {
  const reposDir = path.join(monitorStateDir(), 'repos');
  if (!fs.existsSync(reposDir)) return [];
  const out = [];
  let repoDirs;
  try {
    repoDirs = fs.readdirSync(reposDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const rd of repoDirs) {
    if (!rd.isDirectory()) continue;
    const reqDir = path.join(reposDir, rd.name, 'requirements');
    if (!fs.existsSync(reqDir)) continue;
    let reqFiles;
    try {
      reqFiles = fs.readdirSync(reqDir);
    } catch {
      continue;
    }
    const requirements = [];
    let cwd = null;
    let latestAt = null;
    for (const rf of reqFiles) {
      if (!rf.endsWith('.json')) continue;
      const state = readJson(path.join(reqDir, rf), null);
      if (!state || typeof state !== 'object') continue;
      if (state.repo_root && !cwd) cwd = state.repo_root;
      if (state.updated_at && String(state.updated_at) > String(latestAt || '')) latestAt = state.updated_at;
      requirements.push({
        requirement_id: state.requirement_id || null,
        spec_open: state.spec_open === true,
        current_phase: state.current_phase || null,
        spec_started_at: state.spec_started_at || null,
        spec_ended_at: state.spec_ended_at || null,
        updated_at: state.updated_at || null,
      });
    }
    if (!requirements.length) continue;
    out.push({ repo_key: rd.name, cwd, updated_at: latestAt, requirements });
  }
  return out;
}

// ────────────────────────────── 合并：项目总表 ──────────────────────────────

/**
 * 合并 observe + monitor 两套项目列表，按 cwd 归并。
 * 返回 [{cwd, obs_hash, obs_count, obs_last_ts, monitor_repo_key, monitor_req_count, requirements}]
 * cwd 任一侧缺失用 null 填充（标注"未关联"在渲染侧）。
 */
function listAllProjects() {
  const obsProjects = listObsProjects();
  const monProjects = listMonitorProjects();

  const byCwd = new Map();
  for (const p of obsProjects) {
    const key = p.cwd || `__obs_${p.hash}`;
    if (!byCwd.has(key)) byCwd.set(key, {});
    const sum = summarizeObsEvents(p.hash);
    byCwd.set(key, { ...byCwd.get(key), cwd: p.cwd, obs_hash: p.hash, obs_count: sum.count, obs_last_ts: sum.last_ts });
  }
  for (const p of monProjects) {
    const key = p.cwd || `__mon_${p.repo_key}`;
    if (!byCwd.has(key)) byCwd.set(key, {});
    byCwd.set(key, {
      ...byCwd.get(key),
      cwd: p.cwd,
      monitor_repo_key: p.repo_key,
      monitor_req_count: p.requirements.length,
      requirements: p.requirements,
    });
  }
  return Array.from(byCwd.values()).sort(
    (a, b) => String(b.obs_last_ts || b.updated_at || '').localeCompare(String(a.obs_last_ts || a.updated_at || ''))
  );
}

// ────────────────────────────── show：单项汇总视图 ──────────────────────────────

/**
 * 统一归一化 wangyue_id：把 observe.change_id（r-wyc-646025-xxx，小写）
 * 和 monitor.requirement_id（R-WYC-646025，大写）都映射到小写 wyc-646025。
 *
 * observe 侧复用 observe.js 的 extractWangyueId（正则 ^r-([a-z]+-\d+)）；
 * monitor 侧的 requirement_id 是大写 R-WYC-... 格式，observe 的正则匹配不到，
 * 这里统一转小写后复用同一正则，保证两侧可桥接。
 */
function normalizeWangyueId(id) {
  if (!id || typeof id !== 'string') return null;
  const normalized = id.trim().toLowerCase();
  if (/^wyc-\d+$/.test(normalized)) return normalized;
  // 先尝试 observe 原生（小写 r-wyc-...）
  let wy = obs.extractWangyueId(id);
  if (wy) return wy;
  // monitor 大写格式：转小写再匹配
  return obs.extractWangyueId(normalized) || null;
}

/**
 * 把 observe 事件按 wangyue_id 分组（change_id → normalizeWangyueId）。
 * 无 wangyue_id 的事件归到 null 桶。
 */
function groupObsByWangyue(events) {
  const buckets = new Map();
  for (const e of events) {
    const wy = normalizeWangyueId(e.change_id) || null;
    if (!buckets.has(wy)) buckets.set(wy, []);
    buckets.get(wy).push(e);
  }
  return buckets;
}

function normalizeDirectId(id) {
  return typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : null;
}

/**
 * observe.change_id 与 monitor.requirement_id 的关联规则：
 * - 普通 change：直接 ID 相等；
 * - 望岳 change：统一归一化为 wyc-<id> 后相等。
 */
function eventMatchesRequirement(event, requirementId) {
  const requirement = normalizeDirectId(requirementId);
  const explicitRequirement = normalizeDirectId(event && event.requirement_id);
  if (explicitRequirement) {
    if (requirement && explicitRequirement === requirement) return true;
    const eventWangyue = normalizeWangyueId(explicitRequirement);
    const requirementWangyue = normalizeWangyueId(requirementId);
    return Boolean(eventWangyue && requirementWangyue && eventWangyue === requirementWangyue);
  }
  const eventId = normalizeDirectId(event && event.change_id);
  if (eventId && requirement && eventId === requirement) return true;
  if (eventId) {
    const directWangyue = normalizeWangyueId(eventId);
    const requirementWangyue = normalizeWangyueId(requirementId);
    return Boolean(directWangyue && requirementWangyue && directWangyue === requirementWangyue);
  }
  const eventWangyue = normalizeWangyueId(event && event.wangyue_id);
  const requirementWangyue = normalizeWangyueId(requirementId);
  return Boolean(eventWangyue && requirementWangyue && eventWangyue === requirementWangyue);
}

/**
 * 从 events 中提取 review 门禁：取最后一条 sdd.review.gate。
 * native-sdd 用 status（verdict 派生），h5-sdd 用 status + counts + severity。
 */
function lastReviewGate(events) {
  let last = null;
  for (const e of events) {
    if (e.event === 'sdd.review.gate') last = e;
  }
  if (!last) return null;
  return {
    status: last.status || null,
    severity: last.severity || null,
    counts: last.counts || null,
    path: last.path || null,
    ts: last.ts || null,
  };
}

/**
 * docs 读取统计：用 sdd.context.read（已读）vs 最后一条 sdd.context.inventory（全集）做差集。
 * 返回 {read:[path...], read_details:[...], files:[...], unread:[path...], inventory_count, read_count, read_event_count}
 * 没有 inventory 事件时，unread 置 null（无法计算"没用哪些"）。
 */
function docsUsageStatsCore(events) {
  const readsByPath = new Map();
  for (const e of events) {
    if (e.event !== 'sdd.context.read' || !e.path) continue;
    const p = String(e.path).replace(/\\/g, '/');
    if (!readsByPath.has(p)) readsByPath.set(p, []);
    readsByPath.get(p).push({
      ts: e.ts || null,
      line_start: Number.isFinite(e.line_start) ? e.line_start : null,
      line_end: Number.isFinite(e.line_end) ? e.line_end : null,
      line_count: Number.isFinite(e.line_count) ? e.line_count : null,
      bytes: Number.isFinite(e.bytes) ? e.bytes : null,
      content_hash: e.content_hash || null,
    });
  }
  let inventory = null;
  for (const e of events) {
    if (e.event === 'sdd.context.inventory') inventory = e; // 取最后一条
  }
  const allReadPaths = Array.from(readsByPath.keys()).sort();
  const rawReadEventCount = allReadPaths.reduce((n, p) => n + readsByPath.get(p).length, 0);
  if (!inventory || !Array.isArray(inventory.docs)) {
    const readDetails = allReadPaths.map((p) => ({ path: p, reads: readsByPath.get(p) || [] }));
    return {
      read: allReadPaths,
      read_details: readDetails,
      files: readDetails.map((d) => ({
        path: d.path,
        used: true,
        read_count: d.reads.length,
        reads: d.reads,
        bytes: d.reads[0] ? d.reads[0].bytes : null,
        line_count: d.reads[0] ? d.reads[0].line_count : null,
        content_hash: d.reads[0] ? d.reads[0].content_hash : null,
      })),
      unread: null,
      inventory_count: null,
      read_count: allReadPaths.length,
      read_event_count: rawReadEventCount,
      stale_read: [],
      stale_read_count: 0,
      full_inventory_read: null,
    };
  }
  const docsByPath = new Map();
  for (const d of inventory.docs) {
    const p = String(d.path || '').replace(/\\/g, '/');
    if (!p) continue;
    docsByPath.set(p, {
      path: p,
      bytes: Number.isFinite(d.bytes) ? d.bytes : null,
      line_count: Number.isFinite(d.line_count) ? d.line_count : null,
      content_hash: d.content_hash || null,
    });
  }
  const fullSet = new Set(docsByPath.keys());
  const freshReadsByPath = new Map();
  const staleRead = [];
  for (const p of allReadPaths) {
    const invHash = docsByPath.get(p) && docsByPath.get(p).content_hash;
    const reads = readsByPath.get(p) || [];
    const fresh = reads.filter((r) => !invHash || !r.content_hash || r.content_hash === invHash);
    if (fresh.length) freshReadsByPath.set(p, fresh);
    else if (reads.length) staleRead.push(p);
  }
  const read = Array.from(freshReadsByPath.keys()).sort();
  const readDetails = read.map((p) => ({ path: p, reads: freshReadsByPath.get(p) || [] }));
  const readEventCount = readDetails.reduce((n, d) => n + d.reads.length, 0);
  const unread = Array.from(fullSet)
    .filter((p) => !freshReadsByPath.has(p))
    .sort();
  const files = Array.from(new Set([...fullSet, ...readsByPath.keys()]))
    .sort()
    .map((p) => {
      const inv = docsByPath.get(p) || {};
      const reads = freshReadsByPath.get(p) || [];
      const rawReads = readsByPath.get(p) || [];
      return {
        path: p,
        used: reads.length > 0,
        stale: rawReads.length > 0 && reads.length === 0,
        read_count: reads.length,
        reads,
        bytes: inv.bytes != null ? inv.bytes : reads[0] ? reads[0].bytes : null,
        line_count: inv.line_count != null ? inv.line_count : reads[0] ? reads[0].line_count : null,
        content_hash: inv.content_hash || (reads[0] ? reads[0].content_hash : null),
      };
    });
  return {
    read,
    read_details: readDetails,
    files,
    unread,
    inventory_count: fullSet.size,
    read_count: read.length,
    read_event_count: readEventCount,
    raw_read_event_count: rawReadEventCount,
    stale_read: staleRead.sort(),
    stale_read_count: staleRead.length,
    full_inventory_read: fullSet.size > 0 && unread.length === 0,
  };
}

const KNOWLEDGE_STAGES = ['proposal', 'design', 'task', 'coding', 'verify', 'archive'];

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

function contextReadStages(events) {
  const requestsBySession = new Map();
  for (const event of events || []) {
    if (event.event !== 'sdd.stage.request' || !event.session_id) continue;
    const stage = normalizeKnowledgeStage(event.stage);
    if (!stage) continue;
    if (!requestsBySession.has(event.session_id)) requestsBySession.set(event.session_id, []);
    requestsBySession.get(event.session_id).push({ ts: String(event.ts || ''), stage });
  }
  for (const requests of requestsBySession.values()) {
    requests.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  const out = new Map();
  for (const event of events || []) {
    if (event.event !== 'sdd.context.read') continue;
    let stage = normalizeKnowledgeStage(event.stage);
    if (!stage && event.session_id) {
      const ts = String(event.ts || '');
      const candidates = requestsBySession.get(event.session_id) || [];
      const request = candidates.filter((item) => !ts || !item.ts || item.ts <= ts).at(-1);
      stage = request ? request.stage : null;
    }
    out.set(event, stage);
  }
  return out;
}

/**
 * 上下文使用事实按 proposal / design / task / coding / verify / archive 分段。
 * 文件覆盖率只保留为诊断字段，不作为收益或质量分；真实收益需要同任务对照组和独立结果。
 */
function docsUsageStats(events) {
  const source = Array.isArray(events) ? events : [];
  const overall = docsUsageStatsCore(source);
  const inventories = source.filter((event) => event.event === 'sdd.context.inventory');
  const stagesByRead = contextReadStages(source);
  const byStage = {};

  for (const stage of KNOWLEDGE_STAGES) {
    const reads = source.filter(
      (event) => event.event === 'sdd.context.read' && stagesByRead.get(event) === stage
    );
    const stats = docsUsageStatsCore([...reads, ...inventories]);
    byStage[stage] = {
      observed: reads.length > 0,
      read: stats.read,
      read_count: stats.read_count,
      read_event_count: stats.read_event_count,
      stale_read_count: stats.stale_read_count,
      full_inventory_read: stats.full_inventory_read,
    };
  }

  const unattributedReads = source.filter(
    (event) => event.event === 'sdd.context.read' && !stagesByRead.get(event)
  );
  return {
    ...overall,
    by_stage: byStage,
    attributed_read_event_count: Array.from(stagesByRead.values()).filter(Boolean).length,
    unattributed_read_event_count: unattributedReads.length,
  };
}

function latestContextEvents(events) {
  const context = (events || []).filter(
    (e) => e.event === 'sdd.context.read' || e.event === 'sdd.context.inventory'
  );
  let sessionId = null;
  let latestTs = '';
  for (const event of context) {
    if (event.session_id && String(event.ts || '') >= latestTs) {
      sessionId = event.session_id;
      latestTs = String(event.ts || '');
    }
  }
  return {
    session_id: sessionId,
    events: sessionId ? context.filter((e) => e.session_id === sessionId) : context,
  };
}

function sessionDiagnostics(events) {
  const bySession = new Map();
  for (const event of events) {
    if (event.event !== 'sdd.context.read' && event.event !== 'sdd.context.inventory') continue;
    const key = event.session_id || '(unknown)';
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(event);
  }
  return Array.from(bySession, ([session_id, sessionEvents]) => ({
    session_id,
    docs: docsUsageStats(sessionEvents),
    context_event_count: sessionEvents.length,
    inferred_event_count: sessionEvents.filter((e) => e._inferred === true).length,
    first_ts: sessionEvents.map((e) => e.ts).filter(Boolean).sort()[0] || null,
    last_ts: sessionEvents.map((e) => e.ts).filter(Boolean).sort().at(-1) || null,
  })).sort((a, b) => String(b.last_ts || '').localeCompare(String(a.last_ts || '')));
}

/**
 * 把 ISO 时间字符串转成简短展示（HH:MM 或 MM-DD HH:MM）。
 */
function fmtShort(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay) return hm;
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  } catch {
    return ts;
  }
}

/**
 * 计算单个 phase 的状态/耗时。
 * @param {object} state monitor requirement state
 * @param {string} phase phase 名
 * @returns {{status, started_at, ended_at, duration_ms}}
 *   status: 'done'（有 ended_at）/ 'active'（started 未 end）/ 'pending'（无记录）
 */
function phaseStatus(state, phase) {
  const legacy = {
    propose: ['new', 'proposal', 'specs'],
    design: ['review'],
    coding: ['apply'],
  };
  const phases = state.phases || {};
  const entries = [
    ...(phases[phase] || []),
    ...(legacy[phase] || []).flatMap((name) => phases[name] || []),
  ].sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));
  const last = entries[entries.length - 1];
  if (!last) return { status: 'pending', started_at: null, ended_at: null, duration_ms: null };
  if (last.ended_at) {
    let duration_ms = null;
    try {
      duration_ms = new Date(last.ended_at).getTime() - new Date(last.started_at).getTime();
    } catch {
      /* ignore */
    }
    return { status: 'done', started_at: last.started_at, ended_at: last.ended_at, duration_ms };
  }
  return { status: 'active', started_at: last.started_at, ended_at: null, duration_ms: null };
}

/**
 * 从 monitor state 取 validate 状态（last_validates）。
 * 新格式按 artifact + file 保存，避免多个 specs 文件互相覆盖；同时兼容旧版单记录格式。
 */
function validateStatus(state) {
  const lv = state.last_validates || {};
  const out = {};
  for (const [artifact, info] of Object.entries(lv)) {
    if (info && info.content_hash) {
      out[artifact] = {
        reported_at: info.reported_at || null,
        file: info.file || null,
        files: info.file ? [info.file] : [],
        present: true,
      };
      continue;
    }
    const records = Object.values(info || {})
      .filter((record) => record && (record.file || record.content_hash))
      .sort((a, b) => String(a.reported_at || '').localeCompare(String(b.reported_at || '')));
    if (records.length) {
      const latest = records.at(-1);
      out[artifact] = {
        reported_at: latest.reported_at || null,
        file: records.length === 1 ? latest.file || null : null,
        files: records.map((record) => record.file).filter(Boolean),
        present: true,
      };
    }
  }
  return out;
}

/**
 * 构建单个项目的汇总视图。
 * @param {object} project listAllProjects() 的元素，或 {cwd, obs_hash, monitor_repo_key}
 * @returns {object} 汇总视图对象（供 --json 输出或终端渲染）
 *
 * 合并策略：以 monitor 的 requirements 为骨架（每个 requirement 对应一个 change），
 * observe 事件按 wangyue_id 匹配挂到对应 change 下；observe 有 wangyue_id 但 monitor
 * 无对应 requirement 时，单独列为 "orphan"（未关联）；observe 事件无 wangyue_id 的
 * （如 sdd.context.read）按 session/time 附着到当前活跃 change。
 */
function buildProjectSummary(project) {
  const rawObsEvents = project.obs_hash ? readEventsJsonl(obsEventsFile(project.obs_hash)) : [];
  const sourceByChange = new Map();
  const obsEvents = rawObsEvents.map((event) => {
    if (!project.cwd || !event.change_id || event.requirement_id) return event;
    if (!sourceByChange.has(event.change_id)) {
      sourceByChange.set(
        event.change_id,
        obs.readWorkflowRequirementSource(project.cwd, event.change_id)
      );
    }
    const source = sourceByChange.get(event.change_id);
    if (!source || !source.requirement_id) return event;
    return {
      ...event,
      requirement_id: source.requirement_id,
      wangyue_id: event.wangyue_id || source.wangyue_id || null,
      attribution_source: event.attribution_source || 'workflow-source-reader',
    };
  });

  // monitor requirements：读全量 state
  let monitorStates = [];
  if (project.monitor_repo_key && project.requirements) {
    monitorStates = project.requirements.map((r) => {
      const reqFile = path.join(
        monitorStateDir(),
        'repos',
        project.monitor_repo_key,
        'requirements',
        `${monitor.requirementKey(r.requirement_id)}.json`
      );
      return readJson(reqFile, { ...r });
    });
  }

  const assigned = monitorStates.map(() => []);
  const unmatchedIndexes = new Set();
  obsEvents.forEach((event, index) => {
    const matches = monitorStates
      .map((state, stateIndex) => eventMatchesRequirement(event, state.requirement_id) ? stateIndex : -1)
      .filter((stateIndex) => stateIndex >= 0);
    if (matches.length === 1) assigned[matches[0]].push(event);
    else unmatchedIndexes.add(index);
  });

  // 历史上下文/阶段事件可能没有 change_id：仅当同一 session 已唯一命中一个 change 时才安全推断。
  const sessionTargets = new Map();
  assigned.forEach((events, stateIndex) => {
    for (const event of events) {
      if (!event.session_id) continue;
      if (!sessionTargets.has(event.session_id)) sessionTargets.set(event.session_id, new Set());
      sessionTargets.get(event.session_id).add(stateIndex);
    }
  });
  for (const index of Array.from(unmatchedIndexes)) {
    const event = obsEvents[index];
    const hasDirectId = normalizeDirectId(event.change_id || event.requirement_id) ||
      normalizeWangyueId(event.wangyue_id);
    const targets = event.session_id && sessionTargets.get(event.session_id);
    const isAttributionEvent =
      event.event === 'sdd.context.read' ||
      event.event === 'sdd.context.inventory' ||
      event.event === 'sdd.stage.request' ||
      event.event === 'sdd.round.snapshot';
    if (hasDirectId || !isAttributionEvent || !targets || targets.size !== 1) continue;
    const target = Array.from(targets)[0];
    assigned[target].push({ ...event, _inferred: true });
    unmatchedIndexes.delete(index);
  }

  const changes = monitorStates.map((st, stateIndex) => {
    const wy = normalizeWangyueId(st.requirement_id) || null;
    const matchedEvents = assigned[stateIndex];
    return {
      requirement_id: st.requirement_id,
      wangyue_id: wy,
      spec_open: st.spec_open === true,
      spec_started_at: st.spec_started_at || null,
      spec_ended_at: st.spec_ended_at || null,
      updated_at: st.updated_at || null,
      current_phase: st.current_phase || null,
      phases: monitor.PHASE_ORDER.map((p) => ({ phase: p, ...phaseStatus(st, p) })),
      validates: validateStatus(st),
      review_gate: lastReviewGate(matchedEvents),
      docs: docsUsageStats(matchedEvents),
      sessions: sessionDiagnostics(matchedEvents),
      obs_event_count: matchedEvents.length,
      linked: matchedEvents.length > 0,
    };
  });

  const unmatchedEvents = Array.from(unmatchedIndexes)
    .sort((a, b) => a - b)
    .map((index) => obsEvents[index]);
  const orphanBuckets = new Map();
  const unattributed = [];
  for (const event of unmatchedEvents) {
    const direct = normalizeDirectId(event.change_id || event.requirement_id);
    const wy = direct ? normalizeWangyueId(direct) : normalizeWangyueId(event.wangyue_id);
    const key = direct || wy;
    if (!key) {
      unattributed.push(event);
      continue;
    }
    if (!orphanBuckets.has(key)) orphanBuckets.set(key, []);
    orphanBuckets.get(key).push(event);
  }
  const orphans = [];
  for (const [key, evs] of orphanBuckets) {
    const first = evs[0] || {};
    orphans.push({
      change_id: normalizeDirectId(first.change_id || first.requirement_id),
      wangyue_id: normalizeWangyueId(key),
      obs_event_count: evs.length,
      review_gate: lastReviewGate(evs),
      docs: docsUsageStats(evs),
      last_ts: evs.length ? evs[evs.length - 1].ts || null : null,
    });
  }

  const primary = changes
    .slice()
    .sort((a, b) =>
      Number(b.spec_open) - Number(a.spec_open) ||
      String(b.updated_at || b.spec_started_at || b.spec_ended_at || '').localeCompare(
        String(a.updated_at || a.spec_started_at || a.spec_ended_at || '')
      )
    )[0] || null;
  const fallbackScope = latestContextEvents(unattributed);

  return {
    cwd: project.cwd || null,
    obs_hash: project.obs_hash || null,
    obs_event_count: obsEvents.length,
    monitor_repo_key: project.monitor_repo_key || null,
    monitor_req_count: monitorStates.length,
    primary_change_id: primary && primary.requirement_id,
    docs: primary ? primary.docs : docsUsageStats(fallbackScope.events),
    docs_scope: primary
      ? { type: 'change', change_id: primary.requirement_id }
      : { type: 'session', session_id: fallbackScope.session_id },
    unattributed_docs: docsUsageStats(unattributed),
    changes,
    orphans,
    unattributed_event_count: unattributed.length,
    has_unlinked:
      orphans.length > 0 ||
      unattributed.length > 0 ||
      (monitorStates.length === 0 && obsEvents.length > 0),
  };
}

module.exports = {
  homeRoot,
  obsHome,
  obsProjectDir,
  obsEventsFile,
  monitorStateDir,
  readJson,
  readEventsJsonl,
  listObsProjects,
  summarizeObsEvents,
  listMonitorProjects,
  listAllProjects,
  groupObsByWangyue,
  eventMatchesRequirement,
  normalizeWangyueId,
  lastReviewGate,
  docsUsageStats,
  latestContextEvents,
  sessionDiagnostics,
  fmtShort,
  phaseStatus,
  validateStatus,
  buildProjectSummary,
  KNOWLEDGE_STAGES,
  normalizeKnowledgeStage,
};
