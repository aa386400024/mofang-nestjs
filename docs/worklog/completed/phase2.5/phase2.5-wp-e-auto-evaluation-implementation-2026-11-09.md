# WP-E 交付记录：自动评测 + 参数调优流水线（Auto Evaluation & Tuning Pipeline）

> **任务单**：[phase2.5-wp-e-auto-evaluation-tuning.md](phase2.5-wp-e-auto-evaluation-tuning.md)
> **交付日期**：2026-11-09
> **状态**：✅ 已交付
> **红线**：engine-core 零改动（`git diff --stat HEAD -- src/engine-core` = 空）；心理数据不出境（评测全程离线计算，不调外部 LLM 做裁判）

---

## 一、本单做了什么（一句话）

在 `src/engine-adapters/eval/` 建了一条**可重复、可对比、可追溯**的评测流水线：
数据加载 → 四道清洗门槛 → 批量跑（离线读历史 / 全量重跑）→ 跟 ground truth 比 → 算指标
（触发质量 P/R/F1 + 建议质量六维方向 macro F1 / 幅度 MAE + 纯规则基线对比）→ 出结构化 JSON 报告 → 落 `eval_reports` 表，
并提供 `scripts/eval-runner.ts` CLI 一条命令跑完，**零基础设施依赖**（不起 MySQL / Redis / 不调模型）。

---

## 二、方案设计

### 2.1 文件结构（10 个后端文件 + 1 个 CLI + 1 条 migration + 3 个测试文件）

```
src/engine-adapters/eval/
  ├── eval.types.ts              ← 类型契约 (纯 TS, 零 @nestjs / 零 IO)
  ├── eval.dataset.ts            ← 数据层: 加载 (IO) + 清洗 (纯判定) + 督导案例解析
  ├── eval.ground-truth.ts       ← 真值层: A 方案 (规则差异) / B 方案 (督导标注)
  ├── eval.metrics.ts            ← 计算层: 纯函数指标 (零 IO / 零 env)
  ├── eval.runner.ts             ← 执行层: 批量跑, 只收集预测 (不算指标)
  ├── eval.report.ts             ← 报告层: 装配 + 对比 + 仓储端口 (纯函数部分零 IO)
  ├── eval.service.ts            ← 入口层: 串链路 + 兜异常 (+ Nest 服务类)
  ├── eval.module.ts             ← NestJS 模块 (实体注册 + 端口绑定)
  ├── eval-report.entity.ts      ← eval_reports 表实体 (TypeORM)
  └── eval-report.repository.ts  ← eval_reports 仓储实现 (TypeORM)

scripts/
  └── eval-runner.ts             ← CLI: 命令行触发评测 (不起 Nest 容器)

src/migration/1714900000036-CreateEvalReports.ts   ← 手写 DDL (ADR-0003)

test/engine-adapters/eval/
  ├── eval.metrics.spec.ts       ← 18 例 (指标口径 + 报告装配 + 版本对比)
  ├── eval.dataset.spec.ts       ← 14 例 (四条清洗门槛 + 异常检测 + 督导案例解析)
  └── eval.runner.spec.ts        ← 12 例 (离线 / 全量两条路径 + 链路端到端 + CLI 参数)

data/eval-datasets/
  ├── synthetic-supervisor-v1/dataset.json   ← 合成种子集 (B 方案口径, 含 4 类脏数据)
  └── synthetic-train-v1/dataset.json        ← 合成种子集 (A 方案口径)
```

### 2.2 四层分工（沿用 WP-C 的治本思路：判定只有一份）

| 层 | 文件 | 职责 | 红线 |
|---|---|---|---|
| **数据层** | `eval.dataset.ts` | 加载 + 清洗 | 清洗是**纯判定**；四条门槛只此一份 |
| **真值层** | `eval.ground-truth.ts` | "该不该跑" / "该调多少" | 不拿规则 delta 冒充人类真值 |
| **计算层** | `eval.metrics.ts` | 纯函数算指标 | **零 IO / 零 env** —— 报告数字必须可复现 |
| **执行层** | `eval.runner.ts` | 批量跑, 只收集预测 | 不算指标；重算走 WP-C 的 `evaluateGate` |
| **入口层** | `eval.service.ts` | 串链路 + 兜异常 + 落库 | 不抛；出错出一份 `status=failed` 的报告 |

