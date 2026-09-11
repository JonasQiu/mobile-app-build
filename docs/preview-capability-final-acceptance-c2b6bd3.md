# 预览能力最终独立 P0 产品验收（c2b6bd3）

- 验收日期：2026-09-12（Asia/Shanghai）
- 唯一受测远端基线：`origin/main` / `c2b6bd391a764b7efc73105180d1a8a8d2dcb38f`
- 业务代码基线：`2f178fae00cb49746b9ee24b924d35d1fa077c8d`
- 代码复审：`docs/code-rereview-preview-smil-2f178fa.md` / `ef4486b`，0 阻断
- 冻结清单：工作组 `docs/preview-capability-mvp-scope-and-acceptance.md`
- 浏览器结构化证据：`docs/evidence/preview-final-p0-c2b6bd3-browser.json`
- 静态与 Runner 证据：`docs/evidence/preview-final-p0-c2b6bd3-static.json`
- CDP 能力边界：`docs/evidence/preview-final-p0-c2b6bd3-cdp-capabilities.json`

## 1. 结论

**拒绝放行，存在 2 个独立 P0 阻断缺陷，另有 4 项 P0 因真实执行条件缺失而未验证。**

1. 关闭沉浸预览后焦点没有回到原触发入口。`Esc` 和显式关闭按钮两条路径均稳定落到 `BODY`，违反
   AC-F09/F11 的返回要求；选择状态和背景 `inert` 虽正确恢复，但键盘用户丢失操作位置。
2. 连续换批次并复用与历史批次字节相同的安全 SVG 时，出现缓存命中后的加载状态竞态：3 张
   `img.complete=true`、`naturalWidth=240`，但 UI 全部持续显示“正在载入”，三个选择按钮全部禁用。
   刷新页面后恢复。该行为违反历史 SVG 复用要求及 AC-S03 的快速状态一致性。

冻结规则要求 AC-F/AC-T/AC-M/AC-A/AC-S 全部通过才能放行。当前除上述确定失败外，真实登录+D1/Runner
成功链、物理触屏和真实 VoiceOver 客观不可用，不能用 Mock、CDP 触屏模拟或 Chromium Accessibility
树降格为通过。

## 2. 独立环境与证据边界

- 使用 Chrome 152 / CDP 1.3、全新隔离 profile、本机回环 production build；未附着实现者或个人浏览器。
- production 根路径在无登录会话时进入登录路径并返回 404，因此业务交互通过实际 production bundle +
  本轮独立 Fetch Mock 执行；Mock 数据和稳定方向 ID 由验收脚本生成，不读取实现者自报结果。
- 使用真实 CDP mouse、keyboard、trusted touch 事件，实测 320×568、390×844、768×1024 和 844×390。
- 读取 Chromium Accessibility 全树；没有真实 VoiceOver 声学输出或读屏导航证据。
- 4 张截图已逐张人工查看。实现者旧截图没有作为本报告的通过证据。
- 没有修改业务实现、发布或部署。

状态定义：

- **通过**：本轮独立浏览器、对抗输入、函数级失败注入或回归测试直接满足标准。
- **失败**：本轮存在可重复输入/操作与实际错误结果。
- **未验证**：清单明确要求真实登录数据、物理触屏或真实读屏，而本轮只有隔离 Mock/CDP 等价面。

## 3. 需求到证据追踪矩阵

### 3.1 核心功能

| AC | 状态 | 独立结果与证据 |
|---|---|---|
| AC-F01 从第 2 张打开 | 通过 | Mouse 从第 2 张打开后标题为方向 B、稳定身份正确、序号 `2/3`。 |
| AC-F02 默认桌面/完整 SVG/声明 | 通过 | 新开默认 `1440×900`；canvas 与 SVG 自然比例均为 1.6，`object-fit: contain`；声明持续位于 dialog。 |
| AC-F03 上一张/下一张且不自动选择 | 通过 | B→A→B 及后续导航身份、名称、图像一致；选择数保持 0，确认调用保持 0。 |
| AC-F04 首尾禁用 | 通过 | 第 1 张上一张原生 `disabled`，第 3 张下一张原生 `disabled`，再次按键不循环。 |
| AC-F05 左右方向键 | 通过 | `←`/`→` 与按钮一致；在本轮插入的 text input 聚焦时 `→` 不导航。 |
| AC-F06 三画布 | 通过 | Enter/Space 切换桌面、平板、手机；标签分别为 `1440×900`、`768×1024`、`390×844`，无重新生成或确认请求。 |
| AC-F07 手机画布下导航连续性 | 通过 | 手机画布下从第 2 张到首尾，设备按钮持续 `aria-pressed=true`，选择不变。 |
| AC-F08 第 2 张选择同步 | 通过 | 预览内选择后只有第 2 张卡片选中，按钮和 live region 均明确“尚未最终确认”，批准调用仍为 0。 |
| AC-F09 浏览第 3 张后关闭/回焦 | **失败** | 唯一选择仍为第 2 张，但 `Esc` 后 `document.activeElement` 为 `BODY`，没有回到第 2 张入口。 |
| AC-F10 第 3 张替换唯一选择 | 通过 | Space 选择第 3 张后只有一个 `.selected`，原第 2 张取消，批准调用仍为 0。 |
| AC-F11 Esc/显式关闭与返回 | **失败** | 两种关闭均移除 dialog、恢复背景交互且保留选择，但两次焦点都落到 `BODY`。 |
| AC-F12 单张加载失败 | 通过 | 第 2 张不安全 SVG 显示可读失败态、选择禁用；第 1/3 张继续可导航和选择；无外部请求。 |
| AC-F13 换组清旧批次 | 通过 | 换组后仅 3 个新标签/ID，旧选择清空、确认禁用；旧 ID 在 Runner 校验中失败。 |
| AC-F14 resize/orientation | 通过 | 390×844→320×568→844×390→768×1024 保持方向、画布和选择；无整体水平溢出，SVG 比例不变。 |

