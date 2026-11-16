# Phase3 文字层真人度 · P0 度量层（不流利分类纯函数 + 字典 v2 + 快照数值投影）

> 状态：✅ 已交付（2026-11-12）—— 交付记录：`docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md`
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：
>
> - `docs/worklog/pending/phase3-text-disfluency-humanization-plan-2026-11-11.md`（Phase3 总体方案，下称「蓝图」）
> - 本单只覆盖蓝图 §6 **P0 · 度量层**；P1 审计基线、P2 Prompt 与开关、P3 角色配置与灰度准出均不在本单（见 §3）
>
> 任务性质：纯新增只读度量能力，**零行为变化**；改动全在 `src/auto-practice/metrics/` 与对应 `test/`，不碰 engine-core、不碰 prompt、不加 env、不加表。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式
3. 蓝图 `phase3-text-disfluency-humanization-plan-2026-11-11.md`：重点 §5.1 分类体系、§5.2 度量层设计、§6 P0 闸门
4. 现状锚点文件（本单 §2 已逐条核对，实现前再 Read 一遍确认）：
   - `src/auto-practice/metrics/metric-dictionary.ts`
   - `src/auto-practice/metrics/batch-metrics.compute.ts`
   - `src/auto-practice/metrics/batch-metrics.service.ts`
   - `src/auto-practice/metrics/batch-metrics.schema.ts`
   - `src/admin-debug/debug-session-store.ts`（messages 形状，:64-73、:98）
5. 本任务单（你在读的这份）

---

## 1. 背景（先读，方向别错）

### 1.1 平台与被度量对象

本平台是咨询师对练平台。`src/auto-practice/` 是「AI 咨询师 × AI 来访者」双向自动对练的内部调试设施；批次快照度量的是 **AI 来访者（visitor）** 的轨迹。本单新增的不流利指标同样只度量 visitor 台词，不给 AI 咨询师台词定任何 KPI。

### 1.2 为什么先做度量层（蓝图 §3 原则 1：度量先行）

蓝图 §1.2 根因 R3：现有语义解析器只统计结构化 tag，auto-practice 输出不带 tag，犹豫量无法进入任何指标与快照；`metric-dictionary.ts` 无 `text.*` 段。没有基线度量，后续「prompt 配额式提示 → 更像真人」的改动不可证伪。P0 先把分类体系、纯函数分析器、字典指标、快照投影打通，**只观测、不改变任何生成行为**。

### 1.3 隐私边界（本单最高优先级约束，蓝图 §5.2.3 复核修订）

`batch-metrics.compute.ts` 是零 IO 纯函数层，其输入 `TraceInput` 经服务层「合规投影」，文件头注释明确投影物理上不含 messages / renderSpec / intention.rationale。因此：

- **分析在服务层（IO 层）执行**：`batch-metrics.service.ts` 是唯一读取逐字稿文件的层（`buildBatchSnapshot` 内 `readFileSync`）。在投影同一步骤从顶层 `messages` 取 `role='visitor'` 条目，按 `turnIndex` 对齐 trace，对 visitor `text` 调纯函数 `analyzeDisfluency`；原始 `text` 不进任何下游结构，随解析对象释放。
- **投影只扩数值，不扩文本**：`TraceInput` 新增纯数值 `disfluency` 字段（六类计数 + events + hasEvent + normalizedLength，无任何文本引用）。
- **纯计算层只做数值聚合**：compute 层读取 `TraceInput.disfluency` 的数字聚合 8 个指标；纯层仍零 IO、零原文、同输入逐字节相同。
- 自检：`grep` 确认 `analyzeDisfluency` 的 import 与调用只出现在 `batch-metrics.service.ts`（及脚本 / 测试）；`batch-metrics.compute.ts` 内不出现任何文本形参或 analyzer import。

### 1.4 关键现状（已逐条核对，别当新问题）

