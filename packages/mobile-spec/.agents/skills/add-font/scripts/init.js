#!/usr/bin/env node
/**
 * init.js — 首次使用时初始化项目的字体管理结构。
 *
 * 用法: node init.js [项目根目录]
 *
 * 会自动检测:
 * - 样式后缀(styl/scss/css)
 * - 源码目录(src 或项目根)
 * - 入口文件(App.vue / main.ts / index.tsx 等)
 *
 * 然后创建:
 * - <srcDir>/common/fonts/registry.json
 * - <srcDir>/common/fonts/sync-fonts.js
 * - <srcDir>/common/fonts/fonts.<ext>
 * - <srcDir>/common/fonts/README.md
 */

const fs = require('fs')
const path = require('path')

const projectRoot = process.argv[2] || process.cwd()

function log (msg) { console.log(`[add-font:init] ${msg}`) }
function fail (msg) { console.error(`\x1b[31m[add-font:init] ${msg}\x1b[0m`); process.exit(1) }

// 检测样式后缀
function detectStyleExt () {
  // 优先检测 Vue SFC 里的 lang 属性
  const vueFile = findFile(projectRoot, '.vue')
  if (vueFile) {
    const content = fs.readFileSync(vueFile, 'utf8')
    const langMatch = content.match(/<style[^>]*lang=["'](\w+)["']/)
    if (langMatch) {
      const lang = langMatch[1].toLowerCase()
      if (lang === 'stylus' || lang === 'styl') return 'styl'
      if (lang === 'scss' || lang === 'sass') return 'scss'
      if (lang === 'css') return 'css'
    }
  }

  // 检测独立样式文件
  if (findFile(projectRoot, '.styl') || findFile(projectRoot, '.stylus')) return 'styl'
  if (findFile(projectRoot, '.scss') || findFile(projectRoot, '.sass')) return 'scss'

  return 'css'
}

function findFile (dir, ext, maxDepth = 3) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
  for (const e of entries) {
    if (e.isDirectory() && maxDepth > 0 && !e.name.startsWith('.') && e.name !== 'node_modules') {
      const found = findFile(path.join(dir, e.name), ext, maxDepth - 1)
      if (found) return found
    } else if (e.isFile() && e.name.endsWith(ext)) {
      return path.join(dir, e.name)
    }
  }
  return null
}

// 检测源码目录
function detectSrcDir () {
  const src = path.join(projectRoot, 'src')
  if (fs.existsSync(src)) return src
  return projectRoot
}

// 检测入口文件
function detectEntryFile () {
  const candidates = [
    'src/App.vue',
    'src/main.ts',
    'src/main.js',
    'src/index.tsx',
    'src/index.ts',
    'src/index.js',
    'App.vue',
    'main.ts',
    'index.tsx'
  ]
  for (const c of candidates) {
    const full = path.join(projectRoot, c)
    if (fs.existsSync(full)) return full
  }
  return null
}

// 读取模板并替换占位符
function renderTemplate (template, vars) {
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v), template)
}

