---
name: h5-overlay-mask
description: 生成一个 H5 全屏半透明蒙层 + 配套顶导处理方案。只负责最外层那一层 rgba 黑底，里面放什么弹窗（底部 sheet / 居中 modal / 全屏页）、弹窗长什么样，都不管。当用户说"做一个 H5 半透明蒙层""透明蒙层""黑色蒙层""mask / overlay / backdrop"时触发。
---

# H5 半透明蒙层

只做两件事：

1. 一个铺满视口的**半透明黑色蒙层**。
2. **顶导处理**（蒙层一旦出现，原生顶导通常要么隐藏、要么显式设标题，避免割裂）。

**不做**：里面放什么内容、弹窗在底部还是中间、弹窗的圆角/颜色/关闭按钮——这些全部交给调用方。skill 的边界止于 `.mask` 这一层。

## 产物骨架

```vue
<template>
  <div class="overlay-mask" @click.self="onMaskTap">
    <slot />
  </div>
</template>

<script>
export default {
  name: 'OverlayMask',
  props: {
    // 是否允许点击蒙层触发关闭。默认 false，由业务侧自己决定。
    maskClosable: { type: Boolean, default: false }
  },
  methods: {
    onMaskTap() {
      if (this.maskClosable) this.$emit('close')
    }
  }
}
</script>

<style lang="stylus" scoped>
.overlay-mask
  position: fixed
  top: 0
  left: 0
  right: 0
  bottom: 0
  background: rgba(0, 0, 0, 0.7)
  z-index: 999
</style>
```

调用方自己决定里面塞什么、塞在哪：

```vue
<OverlayMask @close="hide">
  <!-- 底部 sheet / 居中 modal / 全屏页，随便 -->
  <MyBottomSheet />
</OverlayMask>
```

## 设计要点

- **铺满视口**：`position: fixed` + 四向 0。
- **半透明黑底**：`rgba(0, 0, 0, 0.7)` 起步，业务可覆盖。
- **z-index**：默认 999，调用方自己有体系就覆盖。
- **`@click.self`**：只拦截蒙层自身的点击，不冒泡到内部内容；是否真的关闭由 `maskClosable` 决定，**默认 false 防误触**。
- **不做布局**：不写 `display: flex` 不写 `align-items`——一旦写了就隐含「内容在底部 / 中间」的产品决策，违背 skill 边界。布局让调用方自己加。

## 顶导处理（必读，生成完蒙层后主动提示使用者）

蒙层一出现，端上的原生顶导如果不处理，会出现"上方一条原生导航条 + 下方半透明黑底"的割裂感。**三种方案三选一**，这是产品决策，不要替使用者选。

### 方案 A：完全隐藏顶导

适用：整页只是一个蒙层 + 里面一个弹层，没有标题/返回的需求，希望顶导**整条消失**（连返回箭头都没有）。

**做法**：让后端在下发页面链接时，URL 拼接 `hideNavigation=1`，端会识别并隐藏原生顶导。

```
https://xxx.didi.com/path?xxx=xxx&hideNavigation=1
```

页面侧零代码，但**必须在 PR / 联调说明里告知后端加这个参数**，否则顶导不会消失。

### 方案 B：透明顶导 + 保留左侧返回箭头

适用：希望顶导**视觉上消失**（融入蒙层），但**保留左上角原生返回箭头**让用户能退出页面。

**前置依赖：当前 App 必须支持统一 bridge（UnifyBridge）**。在使用本方案前，**必须先和使用者确认**："当前 App 是否接入了统一 bridge？" —— 如果使用者不确定，让他们去查；如果确认**不支持**，**让使用者重新在三个方案里选一个**（A 或 C），**不要默认回退到任何方案**（UnifyBridge 在不支持的端上调用会无效或报错，而 A 和 C 是不同的产品形态，必须由使用者决策）。

确认支持后，在页面 `mounted` 里调用：

```js
import UnifyBridge from '@didi/unify-bridge' // 实际包名以项目为准

mounted() {
  try {
    UnifyBridge.updateNavigationBarView({
      bar: {
        backgroundColors: ['#00FFFF00']  // 8 位 hex，最后两位是 alpha=00 → 完全透明
      },
      titleView: {
        title: '',
        titleColor: '#00000000',          // 标题文字也透明
        alignment: 0
      }
    })
  } catch (e) {
    // 兜底：bridge 不可用时静默；如果生产环境出现，应回退到方案 A
  }
}
```

要点：

- `backgroundColors` 是数组，`#00FFFF00` 后两位 `00` 是 alpha 通道（完全透明），前面 `00FFFF` 是 RGB（透明时颜色其实不重要）。
- 返回箭头由原生顶导自带，不需要额外配置——把背景和标题文字都置透明后，可视部分就只剩它。
- 该方法是 `async`，能 `await` 就 `await`，但调用失败不要阻塞页面渲染。

### 方案 C：保留顶导 + 设置标题

适用：需要原生顶导（带返回、带标题、有底色）的常规场景。两步都要做：

1. **`index.html` 兜底标题**：检查项目根 `index.html` 的 `<title>`，确保有一个**通用默认标题**（如"跳转中"或产品名），避免 bridge 调用前的瞬间出现 URL 或空白。

   ```html
   <title>跳转中</title>
   ```

2. **bridge 设置真实标题**：页面 `mounted` 里调 `dbridge.setTitle`，建议 `setTimeout` 包一层避免端侧时序问题。

   ```js
   import { dbridge } from '@didi/driver-bridge'

   mounted() {
     try {
       setTimeout(() => {
         dbridge.setTitle && dbridge.setTitle({ title: '页面名称' })
       }, 500)
     } catch (e) {
       // bridge 不可用时静默
     }
   }
   ```

### 生成产物时必须做的事

写完蒙层后，**主动询问使用者**（按这个顺序问，回答顺着流程走）：

> 顶导处理请三选一：
> **A. 完全隐藏顶导** → 通知后端在页面 URL 拼 `hideNavigation=1`，页面侧零代码。
> **B. 透明顶导 + 保留返回箭头** → 我会在 `mounted` 调 `UnifyBridge.updateNavigationBarView` 把背景和标题置透明。**前提：当前 App 已接入统一 bridge**——你确认支持吗？不支持就回退到 A。
> **C. 保留顶导 + 设置标题** → 我会在 `mounted` 加 `dbridge.setTitle({ title: 'XXX' })`，并检查 `index.html` 是否已有兜底 `<title>`。

如果使用者选 B 但 App **确认不支持** UnifyBridge，**重新让使用者在三个方案里再选一次**（实际上就是在 A 和 C 之间二选一）。**不要替使用者默认选 A 或 C**——这是不同的产品形态（A 没有任何顶导，C 是常规带标题顶导），必须由使用者决策。

如果使用者选 B 但**无法确认**是否支持，先让他们去查；查不到就同样回到三选一的询问。
