/**
 * mobile-spec update [path] [-p|--platform <h5|ios|android|harmony>]
 *
 * 1. 解析 platform：显式 -p / --platform 优先，否则从 openspec/config.yaml 推断
 *    - platform: ios/android/harmony → 直接使用（优先）
 *    - schema: h5-sdd               → platform=h5
 *    - schema: native-sdd（无 platform 字段）→ TTY 弹选择，非 TTY 报错
 *    - 缺失或不可识别               → 报错，提示显式 --platform
 * 2. 用包内最新 schemas/<schema>/schema/ 覆盖 ~/.local/share/openspec/schemas/<schema>/
 * 3. 重建 openspec/schemas/<schema> symlink
 * 4. installAgents() 覆写 .claude/skills/<name>/ 与 .codex/skills/<name>/
 * 5. 已有 config 时询问是否按新模板完整覆盖；拒绝或非 TTY 时仅同步 schema/platform
 * 6. ensureReadme（缺失才写；不再 scaffold openspec/context/，由用户自管）
 * 7. 删除旧版 OpenSpec skills / commands，并迁移项目内 workflow sidecar
 */

const fs = require('fs');
const path = require('path');
const {
  copySchemaToUserDir,
  platformToSchema,
  getUserSchemasDir,
  getMobileSpecSchemasDir,
  stageSchemaToMobileSpecDir,
  PLATFORM_TO_SCHEMA,
} = require('../schema/register');
const { installAgents, ALLOWED_PLATFORMS, ALLOWED_TOOLS } = require('../install/agents');
const { installHooks } = require('../install/hooks');
const { installMonitor } = require('../install/monitor');
const { migrateLegacyWorkflowState } = require('../workflow/storage');
const {
  buildConfigContent,
  printDSkillsHint,
  promptPlatform,
  promptTools,
  formatItems,
} = require('./init');

const README_TEMPLATE = path.resolve(__dirname, '..', '..', 'schemas', 'openspec-readme.md');

// schema → 唯一可确定的 platform 反查表
// native-sdd 映射到多个子平台，反查时返回 null（由 platform 字段或 TTY 补全）
const SCHEMA_TO_PLATFORM = {
  'h5-sdd': 'h5',
  'native-sdd': null,
};

/**
 * 解析参数：mobile-spec update [path] [-p|--platform <name>] [--tools <tools>]
 * --tools 接受逗号分隔值：--tools claude,codex → ['claude', 'codex']
 * 未传 --tools 时返回 tools=null，由 cmdUpdate 触发 promptTools。
 */
function parseUpdateArgs(args) {
  let targetPath = process.cwd();
  let explicitPlatform = null;
  let tools = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-p' || arg === '--platform') && args[i + 1]) {
      explicitPlatform = args[++i];
    } else if (arg === '--tools' && args[i + 1]) {
      tools = args[++i].split(',').map(t => t.trim()).filter(Boolean);
    } else if (!arg.startsWith('-')) {
      targetPath = path.resolve(arg);
    }
  }

  if (explicitPlatform !== null && !ALLOWED_PLATFORMS.includes(explicitPlatform)) {
    console.error(
      `[mobile-spec] 非法 --platform 值: "${explicitPlatform}"。可选值：${ALLOWED_PLATFORMS.join(', ')}`
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

  return { targetPath, explicitPlatform, tools };
}

/**
 * 从 config.yaml 推断 platform，两级策略：
 *   1. `platform: <value>` 字段优先（如 ios/android/harmony/h5）
 *   2. 回退读 `schema:` 字段 → SCHEMA_TO_PLATFORM 反查
 *      - h5-sdd     → h5（唯一映射，确定）
 *      - native-sdd → null（无法确定子平台，需用户选择）
 */
function inferPlatformFromConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  const content = fs.readFileSync(configPath, 'utf8');

  // 优先读 platform: 字段
  const platformMatch = content.match(/^platform:\s*([\w-]+)/m);
  if (platformMatch) {
    const p = platformMatch[1];
    if (ALLOWED_PLATFORMS.includes(p)) return p;
  }

  // 回退读 schema: 字段
  const schemaMatch = content.match(/^schema:\s*([\w-]+)/m);
  if (!schemaMatch) return null;
  const schemaName = schemaMatch[1];
  return SCHEMA_TO_PLATFORM[schemaName] || null;
}