**为什么这么切**：报告的数字要能**复现**（"跟上一版比"完全依赖这一点）。只要指标计算里混进一次
读时钟 / 读 env / 读 Redis，复现性就没了。所以计算层是纯函数，不起数据库就能单测。

### 2.3 指标体系（任务单 §4 逐条落地）

**触发质量**（闸门准不准）—— 真值 / 预测配对后算：

| 指标 | 实现 |
|---|---|
| Precision / Recall / F1 | `computeTriggerQuality()`，分母为 0 时返回 0（不产生 NaN） |
| TP / FP / FN / TN | 逐轮配对计数；报告里原样给出，便于人工复核 |

**建议质量**（审议输出对不对）—— 六维（trust / safety / bond / verbal / depth / style）：

| 指标 | 实现 |
|---|---|
| 方向准确率 | 每维按**三分类（涨/平/跌）算 macro F1**，六维再平均（`macroAverage`） |
| 幅度 MAE | 只统计**方向对**的那些轮次：`mean(|predicted - truth|)` |
| 每维明细 | `perDimension` 里给 accuracy / macroF1 / support / signalTurns / amplitudeMAE |

⚠️ **两道防"退化解"的护栏**（写在这里，因为它们改变了分数的含义）：
1. **macro F1 而不是命中率**：命中率在"几乎全是平稳轮"的会话上恒等于 1 —— 全押"平稳"的退化解能拿满分。
2. **只统计"有信号"的维度**：某一维如果整场都是平稳（真值恒 0），"全押平稳"就能在这一维拿满分；
   所以只有 `signalTurns > 0`（真值出现过非平稳）的维度才进 macro 平均与幅度 MAE，
   否则 `directionAccuracy[dim]` 为 `null` 而不是虚高的 1。

**基线对比**（回归保护）：同一条真值下，`纯规则 delta` vs `规则+审议 delta`，
输出 `baselineDirectionAccuracy → subjectDirectionAccuracy → directionAccuracyDelta`。
**基线跌 > 0.03 → 报告自动标红告警**（`detectBaselineRegression`），文案是"先修回归, 再谈调参"。

### 2.4 两套 ground truth（任务单 §4.1 的 A / B 方案）

| 方案 | 数据集 | "该不该跑"的真值 | "该调多少"的真值 |
|---|---|---|---|
| **A 规则差异** | 训练集（`split=train`） | 规则 delta 与参考审议 delta **方向不同或幅度差 > 0.05** | ❌ 无（不可算） |
| **B 督导标注** | 验收集（`split=validation`） | 督导标注 `expectedShouldRun` | 督导标注 `expectedDeltas` |

**红线落地**：A 方案下 `expectedDeltas` 恒为 null，报告里建议质量字段**保留但标 `available=false` 并写明原因**，
而不是给一组 0 分或拿规则 delta 冒充真值 —— 0 分会被读成"审议全错"，让人去调一个本来就没法调的参数。

### 2.5 数据清洗门槛（任务单 §5.1）

| 门槛 | 实现 | 丢弃原因码 |
|---|---|---|
| 轮次 < 5 | `minTurns` | `too_short` |
| 中途报错 / 空回复 / 超时 / 降级 | `hasError || degraded` | `has_error` |
| BDI 状态异常 | 越界 / 单轮跳变 ≥ 0.5 / 连续 3 轮全维度不变 | `bdi_anomaly` |
| 闸门 trace 缺失 | 全部轮次无 `gateDecision`（部分缺失只计数不丢场） | `missing_gate_trace` |

报告里单列 `dataQuality`：总场次 / 有效场次 / 丢弃场次 / 四类原因计数 / 闸门 trace 缺失轮次数。

### 2.6 两种模式（任务单 §6.1）

| 模式 | 预测来源 | 用途 |
|---|---|---|
| **离线** | 数据集里记录的闸门决策与审议输出 | 改了指标口径 / 清洗规则 / 报告格式时用它（零成本、秒级） |
| **全量重跑** | 用**当前闸门策略**重算每一轮决策（走 WP-C 的 `evaluateGate`，纯函数、确定性） | 改了阈值 / prompt / 引擎逻辑时用它 |