function main () {
  log(`项目根目录: ${projectRoot}`)

  const styleExt = detectStyleExt()
  log(`检测到样式后缀: .${styleExt}`)

  const srcDir = detectSrcDir()
  const relSrcDir = path.relative(projectRoot, srcDir) || '.'
  log(`源码目录: ${relSrcDir}`)

  const fontsDir = path.join(srcDir, 'common', 'fonts')
  const relFontsDir = path.relative(projectRoot, fontsDir)

  // 检查是否已初始化
  if (fs.existsSync(path.join(fontsDir, 'font-urls.json')) || fs.existsSync(path.join(fontsDir, 'registry.json'))) {
    log(`✓ 字体管理结构已存在: ${relFontsDir}/`)
    log('跳过初始化,直接使用现有结构。')
    return
  }

  // 创建目录
  fs.mkdirSync(fontsDir, { recursive: true })
  log(`创建目录: ${relFontsDir}/`)

  // 生成 font-urls.json (简洁的 family → URL 映射)
  const fontUrls = {
    _comment: '字体URL映射表。格式: "family": "URL" 或 ["URL1", "URL2"]。运行 fonts:sync 生成 @font-face。',
    fonts: {}
  }
  fs.writeFileSync(path.join(fontsDir, 'font-urls.json'), JSON.stringify(fontUrls, null, 2) + '\n')
  log(`创建: ${relFontsDir}/font-urls.json`)

  // 读取 sync-fonts 模板并生成
  const scriptDir = __dirname
  const syncTemplate = fs.readFileSync(path.join(scriptDir, 'sync-fonts.template.js'), 'utf8')
  const syncScript = renderTemplate(syncTemplate, {
    SRC_DIR: relSrcDir === '.' ? 'projectRoot' : `path.resolve(projectRoot, '${relSrcDir}')`,
    STYLE_EXT: styleExt
  })
  fs.writeFileSync(path.join(fontsDir, 'sync-fonts.js'), syncScript)
  log(`创建: ${relFontsDir}/sync-fonts.js`)

  // 生成空的字体文件
  const fontsFile = `// ⚠️ 本文件由 sync-fonts.js 自动生成,请勿手动编辑。
// 字体映射在 font-urls.json,修改后执行 fonts:sync。
// 只有被源码实际引用到的字体才会出现在这里(按需引入)。

// (当前没有被引用到的字体)
`
  fs.writeFileSync(path.join(fontsDir, `fonts.${styleExt}`), fontsFile)
  log(`创建: ${relFontsDir}/fonts.${styleExt}`)

  // 生成 README
  const readme = `# 字体管理(按需引入)

本目录维护项目的自定义 Web Font。

- **映射表** 在 \`font-urls.json\` —— 简洁的 family → URL 对应关系。
- **引入** 在 \`fonts.${styleExt}\` —— 自动生成,**只包含被源码引用到的字体**。

## 新增字体

在 \`font-urls.json\` 添加:

\`\`\`json
{
  "fonts": {
    "MyFont": "https://example.com/MyFont.woff2"
  }
}
\`\`\`

然后在组件里用: \`font-family: MyFont\`

运行: \`node common/fonts/sync-fonts.js\` 或 \`npm run fonts:sync\`

## 多格式字体

\`\`\`json
"MyFont": ["https://.../MyFont.woff2", "https://.../MyFont.ttf"]
\`\`\`
`

## 新增一个字体

1. 在 \`registry.json\` 的 \`fonts\` 数组追加一项:

   \`\`\`json
   {
     "family": "MyFont",
     "sources": [{ "url": "https://example.com/MyFont.woff2" }]
   }
   \`\`\`

2. 在组件里使用: \`font-family: MyFont\`
3. 运行: \`npm run fonts:sync\` 或 \`node common/fonts/sync-fonts.js\`

## 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| family | ✅ | @font-face 声明名 |
| sources | ✅ | 字体文件数组 \`[{ "url": "..." }]\` |
| aliases | ⬜ | 源码里的别名 |
| weight/style | ⬜ | 字重/样式 |
| force | ⬜ | true 则强制引入 |

## 命令

\`\`\`bash
node common/fonts/sync-fonts.js        # 生成字体文件
node common/fonts/sync-fonts.js --check # 只校验(CI 用)
\`\`\`
`
  fs.writeFileSync(path.join(fontsDir, 'README.md'), readme)
  log(`创建: ${relFontsDir}/README.md`)

  // 提示接入
  const entry = detectEntryFile()
  const relEntry = entry ? path.relative(projectRoot, entry) : null

  log('')
  log('✓ 字体管理结构初始化完成!')
  log('')
  log('下一步:')
  if (relEntry) {
    log(`1. 在 ${relEntry} 中引入字体文件:`)
    if (styleExt === 'styl') {
      log(`   @import '~@/common/fonts/fonts.styl'`)
    } else if (styleExt === 'scss') {
      log(`   @import '~@/common/fonts/fonts.scss';`)
    } else {
      log(`   @import './common/fonts/fonts.css';`)
    }
  } else {
    log('1. 在项目入口文件或全局样式中引入字体文件')
  }
  log('2. 在 registry.json 中登记字体')
  log('3. 运行 node common/fonts/sync-fonts.js 生成字体声明')
}

main()
