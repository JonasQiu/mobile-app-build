/**
 * mobile-spec schema 注册工具函数。
 * 供 `mobile-spec init` / `mobile-spec update` / `mobile-spec clean` 调用。
 *
 * 架构说明：
 *   用户级目录（真实文件）：~/.local/share/openspec/schemas/h5-sdd/
 *     └── 遵循 XDG Base Directory 规范，与 openspec resolver 用户级路径完全一致
 *     └── 由 copySchemaToUserDir() 从包内 schemas/<name>/schema/ 拷贝而来
 *         upgrade 时再次调用即可刷新
 *
 *   项目内目录（symlink）：<projectRoot>/openspec/schemas/h5-sdd  →  用户级目录
 *     └── 由 registerProjectSymlink() 创建
 *         openspec 通过项目级路径找到 schema，同时所有项目共享同一份用户级文件
 *
 * openspec resolver 解析顺序：
 *   1. 项目级  <projectRoot>/openspec/schemas/<name>/   ← symlink 指向用户级
 *   2. 用户级  ~/.local/share/openspec/schemas/<name>/  （XDG_DATA_HOME/openspec/schemas/）
 *   3. 内置    <openspec package>/schemas/<name>/
 *
 * 用户级目录路径规则（与 openspec getGlobalDataDir() 保持一致）：
 *   - $XDG_DATA_HOME 已设置  → $XDG_DATA_HOME/openspec/schemas/
 *   - macOS / Linux 默认     → ~/.local/share/openspec/schemas/
 *   - Windows 默认           → %LOCALAPPDATA%/openspec/schemas/
 *
 * 测试隔离：设置 MOBILE_SPEC_HOME_OVERRIDE 可将路径重定向到临时目录，
 *   不污染真实用户目录（等价于把 os.homedir() 替换为 MOBILE_SPEC_HOME_OVERRIDE）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCHEMA_NAME = 'h5-sdd';
const PLATFORM_TO_SCHEMA = {
  h5:      'h5-sdd',
  ios:     'native-sdd',
  android: 'native-sdd',
  harmony: 'native-sdd',
};

/**
 * 读取当前发布包版本，作为 schema 的 Mobile Spec 发布归属版本。
 * OpenSpec 自身的 schema.version 必须保持正整数，两者不能复用同一字段。
 */
function getMobileSpecVersion() {
  try {
    const pkg = require('../../package.json');
    return (pkg && pkg.version) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 把 schema.yaml 中的 mobileSpecVersion 占位符替换为当前 CLI 版本。
 * 对缺少该字段的旧 schema 也会在整数 version 后补写，保证升级后安装产物可追踪。
 */
function materializeMobileSpecVersion(schemaDir) {
  const schemaFile = path.join(schemaDir, 'schema.yaml');
  if (!fs.existsSync(schemaFile)) return false;

  const versionLine = `mobileSpecVersion: ${JSON.stringify(getMobileSpecVersion())}`;
  const original = fs.readFileSync(schemaFile, 'utf8');
  let content = original;
  if (/^mobileSpecVersion:\s*.*$/m.test(content)) {
    content = content.replace(/^mobileSpecVersion:\s*.*$/m, versionLine);
  } else if (/^version:\s*\d+\s*$/m.test(content)) {
    content = content.replace(/^version:\s*\d+\s*$/m, (line) => `${line}\n${versionLine}`);
  } else {
    return false;
  }

  if (content !== original) fs.writeFileSync(schemaFile, content, 'utf8');
  return true;
}

/**
 * 按 schemaName 返回包内 schemas/<schemaName>/schema/ 目录的绝对路径（数据源）。
 * 例：schemaName='h5-sdd' → <pkg>/schemas/h5-sdd/schema/
 */
function getPackageSchemaDir(schemaName) {
  return path.resolve(__dirname, '..', '..', 'schemas', schemaName, 'schema');
}

/**
 * 把 platform 映射到 schema 名（h5→h5-sdd / ios|android|harmony→native-sdd）。
 * 未知 platform 抛错。
 */
function platformToSchema(platform) {
  const name = PLATFORM_TO_SCHEMA[platform];
  if (!name) {
    throw new Error(
      `[mobile-spec] 未知 platform: "${platform}"。可选值：${Object.keys(PLATFORM_TO_SCHEMA).join(', ')}`
    );
  }
  return name;
}

/**
 * 解析 schema 包内 config 文件路径，实现文件级条件注入：
 *   先找 schemas/<schemaName>/config.<platform>.yaml（如 config.ios.yaml）
 *   存在则返回该路径，否则回退 schemas/<schemaName>/config.yaml
 *
 * @param {string} schemaName  如 'native-sdd'
 * @param {string} platform    如 'ios'、'android'、'h5'
 * @returns {string}
 */
function resolveSchemaConfigFile(schemaName, platform) {
  const schemaDir = path.resolve(__dirname, '..', '..', 'schemas', schemaName);
  const specific = path.join(schemaDir, `config.${platform}.yaml`);
  if (fs.existsSync(specific)) return specific;
  return path.join(schemaDir, 'config.yaml');
}

/**
 * 返回 openspec 用户级 schemas 目录路径。
 * 遵循 XDG Base Directory 规范，与 openspec resolver 的 getUserSchemasDir() 完全对齐：
 *   - $XDG_DATA_HOME 已设置  → $XDG_DATA_HOME/openspec/schemas
 *   - macOS / Linux          → ~/.local/share/openspec/schemas
 *   - Windows                → %LOCALAPPDATA%/openspec/schemas
 *
 * 测试隔离：MOBILE_SPEC_HOME_OVERRIDE 替换 os.homedir()，XDG_DATA_HOME 优先级更高。
 */
function getUserSchemasDir() {
  // XDG_DATA_HOME 优先（与 openspec 行为完全一致）
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'openspec', 'schemas');
  }
  // MOBILE_SPEC_HOME_OVERRIDE 仅供测试使用：覆盖 os.homedir()，不污染真实用户目录。
  const homeDir = process.env.MOBILE_SPEC_HOME_OVERRIDE || os.homedir();
  if (os.platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    return path.join(localAppData, 'openspec', 'schemas');
  }
  return path.join(homeDir, '.local', 'share', 'openspec', 'schemas');
}

