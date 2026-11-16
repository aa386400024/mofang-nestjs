# WP-K · 批次回归追踪设施（企业级 · 工程规格）

> 状态：✅ 已完成（2026-11-11），交付记录：`docs/worklog/completed/phase2.5/wp-k-batch-regression-tracking-implementation-2026-11-11.md`
> 执行方：自做
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`
> 任务性质：新功能（**可观测性基础设施**）· 必须先于 WP-L 完成

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → 2. `docs/README.md` → 3. `docs/team/conventions.md`（**§1.1 分层 + 16 条硬约束**）
2. `docs/worklog/pending/phase2.5-README.md` + `phase2.5-wp-list-2026-11-08.md`
3. **必须精读的三份现有实现**（本单要在它们的延长线上做，不是另起炉灶）：
   - `src/auto-practice/prompt-fingerprint.ts` —— **指纹算法的既有契约**（16 位 hex / 路径入哈希 / fail-closed 返回 `unknown` / 显式文件清单）
   - `src/auto-practice/inference-fingerprint.service.ts` —— 环境指纹的字段划分与落库时机
   - `src/auto-practice/practice-batch-health.service.ts` —— 批次聚合的既有范式（纯函数 + 读时算 + 失败只 warn）
4. 本任务单

---

## 1. 背景

### 1.1 问题

调参 → 跑几十场 → 看效果 → 再调 → 再跑。这个循环现在**没有留痕**：

- 批次表只有「管道健康」（token / 兜底率 / 计数一致性），**零个行为指标**；
- 八维演化、事件分布、策略分布全部是**临时脚本现算，算完就丢**；
- 批次之间不可比 → 「这次改得更好还是更差」只能靠记忆。

### 1.2 已核对现状（别当新问题）

| 事实                                                                                          | 位置                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 批次表 13 列，全为管道指标                                                                    | `entities/practice-batch.entity.ts`                          |
| 只有单批端点 `GET batches/:id`，无列表/无对比                                                 | `auto-practice.controller.ts:212`                            |
| 端点已有 class 级鉴权 `@UseGuards(AdminRoleGuard)`                                            | 同文件 `:60-61`（新端点自动继承）                            |
| 已有 `prompt_version`（16 位，文件级 sha256）与 `engine_version`（`git describe --dirty`）    | `prompt-fingerprint.ts` / `inference-fingerprint.service.ts` |
| 已有 `inference_fingerprint`（模型名/角色 semver/审议模式/场景/种子） 逐场落库                | 同上                                                         |
| 八维快照**只存在于逐字稿** `traces[].bdiSnapshot`；`ap_practice_turns` 只有来访者语义，无 BDI | `data/debug-sessions/*.json`                                 |
| 逐字稿会被 `MAX_DEBUG_SESSIONS=500` 淘汰（500 场 baseline 是抢救出来的）                      | `phase2.5-README.md` §3.1                                    |
| migration 命名 `17149000000NN-AddXxx.ts`，最新 `…044-CreatePracticeTurns.ts`                  | `src/migration/`                                             |

### 1.3 已有历史批次（本单做完要立即产出对照基线）

| 归档目录                                          | 场次 | 用途                                                     |
| ------------------------------------------------- | ---- | -------------------------------------------------------- |
| `debug-sessions-baseline-20261109`                | 500  | 已知无效（89.8% `total_tokens=0`）→ **验证门禁能否拦住** |
| `debug-sessions-verify-route1-2026-11-10`         | 32   |                                                          |
| `debug-sessions-verify-route1-p1d-2026-11-10`     | 16   | WP-L 的**改前基线**                                      |
| `debug-sessions-verify-p1d-2026-11-10`            | 6    |                                                          |
| `debug-sessions-verify-prompt-version-2026-11-10` | 1    |                                                          |

---

## 2. 设计原则（本单的"为什么这么设计"，先看这段再动代码）

1. **单一真相源**：指标定义只能存在一处（指标字典），报告、API、测试三方都从它取。禁止在三个地方各写一遍口径。
2. **契约先行**：指标字典 + 快照 schema（含版本号）+ API 契约，先定再写实现。
3. **fail-closed**：算不出来宁可标 `unknown` / `incomparable`，**绝不产出"看起来正常的半截值"**。与 `prompt-fingerprint` 同款。
4. **确定性**：同一输入两次计算，输出逐字节相同（浮点统一 6 位、键序固定、禁时间/随机）。
5. **可归因**：指纹**分段**，能回答「变的是 deltas 还是 thresholds」，而不是只回答「变了」。
6. **可执行**：验收判据**代码化 + 容差表**，CLI 返回语义化退出码 → 能进 CI，不靠人眼判断。
7. **合规隔离**：聚合函数的**入参类型里根本没有 `messages` 字段**。不是"记得别用文本"，是"拿不到文本"。

---

## 3. 范围

**在范围内：**

1. 指标字典（含口径、单位、方向、边界、空值语义）
2. 分段配置指纹（复用现有指纹契约）
3. 快照 schema v1（含版本与演进策略）
4. 指标计算服务 + 覆盖率/血缘
5. migration（双登记）+ 4 个可排序标量列 + 索引
6. 批次收尾自动写入
7. 回归判定器（纯函数，四态）
8. CLI（参数 + 退出码语义）
9. 3 个端点
10. API 契约文档
11. 测试（含黄金样本 + 确定性 + 兼容）

**明确不在范围内：**

- 不改 `admin-dashboard/`（契约给别人）
- 不改 `DELTA_TABLE` / 门槛 / 基线 / 词表（那是 WP-L）
- 不改 `boundary.spec.ts`
- 不引入新依赖（除非仓库里已存在；如需校验库，优先手写守卫）
- 不碰 Flutter
- 不自动 commit / push

---

## 4. 交付物

### D1 · 指标字典（单一真相源）

`src/auto-practice/metrics/metric-dictionary.ts`（纯常量 + 纯类型，零 IO）

```ts
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
export interface MetricDef {
  readonly id: string; // 稳定 id，API 与报告都用它，永不复用
  readonly label: string; // 展示名
  readonly unit: 'ratio' | 'delta' | 'count' | 'per_turn';
  readonly aggregation: 'mean' | 'sum' | 'rate';
  readonly direction: MetricDirection;
  readonly bounds: { readonly min: number; readonly max: number } | null;
  readonly nullable: boolean; // true = 允许 null（数据缺失），false = 缺失即整批 unknown
  readonly definition: string; // 一句话口径，写清分子/分母
}
export const METRIC_DICTIONARY: readonly MetricDef[];
```

**必须收录的指标（不得少于这些）：**

| id                                                                    | 口径                                         |
| --------------------------------------------------------------------- | -------------------------------------------- |
| `dim.trust.first_avg` / `.last_avg` / `.delta_avg` / `.per_turn_rate` | 八维 × 4（=32 项）                           |
| `dim.<x>.p10` / `.p90`                                                | 八维末值的**分布**（均值掩盖极端场，必须有） |
| `event.<type>.count` / `.rate`                                        | 10 种事件 × 2                                |
| `strategy.<name>.count` / `.rate`                                     | 策略分布                                     |
| `exploration.rate`                                                    | 场次中出现 `affective_exploration` 的场占比  |
| `event.positive.rate`                                                 | 正事件轮数 / 总轮数                          |
| `session.outcome.<completed\|crisis_ended\|stagnant\|failed>`         | 计数                                         |
| **`session.zero_motion`**                                             | **八维全零的场次数**（I-10 的长期监控指标）  |
| `pipeline.llm_call_ratio` / `pipeline.fallback_ratio`                 | 复用现有口径                                 |

### D2 · 分段配置指纹

`src/auto-practice/config-fingerprint.ts`

> **设计修正（2026-11-11 核实代码后）**：原方案设想数值段用 canonical JSON 序列化。
> 读代码发现系数本体在**私有** `DELTA_TABLE`（`state-transition.ts:197`，未 `export`），
> 公开的 `DEFAULT_DELTA_TABLE_CONFIG` 只是**空覆写**（`deltas: {}`）。
> 要拿到数值必须改内核加导出；而**文件级哈希零内核改动**，且与现有 `prompt-fingerprint` 完全同构。
> 故改为**全部文件级哈希**——一致性（consistency）比理论上的优雅更重要，
> Git / Docker layer / 构建可复现性用的都是内容哈希。

```ts
export interface ConfigFingerprintSegments {
  // 按**真实文件边界**分段（一个文件一段，不假装能细分同文件内的两个常量）
  readonly stateTransition: string; // state-transition.ts：DELTA_TABLE + CAP + 算子
  readonly alliance: string; // alliance-config.ts：门槛 + 覆写
  readonly deltaTableConfig: string; // delta-table-config.ts：端口类型 + 默认空覆写
  readonly lexicon: string; // event-lexicon.ts：词表
  readonly baselines: string; // character-baseline-calibration.ts：基线 + verbalVoice
  readonly prompts: string; // 直接复用 computePromptVersion()
  readonly acceptance: string; // 判据常量（见 D6）
  readonly combined: string; // 以上 7 段再哈希
}
export function computeConfigFingerprint(): ConfigFingerprintSegments;
export function compareFingerprints(a, b): { changed: readonly string[] };
```

**算法契约（与 `prompt-fingerprint.ts` 对齐）：**

- 每段 16 位 hex（复用 `PROMPT_VERSION_LENGTH`，并在注释引用其取值理由）
- **路径 + 内容**一起入哈希（防两个文件内容互换算出同值），与 `hashPromptTemplates` 同款
- 路径解析复用 `resolveTemplatePaths` 机制：`import.meta.url` 推扩展名，
  src 态读 `.ts`、dist 态读 `.js`（**跨口径不可比，统一用 dist**，与现有机制一致）
- **已知取舍（诚实写进注释，不假装没有）**：同文件内的**非配置**改动（加注释/改日志）也会改变该段。
  这是**保守方向**——宁可多报"变了"，不可漏报"没变"。
  注意 `stateTransition` 段无法细分"变的是 deltas 还是 cap"，因为它们在同一文件；
  看 `git diff` 即可定位改了哪行，不为此改内核拆文件。
- **fail-closed**：任一段文件读不到 → 该段 `'unknown'`，`combined` 也 `'unknown'`。
  **不允许**用"跳过该段的半截哈希"（半个指纹比没有更坏，它看起来像个正常值）。
- `compareFingerprints` 返回**变了哪几段**，供 API 与报告直接展示

### D3 · 快照 Schema v1

`src/auto-practice/metrics/batch-metrics.schema.ts`

```ts
export const BATCH_METRICS_SCHEMA_VERSION = 1;

export interface BatchMetricsV1 {
  readonly schemaVersion: 1;
  readonly computedAt: string; // ISO
  readonly batchId: string;
  readonly fingerprint: ConfigFingerprintSegments;
  readonly coverage: {
    readonly expectedSessions: number;
    readonly includedSessions: number;
    readonly skippedSessions: number;
    readonly skipReasons: Readonly<Record<string, number>>; // 枚举键
    readonly totalTurns: number;
    readonly transcriptRoot: string; // 来源目录（相对仓库根）
  };
  readonly lineage: readonly {
    // 血缘：每场一行
    readonly debugSessionId: string;
    readonly characterSlug: string;
    readonly counselorModeId: string;
    readonly turns: number;
    readonly fileSha256: string; // 前 16 位
  }[];
  readonly metrics: Readonly<Record<string, number | null>>; // 键 = 指标字典 id
  readonly byMode: Readonly<Record<string, MetricsSlice>>;
  readonly byCharacter: Readonly<Record<string, MetricsSlice>>;
}
```

- **演进策略**（写进注释）：`schemaVersion` 只增不改；读端按版本分派解析器；
  `v1` 之前的批次（`metrics_json` 为 NULL）标 `legacy: true`，**不回溯重算、不覆盖写**。
- 校验函数 `assertBatchMetricsV1(x): asserts x is BatchMetricsV1`（手写守卫，逐个字段；不做"宽松通过"）。

### D4 · 指标计算服务

`src/auto-practice/metrics/batch-metrics.service.ts`（Nest provider）

**已核实的逐字稿字段（2026-11-11 实测，勿凭印象写）**：

`traces[]` 实有键：
`turnIndex / characterSlug / bdiSnapshot / delta / deltaDetail / intention / eventTags / eventTagLabels / renderSpec / llmUsage / crisis / degraded / deliberationTrace / ts`

| 用途         | 字段                     | 实测形态                                                                                                                                                                |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 八维状态     | `bdiSnapshot`            | `trust/safety/bond/valence/arousal/resistance/ resistanceVerbal/resistanceDepth/resistanceStyle/anxiousSecure`；`resistance` 是**标量**（不是对象），值等于阻抗三维聚合 |
| **本轮增量** | **`delta`**              | 11 维：`trust/safety/bond/valence/arousal/verbal/depth/style/positive/negative/dependency`。**直接读它，不要用快照差分**                                                |
| 逐事件归因   | `deltaDetail`            | 8 维 + `events[]`（本轮参与的事件）                                                                                                                                     |
| 策略         | **`intention.strategy`** | 如 `recounting`；同层还有 `emotion / resistance / transference / forbiddenBehaviors / rationale`（**`rationale` 是中文句子，禁止进聚合**）                              |
| 事件标签     | `eventTags`              | 字符串数组                                                                                                                                                              |
| 降级         | `degraded`               | bool                                                                                                                                                                    |

**输入类型（合规隔离，关键）**：

```ts
interface TraceInput {
  readonly turnIndex: number;
  readonly bdiSnapshot: {
    trust: number;
    safety: number;
    bond: number;
    valence: number;
    arousal: number;
    resistanceDepth: number;
    resistanceVerbal: number;
    resistanceStyle: number;
  };
  readonly delta: { trust; safety; bond; valence; arousal; verbal; depth; style; positive; negative; dependency };
  readonly eventTags: readonly string[];
  readonly strategy: string; // 取自 intention.strategy
  readonly degraded: boolean;
}
```

**入参里没有 `messages`、没有 `renderSpec`、没有 `intention.rationale`** —— 计算层物理上接触不到任何对话文本与 prompt。

行为：

- 逐场处理、逐场释放（不把 500 场原文全 hold 在内存）
- 缺失场次进 `coverage.skippedSessions` + `skipReasons`（枚举：`file_missing` / `json_invalid` / `no_traces` / `no_snapshot`）
- **不因单场失败整批失败**；成功率 < 0.9 时 `coverage` 标 `degraded: true`
- **浮点统一 `round6`**。这不是洁癖，是实测必需：`bdiSnapshot.resistance` 实有末值 `0.2500000000000001`
  （`0.55` 经 3 次浮点减法后的残值）。不 round 会导致 JSON 不可 diff、指纹不稳定、跨机器复算不一致。

### D5 · 持久化

**migration**：`src/migration/1714900000045-AddBatchMetricsColumns.ts`
**双登记**：`src/migration/index.ts` + `bin/ormconfig.ts`（漏一个静默不建表）

`ap_practice_batches` 加列：

| 列                        | 类型                    | 说明                              |
| ------------------------- | ----------------------- | --------------------------------- |
| `config_fingerprint`      | `varchar(64)` nullable  | `combined` 段，便于列表页快速比对 |
| `config_fingerprint_json` | `text` nullable         | 7 段明细（JSON），便于归因        |
| `metrics_json`            | `text` nullable         | 完整快照 v1                       |
| `note`                    | `varchar(255)` nullable | 人写的一句话变更说明              |
| `exploration_rate`        | `decimal(5,4)` nullable | **可排序标量**                    |
| `depth_delta_avg`         | `decimal(7,6)` nullable | 同上                              |
| `safety_delta_avg`        | `decimal(7,6)` nullable | 同上                              |
| `positive_event_rate`     | `decimal(5,4)` nullable | 同上                              |

**为什么要冗余标量列**（大厂做法，写进注释）：列表页要按 `exploration_rate` 排序、按 `depth_delta_avg` 过滤，
不能让每次请求都解析 JSON。JSON 保真、列加速，两者职责不同。
索引：`INDEX(config_fingerprint)`、`INDEX(exploration_rate)`。

**写入时机（P0 约束）**：批次收尾（`computeBatchMetrics` 之后、逐字稿还在时）**立即写**。
离线脚本只做历史回填 —— 因为 `MAX_DEBUG_SESSIONS=500` 会淘汰逐字稿，**晚算就等于永久丢失**。
写入失败只 `warn`，不得让批次收尾挂掉（对齐 `practice-batch-health.service.ts` 的既有范式）。

### D6 · 回归判定器（纯函数）+ 判据代码化

`src/auto-practice/metrics/acceptance-thresholds.ts` —— 判据**代码化**（不写在 md 里靠人眼看）

```ts
export interface MetricExpectation {
  readonly metricId: string;
  readonly kind: 'range' | 'max_delta' | 'min_value' | 'must_be_zero';
  readonly min?: number;
  readonly max?: number;
  readonly tol: number;
  readonly rationale: string; // 一句临床/工程依据
}
export const INTAKE_EXPECTATIONS_V1: readonly MetricExpectation[]; // 12 轮档
```

初值（`WP-L` 落地后据此判 PASS/FAIL）：

| 指标                    | kind         | 范围             | 依据                        |
| ----------------------- | ------------ | ---------------- | --------------------------- |
| `dim.trust.delta_avg`   | range        | 0.05 ~ 0.20      | 首次会谈信任温和上升        |
| `dim.safety.delta_avg`  | range        | 0.02 ~ 0.06      | 试探性安全                  |
| `dim.bond.delta_avg`    | range        | −0.03 ~ +0.03    | 纽带 3–5 次才成形           |
| `dim.depth.delta_avg`   | max_delta    | ≤ 0.10（绝对值） | 防御是保护性的              |
| `dim.style.delta_avg`   | max_delta    | ≤ 0.05           | 人格级防御稳定              |
| `dim.verbal.delta_avg`  | max_delta    | ≤ 0.15           | 愿说一点，不是倾倒          |
| `dim.arousal.delta_avg` | range        | −0.05 ~ +∞       | 结束时仍高于基线            |
| `session.zero_motion`   | must_be_zero | 0                | 冷漠被静默成中性 = 检测失效 |
| `exploration.rate`      | —            | **不验**         | 属 40 轮档                  |

`src/auto-practice/metrics/regression-evaluator.ts`

```ts
export type Verdict = 'improved' | 'neutral' | 'regressed' | 'incomparable';
export function evaluateRegression(args: { base: BatchMetricsV1; candidate: BatchMetricsV1 }): {
  readonly verdict: Verdict;
  readonly items: RegressionItem[];
  readonly reasons: string[];
};
```

**四态的语义（这是非玩具的关键）：**

- `improved` / `regressed`：按 `MetricExpectation.direction` 与 `tol` 判定，**只有超出 tol 才改判**
- `neutral`：全在 tol 内
- **`incomparable`**：以下任一成立时**必须**给这个态，而不是硬比
  1. 两批 `fingerprint.acceptance` 不同（判据变了 → 跨批判 PASS/FAIL 无意义）
  2. 任一批 `coverage.degraded` 或 `includedSessions / expectedSessions < 0.9`
  3. 两批的 `counselorModeIds` 集合不同（比的是不同东西）
  4. 任一批 `combined === 'unknown'`

**这条是整个设计的地基**：没有 `incomparable`，工具会给出"自信的错结论"。
我们已经在 WP-L 里见过一次这个陷阱（改 depth 后探索率必然下降，用旧判据看会误判成"改坏了"）。

### D7 · CLI（工程化，不是"跑一次就丢"）

`bin/batch-report.ts`

```
--batch <id>            可重复；与 --all 互斥
--all                   全部批次
--since <YYYY-MM-DD>    按创建时间过滤
--out <dir>             缺省 data/batch-reports
--baseline <id>         指定对比基准（缺省 = 时间上前一批）
--fail-on-regression    出现 regressed 时退出码 1
--strict                数据覆盖率 < 0.9 即退出码 2
--format json|md|both   缺省 both（**HTML 不再是主产物**）
```

**退出码语义（写进 `--help`）**：`0` 全部 OK ｜ `1` 检出回归 ｜ `2` 数据不可用/覆盖不足 ｜ `3` 参数错误。

输出：

- `data/batch-reports/<batchId>.json`（快照 v1 原文，可 diff、可入 git）
- `data/batch-reports/<batchId>.md`（人读摘要：指标表 + 与基准对比 + fingerprint 变化段）
- `data/batch-reports/index.md`（批次时间轴 + 每批一行关键指标）

**不生成静态 HTML 作为主路径**：机器可消费的 JSON + 可 diff 的 MD 才是基线；
想看图形界面走前端页（D9 契约）。

### D8 · 三个端点

| 端点                                                                 | 说明                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/api/auto-practice/batches`                               | 分页（`?page&pageSize`）、排序（`?sort=exploration_rate&order=desc`）、过滤（`?valid=&since=&fingerprint=`）；返回轻量行（含 4 个标量列 + `note`），**不返回 `metrics_json`** |
| `GET /admin/api/auto-practice/batches/:id/metrics`                   | 完整快照 v1 + `legacy` 标记                                                                                                                                                   |
| `GET /admin/api/auto-practice/batches/compare?base=x&candidates=y,z` | 每批摘要 + `fingerprintDiff`（变了哪几段）+ `verdict` + `items`                                                                                                               |

统一响应包：`{ data, meta: { generatedAt, schemaVersion, total }, warnings }`

- `ids` 上限 10；非法 id 进 `warnings`，**不整单报错**（对齐现有 `batches/:id` 的容错范式）
- `legacy` 批次（`metrics_json` NULL）返回 `202`-like 语义：`data.metrics = null` + `warnings: ['METRICS_NOT_COLLECTED']`

### D9 · API 契约文档

`docs/team/batch-regression-api-contract.md`：端点、字段、可空性、单位、四态语义、
以及「批次回归页」的前端要求（时间轴折线 + 差分表 + 指纹变化提示 + `incomparable` 显式横幅）。
**只写契约，不写前端代码。**

### D10 · 测试（必须有这五类）

| 类别              | 要求                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字典自洽          | 所有 id 唯一、`nullable: false` 的指标在计算层必被赋值；`bounds` 与实际值域一致                                                                                                          |
| 指纹              | ① 同值两次相同；② 改某文件 → 对应段变、其余段不变；③ 改文件内容（含注释）→ 该段**必变**（文件级哈希的保守方向，已知取舍，不做"注释不变"的承诺）；④ 任一段失败 → `combined === 'unknown'` |
| 计算正确性        | 手工构造 traces（neutral / empathy / 空标签 / 单场缺失）→ 断言八维、事件率、`zero_motion`、`coverage.skippedSessions`                                                                    |
| **黄金样本**      | `test/fixtures/batch-metrics/` 放 2–3 场 traces 摘录 → 断言完整快照逐字段相等（回归护栏）                                                                                                |
| **兼容 + 确定性** | `schemaVersion` 缺失 → 解析为 legacy 不抛错；同输入跑两次 → 深比较相等                                                                                                                   |

---

## 5. 红线

- **分层**：纯计算（字典 / 指纹数值段 / 判定器）不进 IO，能放内核就放内核；但本单的指纹要 import 内核常量 + 读文件，放 `src/auto-practice/` 是合理的。`engine-core/` 内**禁止** NestJS / DB / 文件 IO / `process.env`。
- **合规**：聚合入参类型里不得出现 `messages` / `text` / `promptFull`；`metrics_json` 与 `lineage` 只含 id、计数、数值、哈希。**有测试断言快照 JSON 的最大字符串长度 ≤ 64**（挡住台词泄漏）。
- migration 双登记。
- 老批次不回溯覆盖写（`legacy` 只读）。
- 写库失败只 warn，不阻断批次收尾。
- 不自动 commit / push。

---

## 6. 闸门

| 闸门           | 命令                                            | 要求                                          |
| -------------- | ----------------------------------------------- | --------------------------------------------- |
| 类型           | `npx tsc -p tsconfig.build.json --noEmit`       | 0 error                                       |
| Lint           | `npx eslint "src/**/*.ts" "test/**/*.ts" --fix` | 0 error + 记 warning 数                       |
| 测试           | `npx vitest run test/auto-practice`             | 全绿 + 记用例数                               |
| engine-core    | `git diff --stat HEAD -- src/engine-core`       | 空                                            |
| **真实回填**   | `npx tsx bin/batch-report.ts --all`             | 5 个归档批次各出 JSON+MD；`index.md` 有时间轴 |
| **确定性**     | 同命令跑两次，比 `md5`                          | 两份 JSON 一致（除 `computedAt`）             |
| **指纹可解释** | 临时改一个 delta 值（改完还原）                 | `compareFingerprints` 只报 `deltas` 段变      |
| **四态**       | 用 baseline-20261109（无效批）对比任意有效批    | verdict = `incomparable`，reasons 含覆盖率    |
| **迁移**       | `npx typeorm migration:run`（真库）             | 8 列建成；老行全 NULL 不报错                  |

