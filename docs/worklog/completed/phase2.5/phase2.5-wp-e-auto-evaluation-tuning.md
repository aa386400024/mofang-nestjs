# WP-E: 自动评测 + 参数调优（Auto Evaluation & Tuning Pipeline）

> **状态**: ✅ 已交付（2026-11-09）→ [交付记录](phase2.5-wp-e-auto-evaluation-implementation-2026-11-09.md)
> **优先级**: 🟡 P1
> **依赖**: WP-A（审议输入最小化）✅ / WP-C（触发式闸门）✅ / WP-D（模拟咨询师 + 自动对练）✅ / WP-B（版本指纹）✅
> **预估工作量**: 3-4 天
> **红线**: engine-core 零改动；心理数据不出境

---

## 一、背景与目标

### 现状
- WP-A/B/C/D 已交付：审议输入最小化、版本锁定、触发式闸门、自动对练都建好了
- 但**审议质量到底好不好？阈值合不合理？** 没有量化指标，全靠感觉
- 出口条件④要求：审议建议准确率 ≥ 80%——现在连怎么算准确率都不知道

### 目标
建一条**可重复、可对比、可追溯**的评测流水线：
- 跑一批自动对练 → 收集审议输出 → 跟 ground truth 对比 → 算指标 → 出报告
- 每次改阈值/prompt/代码都能跑一遍，跟上一版比，指标跌了就知道改坏了
- 最终目标：调到审议准确率 ≥ 80%，满足 Phase2.5 出口条件④

### 不是什么
- ❌ 不是一次性脚本跑一遍看个数
- ❌ 不是人工抽检系统
- ❌ 不是实时在线评测
- ✅ 是**持续质量保障体系的核心模块**——以后每次发版都要跑的门禁

---

## 二、范围

### 2.1 做什么

| # | 模块 | 说明 |
|---|---|---|
| 1 | 评测流水线核心 | 数据集加载 → 批量跑 → 对比 ground truth → 算指标 → 出报告 |
| 2 | 指标体系 | 触发质量（P/R/F1）+ 建议质量（方向准确率 + 幅度 MAE）+ 基线对比 |
| 3 | 两种评测模式 | **离线评测**（读已有数据，零成本）+ **全量重跑**（改引擎逻辑时用） |
| 4 | 数据清洗门槛 | 过滤异常 session，脏数据不进入主指标 |
| 5 | 训练集/验收集分离 | A=规则当 ground truth（训练集，随便用）；B=督导案例（验收集，最后才用） |
| 6 | 方差处理 | 跑 3 次取均值 + 标准差，不是单次结果 |
| 7 | 回归保护 | 同时跑纯规则基线 + LLM 审议，规则模式指标跌了就是代码改坏了 |
| 8 | 结构化报告 | JSON 报告 + 观测日志（场次/耗时/成本/数据质量统计） |
| 9 | 督导案例验收集 | 整理已有心理咨询督导案例，结构化后当最终验收集 |
| 10 | 人工抽检扩展口子 | 每条评测结果有唯一 ID，以后能导出待抽检样本 |

### 2.2 不做什么

| 不做的 | 为什么 | 什么时候做 |
|---|---|---|
| 自动调参 / 贝叶斯优化 | 手动调两轮就有感觉了，一个人维护不起 Optuna | 准确率卡 80% 上不去的时候再说 |
| LLM-as-judge 裁判模型 | 裁判本身有偏差，需要人工校准，成本高 | Phase3 数据多了再说 |
| CI 集成（每次 commit 自动跑） | 一个人维护不起 CI，先手动跑 | 流水线设计成"以后能接 CI"就行 |
| 实时评测 | 离线批处理就够了 | —— |
| 自动标注工具 | 督导案例是外部的，不需要标注工具 | —— |

---

## 三、架构设计

### 3.1 目录结构（微服务友好）

```
src/engine-adapters/eval/
  ├── eval.types.ts              ← 类型契约（纯 TS, 零 @nestjs）
  ├── eval.dataset.ts            ← 数据集加载与清洗
  ├── eval.metrics.ts            ← 指标计算（纯函数, 零 IO）
  ├── eval.runner.ts             ← 评测执行器（批量跑 + 收集结果）
  ├── eval.report.ts             ← 报告生成 + 存数据库
  ├── eval.ground-truth.ts       ← ground truth 提供者（规则模式 / 督导案例）
  ├── eval.service.ts            ← 入口：串链路 + 兜异常
  └── eval.module.ts             ← NestJS 模块

scripts/
  └── eval-runner.ts             ← CLI 入口：命令行触发评测

test/engine-adapters/eval/
  ├── eval.metrics.spec.ts       ← 指标计算单测
  ├── eval.dataset.spec.ts       ← 数据清洗单测
  └── eval.runner.spec.ts        ← 执行器单测
```