审议重跑（真调模型）做成了**窄端口** `EvalDeliberationExecutorPort`：装配了就重跑，没装配就只重算闸门，
并在报告 notes 里写明"未装配审议执行器"——**不静默假装重跑过了**。

### 2.7 方差与跨版本对比（任务单 §6.2 / §6.3）

- 离线确定性 → `runs.count=1`、`stdDev=0`；全量重跑默认 3 次。
- 触发质量的计数**跨运行 pooled**（rates 由 pooled 计数推出），`runs.mean / runs.stdDev` 表达单次波动。
- `diffEvalReports()` 给逐项差值；**变化量未超过标准差 → 判为噪声**，明确写"不算真的变了"。
- 上一版报告从 `eval_reports` 表取（`latest(datasetVersion)`），基线跌 > 0.03 自动标红。

### 2.8 数据集格式（自有 JSON 交换格式，零对话原文）

```json
{
  "version": "synthetic-supervisor-v1", "split": "validation", "synthetic": true,
  "sessions": [{
    "sessionId": "s1",
    "turns": [{
      "turnIndex": 1,
      "before": { "trust": 0.5, "safety": 0.5, "...": "11 维紧凑状态" },
      "after":  { "trust": 0.52, "...": "11 维紧凑状态" },
      "events": ["empathy"], "riskLevel": "low",
      "ruleDelta": { "trust": 0.02 }, "llmDelta": { "trust": 0.03 },
      "gateDecision": "run", "gateReason": "alliance_delta_high",
      "expectedShouldRun": true, "expectedDeltas": { "trust": 0.02 }
    }]
  }]
}
```

⚠️ **不含任何对话原文**：只有数值化的状态 / 事件标签 / delta。督导案例的逐字稿由
`parseSupervisorCases()` 解析后**只落标注结果**，原文不进入评测数据集、报告与日志。

### 2.9 数据库

`eval_reports` 表（手写 DDL，ADR-0003，INFORMATION_SCHEMA 守卫幂等）：
`id / report_id / dataset_version / mode / config_json / metrics_json / data_quality_json / report_json / created_at`，
3 索引（report_id 唯一 + created_at + dataset_version）。
migration 已在 `bin/ormconfig.ts` 与 `src/migration/index.ts` **严格 1:1 登记**（漏登记 = "No migrations are pending" 静默不建表）。

### 2.10 CLI

```bash
npx tsx scripts/eval-runner.ts --mode offline                                  # 默认读合成种子集
npx tsx scripts/eval-runner.ts --mode offline --dataset synthetic-train-v1 --runs 3
npx tsx scripts/eval-runner.ts --mode full --dataset synthetic-supervisor-v1
npx tsx scripts/eval-runner.ts --mode offline --out report.json --print-json
```

CLI **不起 Nest 容器 / 不连数据库**：跑完写 JSON 报告文件 + 打印摘要；
落库由 Nest 侧的 `EvalService` 完成（同一个 `runEvaluationPipeline`）。

---

## 三、偏差说明（跟任务单不一样的地方 + 为什么）

