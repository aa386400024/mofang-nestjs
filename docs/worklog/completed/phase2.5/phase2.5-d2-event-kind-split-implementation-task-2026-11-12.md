# D-2 开工单 · 事件类型拆分（holding_present / cold_absent 进 core 联合与 delta 表行 · 中间态）

> 状态：✅ **已交付**（2026-11-12，MiniMax Code）→ [交付记录](phase2.5-d2-event-kind-split-implementation-2026-11-12.md)（本单已归档至 `docs/worklog/completed/phase2.5/`）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `2bf32f0`（D-1 两段已推送，工作区干净）。
> 事实源：结构债草案 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（§4.2 S-2、§4.3 S-3、§9 D 编号表行 285-286）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（I-08 / I-10 / I-18）；D-1 交付记录 `docs/worklog/completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md`。
> 任务性质：事件类别粒度拆分单。把 `holding_present`（结构化过渡、稳定在场）与 `cold_absent`（敷衍缺席）两类事件从 `neutral` 拆出，进 core 联合、`DELTA_TABLE` 表行与各口径登记表；审计事件恢复词表命中明细。首版仍为**中间态**：模型轨继续走 shadow 旁路，新 kind 不驱动当轮生效 delta；临床幅度留标定批次。
> 改动范围：core 纯层 4 个既有文件（例外批准，见下）、adapter 若干既有文件、测试若干文件；不碰前端、不接 DB migration、不新增 core 文件或具名导出、不跑批次、不调真模型做离线批量。

## 例外批准声明

本单**有限授权**改动 `src/engine-core/**`，且仅限以下 4 个**既有**文件、以下改动内容。D-1 已批 `session-event.ts`、`in-memory-engine-session.ts`；本单在此之上追加 `state-transition.ts`、`engine-session.types.ts`，并对前两个既有文件做二次触碰：

| #   | core 文件                                               | 允许的改动                                                                                                                                                     | 不允许                                                                                                         |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `src/engine-core/domain/events/session-event.ts`        | `CounselorEventKind` 联合追加 `holding_present`、`cold_absent`；头注释口径同步更新                                                                             | 不改 `EventClassifier` 接口签名；不改 `SessionEvent` / `ClassifyContext` 字段；不新增导出名；不新增 `.ts` 文件 |
| 2   | `src/engine-core/cognition/state-transition.ts`         | `DELTA_TABLE` 追加两行，种子向量 = `ZERO`；注释标明临床增量留标定批次、走 `DeltaTableConfig` 覆写范式                                                          | 不改 `aggregateTurnDelta` 聚合逻辑、cap、`resolveDeltaVector`、`clamp01`；不改任何既有 kind 表行数值           |
| 3   | `src/engine-core/domain/engine-session.types.ts`        | `EngineTurnOutput` 新增**可选**出参 `eventDetails`（复用既有 `SessionEvent` 形状：`kind` + `matchedTerms` + `strength`）；保留旧 `events`（kind 数组）逐字不变 | 不改其他出参字段；不改快照 / Intention / 轨迹类型；不新增具名导出类型                                          |
| 4   | `src/engine-core/in-memory/in-memory-engine-session.ts` | 填充 `eventDetails`（取本轮 `SessionEvent` 的 `kind` / `matchedTerms` / `strength`）；旧 `events` kind 投影保持现状                                            | 不改状态迁移、分类调用 await 分支、跨轮状态、cap、人格调节任何逻辑                                             |

其余 core 文件**一律不动**。`test/engine-core/boundary.spec.ts` 不许改；不新增 core 文件与具名导出（断言⑥⑦ 须保持绿）。除上表外，任何 `src/engine-core/**` 改动在交付时打回。

> 边界断言核对：断言⑥（barrel 导出白名单双向比对）只在新增具名导出时撞红；断言⑦（目录五件套）只在新增 core `.ts` 文件时撞红。本单 4 项改动均落在既有文件、既有类型可选字段上，不触发⑥⑦。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）→ `AGENTS.md`（§5.1 隐私）。
2. D-1 交付记录全文（改动面、C3 审计口径、中间态形态、遗留到 D-2 的清单）。
3. 结构债草案 §4.2（S-2 事件拆分方案 2）、§4.3（S-3 时序权重，本单不做）、§9 D 编号表行 285-286。
4. 台账 I-08 / I-10 / I-18 三节（现象、草案候选幅度、证据边界）。
5. 本开工单。

