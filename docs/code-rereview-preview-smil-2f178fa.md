# 预览 SVG SMIL 安全返修独立复审（2f178fa）

- 复审日期：2026-09-12（Asia/Shanghai）
- 唯一受审远端基线：`origin/main` / `2f178fae00cb49746b9ee24b924d35d1fa077c8d`
- 安全修复：`ab3b489dbbae4296381e9d90818fb336d461812b`
- 实现证据：`c08a106`
- 上轮阻断报告：`docs/code-final-rereview-preview-sanitizer-4f7e537.md`
- 边界：仅复审 SMIL 活动元素失败关闭及 namespace/XLink/CSS/XML/双重编码回归，并核对预览确认 API、Runner 门禁和失败语义未变；不代替产品验收。

## 结论

**代码审查放行：0 项阻断，0 项本轮新增非阻断缺陷。**

`ab3b489` 在统一的元素拒绝点加入 `set`、`animate`、`animateMotion`、`animateTransform`、`animateColor` 和 `discard`。拒绝发生在属性解释和浏览器呈现之前，因此不依赖 `attributeName` 或 `to`/`from`/`by`/`values` 的具体组合。独立 79 项对抗与兼容 harness 全部通过，确认上轮 SMIL 资源属性突变阻断已关闭，且既有 namespace/XLink/CSS/XML/双重编码边界及允许的静态资源没有回归。

## 阻断项

无。

## 修复正确性与调用链

1. `apps/web/app/lib/preview-ui.mjs:10-13` 把全部受审 SMIL 活动元素纳入 `FORBIDDEN_ELEMENTS`；`apps/web/app/lib/preview-ui.mjs:124-128` 对扫描到的元素名统一转小写后拒绝，大小写变化不能绕过。
2. 同一循环继续拒绝所有带前缀的元素名；`apps/web/app/lib/preview-ui.mjs:130-136` 继续拒绝带前缀属性、非 canonical 默认 namespace、不安全资源、CSS 混淆及二义性 XML 解码。因此 namespace/XLink、`xml:base`、CSS/XML 字符引用和双重编码门禁保持闭合。
3. `apps/web/app/MobileBuildApp.tsx:208-213` 在构造 SVG data URL 前执行安全检查；失败返回原有“安全检查未通过”占位，而不是把内容插入 DOM。
4. `apps/web/app/MobileBuildApp.tsx:423-427,631-648,770-777,850-871,980-1006` 仍在卡片选择、最终确认和沉浸预览路径重复检查安全性。失败方向保持不可选择，确认函数在失败时返回且不会调用 `preview-approval`。
5. `apps/web/app/api/v1/projects/[projectId]/preview-approval/route.ts` 与 `packages/codegen/` 在修复提交中的 diff 均为零；Runner 仍在进入 Codex 前调用 `readApprovedPreview` 并对缺少确认抛出硬门禁错误。

## 独立对抗与兼容 harness

结果：**79/79 通过，0 失败。**

- 70 项预期拒绝：其中 48 项为 6 个 SMIL 元素 × `href`/`xml:base` × `to`/`from`/`by`/`values` 的完整矩阵；另覆盖混合大小写、换行空白、前缀 SMIL、活动元素、事件属性、直接外链、CSS 标识符转义/注释/大小写空白、XML 十六进制与十进制字符引用、协议/CSS/fragment 双重编码、任意 namespace 前缀、XLink 别名、`xml:base`、缺失/错误根 namespace 及子树默认 namespace 变化。
- 9 项预期接受：canonical 默认 SVG namespace、字面及编码同文档 `#id`、PNG/JPEG/GIF/WebP base64 栅格 `data:image`、合法 `R&amp;D`、canonical 子树 namespace。
- 当前 Runner 三方向 SVG 由 Web 回归和 Runner 预览测试重新生成并逐份读取；三份均通过 sanitizer，三个 option ID 唯一，过期 ID 在重生成后失效。

对字符串扫描器另做构造性检查：XML 元素名不能通过字符引用拆分；大小写由 `toLowerCase()` 归一；任意前缀因 `:` 失败关闭；注释或 CDATA 内文本不会成为可执行元素；格式错误的 XML 即使越过文本检查，也会触发图片加载失败并保持不可选择。本轮范围内未找到可构造的 SMIL 漏检或新增误配。

## 修改边界证据

- `ab3b489^..ab3b489` 只修改：
  - `apps/web/app/lib/preview-ui.mjs`
  - `apps/web/tests/preview-ui.test.mjs`
- 对 `apps/web/app/api/`、`packages/codegen/`、`apps/web/app/MobileBuildApp.tsx` 和 `scripts/acceptance-browser/` 的修复提交 diff 均为零。
- `ab3b489..2f178fa` 对 `apps/`、`packages/`、`scripts/` 的 diff 为零；受审 sanitizer 与测试在修复提交和当前远端基线上的 blob 完全一致。
- 未修改既有 `.vscode/settings.json` 或设备验收资产。

## 独立验证

| 检查 | 独立结果 |
|---|---|
| Web `npm run lint` | 通过 |
| Web `node --test tests/*.test.mjs` | 25/25 通过，0 失败/取消 |
| Web `npm run build` | production build 通过；路由仍含唯一原 `preview-approval` API |
| Runner `node --test tests/preview.test.mjs tests/runner-contract.test.mjs` | 7/7 通过，含预览生成、确认硬门禁和重生成不构建回归 |
| Mobile Spec `npm test` | 4/4 通过 |
| 独立 SMIL/namespace/CSS/XML harness | 79/79 通过（70 拒绝、9 接受） |
| `node scripts/check-docs.mjs` | 32 份文档检查通过 |
| `git diff --check ab3b489^..2f178fa` | 通过 |
| 基线与工作区 | `HEAD == origin/main == 2f178fa`；写入本报告前工作区清洁 |

## 非阻断观察与剩余风险

- **无本轮新增非阻断缺陷。** 现有方案以保守拒绝集合和字符串扫描为安全边界；若未来扩展 Runner SVG 元素或允许动画，应先补齐安全模型与对抗回归，不能仅删除当前拒绝项。
- 本结论覆盖代码、Node 测试与生产构建，不代替产品验收专家对真实登录数据、浏览器网络行为、触屏和读屏的独立验收。

## 放行建议

允许 `2f178fa` 进入独立产品验收；发布仍以产品验收结果和既有发布门禁为准。
