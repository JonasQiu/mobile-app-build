/**
 * dspec obs —— 本地查看 SDD 可观测数据
 *
 * 子命令：
 *   dspec obs list                    列出所有接入过 dspec 的项目（路径 + 事件数 + 最后更新）
 *   dspec obs show [项目]             单个项目的汇总视图（phase/产物/docs/review）
 *                                     不带参数时交互式选择项目（@inquirer/prompts）
 *
 * 通用 flag：
 *   --json                            输出结构化 JSON（供其他工具消费）
 *   --help, -h                        帮助
 *
 * 数据源：observe 被动层 + monitor 主动层，详见 scripts/obs/reader.js。
 * 路径隔离：复用 DSPEC_HOME_OVERRIDE。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const reader = require('../obs/reader');
const { buildDashboardData } = require('../obs/dashboard-data');
const { renderDashboardHtml } = require('../obs/dashboard-template');

// 交互依赖注入点：测试时替换为 mock。默认用 @inquirer/prompts。
let promptSelect;
try {
  promptSelect = require('@inquirer/prompts').select;
} catch {
  promptSelect = null;
}

function setPromptSelect(fn) {
  promptSelect = fn;
}

let dashboardOpener = openDashboardFile;

function setDashboardOpener(fn) {
  dashboardOpener = fn;
}

// ────────────────────────────── 参数解析 ──────────────────────────────

function parseArgs(argv) {
  const out = { json: false, help: false, positional: [] };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out.positional.push(a);
  }
  return out;
}

// ────────────────────────────── 项目定位 ──────────────────────────────

/**
 * 按参数（路径/hash/序号）定位项目。
 * @param {Array} projects listAllProjects() 结果
 * @param {string} arg 用户传入的项目参数（cwd 子串、hash、或序号）
 * @returns {object|null} 匹配的项目，或 null
 */
function matchProject(projects, arg) {
  if (!arg || !projects.length) return null;
  // 1. 序号（1-based）
  if (/^\d+$/.test(arg)) {
    const idx = Number(arg) - 1;
    if (idx >= 0 && idx < projects.length) return projects[idx];
  }
  // 2. hash 精确匹配
  const byHash = projects.find((p) => p.obs_hash === arg || p.monitor_repo_key === arg);
  if (byHash) return byHash;
  // 3. 显式路径必须精确匹配，避免 "." 命中任意隐藏目录。
  const isPathArg =
    path.isAbsolute(arg) ||
    /^\.{1,2}(?:[\\/]|$)/.test(arg) ||
    /^~(?:[\\/]|$)/.test(arg);
  if (isPathArg) {
    const expanded = arg === '~'
      ? os.homedir()
      : /^~[\\/]/.test(arg)
        ? path.join(os.homedir(), arg.slice(2))
        : arg;
    const normalized = path.resolve(expanded);
    const byPath = projects.find(
      (p) => p.cwd && path.resolve(p.cwd) === normalized
    );
    return byPath || null;
  }
  // 4. 非路径参数才按 cwd 子串匹配（大小写不敏感，便于项目名查询）
  const lower = String(arg).toLowerCase();
  const byCwd = projects.find((p) => p.cwd && p.cwd.toLowerCase().includes(lower));
  if (byCwd) return byCwd;
  return null;
}

/**
 * 交互式选择项目（@inquirer/prompts select）。
 * 非 TTY 或无交互依赖时抛错，由调用方降级。
 */
async function promptProjectSelect(projects) {
  if (!promptSelect) {
    throw new Error('no-prompt-dep');
  }
  if (!projects.length) return null;
  const choices = projects.map((p, i) => {
    const cwd = p.cwd || '(未知路径)';
    const cnt = [p.obs_count ? `${p.obs_count} 事件` : '', p.monitor_req_count ? `${p.monitor_req_count} 需求` : '']
      .filter(Boolean)
      .join(' / ');
    const last = reader.fmtShort(p.obs_last_ts) || '';
    return {
      name: `${i + 1}. ${cwd}${cnt ? `  (${cnt}${last ? ', ' + last : ''})` : ''}`,
      value: p,
    };
  });
  return promptSelect({
    message: '选择项目:',
    choices,
    pageSize: 15,
  });
}

// ────────────────────────────── 终端渲染 ──────────────────────────────

