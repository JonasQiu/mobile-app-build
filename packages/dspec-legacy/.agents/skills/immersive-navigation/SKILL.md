---
name: immersive-navigation
description: 在滴滴司机端 H5 项目中集成、配置或排查 @didi/immersive-navigation（H5 沉浸式顶导组件）。当用户提到"沉浸式顶导/沉浸式导航/虚拟顶导/VirtualBar/immersive-navigation/ImmersiveNavigation"，或要做"顶导透明渐变""页面背景图打通到顶导""隐藏 NA 顶导"，或排查"标题没显示/右侧按钮点击/安全区/低版本兼容/barStatusChange"等问题时触发。本 skill 只覆盖 @didi/immersive-navigation 这一个组件的用法、能力边界、bridge 机制和踩坑点。
---

# immersive-navigation

> 一句话目标：**让 AI 正确接入 / 配置 / 排查滴滴司机端的 H5 沉浸式顶导组件 `@didi/immersive-navigation`。**

仓库：`git@git.xiaojukeji.com:native-fe/immersive-navigation.git`
包名：`@didi/immersive-navigation`
入口：`src/VirtualBar.vue`（组件 name = `ImmersiveNavigation`）

---

## 一、什么时候用这个 skill

任何"接入/调整/调试 `@didi/immersive-navigation`"的需求：

- "我想做一个沉浸式顶导"、"页面背景延伸到状态栏下"、"顶导透明，往下滚才出现白底"
- "怎么用 ImmersiveNavigation"、"VirtualBar 的 props 有哪些"
- "顶导标题没出来 / 右侧按钮点击没回调 / 回退箭头颜色不对"
- "低版本 App 用这个组件兼容吗"、"barStatusChange 是 false"
- "shouldLiftContentWhenImmersive 是干嘛的 / 内容被顶导挡住了"
- 在司机端 H5 项目里看到 `import ... from '@didi/immersive-navigation'`、`<ImmersiveNavigation>` 标签

**不要触发**：与端通信但跟该组件无关的需求（比如纯 dbridge 调用、其它顶导库、Casper 迁移等）。

---

## 二、组件本质（先建立心智模型，再回答任何问题）

它做的就一件事：**让 H5 页面的"顶导背景"和"页面内容背景"无缝连成一片，并随滚动渐显白底**。

实现方式分两条路径，由 App 版本决定：

| 路径 | 触发条件 | 行为 |
|---|---|---|
| 高版本（沉浸式）| `dbridge.version() >= 8.4.12`，鸿蒙 `versionCode > 1408031812` | 调 `UnifyBridge.updateNavigationBarView` 把 **NA 顶导**的背景/标题色都设成完全透明（`#00FFFF00` / `#00000000`），然后 H5 自己渲一个 `position: fixed` 的"虚拟顶导"，靠 `barOpacity` 跟随 `window scroll` 渐变 |
| 低版本（兜底）| 不满足上述版本 | 不渲染虚拟顶导，调 `dbridge.setTitle` 让 NA 顶导照常展示标题；右侧按钮走 `dbridge.addCornerButton` |

判断结果通过 `@isImmersiveNavigation`（`true=高版本沉浸，false=低版本兜底`）和 `@barStatusChange` 抛出。

> 关键含义：**`barStatusChange=true` 不代表"显示顶导"，而是"沉浸式生效（NA 已被透明化）"；`false` 代表"走低版本兜底，由 NA 顶导自己显示标题"。** 用户来问"barStatusChange 怎么是 false"时先这样解释。

---

## 三、安装与依赖

```bash
npm install @didi/immersive-navigation
```

`peerDependencies`（**必须由宿主项目自己装**，组件不会带过去）：

- `vue`：`^2.6.14`（Vue2 组件，Vue3 项目不能直接用）
- `@didi/unify-bridge`：`^1.0.6`（高版本沉浸式靠它）
- `@didi/driver-bridge`：`^2.16.3`（低版本兜底 + 取版本号靠它）

宿主缺哪个，要么 build 报错要么运行时崩。Vue3 项目想用，需要单独评估，不在本组件支持范围内。

---

