# 预览能力优化独立 P0 验收（4b8edd8）

- 验收日期：2026-08-23（Asia/Shanghai）
- 唯一受测远端基线：`origin/main` / `4b8edd81771beac19bca87aacdb71b377d0ba501`
- 实现提交：`e5fb047`
- 代码审查与 N1 收口：`8d1fe31`；审查阻断项 0
- 冻结清单：工作组 `docs/preview-capability-mvp-scope-and-acceptance.md`
- 独立结构化证据：`docs/evidence/preview-acceptance-4b8edd8-results.json`
- 独立命令摘要：`docs/evidence/preview-acceptance-4b8edd8-command-summary.txt`

## 1. 结论

**拒绝放行，P0 阻断。**

存在 1 个可直接复现的 P0 安全失败：`sanitizeReviewSvg` 会接受使用 CSS 标识符转义隐藏的外链 `url()`。独立输入：

```svg
<svg xmlns="http://www.w3.org/2000/svg">
  <rect style="fill:u\72l(https://example.invalid/pixel.png)"/>
</svg>
```

冻结标准要求任何外链资源失败关闭；实际安全检查返回原 SVG，而不是 `null`。CSS 会消费转义码点并把 `u\72l` 解释为 `url`，见 [CSS Syntax Module Level 3](https://www.w3.org/TR/css-syntax-3/#consume-an-ident-like-token)。即使具体浏览器最终是否发出网络请求还受 SVG 图像上下文限制，**安全门禁已经没有按冻结规则拒绝外链输入**，因此 AC-S01 失败且不可豁免。

同时，本轮浏览器运行时发现 0 个可用浏览器后端；真实登录数据、触屏设备和读屏均不可用。实现者已有截图仅作参考，未作为本报告的验收证据。因此真实打开、点击、键盘焦点、320/390 视口、触屏与读屏相关 P0 项均明确标为“未验证”，不能以源码、构建或实现者截图替代。

## 2. 验证边界与方法

状态定义：

- **通过**：本轮在 `4b8edd8` 直接执行的函数、测试、构建或可重复静态计算满足标准。
- **失败**：本轮有确定输入/输出反例。
- **未验证**：用例要求真实浏览器、登录数据、触屏、读屏或完整服务联调，而当前没有该执行面；代码支持证据只记在说明中，不升级为通过。

本轮未复用实现者的 JSON 或截图作为通过证据。独立执行包括：远端/本地 commit 核验、Web lint/测试/生产构建、Runner/Mobile Spec 回归、文档检查、预览生成与复用测试、安全 SVG 对抗输入、确认调用隔离检查和 CSS 对比度计算。

## 3. P0 验收矩阵

### 3.1 核心功能

| AC | 状态 | 独立结果与边界 |
|---|---|---|
| AC-F01 第 2 张打开 | 未验证 | 源码按触发项稳定 ID 打开并显示序号；无可用浏览器，未实际点击第 2 张 |
| AC-F02 默认桌面/完整 SVG/声明 | 未验证 | 默认设备为桌面，画布使用 `object-fit: contain`，声明在 dialog 内持续渲染；未实际观察裁切、拉伸和声明可见性 |
| AC-F03 上一张/下一张且不自动选择 | 未验证 | 纯函数非循环移动与 open/move 不写选择的契约通过；未实际点击并比对图像、名称和 ID |
| AC-F04 首尾禁用 | 通过 | `previewIndexAfterMove(0,-1,3)=0`、`previewIndexAfterMove(2,1,3)=2`；首尾按钮使用原生 `disabled` 条件 |
| AC-F05 左右方向键 | 未验证 | 代码排除 input/textarea/select/contenteditable；未实际键盘操作或验证编辑语义 |
| AC-F06 三画布 | 未验证 | 直接读取并断言三画布为 `1440×900`、`768×1024`、`390×844`；未实际切换和视觉检查 |
| AC-F07 手机画布下导航连续性 | 未验证 | move 只改沉浸方向 ID、不改设备或选择；未实际操作 |
| AC-F08 第 2 张选择并同步卡片 | 未验证 | 卡片和 dialog 共用 `selectedPreviewId`；未实际点击与观察同步 |
| AC-F09 浏览第 3 张后关闭并回焦 | 未验证 | close 使用保存的触发按钮回焦，导航不改选择；无浏览器焦点证据 |
| AC-F10 第 3 张替换唯一选择 | 未验证 | 单一字符串选择真源支持替换；未实际操作 |
| AC-F11 Esc 关闭/恢复背景 | 未验证 | 源码移除 `inert`、恢复 body overflow 并回焦；未实际验证 |
| AC-F12 单张加载失败 | 未验证 | 直接危险 SVG 被拒绝，失败状态清选且禁用选择的源码路径存在；未执行真实图片解码失败与继续导航 |
| AC-F13 换一组清旧批次 | 未验证 | 独立生成新 set，旧 ID 的 Runner 批准校验返回 false；UI 关闭/重开与异步旧回调未在浏览器验证 |
| AC-F14 窗口/横竖屏 | 未验证 | 响应式规则存在；无真实 resize/orientation 证据 |

### 3.2 可信确认回归

| AC | 状态 | 独立结果与边界 |
|---|---|---|
| AC-T01 只浏览后原确认拒绝 | 通过 | Web 契约测试通过；无选择时确认按钮不可用，服务端/Runner 仍要求批准 ID；预览动作无批准调用 |
| AC-T02 有效选择走原确认与双重校验 | 未验证 | 原 `preview-approval` 路由、控制面持久批准门禁、Runner `validatePreviewApproval` 和生成前 `readApprovedPreview` 均保留；未以真实 D1/Runner 跑完整成功链路 |
| AC-T03 换组后旧方向拒绝 | 通过 | 独立生成两批，set ID 改变，旧方向 `validatePreviewApproval=false` |
| AC-T04 篡改序号/前端状态拒绝 | 通过 | 独立 stale ID 被 Runner 拒绝；控制面与确认 API 以稳定 ID 查当前 artifacts，不按序号批准 |
| AC-T05 第一次/第二次 Runner 校验失败 | 未验证 | 两处校验代码与 48/48 Runner 回归均在；未分别注入两次失败并观察原错误语义 |
| AC-T06 预览组件异常不影响旧链路 | 未验证 | API/Runner 在实现提交中零改动；未实际注入 React 运行异常后操作卡片、换组和确认 |

### 3.3 移动端

| AC | 状态 | 独立结果与边界 |
|---|---|---|
| AC-M01 `320×568` | 未验证 | CSS 有 320px 规则、dialog 横向隐藏并纵向滚动；浏览器不可用，未测 scrollWidth、遮挡和可达性 |
| AC-M02 触屏与 44px | 未验证 | 核心按钮源码最小高度为 44/48/52px；无触屏设备或浏览器盒模型，不能确认误触和实际目标尺寸 |
| AC-M03 `390×844`/平板 | 未验证 | 三画布定义与适配规则正确；未实际渲染 |
| AC-M04 横竖屏 | 未验证 | 状态未绑定视口；未实际旋转或 resize |

### 3.4 无障碍与键盘

| AC | 状态 | 独立结果与边界 |
|---|---|---|
| AC-A01 Tab/Shift+Tab 焦点陷阱 | 未验证 | dialog 使用 `aria-modal`、背景 `inert`、显式首尾回绕和 `:focus-visible`；无实际焦点轨迹 |
| AC-A02 Enter/Space/方向键/Esc | 未验证 | 所有控件为原生 button，方向键/Esc 监听存在；未实际执行核心路径 |
| AC-A03 无障碍树/读屏名称状态 | 未验证 | dialog 名称/说明、图像 alt、按钮文本、disabled、`aria-pressed` 均有源码证据；无浏览器无障碍树和读屏 |
| AC-A04 动态播报 | 未验证 | polite/atomic live region 及方向、选择、失败文案存在；无读屏验证，不能确认时序、去重或轰炸 |
| AC-A05 颜色/焦点对比度 | 通过 | 独立静态计算 12 组关键组合均 ≥4.5:1；最低为卡片说明 `5.47:1`，焦点白色对按钮 `15.10:1`；状态另有文字/pressed/disabled |
| AC-A06 减少动态效果 | 未验证 | `prefers-reduced-motion` 将动画/过渡压至 0.01ms；未在浏览器开启媒体特性复验 |

### 3.5 安全与状态一致性

| AC | 状态 | 独立结果与边界 |
|---|---|---|
| AC-S01 活动 SVG/外链失败关闭 | **失败** | 直接 script、事件、foreignObject、普通外链与普通 `url()` 均被拒绝；CSS 转义 `u\72l(https://…)` 被错误接受 |
| AC-S02 当前批次/稳定 ID/唯一选择 | 通过 | 独立生成恰好 3 SVG、3 个唯一 ID、同一 set ID；重复读取哈希不变；UI 选择真源只有 `selectedPreviewId` |
| AC-S03 快速导航/切画布/关闭重开 | 未验证 | 纯索引压力序列最终结果正确；React 异步图像回调、快速项目/批次切换和最终 DOM 状态未在浏览器验证 |

## 4. 自动验证结果

| 检查 | 结果 |
|---|---|
| 远端 `origin/main` 与本地 HEAD | 均为 `4b8edd81771beac19bca87aacdb71b377d0ba501` |
| `apps/web` lint | 通过 |
| `apps/web` Node tests | 20/20 通过 |
| `apps/web` production build | 通过；路由仍含唯一原 `preview-approval` |
| `packages/codegen` | 48/48 通过，0 失败/取消 |
| `packages/mobile-spec` | 4/4 通过 |
| 文档检查 | 27 份通过 |
| 独立预览/安全 harness | 11/12 通过；1 个 CSS 转义外链反例失败 |
| 静态安全 diff | `e5fb047` 对 `apps/web/app/api/`、`packages/codegen/` 零改动 |

这些通过项不能覆盖 AC-S01 的 P0 失败，也不能替代未验证的真实浏览器、登录数据、触屏和读屏门禁。

## 5. 缺陷清单

| ID | 级别 | 缺陷 | 复现 | 影响 |
|---|---|---|---|---|
| ACC-PREVIEW-B01 | P0 / 阻断 | CSS 转义可绕过外链 SVG 检查 | 调用 `sanitizeReviewSvg` 处理 `style="fill:u\72l(https://example.invalid/pixel.png)"`，返回非空 SVG | 违反“任何外链资源失败关闭”；安全检查合同不成立 |
| ACC-PREVIEW-G01 | P0 证据缺口 | 真实交互、移动端、触屏、读屏未验 | 当前浏览器后端为 0，且无真实登录/触屏/读屏 | AC-F 多项、AC-M、AC-A 多项及 AC-S03 无法放行 |

## 6. 最小整改与复验要求

1. 修复 `sanitizeReviewSvg`：不要只匹配字面 `url(`；应解析/规范化 CSS 后校验，或对 SVG 内 `<style>`、`style` 属性采取更保守白名单。至少新增 CSS 标识符转义、注释/大小写/空白组合的外链回归语料。
2. 保持 data URL、同文档 `#id` 与当前生成 SVG 的合法使用；修复不能破坏现有 3 份历史 SVG 的复用。
3. 修复后重跑 Web 20 项、Runner 48 项、Mobile Spec 4 项、生产构建与独立对抗 harness。
4. 在具备真实登录数据的现代浏览器补跑全部“未验证”项，并生成独立证据：至少覆盖 `320×568`、`390×844`、桌面/平板、鼠标、方向键/Esc/Tab 回焦、真实加载失败、快速换批次、触屏盒模型、无障碍树和读屏播报。
5. 只有 ACC-PREVIEW-B01 关闭且所有 P0 “未验证”项取得独立通过证据，才可重新建议放行。

## 7. 残余风险

- Web 当前批次装载要求恰好 3 个 SVG，但未显式校验三个 artifact ID 唯一且 set ID 完全一致；Runner 正常生成路径满足该约束。若未来把 artifact 来源扩大，应把身份一致性验证前置并失败关闭。
- `loadPreviewOptions` 没有显式请求代际/取消标记；快速项目或批次切换时旧请求迟到覆盖新状态的运行时风险仍需 AC-F13/S03 浏览器压力验证。
- 现代浏览器 `inert`、焦点时序、SVG-as-image 外部资源行为和不同读屏组合仍有跨浏览器差异，本轮均未验证。
- 实现者截图与结构化结果只作为背景材料，不能用于关闭上述独立证据缺口。

**最终放行建议：拒绝放行。**
