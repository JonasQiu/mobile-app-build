# 预览 SVG 安全返修独立代码复审（8227cdd）

- 复审日期：2026-08-24（Asia/Shanghai）
- 复审输入基线：`origin/main` / `8227cdd8d2c40913fa304cb90d9fa05830850262`
- 安全修复提交：`a6ebb8b23af3b8b2de89da69638657b8d1a44c13`
- 修复证据提交：`ecb23872ce556d6b43217a7593f9fa65c31bb233`
- 原失败报告：`docs/preview-capability-acceptance-4b8edd8.md`
- 边界：仅复审 SVG 安全检查、相应回归测试以及原确认门禁是否保持不变；不代替真实浏览器、触屏、读屏或完整产品验收。

## 结论

**拒绝代码审查放行：2 项 P0 阻断，1 项非阻断误拒绝。**

`a6ebb8b` 已关闭原报告中的字面 CSS 标识符转义、CSS 注释、大小写/空白、XML 字符引用与转义协议反例；同文档 `#id`、安全 base64 栅格 `data:image` 和当前 Runner 生成的 3 份 SVG 也未回归。但实现仍以文本前缀而不是 XML 展开名解析元素和属性，因此合法 XML 命名空间别名可绕过 `<style>`/`<script>`/`foreignObject` 拒绝，也可绕过固定字符串 `xlink:href` 的外链检查。安全失败关闭合同仍不成立。

Web lint、22/22 自动化测试和 production build 全部通过，说明现有测试没有覆盖这些有效 XML 反例；不能用绿灯覆盖确定的安全失败。

## 阻断发现

### B1：带 SVG 命名空间前缀的活动元素绕过禁止元素检查