/**
 * 决定本次 update 使用的 platform：显式 > 推断 > 交互（TTY） / 报错（非 TTY）。
 *
 * 推断失败的常见原因：
 *   - config.yaml 不存在
 *   - schema: native-sdd 但 platform: 字段缺失（旧版 config 或字段被删除）
 * 两种情况均 TTY 弹出子平台选择，非 TTY 报错。
 */
async function resolvePlatform(targetPath, explicitPlatform) {
  if (explicitPlatform) return explicitPlatform;

  const configPath = path.join(targetPath, 'openspec', 'config.yaml');
  const inferred = inferPlatformFromConfig(configPath);
  if (inferred) return inferred;

  // 推断失败（含 native-sdd 无 platform 字段的情况）：TTY 弹出选择，非 TTY 报错
  console.error(
    `[mobile-spec] 无法从 ${configPath} 推断具体子平台，请选择或先运行 \`mobile-spec init\`。`
  );
  return promptPlatform();
}

/**
 * 已有 config.yaml 时询问是否按当前版本模板完整覆盖。
 * 非 TTY 环境无法确认，按“否”处理，仅由 ensureConfig 同步 schema/platform。
 */
async function confirmConfigOverwrite(targetPath, opts = {}) {
  const configFile = path.join(targetPath, 'openspec', 'config.yaml');
  if (!fs.existsSync(configFile)) return false;

  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const isTTY = opts.isTTY != null ? opts.isTTY : Boolean(stdin.isTTY);
  if (!isTTY) return false;

  const confirm = opts.confirm || (await import('@inquirer/prompts')).confirm;
  return confirm(
    {
      message:
        '是否使用当前版本模板完整覆盖 openspec/config.yaml？' +
        '选择“否”将保留现有内容，仅更新 schema 和 platform 字段。',
      default: true,
    },
    { input: stdin, output: stdout }
  );
}

/**
 * 改写 / 写入 config.yaml。
 *
 * - 文件不存在：写入完整模板（与 init 同款，按 platform 选 schema）
 * - overwrite=true：按当前版本模板完整覆写
 * - 文件存在：
 *   - 同步更新 schema: 字段（不一致则替换）
 *   - 同步更新 platform: 字段（不一致则替换；字段缺失则追加到 schema: 行之后）
 */
function ensureConfig(targetPath, platform, overwrite = false) {
  const openspecDir = path.join(targetPath, 'openspec');
  const configFile = path.join(openspecDir, 'config.yaml');
  const targetSchema = platformToSchema(platform);

  fs.mkdirSync(openspecDir, { recursive: true });

  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, buildConfigContent(platform), 'utf8');
    return 'written';
  }

  if (overwrite) {
    fs.writeFileSync(configFile, buildConfigContent(platform), 'utf8');
    return 'overwritten';
  }

  let content = fs.readFileSync(configFile, 'utf8');
  let changed = false;

  // 同步 schema: 字段
  const schemaLine = `schema: ${targetSchema}`;
  if (content.match(/^schema:\s*[\w-]+/m)) {
    if (!content.match(new RegExp(`^${schemaLine}\\s*$`, 'm'))) {
      content = content.replace(/^schema:\s*[\w-]+/m, schemaLine);
      changed = true;
    }
  } else {
    content = `${schemaLine}\n${content}`;
    changed = true;
  }

  // 同步 platform: 字段
  const platformLine = `platform: ${platform}`;
  if (content.match(/^platform:\s*[\w-]+/m)) {
    if (!content.match(new RegExp(`^${platformLine}\\s*$`, 'm'))) {
      content = content.replace(/^platform:\s*[\w-]+/m, platformLine);
      changed = true;
    }
  } else {
    // 字段缺失：插入到 schema: 行后
    content = content.replace(/(^schema:\s*[\w-]+[^\n]*\n?)/m, `$1${platformLine}\n`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(configFile, content, 'utf8');
    return 'updated';
  }
  return 'unchanged';
}