---

## 7. 交付记录

`docs/worklog/completed/phase2.5/wp-k-batch-regression-tracking-implementation-YYYY-MM-DD.md`

必须含：

1. 一句话总结
2. 实际实现 vs 本规格（偏差写清原方案/实际/为什么）
3. 改动文件清单（新建 / 修改，逐个一句用途）
4. 闸门表（命令 / exit code / 真实数字）
5. **5 个历史批次的指标摘要**（含 baseline 那批被判 `incomparable` 的证据 —— 这条直接证明门禁有效）
6. 指纹实验（只写哈希片段与"哪段变了"）
7. 四态语义自测记录
8. 风险与回归；确认未碰 `engine-core` / 前端
9. 遗留项

---

## 8. 【交付回写清单】

- [ ] 交付记录写到 §7 路径
- [ ] 任务单移入 `completed/phase2.5/`，状态 `✅` + 链交付记录
- [ ] 回写 `phase2.5-wp-list-2026-11-08.md`（本单行）
- [ ] 回写 `phase2.5-README.md` §3
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] commit message 草稿（**不提交**）

---

## 9. 回复输出约定

1. 「已写入交付记录」+ 路径
2. 闸门真实数字
3. **四态演示**：挑一组「有效批 vs 无效批」，说明为什么给 `incomparable`
4. 5 批关键指标表（只数值）
5. 不贴 diff 全文、不贴台词