- **位置**：`apps/web/app/lib/preview-ui.mjs:8,68-78`。
- **影响**：`FORBIDDEN_MARKUP` 只匹配 `<style>`、`<script>`、`<foreignObject>` 等无前缀字面标签；同一 SVG namespace 下的 `<s:style>`、`<s:script>`、`<s:foreignObject>` 会被接受。前缀不改变 XML 元素的展开名，因此门禁未按冻结规则拒绝活动内容；`<s:style>` 中的外链 CSS 也完全绕过属性扫描。
- **触发条件**：输入声明任意前缀映射到 SVG namespace，并用该前缀书写禁止元素。
- **最小复现**：

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:s="http://www.w3.org/2000/svg">
  <s:style>rect{fill:url(https://example.invalid/pixel.png)}</s:style>
  <rect width="1" height="1"/>
</svg>
```

独立调用 `sanitizeReviewSvg` 返回非空原 SVG；Python XML namespace 解析将子元素识别为 `{http://www.w3.org/2000/svg}style`。同类 `<s:script>`、`<s:foreignObject>` 也返回非空。
- **修复方向**：不要以标签字面前缀判断安全语义。优先使用 namespace-aware XML 解析器，按 `{namespace URI, localName}` 拒绝活动元素，并在重新序列化前验证完整树；若继续采用保守文本策略，至少拒绝任意前缀下的禁止 local name，并新增前缀包含字母、数字、连字符与 Unicode 的对抗用例。

### B2：XLink 命名空间别名绕过外链资源属性检查；外部 `xml:base` 也破坏 `#id` 的同文档假设

- **位置**：`apps/web/app/lib/preview-ui.mjs:11-12,32-35,73-78`。
- **影响**：资源属性集合只包含字面 `href`、`xlink:href`、`src`。XML namespace 前缀可以任意命名，合法的 `xl:href` 在展开后仍是 XLink `href`，但当前代码把它当普通属性并接受外链。另有 `xml:base="https://…"` 会被接受，使后续 `href="#id"` 不再具备可由字符串前缀证明的同文档基准。
- **触发条件**：将任意别名前缀绑定到 XLink namespace，或给 SVG/子树设置外部 `xml:base`。
- **最小复现**：

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xl="http://www.w3.org/1999/xlink">
  <image xl:href="https://example.invalid/pixel.png"/>
</svg>
```

独立调用 `sanitizeReviewSvg` 返回非空；Python XML namespace 解析把属性识别为 `{http://www.w3.org/1999/xlink}href`。`xml:base="https://example.invalid/"` 加 `href="#pixel"` 也返回非空。
- **修复方向**：按 namespace URI 与 local name 识别所有 URI 属性，不能依赖调用方选择的前缀文本；保守方案可将任意 `*:href`/`*:src` 视为资源属性并拒绝外链，同时直接拒绝 `xml:base`。只有在解析后的有效基准仍是当前文档时才允许 fragment-only 引用。

## 非阻断发现

### N1：XML 实体解码后的二次“残留引用”检查误拒绝合法 ampersand 文本

- **位置**：`apps/web/app/lib/preview-ui.mjs:15-29`。
- **影响**：`aria-label="R&amp;D"` 是合法被动 SVG；XML 只进行一轮实体展开，实际属性值为 `R&D`。当前代码解码后再用 `/&(?:#|[a-z])/i` 扫描，错误把合法字面 `&D` 当成未解码实体并返回 `null`，可能让安全方向误报加载失败且不可选择。
- **触发条件**：标准 `&amp;` 解码后的字面 `&` 紧接字母或 `#`。
- **证据**：独立用例期望接受，实际返回 `null`；当前 Runner 3 份 SVG 没有该模式，因此本批次不回归。
- **修复方向**：在原始属性值上完整校验并一次性解码合法 XML 引用，不要对解码结果再次按实体起始模式扫描；加入 `R&amp;D`、`#a&amp;b` 和双重编码的区分测试。
- **严重度**：非阻断误拒绝；应与 B1/B2 同批修复，避免下一轮只补攻击反例而扩大兼容性回归。

## 已关闭的原始反例与兼容性结果

独立 13 项对抗/兼容 harness 结果为 9/13：

- **正确拒绝**：CSS 标识符转义、CSS 注释、大小写/空白组合、转义协议、XML 十进制/十六进制字符引用组合。
- **正确接受**：字面与 XML 编码的同文档 `#id`；PNG/JPEG base64 栅格 `data:image`。
- **错误接受**：namespace-prefixed `<style>`、namespace-prefixed `<script>`、XLink 别名外链属性。
- **错误拒绝**：合法 `aria-label="R&amp;D"`。

`apps/web/tests/preview-ui.test.mjs` 中的 Runner 兼容回归独立执行通过：实际生成 3 个方向，三份内容均被安全检查原样接受。

## 确认门禁与修改边界

- `a6ebb8b` 的 diff 仅包含：
  - `apps/web/app/lib/preview-ui.mjs`
  - `apps/web/tests/preview-ui.test.mjs`
- 从修复父提交到 `a6ebb8b`，以及从原验收基线 `4b8edd8` 到受审基线 `8227cdd`，`apps/web/app/api/` 与 `packages/codegen/` 均为零改动。
- 原 `preview-approval` API 仍重新读取当前 Runner artifacts，并以稳定 ID/`setId` 持久确认。
- 控制面 jobs 门禁、Runner `validatePreviewApproval` 和进入 Codex 前 `readApprovedPreview` 均保留；焦点 Runner 回归 7/7 通过。

结论：确认 API 与 Runner 门禁未退化，但它们不能补偿预览 SVG 安全检查自身的绕过。

## 独立验证

在受审代码与 `8227cdd` 相同的 Web/Runner 文件上执行：

| 检查 | 结果 |
|---|---|
| `cd apps/web && npm run lint` | 通过 |
| `cd apps/web && node --test tests/*.test.mjs` | 22/22 通过，0 失败/取消 |
| `cd apps/web && npm run build` | production build 通过；路由仍含唯一原 `preview-approval` |
| `cd packages/codegen && node --test tests/preview.test.mjs tests/runner-contract.test.mjs` | 7/7 通过，含批准硬门禁回归 |
| 独立 CSS/XML/namespace harness | 13 项中 9 通过、4 失败；其中 3 个安全漏检、1 个安全输入误拒绝 |
| XML namespace 语义核验 | 前缀 style 展开为 SVG `style`；别名 href 展开为 XLink `href` |
| 修复/API/Runner diff | 修复仅 2 个 Web 文件；API 与 Runner 零改动 |

复审期间设备运维提交 `3ab00b4` 并使远端 `main` 从 `8227cdd` 前进；`8227cdd..3ab00b4` 只涉及验收浏览器脚本和文档，受审的两个 Web 文件、API 与 Runner 内容均未变化。本复审输入和安全结论仍严格对应 `8227cdd` / `a6ebb8b`。

## 放行与下一步

1. **当前安全返修不放行。** B1/B2 任一项均违反 AC-S01 的活动内容/外链失败关闭规则。
2. 修复应新增 namespace-prefixed `style/script/foreignObject`、XLink 任意别名前缀、`xml:base` 与安全 ampersand 用例；现有 CSS/XML 与 3 份 Runner 兼容回归必须继续通过。
3. 修复后重跑 Web lint/全部测试/production build及 Runner 确认门禁焦点回归，再交由产品验收执行真实浏览器、触屏和读屏用例。
4. 本文仅为代码复审结论，不关闭原报告中的产品验收证据缺口，也不代替产品验收。
