/**
 * mobile-spec obs 看板数据整理层。
 *
 * 输入 obs-reader 的 summary，输出 HTML 模板直接消费的 view model。
 * 评分、文案、格式化、显隐字段都在这里完成，模板只负责样式与结构。
 */

'use strict';

function clampScore(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function avg(nums) {
  const valid = nums.filter((n) => Number.isFinite(n));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function scoreChange(change) {
  const phases = Array.isArray(change.phases) ? change.phases : [];
  const phaseScore = phases.length ? (phases.filter((p) => p.status === 'done').length / phases.length) * 100 : 0;
  const requiredValidates = ['proposal', 'specs', 'design', 'review', 'tasks', 'verify'];
  const validateScore = (requiredValidates.filter((k) => change.validates && change.validates[k]).length / requiredValidates.length) * 100;
  const reviewScore = change.review_gate ? (change.review_gate.status === 'pass' ? 100 : 0) : 0;
  return {
    total: clampScore(avg([phaseScore, validateScore, reviewScore])),
    phase: clampScore(phaseScore),
    validate: clampScore(validateScore),
    review: clampScore(reviewScore),
  };
}

function scoreSummary(summary) {
  const changes = Array.isArray(summary.changes) ? summary.changes : [];
  if (!changes.length) {
    return { total: 0, phase: 0, validate: 0, review: 0, changes: [] };
  }
  const scored = changes.map((change) => ({ change, score: scoreChange(change) }));
  const phase = clampScore(avg(scored.map((s) => s.score.phase)));
  const validate = clampScore(avg(scored.map((s) => s.score.validate)));
  const review = clampScore(avg(scored.map((s) => s.score.review)));
  return {
    total: clampScore(avg([phase, validate, review])),
    phase,
    validate,
    review,
    changes: scored,
  };
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function shortHash(hash) {
  return hash ? String(hash).slice(0, 8) : '-';
}

function renderLineRange(read) {
  if (!read || read.line_start == null) return 'L?';
  if (read.line_end == null || read.line_end === read.line_start) return `L${read.line_start}`;
  return `L${read.line_start}-L${read.line_end}`;
}

function scoreCards(score) {
  return [
    { label: '流程健康度', value: score.total, tone: 'total' },
    { label: '阶段完成', value: score.phase },
    { label: '产物上报', value: score.validate },
    { label: 'Review Gate', value: score.review },
  ];
}

function docsRows(docs) {
  const files = docs && Array.isArray(docs.files) ? docs.files : [];
  return files.map((f) => {
    const reads = Array.isArray(f.reads) ? f.reads : [];
    return {
      statusLabel: f.stale ? '已过期' : f.used ? '已使用' : '未使用',
      statusTone: f.stale ? 'warn' : f.used ? 'ok' : 'idle',
      path: f.path || '',
      readCount: f.read_count || 0,
      ranges: reads.length ? reads.map(renderLineRange).join(', ') : '-',
      lineCount: f.line_count || '-',
      bytes: fmtBytes(f.bytes),
      hash: shortHash(f.content_hash),
    };
  });
}

const KNOWLEDGE_STAGE_LABELS = {
  proposal: '提案',
  design: '设计',
  task: 'Task',
  coding: 'Coding',
  verify: 'Verify',
  archive: 'Archive',
};

function stageOutcome(change, stage) {
  if (!change) return '-';
  const phases = Array.isArray(change.phases) ? change.phases : [];
  const phaseName = stage === 'proposal' ? 'propose' : stage;
  const phase = phases.find((item) => item.phase === phaseName);
  if (stage === 'proposal') {
    const complete = phase && phase.status === 'done' &&
      change.validates && change.validates.proposal && change.validates.specs;
    return complete ? '流程完成' : '流程未完成';
  }
  if (stage === 'design') {
    if (change.review_gate && change.review_gate.status === 'pass') return 'Review pass';
    if (change.review_gate && change.review_gate.status) return `Review ${change.review_gate.status}`;
    return phase && phase.status === 'done' ? '流程完成' : '流程未完成';
  }
  if (stage === 'archive') {
    return phase && phase.status === 'done' ? '流程完成' : '流程未完成';
  }
  const artifact = stage === 'verify' ? 'verify' : 'tasks';
  const complete = phase && phase.status === 'done' &&
    change.validates && change.validates[artifact];
  return complete ? '流程完成' : '流程未完成';
}

function knowledgeStageRows(docs, change) {
  const byStage = docs && docs.by_stage ? docs.by_stage : {};
  return Object.entries(KNOWLEDGE_STAGE_LABELS).map(([stage, label]) => {
    const usage = byStage[stage] || {};
    return {
      stage: label,
      statusLabel: usage.observed ? '有读取' : '无读取证据',
      statusTone: usage.observed ? 'ok' : 'idle',
      readFiles: usage.read_count || 0,
      readEvents: usage.read_event_count || 0,
      fullRead: !usage.observed || usage.full_inventory_read == null
        ? '-'
        : usage.full_inventory_read
          ? '是'
          : '否',
      outcome: stageOutcome(change, stage),
      benefit: '待对照评测',
    };
  });
}

function docsPanel(docs, change) {
  const d = docs || {};
  const rows = docsRows(d);
  return {
    title: '上下文知识库总览',
    summaryText: `记录到 ${d.read_count || 0} 个文件、${d.read_event_count || 0} 次读取；全库 ${d.inventory_count != null ? d.inventory_count : '-'} 个文件。覆盖率仅用于诊断，不参与评分。`,
    benefitNote: '读取只证明知识库被访问，不能证明产生收益。阶段收益需用同任务 context-on/off 对照，并采用独立质量结果计算。',
    stageRows: knowledgeStageRows(d, change),
    unattributedText: d.unattributed_read_event_count
      ? `${d.unattributed_read_event_count} 次读取缺少阶段归因。`
      : '',
    emptyText: '暂无 docs 文件明细。',
    hasRows: rows.length > 0,
    rows,
  };
}

function changePanel(change, score) {
  const sessions = (change.sessions || []).map((session) => ({
    sessionId: session.session_id,
    coverage: `${session.docs.read_count || 0}${session.docs.inventory_count != null ? '/' + session.docs.inventory_count : ''}`,
    readEvents: session.docs.read_event_count || 0,
    inferredEvents: session.inferred_event_count || 0,
    lastTs: session.last_ts || '-',
  }));
  return {
    title: change.requirement_id || change.wangyue_id || '未命名需求',
    subtitle: change.wangyue_id || '',
    totalScore: score.total,
    cards: [
      { label: '阶段完成', value: score.phase },
      { label: '产物上报', value: score.validate },
      { label: 'Review Gate', value: score.review },
    ],
    phases: (change.phases || []).map((p) => ({ label: p.phase, status: p.status })),
    docsTitle: '知识库使用证据（不计分）',
    docs: docsPanel(change.docs || {}, change),
    hasSessions: sessions.length > 0,
    sessions,
  };
}

function buildDashboardData(summary) {
  const scores = scoreSummary(summary);
  const firstChange = scores.changes[0] && scores.changes[0].change;
  const projectDocs = summary.docs || (firstChange && firstChange.docs) || {};
  const scopeTitle = summary.primary_change_id
    ? `主 change 上下文总览 · ${summary.primary_change_id}`
    : '上下文知识库总览';
  const projectDocsPanel = docsPanel(projectDocs);
  projectDocsPanel.title = scopeTitle;
  return {
    title: 'Mobile Spec Obs 看板',
    projectPath: summary.cwd || '(未知项目)',
    generatedAt: new Date().toLocaleString(),
    cards: scoreCards(scores),
    docs: projectDocsPanel,
    changes: scores.changes.map(({ change, score }) => changePanel(change, score)),
  };
}

module.exports = {
  buildDashboardData,
  scoreChange,
  scoreSummary,
  docsRows,
  knowledgeStageRows,
};
