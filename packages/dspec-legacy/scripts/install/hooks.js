/**
 * dspec 观察兜底 hook 安装器（install-hooks）
 *
 * 由 `dspec init / update` 调用，把**机制强制兜底层**接入目标项目：
 *   1. 拷 `.agents/hooks/observe.js` → `<target>/.claude/hooks/observe.js` 与
 *      `<target>/.codex/hooks/observe.js`（覆盖式，替换版本占位符）。
 *   2. **幂等合并**注入 Claude `.claude/settings.json` 与 Codex `.codex/hooks.json`：
 *      在 UserPromptSubmit /
 *      PostToolUse / Stop 下追加 dspec 兜底项；保留用户已有 hooks，按 command 中的
 *      `dspec-observe` 标记去重（重复 update 只替换本工具的项）。
 *
 * 这是主动埋点（dspec monitor）的**机制强制兜底**：PostToolUse 由 Claude Code 运行时
 * 强制触发，不依赖 LLM 自觉，补全主动埋点的漏埋。installHooks 的 observe 选项（默认 true）
 * 为内部机制，CLI 层 init/update 无条件调用。
 *
 * settings.json 只合并不覆盖（保留 permissions/env/statusLine 等顶层字段）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DSPEC_OBSERVE_TAG = 'dspec-observe';

function getAgentsRoot() {
  return process.env.DSPEC_AGENTS_ROOT_OVERRIDE || path.resolve(__dirname, '..', '..', '.agents');
}

function getVersion() {
  try {
    const pkg = require('../../package.json');
    return (pkg && pkg.version) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readSettings(targetPath) {
  const f = path.join(targetPath, '.claude', 'settings.json');
  try {
    if (!fs.existsSync(f)) return {};
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

function writeSettings(targetPath, settings) {
  const f = path.join(targetPath, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function readCodexHooks(targetPath) {
  const f = path.join(targetPath, '.codex', 'hooks.json');
  try {
    if (!fs.existsSync(f)) return {};
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

function writeCodexHooks(targetPath, settings) {
  const f = path.join(targetPath, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function stripDSpecHooks(arr) {
  const out = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      out.push(entry);
      continue;
    }
    const hs = Array.isArray(entry.hooks) ? entry.hooks : [];
    const kept = hs.filter(
      (h) => !(h && typeof h.command === 'string' && h.command.includes(DSPEC_OBSERVE_TAG))
    );
    if (kept.length === hs.length) {
      out.push(entry);
    } else if (kept.length > 0) {
      out.push(Object.assign({}, entry, { hooks: kept }));
    }
  }
  return out;
}

/**
 * 安装兜底 hook。
 * @param {string} targetPath 目标项目根（绝对路径）
 * @param {{ observe?: boolean }} opts  observe=false 时跳过（内部选项，CLI 层默认不传即安装）
 * @returns {{ skipped: boolean, hooksInstalled?: string[], observeScript?: string }}
 */
function installHooks(targetPath, opts = {}) {
  const observe = opts.observe !== false;
  if (!observe) return { skipped: true };
  const tools = Array.isArray(opts.tools) && opts.tools.length
    ? new Set(opts.tools)
    : new Set(['claude', 'codex']);

  const srcHook = path.join(getAgentsRoot(), 'hooks', 'observe.js');
  if (!fs.existsSync(srcHook)) {
    throw new Error(`[dspec] 观察脚本不存在：${srcHook}（请检查 .agents/hooks/）`);
  }
  let hookText = fs.readFileSync(srcHook, 'utf8');
  hookText = hookText.replace(/__DSPEC_VERSION__/g, getVersion());
  const destinations = [
    ...(tools.has('claude') ? ['.claude'] : []),
    ...(tools.has('codex') ? ['.codex'] : []),
  ].map((runtime) => {
    const dest = path.join(targetPath, runtime, 'hooks', 'observe.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, hookText, 'utf8');
    return dest;
  });

  const configs = [
    tools.has('claude') && {
      value: readSettings(targetPath),
      write: (value) => writeSettings(targetPath, value),
      command: `node "\${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/observe.js" # ${DSPEC_OBSERVE_TAG}`,
    },
    tools.has('codex') && {
      value: readCodexHooks(targetPath),
      write: (value) => writeCodexHooks(targetPath, value),
      command: `node "$(git rev-parse --show-toplevel)/.codex/hooks/observe.js" # ${DSPEC_OBSERVE_TAG}`,
    },
  ].filter(Boolean);
  const eventNames = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
  for (const config of configs) {
    if (!config.value.hooks || typeof config.value.hooks !== 'object' || Array.isArray(config.value.hooks)) {
      config.value.hooks = {};
    }
    for (const eventName of eventNames) {
      const arr = Array.isArray(config.value.hooks[eventName])
        ? stripDSpecHooks(config.value.hooks[eventName])
        : [];
      arr.push({
        ...(eventName === 'PostToolUse' ? { matcher: '*' } : {}),
        hooks: [{ type: 'command', command: config.command, timeout: eventName === 'Stop' ? 10 : 5 }],
      });
      config.value.hooks[eventName] = arr;
    }
    config.write(config.value);
  }

  return {
    skipped: false,
    hooksInstalled: eventNames,
    observeScript: destinations[0],
    observeScripts: destinations,
  };
}

module.exports = {
  installHooks,
  readSettings,
  writeSettings,
  readCodexHooks,
  writeCodexHooks,
  stripDSpecHooks,
  getVersion,
  getAgentsRoot,
  DSPEC_OBSERVE_TAG,
};
