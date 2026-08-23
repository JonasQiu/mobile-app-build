# 预览 SVG 第二轮安全返修最终代码复审（4f7e537）

- 复审日期：2026-08-24（Asia/Shanghai）
- 唯一受审基线：`origin/main` / `4f7e5377e36327834465b2d4e43fd4d7f693867a`
- 代码修复：`922da74bda4fac01a1ca77ca01d94847c83d30c0`
- 实现证据：`6e5a9d5`
- 上轮拒绝报告：`docs/code-rereview-preview-sanitizer-8227cdd.md`
- 边界：仅复审 SVG 安全失败关闭、相应测试与原可信门禁不变量；不代替真实浏览器、触屏、读屏或完整产品验收。

## 结论

**拒绝代码审查放行：1 项 P0 阻断。**

`922da74` 已关闭上轮 B1/B2 的 namespace/XLink 绕过，并修复 N1 的合法 ampersand 误拒绝；新增测试能覆盖这些修复路径。可是安全检查仍接受 SVG SMIL 活动元素。`<set>` 和 `<animate>` 可在浏览器中把原本安全的 `href="#safe"` 的动画值改成外链；`<animateMotion>` 与 `<animateTransform>` 也会执行状态变化。该结果直接违反冻结范围的“活动 SVG 失败关闭”和 AC-S01，并满足“SVG 活动内容可执行即阻塞发布”的 P0 规则。

Web lint、24/24 测试、production build、Runner 焦点回归 7/7、Mobile Spec 4/4 均通过，但现有测试未包含 SMIL，因此绿灯不能覆盖这个确定的失败模式。

## 阻断发现

### B3 / P0：SMIL 声明式动画可绕过活动内容门禁并突变资源属性

- **位置**：`apps/web/app/lib/preview-ui.mjs:10,121-125`；呈现调用链见 `apps/web/app/MobileBuildApp.tsx:204-213`。
- **影响**：`FORBIDDEN_ELEMENTS` 未包含 SMIL 动画/突变元素，元素扫描因而接受 `set`、`animate`、`animateMotion`、`animateTransform` 和 `discard`。其中 `set`/`animate` 可把已通过检查的资源属性在运行时改为外链。即使某一浏览器的 `<img>` SVG 沙箱阻止特定外链请求，也不能把浏览器差异当作安全证明：受审合同要求活动 SVG 在进入呈现与选择路径前失败关闭。
- **触发条件**：Runner 或被篡改的预览 SVG 使用无前缀 SMIL 元素；外层资源属性初值为允许的同文档 fragment 或安全栅格 data URL，而 SMIL 的 `to`/`values` 提供后续活动值。
- **最小复现**：

```svg
<svg xmlns="http://www.w3.org/2000/svg">
  <image href="#safe">
    <set attributeName="href"
         to="https://example.invalid/pixel.png" />
  </image>
</svg>
```

```svg
<svg xmlns="http://www.w3.org/2000/svg">
  <image href="#safe">
    <animate attributeName="href"
             values="#safe;https://example.invalid/pixel.png" />
  </image>
</svg>
```

- **独立代码证据**：上述两项以及 `<set attributeName="xml:base" ...>`、`<discard>` 均被 `sanitizeReviewSvg` 原样接受；`animateMotion`、`animateTransform` 同样被接受。
- **独立浏览器语义证据**：Google Chrome 151 的本地无登录 headless 页面中，SMIL 执行后 `SVGAnimatedString.animVal` 分别变为 `https://example.invalid/set.png` 与 `https://example.invalid/animate.png`，而 `baseVal` 仍是 `#safe`。主动推进 SVG 时间轴后，`animateMotion` 把 CTM 位移改为 `(20,30)`，`animateTransform` 改为 `(40,50)`。这证明不是静态字符串误报，而是浏览器执行的活动语义；本复审没有把网络请求本身宣称为已独立验收。
- **最小修复方向**：在当前保守策略中至少拒绝全部 SMIL 活动/突变元素：`set`、`animate`、`animateMotion`、`animateTransform`、`discard`，并补充资源属性与 `xml:base` 突变测试。更稳妥的后续方案是只允许当前 Runner 所需的静态 SVG 元素/属性白名单，或引入 namespace-aware 解析、完整树校验与安全重序列化；不能继续依赖零散危险标签黑名单证明失败关闭。

## 上轮 B1、B2、N1 闭环结果

