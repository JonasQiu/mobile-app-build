/**
 * dspec Agents Installer
 *
 * 解析 `.agents/<platform>.yaml`（含单层 `extends`）并把 skills
 * 落地到目标项目：`.claude/skills/<name>/` 与 `.codex/skills/<name>/`。
 *
 * 设计要点（详见 openspec/changes/init-stack-aware-skills/design.md）：
 * - 用 `js-yaml` 解析清单，不自研 parser；
 * - 仅支持单层 `extends`，基清单不得再 extends；
 * - 清单 `skills` 必须是「仓内有目录」的文件型 skill，缺目录则抛错；
 * - 第一阶段不安装 slash command dispatcher，用户直接调用 DSpec stage skills；
 * - 不生成 `REQUIRED.md`，外部 skill 由 d-skills 单独安装。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { copyDirSync } = require('../schema/register');

const ALLOWED_PLATFORMS = ['h5', 'ios', 'android', 'harmony'];
const LEGACY_OPENSPEC_SKILLS = [
  'openspec-apply-change',
  'openspec-archive-change',
  'openspec-bulk-archive-change',
  'openspec-continue-change',
  'openspec-explore',
  'openspec-ff-change',
  'openspec-new-change',
  'openspec-onboard',
  'openspec-propose',
  'openspec-review-change',
  'openspec-sync-change',
  'openspec-sync-specs',
  'openspec-verify-change',
];

/**
 * 资产根目录。
 * SPEC_AGENTS_ROOT_OVERRIDE 仅供测试使用，使每个用例可以挂自己的 .agents fixture。
 */
function getAgentsRoot() {
  return process.env.DSPEC_AGENTS_ROOT_OVERRIDE || path.resolve(__dirname, '..', '..', '.agents');
}

/**
 * 读取 package.json 的 version，作为清单版本（清单 yaml 不再手写 version 字段，
 * 统一以发布包版本为准）。读不到时回退 '0.0.0'。
 */
function getPkgVersion() {
  try {
    const pkg = require('../../package.json');
    return (pkg && pkg.version) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 返回 native 子平台的专属清单路径（若存在）。
 * 用于外部查询，不影响 loadManifest 的叠加逻辑。
 *
 * @param {string} platform 'ios' | 'android' | 'harmony'
 * @returns {string|null} 专属清单绝对路径，不存在时返回 null
 */
function resolveManifestFile(platform) {
  const root = getAgentsRoot();
  const specific = path.join(root, `native.${platform}.yaml`);
  return fs.existsSync(specific) ? specific : null;
}

/**
 * 解析单个清单文件，展开一层 extends（基清单不得再 extends）。
 * 返回 { name, skills }（已合并 base）。
 *
 * @param {string} file  清单文件绝对路径
 * @param {string} label 用于错误信息的平台标识
 * @returns {{ name: string, skills: string[] }}
 */
function loadManifestFile(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`[dspec] 清单不存在：${file}`);
  }

  const current = parseYamlFile(file);
  let skills = Array.isArray(current.skills) ? [...current.skills] : [];

  if (current.extends) {
    const baseFile = path.resolve(path.dirname(file), current.extends);
    if (!fs.existsSync(baseFile)) {
      throw new Error(`[dspec] 基清单不存在：${baseFile}（来自 ${file}）`);
    }
    const base = parseYamlFile(baseFile);
    if (base.extends) {
      throw new Error(
        `[dspec] 不支持嵌套 extends：${file} → ${baseFile} → ${base.extends}（基清单不得再 extends）`
      );
    }
    // base 优先，当前清单追加；保留出现顺序，按字符串去重
    skills = unionDistinct(base.skills || [], skills);
  }

  return {
    name: current.name || label,
    skills,
  };
}

/**
 * 加载并合并清单。
 *
 * - h5：加载 h5.yaml（单层 extends base.yaml）
 * - native 子平台（ios/android/harmony）：
 *     1. 先完整展开 native.yaml（含 extends base.yaml）→ 基础 skills
 *     2. 若存在 native.<platform>.yaml，再叠加其 skills（无需写 extends）
 *     3. 两者取 unionDistinct，native.yaml 优先（顺序在前）
 *
 * @param {string} platform 'h5' | 'ios' | 'android' | 'harmony'
 * @returns {{ name: string, version: string, skills: string[] }}
 */
function loadManifest(platform) {
  const root = getAgentsRoot();
  const version = getPkgVersion();

  // h5：直接单文件展开
  if (platform === 'h5') {
    const file = path.join(root, 'h5.yaml');
    const m = loadManifestFile(file, 'h5-tools');
    return { ...m, version };
  }

  // native 子平台：先展开通用 native.yaml
  const nativeFile = path.join(root, 'native.yaml');
  const base = loadManifestFile(nativeFile, 'native-tools');

  let { name, skills } = base;
  name = `${platform}-tools`;

  // 叠加子平台专属清单（native.ios.yaml 等），无需写 extends
  const specificFile = path.join(root, `native.${platform}.yaml`);
  if (fs.existsSync(specificFile)) {
    const extra = parseYamlFile(specificFile);
    skills = unionDistinct(skills, Array.isArray(extra.skills) ? extra.skills : []);
    if (extra.name) name = extra.name;
  }

  return { name, version, skills };
}