---

## 1. 背景与已决项

### 1.1 背景

规则词轨把 `holding_present`（稳定在场的有效中性）与 `cold_absent`（敷衍、无回应、模板化）都吞进 `neutral`，同乘 `ZERO`：前者临床应微正向却测不出，后者临床应零或负向却测不出。D-1 已让模型轨具备看到来访上一轮话语、按 `sessionId` 分桶持有跨轮状态（连续中性 / 连续缺席计数）的能力，但两类标签当时只作旁路 `sideLabels`，**未进 core 联合**，进不了 delta。本单完成事件类别层的拆分落地。

结构债草案 §4.2 前置写明：I-03 至 I-08 的数值修复应先批次复验，避免参数叠加。台账现状：I-03～I-07 标已修复（WP-L），**I-08 为部分缓解、真实曲线待批次验证**。本单据此隔离：新 kind 表行种子取 `ZERO`（与 `neutral` 现状逐字一致），临床幅度不叠加进 core 种子表，候选值留标定批次。

### 1.2 已拍板（不再复议）

| 议题                      | 拍板结论                                                                                                                           | 依据                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1.2.1 流程                | **跳过只读预研**，基于结构债草案与 D-1 结论直接写实现任务单；改动面与口径在本单内一次定死                                          | 用户拍板                                  |
| 1.2.2 `llm_active` 生效轨 | **不接**。模型轨仍走 shadow 旁路；生效轨接线独立成单。本单两类新 kind 在 shadow 下只进观测，不进当轮生效 delta                     | 用户拍板；D-1 §7.5 中间态延续             |
| 1.2.3 审计 matchedTerms   | **给例外批准恢复**。扩 core 出参带词明细（上表 #3 #4），审计恢复词表命中证据；同步改 wp58 断言与出参契约                           | 用户拍板；D-1 偏差登记的第 3 个 core 文件 |
| 1.2.4 种子与回落          | 新 kind `DELTA_TABLE` 行种子 = `ZERO`，缺省回落旧 `neutral` 行为（零回归）；临床方向 / 幅度 / 斜率留标定批次，工程不替临床拍板数值 | 结构债 §157 / §168；台账 I-08 待复验      |
| 1.2.5 `neutral` 去留      | **保留** `neutral` 作兜底第三类，不删；规则轨未命中任何词表条目时仍归 `neutral`                                                    | 草案 §157「或保留 neutral 作第三类」      |

### 1.3 四条工程纪律（D-1 已证，延续）

- 回落必须逐字等价于规则轨；模型轨实现内部持有规则轨实例，失败时返回规则轨 `classify` 结果。内核不感知回落；回落代码只有一处。
- 跨轮状态分桶键用业务 `sessionId`，禁用 `handleId`（运行时维度，会话恢复后会变）。
- 模型轨每条事件 `strength` 恒 1；置信度只进观测，不参与 delta 缩放。
- 事件分类只消费咨询师本轮文本，不从来访输出反推（避免循环论证）。

## 2. 已核现状锚点（行号以代码为准，先 grep 符号名定位）

