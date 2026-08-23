# 预览能力优化独立代码审查（5230c76）

- 审查日期：2026-08-23
- 审查人：代码审查专家
- 审查基线：`origin/main` / `5230c76f1b7aad173fd16810c55e4a5ef24f4ae3`
- 实现提交：`e5fb047`；证据提交：`db0ce67`
- 冻结范围：工作组 `docs/preview-capability-mvp-scope-and-acceptance.md`
- 审查边界：代码与调用链、自动化测试、生产构建、实现者浏览器证据。本文不代替产品验收或真实设备/读屏验收。

## 结论

**代码审查放行；阻断问题 0 项。**

实现保持了原可信确认 API 与 Runner 门禁，沉浸预览只复用当前返回的 3 份 SVG 和稳定方向 ID。三种模拟画布、非循环导航、焦点进入/约束/回返、卡片与沉浸视图唯一选择、失败方向不可选择、320px 布局和 44px 核心目标均有对应实现。独立复现的 Web、Runner、Mobile Spec、文档与构建检查全部通过。

存在 2 项非阻断风险：Runner 中立构建门禁的测试时限对环境耗时敏感；新增自动化以纯函数和源码契约检查为主，真实加载失败、快速操作竞态、触屏与读屏仍需产品验收闭环。

## 阻断问题

无。

## 非阻断发现

### N1：中立构建集成测试的外层 240 秒时限小于真实流水线最坏时限，门禁存在环境敏感性

- **位置**：`packages/codegen/tests/build.test.mjs:20-22`；相关阶段时限见 `packages/codegen/src/build.js:8,51-58,94-103`。
- **影响**：有效的 `npm ci` 与 `next build` 在低速磁盘、冷缓存或并发构建环境中可能被外层测试先行取消，造成 CI/发版门禁假阴性；这不等于实现断言或生产构建失败。
- **触发条件**：中立 fixture 的安装、构建和同步清理总耗时接近或超过 240 秒。`runBuild` 自身允许安装和构建各 180 秒，理论上合法总耗时可超过外层 240 秒。
- **独立证据**：本次完整 `npm test` 为 48/48 通过、0 失败、0 取消，总耗时 265.29 秒；其中中立 fixture 为 263.58 秒。项目主理人此前完整套件出现同一项 240 秒取消，单文件重跑又构建成功。实现提交对 `packages/codegen/` 为零改动，未见本功能引入 Runner 回归。
- **修复方向**：将外层测试预算设为两个阶段预算、安装/构建启动和清理开销之和并留余量（例如不低于 420 秒），或将 fixture 依赖准备改为可复用的离线缓存并分别记录阶段耗时。CI 若把该项作为硬门禁，应先消除这类时限假阴性。
- **严重度判断**：非阻断。本次独立构建与 48 项断言全部成功，且受审实现未修改 Runner/构建代码；该项作为发布可靠性风险继续跟踪。

### N2：新增自动化没有运行真实 React 交互状态机，加载失败与快速操作路径主要依赖源码推理和人工浏览器证据

- **位置**：`apps/web/tests/preview-ui.test.mjs:1-43`、`apps/web/tests/workflow-contract.test.mjs:220-244`、`apps/web/tests/manual/immersive-preview-browser-check.mjs`。
- **影响**：源码正则检查可以证明关键符号和调用隔离存在，但无法自动捕获事件闭包、异步图片回调、换批次后的旧回调、快速方向切换、焦点陷阱和读屏播报的运行时回归。
- **触发条件**：SVG `onLoad`/`onError` 与方向切换交错，或换一组/关闭/重开期间发生旧图回调；以及浏览器/读屏对 `inert`、焦点与 live region 的实际行为与源码预期不同。
- **当前证据**：实现者提供的结构化浏览器结果和 320×568、390×844 截图覆盖成功加载、方向键、Shift+Tab、唯一选择、Esc 回返与零 `preview-approval` 请求；审查已核对这些制品与源码一致，但它们不是独立验收。失败注入、触屏、读屏和压力操作没有等价的自动运行门禁。
- **修复方向**：后续增加可在 CI 运行的组件/浏览器用例，至少覆盖 AC-F12/F13、AC-A01/A04、AC-S03；断言失败方向不可选择、旧批次回调不改写新状态、快速切换最终 ID/图像/播报一致。
- **严重度判断**：非阻断。源码的 ID 作用域更新和失败清选逻辑清晰，且本轮产品验收尚未执行；这些真实浏览器路径必须由验收专家独立闭环。

## 关键调用链核验

### 当前批次、稳定 ID 与选择真源

- Runner 生成器仍以 `setId + p1/p2/p3` 产生稳定方向 ID；本次实现未修改生成器。
- Web 读取产物后只保留带 ID 的 SVG，并要求恰好 3 项：`apps/web/app/MobileBuildApp.tsx:263-279`。
- 打开、按钮导航、方向键导航均以 `option.id` 查找当前项；`previewIndexAfterMove` 在首尾返回原索引，不循环：`MobileBuildApp.tsx:354-364`、`app/lib/preview-ui.mjs:41-45`。
- 卡片与沉浸视图共同读取和写入唯一的 `selectedPreviewId`；打开、导航、换画布和关闭不写选择：`MobileBuildApp.tsx:418-427,851-871,968-1006`。
- 新建、切项目、重跑和换一组路径会清除预览项、沉浸 ID、图像状态与临时选择：`MobileBuildApp.tsx:454-550`。

