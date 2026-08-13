/**
 * mobile-spec clean
 *
 * 清理两处 schema 存储：
 *   1. ~/.mobile-spec/schemas/<name>/          — mobile-spec 暂存层
 *   2. openspec 用户级 schemas/<name>/   — openspec resolver 读取的真实目录
 *
 * 不修改任何项目文件（openspec/、.claude/ 等）。
 */

const fs = require('fs');
const path = require('path');
const { getUserSchemasDir, getMobileSpecSchemasDir, PLATFORM_TO_SCHEMA } = require('../schema/register');

/**
 * 清理单个目录，含 symlink 保护检查。
 * @param {string} dest   目标路径
 * @param {string} label  日志标签，如 'staged' / 'schema'
 */
function cleanDir(dest, label) {
  let stat;
  try {
    stat = fs.lstatSync(dest);
  } catch {
    console.log(`[mobile-spec] ${label} 未找到，跳过（${dest}）`);
    return;
  }

  if (stat.isSymbolicLink()) {
    console.warn(`[mobile-spec] 警告：${dest} 是 symlink，跳过清理，请手动删除。`);
    return;
  }

  fs.rmSync(dest, { recursive: true, force: true });
  console.log(`[mobile-spec] ✅ ${label} 已清理：${dest}`);
}

function cmdClean() {
  const schemaNames = Object.values(PLATFORM_TO_SCHEMA);
  for (const name of schemaNames) {
    // 1. 清理 mobile-spec 暂存层
    cleanDir(path.join(getMobileSpecSchemasDir(), name), `staged(${name})`);

    // 2. 清理 openspec 用户级目录
    cleanDir(path.join(getUserSchemasDir(), name), `schema(${name})`);
  }
}

module.exports = { cmdClean };
