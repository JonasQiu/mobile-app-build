// Builds the chat messages sent to the model. The fitness-web golden sample
// (its lib/data.ts + spec.md) is embedded once as a one-shot structural anchor
// so the model has a concrete, build-proven shape to imitate rather than a
// vague instruction. On retry, the previous build-error tail is appended so the
// model can fix the specific failure instead of re-rolling blindly.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const SAMPLE_DATA_PATH = join(repoRoot, "generated/fitness-web/lib/data.ts");
const SAMPLE_SPEC_PATH = join(
  repoRoot,
  "generated/fitness-web.spec/openspec/specs/fitness/spec.md",
);

let SAMPLE_DATA = "";
let SAMPLE_SPEC = "";
try {
  SAMPLE_DATA = readFileSync(SAMPLE_DATA_PATH, "utf8");
} catch {
  // Anchor missing (e.g. repo trimmed); prompt still works, just weaker.
}
try {
  SAMPLE_SPEC = readFileSync(SAMPLE_SPEC_PATH, "utf8");
} catch {
  /* see above */
}

const SYSTEM = `你是一名资深前端工程师，任务是：根据一句中文需求，为一个多页移动端网站产出可构建的 Next.js 源码清单（SiteManifest）。

# 技术栈（固定，不可更改）
- Next.js 16.3（App Router）、React 19、TypeScript（strict，禁止 any、禁止未使用导入）。
- Tailwind CSS v4：通过 globals.css 里的 \`@import "tailwindcss";\` 与 \`@theme { ... }\` 配置；**不要**生成 tailwind.config.js。
- 路径别名 \`@/*\` 指向仓库根（已在 tsconfig 配好），例如 \`import { courses } from "@/lib/data"\`。
- 字体用模板已有的 Geist Sans/Mono（layout 里 next/font/google 引入）。
- 不引入额外图标库、动画库或 UI 组件库；图标用内联 SVG 或 Unicode。

# 你必须输出的文件（仅输出“与脚手架不同 / 新增”的文件即可）
1. \`lib/data.ts\` —— **最高杠杆**：所有页面数据集中在这里，导出强类型数组与一个品牌对象。页面只做结构 + 引用，不放裸数据。
2. \`app/layout.tsx\`、\`app/globals.css\`、\`app/page.tsx\`（首页）。
3. \`app/components/TopNav.tsx\`（"use client"，粘性顶栏，usePathname 标记当前页）、\`app/components/Footer.tsx\`、\`app/components/Section.tsx\`（统一章节容器）。
4. 每个导航路由对应一个 \`app/<segment>/page.tsx\`。需要交互（筛选、表单、切换）的页面顶部加 \`"use client";\`；纯展示页面用 Server Component。

# 不变量（违反即视为失败）
- \`navRoutes\` 里的每个 href 都必须有对应的页面文件（"/" 对应 app/page.tsx）。
- 所有可见文案为简体中文（zh-CN）；价格用 ¥，时间用 HH:mm-HH:mm。
- 使用真实可信的中文命名（人名、课程名、套餐名），不要出现 "Lorem ipsum" 或占位词。
- 全站只使用单一强调色 \`brand.accentColor\`（CSS 变量 \`--accent\` 在 globals.css 定义并映射到 @theme）。
- 移动优先（375px 基准），用 sm/md/lg 断点；卡片用 rounded-2xl + 边框 + 半透明背景。
- \`next build\` 必须通过：无 error、无 warning、无未使用变量、无隐式 any。

# 输出契约
只返回一个 JSON 对象 \`site_manifest\`，结构如下（不要 Markdown、不要解释文字）：
- siteName: 网站名（中文）
- brand: { accentColor: 形如 "#a9ff57" 的十六进制色, mode: "dark" | "light", slogan: 一句口号 }
- navRoutes: 4~8 项，每项 { href: "/xxx" 或 "/", fileSubpath: "app/xxx/page.tsx" }
- files: 8~40 项，每项 { path: 仓库根相对路径(如 "lib/data.ts"), content: 完整文件内容字符串 }

下面是一个**已验证可构建**的参考样例（健身网站）。请学习它的数据建模方式与页面结构，再针对本次需求产出同等质量、内容不同的网站。不要照抄健身主题。`;

const EXAMPLE_HEADER = `# 参考样例：lib/data.ts（已构建通过，约 ${SAMPLE_DATA.length} 字符）`;
const SPEC_HEADER = `# 参考样例：规格 spec.md（同一项目的结构与交互约束）`;

// Builds the chat messages. Two anchor modes:
//  - specAnchor present (phase-1 mobile-spec workflow succeeded): the authored,
//    requirement-specific spec.md (+ proposal + design) is the authoritative
//    contract; the static fitness SAMPLE_SPEC is NOT included.
//  - specAnchor absent (skipped / degraded / no key): fall back to the static
//    fitness spec.md one-shot, exactly as before.
// SAMPLE_DATA (the lib/data.ts structural example) is always included either
// way — it teaches data modelling, not topic.
export function buildPrompt({ requirement, attempt = 1, prevBuildError = "", specAnchor, proposalAnchor, designAnchor }) {
  const messages = [{ role: "system", content: SYSTEM }];

  if (SAMPLE_DATA) {
    messages.push({
      role: "system",
      content: `${EXAMPLE_HEADER}\n\n\`\`\`ts\n${SAMPLE_DATA}\n\`\`\``,
    });
  }

  if (specAnchor) {
    messages.push({
      role: "system",
      content: `# 本次需求已通过 mobile-spec 工作流产出的规格 spec.md（权威契约，严格按此实现）\n\n\`\`\`markdown\n${specAnchor}\n\`\`\``,
    });
    if (proposalAnchor) {
      messages.push({
        role: "system",
        content: `# Proposal（为什么做 / 做什么 / 不做什么）\n\n\`\`\`markdown\n${proposalAnchor}\n\`\`\``,
      });
    }
    if (designAnchor) {
      messages.push({
        role: "system",
        content: `# Design（实现方案与技术决策）\n\n\`\`\`markdown\n${designAnchor}\n\`\`\``,
      });
    }
  } else if (SAMPLE_SPEC) {
    messages.push({
      role: "system",
      content: `${SPEC_HEADER}\n\n\`\`\`markdown\n${SAMPLE_SPEC}\n\`\`\``,
    });
  }

  const userCore = specAnchor
    ? `# 本次需求\n${requirement}\n\n请严格依据上面的 spec.md / Proposal / Design 输出完整的 site_manifest JSON。`
    : `# 本次需求\n${requirement}\n\n请基于此需求输出完整的 site_manifest JSON。主题必须与上面的健身样例不同。`;
  if (attempt <= 1) {
    messages.push({ role: "user", content: userCore });
  } else {
    messages.push({
      role: "user",
      content: `${userCore}\n\n# 第 ${attempt} 次尝试\n上一次产出的代码 \`npm run build\` 失败，构建日志末尾如下：\n\n\`\`\`\n${prevBuildError}\n\`\`\`\n\n请据此修正，**重新输出完整的 site_manifest**（不要只给 diff）。重点修复报错指向的文件，并保持所有不变量。`,
    });
  }

  return messages;
}