/**
 * 返回 mobile-spec 暂存层根目录：~/.mobile-spec/schemas/
 *
 * 所有 platform schema 暂存于此，作为 openspec 用户级安装的来源。
 * 测试隔离：MOBILE_SPEC_HOME_OVERRIDE 替换 os.homedir()。
 */
function getMobileSpecSchemasDir() {
  const homeDir = process.env.MOBILE_SPEC_HOME_OVERRIDE || os.homedir();
  return path.join(homeDir, '.mobile-spec', 'schemas');
}

/**
 * 把包内 schema 暂存到 ~/.mobile-spec/schemas/<schemaName>/（每次覆盖刷新）。
 * init / update 时首先调用此步骤。
 *
 * @param {string} schemaName  如 'h5-sdd'、'native-sdd'
 * @returns {{ dest: string }}
 */
function stageSchemaToMobileSpecDir(schemaName = SCHEMA_NAME) {
  const dest = path.join(getMobileSpecSchemasDir(), schemaName);
  const src = getPackageSchemaDir(schemaName);
  removePath(dest);
  copyDirSync(src, dest);
  materializeMobileSpecVersion(dest);
  return { dest };
}

/**
 * 返回 schema 安装来源目录（两级优先级）：
 *   1. ~/.mobile-spec/schemas/<schemaName>/  — 暂存层（优先）
 *   2. 包内 schemas/<schemaName>/schema/ — 回退（暂存层不存在时）
 *
 * @param {string} schemaName
 * @returns {string}
 */
function getSchemaSourceDir(schemaName = SCHEMA_NAME) {
  const staged = path.join(getMobileSpecSchemasDir(), schemaName);
  if (fs.existsSync(staged)) return staged;
  return getPackageSchemaDir(schemaName);
}

/**
 * 递归拷贝目录（仅文件，不跟随 symlink）。
 * @param {string} src
 * @param {string} dest
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 删除目录（递归）或 symlink。
 * @param {string} target
 */
function removePath(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch { return; }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(target);
  } else {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

/**
 * 把包内 schema 拷贝（覆盖）到用户级真实目录。
 * init 和 update 都调用此函数；update 时会刷新文件内容。
 *
 * @returns {{ dest: string }}
 */
/**
 * 把 schema 安装到 openspec 用户级真实目录。
 * 来源优先取 ~/.mobile-spec/schemas/<schemaName>/（暂存层），
 * 暂存层不存在时回退到包内 schemas/<schemaName>/schema/。
 *
 * @returns {{ dest: string }}
 */
function copySchemaToUserDir(schemaName = SCHEMA_NAME) {
  const dest = path.join(getUserSchemasDir(), schemaName);
  const src = getSchemaSourceDir(schemaName);

  // 清理已有的 symlink 或旧目录，确保写入真实文件
  removePath(dest);
  copyDirSync(src, dest);
  materializeMobileSpecVersion(dest);
  return { dest };
}

module.exports = {
  copySchemaToUserDir,
  copyDirSync,
  removePath,
  getUserSchemasDir,
  getMobileSpecSchemasDir,
  stageSchemaToMobileSpecDir,
  getSchemaSourceDir,
  platformToSchema,
  resolveSchemaConfigFile,
  getPackageSchemaDir,
  getMobileSpecVersion,
  materializeMobileSpecVersion,
  SCHEMA_NAME,
  PLATFORM_TO_SCHEMA,
};
