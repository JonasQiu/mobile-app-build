#!/usr/bin/env node
/**
 * sync-fonts.js — 按需生成字体 @font-face 声明。
 *
 * 优先读取 font-urls.json(简洁的 family→URL 映射),回退到 registry.json(完整格式)。
 * 扫描源码,只为被引用到的字体生成 @font-face。
 */

const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = {{SRC_DIR}}
const FONTS_DIR = __dirname
const FONT_URLS_PATH = path.join(FONTS_DIR, 'font-urls.json')
const REGISTRY_PATH = path.join(FONTS_DIR, 'registry.json')
const OUTPUT_PATH = path.join(FONTS_DIR, 'fonts.{{STYLE_EXT}}')
const STYLE_EXT = '{{STYLE_EXT}}'

const SCAN_EXTS = new Set(['.vue', '.jsx', '.tsx', '.ts', '.js', '.{{STYLE_EXT}}', '.css'])
const SKIP_PATHS = new Set([OUTPUT_PATH, FONT_URLS_PATH])

const FORMAT_BY_EXT = {
  '.ttf': 'truetype',
  '.otf': 'opentype',
  '.woff': 'woff',
  '.woff2': 'woff2'
}

const args = process.argv.slice(2)
const CHECK_ONLY = args.includes('--check')
const FORCE_ALL = args.includes('--all')

function fail (msg) {
  console.error(`\x1b[31m[fonts:sync] ${msg}\x1b[0m`)
  process.exit(1)
}

function readFontMap () {
  // 优先 font-urls.json
  if (fs.existsSync(FONT_URLS_PATH)) {
    try {
      const raw = fs.readFileSync(FONT_URLS_PATH, 'utf8')
      const json = JSON.parse(raw)
      if (json.fonts && typeof json.fonts === 'object') {
        const fonts = []
        for (const [family, urls] of Object.entries(json.fonts)) {
          const urlList = Array.isArray(urls) ? urls : [urls]
          fonts.push({ family, sources: urlList.map(url => ({ url })) })
        }
        console.log(`[fonts:sync] 使用 font-urls.json (${fonts.length} 个字体)`)
        return fonts
      }
    } catch (e) {
      console.warn(`[fonts:sync] font-urls.json 解析失败,尝试 registry.json`)
    }
  }

  // 回退 registry.json
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8')
    const json = JSON.parse(raw)
    if (!json || !Array.isArray(json.fonts)) fail('registry.json 缺少 fonts 数组')
    json.fonts.forEach((f, i) => {
      if (!f.family) fail(`fonts[${i}] 缺少 family`)
      if (!Array.isArray(f.sources)) fail(`字体 "${f.family}" 缺少 sources`)
    })
    console.log(`[fonts:sync] 使用 registry.json (${json.fonts.length} 个字体)`)
    return json.fonts
  } catch (e) {
    fail(`无法读取字体映射: ${e.message}`)
  }
}

function walk (dir, files = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return files }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(full, files)
    else if (SCAN_EXTS.has(path.extname(e.name)) && !SKIP_PATHS.has(full)) files.push(full)
  }
  return files
}

function buildUsageIndex (files) {
  return files.map(f => { try { return fs.readFileSync(f, 'utf8').toLowerCase() } catch { return '' } })
}

function isUsed (font, haystacks) {
  const needles = [font.family, ...(font.aliases || [])].map(s => String(s).toLowerCase())
  return haystacks.some(t => needles.some(n => n && t.includes(n)))
}

function formatFor (source) {
  if (source.format) return source.format
  try { return FORMAT_BY_EXT[path.extname(new URL(source.url).pathname).toLowerCase()] || null } catch { return null }
}

function renderFontFace (font) {
  const lines = [`@font-face`, `  font-family: '${font.family}'`]
  const src = font.sources.map(s => { const f = formatFor(s); return f ? `url('${s.url}') format('${f}')` : `url('${s.url}')` })
  lines.push(`  src: ${src.join(', ')}`)
  if (font.weight) lines.push(`  font-weight: ${font.weight}`)
  if (font.style) lines.push(`  font-style: ${font.style}`)
  lines.push(`  font-display: ${font.display || 'swap'}`)
  return lines.join('\n')
}

function renderFile (selected) {
  const header = `// ⚠️ 自动生成,勿手改。字体映射在 font-urls.json,修改后运行 fonts:sync。\n// 按需引入:只有被源码引用的字体才会出现。\n\n`
  if (!selected.length) return header + '// (无被引用字体)\n'
  return header + selected.map(renderFontFace).join('\n\n') + '\n'
}

function main () {
  const fonts = readFontMap()
  const files = walk(SRC_DIR)
  const haystacks = FORCE_ALL ? null : buildUsageIndex(files)

  const selected = [], skipped = []
  for (const f of fonts) {
    (FORCE_ALL || f.force || isUsed(f, haystacks) ? selected : skipped).push(f)
  }

  const next = renderFile(selected)

  if (CHECK_ONLY) {
    let cur = ''
    try { cur = fs.readFileSync(OUTPUT_PATH, 'utf8') } catch {}
    if (cur !== next) fail('fonts.{{STYLE_EXT}} 不同步,请运行 fonts:sync')
    console.log(`[fonts:sync] ✓ 已是最新 (${selected.length} 个字体)`)
    return
  }

  fs.writeFileSync(OUTPUT_PATH, next, 'utf8')
  console.log(`[fonts:sync] ✓ 已生成 fonts.{{STYLE_EXT}}`)
  console.log(`[fonts:sync]   引入 ${selected.length} 个: ${selected.map(f => f.family).join(', ') || '(无)'}`)
  if (skipped.length) console.log(`[fonts:sync]   跳过 ${skipped.length} 个: ${skipped.map(f => f.family).join(', ')}`)
}

main()