| #   | 核对项           | 蓝图假设 / 预期                                           | 代码实测现状                                                                                                                                                                                               | 结论                                                                                                     |
| --- | ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | 字典版本         | `dict-v1 → dict-v2`                                       | `METRIC_DICTIONARY_VERSION = 'dict-v1'`（metric-dictionary.ts:292）                                                                                                                                        | 手动递增为 `dict-v2`                                                                                     |
| 2   | 非空键守卫       | 新键自动纳入 `NON_NULLABLE_IDS`                           | `NON_NULLABLE_IDS` 由 `METRIC_DICTIONARY.filter(m => !m.nullable)` 自动生成（:306）                                                                                                                        | 新指标 `nullable:false` 自动进守卫；**无需改守卫代码**                                                   |
| 3   | 单位枚举         | 8 指标用 per_turn / ratio / count                         | `MetricUnit = 'ratio' \| 'delta' \| 'count' \| 'per_turn'`（:23）已全覆盖                                                                                                                                  | 无需扩联合                                                                                               |
| 4   | 字典段结构       | 新增 `text.disfluency.*` 段                               | 现有段：dim. / event. / strategy. / session. / pipeline. / exploration / positive；无 `text.*`                                                                                                             | 新增段，范式对齐 `SCALAR_METRICS` 与 build*Metrics                                                       |
| 5   | TraceInput 形状  | 纯数值投影，扩 `disfluency`                               | 现字段：turnIndex / bdiSnapshot / eventTags / strategy / degraded（compute.ts:23-38），无文本                                                                                                              | 加纯数值 `disfluency` 字段                                                                               |
| 6   | 聚合范式         | compute* 函数填 metrics map                               | `computeDimensionMetrics / computeEventMetrics / computeStrategyMetrics / computeSummaryMetrics` 同构（compute.ts:115-256）；`buildSlice` 与 global 都走 `computeMetricMap`，byMode / byCharacter 自动带上 | 新增 `computeDisfluencyMetrics` 同范式；切片无需额外接线                                                 |
| 7   | 快照 schema      | 不升版本，键字典驱动                                      | `MetricsSlice.metrics` / `BatchMetricsV1.metrics` 均为 `Record<string, number \| null>`；守卫只验「数字或 null」（schema.ts:45、:63、:120-128）                                                            | **不改 schema.ts、不升 schemaVersion**（保持 1）                                                         |
| 8   | service 读取面   | 唯一 IO 层，从 messages 对齐                              | `projectTraces` 当前只解析 `traces[]`，**未读顶层 `messages`**（service.ts:68-82）；逐字稿 JSON 顶层确有平级 `messages` 与 `traces`（debug-session-store.ts:531-532）                                      | P0 新增 messages 对齐 + 调分析器 + 数值投影                                                              |
| 9   | messages 形状    | `{ role: 'counselor' \| 'visitor'; text; turnIndex; ts }` | `DebugSessionMessage { role; text; turnIndex; ts }`（debug-session-store.ts:64-73）一致                                                                                                                    | 按 `role === 'visitor'` 过滤，按 `turnIndex` 对齐；ts 为 ISO 时刻字段，对齐不消费                        |
| 10  | lexicon 范式     | 纯常量 + 纯函数、零 IO、可单测                            | `scripts/ops/quality/visitor-quality-lexicon.ts` 同款范式；analyzer 新模块同性质                                                                                                                           | `disfluency-lexicon.ts` 照搬范式                                                                         |
| 11  | 归一化口径       | 与审计脚本现有 normalize 对齐并复用                       | 审计脚本 `normalize` 在 visitor-quality-audit.ts:266-268，**是脚本内私有函数，未 export**；纯模块不能 import scripts                                                                                       | **偏差（见 §5.5）**：P0 在 analyzer / lexicon 内自实现归一化，口径对齐 audit :266；audit 侧收敛同源属 P1 |
| 12  | 测试落点         | `test/auto-practice/metrics/disfluency-analyzer.spec.ts`  | 现状 spec 平铺在 `test/auto-practice/` 根；vitest 无显式 include，默认递归 `**/*.spec.ts`，子目录可被发现                                                                                                  | 按蓝图路径落 `test/auto-practice/metrics/`；若实现方判断平铺更合现状亦可，目录选择在交付记录注明         |
| 13  | 现有字典测试     | 补完整性测试                                              | `test/auto-practice/wp-k-metric-dictionary.spec.ts`（id 唯一 / bounds / NON_NULLABLE 集合 / 枚举覆盖）                                                                                                     | 扩展该 spec，加 8 个新键存在性与口径断言                                                                 |
| 14  | 现有计算测试     | 补新键断言                                                | `test/auto-practice/wp-k-batch-compute.spec.ts`，`trace(turnIndex, overrides)` 工厂构造 TraceInput；另有字符串长度 ≤64 的台词泄漏护栏（:146-158）                                                          | 扩展该 spec：工厂补 disfluency 默认值，断言 8 指标聚合；新字段纯数值，护栏不受影响                       |
| 15  | service 投影单测 | 蓝图 P0 文件清单未列 service spec                         | `projectTrace / projectTraces` 为 service 模块内私有函数，现状无 export、无对应 spec                                                                                                                       | 沿用现状纪律，P0 不强加 service 单测；投影对齐规则在 §5.4 写清，靠 tsc + compute 测试护栏                |