## 四、Props / Events / 用法速查

### 4.1 Props

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | String | `""` | 顶导标题；高版本写到 NA 透明顶导的 titleView，低版本走 `dbridge.setTitle` |
| `rightButtonInfo` | Array | `[]` | 右侧按钮配置数组（高版本透传给 `updateNavigationBarView.rightButtons`；低版本只取 `[0].text` 调 `addCornerButton`）。每项含 `text/clickId/textColor/items` 等 |
| `showTitleWhenTransparent` | Boolean | `false` | `true`=顶导透明时也显示标题（用 `backgroundColor: rgba(255,255,255,opacity)` 实现）；`false`=用整体 `opacity` 渐变，透明时连标题一起隐 |
| `shouldLiftContentWhenImmersive` | Boolean | `false` | 走低版本兜底（`isShowVirtualBar=false`）时，把 slot 内容向上提 `liftDistance`，让背景图盖到 NA 顶导后面（仅对兜底分支生效） |
| `liftDistance` | Number | `146` | 顶升距离，单位是 750 设计稿的 px，组件内部转 `vw` |
| `showPlaceholderWhenImmersive` | Boolean | `false` | 高版本沉浸式生效时给 slot 顶部加 `paddingTop = barHeight`，让内容不被虚拟顶导盖住（与 `shouldLiftContentWhenImmersive` 是互补的两种诉求，不要一起开） |
| `zIndex` | Number | `1000` | 虚拟顶导层级 |
| `titleColor` | String | `#000000` | 透明态下标题色；当 `barOpacity > 0.06` 强制变 `#000000` |
| `backIconType` | String | `""` | 回退箭头映射键，仅 `'dark' \| 'light' \| 'ghost'`；其它值（含默认 `""`）= 不传 imageUrl 用端默认；`barOpacity > 0.06` 时自动切到 `dark` |

### 4.2 Events

| 事件 | 载荷 | 说明 |
|---|---|---|
| `barStatusChange` | Boolean | `true` = 高版本沉浸式生效；`false` = 走 NA 兜底（或 `updateNavigationBarView` 调失败回退） |
| `isImmersiveNavigation` | Boolean | 仅表达"版本是否够"，在 mount 时抛一次；与 `barStatusChange` 的差别是后者还包含 bridge 调用结果 |
| `barHeightChange` | Number | 虚拟顶导 DOM 实测高度（含 safeArea + padding），mounted 后抛 |
| `rightButtonClicked` | clickId | 右侧按钮点击回调；高版本来自 `setNavigationBarButtonClickListener`，低版本来自 `addCornerButton` |

### 4.3 标准用法

```vue
<template>
  <ImmersiveNavigation
    :title="title"
    :showTitleWhenTransparent="true"
    :shouldLiftContentWhenImmersive="true"
    :liftDistance="146"
    :rightButtonInfo="rightButtons"
    backIconType="light"
    @barStatusChange="onBarStatusChange"
    @isImmersiveNavigation="onImmersiveReady"
    @rightButtonClicked="onRightBtn"
  >
    <!-- 页面内容；带背景图的话背景图放这里，会自动延伸到顶导下 -->
  </ImmersiveNavigation>
</template>

<script>
import { ImmersiveNavigation } from '@didi/immersive-navigation';
export default {
  components: { ImmersiveNavigation },
  data() {
    return {
      title: '页面标题',
      rightButtons: [{ text: '更多', clickId: 'more', textColor: '#FFFFFF' }],
    };
  },
  methods: {
    onBarStatusChange(immersive) { /* true=沉浸生效 */ },
    onImmersiveReady(ok) { /* 版本够不够 */ },
    onRightBtn(clickId) { /* 路由分发 */ },
  },
};
</script>
```

全局注册也可以：`Vue.use(ImmersiveNavigation)`，组件 name 是 `ImmersiveNavigation`。

---

## 五、常见问答 / 排查清单

回答用户问题前，先按这个清单逐条对照。

### 5.1 "标题没显示 / 标题串了"