| 位置                                                                            | 现状                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-core/domain/events/session-event.ts:13-24`                          | `CounselorEventKind` = 10 行为 + `neutral`（共 11）；`:27-33` `SessionEvent{kind, matchedTerms, strength}`；`:44-48` `ClassifyContext{sensitiveTopics?, sessionId?}`；`:61-72` `EventClassifier{classify, classifyAsync?}` |
| `src/engine-core/cognition/state-transition.ts:160`                             | `ZERO: DeltaVector`（11 维全零）                                                                                                                                                                                           |
| 同文件 `:197`                                                                   | `DELTA_TABLE: Readonly<Record<CounselorEventKind, DeltaVector>>`（穷尽 Record，联合一变编译逼补）；`:350` `neutral: ZERO`                                                                                                  |
| 同文件 `:386`                                                                   | `DELTA_TABLE[event.kind] ?? ZERO`；`:389-400` `strength` 参与 11 维 delta 缩放                                                                                                                                             |
| `src/engine-core/domain/engine-session.types.ts:215`                            | `events?: readonly CounselorEventKind[]`（出参只带 kind，不带词明细）                                                                                                                                                      |
| `src/engine-core/in-memory/in-memory-engine-session.ts:404-411`                 | 分类调用点（`classifyAsync ? await : classify`，context 透传 `sessionId: runtime.sessionId`）；`:142` `runtime.sessionId`                                                                                                  |
| 同文件 `:504`                                                                   | 出参 `events: events.map((event) => event.kind))` —— `matchedTerms` 在此投影丢失                                                                                                                                           |
| `src/admin-debug/event-tag-labels.ts:35`                                        | `COUNSELOR_EVENT_LABELS: Readonly<Record<CounselorEventKind, string>>`（穷尽 Record，11 项中文标签）                                                                                                                       |
| `src/engine-adapters/cognition/model-event-mapping.ts:33`                       | `CORE_EVENT_KIND_TABLE: Readonly<Record<CounselorEventKind, true>>`（穷尽）；`:59` `MODEL_SIDE_LABELS = ['holding_present', 'cold_absent']`；`:103` `MODEL_LABEL_MAPPING` —— 两类当前只挂 `sideLabel`、不映射 coreKind     |
| 同文件 `:136-148`                                                               | `mapModelLabels()`（未知标签丢弃 / 去重保序 / 全丢 → null）；`:174-187` `validateModelClassification()`（形状校验）                                                                                                        |
| `src/engine-adapters/cognition/model-event-classifier.ts:556 / :558-559 / :583` | `sideLabels` 消费点：neutral 判定、cold / holding 判定、`modelKinds` 拼接；`:237-238 / :243` prompt 文案称两类为「旁路标签」                                                                                               |
| `src/auto-practice/metrics/metric-dictionary.ts:67`                             | `TRACKED_EVENTS`（11 项）；`:84` `POSITIVE_EVENTS = ['empathy','acceptance','normalization','open_probe','affirmation']`                                                                                                   |
| `src/engine-adapters/deliberation/deliberation-types.ts:104`                    | `DELIBERATION_RULE_ALIGNED_TAGS`（10 项，刻意不含 `neutral`）                                                                                                                                                              |
| `src/engine-adapters/wiring/trajectory/ethical-scripts.ts:72 / :80 / :90`       | 三组事件字面量数组（`COUNSELING_MOVE_EVENTS` / `ATTUNED_COUNSELOR_EVENTS` / `BOUNDARY_VIOLATION_EVENTS`）                                                                                                                  |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts:281`                 | `TurnRenderResult.events?: readonly CounselorEventKind[]`（门面原样透传内核出参）；`:649 / :726 / :1377` 三处结果构造透传；`:895` 审议输入 `kernelEvents: output.events`；`:1002` 观测 `events: round.output.events ?? []` |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.ts:42-47`    | `TurnDeltaAuditInput{tenantId, sessionId, turnIndex, kernelEventKinds}`（`userText` 已删）；`:67-71` `TurnDeltaAuditEventDetail{kind, matchedTerms, strength}`                                                             |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts:78-81` | `kernelEventsToSessionEvents(kernelEventKinds)`：`matchedTerms` 恒 `[]`、`strength` 恒 1；`:162-178` `persist`（eventKinds / eventDetails / rawDelta）                                                                     |
| 测试基线                                                                        | `test/quality/d1-event-classifier-evidence.spec.ts` 39 例规则轨快照（复用不改）；`test/engine-core/boundary.spec.ts` 12 例；`test/engine-adapters/wp58-turn-delta-audit.spec.ts`                                           |

## 3. 范围

### 3.1 在范围内

**A. core 契约（例外批准 4 文件，见声明表）**

1. `session-event.ts`：联合追加 `holding_present`、`cold_absent`；头注释「正向 / 负向 / 触发 / neutral」口径补两类说明（在场状态类，非行为动作类）。
2. `state-transition.ts`：`DELTA_TABLE` 补两行 `holding_present: ZERO`、`cold_absent: ZERO`；注释写明「种子零向量；临床方向与幅度由标定批次经 `DeltaTableConfig` 覆写，不在基础表落地」。
3. `engine-session.types.ts`：`EngineTurnOutput` 新增可选 `eventDetails?: readonly SessionEvent[]`；旧 `events?: readonly CounselorEventKind[]` 保留。不新增具名导出类型（明细元素复用既有 `SessionEvent`）。
4. `in-memory-engine-session.ts`：`events.length > 0` 分支内一并挂 `eventDetails: [...events]`（数组副本，与既有 `events` 副本纪律一致）；旧 kind 投影逐字不变。