### 3.2 分层原则（跟 WP-C 一样）

| 层 | 文件 | 职责 | 红线 |
|---|---|---|---|
| **计算层** | `eval.metrics.ts` | 只算指标，纯函数，零 IO | 输入结构化预测 + ground truth，输出指标对象 |
| **数据层** | `eval.dataset.ts` | 加载 session 数据 + 清洗 | 脏数据过滤逻辑集中在这里 |
| **执行层** | `eval.runner.ts` | 批量跑引擎，收集预测结果 | 不做指标计算，只收集 |
| **入口层** | `eval.service.ts` | 串链路 + 兜异常 + 留痕 | 不抛；出错报告里标记 |

**为什么这么切**：指标计算是纯函数，可以不起数据库就单测；执行层跟引擎耦合，可以 mock。

### 3.3 数据流

```
┌─────────────────────────────────────────────────────────┐
│  输入：数据集版本 + 配置版本（模型/prompt/阈值/env）     │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  1. 数据集加载 + 清洗                                   │
│     - 读 session 数据（离线模式读已有，全量模式新跑）   │
│     - 过滤：轮次 < 5 / 中途报错 / BDI 异常 → 扔掉        │
│     - 统计：总场次 / 有效场次 / 扔掉场次 / 原因          │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  2. 跑引擎，收集预测                                    │
│     - 纯规则模式 → baseline 预测                        │
│     - 规则 + LLM 审议 →被测对象预测                      │
│     - 跑 3 次取均值（处理 LLM 方差）                     │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  3. 对比 ground truth，算指标                           │
│     - 触发质量：Precision / Recall / F1                  │
│     - 建议质量：方向准确率 + 幅度 MAE                    │
│     - 基线对比：baseline vs 被测对象                     │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  4. 生成报告 + 存数据库                                  │
│     - JSON 报告：指标明细 + 数据质量 + 耗时 + 成本       │
│     - 存 eval_reports 表，历史可查                      │
│     - 跟上次报告 diff：哪个维度涨了/跌了                 │
└─────────────────────────────────────────────────────────┘
```

---

## 四、指标体系

### 4.1 触发质量（闸门准不准）

评测对象：**WP-C 触发式闸门**——该跑审议的时候跑了没？不该跑的时候瞎跑了没？

| 指标 | 定义 | 怎么算 |
|---|---|---|
| **Precision** | 跑了审议的轮次里，真的有价值的占多少 | TP / (TP + FP) |
| **Recall** | 该跑审议的轮次里，实际跑了多少 | TP / (TP + FN) |
| **F1** | 综合分 | 2 × P × R / (P + R) |

**TP/FP/FN 怎么定义：**
- ground truth 说"这一轮应该跑审议"（规则算不准/状态变化大），闸门也跑了 → TP
- ground truth 说"这一轮应该跑审议"，闸门没跑 → FN（漏报）
- ground truth 说"这一轮不该跑审议"（平静轮），闸门跑了 → FP（误报）

**ground truth 怎么判断"该不该跑"：**
- A 方案（训练集）：用规则模式的输出对比——如果规则 delta 跟 LLM 审议 delta 差异大（方向不同或幅度差 > 0.05），说明这轮规则算不准，应该跑审议
- B 方案（验收集）：督导案例里督导标注了"这里需要咨询师反思/调整"的地方 = 应该跑审议

### 4.2 建议质量（审议输出对不对）

评测对象：**LLM 审议输出的 delta**——跟 ground truth 比，准不准？

| 指标 | 定义 | 怎么算 |
|---|---|---|
| **方向准确率** | 六个维度（trust/safety/bond/verbal/depth/style）delta 方向跟 ground truth 一致的比例 | macro F1（六个维度各自算 F1，取平均） |
| **幅度 MAE** | 方向对了的那些，delta 值的平均绝对误差 | mean(\|predicted_delta - ground_truth_delta\|) |

**方向定义：**
- delta > 0.01 → 正向（↑）
- delta < -0.01 → 负向（↓）
- \|delta\| <= 0.01 → 平稳（→）
- 三个方向一致才算方向对

