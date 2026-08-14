/**
 * mobile-spec init [path] [-p|--platform <h5|native>] [-f|--force] [--tools <tools>]
 *
 * 步骤序列：
 *   0. confirmOverwriteAll                  若 openspec/config.yaml 或 openspec/README.md 已存在
 *                                            → TTY 弹 confirm；非 TTY 报错；--force 跳过提示
 *   1. copySchemaToUserDir(<schema>)        把包内 schemas/<schema>/schema/ 拷到
 *                                            ~/.local/share/openspec/schemas/<schema>/（XDG 用户级真实目录）
 *                                            openspec resolver 从此处直接读取，无需项目级 symlink
 *   2. installAgents(targetPath, platform)  按 .agents/<platform>.yaml 装 skills
 *   3. writeConfig                          写 openspec/config.yaml（schema 按 platform 选）
 *   4. writeReadme                          写 openspec/README.md
 *
 * 不再调用 npx @fission-ai/openspec init；不再 scaffold openspec/context/（用户自管）。
 */

const fs = require('fs');
const path = require('path');
const {
  copySchemaToUserDir,
  platformToSchema,
  resolveSchemaConfigFile,
  getPackageSchemaDir,
  getUserSchemasDir,
  getMobileSpecSchemasDir,
  stageSchemaToMobileSpecDir,
  removePath,
  PLATFORM_TO_SCHEMA,
} = require('../schema/register');
const { installAgents, ALLOWED_PLATFORMS, ALLOWED_TOOLS } = require('../install/agents');
const { migrateLegacyWorkflowState } = require('../workflow/storage');

const README_TEMPLATE = path.resolve(__dirname, '..', '..', 'schemas', 'openspec-readme.md');

/**
 * 当用户没传 -p / --platform 时调用：
 * - TTY 环境（process.stdin.isTTY）：用 @inquirer/prompts 的 select 弹出
 *   带方向键 + 高亮的菜单（h5 / native）。
 * - 非 TTY 环境（CI、管道、`< /dev/null`）：直接报错退出。
 *
 * @inquirer/prompts 是 ESM 包，本文件是 CJS，因此通过动态 import() 异步加载，
 * 仅在真正需要 prompt 时才付出 import 成本（指定 -p 的常规调用零开销）。
 *
 * 通过 opts 注入 stdin/stdout 便于测试（@inquirer/prompts 的 select 接受
 * { input, output } 选项，与其内部 readline 实现解耦）。
 */
async function promptPlatform(opts = {}) {
  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const isTTY = opts.isTTY != null ? opts.isTTY : Boolean(stdin.isTTY);

  if (!isTTY) {
    stderr.write(
      `[mobile-spec] 未指定 platform，且当前为非交互环境（非 TTY）。\n` +
      `        请显式传 --platform <h5|ios|android|harmony> 或 -p <h5|ios|android|harmony>。\n` +
      `        可选值：${ALLOWED_PLATFORMS.join(', ')}\n`
    );
    process.exit(1);
  }

  // 动态 import：CJS 调 ESM 唯一受官方支持的方式；
  // 测试中可通过 opts.select 注入 stub，避免触发真实的 readline keypress。
  const select = opts.select || (await import('@inquirer/prompts')).select;
  return select(
    {
      message: '请选择目标平台 platform',
      choices: [
        { name: 'h5      —— H5',                value: 'h5' },
        { name: 'ios     —— iOS (Native)',       value: 'ios' },
        { name: 'android —— Android (Native)',   value: 'android' },
        { name: 'harmony —— Harmony (Native)',   value: 'harmony' },
      ],
    },
    { input: stdin, output: stdout }
  );
}

/**
 * 当用户没传 --tools 时调用：
 * - TTY 环境：用 @inquirer/prompts 的 checkbox 弹出多选菜单（claude / codex）。
 *   claude 默认勾选；全不选时回退 ['claude']。
 * - 非 TTY 环境：静默返回 ['claude']，不报错（tools 有合理默认值）。
 *
 * 通过 opts 注入 stdin/stdout/checkbox 便于测试。
 */
