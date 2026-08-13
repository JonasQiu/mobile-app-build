/**
 * dspec upgrade [--pm <pnpm|npm|yarn>] [--dry-run] [-f|--force]
 *
 * 升级**全局 CLI 包**（@didi/dspec 本身）到最新版。
 *
 * 与 dspec update 的边界（关键区分）：
 *   - dspec update  —— 刷新**项目资产**（schema / agents / config / hooks），不碰 CLI 二进制
 *   - dspec upgrade —— 升级**全局 CLI 二进制**（@didi/dspec 包），不碰项目资产
 *                     （完成后仅提示用户手动跑 dspec update 刷新项目资产）
 *
 * 流程：
 *   1. 解析参数：--pm（显式指定包管理器）/ --dry-run（只打印不执行）/ -f --force（跳过版本比较）
 *   2. 决定包管理器：显式 --pm 优先；否则 detectPackageManager() 自动检测
 *   3. 取当前版本：从运行中 CLI 同级 package.json 读取
 *   4. 查最新版本：npm view @didi/dspec version（npm 随 node 安装、总是可用；自动读 ~/.npmrc 命中内网源）
 *      - current >= latest → 打印「已是最新」并返回
 *      - --force → 跳过版本比较直接安装
 *   5. 执行安装：按 pm 映射的全局安装命令（execFileSync，stdio inherit）
 *   6. 提示用户手动跑 dspec update 刷新项目资产
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pkg = require('../../package.json');

const ALLOWED_PMS = ['pnpm', 'npm', 'yarn'];

/**
 * 解析参数：dspec upgrade [--pm <pnpm|npm|yarn>] [--dry-run] [-f|--force]
 *
 * @returns {{ pm: string|null, dryRun: boolean, force: boolean }}
 */
function parseUpgradeArgs(args) {
  let pm = null;
  let dryRun = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--pm') && args[i + 1]) {
      pm = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '-f' || arg === '--force') {
      force = true;
    } else if (!arg.startsWith('-')) {
      // upgrade 不接受位置参数；忽略避免误用（如 dspec upgrade ./path）
    }
  }

  if (pm !== null && !ALLOWED_PMS.includes(pm)) {
    console.error(
      `[dspec] 非法 --pm 值: "${pm}"。可选值：${ALLOWED_PMS.join(', ')}`
    );
    process.exit(1);
  }

  return { pm, dryRun, force };
}

/**
 * 自动检测包管理器。两级信号，优先级递减：
 *
 *   1. 运行脚本路径（process.argv[1]，即当前 dspec.js 绝对路径）—— 最权威
 *      - 含 'pnpm/global' 或 '/.pnpm/@didi+dspec@' → pnpm
 *        （pnpm 全局：~/Library/pnpm/global/5/.pnpm/@didi+dspec@<ver>_.../node_modules/@didi/dspec/bin/dspec.js）
 *      - 含 'lib/node_modules/@didi/dspec'（无 pnpm 标记）→ npm
 *      - 含 'yarn' 或 'Yarn' → yarn
 *   2. npm_config_user_agent 环境变量（回退）—— 形如 pnpm/9.x / npm/10.x / yarn/1.x
 *   3. 默认 → npm（最通用，node 自带）
 *
 * @param {string} [scriptPath]  运行中 CLI 脚本绝对路径，默认 process.argv[1]
 * @param {object} [env]         环境变量，默认 process.env
 * @returns {'pnpm'|'npm'|'yarn'}
 */
function detectPackageManager(scriptPath, env) {
  const sp = scriptPath || (process.argv[1] || '');
  const e = env || process.env;

  // 1. 运行脚本路径（最权威：反映 CLI 实际由哪个 pm 安装）
  const norm = sp.replace(/\\/g, '/');
  if (norm.includes('pnpm/global') || norm.includes('/.pnpm/@didi+dspec@')) {
    return 'pnpm';
  }
  if (norm.includes('yarn') || norm.includes('Yarn')) {
    return 'yarn';
  }
  if (norm.includes('lib/node_modules/@didi/dspec') || norm.includes('node_modules/@didi/dspec')) {
    // 排除已判过的 pnpm 路径后，含 node_modules/@didi/dspec 视为 npm 全局
    return 'npm';
  }

  // 2. npm_config_user_agent 环境变量（回退）
  const ua = e.npm_config_user_agent || '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('npm')) return 'npm';

  // 3. 默认
  return 'npm';
}

/**
 * 极简 semver 比较（不引依赖，与项目零运行时依赖风格一致）。
 * 仅比较数字段（major.minor.patch），预发布后缀（如 -beta.4）忽略。
 * 对于 prerelease，认为带后缀 < 同版本无后缀（beta 先于正式发布）。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}  1 if a>b, -1 if a<b, 0 if equal
 */
function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  // 数字段全等：无预发布 > 有预发布
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre && pb.pre) {
    // 比较预发布号（如 beta.4 vs beta.5）按数字逐段
    const na = pa.pre.split('.').map(x => parseInt(x, 10) || 0);
    const nb = pb.pre.split('.').map(x => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const xa = na[i] || 0;
      const xb = nb[i] || 0;
      if (xa !== xb) return xa > xb ? 1 : -1;
    }
  }
  return 0;
}