- 高版本：标题来自 `props.title` → `updateNavigationBarView.titleView.title`，透明态下 `titleColor: '#00000000'` 是故意的，靠 H5 虚拟顶导的 `.title-text` 显示。如果 `showTitleWhenTransparent=false` 且没滚动，标题就是看不见的，这是预期。
- 低版本：走 `dbridge.setTitle({ vctitle })` + 兜底 `document.title`；如果 `dbridge.setTitle` 偶发失败，刷新一次或检查 driver-bridge 版本。
- `watch.title` 只在低版本分支调 `setTitle`；高版本切标题靠 reactive 绑到虚拟顶导，**不会**重新调 `updateNavigationBarView`，如果用户期望切标题时同步刷右侧按钮/箭头颜色 → 让他改 `rightButtonInfo` 触发 `initializeComponent` 重跑。

### 5.2 "右侧按钮点不动 / 回调拿不到 clickId"

- 检查事件名：组件抛的是 **`@rightButtonClicked`**（驼峰，clicked 过去式）。
- clickId 来源：高版本从 `UnifyBridge.setNavigationBarButtonClickListener` 的 `res.data.clickId || res.clickId`；低版本来自传给 `addCornerButton` 的回调里的 `rightButtonInfo[0].clickId`。
- 当 `rightButtonInfo[].items` 是非空数组时，组件会**自动 `delete clickId`**（端协议要求 items 模式不能带 clickId），并过滤掉 `text` 为空的子项；不要在外面又传 clickId 又传 items。
- 低版本兜底**只接第 0 个按钮**（`addCornerButton` 协议限制），多按钮场景必须依赖高版本。

### 5.3 "回退箭头颜色不对 / 滚动后没变黑"

- `backIconType` 必须是 `'dark' | 'light' | 'ghost'` 之一才会被 `backImageMap` 命中，其它值会传 `undefined`，端用默认箭头。
- 滚动到 `barOpacity > 0.06` 自动切 `dark`，回到 `<= 0.06` 切回用户传入的 `backIconType`。
- 切换是通过 `watch.barOpacity` 里再次调 `updateBar(...)` 实现的，本质是又一次 `updateNavigationBarView`，如果端这一帧没回，箭头会延迟一两百毫秒，属于正常。

### 5.4 "内容被顶导盖住了 / 顶部空了一截"

两个 prop 容易混淆，**别同时开**：

- `shouldLiftContentWhenImmersive=true`：**只对低版本兜底分支**生效（`!isShowVirtualBar`），把内容上移 `liftDistance/750*100 vw`，常用于"我希望背景图盖住 NA 顶导"。
- `showPlaceholderWhenImmersive=true`：**只对高版本沉浸分支**生效（`isShowVirtualBar`），给内容加 `paddingTop = barHeight`，常用于"我不想内容压在虚拟顶导下"。

诊断口径：先让用户打 `@barStatusChange`，看 true/false，再决定该开哪个。

### 5.5 "安全区不对 / 顶部偏移异常"

`safeAreaTop` 来自 `UnifyBridge.getSystemInfo` 的 `safeArea.top`。安卓 7/8/9 部分机型取不到，组件兜底 `25`。如果用户看到 25px 但实际刘海更高 → 是端 systemInfo 没给值，让端那边补。

虚拟顶导 `paddingTop = safeAreaTop + 10`，下面 `padding-bottom: 2px`，标题 `margin-bottom: 8.5px`，加起来基本就是 NA 顶导高度，不要在外面再叠 padding。

### 5.6 "barStatusChange / isImmersiveNavigation 啥时候触发"

- `isImmersiveNavigation`：mount 内 `initializeComponent` 跑完版本判断时抛一次，仅一次。
- `barStatusChange`：
  - 版本够 + `updateNavigationBarView` 成功 → `true`
  - 版本够但 `updateNavigationBarView` reject → `false`（走兜底）
  - 版本不够 → `false`
  - `rightButtonInfo` 变化会重跑 `initializeComponent`，可能再次触发

### 5.7 "build 报缺 unify-bridge / driver-bridge"

它们在 `peerDependencies` 里，不会跟着装。让宿主装齐：
```
npm i @didi/unify-bridge @didi/driver-bridge
```
注意 `peerDependenciesMeta` 把 unify-bridge 标 `optional: false`，npm7+ 会强校验。

