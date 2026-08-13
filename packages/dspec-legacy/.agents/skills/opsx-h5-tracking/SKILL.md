---
name: tracking-dev
description: 根据埋点 PRD 自动完成埋点开发。当用户需要实现埋点功能、添加数据上报、或提到"埋点"、"追踪"、"tracking"、"omega"、"event"时使用此 skill。该 skill 会解析 PRD 文档，生成改动文档供用户确认，然后完成代码开发。
---

# 埋点开发 Skill

## 概述

本 skill 用于根据埋点 PRD 文档自动完成埋点开发。工作流程：
1. 读取并解析 Cooper 埋点 PRD 文档
2. 生成埋点改动文档（包含字段映射关系）
3. 等待用户确认改动文档
4. 完成埋点代码开发

## 使用前准备

确保项目中已安装埋点 SDK：
- Vue 2 项目通常使用 `@didi/driver-biz-sdk` 中的 `omega`
- 导入方式：`import { omega } from '@didi/driver-biz-sdk'`

## 工作流程

### 第一步：解析 PRD 文档

使用 cooper skill 读取 Cooper 文档内容，提取以下信息：

1. **埋点名称**：事件的中文名称
2. **Event ID**：埋点标识符（如 `wyc_pcxz_driteam_card_list_sw`）
3. **上报时机**：何时触发埋点
4. **应用**：埋点应用的平台/页面
5. **埋点参数**：需要上报的字段（key/value）

**命名规范说明**：
- `wyc`：网约车业务前缀
- `_sw` 后缀：曝光埋点（show）
- `_ck` 后缀：点击埋点（click）

### 第二步：生成埋点改动文档

创建一个详细的改动文档，包含以下内容：

```markdown
# 埋点改动文档

## 1. [埋点名称]

### 基本信息
- **Event ID**: `xxx_xxx_xxx_sw`
- **上报时机**: [具体时机描述]
- **应用页面**: [页面名称/路径]

### 参数列表

| 参数名 | 类型 | 说明 | 来源字段 | 映射路径 |
|--------|------|------|----------|----------|
| param1 | string | 参数说明 | api_field1 | data.api_field1 |
| param2 | number | 参数说明 | api_field2 | item.status |

### 上报时机映射

**PRD 描述**: [原始描述]
**实现方式**:
- [ ] 页面加载时（onMounted）
- [ ] 按钮点击时（@click）
- [ ] 元素曝光时（IntersectionObserver）
- [ ] 其他：[具体说明]

### 接口对应关系

**依赖接口**: `/api/xxx`
**字段映射**:
- `param1` ← `response.data.field1`
- `param2` ← `response.items[0].status`

---

## 2. [下一个埋点]
...
```

### 第三步：等待用户确认

**必须等待用户确认以下内容**：
1. ✅ 参数与接口字段的映射关系是否正确
2. ✅ 上报时机的实现方式是否符合预期
3. ✅ 是否需要调整任何参数

**用户确认后才能继续开发**。

### 第四步：完成埋点开发

根据确认后的文档，在代码中实现埋点：

#### 曝光埋点 (_sw)

```typescript
import { omega } from '@didi/driver-biz-sdk'
import { onMounted, onBeforeUnmount } from 'vue'

// 方式1：页面曝光
onMounted(() => {
  omega.trackEvent('event_id_sw', {
    param1: data.value.field1,
    param2: data.value.field2
  })
})

// 方式2：元素曝光（IntersectionObserver）
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!elementRef.value) return
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      omega.trackEvent('event_id_sw', {
        param1: data.value.field1
      })
      observer?.disconnect()
    }
  })
  observer.observe(elementRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
```

#### 点击埋点 (_ck)

```typescript
import { omega } from '@didi/driver-biz-sdk'

const handleButtonClick = () => {
  omega.trackEvent('event_id_ck', {
    button_text: '确认',
    page_type: 'detail'
  })
  // 其他业务逻辑...
}
```

#### Watch 触发埋点

```typescript
import { watch } from 'vue'
import { omega } from '@didi/driver-biz-sdk'

watch(() => props.visible, (val) => {
  if (val) {
    omega.trackEvent('event_id_sw', {
      pop_type: 1,
      activity_id: props.activityId
    })
  }
})
```

## 代码规范

1. **导入语句**: 统一放在文件顶部，与其他导入语句一起
2. **埋点位置**: 就近原则，放在触发事件的处理函数中
3. **注释**: 在埋点上方添加 `// [埋点名称]埋点` 注释
4. **参数顺序**: 按照 PRD 文档中的参数顺序保持一致
5. **条件判断**: 如果参数可能为空，需要添加空值保护

## 示例

### 示例：报名确认弹窗曝光埋点

**PRD 信息**:
- Event ID: `wyc_pcxz_driteam_card_list_sighup_confirm_pop_sw`
- 上报时机: 弹窗展示时
- 参数:
  - pop_type: 弹窗类型
  - activity_type: 活动类型
  - activity_id: 活动ID

**生成的改动文档**:
```markdown
### 基本信息
- **Event ID**: `wyc_pcxz_driteam_card_list_sighup_confirm_pop_sw`
- **上报时机**: 弹窗展示时
- **应用页面**: carpool-squad/SignUpPopup.vue

### 参数列表

| 参数名 | 类型 | 说明 | 来源字段 | 映射路径 |
|--------|------|------|----------|----------|
| pop_type | number | 弹窗类型 | enrollType | props.enrollType |
| activity_type | string | 活动类型 | activity_type | popupData.single_activity_info.activity_type |
| activity_id | string | 活动ID | activity_id | popupData.single_activity_info.activity_id |

### 上报时机映射

**PRD 描述**: 弹窗展示时
**实现方式**:
- [x] Watch 监听 visible 属性变化

### 接口对应关系

**依赖接口**: 弹窗数据来源于父组件传入的 popupData prop
**字段映射**:
- `pop_type` ← `props.enrollType`
- `activity_type` ← `props.popupData.single_activity_info?.activity_type`
- `activity_id` ← `props.popupData.single_activity_info?.activity_id`
```

**实现代码**:
```typescript
watch(() => props.visible, (val) => {
  if (val) {
    omega.trackEvent('wyc_pcxz_driteam_card_list_sighup_confirm_pop_sw', {
      pop_type: props.enrollType,
      activity_type: props.popupData.single_activity_info?.activity_type,
      activity_id: props.popupData.single_activity_info?.activity_id
    })
  }
})
```

## 注意事项

1. **优先使用 cooper skill**: 读取 Cooper 文档时，主动调用 cooper skill
2. **参数可选性**: 如果接口字段可能不存在，使用可选链 `?.` 或提供默认值
3. **埋点去重**: 对于曝光埋点，使用 `observer.disconnect()` 避免重复上报
4. **性能优化**: 大量埋点时考虑节流/防抖
5. **类型安全**: 确保 TypeScript 类型定义正确

## 输出格式

最终输出：
1. **埋点改动文档** (Markdown 格式，保存为 `tracking-changes.md`)
2. **代码改动** (直接修改相关 .vue/.ts 文件)
3. **改动摘要** (在对话中说明修改了哪些文件，添加了哪些埋点)

## 错误处理

如果遇到以下情况，主动询问用户：
- PRD 文档信息不完整
- 接口字段映射不明确
- 上报时机描述模糊
- 现有代码结构不适合直接添加埋点
