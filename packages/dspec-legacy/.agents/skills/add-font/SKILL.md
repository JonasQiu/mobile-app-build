---
name: add-font
description: 为任意前端项目按需引入/管理自定义字体包(Web Font)。当用户给出字体名 + 字体文件 URL 要求引入字体、提到「加字体 / 引入字体 / 字体包 / @font-face / font-family 不生效 / 设计稿用了某某字体」,或在 d2c 还原中发现设计稿使用了非系统字体时使用。核心理念:所有字体登记在 registry.json,但只有被源码真正引用到的字体才会写进样式(按需引入)。首次使用会自动初始化项目结构。
---

为前端项目维护一套「注册表驱动 + 按需生成」的字体引入机制。你的职责是把字体登记进注册表,然后让脚本根据源码引用情况决定是否真正打进产物。

## 心智模型(必须理解)

字体分两层,千万不要混淆:

1. **登记(registry.json)** —— 把字体包「记录在案」。登记 ≠ 引入。所有已知字体都应在这里有一条,方便后续随时复用。
2. **引入(fonts.styl/css)** —— 由 `sync-fonts.js` 自动生成,**不要手写**。脚本扫描源码,只有某字体的 `family`(或 `aliases`)在源码里被引用到,才会为它生成 `@font-face`。没被用到的字体即使登记了也不会进产物 —— 这就是「按需引入」,避免给用户下载用不到的字体文件。

> 一句话:**登记是全集,引入是被使用的子集。**
>
> 💡 **资源查找优先级**: 全局资源池(`global-font-urls.json`) > 用户提供的 URL

## 首次使用:自动初始化项目结构

当你在某个项目第一次使用本 skill 时,必须先检查并初始化字体管理结构:

### 1. 检测项目类型
扫描项目根目录,判断:
- **样式后缀**: 优先检测 `.styl`/`.stylus` 文件 → 用 `.styl`;否则检测 `.scss`/`.sass` → 用 `.scss`;都没有 → 用 `.css`
- **源码目录**: 检测 `src/` 存在则用 `src/`;否则用项目根目录
- **入口文件**: 找到主入口文件(Vue 项目优先 `src/App.vue`,否则找 `src/main.ts`/`src/main.js`/`src/index.tsx`/`src/index.ts`)

### 2. 创建字体管理目录
在 `<srcDir>/common/fonts/` 创建以下文件(如果不存在):

```
<srcDir>/common/fonts/
├── registry.json      # 字体注册表(手动维护)
├── sync-fonts.js      # 生成脚本(自动生成,一般不改)
├── fonts.<styl|css>   # 生成产物(禁止手改)
└── README.md          # 说明文档
```

如果目录已存在且包含这些文件,跳过初始化,直接进入登记流程。

### 3. 生成 sync-fonts.js
创建一个**零依赖 Node 脚本**,核心逻辑:
- 读取 `registry.json`
- 扫描 `<srcDir>/` 下所有 `.vue/.jsx/.tsx/.ts/.js/.styl/.scss/.css` 文件
- 提取所有 `font-family` 引用
- 取「注册表 ∩ 源码引用」的交集(外加 `force:true` 的字体)
- 生成 `fonts.<ext>` 文件

脚本必须支持:
- `node sync-fonts.js` — 生成字体文件
- `node sync-fonts.js --check` — 只校验,不写文件(CI 用)
- `node sync-fonts.js --all` — 忽略使用情况,全部写入(调试用)

### 4. 接入全局样式
在入口文件或全局样式文件中引入生成的字体文件:
- **Vue + Stylus**: 在 `App.vue` 的 `<style lang="stylus">` 顶部加 `@import '~@/common/fonts/fonts.styl'`
- **Vue + SCSS**: 在 `App.vue` 或全局样式文件加 `@import '~@/common/fonts/fonts.scss';`
- **React/Vite**: 在 `src/index.tsx` 或全局样式文件加 `import './common/fonts/fonts.css'`
- **其他**: 找到项目的全局样式入口,添加对应的 import 语句

### 5. 添加 npm scripts(可选但推荐)
在 `package.json` 的 `scripts` 中添加:
```json
"fonts:sync": "node <srcDir>/common/fonts/sync-fonts.js",
"fonts:check": "node <srcDir>/common/fonts/sync-fonts.js --check"
```

如果项目没有 `package.json`,可以跳过此步骤,直接用 `node` 命令运行脚本。

---

## 后续使用:登记字体并同步

项目已初始化后,按以下流程操作:

### 0. 检查全局字体资源池 ⭐
**首先检查 skill 目录下的 `global-font-urls.json`**:
- 路径: `<skill-dir>/global-font-urls.json` (通常在 `~/.claude/skills/add-font/`)
- 如果用户指定的字体已在全局资源池中 → 直接使用,无需询问 URL
- 如果不在 → 继续下一步向用户收集信息

这个全局资源池维护了团队常用的字体 URL 映射,避免重复询问。

### 1. 收集输入
**如果全局资源池中没有**,确认拿到每个字体的:
- **family**: CSS `font-family` 用的名字(必须与设计稿/源码里写的完全一致,大小写敏感)
- **URL**: 字体文件远程地址(如 `https://dpubstatic.udache.com/static/dpubimg/...`)。可有多个文件(如同字体的 ttf + otf)

缺任一项 → 向用户追问,不要瞎编 URL。

### 2. 登记到 font-urls.json

**优先使用 `font-urls.json`**(简洁格式):

```json
{
  "_comment": "字体URL映射表",
  "fonts": {
    "BarlowSemiCondensed-SemiBold": "https://.../BarlowSemiCondensed-SemiBold.otf",
    "HanYiQiHei": "https://.../HYQiHei-80W.otf",
    "KuaiKanShiJie": [
      "https://.../kuaikanshijieti.ttf",
      "https://.../kuaikanshijieti.otf"
    ]
  }
}
```

格式说明:
- **单URL**: `"family": "URL"` 字符串
- **多格式**: `"family": ["URL1", "URL2"]` 数组,浏览器自动选择支持的格式
- `format` 按扩展名自动推断(.ttf→truetype, .otf→opentype, .woff2→woff2)

**高级需求用 `registry.json`**(完整格式,支持别名/weight/style等):

```json
{
  "fonts": [
    {
      "family": "HanYiQiHei",
      "sources": [{ "url": "https://.../HYQiHei-80W.otf" }],
      "aliases": ["HYQiHei", "HYQiHei-80W"],
      "weight": "700"
    }
  ]
}
```

脚本优先读 `font-urls.json`,没有才读 `registry.json`。

### 3. 让字体「被使用」(决定是否真正引入)
脚本靠源码引用判定是否引入。两种情况:
- **用户只是想先备着** → 登记完即可,先不引入(`fonts.<ext>` 不会包含它),这是正常且期望的行为,向用户说明「已登记,等代码里用到会自动引入」
- **用户希望立即生效 / 设计稿已在用** → 确保源码里确实有 `font-family: <family>`。若用户明确要求「现在就引入但还没写样式」,建议在用到的组件里加 `font-family`,或用 `registry.json` 的 `force: true`

> d2c 场景: 若 DSL 的文本节点 `fontName`/`fontFamily` 命中某登记字体,就在生成的组件样式里写上对应 `font-family`,脚本即会自动引入;DSL 没用到的字体不要引入。

### 4. 重新生成并校验
```bash
npm run fonts:sync
# 或
node <srcDir>/common/fonts/sync-fonts.js
```

检查输出日志:确认「引入 N 个字体」列表符合预期,被跳过的就是登记了但没被引用的。

可选只校验(CI 友好):
```bash
npm run fonts:check
```

### 5. 自检 / 验收
- 查看生成的 `fonts.<ext>` 文件内容是否合理
- family 名是否与源码里 `font-family` 写法逐字一致(中文字体、连字符、大小写最易错)
- 不要手动编辑 `fonts.<ext>`;不要把 `@font-face` 再写回组件(统一走映射表)

---

## 常见坑
- **字体不生效**: 90% 是 `font-family` 写法和 `family` 对不上(空格/大小写/引号)。先核对,再考虑别名
- **多格式字体**: 把 ttf 和 otf 都放进同一条目的 `sources`,脚本会合成一个 `src` 多 `url()`,浏览器自动挑
- **改了 fonts.<ext> 没用**: 它是生成物,会被覆盖。改 `registry.json` 才对
- **新字体 URL 不确定**: 必须向用户要,不要编造或复用相近名字的旧链接
- **构建报错找不到 fonts 文件**: 确认入口文件的 import 路径正确,且已运行过 `fonts:sync`
- **没检查全局资源池就问用户**: 先看 `global-font-urls.json` 有没有,避免重复沟通

## 不在范围
- 不负责字体文件本地化/CDN 上传(本项目用远程 URL)
- 不负责字体子集化(subsetting)裁剪体积
- 不负责多主题/多语言场景下的字体切换(项目可自行扩展 registry 结构)