| # | 任务单原方案 | 实际方案 | 为什么 |
|---|---|---|---|
| 1 | 8 个后端文件 | **10 个**（+ `eval-report.entity.ts` + `eval-report.repository.ts`） | `eval_reports` 表要落库，而 ORM 依赖不能混进纯文件（CLI 要零依赖跑）。沿用 `turn-delta-audit` 先例：实体 + 仓储独立成文件，模块里 `forFeature` 注册 |
| 2 | 建议质量在两种数据集上都算 | **A 方案下标记"不可算"**（字段保留 + `available=false` + 原因） | A 方案没有人类真值。拿规则 delta 冒充真值 = 评出来的"准确率"只是"审议与规则一致的比例"，会误导调参方向 |
| 3 | BDI 异常 = "突然跳到 100 或 0" | **越界 (<0 或 > 值域上界) / 单轮跳变 ≥ 0.5 / 连续 3 轮全维度不变** | 内核对信任类维度做了 clamp，**0 与 1 都是合法端点值**（完全无信任 / 完全信任）。把"等于 0/1"判成脏会误杀极端但真实的会话 —— 宁可少杀不可错杀；真正该抓的"突变"由"单轮跳变"兜住。判定边界加了 1e-9 浮点容差（否则 0.95-0.45 = 0.49999999999999994 会漏判） |
| 4 | 离线评测读"已有对练数据" | **文件型数据集（JSON 目录）** | 本机 Redis(6379) / MySQL(3306) 均未运行、`data/debug-sessions/` 为空 —— 按原方案离线评测**在本机跑不起来**。文件型数据集让 CLI 零依赖可跑，且**生产路径同格式**（读 Redis 审议 trace + 闸门 trace 后转成同一份 JSON 即可接入） |
| 5 | 方向准确率 = 六维各算 F1 取平均 | 每维**三分类 macro F1**；且只有"有信号"的维度计入平均 | 命中率在"几乎全是平稳轮"的数据集上恒等于 1（退化解满分）；"无信号维度"同理。两条护栏都写进了代码注释与单测 |
| 6 | 跑 3 次取均值 + 标准差 | 触发质量计数**跨运行 pooled**，单次波动由 `runs.mean/stdDev` 表达 | pooled 计数 = 真实总样本量；rates 由 pooled 计数推出，比"取某一次"更自洽 |
| 7 | 全量重跑 = 重新跑一遍对练 | 闸门判定用 **WP-C 的 `evaluateGate` 重算**（纯函数、确定性）；审议重跑做窄端口 | 评测里再写一份闸门判定 = 两份阈值逻辑迟早漂移，而"评测说闸门变了"可能只是评测自己变了。审议重跑要真调模型（花钱、几十秒），做成端口后"装配即重跑、不装配则明确留痕" |
| 8 | `eval_reports` 6 列 | **9 列**（+ `dataset_version` + `mode` + `report_json`） | 前两列用于"同数据集版本内取上一版"（回归对比）；`report_json` 存整份快照 —— 跨版本对比要的是"当时那一版"的完整事实（阈值 / 告警 / 数据集版本），只存汇总列复现不了当时的结论 |
| 9 | CLI 用 `npx ts-node` | **`npx tsx`**（仓库统一工具链） | 实测 `npx ts-node scripts/eval-runner.ts --mode offline` 在本仓跑不起来：仓库是 ESM（`type=module`）+ NodeNext，相对 import 必须带 `.js` 扩展名，而 ts-node 的 ESM loader 不做 `.js→.ts` 映射 → `ERR_MODULE_NOT_FOUND`（已试 CJS 模式 / `--esm` / `preferTsExts` 三种配置，均失败）。本仓所有脚本（`bin/seed-*.ts`、migration）本来就用 tsx，故统一走 tsx。脚本本身是纯 ESM + `.js` 扩展名，**两种 loader 写法完全兼容**，将来 ts-node 支持该映射即可直接用 |
| 10 | 报告示例里用中文键（`"被测对象DirectionAccuracy"`） | 英文键（`subjectDirectionAccuracy` 等） | 机器读字段不用中文键；字段语义与任务单 §4.4 一一对应（中文名保留在本文件 §2.3 表格里） |
| 11 | 督导案例验收集 | **合成种子集 + 督导案例解析器**（`parseSupervisorCases()`） | 任务单 §5.3 提到的一万份个案逐字稿 + 督导解析**不在仓库内**，无法产出真实验收集。种子集明确标注 `synthetic: true`，报告对合成数据**强制告警**"指标只验证链路可用, 不能作为验收结论"；真实验收集留外部接入口（解析器已按任务单 §5.3 的格式实现，解析时丢弃逐字稿） |
| 12 | —— | **未新增任何 env 键** | 闸门阈值全部取自 WP-C 配置层常量（`DEFAULT_GATE_*_THRESHOLD_EFFECT` 等）或请求参数，避免触碰 WP25 的 env 双向守卫（`test/config/wp25-env-example-coverage.spec.ts`） |

---