**B. adapter 映射与模型轨实现**

5. `src/engine-adapters/cognition/model-event-mapping.ts`：
   - `CORE_EVENT_KIND_TABLE` 补两项；
   - 两类从旁路 `sideLabels` 提升为 core kind：`MODEL_SIDE_LABELS` / `ModelSideLabel` 类型移除，`ModelEventLabel = CounselorEventKind`；
   - `MODEL_LABEL_MAPPING`：`holding_present` / `cold_absent` 改 `coreKind` 映射自身；`ModelLabelMapping.sideLabel` 字段移除；
   - `ModelClassification` / `MappedModelLabels` 的 `sideLabels` 字段移除；`mapModelLabels` 去掉 sideLabels 分支，未知标签丢弃 / 去重保序 / 全丢 → null 口径不变。
6. `src/engine-adapters/cognition/model-event-classifier.ts`：
   - `:556` neutral 判定改为 `coreKinds.every((kind) => kind === 'neutral')`（两类进 `coreKinds` 后不再被当作 neutral）；
   - `:558-559` cold / holding 判定改从 `coreKinds.includes(...)`；
   - `:583` `modelKinds` 直接取 `coreKinds`（去掉 sideLabels 拼接）；
   - `:237-238 / :243` prompt 文案：两类从「旁路标签」改述为正式事件种类；状态计数语义（连续缺席）不变；
   - `coldStreak` 状态字段与计数逻辑不变。

**C. adapter 口径登记表**

7. `src/admin-debug/event-tag-labels.ts`：`COUNSELOR_EVENT_LABELS` 补两项穷尽键 —— `holding_present: '稳定在场'`、`cold_absent: '冷漠缺席'`（展示名以临床口径为准，执行方不得另造近义词；若台账有定稿名称则以台账为准）。
8. `src/auto-practice/metrics/metric-dictionary.ts`：`TRACKED_EVENTS` 补两项；`POSITIVE_EVENTS` **默认不纳入** `holding_present`（是否正向属临床口径，留标定批次拍板），注释写明此默认选择与待决状态。
9. `src/engine-adapters/deliberation/deliberation-types.ts`：`DELIBERATION_RULE_ALIGNED_TAGS` **不动**；补一行注释说明两类新 kind 暂不纳入规则对齐组（规则轨词表不产出，影子对比口径不变），留标定批次评估。
10. `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.ts`：写侧输入从 `kernelEventKinds` 扩展为事件明细（`kind` + `matchedTerms`；`strength` 可选，缺省 1）；`kernelEventKinds` 由明细派生，保持读侧 `eventKinds` 口径。
11. `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts`：`kernelEventsToSessionEvents` 改为直接消费内核给出的明细构造 `SessionEvent`（`matchedTerms` 取内核值；模型轨事件 `matchedTerms` 为空数组是事实，**不造词**）；`strength` 取明细值，缺省 1。`persist` 的 eventKinds / eventDetails / rawDelta 落库结构不变（JSON 列字段本就含三键）。
12. `src/engine-adapters/rendering/turn-render-orchestrator.ts`：`TurnRenderResult` 加可选 `eventDetails`（复用 core `SessionEvent` 形状）；`:649 / :726 / :1377` 三处结果构造点透传。审议输入 `:895 kernelEvents` 与观测 `:1002 events` **仍只取 kind 数组**（两类不进审议白名单，见 §3.1-9），不扩。
13. `src/engine-adapters/wiring/engine-turn.service.ts`：`auditTurn`（`:474`，record 调用 `:479`，既有 `kernelEventKinds: result.events ?? []` 在 `:484`）改传本轮 `eventDetails`；`turn` / `turnStream` 两个出口共用同一透传。

**D. 测试**

14. `test/quality/d1-event-classifier-evidence.spec.ts`：**复用不改**，作为规则轨零回归锚。
15. `test/engine-adapters/d2-event-kind-split.spec.ts`（新）：覆盖 ——
    - core 联合 13 类与三处穷尽 Record 键集合一致（`DELTA_TABLE` / `COUNSELOR_EVENT_LABELS` / `CORE_EVENT_KIND_TABLE`）；
    - 两行种子向量逐字等于 `ZERO`；
    - 映射收敛：两类进 `coreKinds`，`sideLabels` 形态不再存在；未知标签丢弃、全丢 → null；
    - 出参 `eventDetails` 往返（kind / matchedTerms / strength 随本轮 `SessionEvent` 落出参）；
    - 审计按输入明细落库 `matchedTerms`；
    - shadow 中间态：判出两类新 kind 时，BDI 快照与当轮 delta 逐字不变（种子 ZERO + 不接生效轨）；
    - 规则轨仍只产出既有 11 类，不产出两类新 kind。
