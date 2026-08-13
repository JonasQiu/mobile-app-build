#!/usr/bin/env node
/**
 * dspec CLI
 *
 * 用法：
 *   dspec init [path] [-p|--platform <h5|ios|android|harmony>] [--tools <tools>]
 *   dspec update [path] [-p|--platform <h5|ios|android|harmony>]
 *   dspec upgrade [--pm <pnpm|npm|yarn>] [--dry-run] [-f|--force]
 *   dspec clean
 *   dspec obs list|show [options]   查看 SDD 可观测数据（合并 observe + monitor）
 *   dspec workflow <command>        DSpec SDD 分阶段工作流确定性能力层
 *   dspec --help
 *   dspec -v | --version
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
Usage: dspec <command> [options]

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
                                  升级全局 @didi/dspec CLI 到最新版（自动检测包管理器）
                                  --pm <pnpm|npm|yarn>  指定包管理器（默认自动检测）
                                  --dry-run             仅打印将执行的升级命令
                                  -f/--force            跳过版本检查直接安装

  clean                           清理 dspec 用户级 schema 真实目录

  obs <list|show> [options]       本地查看 SDD 可观测数据（合并 observe 被动层 + monitor 主动层）
                                  list                      列出所有接入过的项目（路径/事件数/最后更新）
                                  show [项目]               单个项目汇总视图（phase/产物 validate/docs 使用/review 门禁）
                                                            不带参数时交互式选择项目
                                  --json                    输出结构化 JSON（list / show 通用）

  install-monitor [--skip-eval]   安装公司 eval 监控插件（wyc-ai-coding-insight）+
                                  eval-emit wrapper，SDD 事件上报到公司 skillshub 平台
                                  （init/update 默认已调用此步）

Examples:
  dspec init
  dspec init ./my-project -p ios
  dspec init ./my-project -p android
  dspec update --platform h5
  dspec clean
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
  case 'obs':
    run(require('../scripts/commands/obs').cmdObs(rest));
    break;
  case 'workflow':
    run(require('../scripts/commands/workflow').cmdWorkflow(rest));
    break;
  case 'monitor':
    require('../scripts/monitor').monitor(rest);
    break;
  case 'install-monitor':
    require('../scripts/install/monitor').installMonitor(rest);
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
    console.error(`[dspec] 未知命令：${command}\n`);
    printHelp();
    process.exit(1);
}