### 3.2 可信确认回归

| AC | 状态 | 独立结果与证据 |
|---|---|---|
| AC-T01 只浏览后原确认拒绝 | 通过 | 未选择时原“确认生成”禁用；打开、导航、画布、选择、关闭、换组前后均无 `preview-approval` 请求。 |
| AC-T02 有效选择走原确认与双重校验 | **未验证** | Mock 浏览器确认只从原入口发出 1 次当前稳定 ID，并随后派发 continue；源码、25 项 Web 和 48 项 Runner 回归证明双门禁保留，但无真实登录+D1/Runner 成功链。 |
| AC-T03 换组后旧方向拒绝 | 通过 | 生成第二 set 后，旧 ID 的 `validatePreviewApproval=false`。 |
| AC-T04 篡改序号/前端状态拒绝 | 通过 | 控制面批准路由从当前 artifacts 按稳定 ID 找 SVG；dispatch 要求持久 approved ID；Runner 对 stale ID 失败，不按序号放行。 |
| AC-T05 第一次/第二次 Runner 校验失败 | 通过 | 第一次直接以 stale ID 调用 `validatePreviewApproval` 返回 false；另在第一次通过后换 set，再调用 `readApprovedPreview` 返回 null，保留“进入 Codex 前需要确认”失败关闭。 |
| AC-T06 预览异常不影响旧链路 | 通过 | 不安全方向失败后相邻卡片与沉浸导航仍工作；换到安全批次后原确认入口仍是唯一批准调用。 |

### 3.3 移动端

| AC | 状态 | 独立结果与证据 |
|---|---|---|
| AC-M01 320×568 | 通过 | `root/body/dialog scrollWidth=320`；标题、画布、主图、声明、导航和选择通过 980px dialog 纵向滚动全部可达；上/下截图闭环。 |
| AC-M02 触屏与 44px | **未验证** | CDP 发出的 trusted touch 完成打开、导航、切画布、选择和关闭，所有 dialog 按钮最小 `44×44`；但没有物理触屏、真实浏览器工具栏、虚拟键盘及误触证据。 |
| AC-M03 390×844/平板 | 通过 | 390×844 和 768×1024 均无水平溢出，主图 `contain`、自然比例 1.6，状态保持；390 截图人工检查无控件遮挡。 |
| AC-M04 横竖屏 | 通过 | 390×844→844×390 后方向 `2/3`、手机画布和唯一选择均保持，layout 无横向越界。 |

### 3.4 无障碍与键盘

| AC | 状态 | 独立结果与证据 |
|---|---|---|
| AC-A01 Tab/Shift+Tab | 通过 | 打开焦点进入关闭按钮；7 个控件按关闭→三画布→前后导航→选择顺序循环，Shift+Tab 从首项回到选择，焦点始终在 dialog。 |
| AC-A02 Enter/Space/方向键/Esc | 通过 | 全键盘完成画布切换、导航、选择和关闭；关闭后的焦点返回问题单列 AC-F09/F11 阻断。 |
| AC-A03 无障碍树/读屏 | **未验证** | Chromium AX 树通过：具名 modal dialog、说明、按钮名称、pressed/disabled、图像 alt 均正确；没有真实 VoiceOver 朗读/导航证据。 |
| AC-A04 动态播报 | **未验证** | AX 树存在 `live=polite`、`atomic=true`；DOM 文案覆盖打开、方向、画布、选择和失败，但未验证 VoiceOver 实际时序、去重与朗读内容。 |
| AC-A05 颜色/焦点对比度 | 通过 | 7 组运行时采样最低 `7.97:1`，均高于普通文本 `4.5:1`；状态同时使用文案、pressed/disabled，不只靠颜色。 |
| AC-A06 减少动态效果 | 通过 | CDP 强制 `prefers-reduced-motion: reduce` 后所有受测动画/过渡均不超过 `0.02ms`，信息和操作保持。 |

### 3.5 安全与状态一致性