### 4.3 基线对比

同时跑两个模式，对比：

| 模式 | 是什么 | 作用 |
|---|---|---|
| **baseline** | 纯规则模式（rule_only） | 回归保护——这个指标应该稳定不变 |
| **被测对象** | 规则 + LLM 审议（llm_active） | 被测的东西 |

**对比输出：**
- 被测对象 - baseline = LLM 审议带来的提升
- 如果 baseline 指标跌了 → 代码改坏了，先修回归
- 如果被测对象指标涨了 → LLM 审议真的有帮助

### 4.4 报告结构

```json
{
  "reportId": "eval-20261109-001",
  "createdAt": "2026-11-09T15:00:00Z",
  "config": {
    "model": "MiniMax-M3.1-Flash",
    "promptVersion": "v1.0",
    "gateThresholds": { "alliance": 0.05, "resistance": 0.08, "cooldown": 4 },
    "datasetVersion": "auto-practice-v1",
    "mode": "offline"
  },
  "dataQuality": {
    "totalSessions": 100,
    "validSessions": 92,
    "droppedSessions": 8,
    "dropReasons": { "tooShort": 3, "errors": 3, "bdiAnomaly": 2 }
  },
  "triggerQuality": {
    "precision": 0.78,
    "recall": 0.65,
    "f1": 0.71,
    "tp": 45, "fp": 13, "fn": 24
  },
  "suggestionQuality": {
    "directionAccuracy": {
      "trust": 0.82, "safety": 0.78, "bond": 0.75,
      "verbal": 0.70, "depth": 0.72, "style": 0.68,
      "macroAverage": 0.74
    },
    "amplitudeMAE": 0.035
  },
  "baselineComparison": {
    "baselineDirectionAccuracy": 0.68,
    "被测对象DirectionAccuracy": 0.74,
    "delta": "+0.06"
  },
  "runs": {
    "count": 3,
    "mean": { "f1": 0.71, "directionAccuracy": 0.74 },
    "stdDev": { "f1": 0.02, "directionAccuracy": 0.015 }
  },
  "cost": {
    "totalTokens": 450000,
    "estimatedCostCny": 2.3
  },
  "durationSec": 120
}
```

---

## 五、数据处理

### 5.1 数据清洗门槛

评测前过一道过滤器，脏数据不进入主指标：

| 过滤条件 | 为什么扔 |
|---|---|
| session 轮次 < 5 轮 | 太短了，没有统计意义 |
| 中间有报错 / 空回复 / LLM 超时 | 数据不完整 |
| BDI 状态异常（突然跳到 100 或 0，或连续 3 轮不变） | 引擎 bug 或 LLM 输出异常 |
| 闸门决策记录缺失（没有 trace） | 没法算触发质量 |

**报告里单独列数据质量统计**——扔了多少、为什么扔，一目了然。

### 5.2 训练集 vs 验收集分离

| 数据集 | 是什么 | 怎么用 |
|---|---|---|
| **训练集（A）** | 规则模式输出当 ground truth | 开发阶段随便用，跑多少轮都行，调参用这个 |
| **验收集（B）** | 心理咨询督导案例（带督导解析） | 最终验收用——调参过程中**不能看**，调完了才跑一次 |

**红线：** 不能用验收集调参——不然就是"考试前做过题"，准确率是假的。

### 5.3 督导案例验收集

整理已有的心理咨询督导案例（之前提到的一万份个案逐字稿 + 督导解析），结构化后当验收集。

**格式：**
```json
{
  "caseId": "case-001",
  "counselorTurns": ["...", "...", "..."],
  "visitorTurns": ["...", "...", "..."],
  "supervisorNotes": [
    {
      "turnIndex": 3,
      "issue": "咨询师过早给出建议",
      "expectedDeltas": { "trust": -0.05, "bond": -0.03 }
    }
  ]
}
```

**注意：** 如果督导案例是自由文本格式，先做一个解析器把它转成上面的结构化格式；如果格式太乱，先手工整理 20-30 个当种子集，后面再扩。

---

## 六、运行机制

### 6.1 两种评测模式

| 模式 | 什么时候用 | 成本 | 速度 |
|---|---|---|---|
| **离线评测** | 改了指标计算逻辑、改了数据清洗规则、改了报告格式 | 零（不调 LLM，读已有数据） | 秒级 |
| **全量重跑** | 改了模型/prompt/引擎逻辑/闸门阈值 | 几十块钱一次 | 几分钟 |