## 四、测试闸门（数字）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 错** |
| Lint | `npx eslint src/engine-adapters/eval/ test/engine-adapters/eval/` | ✅ **0 error / 0 warning** |
| 单测 | `npx vitest run test/engine-adapters/eval/` | ✅ **3 文件 / 44 例全绿** |
| 全量回归 | `npx vitest run --exclude "**/e2e/**/*.ts"` | ✅ **146 文件（145 通过 / 1 跳过）/ 2475 例（2471 通过 / 4 跳过）/ 0 失败** |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ **空** |
| CLI | `npx tsx scripts/eval-runner.ts --mode offline` | ✅ **出报告**（见下方实测输出） |
| 报告字段完整 | 任务单 §4.4 全字段 | ✅ 齐（`reportId / createdAt / config / dataQuality / triggerQuality / suggestionQuality / baselineComparison / runs / cost / durationSec / warnings / sampleIds / status`） |
| 数据清洗生效 | 同上 | ✅ 总 8 / 有效 4 / 丢弃 4（四类原因各 1） |

**CLI 实测输出（合成种子集，B 方案）**：

```
报告已写入: data/eval-reports/eval-20261109-140439-bbfc9e15.json
  触发质量: P=0.615 R=0.667 F1=0.640 (TP=8 FP=5 FN=4 TN=15)
  建议质量: macro F1=0.833 幅度 MAE=0.006 (对比轮次 9)
  基线对比: 0.762 → 0.833 (+0.071)
  数据质量: 总 8 / 有效 4 / 丢弃 4 (tooShort=1 errors=1 bdiAnomaly=1 noTrace=1)
  运行 1 次 (F1 标准差 0.0000) / 耗时 0.00s / token 10243
  ⚠ 数据集为合成数据: 指标只验证链路可用, 不能作为验收结论
```

**A 方案（训练集）实测**：触发质量照常可算（F1=0.478），建议质量正确标记为不可算并写明原因
——"不用规则 delta 冒充真值"这条红线在真实链路上生效。

### 4.1 单测覆盖要点

- `eval.metrics.spec.ts`（18 例）：P/R/F1 分子分母、空输入不出 NaN、方向 macro F1 的三分类口径、幅度 MAE 只算方向对的轮次、
  无信号维度不进平均、基线对比差值、多轮均值 / 标准差、报告字段齐全、合成数据告警、建议质量不可算告警、基线回归标红、跨版本差值。
- `eval.dataset.spec.ts`（14 例）：四条门槛各一例 + 门槛互不串台、连续不变判卡死、越界判脏、降级算脏、
  督导案例解析（逐字稿不进数据集）、紧凑状态还原成内核快照（维度齐全）、数据集读写。
- `eval.runner.spec.ts`（12 例）：离线按记录收集、A 方案规则差异真值、方向不一致判"该跑"、全量重跑确实重算（`source=resimulated`）、
  审议执行器接入 / 未接入留痕、链路端到端（脏数据被挡）、多轮标准差、CLI 参数解析。

---

## 五、交付物清单

### 5.1 新增（后端 10 + 脚本 1 + migration 1 + 测试 3 + 数据集 2）

| 文件 | 说明 |
|---|---|
| `src/engine-adapters/eval/eval.types.ts` | 类型契约（数据集 / 指标 / 报告） |
| `src/engine-adapters/eval/eval.dataset.ts` | 数据层：加载 + 四道清洗门槛 + 督导案例解析 |
| `src/engine-adapters/eval/eval.ground-truth.ts` | 真值层：A / B 两套提供者 |
| `src/engine-adapters/eval/eval.metrics.ts` | 计算层：纯函数指标 |
| `src/engine-adapters/eval/eval.runner.ts` | 执行层：离线 / 全量两条路径 + 审议重跑窄端口 |
| `src/engine-adapters/eval/eval.report.ts` | 报告层：装配 + 跨版本对比 + 仓储端口 + 内存实现 |
| `src/engine-adapters/eval/eval.service.ts` | 入口层：串链路 + 兜异常 + Nest 服务类 |
| `src/engine-adapters/eval/eval.module.ts` | Nest 模块 |
| `src/engine-adapters/eval/eval-report.entity.ts` | `eval_reports` 实体 |
| `src/engine-adapters/eval/eval-report.repository.ts` | `eval_reports` 仓储（TypeORM） |
| `scripts/eval-runner.ts` | CLI |
| `src/migration/1714900000036-CreateEvalReports.ts` | 手写 DDL |
| `test/engine-adapters/eval/eval.metrics.spec.ts` | 18 例 |
| `test/engine-adapters/eval/eval.dataset.spec.ts` | 14 例 |
| `test/engine-adapters/eval/eval.runner.spec.ts` | 12 例 |
| `data/eval-datasets/synthetic-supervisor-v1/dataset.json` | 合成种子集（B 方案口径 + 4 类脏数据） |
| `data/eval-datasets/synthetic-train-v1/dataset.json` | 合成种子集（A 方案口径） |

