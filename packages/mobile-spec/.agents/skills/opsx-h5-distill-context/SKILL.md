---
name: 'opsx-h5-distill-context'
description: 从现有项目代码与文档中蒸馏初始上下文，批量填充 docs/context/ 下的 6 个上下文文件（glossary / route-map / api-map / state-model / webview-bridge / tracking）。用于项目首次接入 mobile-spec、或 context 文档严重过时需重建时。
category: Bootstrap
tags: [bootstrap, context, distill, onboarding, h5]
---

从已有项目代码、路由配置、接口调用、产品文档中蒸馏初始上下文，创建或维护 `docs/index.md`，并批量填充 `docs/context/` 的 6 个分类文件。

**Input**: 蒸馏范围（可选）。若未指定，默认全量；可指定子集如 `api-map,route-map`。

**与 `mobile-spec-sync-context` 的区别**

| 维度 | `opsx-h5-distill-context`（本 skill） | `sync-context` |
|------|-------------------------------|----------------|
| 触发时机 | 首次接入 / 重建 | 每次 change archive 后 |
| 输入来源 | 现有代码、路由、接口、文档 | 单个 change 的 design / specs / proposal |
| 输出范围 | 6 个 context 文件批量填充 | 受本次变更影响的子集 |
| 写入方式 | 初始化为主，已有内容跳过 | 精确追加 / 修改 |

---

## Steps

### 1. 确认蒸馏范围

如果用户未指定范围：

- `docs/index.md` 已存在时先读取其路由表；首次初始化不存在时使用下列 6 个固定分类作为候选。
- 向用户用 **AskUserQuestion tool** 确认蒸馏范围（multiSelect）：

- `glossary` — 业务术语
- `route-map` — 路由与页面清单
- `api-map` — 接口清单
- `state-model` — 状态机与权限规则
- `webview-bridge` — JSBridge 与容器能力
- `tracking` — 埋点与上报

**IMPORTANT**: 按用户实际需要的子集执行。

### 2. 探测项目结构

并行执行（使用 Glob / Grep）：

| 目标 | 探测方式 |
|------|---------|
| 路由配置 | 搜索 `react-router` / `vue-router` / `createRouter` / `routes:` 等；定位 `routes.ts` / `router.ts` / `pages/` 目录 |
| 接口调用 | 搜索 `axios` / `fetch(` / `request(` / `http.` 等；提取 URL 字面量 |
| JSBridge 调用 | 搜索 `JSBridge` / `DiDiJSBridge` / `window.webkit` / `bridge.call` |
| 埋点上报 | 搜索 `track(` / `report(` / `sensors.track` / `omega.trackEvent` |
| 状态/权限 | 搜索 `Role` / `permission` / `useAuth` / `xstate` / `状态机` 注释 |
| 业务术语 | 读取 `README.md` / `docs/` 下的产品/PRD 文档 |

把探测结果以**清单 + 文件路径**形式整理在内存中，**不直接写入**。

### 3. 对每个蒸馏目标提取条目

按 Step 1 确认的范围，分别构造数据：

**route-map** — 从路由配置中提取：

| 字段 | 提取方式 |
|------|---------|
| 路由路径 | `path: '/order/detail'` 中的字符串字面量 |
| 页面名称 | `component` 引用的组件名 / 对应 `pages/` 目录名 |
| 说明 | 从组件文件头注释、邻近 PRD 或目录 README 提取（不臆造） |

**api-map** — 从接口调用中提取：

| 字段 | 提取方式 |
|------|---------|
| 接口名 | URL 末段 + 调用处的函数名 |
| METHOD + Path | `request({ method: 'POST', url: '/x' })` 或 `axios.post('/x')` |
| 状态 | 默认填 `✅ 稳定`（既有代码默认稳定）|
| 说明 | 从调用处 JSDoc 或邻近注释提取 |

**glossary** — 优先来源：

1. `README.md` / 项目根 `docs/glossary*.md`（若存在）
2. PRD 文档中**首次定义的专有名词**（带「指 / 即」等定义句）
3. 代码中大量出现的领域命名（如 `OrderType.PRE_BOOK`）

**state-model** — 从枚举/状态机/权限 hook 中提取：

- `enum Status { ... }` / `as const` 状态联合
- `useAuth()` / `<PermissionGate>` 的判定条件
- 注释中明确的「A 状态下不能 B」类约束

**webview-bridge** — 从 JSBridge 调用中提取：

| 字段 | 提取方式 |
|------|---------|
| 能力名 | `JSBridge.call('methodName', ...)` 中的 methodName |
| 调用方式 | 完整调用片段（含参数 schema 示意）|
| 可用平台 | 从邻近平台判断代码（`isIOS` / `isAndroid`）推断，无法确定填 `两端` |