function renderList(projects) {
  if (!projects.length) {
    return ['[dspec] 暂无可观测项目。', '', '提示：接入项目后运行 SDD 流程，可观测数据会自动写入 ~/.dspec/。'].join('\n');
  }
  const lines = ['[dspec] 可观测项目（共 ' + projects.length + ' 个）:', ''];
  lines.push('  #  项目路径                                      事件  需求  最后更新');
  lines.push('  -  ' + '-'.repeat(80));
  projects.forEach((p, i) => {
    const cwd = (p.cwd || '(未知)').padEnd(44).slice(0, 44);
    const cnt = String(p.obs_count || 0).padStart(4);
    const req = String(p.monitor_req_count || 0).padStart(4);
    const last = reader.fmtShort(p.obs_last_ts) || '-';
    const idx = String(i + 1).padStart(2);
    lines.push(`  ${idx}  ${cwd}  ${cnt}  ${req}  ${last}`);
  });
  lines.push('');
  lines.push('查看详情: dspec obs show <序号或项目路径>');
  return lines.join('\n');
}

function fmtDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return (ms / 60000).toFixed(1) + 'm';
  return (ms / 3600000).toFixed(1) + 'h';
}

const PHASE_ICON = { done: '✓', active: '▸', pending: '·' };

function renderPhases(phases) {
  return phases
    .map((p) => `${PHASE_ICON[p.status] || '·'}${p.phase}`)
    .join(' ');
}

function renderLineRange(read) {
  if (!read || read.line_start == null) return 'L?';
  if (read.line_end == null || read.line_end === read.line_start) return `L${read.line_start}`;
  return `L${read.line_start}-L${read.line_end}`;
}

function renderDocsReadDetails(docs, maxItems = 5) {
  if (!docs || !Array.isArray(docs.read_details)) return null;
  const parts = [];
  for (const detail of docs.read_details) {
    const reads = Array.isArray(detail.reads) ? detail.reads : [];
    if (!reads.length) {
      parts.push(detail.path);
      continue;
    }
    parts.push(`${detail.path}:${reads.map(renderLineRange).join(',')}`);
  }
  if (!parts.length) return null;
  const shown = parts.slice(0, maxItems).join(' ');
  return parts.length > maxItems ? `${shown} ...` : shown;
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

function renderDocsFiles(docs, maxItems = 10) {
  if (!docs || !Array.isArray(docs.files) || !docs.files.length) return [];
  const lines = [];
  const files = docs.files.slice(0, maxItems);
  for (const f of files) {
    const ranges = (Array.isArray(f.reads) && f.reads.length)
      ? f.reads.map(renderLineRange).join(',')
      : '-';
    const status = f.stale ? 'stale' : f.used ? 'used' : 'idle';
    lines.push(`      ${status.padEnd(4)} ${f.path}  reads=${f.read_count || 0}  lines=${ranges}/${f.line_count || '-'}  bytes=${fmtBytes(f.bytes)}  hash=${shortHash(f.content_hash)}`);
  }
  if (docs.files.length > maxItems) lines.push(`      ... 还有 ${docs.files.length - maxItems} 个文件`);
  return lines;
}

function dashboardFile(summary) {
  const base = summary.obs_hash ? reader.obsProjectDir(summary.obs_hash) : path.join(reader.obsHome(), 'dashboard');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'dashboard.html');
}

function writeDashboard(summary) {
  const file = dashboardFile(summary);
  fs.writeFileSync(file, renderDashboardHtml(buildDashboardData(summary)), 'utf8');
  return file;
}

function openDashboardFile(file) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', file] : [file];
  const cp = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  cp.unref();
}

