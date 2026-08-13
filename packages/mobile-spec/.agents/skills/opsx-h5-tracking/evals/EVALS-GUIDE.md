# Tracking-Dev Skill 测评套件说明

## 📋 测评维度

本测评套件从三个维度全面评估 tracking-dev skill 的表现：

### 1. 命中测试（Trigger）- 5个用例

测试 skill 的触发准确性，确保在正确的场景下触发，避免误触发。

| ID | 测试场景 | 预期行为 |
|----|---------|---------|
| 1 | 明确提到"埋点开发" | ✅ 应该触发 |
| 2 | 提到"数据上报"、"埋点需求" | ✅ 应该触发 |
| 3 | 提到"omega.trackEvent" | ✅ 应该触发 |
| 4 | 普通功能开发（如"用户登录"） | ❌ 不应触发 |
| 5 | UI 开发需求（如"弹窗组件"） | ❌ 不应触发 |

**关键指标**：
- 精确率（Precision）：正确触发 / 总触发次数
- 召回率（Recall）：正确触发 / 应触发次数
- 目标：精确率 > 95%，召回率 > 90%

---

### 2. 能力测试（Capability）- 6个用例

测试 skill 的核心功能覆盖，确保每个关键能力都能正常工作。

| ID | 能力项 | 测试内容 |
|----|--------|---------|
| 6 | 解析 Cooper PRD 文档 | 能否成功读取并提取埋点信息 |
| 7 | 生成埋点改动文档 | 能否生成包含字段映射的改动文档 |
| 8 | 等待用户确认 | 能否在关键步骤等待用户确认 |
| 9 | 实现曝光埋点代码 | 能否正确实现 IntersectionObserver 逻辑 |
| 10 | 实现点击埋点代码 | 能否在点击函数中正确添加埋点 |
| 11 | 处理公参 | 能否正确处理公参（不手动传入） |

**关键指标**：
- 功能覆盖率：成功用例 / 总用例
- 目标：覆盖率 = 100%

---

### 3. 功能测试（Functionality）- 9个用例

测试 skill 的实际输出效果，确保生成的代码和文档符合预期。

| ID | 功能场景 | 验证点 |
|----|---------|--------|
| 12 | 单个曝光埋点完整流程 | 解析→生成文档→等待确认→实现代码 |
| 13 | 批量埋点实现 | 能否一次性实现多个埋点 |
| 14 | 处理不同上报时机 | 页面曝光、元素曝光、点击、弹窗曝光 |
| 15 | 字段映射准确性 | 字段路径是否正确 |
| 16 | 代码质量 | 注释、可选链、资源清理 |
| 17 | 处理枚举值 | 透传或转换枚举参数 |
| 18 | 错误处理 | 信息缺失时主动询问 |
| 19 | 生成总结文档 | 包含改动详情和验证清单 |
| 20 | 处理二选一模式 | 正确处理 squad_types 数组 |

**关键指标**：
- 准确率：正确输出 / 总输出
- 完整性：是否包含所有必要信息
- 目标：准确率 > 90%，完整性 = 100%

---

## 🧪 如何运行测评

### 方式 1：运行单个测试用例

使用 Agent 工具运行：

```typescript
// 运行 with-skill 版本
Agent({
  description: "测试用例 6 - 解析 Cooper PRD",
  prompt: "请根据这个埋点 PRD 完成开发：https://cooper.didichuxing.com/knowledge/2201321764485/2207297448492",
  subagent_type: "general-purpose"
})

// 运行 baseline 版本（不使用 skill）
Agent({
  description: "Baseline - 测试用例 6",
  prompt: "请根据这个埋点 PRD 完成开发：https://cooper.didichuxing.com/knowledge/2201321764485/2207297448492",
  subagent_type: "general-purpose"
})
```

### 方式 2：批量运行所有测试

创建运行脚本：

```bash
#!/bin/bash
# run-all-evals.sh

SKILL_PATH="/Users/didi/.claude/skills/tracking-dev"
WORKSPACE="/Users/didi/.claude/skills/tracking-dev-workspace"
ITERATION="iteration-1"

# 创建工作目录
mkdir -p "$WORKSPACE/$ITERATION"

# 运行每个测试用例
for i in {1..20}; do
  echo "运行测试用例 $i..."
  
  # 创建测试目录
  mkdir -p "$WORKSPACE/$ITERATION/eval-$i-with_skill"
  mkdir -p "$WORKSPACE/$ITERATION/eval-$i-baseline"
  
  # 这里需要调用 Claude Code API 运行测试
  # 实际运行时需要使用 Agent 工具
done

echo "所有测试完成，开始生成报告..."

# 聚合结果
cd /Users/didi/.claude/skills/skill-creator
python -m scripts.aggregate_benchmark "$WORKSPACE/$ITERATION" --skill-name tracking-dev

# 生成可视化报告
python eval-viewer/generate_review.py \
  "$WORKSPACE/$ITERATION" \
  --skill-name "tracking-dev" \
  --benchmark "$WORKSPACE/$ITERATION/benchmark.json"
```

### 方式 3：使用 skill-creator 的脚本