---

## 2. 范围（严格遵守，不越权）

### 2.1 在范围内

1. **新增纯模块** `src/auto-practice/metrics/disfluency-analyzer.ts`：六类不流利识别纯函数 + 聚合纯函数，零 IO / 零框架依赖 / 零随机。
2. **新增纯常量词表** `src/auto-practice/metrics/disfluency-lexicon.ts`：填充词、停顿标点、重复词正则基元、修正触发词、叠词白名单等，与 `visitor-quality-lexicon.ts` 同范式。
3. **字典升 v2**：`metric-dictionary.ts` 版本常量 `dict-v1 → dict-v2`，新增 8 个 `text.disfluency.*` 指标（口径见 §5.2）；扩展字典完整性测试。
4. **service 投影接线**：`batch-metrics.service.ts` 解析顶层 messages（visitor 条目，按 turnIndex 对齐）→ 调 `analyzeDisfluency` → 数值填入 `TraceInput.disfluency`；原始 text 不进下游。
5. **compute 数值聚合**：`batch-metrics.compute.ts` 扩 `TraceInput.disfluency` 字段，新增聚合函数算出 8 个指标写入 metrics map；byMode / byCharacter 切片同步带上。
6. **测试**：analyzer 单测（六类识别 / 消歧优先级 / 白名单 / 连接词排除 / 聚合口径 / 边界）；字典 spec 扩展；compute spec 扩展。

### 2.2 明确不在范围内（禁止顺手做）

- **P1 · 审计基线**：`visitor-quality-audit.ts` 迁 lexicon 口径、加 D7 段、跑离线批次产出基线 JSON 与区间建议——本单不动审计脚本。
- **P2 · Prompt 与开关**：`disfluency-profile.ts`、`disfluency-instruction.ts`、配额指令块、DisfluencyConfig、4 个 env 键、`.env.example`、env 覆盖度测试、output guard 超限重生成、config 指纹新段——本单一律不碰。
- **P3 · 角色配置与灰度准出**：character 实体两列、手写 migration、ormconfig 登记、ResolvedCharacter 侧通道透传、灰度 A/B、人工读感复核、`humanization-v1` 判据实跑——本单不碰。
- 不改 `src/engine-core/` 下任何文件；`boundary.spec.ts` 不许改。
- 不改 `admin-dashboard/` 任何代码；不改 Flutter 客户端。
- 不改表结构、不加 migration、不加列；不改 resolver / module 装配 / 种子脚本。
- 不新增 LLM 调用；不在适配层随机插入任何文本；不引入结构化 tag（`[pause:x]` 等只属于语音路径）。
- 不清理既有技术债，不重构相邻旧文件。
- 不自动 `git commit` / `git push`；写完给 commit message 草稿，等主控指令。

---

## 3. 目标架构 / 交付物

> 设计原则固定四条：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 纯层确定性可复算。

- **交付物 1：分析器纯函数** —— `disfluency-analyzer.ts`：`analyzeDisfluency(text)` + `aggregateDisfluency(turns)`；接口形状见 §5.1。
- **交付物 2：词表纯常量** —— `disfluency-lexicon.ts`：六类词表 / 正则基元 / 叠词白名单，模块内唯一真相源；analyzer、测试同源消费。
- **交付物 3：字典 v2** —— `metric-dictionary.ts`：8 个新指标 + 版本号；口径定义（分子 / 分母）写进每个 `definition`，不靠名字猜。
- **交付物 4：投影与聚合接线** —— service 层 messages 对齐 + 数值投影；compute 层 `TraceInput.disfluency` + 数值聚合。
- **交付物 5：测试** —— analyzer spec + 字典 spec 扩展 + compute spec 扩展；不起 Nest、不连真实 DB。

