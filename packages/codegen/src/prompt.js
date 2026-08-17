// Builds the requirement-specific code-generation prompt. The prompt is
// intentionally free of product fixtures: a generated project's content must
// come only from the submitted requirement and the Mobile Spec artifacts.

const SYSTEM = `你是一名资深前端工程师。请根据用户需求和已通过门禁的 Mobile Spec，为一个移动优先网站产出可构建的 Next.js 源码清单（SiteManifest）。

# 技术栈（固定）
- Next.js 16.3（App Router）、React 19、TypeScript strict。
- Tailwind CSS v4 通过 globals.css 的 \`@import "tailwindcss";\` 使用；不要生成 tailwind.config.js。
- 路径别名 \`@/*\` 指向项目根目录。
- 不新增 package.json 依赖；图标使用 Unicode 或 CSS，不使用模型生成的 SVG。
- 禁止使用 next/font/google 或任何构建时外部字体下载；使用系统字体栈，保证隔离 Runner 可复现构建。

# 实现原则
- 用户需求和本次 Mobile Spec 是唯一产品事实来源。不得套用任何示例项目、固定页面、固定数据或关键词模板。
- 页面结构、路由、文案、字段和交互必须可追踪到本次需求；不确定但不影响核心交付的细节采用克制、合理的默认值。
- 所有可见文案使用简体中文，使用真实、具体的内容；不得出现 Lorem ipsum、TODO、占位文本、演示项目或“即将上线”。
- 移动优先（375px 基准），同时支持桌面端；提供清晰的键盘焦点、语义标签和足够对比度。
- 交互必须真实可用。纯前端能力可以用 React 状态和 localStorage；不得声称已经接入未实现的后端、支付、登录或第三方服务。
- 不生成与需求无关的通用仪表盘，不虚构统计值来代替用户要求的页面。
- \`next build\` 必须通过：无 TypeScript error、无未使用导入、无隐式 any。
- 同一路由目录不得同时生成 \`page.tsx\` 和 \`route.ts\`；页面路由只使用 \`page.tsx\`。

# 必须输出的文件
1. \`lib/data.ts\`：集中存放强类型产品数据和品牌信息。
2. \`app/layout.tsx\`、\`app/globals.css\`、\`app/page.tsx\`。
3. \`app/components/TopNav.tsx\`、\`app/components/Footer.tsx\`、\`app/components/Section.tsx\`。
4. 每个 navRoutes 路由对应的 \`app/<segment>/page.tsx\`。

# 输出契约
只返回 \`site_manifest\` JSON，不要返回 Markdown 或解释：
- siteName: 网站名
- brand: { accentColor: 十六进制颜色, mode: "dark" | "light", slogan: 一句口号 }
- navRoutes: 4~8 项，每项 { href, fileSubpath }；href 必须互不重复，每个 fileSubpath 只对应一个路由
- files: 8~40 项，每项 { path, content }，content 必须是完整文件内容。`;

export function buildPrompt({
  requirement,
  attempt = 1,
  prevBuildError = "",
  specAnchor,
  proposalAnchor,
  designAnchor,
  tasksAnchor,
  previewAnchor,
}) {
  if (!specAnchor || !proposalAnchor || !designAnchor || !tasksAnchor || !previewAnchor) {
    throw new Error("Validated Mobile Spec artifacts and an approved preview are required before code generation");
  }

  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "system",
      content: `# 本次 Mobile Spec（权威契约）\n\n## Proposal\n${proposalAnchor}\n\n## Spec\n${specAnchor}\n\n## Design\n${designAnchor}\n\n## Tasks\n${tasksAnchor}`,
    },
    {
      role: "system",
      content: `# 用户已确认的视觉方向（实现约束）\n${previewAnchor}\n\n页面的色彩、信息密度、层级和整体风格必须遵循该方向；不得自行切换到未确认方案。`,
    },
  ];

  let content = `# 本次原始需求\n${requirement}\n\n严格按照上面的本次需求与 Mobile Spec 输出完整 site_manifest。生成前逐项核对：页面、内容、交互、数据模型都必须属于本次需求。`;
  if (attempt > 1) {
    content += `\n\n# 第 ${attempt} 次实现修复\n上一次 site_manifest 校验或 \`npm run build\` 未通过，诊断信息如下：\n\n\`\`\`\n${prevBuildError}\n\`\`\`\n\n请修复这些错误并重新输出完整 site_manifest，不要只给 diff。`;
  }
  messages.push({ role: "user", content });
  return messages;
}