**CLI 用法：**
```bash
# 离线评测（读已有数据）
npx ts-node scripts/eval-runner.ts --mode offline --dataset auto-practice-v1

# 全量重跑（新跑一批对练）
npx ts-node scripts/eval-runner.ts --mode full --sessions 100 --runs 3

# 用验收集跑最终验收
npx ts-node scripts/eval-runner.ts --mode offline --dataset supervisor-cases-v1
```

### 6.2 方差处理

LLM 是概率性的，跑一次结果有波动。

**做法：** 跑 3 次，取均值 + 标准差。
- 报告里同时输出均值和标准差
- 跟上次报告对比时，差异要超过标准差才算"真的变了"
- 如果标准差 > 0.05，说明结果不稳定，需要跑更多次

### 6.3 回归保护

每次评测同时跑纯规则模式（baseline）和 LLM 审议模式（被测对象）。

**红线检查：**
- baseline 的方向准确率应该稳定（每次波动 < 0.02）
- 如果 baseline 跌了 > 0.03 → 代码改坏了，报告里标红警告
- 先修回归，再谈调参

### 6.4 观测日志

评测跑的时候全程有日志：
- 开始时间 / 结束时间 / 总耗时
- 跑了多少场 / 成功多少 / 失败多少
- 每次 LLM 调用的 token 消耗
- 数据清洗统计
- 最终指标汇总

---

## 七、交付物清单

### 7.1 新增后端文件（8 个）

```
src/engine-adapters/eval/eval.types.ts
src/engine-adapters/eval/eval.dataset.ts
src/engine-adapters/eval/eval.metrics.ts
src/engine-adapters/eval/eval.runner.ts
src/engine-adapters/eval/eval.report.ts
src/engine-adapters/eval/eval.ground-truth.ts
src/engine-adapters/eval/eval.service.ts
src/engine-adapters/eval/eval.module.ts
```

### 7.2 新增脚本（1 个）

```
scripts/eval-runner.ts
```

### 7.3 新增测试文件（3 个）

```
test/engine-adapters/eval/eval.metrics.spec.ts
test/engine-adapters/eval/eval.dataset.spec.ts
test/engine-adapters/eval/eval.runner.spec.ts
```

### 7.4 数据库

新增 `eval_reports` 表：
- id / report_id / config_json / metrics_json / data_quality_json / created_at

### 7.5 数据库

新增 `eval_reports` 表：
- id / report_id / config_json / metrics_json / data_quality_json / created_at

### 7.6 文档

- 交付记录：`docs/worklog/completed/phase2.5/phase2.5-wp-e-auto-evaluation-implementation-2026-11-09.md`
- 回写 phase2.5-README.md 和 wp-list

---

## 八、红线

1. **engine-core 零改动**：所有改动都在 `src/engine-adapters/eval/` 下
2. **心理数据不出境**：评测是离线计算，不调外部 LLM（除了全量重跑时的审议本身，那是既有逻辑）
3. **不自动 git commit / push**
4. **验收集不碰调参**：督导案例数据集只在最终验收时用
5. **规则基线不能动**：评测用的规则模式输出，不能因为"规则不准"就改规则——那是另一个 WP 的事

---

## 九、验收标准

| # | 验收项 | 通过标准 |
|---|---|---|
| 1 | tsc 0 错 | `npx tsc -p tsconfig.build.json --noEmit` 0 错 |
| 2 | eslint 0 error | 本单涉及文件 0 error |
| 3 | 单测全绿 | `npx vitest run test/engine-adapters/eval/` 全绿 |
| 4 | engine-core 零改动 | `git diff --stat HEAD -- src/engine-core` 为空 |
| 5 | CLI 能跑 | `npx ts-node scripts/eval-runner.ts --mode offline` 能出一份报告 |
| 6 | 报告结构完整 | JSON 报告包含指标体系里定义的所有字段 |
| 7 | 数据清洗生效 | 脏数据被过滤，报告里有数据质量统计 |

---

## 十、后续（本单不做）

- 手动调参：跑第一轮评测后，看哪个维度指标差，手动改 env 阈值，再跑一轮看效果
- 自动调参：手动调到准确率卡 80% 上不去的时候，再上贝叶斯优化
- CI 集成：流水线设计成"以后能接 CI"，但本单不接
- 人工抽检：留好扩展口子（每条评测结果有唯一 ID），以后做