**口径真相源**：词表、分类口径、指标 id / 单位 / 定义唯一真相源在 `disfluency-lexicon.ts` 与 `metric-dictionary.ts`；service、compute、测试只读消费，不得复制第二份词表或口径。版本号（字典 v2）随快照数据下发，便于审计追溯。

---

## 4. 红线（违反即返工）

- **分层归属**：analyzer / lexicon / 字典 / compute 都是纯层，落 `src/auto-practice/metrics/`；禁止在纯层加 NestJS 装饰器、IO、网络、prompt、模型名、`process.env`、`globalThis`。engine-core 一行不动。
- **隐私**：对话原文禁止进日志 / console / crash report / 快照；快照内只允许 id、计数、比率、布尔、归一化字符数。复用 compute spec 既有的「快照内字符串长度 ≤ 64」泄漏护栏思路；新增字段不得携带任何文本片段。
- **纯层确定性**：同输入必须逐字节相同；不依赖当前时间、随机数、环境变量；浮点统一 `round6`（复用 `metrics/round.ts`）。
- **快照契约**：schemaVersion 保持 1；metrics 键由字典驱动，只增不改不复用；旧快照缺新键按缺省处理，不回溯重算历史快照。
- **指标 id 稳定**：8 个 id 一旦提交只增不改；`definition` 写清分子 / 分母口径。
- 不改表结构 / migration / 内容字段；不越权加需求外功能；不自动 commit / push。

---

## 5. 接口与口径规格

### 5.1 分析器接口（蓝图 §5.2.1 原文形状）

```ts
// disfluency-analyzer.ts
export interface DisfluencyCounts {
  readonly filler: number;
  readonly pause: number;
  readonly repetition: number;
  readonly repair: number;
  readonly trailoff: number;
  readonly elongation: number;
}

export interface DisfluencyMetrics {
  readonly counts: DisfluencyCounts;
  /** 不流利事件总数（六类之和）。 */
  readonly events: number;
  /** 含至少一次不流利的轮次占比由聚合层计算，本层只给 per-turn 布尔。 */
  readonly hasEvent: boolean;
  /** 文本归一化字符数（密度分母，不暴露原文）。 */
  readonly normalizedLength: number;
}

export function analyzeDisfluency(text: string): DisfluencyMetrics;

export function aggregateDisfluency(turns: readonly DisfluencyMetrics[]): {
  readonly eventsPerTurn: number;
  readonly eventTurnRate: number;
  readonly densityPer100Chars: number;
  readonly typeCounts: DisfluencyCounts;
};
```

### 5.2 字典 8 指标（蓝图 §5.2.2 原文表）

| 指标 id                               | 单位     | 方向    | nullable | 口径定义（definition 写入要求）                                  |
| ------------------------------------- | -------- | ------- | -------- | ---------------------------------------------------------------- |
| `text.disfluency.events_per_turn`     | per_turn | neutral | false    | 六类不流利事件总数 ÷ 纳入轮数                                    |
| `text.disfluency.event_turn_rate`     | ratio    | neutral | false    | 含不流利事件的轮次 ÷ 纳入轮数                                    |
| `text.disfluency.density_per100`      | count    | neutral | false    | 事件总数 ÷ 归一化总字符数 × 100                                  |
| `text.disfluency.filler_per_turn`     | per_turn | neutral | false    | 填充词命中 ÷ 纳入轮数（与旧 fillerPerTurn 同口径，新 id 取代之） |
| `text.disfluency.pause_per_turn`      | per_turn | neutral | false    | 停顿事件 ÷ 纳入轮数                                              |
| `text.disfluency.repair_per_turn`     | per_turn | neutral | false    | 自我修正 ÷ 纳入轮数                                              |
| `text.disfluency.repetition_per_turn` | per_turn | neutral | false    | 词语重复 ÷ 纳入轮数                                              |
| `text.disfluency.trailoff_per_turn`   | per_turn | neutral | false    | 半截话 ÷ 纳入轮数                                                |

bounds 纪律（蓝图 :173）：ratio / per_turn 类给 [0,1] 语义取值域；`density_per100` 首版 `bounds: null` 并在 definition 写清口径，待基线批次后补取值域。所有方向 `neutral`。

聚合映射（`aggregateDisfluency` 返回 ↔ 指标）：