async function promptTools(opts = {}) {
  const stdin  = opts.stdin  || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const isTTY  = opts.isTTY != null ? opts.isTTY : Boolean(stdin.isTTY);

  if (!isTTY) {
    return ['claude'];
  }

  const checkbox = opts.checkbox || (await import('@inquirer/prompts')).checkbox;
  const selected = await checkbox(
    {
      message: '您希望安装到哪些 agents？（空格勾选，回车确认）',
      choices: [
        { name: 'claude  —— Claude Code (.claude/skills/)', value: 'claude', checked: true },
        { name: 'codex   —— OpenAI Codex (.codex/skills/)',  value: 'codex',  checked: false },
      ],
    },
    { input: stdin, output: stdout }
  );

  // 全不选时回退 ['claude']
  return selected.length > 0 ? selected : ['claude'];
}

/**
 * 检测 init 即将覆盖的现有用户文件，向用户求确认。
 *
 * - existing 为空 → 直接通过；
 * - opts.force === true → 跳过提示直接通过；
 * - 非 TTY → 列出冲突文件并报错退出（提示用 --force 强制覆盖）；
 * - TTY → @inquirer/prompts.confirm，默认 N；
 *   选 N 退出（exit code 0，视为用户主动取消）。
 */
async function confirmOverwriteAll(existing, opts = {}) {
  if (existing.length === 0) return;

  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const force = Boolean(opts.force);
  const isTTY = opts.isTTY != null ? opts.isTTY : Boolean(stdin.isTTY);

  if (force) {
    stdout.write(`[mobile-spec] --force 已指定，将覆盖以下已存在文件：\n`);
    for (const f of existing) stdout.write(`        - ${f}\n`);
    return;
  }

  if (!isTTY) {
    stderr.write(
      `[mobile-spec] 检测到目标项目已存在以下文件，init 将覆盖它们：\n` +
      existing.map(f => `        - ${f}\n`).join('') +
      `        当前为非交互环境（非 TTY），无法弹出确认。\n` +
      `        若确认覆盖，请重跑命令并加上 --force / -f。\n`
    );
    process.exit(1);
  }

  const confirm = opts.confirm || (await import('@inquirer/prompts')).confirm;
  const answer = await confirm(
    {
      message:
        `检测到目标项目已存在以下文件，init 将覆盖它们：\n` +
        existing.map(f => `  - ${f}`).join('\n') +
        `\n是否继续？`,
      default: true,
    },
    { input: stdin, output: stdout }
  );

  if (!answer) {
    stdout.write('[mobile-spec] 已取消（未做任何修改）。\n');
    process.exit(0);
  }
}

/**
 * 找出 init 写入路径上**已存在**的文件，用于二次确认。
 * 不包含 .claude/skills/——它们由清单全权管理，
 * 视为 mobile-spec 的资产覆盖范围。
 */
function detectOverwriteTargets(targetPath) {
  const candidates = [
    'openspec/config.yaml',
    'openspec/README.md',
  ];
  return candidates.filter(rel => fs.existsSync(path.join(targetPath, rel)));
}

/**
 * 读取 schemas/<schemaName>/config[.<platform>].yaml 作为项目 config 模板。
 * 优先使用平台专属文件（如 config.ios.yaml），不存在则回退到 config.yaml。
 */
function buildConfigContent(platform) {
  const schemaName = platformToSchema(platform);
  const configTpl = resolveSchemaConfigFile(schemaName, platform);
  return fs.readFileSync(configTpl, 'utf8');
}

function writeConfig(targetPath, platform) {
  const openspecDir = path.join(targetPath, 'openspec');
  const configFile = path.join(openspecDir, 'config.yaml');

  fs.mkdirSync(openspecDir, { recursive: true });
  fs.writeFileSync(configFile, buildConfigContent(platform), 'utf8');
}