### 键盘、焦点、无障碍和响应式

- 对话框具有 `role="dialog"`、`aria-modal`、具名标题与说明；背景设置 `inert`，打开后焦点进入关闭按钮，Tab/Shift+Tab 约束在对话框内，Esc 关闭并回到原触发按钮：`MobileBuildApp.tsx:366-413,951-1009`。
- 左右方向键仅在非 `input`/`textarea`/`select`/`contenteditable` 上导航；首尾按钮使用原生 `disabled`。
- 三种画布固定为 1440×900、768×1024、390×844，使用 `aspect-ratio` 和 `object-fit: contain` 完整等比容纳。
- 核心卡片操作、设备、关闭、导航和选择目标为 44px 或以上；320px 媒体规则无整体横向溢出设计；全局 `prefers-reduced-motion` 会压缩动画/过渡。
- 方向切换、画布切换、选择、边界与加载失败均写入 polite live region；真实读屏效果留给独立验收。

### SVG 安全与错误恢复

- SVG 内容不使用 `dangerouslySetInnerHTML`，而是在保守检查后编码为 `data:image/svg+xml` 并通过 `<img>` 静态图像上下文呈现：`MobileBuildApp.tsx:199-214`。
- 检查拒绝脚本、事件属性、外链导航、`foreignObject`、危险声明、外链资源和 CSS `url()`；单元测试包含相应反例：`app/lib/preview-ui.mjs:7-38`、`tests/preview-ui.test.mjs:24-36`。
- 不安全或图像解码失败的方向进入 `failed`，清除该方向已有临时选择、显示可读错误并禁用选择/确认；上一张/下一张仍可用：`MobileBuildApp.tsx:429-437,851-871,980-1006`。

### 可信确认与 Runner 双重门禁

- `e5fb047` 对 `apps/web/app/api/` 和 `packages/codegen/` 均为零改动。
- 沉浸预览的 `openImmersivePreview`、`moveImmersivePreview`、画布切换和 `selectPreview` 不调用 `preview-approval` 或 `runProject`；最终确认仍只有原 `approvePreview`：`MobileBuildApp.tsx:418-427,631-667`。
- 确认 API 仍重新从 Runner 读取当前 artifacts，以稳定 ID 找到 SVG 和 `setId` 后才持久化：`apps/web/app/api/v1/projects/[projectId]/preview-approval/route.ts:32-59`。
- 控制面派发仍要求已持久确认和 `selectedPreviewId`：`apps/web/app/api/v1/projects/[projectId]/jobs/route.ts:40-59,147-156`。
- Runner 在实现/构建前再次用当前 manifest 校验 `approvedPreviewId`：`packages/codegen/runner.mjs:597-603`；生成器进入 Codex 前再次读取当前批准方向并失败关闭：`packages/codegen/src/generate.js:87-98`。

## 独立验证结果

在干净的 `origin/main` / `5230c76` 上执行：

| 检查 | 结果 |
|---|---|
| `cd apps/web && npm run lint` | 通过 |
| `cd apps/web && node --test tests/*.test.mjs` | 20/20 通过，0 失败/取消 |
| `cd apps/web && npm run build` | production build 通过，路由清单保留原 `preview-approval` |
| `cd packages/codegen && npm test` | 48/48 通过，0 失败/取消；总计 265.29 秒 |
| `cd packages/mobile-spec && npm test` | 4/4 通过，0 失败/取消 |
| `node scripts/check-docs.mjs` | 26 份文档通过 |
| `git diff --check` | 通过 |
| 受审改动的 Runner/API diff | `e5fb047^..e5fb047` 对 `packages/codegen/`、`apps/web/app/api/` 零改动 |

## 实现者浏览器证据审阅

已读取 `docs/evidence/immersive-preview-browser-results.json` 并查看 3 张截图。证据与源码/样式相符：第 2 张以 2/3 打开、默认桌面，手机画布保持，320×568 无整体横向溢出，核心按钮最小 44px，选择唯一，Esc 后焦点回原入口，记录到的 `preview-approval` 请求为 0。

该证据由实现者生成，只作为代码审查的辅助材料；真实登录数据、鼠标/触屏、失败注入、读屏、对比度及完整 P0 清单仍由产品验收专家独立执行。

## 剩余风险与交接

1. 产品验收需重点独立执行 AC-F12/F13/F14、AC-A01～A06、AC-S01/S03，不能复用实现者证据作为验收结论。
2. 发布门禁需跟踪 N1 的时限假阴性；若 CI 再现取消，应按环境/门禁可靠性处理，而不是把取消误报为本功能断言回归。
3. 本审查只给出代码审查放行，不代表 P0 产品验收通过或发布批准。
