#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredSegments = new Set(["node_modules", ".git", ".codegen", ".next", ".open-next", ".wrangler", "dist", "coverage"]);
const ignoredPrefixes = ["generated", "packages/dspec-legacy", "packages/mobile-spec", "packages/codegen/tests/fixtures"];
const docs = [];

function isIgnored(path) {
  const rel = relative(root, path);
  if (rel.split(sep).some((segment) => ignoredSegments.has(segment))) return true;
  return ignoredPrefixes.some((prefix) => rel === prefix || rel.startsWith(`${prefix}${sep}`));
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (isIgnored(path)) continue;
    if (entry.isDirectory()) await walk(path);
    else if ([".md", ".mdx"].includes(extname(entry.name))) docs.push(path);
  }
}

await walk(root);
const failures = [];
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9_-]{24,}/i,
  /(?:CODEX_RUNNER_TOKEN|RUNNER_CALLBACK_TOKEN|SITES_BYPASS_TOKEN)=[A-Za-z0-9_-]{16,}/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
];
const stalePatterns = [
  [/Mobile Spec 执行\s*\|\s*待接入/, "Mobile Spec 已接入"],
  [/Cloud Runner、动态源码 checkpoint 和真实部署 Provider/, "不要把已接入 Runner 与未完成 checkpoint 混写"],
  [/首页、分享图片和 `\/preview` 正常访问/, "站内 /preview 已移除"],
  [/当前决策是首个默认实现为 Vercel Preview/, "正式 DeploymentProvider 尚未选定"],
];

for (const path of docs) {
  const content = await readFile(path, "utf8");
  for (const pattern of secretPatterns) if (pattern.test(content)) failures.push(`${relative(root, path)}: 疑似包含敏感值`);
  for (const [pattern, message] of stalePatterns) if (pattern.test(content)) failures.push(`${relative(root, path)}: ${message}`);
  const linkPattern = /\[[^\]]+\]\((?!https?:|mailto:|#)([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = decodeURI(match[1].split("#")[0]);
    if (!target) continue;
    try {
      await readFile(resolve(dirname(path), target));
    } catch {
      failures.push(`${relative(root, path)}: 断链 ${match[1]}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`checked ${docs.length} documentation files`);