function writeReadme(targetPath) {
  const readmeFile = path.join(targetPath, 'openspec', 'README.md');
  fs.copyFileSync(README_TEMPLATE, readmeFile);
}

/**
 * 解析参数：mobile-spec init [path] [-p|--platform <h5|native>] [-f|--force] [--tools <tools>]
 * 当未指定 -p 时返回 platform=null，由调用方触发 promptPlatform。
 * 当未指定 --tools 时返回 tools=null，由调用方触发 promptTools。
 * --tools 接受逗号分隔值：--tools claude,codex → ['claude', 'codex']
 *
 * @returns {{ targetPath: string, platform: string|null, tools: string[]|null, force: boolean }}
 */
function parseInitArgs(args) {
  let targetPath = process.cwd();
  let platform = null;
  let tools = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-p' || arg === '--platform') && args[i + 1]) {
      platform = args[++i];
    } else if (arg === '--tools' && args[i + 1]) {
      tools = args[++i].split(',').map(t => t.trim()).filter(Boolean);
    } else if (arg === '-f' || arg === '--force') {
      force = true;
    } else if (!arg.startsWith('-')) {
      targetPath = path.resolve(arg);
    }
  }

  if (platform !== null && !ALLOWED_PLATFORMS.includes(platform)) {
    console.error(
      `[mobile-spec] 非法 --platform 值: "${platform}"。可选值：${ALLOWED_PLATFORMS.join(', ')}`
    );
    process.exit(1);
  }

  if (tools !== null) {
    const invalid = tools.filter(t => !ALLOWED_TOOLS.includes(t));
    if (invalid.length > 0) {
      console.error(
        `[mobile-spec] 非法 --tools 值: "${invalid.join(', ')}"。可选值：${ALLOWED_TOOLS.join(', ')}`
      );
      process.exit(1);
    }
  }

  return { targetPath, platform, tools, force };
}

/**
 * 检测并删除项目内的遗留 schema 目录（旧版 symlink 或真实目录）。
 * 旧版 mobile-spec 曾在项目级写入：
 *   openspec/schemas/<schemaName>/  或  openspec/schema/<schemaName>/
 * 现已改为 User Scope 托管，项目级目录应清理，避免 openspec resolver
 * 优先读取项目级旧版本而忽略用户级最新版本。
 *
 * 注意：一次性清理所有已知 schema 名（h5-sdd / native-sdd），
 * 不限于当前 platform，避免另一个 platform 的遗留目录残留。
 *
 * @param {string} targetPath  项目根目录
 * @returns {string[]}  被删除的相对路径列表（空则无遗留）
 */
function cleanProjectSchemaDirs(targetPath) {
  const allSchemaNames = Object.values(PLATFORM_TO_SCHEMA); // ['h5-sdd', 'native-sdd']
  const removed = [];
  for (const schemaName of allSchemaNames) {
    const candidates = [
      path.join(targetPath, 'openspec', 'schemas', schemaName),
      path.join(targetPath, 'openspec', 'schema',  schemaName),
    ];
    for (const dir of candidates) {
      try { fs.lstatSync(dir); } catch { continue; }
      removePath(dir);
      removed.push(path.relative(targetPath, dir));
    }
  }
  return removed;
}

function printExtensionHint() {
  console.log('💡 外部需求源、设计源和验证工具可通过标准 URL 或自定义 Adapter 接入。');
}

/**
 * 将多个条目格式化为对齐的多行输出：
 *   第一行：  {label}  → {prefix}{items[0]}/
 *   后续行：            → {items[1]}/
 *            （对齐到 → 符号位置）
 *
 * @param {string} label   左侧标签，如 'skills'（含 ✓ 前缀由调用方加）
 * @param {string} prefix  第一行目录前缀，如 '.claude/skills/'
 * @param {string[]} items 条目名列表
 * @param {number} labelWidth 标签列宽（用于对齐），默认 10
 * @returns {string}
 */