function renderSummary(summary) {
  const lines = [];
  lines.push('[dspec] 可观测汇总');
  lines.push('');
  lines.push(`  项目路径:  ${summary.cwd || '(未知)'}`);
  if (summary.obs_hash) lines.push(`  obs hash:  ${summary.obs_hash}  (事件 ${summary.obs_event_count})`);
  if (summary.monitor_repo_key) lines.push(`  monitor:   repo ${summary.monitor_repo_key}  (需求 ${summary.monitor_req_count})`);

  if (summary.has_unlinked) {
    lines.push('');
    lines.push('  ⚠ 数据未完全关联：observe 与 monitor 的 key 存在错配（详见下方 orphan/unattributed）');
  }

  if (summary.docs && (summary.docs.read.length || summary.docs.unread)) {
    const d = summary.docs;
    const times = d.read_event_count && d.read_event_count !== d.read_count
      ? ` / ${d.read_event_count} 次`
      : '';
    lines.push('');
    lines.push(
      `  ${summary.primary_change_id ? `主 change ${summary.primary_change_id}` : '上下文'}使用证据: 读 ${d.read_count}${d.inventory_count != null ? '/' + d.inventory_count : ''} 个${times}` +
      (d.unread && d.unread.length ? `（未用 ${d.unread.length}）` : '')
    );
    if (d.by_stage) {
      lines.push(
        '  分阶段读取: ' +
        reader.KNOWLEDGE_STAGES
          .map((stage) => {
            const usage = d.by_stage[stage] || {};
            return `${stage}=${usage.read_count || 0} 文件/${usage.read_event_count || 0} 次`;
          })
          .join('  ')
      );
    }
    lines.push('  注: 读取覆盖仅用于诊断，不计分；知识收益需同任务 context-on/off 对照和独立质量结果。');
  }

  if (!summary.changes.length && !summary.orphans.length) {
    lines.push('');
    lines.push('  （暂无 monitor 需求记录；' + (summary.obs_event_count ? `但有 ${summary.obs_event_count} 条 observe 事件未归因` : '无 observe 事件') + '）');
    return lines.join('\n');
  }

  // 各 change（需求）汇总
  if (summary.changes.length) {
    lines.push('');
    lines.push('  ── 需求（' + summary.changes.length + '）────────────────────────────────');
    for (const c of summary.changes) {
      lines.push('');
      lines.push(`  [${c.requirement_id || '?'}]${c.wangyue_id ? ' ' + c.wangyue_id : ''}  ${c.spec_open ? (c.spec_ended_at ? '已结案' : '进行中') : '未开启'}`);
      lines.push('    phases: ' + renderPhases(c.phases));
      // validate 状态
      const vKeys = ['proposal', 'specs', 'design', 'review', 'tasks'];
      const vParts = vKeys
        .filter((k) => c.validates[k])
        .map((k) => `${k}:✓`)
      const vMissing = vKeys.filter((k) => !c.validates[k]);
      if (vParts.length) lines.push('    validate: ' + vParts.join(' ') + (vMissing.length ? `   (缺 ${vMissing.join(',')})` : ''));
      else if (vMissing.length) lines.push('    validate: (无)');
      // review 门禁
      if (c.review_gate) {
        const rg = c.review_gate;
        const cntStr = rg.counts ? ` OB=${rg.counts.OB} CT=${rg.counts.CT} MS=${rg.counts.MS} UT=${rg.counts.UT} AM=${rg.counts.AM}` : '';
        lines.push(`    review:   ${rg.status || '?'}${rg.severity ? ' (' + rg.severity + ')' : ''}${cntStr}`);
      }
      // docs 使用
      const d = c.docs;
      if (d.read.length || d.unread) {
        const times = d.read_event_count && d.read_event_count !== d.read_count ? ` / ${d.read_event_count} 次` : '';
        lines.push(`    docs:     使用证据 ${d.read_count}${d.inventory_count != null ? '/' + d.inventory_count : ''} 个${times}` + (d.unread && d.unread.length ? `（未用 ${d.unread.length}: ${d.unread.slice(0, 5).join(', ')}${d.unread.length > 5 ? '...' : ''}）` : ''));
        if (d.by_stage) {
          lines.push(
            '    stages:   ' +
            reader.KNOWLEDGE_STAGES
              .map((stage) => {
                const usage = d.by_stage[stage] || {};
                return `${stage}=${usage.read_count || 0}/${usage.read_event_count || 0}`;
              })
              .join('  ')
          );
        }
        const fileLines = renderDocsFiles(d);
        if (fileLines.length) {
          lines.push('    docs files:');
          lines.push(...fileLines);
        } else {
          const readDetails = renderDocsReadDetails(d);
          if (readDetails) lines.push(`    已读:     ${readDetails}`);
        }
      }
      if (Array.isArray(c.sessions) && c.sessions.length) {
        lines.push('    sessions:');
        for (const session of c.sessions.slice(0, 8)) {
          const sd = session.docs || {};
          lines.push(
            `      ${session.session_id}  docs=${sd.read_count || 0}${sd.inventory_count != null ? '/' + sd.inventory_count : ''}` +
            `  events=${session.context_event_count || 0}` +
            (session.inferred_event_count ? `  inferred=${session.inferred_event_count}` : '')
          );
        }
      }
    }
  }

  // orphan（observe 有 wangyue_id 但 monitor 无对应 requirement）
  if (summary.orphans.length) {
    lines.push('');
    lines.push('  ── 未关联（observe 有记录，monitor 无对应需求）──────────');
    for (const o of summary.orphans) {
      lines.push(`    ${o.change_id || o.wangyue_id || '?'}  事件 ${o.obs_event_count}${o.review_gate ? '  review:' + (o.review_gate.status || '?') : ''}`);
    }
  }

  // 无 wangyue_id 的 observe 事件
  if (summary.unattributed_event_count) {
    lines.push('');
    lines.push(`  ── 未归因事件: ${summary.unattributed_event_count} 条（无 wangyue_id，无法挂到具体需求）`);
  }

  return lines.join('\n');
}

