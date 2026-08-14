#!/usr/bin/env node
/**
 * mobile-spec CLI
 *
 * 用法：
 *   mobile-spec init [path] [-p|--platform <h5|ios|android|harmony>] [--tools <tools>]
 *   mobile-spec update [path] [-p|--platform <h5|ios|android|harmony>]
 *   mobile-spec upgrade [--pm <pnpm|npm|yarn>] [--dry-run] [-f|--force]
 *   mobile-spec clean
 *   mobile-spec workflow <command>        Mobile Spec SDD 分阶段工作流确定性能力层
 *   mobile-spec --help
 *   mobile-spec -v | --version
 *
 * 子命令参数（含 -p / --platform）由各 cmd 模块自行解析，本文件只做一级分发；
 * rest 数组原样透传。
 */

const pkg = require('../package.json');

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

function printHelp() {
  console.log(`
Usage: mobile-spec <command> [options]

Commands:
  init [path] [-p <h5|ios|android|harmony>] [--tools <tools>]
                                  初始化项目（注册 schema + 安装 agents + 写 config）
                                  path           目标项目路径（默认当前目录）
                                  -p/--platform  目标平台：h5 / ios / android / harmony
                                  -f/--force     跳过已有文件的覆盖确认
                                  --tools        AI 工具列表（默认 claude，预留）

  update [path] [-p <h5|ios|android|harmony>]
                                  刷新 schema、覆写 skills
                                  未传 -p 时从 openspec/config.yaml 推断

  upgrade [--pm <pnpm|npm|yarn>] [--dry-run] [-f]
                                  升级全局 @mobile-app-build/mobile-spec CLI 到最新版（自动检测包管理器）
                                  --pm <pnpm|npm|yarn>  指定包管理器（默认自动检测）
                                  --dry-run             仅打印将执行的升级命令
                                  -f/--force            跳过版本检查直接安装

  clean                           清理 mobile-spec 用户级 schema 真实目录

Examples:
  mobile-spec init
  mobile-spec init ./my-project -p ios
  mobile-spec init ./my-project -p android
  mobile-spec update --platform h5
  mobile-spec clean
`);
}

function run(promiseOrValue) {
  Promise.resolve(promiseOrValue).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

async function runWithVersionCheck(command, rest, modulePath, exportName) {
  const result = await require('../scripts/commands/version-check').checkForCliUpdate(command);
  if (!result.shouldContinue) return;
  return require(modulePath)[exportName](rest);
}

switch (command) {
  case 'init':
    run(runWithVersionCheck('init', rest, '../scripts/commands/init', 'cmdInit'));
    break;
  case 'update':
    run(runWithVersionCheck('update', rest, '../scripts/commands/update', 'cmdUpdate'));
    break;
  case 'upgrade':
    run(require('../scripts/commands/upgrade').cmdUpgrade(rest));
    break;
  case 'clean':
    require('../scripts/commands/clean').cmdClean(rest);
    break;
  case 'workflow':
    run(require('../scripts/commands/workflow').cmdWorkflow(rest));
    break;
  case 'monitor':
    require('../scripts/monitor').monitor(rest);
    break;
  case '-v':
  case '--version':
    console.log(`${pkg.name}@${pkg.version}`);
    break;
  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;
  default:
    console.error(`[mobile-spec] 未知命令：${command}\n`);
    printHelp();
    process.exit(1);
}