| 原项 | 结论 | 独立证据 |
|---|---|---|
| B1：任意前缀的活动元素 | 已解决 | 任意含 `:` 的元素名和 namespace 声明都失败关闭；不同前缀的 `style`、`script`、`foreignObject` 均被拒绝。 |
| B2：XLink 别名与 `xml:base` | 已解决 | 任意带前缀属性均拒绝；XLink 别名、根/子树 `xml:base`、非 canonical 根或子树默认 namespace 均未进入呈现路径。 |
| N1：合法 ampersand 误拒绝 | 已解决 | `R&amp;D` 与 `#a&amp;b` 正确接受；双重编码的外链、CSS 标识符和 fragment 继续拒绝。 |

新增测试覆盖了前缀活动元素、XLink 别名、`xml:base`、安全 ampersand、双重编码及当前 Runner SVG 回归，因此没有固化上轮错误行为。但测试只验证原清单，没有覆盖无前缀 SMIL 活动元素，导致 B3 未被自动化捕获。

## 独立对抗与兼容 harness

扩展 harness 共 34 项，结果 **30/34 通过**：

- 正确拒绝：任意前缀声明和前缀活动元素、XLink 别名、`xml:base`、错误/缺失 root namespace、子树默认 namespace 变化、CSS 转义/注释/大小写空白、XML 字符引用混淆、双重编码、直接外链、`script`、`foreignObject`、`style` 属性。
- 正确接受：canonical 默认 SVG namespace、同文档字面/编码 `#id`、PNG/JPEG/GIF base64 栅格 `data:image`、`R&amp;D`、`#a&amp;b`、canonical 子树 namespace。
- 失败的 4 项：SMIL `set` 外链 `href` 突变、`animate` 外链 `values`、`set` 突变 `xml:base`、`discard` 活动元素；均错误接受。
- 追加探针：`animateMotion` 和 `animateTransform` 也错误接受，并由 Chrome 验证实际执行状态变化。

现有生成兼容回归会创建本轮 3 个稳定方向并逐份调用安全检查，3/3 均原样接受；本次未修改生成器或预览 ID 协议。

## 可信门禁与修改边界

- `922da74` 仅修改 `apps/web/app/lib/preview-ui.mjs` 与 `apps/web/tests/preview-ui.test.mjs`。
- 对 `apps/web/app/api/`、`packages/codegen/`、`scripts/acceptance-browser/` 的目标提交 diff 均为零；`preview-approval` API 与 Runner 双重门禁没有变更。
- `MobileBuildApp` 仍在选择和确认前调用同一安全检查；这不能补偿检查函数自身对 SMIL 的漏检。
- 既有 `.vscode/settings.json` 与设备验收执行面文件未被本复审修改；回环验收执行面未停止。

## 独立验证

| 检查 | 结果 |
|---|---|
| `cd apps/web && npm run lint` | 通过 |
| `cd apps/web && node --test tests/*.test.mjs` | 24/24 通过，0 失败/取消 |
| `cd apps/web && npm run build` | production build 通过；路由仍含唯一原 `preview-approval` API |
| `cd packages/codegen && node --test tests/preview.test.mjs tests/runner-contract.test.mjs` | 7/7 通过，含确认硬门禁回归 |
| `cd packages/mobile-spec && npm test` | 4/4 通过 |
| 独立 XML/CSS/SMIL harness | 34 项中 30 通过、4 失败；另 2 个 SMIL 活动元素错误接受 |
| Chrome SMIL 语义探针 | `set`/`animate` 突变资源动画值；`animateMotion`/`animateTransform` 执行位移 |
| 修复/API/Runner/设备脚本 diff | 修复仅 2 个 Web 文件；受保护面零改动 |

## 非阻断与无行动项观察

- **非阻断改进 N2**：当前文本扫描器继续以危险标签黑名单证明安全，新增 SVG 活动元素时容易再次漏检。关闭 B3 的最小补丁可以先扩充禁止元素和测试；静态元素/属性 allowlist 或 namespace-aware 安全重序列化应另行排期，除非最小补丁仍存在可构造漏检。
- **无行动项**：本轮未发现上轮 namespace、XLink、默认 namespace 或实体解码问题回归；当前 3 份 Runner SVG、同文档 fragment 和安全 base64 栅格资源不需要修改。

## 放行条件

1. 修复 B3，使上述 `set`/`animate`/`animateMotion`/`animateTransform`/`discard` 语料全部失败关闭；增加资源属性和 `xml:base` 突变回归。
2. 保持本轮 24 项 Web 测试、3 份 Runner SVG 兼容、Runner 硬门禁和 Mobile Spec 回归通过，并重新执行 production build。
3. 由代码审查再次核验后，产品验收专家仍须独立执行真实浏览器、触屏、读屏和 AC-S01 网络行为验收；本文不代替产品验收。
