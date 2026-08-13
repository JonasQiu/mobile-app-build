'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getDSpecHome() {
  const home = process.env.DSPEC_HOME_OVERRIDE || os.homedir();
  return path.join(home, '.dspec');
}

function projectKey(projectRoot) {
  return crypto
    .createHash('sha256')
    .update(canonicalProjectRoot(projectRoot))
    .digest('hex')
    .slice(0, 16);
}

function canonicalProjectRoot(projectRoot) {
  const resolved = path.resolve(projectRoot);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function getWorkflowHome() {
  return path.join(getDSpecHome(), 'workflow');
}

function getProjectWorkflowDir(projectRoot) {
  const root = path.join(getWorkflowHome(), 'projects', projectKey(projectRoot));
  registerProject(projectRoot);
  return root;
}

function getCurrentFile(projectRoot) {
  return path.join(getProjectWorkflowDir(projectRoot), 'current.yaml');
}

function getChangeSidecarDir(projectRoot, change) {
  return path.join(getProjectWorkflowDir(projectRoot), 'changes', change);
}

function registerProject(projectRoot) {
  const workflowHome = getWorkflowHome();
  const file = path.join(workflowHome, 'projects.json');
  const key = projectKey(projectRoot);
  let index = {};
  try {
    index = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!index || typeof index !== 'object' || Array.isArray(index)) index = {};
  } catch {
    index = {};
  }
  index[key] = {
    projectRoot: canonicalProjectRoot(projectRoot),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(workflowHome, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

/**
 * 把旧版业务项目内的 DSpec sidecar 迁到用户目录。
 *
 * 只删除已完整迁移的源文件；目标存在且内容不同时保留源文件并报告 conflict，
 * 避免静默覆盖两边的状态。迁移对 current 和 active/archive change 均生效。
 */
function migrateLegacyWorkflowState(projectRoot) {
  const root = path.resolve(projectRoot);
  const openspecDir = path.join(root, 'openspec');
  const result = { migrated: [], conflicts: [] };

  migrateTree(
    path.join(openspecDir, '.dspec'),
    getProjectWorkflowDir(root),
    result
  );

  const changesDir = path.join(openspecDir, 'changes');
  if (fs.existsSync(changesDir)) {
    for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name === 'archive') {
        migrateArchivedChanges(root, path.join(changesDir, entry.name), result);
        continue;
      }
      migrateTree(
        path.join(changesDir, entry.name, '.dspec'),
        getChangeSidecarDir(root, entry.name),
        result
      );
    }
  }

  removeDirIfEmpty(path.join(openspecDir, '.dspec'));
  return result;
}

function migrateArchivedChanges(projectRoot, archiveDir, result) {
  if (!fs.existsSync(archiveDir)) return;
  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const change = entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    migrateTree(
      path.join(archiveDir, entry.name, '.dspec'),
      getChangeSidecarDir(projectRoot, change),
      result
    );
  }
}

function migrateTree(source, destination, result) {
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dest = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      migrateTree(src, dest, result);
      removeDirIfEmpty(src);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      fs.rmSync(src);
      result.migrated.push({ from: src, to: dest });
    } else if (fs.readFileSync(src).equals(fs.readFileSync(dest))) {
      fs.rmSync(src);
      result.migrated.push({ from: src, to: dest, deduplicated: true });
    } else {
      result.conflicts.push({ from: src, to: dest });
    }
  }
  removeDirIfEmpty(source);
}

function removeDirIfEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

module.exports = {
  getDSpecHome,
  getWorkflowHome,
  getProjectWorkflowDir,
  getCurrentFile,
  getChangeSidecarDir,
  projectKey,
  canonicalProjectRoot,
  migrateLegacyWorkflowState,
};