16. `test/engine-adapters/model-event-classifier.spec.ts`：原 `sideLabels` 相关断言同步改为 `coreKinds` 口径；跨轮计数（连续缺席 / 连续中性）断言不变。
17. `test/engine-adapters/wp58-turn-delta-audit.spec.ts`：
    - `:172` `matchedTerms` 断言由 `toEqual([])` 改为按输入明细校验；
    - `:254` `sensitive_touch` 词明细断言同步口径；
    - 补一条规则轨词明细（非空 `matchedTerms`）落库用例；
    - 既有「审计事件集合 == 内核事件集合」「rawDelta 与内核系数表逐字一致」断言保留不改语义。

### 3.2 明确不在范围内

- 不接 `llm_active` 生效轨；模型轨结果不替换规则轨、不进 `aggregateTurnDelta` 生效路径。
- 不落地两类新 kind 的临床 delta 方向 / 大小 / 权重斜率；缺席连续轮数阈值；`POSITIVE_EVENTS` 是否纳入 `holding_present`；低置信临床口径。以上留标定批次 / D-3 前置评估。
- 不扩规则轨词表（`event-lexicon.ts`）的「在场标记」条目；规则轨本单仍只出既有 11 类 + `neutral`。
- 不新增 env 键；不改审计实体 JSON 列结构；不接 DB migration；不跑批次；不调真模型做离线批量；不做吞吐 / 429 实测。
- 不改前端 `src/admin-dashboard`；不新增 core 文件或具名导出；不改 `boundary.spec.ts`。
- 不动 `ethical-scripts.ts` 三组事件数组；不动审议白名单成员。
- 不做 D-3 时序权重端口；不复议 D-4 cold 模式先验（DOC-2 不建议单独实施）。
- 不清理既有根 `tsconfig` 类型债（D1-7，86 文件 396 条）；既有债单独排期。
- 发现任务单与代码冲突时，写进交付记录风险节，不静默改写。
- 不自动 commit / push。

## 4. 契约与类型形状

### 4.1 core 联合与出参（例外批准）

```ts
// src/engine-core/domain/events/session-event.ts
export type CounselorEventKind =
  | 'empathy'
  | 'acceptance'
  | 'normalization'
  | 'open_probe'
  | 'affirmation'
  | 'judgment'
  | 'preaching'
  | 'minimizing'
  | 'boundary_cross'
  | 'sensitive_touch'
  | 'neutral'
  | 'holding_present' // 稳定在场的有效中性（影子中间态，种子 ZERO）
  | 'cold_absent'; // 敷衍 / 缺席 / 模板化（影子中间态，种子 ZERO）
```

```ts
// src/engine-core/domain/engine-session.types.ts（在 EngineTurnOutput 内）
/** 本轮事件明细（kind + 命中词 + 强度）；只读观测，不参与决策。 */
readonly eventDetails?: readonly SessionEvent[];
// 旧字段保留：
readonly events?: readonly CounselorEventKind[];
```

填充点（`in-memory-engine-session.ts:504` 分支）：

```ts
...(events.length > 0
  ? {
      events: events.map((event) => event.kind),
      eventDetails: [...events],
    }
  : {}),
```

### 4.2 映射表收敛（adapter）

```ts
// src/engine-adapters/cognition/model-event-mapping.ts
// MODEL_SIDE_LABELS / ModelSideLabel 移除；ModelEventLabel = CounselorEventKind

export interface ModelClassification {
  readonly coreKinds: readonly CounselorEventKind[]; // 含 holding_present / cold_absent
  readonly confidence: number;
}

// MODEL_LABEL_MAPPING:
//   holding_present: { coreKind: 'holding_present' }
//   cold_absent:    { coreKind: 'cold_absent' }
```

`mapModelLabels` 返回 `coreKinds` 单数组；`sideLabels` 字段与分支移除。校验器 `validateModelClassification` 形状（`kinds` 字符串数组 + `confidence` [0,1]）不变。