// ────────────────────────────── 命令实现 ──────────────────────────────

async function cmdList(args) {
  const opts = parseArgs(args);
  const projects = reader.listAllProjects();
  if (opts.json) {
    process.stdout.write(JSON.stringify({ projects }, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderList(projects) + '\n');
}

async function cmdShow(args) {
  const opts = parseArgs(args);
  const projects = reader.listAllProjects();

  if (opts.help) {
    process.stdout.write(cmdObsHelp('show') + '\n');
    return;
  }

  let project = null;
  const arg = opts.positional[0];
  if (arg) {
    project = matchProject(projects, arg);
    if (!project) {
      console.error(`[dspec] 未找到项目: ${arg}`);
      console.error('运行 dspec obs list 查看可用项目。');
      process.exitCode = 1;
      return;
    }
  } else {
    // 交互式选择
    if (!projects.length) {
      console.error('[dspec] 暂无可观测项目。');
      process.exitCode = 1;
      return;
    }
    try {
      project = await promptProjectSelect(projects);
      if (!project) {
        console.error('[dspec] 未选择项目。');
        process.exitCode = 1;
        return;
      }
    } catch (e) {
      if (e && e.message === 'no-prompt-dep') {
        console.error('[dspec] 非交互环境或缺少交互库。请指定项目: dspec obs show <序号或路径>');
        console.error('运行 dspec obs list 查看可用项目。');
        process.exitCode = 1;
        return;
      }
      // 用户取消（Ctrl+C）等
      process.exitCode = 1;
      return;
    }
  }

  const summary = reader.buildProjectSummary(project);
  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }
  const htmlFile = writeDashboard(summary);
  dashboardOpener(htmlFile);
  process.stdout.write(`[dspec] 已生成并打开 obs 看板: ${htmlFile}\n`);
}

// ────────────────────────────── 入口分发 ──────────────────────────────

function cmdObsHelp(sub) {
  if (sub === 'list') {
    return `Usage: dspec obs list [--json]

列出所有接入过 dspec 的项目（路径 + 事件数 + 需求数 + 最后更新时间）。

Options:
  --json    输出结构化 JSON`;
  }
  if (sub === 'show') {
    return `Usage: dspec obs show [项目] [--json]

打开单个项目的 SDD 可观测 HTML 看板（总分/分项/docs 文件级使用/review 门禁）。

参数:
  项目      项目路径子串 / obs hash / 序号（见 dspec obs list）
            不带参数时交互式选择。

Options:
  --json    输出结构化 JSON，不打开 HTML`;
  }
  return `Usage: dspec obs <command> [options]

本地查看 SDD 可观测数据（合并 observe 被动层 + monitor 主动层）。

Commands:
  list                      列出所有项目
  show [项目]               打开单个项目 HTML 看板（默认交互式选择）

Options:
  --json                    输出结构化 JSON
  --help, -h                显示帮助

数据位置:
  observe:  ~/.dspec/obs/<hash>/events.jsonl
  monitor:  ~/.dspec/monitor/state/repos/<repoKey>/requirements/*.json
  （DSPEC_HOME_OVERRIDE 可重定向两处根目录）

Examples:
  dspec obs list
  dspec obs show                    # 交互式选择
  dspec obs show ~/my-project       # 按路径
  dspec obs show 1                  # 按序号
  dspec obs show --json`;
}

async function cmdObs(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(cmdObsHelp() + '\n');
    return;
  }

  if (sub === 'list') return cmdList(rest);
  if (sub === 'show') return cmdShow(rest);

  // 容错：dspec obs <项目> 当作 show
  if (sub.startsWith('-')) {
    process.stdout.write(cmdObsHelp() + '\n');
    return;
  }
  return cmdShow(argv);
}

module.exports = {
  cmdObs,
  cmdList,
  cmdShow,
  cmdObsHelp,
  parseArgs,
  matchProject,
  promptProjectSelect,
  renderList,
  renderSummary,
  renderDocsReadDetails,
  renderDocsFiles,
  buildDashboardData,
  renderDashboardHtml,
  writeDashboard,
  setDashboardOpener,
  setPromptSelect,
};