- `eventsPerTurn` → `events_per_turn`
- `eventTurnRate` → `event_turn_rate`
- `densityPer100Chars` → `density_per100`
- `typeCounts.filler / pause / repair / repetition / trailoff` 各 ÷ 纳入轮数 → 五个 `*_per_turn`
- `typeCounts.elongation` 计入事件总量与 events 计数，**不单列 per-turn 指标**（蓝图 §5.2.2 表无 elongation 指标）。

### 5.3 分类与消歧口径（蓝图 §5.1）

六类：filler（填充词）、pause（停顿省略号）、repetition（词语重复）、repair（自我修正）、trailoff（半截话）、elongation（拖音）。

口径纪律：

1. **消歧优先级**：一个文本位置只归一类，按 `repair > trailoff > repetition > pause > filler > elongation` 判定。
2. **叠词白名单**：妈妈、爸爸、慢慢、一点点、看看、想想等在 lexicon 常量维护，不计 repetition。
3. **填充词位置约束**：「然后 / 其实 / 就是 / 那个」既是填充词也是正常词，只统计**句首**或**被标点隔离**的命中；句中正常承接不计入 filler，避免系统性高估。
4. **elongation 保守识别**：仅识别显式重复韵母字（如「嗯——」「哎——」），破折号归一；默认计入计数，留扩展位。
5. **停顿合并**：`……`、`…`、`。。。` 归一后连续标点合并为一次停顿事件。

### 5.4 service 投影规则（§1.3 边界落地）

1. `projectTraces(fileContent)` 解析顶层 `messages`（缺失或非数组 → 空数组，不报错）；过滤 `role === 'visitor'`，按 `turnIndex` 建索引。
2. 逐 trace 投影时，按 `turnIndex` 取对应 visitor 条目：
   - 命中：`analyzeDisfluency(text)` 的数值结果填入 `disfluency`；`text` 取值后即丢弃，不存入 trace 或任何中间对象。
   - 未命中（老逐字稿无 messages / 无该轮 visitor 条目）：`disfluency` 填**零值结构**（六类计数 0、events 0、hasEvent false、normalizedLength 0），与 eventTags 空轮口径一致——8 个 nullable:false 指标必须可赋值，不留 null。
3. `TraceInput.disfluency` 类型即 `DisfluencyMetrics`（纯数值，无文本引用）；`projectTrace` 只填数字。
4. 对齐以 `turnIndex` 为准；同一 turnIndex 出现重复 visitor 条目时，取数组首条（本单约定；审计脚本 `visits` 仅按角色过滤、未做重复 turnIndex 去重，不声称与其对齐），重复情况在交付记录注明。

### 5.5 归一化口径偏差说明（现状 §1.4 第 11 项）

蓝图 §5.1 纪律 4 与 §5.2.1 表述为「与 `visitor-quality-audit.ts` 现有 normalize 口径对齐并复用」。实测该 `normalize`（audit :266-268：去空白、去标点）是脚本内私有函数、未 export，纯模块无法 import。P0 处理：

- 在 analyzer / lexicon 内自实现归一化函数，**口径对齐** audit :266（去 `\s+`；半全角标点统一后去除）；
- 审计脚本侧改用新模块、废弃私有 FILLERS 独立口径，属 **P1**，本单不做；
- 交付记录需写明：P0 归一化与 audit :266 的逐项对照，若有差异给出原因。

### 5.6 测试覆盖要求（蓝图 §9 DoD 1 + §6 P0）

analyzer spec 至少覆盖：

- 六类各至少一个正例识别正确；
- 消歧优先级（同一文本同时满足多类时按 §5.3 第 1 条归到最高优先级类）；
- 叠词白名单不计 repetition；连接词正常承接不计 filler；
- 聚合口径：多轮事件总数、有事件轮次占比、密度、五类 per-turn 计数；
- 边界：空文本、纯标点、超长句、无任何不流利文本；
- 确定性：同输入两次结果深相等。

字典 spec 扩展：8 个新键存在、单位 / 方向 / nullable 与 §5.2 表一致、bounds 合法、id 唯一。

compute spec 扩展：构造带 `disfluency` 数值的 trace，断言 global 与 byMode / byCharacter 切片内 8 指标聚合值正确；零值兜底轮次不产生非零指标。

---

## 6. 闸门（分层执行，填真实数字，禁止留空）

### 6.0 命令规范（强制，禁止裸 npx）

