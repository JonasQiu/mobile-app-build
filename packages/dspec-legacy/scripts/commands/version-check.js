/**
 * init / update 启动前的新版本检查。
 *
 * 只在交互式 TTY 中查询 registry，避免 CI、管道和 hook 引入网络依赖。
 * 发现新版后由用户确认；同意则安装最新版并停止本次旧进程，提示重跑原命令。
 * 查询或安装失败均降级为 warning，不阻断 init / update。
 */

const {
  compareVersions,
  detectPackageManager,
  getCurrentVersion,
  installLatestVersion,
  queryLatestVersion,
} = require('./upgrade');

/**
 * @param {'init'|'update'} command
 * @param {object} [opts] 测试注入：
 *   - stdin/stdout/stderr/isTTY
 *   - currentVersion/queryLatest/confirm
 *   - scriptPath/env/runInstall
 * @returns {Promise<{status:string, shouldContinue:boolean}>}
 */
async function checkForCliUpdate(command, opts = {}) {
  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const isTTY = opts.isTTY != null ? opts.isTTY : Boolean(stdin.isTTY);

  if (!isTTY) {
    return { status: 'skipped', shouldContinue: true };
  }

  const scriptPath = opts.scriptPath || (process.argv[1] || '');
  const current = opts.currentVersion || getCurrentVersion(scriptPath);
  const queryLatest = opts.queryLatest || queryLatestVersion;

  let latest;
  try {
    latest = queryLatest();
  } catch (err) {
    const detail = (err && err.message) || String(err);
    stderr.write(
      `[dspec] 检查新版本失败：${detail}；继续执行 dspec ${command}。\n`
    );
    return { status: 'check-failed', shouldContinue: true };
  }

  if (compareVersions(current, latest) >= 0) {
    return { status: 'current', shouldContinue: true };
  }

  const confirm = opts.confirm || (await import('@inquirer/prompts')).confirm;
  const accepted = await confirm(
    {
      message:
        `发现 @didi/dspec 新版本 ${current} → ${latest}，` +
        `是否现在自动安装？`,
      default: true,
    },
    { input: stdin, output: stdout }
  );

  if (!accepted) {
    return { status: 'declined', shouldContinue: true };
  }

  const pm = detectPackageManager(scriptPath, opts.env || process.env);
  try {
    installLatestVersion(pm, opts.runInstall);
  } catch (err) {
    const detail = (err && err.message) || String(err);
    stderr.write(
      `[dspec] 自动升级失败：${detail}；继续执行 dspec ${command}。\n`
    );
    return { status: 'install-failed', shouldContinue: true };
  }

  stdout.write(
    `\n[dspec] 升级完成。` +
    `\x1b[1;33m请重新执行 \`dspec ${command}\`。\x1b[0m\n`
  );
  return { status: 'upgraded', shouldContinue: false };
}

module.exports = {
  checkForCliUpdate,
};