/**
 * 把版本串拆成 { nums: [major,minor,patch], pre: 'beta.4'|null }。
 * 只处理 x.y.z 和 x.y.z-pre.N 两种形态（本包唯一在用）。
 */
function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!m) {
    // 解析失败兜底：按 0.0.0 处理，避免比较时 NaN
    return { nums: [0, 0, 0], pre: null };
  }
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || null };
}

/**
 * 按 pm 映射全局安装命令。
 *
 * @param {'pnpm'|'npm'|'yarn'} pm
 * @returns {{ cmd: string, args: string[] }}
 */
function getInstallCommand(pm) {
  switch (pm) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['add', '-g', '@didi/dspec@latest'] };
    case 'yarn':
      // yarn classic 全局安装；berry 已弃用 global，仍用 classic 写法
      return { cmd: 'yarn', args: ['global', 'add', '@didi/dspec'] };
    case 'npm':
    default:
      return { cmd: 'npm', args: ['install', '-g', '@didi/dspec@latest'] };
  }
}

/**
 * 用指定包管理器安装最新版，并复用 upgrade 命令的唯一安装命令映射。
 *
 * @param {'pnpm'|'npm'|'yarn'} pm
 * @param {({cmd:string,args:string[]}) => void} [runInstall]
 * @returns {{ cmd: string, args: string[] }}
 */
function installLatestVersion(pm, runInstall) {
  const command = getInstallCommand(pm);
  const install = runInstall || (({ cmd, args }) => {
    execFileSync(cmd, args, { stdio: 'inherit' });
  });
  install(command);
  return command;
}

/**
 * 查询 npm registry 上的最新版本（npm 随 node 安装、总是可用；自动读 ~/.npmrc 命中内网源）。
 * 返回 stdout 首行 trim 即版本号；失败抛错。
 *
 * @returns {string}  最新版本号
 */
function queryLatestVersion() {
  const out = execFileSync('npm', ['view', '@didi/dspec', 'version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return out.trim().split(/\r?\n/)[0].trim();
}

/**
 * 取运行中 CLI 的当前版本：优先从运行脚本同级 package.json 读取
 * （而非本包 package.json，避免 require 缓存读到开发态版本而非已安装版本）。
 *
 * @param {string} [scriptPath]  运行中 CLI 脚本路径，默认 process.argv[1]
 * @returns {string}
 */
function getCurrentVersion(scriptPath) {
  const sp = scriptPath || (process.argv[1] || '');
  if (sp) {
    try {
      // bin/dspec.js → ../package.json
      const pkgPath = path.resolve(path.dirname(sp), '..', 'package.json');
      const installed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (installed && installed.version) return installed.version;
    } catch {
      // 回退到 require('../../package.json')
    }
  }
  return pkg.version;
}

/**
 * upgrade 命令入口。
 *
 * @param {string[]} args  命令行参数（已去掉 'upgrade' 本身）
 * @param {object} [opts]  测试注入：
 *   - scriptPath {string}      运行脚本路径（默认 process.argv[1]）
 *   - env {object}             环境变量（默认 process.env）
 *   - queryLatest {() => string}  最新版本查询器（默认 queryLatestVersion）
 *   - runInstall {({cmd,args}) => void}  安装执行器（默认 execFileSync）
 */
async function cmdUpgrade(args, opts = {}) {
  const { pm: explicitPm, dryRun, force } = parseUpgradeArgs(args);
  const scriptPath = opts.scriptPath || (process.argv[1] || '');
  const env = opts.env || process.env;

  const pm = explicitPm || detectPackageManager(scriptPath, env);
  const current = getCurrentVersion(scriptPath);

  console.log(`\ndspec upgrade  (pm: ${pm})  当前版本: ${current}\n`);

  // 版本检查（--force 跳过）
  if (!force) {
    const queryLatest = opts.queryLatest || queryLatestVersion;
    let latest;
    try {
      latest = queryLatest();
    } catch (err) {
      const detail = (err && err.message) || String(err);
      console.warn(
        `[dspec] 查询最新版本失败：${detail}\n` +
        `        可加 --force 跳过版本检查直接安装。`
      );
      process.exit(1);
    }
    console.log(`  最新版本: ${latest}`);

    const cmp = compareVersions(current, latest);
    if (cmp >= 0) {
      console.log('\n已是最新版本，无需升级。');
      return;
    }
    console.log(`  → 将升级：${current}  ⇒  ${latest}\n`);
  }

  const { cmd, args: cmdArgs } = getInstallCommand(pm);
  const cmdLine = `${cmd} ${cmdArgs.join(' ')}`;

  if (dryRun) {
    console.log(`[dry-run] 将执行：${cmdLine}`);
    return;
  }

  installLatestVersion(pm, opts.runInstall);

  console.log('\n升级完成。');
  console.log('💡 如需刷新当前项目资产（schema / agents / config），请运行：dspec update');
}

module.exports = {
  cmdUpgrade,
  parseUpgradeArgs,
  detectPackageManager,
  compareVersions,
  parseSemver,
  getInstallCommand,
  installLatestVersion,
  queryLatestVersion,
  getCurrentVersion,
  ALLOWED_PMS,
};