function ensureReadme(targetPath) {
  const readmeFile = path.join(targetPath, 'openspec', 'README.md');
  if (!fs.existsSync(readmeFile)) {
    fs.copyFileSync(README_TEMPLATE, readmeFile);
  }
}

async function cmdUpdate(args, _opts = {}) {
  const { targetPath, explicitPlatform, tools: parsedTools } = parseUpdateArgs(args);
  const platform = await resolvePlatform(targetPath, explicitPlatform);
  const tools    = parsedTools || await promptTools(_opts);
  const overwriteConfig = await confirmConfigOverwrite(targetPath, _opts);
  const schemaName = platformToSchema(platform);

  console.log(`\nmobile-spec update  ${platform} · ${targetPath}\n`);

  // 1a. 把包内最新 schema 暂存到 ~/.mobile-spec/schemas/<name>/
  stageSchemaToMobileSpecDir(schemaName);
  const schemaMobileSpecDir = path.join(getMobileSpecSchemasDir(), schemaName);
  console.log(`  ✓ staged    → ${schemaMobileSpecDir}`);

  // 1b. 从 ~/.mobile-spec/ 安装到 openspec 用户级真实目录（~/.local/share/openspec/schemas/<name>/）
  //     openspec resolver 直接从用户级目录读取，无需项目级 symlink
  copySchemaToUserDir(schemaName);
  const schemaUserDir = path.join(getUserSchemasDir(), schemaName);
  console.log(`  ✓ schema    → ${schemaUserDir}`);

  // 2. 覆写 skills
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
  // 2b. 安装/刷新 SDD 观察兜底 hook（机制强制，补全主动埋点漏埋）
  const hookResult = installHooks(targetPath, { tools });
  if (!hookResult.skipped) {
    const targets = [
      tools.includes('claude') ? '.claude/settings.json' : null,
      tools.includes('codex') ? '.codex/hooks.json' : null,
    ].filter(Boolean);
    console.log(`  ✓ observe   → ${targets.join(' + ')}`);
    if (tools.includes('codex')) {
      console.log(`                Codex observe hook 已刷新（首次使用请通过 /hooks 审核信任）`);
    }
  }

  // 3. 用户确认时按新模板完整覆盖；否则只同步 schema/platform
  ensureConfig(targetPath, platform, overwriteConfig);
  console.log(`  ✓ config    → openspec/config.yaml`);

  // 4. ensureReadme（缺失才写；update 不再 scaffold openspec/context/，
  //    context 文件由用户自行管理）
  ensureReadme(targetPath);

  // 5. 把旧版项目内 workflow sidecar 迁到 ~/.mobile-spec/workflow/
  const migration = migrateLegacyWorkflowState(targetPath);
  if (migration.migrated.length > 0) {
    console.log(`  ✓ migrated  → ~/.mobile-spec/workflow/ (${migration.migrated.length} files)`);
  }
  if (migration.conflicts.length > 0) {
    console.log(`\n⚠️  ${migration.conflicts.length} 个旧 workflow 文件与用户目录状态冲突，已保留原文件：`);
    for (const item of migration.conflicts) console.log(`   - ${item.from}`);
  }

  // 安装/刷新公司 eval 监控插件(MOBILE_SPEC_SKIP_EVAL=1 跳过;失败降级不阻断)
  if (process.env.MOBILE_SPEC_SKIP_EVAL !== '1') {
    installMonitor([]);
  }

  console.log('\n更新完成，重启 IDE 后 Mobile Spec skills 生效。');
  printDSkillsHint();
}

module.exports = {
  cmdUpdate,
  parseUpdateArgs,
  inferPlatformFromConfig,
  resolvePlatform,
  confirmConfigOverwrite,
  ensureConfig,
};