- 本仓库 `packageManager=pnpm`：跑脚本用 `pnpm <script>`，跑二进制用 `pnpm exec <bin> <args>`；禁用裸 `npx`。
- 跑闸门前确认机器干净：无 `nest start --watch` / 后台 `vite dev` / `dist/app` 在跑；先跑 `pnpm doctor:fs` 确认盘读延迟正常。
- 取证会话 PATH 需含 git（本机 `D:\Apps\Git\cmd`）；依赖 `execFileSync('git')` 的 spec 在缺 git 的 PATH 下会报 ENOENT 假失败，补齐 PATH 后复跑，不要把环境缺陷记成回归。

### 6.1 日常内循环（定向）

| 目的             | 命令                                                       |
| ---------------- | ---------------------------------------------------------- |
| 语法 / 明显缺陷  | `pnpm lint:fast`                                           |
| 类型（增量缓存） | `pnpm typecheck`                                           |
| 单个测试文件     | `pnpm exec vitest run <file.spec.ts>`                      |
| 受影响测试       | `pnpm test:related -- <src/xxx.ts>` 或 `pnpm test:changed` |

### 6.2 收尾闸门（交付前各跑一次，记录真实命令 / exit code / 数字）

| 闸门        | 命令                                                                                   | 要求                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`（等价仓库脚本 `pnpm typecheck:build`） | 0 error                                                                               |
| Lint        | `pnpm lint`                                                                            | 0 error，记 warning 数                                                                |
| 测试        | `pnpm exec vitest run test/auto-practice`                                              | 全绿；记用例总数、failed / skipped 数与墙钟，并注明机器状态（有无长驻进程、盘读延迟） |
| engine-core | `git diff --stat HEAD -- src/engine-core`                                              | 空（或写明例外批准）                                                                  |
| 边界自检    | `grep` analyzer import 只在 service / 脚本 / 测试出现；compute 层无文本形参            | 证据写入交付记录                                                                      |

基线参照：本单起草时未跑全量，既有测试例数以现场复跑为准；交付后不允许新增 failed，最终例数以实测为准。

---

## 7. 交付记录（完成后写，路径固定）

写到：`docs/worklog/completed/phase2.5/phase3-disfluency-p0-metrics-implementation-2026-11-12.md`
（归档目录沿用当前 `phase2.5/`，不新建 `completed/phase3/`。）

内容必须含：

1. 一句话总结。
2. 方案设计：实际实现 vs 本单方案；有偏差写清原方案 / 实际方案 / 为什么（conventions §2.5）。
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）。
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例数、墙钟、机器状态）。
5. 任务特有结果：
   - 归一化函数与 audit :266 的逐项对照；
   - messages 对齐规则、零值兜底处理、重复 turnIndex 情况；
   - 8 指标在手工构造样本上的聚合结果（analyzer spec / compute spec 已覆盖的关键用例数值）；
   - analyzer import 边界 grep 证据。
6. 契约变化：字典新增 8 键、版本号 dict-v2；快照 schemaVersion 未变；列明差异供前端 AI 后续对齐（本单不改前端）。
7. 风险与回归：哪些既有测试被改及原因；确认未碰 engine-core / schema / 表结构 / prompt / env / 审计脚本。
8. 遗留项与建议人工复核（P1 审计迁移、bounds 基线后补、density 取值域校准）。

---

## 8. 【交付回写清单】做完逐项勾选

- [x] 交付记录已写到 §7 固定路径
- [x] 本任务单从 `pending/` 移到对应 completed 目录，顶部状态行改为 ✅ 并链接交付记录
- [x] 回写蓝图 `phase3-text-disfluency-humanization-plan-2026-11-11.md`：标注 P0 任务单与交付记录链接、P0 落地状态
- [x] 确认未碰 P1 / P2 / P3 范围文件；遗留项登记进蓝图「P0 落地状态与遗留项」小节（Phase3 专属 backlog 台账尚未建立，待 P1 派单时建，见交付记录 L-10）
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对：本单文件与并行进程产物分开；未代提交（等主控指令）
- [x] 给出一行 commit message 草稿（不自己 commit / push）

---

## 9. 回复输出约定

完成后在对话里：

1. 说一句「已写入交付记录」并附文件路径，不重复贴全文；
2. 报告闸门真实数字（typecheck / lint / vitest）；
3. 报告 §8 回写清单哪几项已做、有无遗留；
4. 不贴代码 diff 全文，让主控自行 `git diff`。