```bash
cd /Users/didi/.claude/skills/skill-creator

# 运行单个测试
python -m scripts.run_eval \
  --eval-id 6 \
  --skill-path /Users/didi/.claude/skills/tracking-dev \
  --workspace /Users/didi/.claude/skills/tracking-dev-workspace

# 运行所有测试
python -m scripts.run_eval \
  --all \
  --skill-path /Users/didi/.claude/skills/tracking-dev \
  --workspace /Users/didi/.claude/skills/tracking-dev-workspace
```

---

## 📊 评估指标

### 1. 命中测试指标

```python
# 精确率 = 正确触发次数 / 总触发次数
precision = correct_triggers / total_triggers

# 召回率 = 正确触发次数 / 应触发次数
recall = correct_triggers / should_trigger_count

# F1 分数
f1_score = 2 * (precision * recall) / (precision + recall)
```

**目标**：
- Precision > 95%
- Recall > 90%
- F1 Score > 92%

### 2. 能力测试指标

```python
# 功能覆盖率
coverage = successful_cases / total_capability_cases

# 平均成功率
success_rate = sum(passed_assertions) / sum(total_assertions)
```

**目标**：
- Coverage = 100%
- Success Rate > 95%

### 3. 功能测试指标

```python
# 准确率
accuracy = correct_outputs / total_outputs

# 完整性
completeness = outputs_with_all_info / total_outputs

# Token 效率
token_efficiency = successful_outputs / total_tokens
```

**目标**：
- Accuracy > 90%
- Completeness = 100%
- Token Efficiency > 0.001 (每 1000 tokens 完成一个有效输出)

---

## 📈 预期结果

### 命中测试

| 指标 | 预期值 | 说明 |
|------|--------|------|
| 精确率 | > 95% | 避免误触发 |
| 召回率 | > 90% | 避免漏触发 |
| F1 分数 | > 92% | 综合表现 |

### 能力测试

| 能力项 | 预期状态 | 说明 |
|--------|---------|------|
| 解析 Cooper PRD | ✅ 通过 | 核心能力 |
| 生成改动文档 | ✅ 通过 | 核心能力 |
| 等待用户确认 | ✅ 通过 | 关键流程 |
| 实现曝光埋点 | ✅ 通过 | 核心能力 |
| 实现点击埋点 | ✅ 通过 | 核心能力 |
| 处理公参 | ✅ 通过 | 细节处理 |

### 功能测试

| 功能场景 | 预期结果 | Token 消耗 |
|---------|---------|-----------|
| 单个埋点 | 完整流程 | 20K-40K |
| 批量埋点 | 全部实现 | 60K-100K |
| 不同上报时机 | 正确识别 | 30K-50K |
| 字段映射 | 准确无误 | 20K-30K |
| 代码质量 | 符合规范 | 20K-40K |

---

## 🎯 优化建议

### 如果命中测试不达标

1. **精确率低**：调整 skill description，增加"不应触发"的场景说明
2. **召回率低**：扩展 skill description，增加更多触发关键词

### 如果能力测试不达标

1. **解析失败**：检查 Cooper skill 是否正常工作
2. **生成文档失败**：检查模板文件是否存在
3. **代码实现失败**：检查项目结构和文件路径

### 如果功能测试不达标

1. **字段映射错误**：改进字段映射逻辑，增加验证步骤
2. **代码质量差**：添加代码规范检查，生成更规范的代码
3. **Token 消耗高**：优化提示词，减少不必要的输出

---

## 📝 测试报告模板

```markdown
# Tracking-Dev Skill 测评报告

## 测试概览

- 测试时间：2026-07-07
- 测试用例：20个
- 通过率：XX%

## 命中测试结果

| 指标 | 结果 | 目标 | 状态 |
|------|------|------|------|
| 精确率 | XX% | > 95% | ✅/❌ |
| 召回率 | XX% | > 90% | ✅/❌ |
| F1 分数 | XX% | > 92% | ✅/❌ |

## 能力测试结果

| 能力项 | 结果 | Token 消耗 |
|--------|------|-----------|
| 解析 Cooper PRD | ✅/❌ | XXK |
| 生成改动文档 | ✅/❌ | XXK |
| ... | ... | ... |

## 功能测试结果

| 功能场景 | 准确性 | 完整性 | Token 消耗 |
|---------|--------|--------|-----------|
| 单个埋点 | XX% | XX% | XXK |
| 批量埋点 | XX% | XX% | XXK |
| ... | ... | ... | ... |

## 改进建议

1. ...
2. ...
```

---

## 🚀 快速开始

### 运行最小测试集（推荐）

只运行关键测试用例，快速验证 skill 功能：

```bash
# 测试用例 1, 6, 12 - 覆盖三个维度
python -m scripts.run_eval --eval-ids 1,6,12 --skill-path ...
```

### 运行完整测试集

```bash
# 运行所有 20 个测试用例
python -m scripts.run_eval --all --skill-path ...
```

---

## 📚 相关文档

- [evals.json](evals/evals.json) - 完整的测试用例定义
- [tracking-changes.md](tracking-changes.md) - 埋点改动文档示例
- [tracking-implementation-summary.md](tracking-implementation-summary.md) - 实现总结示例

---

**总结**：本测评套件从命中、能力、功能三个维度全面评估 tracking-dev skill，确保其在实际使用中表现稳定可靠。