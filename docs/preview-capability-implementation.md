# 沉浸预览前端实现与复核证据

- 日期：2026-08-23
- 范围：Web 控制面当前批次 SVG 方向评审
- 冻结依据：工作组《预览能力优化》MVP 范围与 P0 验收清单
- 可信边界：未修改确认 API、D1 审批语义、Runner 门禁或执行状态

## 实现结论

Web 控制面已补齐“看清楚后再选择”的前端闭环：

1. 每个当前批次方向都有独立“沉浸预览”和“选择此方案”操作，不再因读取卡片自动选择第一项。
2. 沉浸预览采用具名 `dialog`，背景设为 `inert`，打开后焦点进入关闭按钮，Tab/Shift+Tab 被约束在对话框内，`Esc` 关闭并把焦点还给原预览入口。
3. 上一张/下一张与 `←`/`→` 仅在当前批次范围内导航，不循环；文本输入上下文不劫持方向键。方向切换保留画布，重新打开默认桌面。
4. 桌面 `1440×900`、平板 `768×1024`、手机 `390×844` 三种模拟画布复用同一份已获取 SVG，使用 `object-fit: contain` 等比完整呈现；声明持续说明评审图不是最终页面。
5. 卡片和沉浸预览复用唯一 `selectedPreviewId`；预览内选择不会调用确认 API，原“确认生成”仍是唯一可信确认入口。
6. SVG 以不可信资产处理。纯函数安全检查拒绝脚本、事件属性、外链导航/资源、活动元素、`foreignObject`、DOCTYPE/ENTITY、`style` 元素/属性、CSS 转义与注释混淆；所有属性值先解码 XML 字符引用，再仅允许同文档 `#id` 或安全的 base64 栅格 `data:image` 资源。失败方向显示可读错误并禁止选择，但仍可继续导航。
7. 换一组、完整重跑、新建或切换项目都会清除当前批次的预览视图、图像状态与临时选择，避免旧 ID 残留。

## 改动文件

- `apps/web/app/MobileBuildApp.tsx`：状态、交互、对话框、焦点与加载失败处理。
- `apps/web/app/lib/preview-ui.mjs` / `.d.ts`：三种画布、安全 SVG 检查和非循环索引逻辑。
- `apps/web/app/globals.css`：沉浸布局、320px 小屏适配、44px 触控目标与可见焦点。
- `apps/web/tests/preview-ui.test.mjs`：画布、安全输入与边界导航行为测试。
- `apps/web/tests/workflow-contract.test.mjs`：选择/预览与可信确认链路隔离回归。
- `apps/web/tests/manual/immersive-preview-browser-check.mjs`：Chrome CDP 真实浏览器路径、焦点、键盘、320px 布局与截图脚本。
- `docs/MVP产品说明.md`、`docs/development/03-执行工作流.md`：用户流程同步。

## 自动验证

提交前执行：

```text
cd apps/web && npm run lint
cd apps/web && node --test tests/*.test.mjs
cd apps/web && npm run build
cd packages/codegen && npm test
cd packages/mobile-spec && npm test
node scripts/check-docs.mjs
git diff --check
```

结果：

- Web ESLint：通过。
- Web Node tests：20/20 通过，其中安全 SVG、画布和非循环导航新增 4 条行为测试。
- Web production build：通过，路由清单包含原 `preview-approval` API，未新增或替换可信确认入口。
- Trusted Runner tests：48/48 通过，包含 preview approval hard gate 回归。
- Mobile Spec tests：4/4 通过。
- 文档检查：26 份通过；`git diff --check` 通过。

## 真实浏览器证据

在 Chrome Headless 中加载实际 production build，通过 CDP 为本地控制面提供隔离的当前批次 API fixture，完成第 2 张打开、焦点进入、Shift+Tab 焦点环、手机画布、方向键往返、唯一选择、`Esc` 关闭与焦点返回：

- [390×844 手机画布](evidence/immersive-preview-390x844.png)
- [320×568 顶部布局](evidence/immersive-preview-320x568-top.png)
- [320×568 底部导航、声明与选择](evidence/immersive-preview-320x568-bottom.png)
- [结构化浏览器结果](evidence/immersive-preview-browser-results.json)

结构化结果确认：从第 2 张打开为 `2/3` 且默认桌面；Shift+Tab 在对话框内回绕；手机画布下方向键移动不产生选择；选择后只有第 2 张处于唯一选中态；`320×568` 时根页面/对话框宽度均为 320px、核心可用按钮最小高度 44px；`Esc` 关闭后焦点回到第 2 张入口；未产生 `preview-approval` 请求。

复现脚本为 `apps/web/tests/manual/immersive-preview-browser-check.mjs`。先运行 production server 和开启 `9223` CDP 端口的独立 Chrome，再从仓库根目录执行该脚本。

实现提交：`e5fb047 feat: add safe immersive preview review`。

## ACC-PREVIEW-B01 安全返修

- 返修基线：`486dd1b`（独立验收 `88e80d8` 后的自动文档同步）。
- 代码提交：`a6ebb8b fix: fail closed on obfuscated SVG resources`。
- 修改边界：仅修改 `apps/web/app/lib/preview-ui.mjs` 与 `apps/web/tests/preview-ui.test.mjs`；`preview-approval` API、Runner 门禁及其错误语义零改动。

修复前，新增精确对抗回归可稳定复现 `style="fill:u\\72l(https://example.invalid/pixel.png)"` 被接受：`preview-ui.test.mjs` 共 6 项中 5 项通过、1 项失败，实际返回原 SVG 而不是 `null`。

修复采用保守失败关闭策略：

1. 不解析或放行任意内联 CSS，直接拒绝 `<style>` 与 `style` 属性。
2. 对所有 SVG 属性值解码 XML 数字/标准字符引用，再拒绝 CSS 标识符转义与注释混淆，避免把危险语义隐藏在实体或反斜线后。
3. 以不区分大小写且允许空白的方式逐个解析剩余 `url(...)`，资源仅允许同文档 `#id` 或 `data:image/png|jpeg|gif|webp;base64`；引号不闭合、资源不合法或外链一律返回 `null`。
4. 对抗回归覆盖 CSS 标识符转义、CSS 注释、大小写/空白组合、转义协议及 XML 字符引用组合；兼容回归同时验证同文档引用、安全 `data:image` 和 Runner 当前生成的 3 份 SVG 全部可复用。

返修后的自动验证：

- Web Node tests：22/22 通过（修复前精确反例及新增对抗/兼容回归均通过）。
- Web ESLint：通过。
- Web production build：通过，路由仍包含唯一原 `preview-approval` API。
- Trusted Runner：48/48 通过。
- Mobile Spec：4/4 通过。
- 文档检查与 `git diff --check`：通过。

## 剩余验证与风险

- 需要独立验收在真实登录数据上逐条执行冻结清单，尤其是 `320×568`、触屏、读屏、焦点回返和加载失败注入；自动化检查不替代真实浏览器/读屏证据。
- 方案采取“检测失败即拒绝呈现/选择”的保守安全策略。若未来 Runner 生成需要外部图片或活动 SVG 能力，必须另行设计受控资源策略，不能放宽当前失败关闭规则。
- 当前策略为证明安全而拒绝所有 `<style>`、`style` 属性、CSS 转义与 CSS 注释；若未来生成器确需这些表达能力，应改用经过安全审计的 XML/CSS 解析与白名单序列化，而不是放宽字符串检测。
- 现代浏览器基线依赖原生 `inert`；本需求不新增旧版浏览器兼容承诺。