### 5.8 "我能用在 Vue3 / 非司机端"

- Vue3：组件用了 `beforeDestroy`、`Vue.use(install)` 等 Vue2 写法，不能直接跑 Vue3。需要 wrap。
- 非司机端：依赖 `@didi/driver-bridge` 取 App 版本和兜底 setTitle，乘客端/快车等其它端不要直接用。
- PC：明确不支持，README 已注明。

### 5.9 性能 / 滚动监听

`window.addEventListener('scroll', throttledHandleScroll, true)`，`throttle(20ms)`，移除在 `beforeDestroy`。如果用户在 keep-alive 场景下抱怨监听重复绑定 → 让他在 deactivated 里手动 `removeEventListener`，组件没在 deactivated 处理。

---

## 六、给 AI 写代码时的硬性约束

接入或修改这个组件相关代码时，**必须**遵守：

1. **不要去改 `node_modules/@didi/immersive-navigation` 的源码**，需要扩展能力时让用户提到组件仓库提 PR。
2. **不要 mock `barStatusChange === true` 来跳过版本判断**——版本不够的设备上 `updateNavigationBarView` 不存在，强行走会崩。
3. **`title` 同步给端**：如果业务标题异步取，先用 `:title="''"` 占位也行，组件 `watch.title` 会在低版本路径补调 `setTitle`；高版本路径不需要管。
4. **`rightButtonInfo` 改引用而不是改属性**：`watch.rightButtonInfo` 是浅 watch，直接 `this.rightButtonInfo[0].text = 'x'` 不会触发；用 `this.rightButtonInfo = [...]` 整体替换。
5. **`backIconType` 只能传三个枚举值**，不要把图片 URL 直接塞进去——传 URL 会因为 `backImageMap[type]` 取不到而走端默认。
6. **禁止把组件包在另一个 `position: fixed` 容器里**——虚拟顶导自己就是 fixed，外层再 fixed 会让 `barHeight` 测不准、安全区计算偏。
7. **路由切换时**：高版本下端的 NA 顶导被改成全透明状态，**离开页面前要把端顶导恢复**，否则下一个页面顶导会"看不见"。常见做法是在路由 `beforeRouteLeave` 调 `UnifyBridge.updateNavigationBarView` 把背景/标题色还原。组件**没有自动恢复**这一步，必须由业务自己做。

---

## 七、定位到具体源码（要看实现细节时直接给路径）

源码就在仓库 `src/VirtualBar.vue`，关键锚点：

- 版本判断 + 分支：[VirtualBar.vue:194-212](src/VirtualBar.vue#L194-L212) `initializeComponent`
- 高版本调端透明化：[VirtualBar.vue:213-240](src/VirtualBar.vue#L213-L240) `updateBar`
- 低版本兜底：[VirtualBar.vue:241-253](src/VirtualBar.vue#L241-L253) `showNativeBarTitle`
- 滚动透明度：[VirtualBar.vue:254-280](src/VirtualBar.vue#L254-L280) `handleScroll/changeOpacity`
- 版本号比较：[VirtualBar.vue:281-318](src/VirtualBar.vue#L281-L318) `compareVersion/parse`（两位数补零拼接成整数）
- 右侧按钮处理：[VirtualBar.vue:319-370](src/VirtualBar.vue#L319-L370) `setNavigationBarButtonClickListener / getProcessedRightButtons / getRightButtonColor`
- 回退箭头三套图：`src/assets/images/index.js` 导出 `backDark / backLight / backGhost`

---

## 八、回答风格

- 用户给一个需求场景 → 先判断"该开哪个 prop / 监听哪个事件"，给最小可运行片段。
- 用户报 bug → 走第五节排查清单，先问 `barStatusChange` 是 true 还是 false，再分支诊断。
- 涉及端能力的疑问 → 明确指出是 `UnifyBridge.updateNavigationBarView` 还是 `dbridge.setTitle/addCornerButton`，让用户去对应端 SDK 文档对齐。
- 不要编造 props——清单就是第四节那 9 个，多一个少一个都是错。