### 5.2 改动

| 文件 | 改动 |
|---|---|
| `bin/ormconfig.ts` | 登记 `CreateEvalReports1714900000036`（import + migrations 数组） |
| `src/migration/index.ts` | 同名导出（与 ormconfig 严格 1:1） |
| `.gitignore` | 新增 `data/eval-datasets/*`（只放行 `synthetic-*`）与 `data/eval-reports/` |

### 5.3 未改动（红线确认）

- `src/engine-core/**`：**零改动**（`git diff --stat HEAD -- src/engine-core` = 空）。
- `src/engine-adapters/deliberation-gate/**`、`src/engine-adapters/deliberation/**`：**只读引用**（复用 `evaluateGate` 与阈值常量，判定只有一份）。
- 既有业务模块 / 前端 / Flutter 客户端：未触碰（工作树里 `admin-dashboard/**`、`src/auto-practice/practice-queue.service.ts` 的改动是另一个 AI 的，不是本单产物）。
- **未新增 env 键**、未改 `.env.example`、未改 `typings/global.d.ts`（WP25 env 双向守卫不受影响）。

---

## 六、已知限制（本机环境导致，写明以免误判）

1. **本机 Redis(6379) / MySQL(3306) 均未运行**：`eval_reports` 落库路径（`TypeOrmEvalReportRepository`）与
   "全量重跑 + 真调模型"的审议重跑路径**未能端到端验证**。已做的替代验证：
   仓储走端口抽象 + 内存实现（CLI 用）；审议重跑走窄端口 + 单测假端口覆盖。
   大炮在有库环境跑 `pnpm migration:run` 后，`EvalService` 的落库链路即可用（模块已装配、entity 已 `forFeature` 注册）。
2. **真实验收集不在仓库内**：任务单 §5.3 提到的一万份个案逐字稿 + 督导解析无法产出，
   本单交付的是**合成种子集 + 督导案例解析器**。出口条件④"准确率 ≥ 80%"需要真实督导语料才能最终判定。
3. **合成数据上的指标不代表真实质量**：报告对 `synthetic: true` 的数据集强制告警，
   且建议质量与基线对比只在有督导真值时才给数（A 方案下直接标不可算）。

---

## 七、回写清单

| 文档 | 改动 |
|---|---|
| `docs/worklog/completed/phase2.5/phase2.5-wp-e-auto-evaluation-tuning.md` | 任务单从 `pending/` 迁到 `completed/phase2.5/`，状态行改为 ✅ 已交付 + 指向本交付记录 |
| `docs/worklog/pending/phase2.5-README.md` | WP 清单里 WP-E → ✅ 已完成（+ 交付记录链接）；"当前有什么活"改为 Phase2.5 五个 WP 全部交付、下一阶段待派 |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` | WP 登记表里 WP-E → ✅ 已交付（+ 交付记录链接）；出口条件④补上"评测流水线已就绪，待真实督导语料跑最终验收" |
| `.gitignore` | 评测数据集 / 报告的版本库边界（真实数据与报告不出境） |

---

## 八、后续（本单不做，任务单 §十 同款）

- **手动调参**：跑第一轮真实评测后，看哪个维度差，手动改 env 阈值（WP-C 的 12 个键）再跑一轮。
- **真实督导语料接入**：把外部逐字稿 + 督导解析喂给 `parseSupervisorCases()` 造 B 方案验收集 —— **调参阶段不许看，调完才跑一次**。
- **CI 集成**：流水线已经是"一条命令出报告"，接 CI 只差一个 shell 步骤。
- **人工抽检**：每轮都有唯一样本 id（`会话#轮次`），导出即可。

---

_本单交付的是"测量仪器"。仪器能不能量出 ≥80%，取决于有没有一把可靠的尺子（真实督导语料）—— 那是下一步的事。_
