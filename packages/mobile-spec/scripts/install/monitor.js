"use strict";

/**
 * mobile-spec install-monitor —— 安装公司 AI coding eval 监控插件
 *
 * 移植自 hyper/lib/installMonitor.js,默认 workflow 改为 "Mobile Spec"。
 * 安装 wyc-ai-coding-insight 插件(来自 didi-skillshub 内网 marketplace),
 * 在 ~/.local/bin/ 生成 eval-emit / eval-collect wrapper,写 AI_CODING_EVAL_WORKFLOW env,
 * patch 插件 SessionEnd hook。monitor.js 的 runEvalEmit 通过 eval-emit wrapper
 * 把 SDD 事件(spec/phase/validate)上报到公司 skillshub 平台。
 *
 * 失败一律 warn 降级,不阻断 mobile-spec init/update 主流程。
 * 路径解析尊重 MOBILE_SPEC_HOME_OVERRIDE(测试隔离,与 register-schema 一致)。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const EVAL_MARKETPLACE_URL =
  "https://skillshub.intra.xiaojukeji.com/openapi/claude-code/marketplace.json";
const EVAL_MARKETPLACE_NAME = "didi-skillshub";
const EVAL_PLUGIN_NAME = "wyc-ai-coding-insight";
const EVAL_PLUGIN_KEY = `${EVAL_PLUGIN_NAME}@${EVAL_MARKETPLACE_NAME}`;
const EVAL_DEFAULT_WORKFLOW = "Mobile Spec";

/** 测试隔离:MOBILE_SPEC_HOME_OVERRIDE 可重定向 home(与 register-schema 一致)。 */
function getHome() {
  return process.env.MOBILE_SPEC_HOME_OVERRIDE || os.homedir();
}

function knownMarketplacesPath() {
  return path.join(getHome(), ".claude", "plugins", "known_marketplaces.json");
}

function installedPluginsPath() {
  return path.join(getHome(), ".claude", "plugins", "installed_plugins.json");
}

function localBin() {
  return path.join(getHome(), ".local", "bin");
}

function claudeSettingsPath(home = getHome()) {
  return path.join(home, ".claude", "settings.json");
}

function pluginCacheDir() {
  return path.join(
    getHome(),
    ".claude",
    "plugins",
    "cache",
    EVAL_MARKETPLACE_NAME,
    EVAL_PLUGIN_NAME
  );
}

function makeWrapper(tool) {
  return [
    "#!/bin/bash",
    `PLUGIN_DIR=$(find ~/.claude/plugins/cache/${EVAL_MARKETPLACE_NAME}/${EVAL_PLUGIN_NAME} -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)`,
    'if [ -z "$PLUGIN_DIR" ] || [ ! -x "$PLUGIN_DIR/bin/_run" ]; then',
    `  echo "${tool}: ${EVAL_PLUGIN_NAME} plugin not installed" >&2`,
    "  exit 1",
    "fi",
    `export AI_CODING_EVAL_WORKFLOW="\${AI_CODING_EVAL_WORKFLOW:-${EVAL_DEFAULT_WORKFLOW}}"`,
    `exec "$PLUGIN_DIR/bin/_run" ${tool} "$@"`,
    "",
  ].join("\n");
}

function isMarketplaceAdded() {
  try {
    const data = JSON.parse(fs.readFileSync(knownMarketplacesPath(), "utf-8"));
    return EVAL_MARKETPLACE_NAME in data;
  } catch {
    return false;
  }
}

function isPluginInstalled() {
  try {
    const data = JSON.parse(fs.readFileSync(installedPluginsPath(), "utf-8"));
    const plugins = data.plugins || data;
    return EVAL_PLUGIN_KEY in plugins;
  } catch {
    return false;
  }
}

function runClaude(args, label) {
  try {
    execSync(`claude ${args}`, { stdio: "pipe", timeout: 60000 });
    return true;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    console.warn(`  Warning: ${label} failed: ${stderr}`);
    return false;
  }
}

function ensureClaudeEvalWorkflowEnv(home = getHome()) {
  const settingsPath = claudeSettingsPath(home);
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    console.warn(`  Warning: ${settingsPath} not found, skipping eval workflow env.`);
    return;
  }

  settings.env = settings.env || {};
  const currentWorkflow = settings.env.AI_CODING_EVAL_WORKFLOW;
  if (currentWorkflow) {
    if (currentWorkflow !== EVAL_DEFAULT_WORKFLOW) {
      settings.env.AI_CODING_EVAL_WORKFLOW = EVAL_DEFAULT_WORKFLOW;
      fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      console.log(
        `  Updated AI_CODING_EVAL_WORKFLOW from ${currentWorkflow} to ${EVAL_DEFAULT_WORKFLOW} in ${settingsPath}`
      );
      return;
    }
    console.log(`  AI_CODING_EVAL_WORKFLOW already set to ${currentWorkflow}`);
    return;
  }

  settings.env.AI_CODING_EVAL_WORKFLOW = EVAL_DEFAULT_WORKFLOW;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`  Set AI_CODING_EVAL_WORKFLOW=${EVAL_DEFAULT_WORKFLOW} in ${settingsPath}`);
}