### 4.3 审计输入形状（adapter）

```ts
// src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.port.ts
export interface TurnDeltaAuditEventInput {
  readonly kind: CounselorEventKind;
  readonly matchedTerms: readonly string[];
  readonly strength?: number; // 缺省 1
}

export interface TurnDeltaAuditInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly kernelEvents: readonly TurnDeltaAuditEventInput[]; // 事件明细（唯一事件来源）
}
```

service 内由明细派生 `eventKinds`（去重保序，与既有 `eventKinds` 口径一致）；不再需要 `kernelEventsToSessionEvents` 的空词兜底构造。读侧 `TurnDeltaAuditEventDetail{kind, matchedTerms, strength}` 不变。

### 4.4 种子 delta 与覆写范式

- `DELTA_TABLE` 两行基础值 = `ZERO`；不写入台账 §I-18 节的草案候选幅度（`holding_present`：safety +0.002 / bond +0.001；`cold_absent`：trust −0.002）。该候选值在交付记录风险节登记为**标定批次候选**，由标定批次经 `DeltaTableConfig.deltas` 覆写落地；core 基础表不承担临床参数。
- `resolveDeltaVector` 优先级（覆写 > 同盟 > 基础值）既有逻辑不变；新 kind 自然继承同一裁决路径。

### 4.5 观测与隐私口径

- 审计 `eventDetails` 只含 `kind` + `matchedTerms`（词表命中词 / 正则原文，非咨询师原话）+ `strength`；模型轨事件 `matchedTerms` 为空数组，不补造词表证据。
- 模型轨对照观测 trace（D-1 §4.4 字段表）字段不变；`modelKinds` 取值集合改为 coreKinds（含两类）。trace 仍禁入原话、解释文本、`kernelState`、展示名。

## 5. 跨轮状态归属与并发、中断、回落纪律

- 模型轨 `Map<sessionId, state>` 分桶、`forgetSession` 清理、TTL 兜底、同会话并发串行、中断轮不推进状态 —— D-1 §5 纪律逐条延续，本单不改。
- 两类新 kind 进 `coreKinds` 后，`advanceState` 的 neutral 判定与连续缺席计数口径：`cold_absent` 且非 `holding_present` 且规则轨未命中行为类 → 连续缺席 +1；其余情形计数清零。该判定语义与 D-1 一致，只是取值来源从 `sideLabels` 改到 `coreKinds`。
- 回落规则轨时按规则轨结果推进跨轮状态（回落也是一次有效判定）；此选择在 spec 中写死。

## 6. 风险点登记（本单相关）

| #   | 风险                                                                                                            | 本单处置                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| T1  | 穷尽 Record 漏补：三处表（`DELTA_TABLE` / `COUNSELOR_EVENT_LABELS` / `CORE_EVENT_KIND_TABLE`）漏一键 = 静默漂移 | 编译逼补；新 spec §3.1-15 断言三处键集合 == 联合 13 类；交付时 `git diff` 逐条核对                                              |
| T2  | 回归口径漂移：事件类型扩展影响分类输出、审计标签统计、回放；新旧批次不可直接比                                  | 种子 ZERO + 缺省回落 `neutral` 行为；旧 kind 表行数值逐字不动；配置指纹 `stateTransition` 段（D-3 P4）登记，本单不新增配置载体  |
| T3  | 幅度叠加：I-08 仍待批次复验，新 kind 临床幅度若提前落地会与未复验参数叠加、归因不清                             | 种子 ZERO 隔离；草案候选幅度只登记为标定批次候选，不进 core 基础表；I-08 复验与新 kind 标定批次分开排期                         |
| T4  | 隐私：`eventDetails` 被误解为可落原话                                                                           | 只带 kind + 命中词 + 强度；模型轨词明细为空数组；交付前隐私自检；不新增原文落库面                                               |
| T5  | 映射回退：两类提升为 core kind 后，模型吐未知标签的丢弃 / 全丢回落路径被破坏                                    | `mapModelLabels` 未知标签丢弃与全丢 → null 口径不变；spec 覆盖                                                                  |
| T6  | 审议口径：两类被误纳入规则对齐组，影子对比把模型独有标签误算成规则可覆盖                                        | `DELIBERATION_RULE_ALIGNED_TAGS` 不动；注释写明留标定批次评估                                                                   |
| T7  | 中间态误读：交付后 cold 场 BDI 仍零变化（shadow + 种子 ZERO），被误判为「事件拆分无效」                         | 交付记录显式写明：本单落地事件模型与审计词明细；临床行为改善留 `llm_active` 接线独立单 + 标定批次；附 shadow 下快照逐字不变证据 |
| T8  | 出参契约破坏：旧消费端按 `events: kind[]` 读取，新增字段造成类型不兼容                                          | `eventDetails` 可选、旧 `events` 保留；adapter / 前端读取旧字段路径不变；spec 覆盖双字段往返                                    |