**tracking** — 从埋点调用中提取：

| 字段 | 提取方式 |
|------|---------|
| 事件名 | `track('event_name', ...)` 中的 event_name |
| 触发时机 | 调用所在函数名 + 邻近注释 |
| 关键参数 | 调用 payload 的 key 列表 |
| 上报平台 | 根据 SDK 名（`sensors` / `omega`）推断 |

**通用规则：**

- 不臆造：找不到「说明」字段就填 `（待补充）`，不要编造
- `来源 change` 列统一填 `bootstrap`（表示蒸馏自既有代码，非某次 change）
- 单个文件提取条目 > 50 时，按模块/前缀分组聚合，避免表格过长

### 4. 读取现有 context 文件

对每个目标文件，读取当前内容：

- 若包含 `（暂无，首次归档后自动填充）` 占位行 → 视为空，可整体替换数据行
- 若已有内容行 → 进入「合并模式」：
  - 同 key（路径 / 接口 / 事件名）已存在 → 跳过（不覆盖既有人工编辑）
  - 新 key → 追加到表格末尾

### 5. 展示预览并确认

按文件分组展示**即将写入的条目数 + 前 5 行示例**：

```
## 蒸馏预览

### route-map.md（新增 23 条 / 跳过 0 条）
+ | /order/list | OrderList | 订单列表页 | bootstrap |
+ | /order/detail | OrderDetail | 订单详情页 | bootstrap |
...

### api-map.md（新增 17 条 / 跳过 2 条已存在）
+ | getOrderList | GET /api/order/list | 订单列表接口 | ✅ 稳定 | bootstrap |
...

### glossary.md（新增 8 条）
+ | 预约单 | 司机提前接收、约定时间出发的订单 | bootstrap |
...

共影响 6 个文件，新增 N 条，跳过 M 条已存在条目。
```

用 **AskUserQuestion tool** 让用户确认：

- `确认全部写入` — 执行所有更新
- `选择性写入` — 让用户选择写入哪些文件
- `取消` — 不做任何修改

### 6. 执行写入

先创建或维护 `docs/index.md`：

- 不存在时创建固定路由表，至少包含以下“变更信号 → 必读文件”：
  - 术语、业务命名 → `docs/context/glossary.md`
  - 页面、路由、跳转 → `docs/context/route-map.md`
  - 接口、字段、协议 → `docs/context/api-map.md`
  - 状态、权限、生命周期 → `docs/context/state-model.md`
  - 容器能力、JSBridge → `docs/context/webview-bridge.md`
  - 埋点、事件、上报 → `docs/context/tracking.md`
- 已存在时保留人工路由，只补齐缺失的上述固定路径，不重写其他内容。

逐文件用 **Edit tool** 精准插入数据行：

- 占位行 `（暂无，首次归档后自动填充）` → 用 Edit 整行替换为第一条数据
- 后续条目 → 在表格末尾追加
- **保持原表头与原说明段落不动**

每个文件 Edit 成功后再处理下一个，失败立即停止并报告。

### 7. 输出蒸馏报告

```
## Context 蒸馏完成

**蒸馏时间:** YYYY-MM-DD
**蒸馏范围:** route-map, api-map, glossary, ...

**写入统计:**
- route-map.md — 新增 23 条
- api-map.md — 新增 17 条（跳过 2 条已存在）
- glossary.md — 新增 8 条
- state-model.md — 新增 5 条
- webview-bridge.md — 新增 11 条
- tracking.md — 新增 34 条

**待人工补全:**
以下条目"说明"字段为 `（待补充）`，建议结合 PRD 补全：
- api-map.md: getOrderList / cancelOrder
- route-map.md: /promotion/landing

**下一步:**
- 人工 review 蒸馏结果，纠正不准确的描述
- 后续每次 change archive 后运行 mobile-spec-sync-context 增量维护
```

---

## Guardrails

- **不臆造**：找不到的字段填 `（待补充）`，绝不编造业务含义
- **路由唯一入口**：只维护 `docs/index.md`，不得创建其他 context index
- **不覆盖已有内容**：合并模式按 key 去重，已存在条目一律跳过
- **大项目分批**：单文件条目超过 50 条时按模块分组，避免表格不可读
- **来源标注**：所有蒸馏条目 `来源 change` 列统一填 `bootstrap`，便于后续区分人工 / 蒸馏 / change 来源
- **只读源代码**：本 skill 不修改任何业务代码，只写入 `docs/index.md` 与 `docs/context/` 下的 6 个文件
- **幂等**：可重复运行，第二次运行只追加新发现的条目，已有条目跳过