function formatItems(label, prefix, items, labelWidth = 10, trailingSlash = true) {
  const pad = ' '.repeat(labelWidth + 6); // '  ✓ ' (4) + label + '  → ' (4) 对齐后续行
  const arrow = '→';
  const suffix = trailingSlash ? '/' : '';
  const first = `  ✓ ${label.padEnd(labelWidth)}${arrow} ${prefix}${items[0]}${suffix}`;
  if (items.length === 1) return first;
  const rest = items.slice(1).map(item => `${pad}${arrow} ${item}${suffix}`);
  return [first, ...rest].join('\n');
}

async function cmdInit(args, _opts = {}) {
  const parsed = parseInitArgs(args);
  const platform = parsed.platform || await promptPlatform(_opts);
  const tools    = parsed.tools    || await promptTools(_opts);
  const targetPath = parsed.targetPath;
  const schemaName = platformToSchema(platform);

  // 0. 二次确认覆盖：列出 openspec/config.yaml / openspec/README.md 中已存在的文件
  fs.mkdirSync(targetPath, { recursive: true });
  const existing = detectOverwriteTargets(targetPath);
  await confirmOverwriteAll(existing, { force: parsed.force, ..._opts });

  console.log(`\nmobile-spec init  ${platform} · ${targetPath}\n`);

  // 1a. 把包内 schema 暂存到 ~/.mobile-spec/schemas/<name>/
  stageSchemaToMobileSpecDir(schemaName);
  const schemaMobileSpecDir = path.join(getMobileSpecSchemasDir(), schemaName);
  console.log(`  ✓ staged    → ${schemaMobileSpecDir}`);

  // 1b. 从 ~/.mobile-spec/ 安装到 openspec 用户级真实目录（~/.local/share/openspec/schemas/<name>/）
  //     openspec resolver 直接从用户级目录读取，无需项目级 symlink
  copySchemaToUserDir(schemaName);
  const schemaUserDir = path.join(getUserSchemasDir(), schemaName);
  console.log(`  ✓ schema    → ${schemaUserDir}`);

  // 1c. 清理项目级遗留 schema 目录（旧 symlink 或旧目录，现已 User Scope 托管）
  const removedDirs = cleanProjectSchemaDirs(targetPath);
  for (const rel of removedDirs) {
    console.log(`  ✓ cleaned   → ${rel} (legacy)`);
  }

  // 2. 按 platform + tools 安装 skills
  const { skills, codexSkills, removedLegacy } = installAgents(targetPath, platform, tools);
  for (const rel of removedLegacy) {
    console.log(`  ✓ cleaned   → ${rel} (legacy OpenSpec agent)`);
  }
  if (skills.length > 0) {
    console.log(formatItems('skills  ', '.claude/skills/', skills));
  }
  if (codexSkills.length > 0) {
    console.log(formatItems('codex   ', '.codex/skills/', codexSkills));
  }
  // 3. 写 openspec/config.yaml
  writeConfig(targetPath, platform);
  console.log(`  ✓ config    → openspec/config.yaml`);

  // 4. 写 openspec/README.md
  writeReadme(targetPath);

  // 5. 迁移历史版本落在业务项目内的 workflow sidecar
  const migration = migrateLegacyWorkflowState(targetPath);
  if (migration.migrated.length > 0) {
    console.log(`  ✓ migrated  → ~/.mobile-spec/workflow/ (${migration.migrated.length} files)`);
  }
  if (migration.conflicts.length > 0) {
    console.log(`\n⚠️  ${migration.conflicts.length} 个旧 workflow 文件与用户目录状态冲突，已保留原文件`);
  }

  console.log('\n初始化完成，重启 IDE 后 Mobile Spec skills 生效。');
  printExtensionHint();
}

module.exports = {
  cmdInit,
  writeConfig,
  parseInitArgs,
  buildConfigContent,
  printExtensionHint,
  promptPlatform,
  promptTools,
  confirmOverwriteAll,
  detectOverwriteTargets,
  cleanProjectSchemaDirs,
  formatItems,
};