function patchPluginEvalCollectHook() {
  const cacheDir = pluginCacheDir();
  if (!fs.existsSync(cacheDir)) return;

  const desiredCommand = `bash -lc 'exec "${path.join(localBin(), "eval-collect")}"'`;

  for (const entry of fs.readdirSync(cacheDir)) {
    const hooksPath = path.join(cacheDir, entry, "hooks", "hooks.json");
    if (!fs.existsSync(hooksPath)) continue;

    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    const sessionEnd = hooks.hooks && hooks.hooks.SessionEnd;
    if (!Array.isArray(sessionEnd)) continue;

    let changed = false;
    for (const group of sessionEnd) {
      for (const hook of group.hooks || []) {
        if (
          hook.type === "command" &&
          typeof hook.command === "string" &&
          hook.command.includes("eval-collect") &&
          hook.command !== desiredCommand
        ) {
          hook.command = desiredCommand;
          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
      console.log(`  Patched eval-collect hook to use mobile-spec wrapper (${hooksPath})`);
    }
  }
}

function setupEvalPlugin() {
  console.log(`\n--- Eval plugin (${EVAL_PLUGIN_NAME}) ---`);

  try {
    execSync("which claude", { stdio: "pipe" });
  } catch {
    console.warn("  Warning: claude CLI not found on PATH, skipping eval plugin setup.");
    return;
  }

  if (!isMarketplaceAdded()) {
    console.log("  Adding marketplace didi-skillshub...");
    if (!runClaude(`plugin marketplace add ${EVAL_MARKETPLACE_URL}`, "marketplace add")) {
      return;
    }
  } else {
    console.log("  Marketplace didi-skillshub already configured");
  }

  console.log("  Updating marketplace...");
  runClaude(`plugin marketplace update ${EVAL_MARKETPLACE_NAME}`, "marketplace update");

  if (isPluginInstalled()) {
    console.log(`  Updating ${EVAL_PLUGIN_NAME}...`);
    if (!runClaude(`plugin update ${EVAL_PLUGIN_KEY}`, "plugin update")) {
      console.warn(
        `  Warning: plugin update failed. You can update manually: claude plugin update ${EVAL_PLUGIN_KEY}`
      );
    }
  } else {
    console.log(`  Installing ${EVAL_PLUGIN_NAME}...`);
    if (!runClaude(`plugin install ${EVAL_PLUGIN_KEY}`, "plugin install")) {
      console.warn("  Warning: plugin install failed. eval-emit will not be available.");
      console.warn(`    You can install manually: claude plugin install ${EVAL_PLUGIN_KEY}`);
    }
  }

  const bin = localBin();
  fs.mkdirSync(bin, { recursive: true });
  for (const tool of ["eval-emit", "eval-collect"]) {
    const wrapperPath = path.join(bin, tool);
    const wrapper = makeWrapper(tool);
    const existed = fs.existsSync(wrapperPath);
    if (existed && fs.readFileSync(wrapperPath, "utf-8") === wrapper) {
      console.log(`  ${wrapperPath} already exists`);
    } else {
      fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
      fs.chmodSync(wrapperPath, 0o755);
      console.log(`  ${existed ? "Updated" : "Created"} ${wrapperPath}`);
    }
  }

  ensureClaudeEvalWorkflowEnv();
  patchPluginEvalCollectHook();

  console.log(
    `  Done. eval-emit / eval-collect available on PATH (default workflow: ${EVAL_DEFAULT_WORKFLOW}).`
  );
}

function parseInstallMonitorArgs(args) {
  const removedOptions = args.filter(
    (arg) => arg === "--global" || arg === "--mode" || arg.startsWith("--mode=")
  );
  if (removedOptions.length > 0) {
    console.warn(
      `  Warning: local analytics hook options were removed and will be ignored: ${removedOptions.join(", ")}`
    );
  }
  return { skipEval: args.includes("--skip-eval") };
}

function installMonitor(args) {
  const { skipEval } = parseInstallMonitorArgs(args);
  if (skipEval) {
    console.log("\n  Skipped eval plugin (--skip-eval).\n");
  } else {
    console.log("\nAI coding eval monitor");
    setupEvalPlugin();
    console.log("");
  }
}

function printInstallMonitorHelp() {
  console.log(`
Usage: mobile-spec install-monitor [options]

Install the central AI coding eval monitor plugin (wyc-ai-coding-insight)
from the didi-skillshub marketplace, and create eval-emit / eval-collect
wrappers on PATH. Both default to the Mobile Spec workflow via AI_CODING_EVAL_WORKFLOW.
monitor.js 的 runEvalEmit 通过 eval-emit wrapper 把 SDD 事件上报到公司 skillshub 平台。

Options:
  --skip-eval    Skip eval plugin (wyc-ai-coding-insight) installation

Examples:
  mobile-spec install-monitor
  mobile-spec install-monitor --skip-eval
`);
}

module.exports = {
  installMonitor,
  setupEvalPlugin,
  ensureClaudeEvalWorkflowEnv,
  makeWrapper,
  isMarketplaceAdded,
  isPluginInstalled,
  parseInstallMonitorArgs,
  printInstallMonitorHelp,
  EVAL_DEFAULT_WORKFLOW,
  EVAL_PLUGIN_NAME,
  EVAL_MARKETPLACE_NAME,
};