## 7. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（CPU / 内存 / Node 版本 / 常驻进程 / 盘读延迟）。

基线（2026-11-12，HEAD `2bf32f0`，D-1 交付实测）：定向 `test/engine-core test/engine-adapters test/quality` = 100 文件 / 1839 例；全量 3171 passed + 4 skipped（3175 例 / 191 文件）/ 73.08s；lint 0 error / 0 warning。

| 闸门            | 命令                                                                      | 判据                                                                            |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0 error                                                                         |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 本单相关文件 0 error（既有 D1-7 债另计，不新增）                                |
| Lint            | `pnpm lint`                                                               | 0 error，记 warning 数                                                          |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 12 例全绿；本单不改该文件                                                       |
| 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 全绿；用例数 ≥ 100 文件 / 1839 例，零丢失 / 零改写（新增 spec 用例单列）        |
| 全量            | `pnpm test`                                                               | 全绿，记总数 / skipped / failed / 墙钟 + 机器状态                               |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | 恰好 §例外声明表 4 个既有文件；多出任何一行即打回；无新增 core 文件 / 具名导出  |
| adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | 只含 §3.1 B / C 清单内文件                                                      |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | 为空                                                                            |
| 隐私自检        | 新增文件 / spec / 观测样本人工过一遍                                      | 无原话、无 prompt 全文、无 `kernelState`、无展示名；`matchedTerms` 仅词表命中词 |

## 8. 交付记录与回写

### 8.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-d2-event-kind-split-implementation-YYYY-MM-DD.md`，含：一句话总结；实际方案 vs 任务单偏差（conventions §2.5）；改动文件清单（core / adapter / 测试分组）；闸门表（命令 / exit code / 真实数字 / 机器状态）；§6 风险逐条处置确认；中间态形态证据（shadow 下快照逐字不变）；审计词明细口径与隐私自检结论；遗留项（临床幅度候选值、阈值、`POSITIVE_EVENTS` 归属、生效轨接线）。

### 8.2 交付回写清单

- [x] 交付记录写到 §8.1 路径 → `completed/phase2.5/phase2.5-d2-event-kind-split-implementation-2026-11-12.md`
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账对应行备注：I-18（neutral 吞两类）事件模型已落地（种子 ZERO，待标定批次赋增量）；I-10（cold 八维全零）现象的结构成因已拆分、行为改善待生效轨 + 标定；I-08 复验状态不改变
- [x] 结构债草案 §4.2 S-2 进度列、§9 D-2 表行同步
- [x] 活清单 `phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 `src/engine-adapters` 实测记录进交付记录
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

## 附录 · D-2 / D-3 / D-4 边界与遗留

- 顺序不可反：D-1 模型轨对照观测（已闭环）→ **D-2 事件拆分（本单）** → D-3 时序权重端口。D-3 硬前置 P1 不新增导出 / 文件、P2 配置走注入端口内核零 env、P3 必须先落地 `cold_absent`、P4 配置指纹 `stateTransition` 段、P5 先定权重与 cap 裁决顺序；D-3 须先出协议评估备忘。
- 本单遗留到标定批次：两类事件 delta 方向 / 幅度 / 权重斜率；缺席连续轮数阈值；`holding_present` 是否进 `POSITIVE_EVENTS`；规则轨词表是否补在场标记条目。
- 本单遗留到独立单：`llm_active` 生效轨接线（含每轮 LLM 往返、成本 / 429 / 熔断评估）；模型轨结果进 `aggregateTurnDelta` 生效路径。
- D-4 cold 模式先验：DOC-2 结论为不建议单独实施，本单不复议。
- 既有根 `tsconfig` 类型债（D1-7，86 文件 396 条）不在本单清理，单独排期。