/**
 * 用 js-yaml 解析单个文件，YAML 错误透传（含行列号）。
 */
function parseYamlFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    const data = yaml.load(text);
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    // js-yaml 的 YAMLException 自己有 toString，会忽略 err.message 改写——
    // 包成普通 Error 才能让上层断言匹配到「YAML 解析失败 + file 路径」。
    const wrapped = new Error(
      `[dspec] YAML 解析失败：${file} — ${err.message || err.reason || String(err)}`
    );
    wrapped.cause = err;
    throw wrapped;
  }
}

function unionDistinct(a, b) {
  const seen = new Set();
  const out = [];
  for (const item of [...a, ...b]) {
    if (typeof item !== 'string') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * 把每个 skill（按 path.basename 解析为目录名）从 `.agents/skills/<dir>/`
 * 整目录拷贝到 `<target>/.claude/skills/<dir>/`。
 * 缺目录抛错并中止；本期不处理外部 skill。返回已安装的 dir 名称列表。
 */
function installSkills(targetPath, skills) {
  const destBase = path.join(targetPath, '.claude', 'skills');
  fs.mkdirSync(destBase, { recursive: true });

  const installed = [];
  for (const entry of skills) {
    const dir = path.basename(entry);
    const src = path.join(getAgentsRoot(), 'skills', dir);
    const skillFile = path.join(src, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      throw new Error(
        `[dspec] 文件型 skill 不存在：${skillFile}（清单条目 "${entry}"；外部 MCP 请改用 d-skills 安装）`
      );
    }
    const dest = path.join(destBase, dir);
    fs.rmSync(dest, { recursive: true, force: true });
    copyDirSync(src, dest);
    installed.push(dir);
  }
  return installed;
}

/**
 * 把每个 skill 从 `.agents/skills/<dir>/` 整目录拷贝到
 * `<target>/.codex/skills/<dir>/`。
 * 与 installSkills 逻辑相同，目标目录改为 .codex/skills/。
 * 返回已安装的 dir 名称列表。
 */
function installCodexSkills(targetPath, skills) {
  const destBase = path.join(targetPath, '.codex', 'skills');
  fs.mkdirSync(destBase, { recursive: true });

  const installed = [];
  for (const entry of skills) {
    const dir = path.basename(entry);
    const src = path.join(getAgentsRoot(), 'skills', dir);
    const skillFile = path.join(src, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      throw new Error(
        `[dspec] 文件型 skill 不存在：${skillFile}（清单条目 "${entry}"；外部 MCP 请改用 d-skills 安装）`
      );
    }
    const dest = path.join(destBase, dir);
    fs.rmSync(dest, { recursive: true, force: true });
    copyDirSync(src, dest);
    installed.push(dir);
  }
  return installed;
}

/** 合法的 Agent 工具类型 */
const ALLOWED_TOOLS = ['claude', 'codex'];

/**
 * 入口：按 platform 解析清单 → 安装 skills（claude / codex）。
 *
 * @param {string}   targetPath 目标项目根目录的绝对路径
 * @param {string}   platform   'h5' | 'ios' | 'android' | 'harmony'
 * @param {string[]} tools      要安装的 Agent 工具列表，默认 ['claude']
 * @returns {{ skills: string[], codexSkills: string[] }}
 */
function installAgents(targetPath, platform, tools = ['claude']) {
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    throw new Error(
      `[dspec] 非法 platform: "${platform}"。可选值：${ALLOWED_PLATFORMS.join(', ')}`
    );
  }

  const manifest = loadManifest(platform);
  const removedLegacy = cleanLegacyOpenSpecAgents(targetPath);

  // 安装 .claude/skills/（claude 工具）
  const skills = tools.includes('claude')
    ? installSkills(targetPath, manifest.skills)
    : [];

  // 安装 .codex/skills/（codex 工具）
  const codexSkills = tools.includes('codex')
    ? installCodexSkills(targetPath, manifest.skills)
    : [];

  return { skills, codexSkills, removedLegacy };
}

/**
 * 删除 DSpec 历史版本安装到业务项目的 OpenSpec skills / slash commands。
 * 使用固定白名单，避免误删用户自行安装的其他 skill。
 */
function cleanLegacyOpenSpecAgents(targetPath) {
  const removed = [];
  for (const tool of ['.claude', '.codex']) {
    for (const skill of LEGACY_OPENSPEC_SKILLS) {
      const dir = path.join(targetPath, tool, 'skills', skill);
      if (!fs.existsSync(dir)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(path.relative(targetPath, dir));
    }
  }
  for (const commandGroup of ['openspec', 'opsx']) {
    const dir = path.join(targetPath, '.claude', 'commands', commandGroup);
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(path.relative(targetPath, dir));
  }
  return removed;
}

module.exports = {
  installAgents,
  loadManifest,
  resolveManifestFile,
  installSkills,
  installCodexSkills,
  cleanLegacyOpenSpecAgents,
  LEGACY_OPENSPEC_SKILLS,
  ALLOWED_PLATFORMS,
  ALLOWED_TOOLS,
};