| AC | 状态 | 独立结果与证据 |
|---|---|---|
| AC-S01 活动 SVG/外链失败关闭 | 通过 | 独立 79 项矩阵全部符合预期：70 项拒绝、9 项合法静态兼容；含 48 项 SMIL 全组合及 namespace、XLink、CSS/XML/双重编码。浏览器失败注入未产生外部请求。 |
| AC-S02 当前批次/稳定 ID/唯一选择 | 通过 | Runner 生成 3 SVG、3 个唯一 ID、同一 set；浏览器选择真源始终只有 1 个；批准提交当前 `set-3-b`。 |
| AC-S03 快速状态一致性 | **失败** | 快速导航末态的索引、标题和图像一致；但连续换批次复用缓存 SVG 时，三图已 complete 且可解码，UI 仍永久 loading、全不可选，刷新才恢复。 |

汇总：**26 通过 / 3 失败 / 4 未验证**。

## 4. 缺陷与证据缺口

| ID | 级别 | 类型 | 复现与实际结果 | 影响 |
|---|---|---|---|---|
| ACC-FINAL-P01 | P0 / 阻断 | 缺陷 | 从第 2 张打开，导航到第 3 张，按 `Esc`；或从第 3 张打开后点关闭。dialog 消失后等待 500ms，`activeElement` 均为 `BODY`，不是原入口。 | 键盘用户丢失位置，AC-F09/F11 失败。 |
| ACC-FINAL-P02 | P0 / 阻断 | 缺陷 | 先载入安全批次 1，再换到含失败项的批次 2，再换到复用批次 1 相同 SVG 字节的安全批次 3。三张图均 `complete=true`、`naturalWidth=240`，但 loading overlay 不消失且 3 个选择按钮全禁用；reload 恢复。 | 历史 SVG 复用和换批次稳定性不成立，AC-S03 失败。 |
| ACC-FINAL-G01 | P0 证据缺口 | 未验证 | 本地 production 无真实会话时登录路径 404；无权限最小的真实测试账号。 | AC-T02 的真实 D1/Runner 成功链未验证。 |
| ACC-FINAL-G02 | P0 证据缺口 | 未验证 | 只有 trusted CDP touch，无物理设备。 | AC-M02 的误触、浏览器工具栏、虚拟键盘和真实性能未验证。 |
| ACC-FINAL-G03 | P0 证据缺口 | 未验证 | 只有 Chromium AX 树，无 VoiceOver。 | AC-A03/A04 的实际朗读顺序、时序和去重未验证。 |

## 5. 自动验证

| 检查 | 结果 |
|---|---|
| 基线 | `HEAD == origin/main == c2b6bd3`；业务代码基线 `2f178fa` |
| Web lint | 通过 |
| Web Node tests | 25/25 通过 |
| Web production build | 通过；路由仍只有原 `preview-approval` API |
| Runner | 48/48 通过，0 失败/取消 |
| Mobile Spec | 4/4 通过 |
| 独立 SVG/Runner harness | 11/11 断言通过；70 项危险输入拒绝、9 项静态兼容接受 |
| 独立 production/CDP harness | 23 通过 / 3 失败；失败即本报告两项 P0（焦点含两条关闭路径） |
| 320/390/失败注入截图 | 4 张已逐张人工查看 |

## 6. 最小整改与复验要求

1. 关闭 dialog 时必须在背景 `inert` 已移除后把焦点恢复到保存的触发按钮；新增 `Esc`、显式关闭两条
   真实浏览器回归，断言关闭后至少两个 animation frame 内触发按钮成为 `activeElement`。
2. 图片状态初始化时处理已完成的缓存图片：不能只依赖可能错过的 React `onLoad`；可在 ref/effect 中检查
   `complete && naturalWidth > 0` 后收敛为 ready，并以当前批次+方向 ID 防止旧回调覆盖。新增“批次 A→B→复用 A
   字节”回归，禁止用 reload 恢复作为通过条件。
3. 修复后重跑本报告两个独立 harness、Web 25、Runner 48、Mobile Spec 4、production build 和文档检查。
4. 最小人工补证：所有者在隔离 headful profile 内自行完成测试账号登录，验收专家跑一次真实
   选择→批准→两次 Runner 校验成功链；在 320×568/390×844 等价物理设备跑 AC-M02；在同一临时
   Chrome 启用 VoiceOver 跑 AC-A03/A04。不得提供密码、验证码、Cookie 或现有个人 profile。

## 7. 残余风险与放行建议

- 当前安全修复本身通过 79 项独立对抗/兼容验证，未发现 SMIL、namespace、XLink、CSS 或 XML 新绕过。
- CDP 触屏、AX 树和 Mock production bundle 证明大部分 UI 合同成立，但不能替代三项真实人工门禁。
- 两个 P0 缺陷均直接命中冻结清单，不能以 Web/Runner 自动测试全绿豁免。

**最终放行建议：拒绝放行。修复 ACC-FINAL-P01/P02 并补齐 G01/G02/G03 后重新进行最终 P0 验收。**
