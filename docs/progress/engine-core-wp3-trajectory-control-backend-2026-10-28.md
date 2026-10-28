# WP3 · 会话轨迹控制引擎（强覆盖 / 修正 / 触发三模式 + 线性多幕游标）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP3（140–149 行：标准化训练场景可复现，伦理盲盒每次触发点一致）
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架，已交付）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨认知引擎，已交付）、
>       [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)（分层记忆 V1，**已交付并复跑绿：eslint 0 / tsc 0 / jest engine-core 全绿零回归**）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: 引擎内核轨迹策略层（条件判定 + 线性游标推进 + 三模式合成纯函数），无 B 层、无网络、无模型
> 目标读者: 后端；内核命令同 WP0/WP1/WP2，由大炮在 Windows 复跑 `lint` / `tsc` / `jest`
> **状态**: 🟡 待开工（本单为施工依据）

---

## 0. 一句话目标

在 WP1「事件分类 → 状态迁移 → 意图规划」与 WP2 记忆层之上，给内核加一层**会话轨迹控制器（Trajectory Controller）**：一份确定性剧本（script）由若干**按序排列的幕（act/node）**组成，配一个模式（`force_override` 强覆盖 / `weighted_correct` 修正 / `trigger` 触发），用**单向线性游标**逐幕推进，对 BDI 自由规划出的 `Intention` 与快照做「替换 / 加权混合 / 条件激活」三种合成，使**标准化考核与伦理盲盒在同一行为序列下，走到第几幕、命中哪个触发点、最终意图、状态偏移逐轮可复现、不跳幕**。本期只做结构化目标与状态偏移的确定性合成与游标推进，**不写剧本台词、不调 LLM、不生成口语**（口语渲染仍归 WP5）。

> 衔接说明：WP1 的 `turn` 管线固定为 `classify → transitionState → planIntention → save → rememberTurn → openingContext`。**WP3 不重写、不改这条管线**，只在 `planIntention` 之后、`save` 之前插入一个轨迹步：先让 BDI 自由产出 `Intention` 与 `nextSnapshot`，再由轨迹推进器定「本轮激活哪一幕、游标是否前进」，交合成器产出「最终 `Intention` + 叠加后快照」，其余原样。未注入剧本（`openSession` 不传 `trajectory`）时，本轮行为与 WP1/WP2 **逐字一致**（零回归硬要求）。

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. **剧本类型模型（纯 TS，不落库）**：`TrajectoryScript`（元数据 + 按序幕序列 + 完成判定 + 全局异常分支）、`TrajectoryNode`（幕：进入条件 trigger + 行为目标 target + 一次性状态偏移 delta + 幕序 order + 参考要点）、`TrajectoryTrigger`（四类可判定原子条件，AND 组合）、三模式枚举。
2. **原子条件判定纯函数 `evaluateTrigger`**：把一个幕的 `trigger`（事件 / 关键词 / 轮次 / 快照谓词）对照本轮上下文判定为布尔值；确定性、无随机、无 IO，供推进器复用。
3. **线性游标推进纯函数 `planAct`**：持有当前游标 `cursor`，按模式决定「本轮激活哪一幕、游标是否前进、是否进入异常分支」，输出 `ActPlan`；单向推进、不回退、不跳幕。
4. **三模式合成纯函数 `applyTrajectory`**：
   - `force_override` 强覆盖：幕 target 有值字段**替换** BDI `Intention`；`forbiddenBehaviors` 取并集；**仅在进入新幕那一轮**叠加 delta。
   - `weighted_correct` 修正：`strategy` 取 target（缺省回退 BDI）；数值类字段按权重 `w`（默认 0.6）做 `w*target + (1-w)*bdi` 混合后 clamp；命中幕叠加 delta。
   - `trigger` 触发：平时 BDI 自由运行（游标之前的幕不触发），命中 `order >= cursor` 的幕才按强覆盖激活；未命中原样透传。
5. **状态偏移叠加**：幕 delta 对 trust / 三维阻抗 / 情绪双轴 / 移情三态做**一次性增量**叠加，统一复用 WP1 的 `clamp01 / clampValence / resolveEmotionLabel`，不新造 clamp。
6. **完成 / 异常判定**：全局 `abort` 优先；`completion.when` 命中写 `completed`，`abort` 命中写 `aborted`；**不自动 closeSession**，关闭仍由编排/适配器决定；终态后不再推进、不再叠加。
7. **端口向后兼容追加**：`OpenEngineSessionInput` 加可选 `trajectory?: TrajectoryScript`；`EngineTurnOutput` 加可选 `trajectoryTrace?: TrajectoryTrace`（含当前游标）；三方法签名与既有 DTO 不破坏。
8. **运行时挂载（内存实现）**：`InMemoryEngineSession` 在持有剧本时维护「游标 cursor / 已激活幕集合 / 终态」（均为进程瞬时、不落库），turn 内插入轨迹步；无剧本时走原路径。
9. 单测覆盖三模式合成、四类条件、游标步进与等待、不跳幕、delta 一次性、abort 优先、完成判定、无剧本零回归、隔离。

### 1.2 明确不做（Out of Scope，后期再入）

| 不做项 | 归属 |
|---|---|
| 剧本台词 / 来访口语渲染、按幕逐句念白、TTS 串接 | WP5 |
| 调 LLM 生成剧本、改写 target、润色参考要点 | WP5 / 模型轨 |
| 剧本落 MySQL / Qdrant、剧本 CRUD、运营后台、UGC 剧本提交审核流 | Phase2（母版明确不做 UGC 审核） |
| 可视化剧本编辑器、DSL、**分支图（if/else 跳转、子图、回环、并行幕）**、跳幕判不合格的考核评分 | Phase2 |
| 游标 / 终态的**跨进程持久化**、暂停/恢复/归档落盘（本期游标仅进程内存） | 后期（装配/持久化轮） |
| 修正模式的策略层概率混合（strategy 本期只替换或回退，不做概率混合） | 模型轨 |
| 把 `src/counselor/drills/`（单轮关键词考点训练）迁入内核或合并 | 见 §1.3，两套并列体系 |
| 轨迹接进 `app.module.ts` / WS / HTTP 端点（装配另轮） | 装配轮 |

### 1.3 与现有 `counselor/drills` 的关系（重要，别搬错）

`src/counselor/drills/`（boundary 边界压力 / crisis 危机识别）是**单节点、单轮、确定性关键词判定、零压批注、不落库**的并列轻量考点模块，对外契约是 `drillId / requiredPoints / verdict`。本期 **WP3 轨迹引擎建在 `engine-core/` 内，服务完整多轮对练 / 伦理盲盒**，二者是并列关系：

- **不迁移** drills 的脚本到内核，**不合并**两套类型，**不改** drills 的 DTO 与判定。
- WP3 的 `TrajectoryScript` 是内核侧「多幕结构化目标编排」，与 drills 的「单轮考点命中」是不同抽象层；后期若要让伦理盲盒复用 drills 的考点锚点，由编排层桥接，不在本期。

---

## 2. 边界红线（继承 WP0/WP1/WP2，继续生效）

- `src/engine-core/` 整树**零** `@nestjs/*`、零 `typeorm`、零逃出本目录的相对 import、零 NestJS 装饰器；新增第三方依赖仍仅限 `{ nanoid }` + `node:*`。本期**不新增任何第三方包**（纯函数，nanoid 都用不上也可以不引）。
- 端口方法签名**不破坏**：`openSession / turn / closeSession` 三方法名、同步/异步形态、既有返回形态不变；入参/出参/DTO **只追加可选字段**。
- 内核不读数据库、不发网络、不调模型；剧本由 adapter 解析后作为纯对象注入，内核不感知剧本实体如何存储；游标/终态不落库。
- 测试仍放 `test/engine-core/`，直接 `new` 内存实现跑，不启动 NestJS 容器；本期无 B 层，不建 `test/engine-adapters/` 新用例。

> ⚠️ `test/engine-core/boundary.spec.ts` 的公开面白名单（断言⑥ `expectedPublic`）与目录清单（断言⑦ `expected`）是**硬编码**。本期新增公开导出 / 新文件后，**必须同步更新这两个断言**，不得删断言、不得改断言绕过去。

---

## 3. 目录落点

### 3.1 内核层（`src/engine-core/`，纯 TS，零框架）

```
src/engine-core/
├── domain/
│   ├── trajectory/
│   │   └── script.ts                 【新】模式枚举 + 剧本/幕/触发条件/target/delta/完成/异常/出参 trace 全部类型
│   └── engine-session.types.ts       【改】OpenEngineSessionInput 加可选 trajectory；EngineTurnOutput 加可选 trajectoryTrace
├── cognition/
│   └── trajectory/                   【新目录】轨迹纯策略算子（无状态、无 IO、无随机）
│       ├── trigger-evaluate.ts       【新】evaluateTrigger：单条触发条件对照上下文判布尔
│       ├── act-cursor.ts             【新】planAct：线性游标推进 + 选幕 + abort 判定，输出 ActPlan
│       └── trajectory-applier.ts     【新】applyTrajectory：三模式合成 finalIntention + 叠加快照
├── in-memory/
│   └── in-memory-engine-session.ts   【改】持有 script / cursor / activatedOrders / 终态；turn 在 planIntention 后插轨迹步
└── index.ts                          【改】导出新增类型/纯函数（同步 boundary 白名单）
```

> 说明：游标 `cursor`、已激活幕集合、终态都是进程内瞬时状态，本期挂在 `EngineSessionRuntime` 上，**不落库**；条件判定 / 游标推进 / 合成全部抽成无状态纯函数放 `cognition/trajectory/`，便于单测，运行时只负责喂上下文、记游标与已激活集合。

### 3.2 B 层

本期**无 B 层**：剧本不存 Qdrant、不接 embedding、不做网络。复用 WP2 的 `src/engine-adapters/` 现有文件不动。

---

## 4. 类型契约（可直接施工）

### 4.1 模式枚举与剧本（`domain/trajectory/script.ts`，新）

```ts
/**
 * 轨迹控制模式.
 * - force_override  强覆盖: 标准化考核 / 伦理盲盒, 来访严格按幕推进, BDI 输出被替换.
 * - weighted_correct 修正: 专项训练包, 主线不偏但保留 BDI 灵活度, 数值加权混合.
 * - trigger         触发: 平时 BDI 自由运行, 走到该幕且满足条件才激活 (隐藏伦理坑 / 突发危机).
 */
export type TrajectoryMode = 'force_override' | 'weighted_correct' | 'trigger';

/** 触发条件原子 (同一幕内各原子 AND; 跨原子 OR 用多幕表达). */
export interface TrajectoryTrigger {
  /** 咨询师事件命中任一即满足 (复用 CounselorEventKind: empathy/judgment/boundary_cross/...). */
  readonly onEvents?: readonly CounselorEventKind[];
  /** 咨询师本轮文本小写子串命中任一即满足. */
  readonly onKeywords?: readonly string[];
  /** 到达该轮次 (turnIndex >= afterTurns) 即满足. */
  readonly afterTurns?: number;
  /** 快照谓词, 列出项全部满足即满足 (未列项不约束). */
  readonly state?: {
    readonly minTrust?: number;
    readonly maxTrust?: number;
    readonly minResistanceAgg?: number; // 三维阻抗均值 (verbal+depth+style)/3 的下界
    readonly maxResistanceAgg?: number;
    readonly emotionLabel?: EmotionLabel; // 与当前 resolveEmotionLabel 结果相等
  };
}

/** 幕行为目标: 有值的字段参与合成, 缺省字段回退/透传 (按模式定). */
export interface TrajectoryNodeTarget {
  readonly strategy?: BehaviorStrategy;
  readonly emotion?: Partial<EmotionState>;            // 显式给 label 沿用, 否则由双轴重算
  readonly resistance?: Partial<BdiResistance>;
  readonly transference?: Partial<TransferenceState>;
  readonly forbiddenBehaviors?: readonly string[];
}

/** 幕状态偏移量: 仅在「进入新幕那一轮」一次性增量叠加 (不是覆盖, 不重复滚). */
export interface SnapshotDelta {
  readonly trust?: number;
  readonly resistance?: Partial<BdiResistance>;
  readonly emotion?: { readonly valence?: number; readonly arousal?: number };
  readonly transference?: Partial<TransferenceState>;
}

/**
 * 单个幕 (线性序列中的一步).
 * - order: 幕序, 缺省取数组下标; 全剧本内唯一, 游标按它单向推进.
 * - trigger: 进入/激活本幕的条件 (force 模式=推进条件; weighted/trigger 模式=激活条件).
 * - delta: 只在本幕被推进进入那一轮叠加一次; force 等待轮不重复叠加.
 */
export interface TrajectoryNode {
  readonly nodeId: string;
  /** 幕序 (缺省=数组下标), 唯一, 游标据此推进. */
  readonly order?: number;
  readonly trigger: TrajectoryTrigger;
  readonly target?: TrajectoryNodeTarget;
  readonly delta?: SnapshotDelta;
  /** 修正模式下本幕目标权重 w∈(0,1], 缺省 DEFAULT_CORRECT_WEIGHT=0.6; 强覆盖/触发忽略. */
  readonly correctWeight?: number;
  /** 激活后只保留给督导/WP5 的结构化参考要点, 不是台词, 不渲染. */
  readonly referenceNotes?: readonly string[];
}

/** 正常完成判定: 条件命中即落 completed; 不自动关闭会话. */
export interface TrajectoryCompletion {
  readonly when: TrajectoryTrigger;
  readonly outcome: 'completed';
}

/** 一份确定性剧本 (adapter 解析后注入, 内核不关心存储). */
export interface TrajectoryScript {
  readonly scriptId: string;
  readonly title: string;
  readonly mode: TrajectoryMode;
  /** 难度 1/2/3 (仅排序/展示, 不参与决策). */
  readonly difficulty: 1 | 2 | 3;
  /** 训练目标一句话 (观测用, 不口语). */
  readonly goal: string;
  /** 按序幕序列 (order 缺省=下标). */
  readonly nodes: readonly TrajectoryNode[];
  readonly completion: TrajectoryCompletion;
  /** 全局异常分支: 每轮最先判定, 命中即 aborted 并停止推进 (如危机恶化 / 严重越界). 省略=无异常分支. */
  readonly abort?: TrajectoryTrigger;
}
```

### 4.2 出参 trace（`domain/trajectory/script.ts`，新）

```ts
/** 本轮轨迹观测块 (纯督导/WP5 观测, 不含口语). */
export interface TrajectoryTrace {
  readonly scriptId: string;
  readonly mode: TrajectoryMode;
  /** 本轮是否有幕被激活/施加. */
  readonly activated: boolean;
  /** 本轮实际处理的幕 id (等待轮也可能是当前幕; 无则省略). */
  readonly activeNodeId?: string;
  /** 本轮游标是否前进到下一幕. */
  readonly advanced: boolean;
  /** 处理后的游标 (下一个待进入幕的 order), 供督导看剧本走到哪. */
  readonly cursor: number;
  /** 已激活过的幕 id 清单 (含本轮), 供督导看推进轨迹. */
  readonly visitedNodeIds: readonly string[];
  /** 终态 (命中 completion.when / abort 时携带), 只写一次. */
  readonly outcome?: 'completed' | 'aborted';
}
```

### 4.3 端口 DTO 追加（`domain/engine-session.types.ts`，全部可选）

```ts
// OpenEngineSessionInput 追加:
/** 轨迹剧本 (WP3). 省略 = 无轨迹约束, 行为与 WP1/WP2 完全一致. */
readonly trajectory?: TrajectoryScript;

// EngineTurnOutput 追加:
/** 本轮轨迹观测 (仅注入了剧本的会话携带). */
readonly trajectoryTrace?: TrajectoryTrace;
```

### 4.4 纯函数签名（`cognition/trajectory/`）

```ts
// trigger-evaluate.ts
/** 本轮匹配上下文 (由 in-memory session 喂入, 纯函数不读运行时). */
export interface MatchContext {
  readonly events: readonly SessionEvent[];
  readonly userText: string;          // 咨询师本轮文本 (小写化在函数内做)
  readonly turnIndex: number;
  readonly snapshot: BdiSnapshot;
}

/** 单条触发条件对照上下文判布尔 (AND 组合); 纯函数, 无 IO. */
export function evaluateTrigger(trigger: TrajectoryTrigger, ctx: MatchContext): boolean;

// act-cursor.ts
/** 推进器本轮决策结果. */
export interface ActPlan {
  /** 本轮要合成的幕; 无 (trigger/weighted 未命中、abort) 时为 null → 透传 BDI. */
  readonly node: TrajectoryNode | null;
  /** 是否进入新幕 (true 时叠加 delta; force 等待轮为 false, 不重复叠加). */
  readonly enterNewAct: boolean;
  /** 推进后的游标 (下一幕 order); 未前进则等于入参 cursor. */
  readonly nextCursor: number;
  /** 本轮是否命中全局异常分支. */
  readonly aborted: boolean;
}

/**
 * 线性游标推进 (纯函数, 不改入参, 无随机).
 * @param script 剧本
 * @param cursor 当前游标 (下一个待进入幕的 order, 初始 0)
 * @param ctx 本轮上下文
 * @param activatedOrders 已激活过的幕 order 集合 (观测/去重)
 */
export function planAct(
  script: TrajectoryScript,
  cursor: number,
  ctx: MatchContext,
  activatedOrders: ReadonlySet<number>,
): ActPlan;

// trajectory-applier.ts
/** 三模式合成结果. */
export interface TrajectoryApplication {
  readonly intention: Intention;
  /** 叠加后的快照 (已 clamp, 已重算 emotion.label); enterNewAct=false 时不叠 delta. */
  readonly snapshot: BdiSnapshot;
  readonly activated: boolean;
}

/**
 * 按模式把 BDI 自由规划结果与本轮幕合成.
 * @param mode 剧本模式
 * @param bdi  planIntention 产出的原始 Intention
 * @param baseSnapshot transitionState 后的快照
 * @param plan planAct 产出的 ActPlan (node 为空 → 透传 BDI; enterNewAct 决定是否叠 delta)
 */
export function applyTrajectory(
  mode: TrajectoryMode,
  bdi: Intention,
  baseSnapshot: BdiSnapshot,
  plan: ActPlan,
): TrajectoryApplication;
```

### 4.5 剧本校验（`domain/trajectory/script.ts`，纯函数）

```ts
/**
 * 开工前校验剧本形状; 非法抛 EngineCoreError(INVALID_INPUT), 供 openSession 复用.
 * 校验项: scriptId 非空串; mode 合法; nodes 为数组(可空); 每幕 nodeId 非空且 order 唯一;
 * completion.when 存在; correctWeight 若给则 clamp 到 (0,1] 而非抛错(见 §6).
 */
export function validateTrajectoryScript(script: TrajectoryScript): void;
```

---

## 5. 游标与三模式语义（实施中不反复）

### 5.1 原子条件判定（`evaluateTrigger`）

一幕的 `trigger` **全部已声明原子都满足**才算命中（AND）：

| 原子 | 判定 |
|---|---|
| `onEvents` | 本轮 `events` 的 `kind` 与列表有交集即满足（命中任一） |
| `onKeywords` | `userText.toLowerCase()` 包含任一关键词小写子串即满足（trim 后判空跳过） |
| `afterTurns` | `ctx.turnIndex >= afterTurns` |
| `state.minTrust/maxTrust` | `snapshot.trust` 落在闭区间 |
| `state.minResistanceAgg/maxResistanceAgg` | `(verbal+depth+style)/3` 落在闭区间 |
| `state.emotionLabel` | `snapshot.emotion.label` 与给定值相等 |

- 未声明的原子不参与判定（不是"必须为空"）。
- `abort` 与 `completion.when` 复用同一 `evaluateTrigger`。

### 5.2 线性游标推进（`planAct`）

幕按 `order`（缺省=数组下标）升序排成单向序列；运行时 `cursor` 指向「下一个待进入幕」，初始 0，**只增不减、不跳幕、不回退**。每轮顺序：

1. **先判全局 `abort`**：`evaluateTrigger(script.abort, ctx)` 命中 → 返回 `{ node:null, enterNewAct:false, nextCursor:cursor, aborted:true }`，运行时落终态 `aborted`，本轮透传 BDI。
2. 按模式选幕：
   - **`force_override`**：取 `order === cursor` 的当前幕。
     - 其 `trigger` 满足 → `node=该幕, enterNewAct=true, nextCursor=cursor+1, advanced`。
     - 不满足 → `node=该幕（等待轮，持续施加其 target 基调）, enterNewAct=false, nextCursor=cursor`（**不叠加 delta**）。
     - 游标已越过末幕（无 order===cursor）→ `node=null, enterNewAct=false, nextCursor=cursor`。
   - **`weighted_correct` / `trigger`**：只在 `order >= cursor` 的幕里按 `evaluateTrigger` 匹配，取**首个命中**（升序）。
     - 命中 → `node=该幕, enterNewAct=true, nextCursor=该幕.order+1`（关闭前面的幕，禁止回头）。
     - 未命中 → `node=null, enterNewAct=false, nextCursor=cursor`（BDI 自由运行）。
3. 终态（aborted 或 completed）之后：`planAct` 恒返回 `node=null, enterNewAct=false`，不再推进、不再叠加。

> 持续施加与一次性 delta 的关键区别：force 等待轮 `enterNewAct=false`，target 每轮持续替换以保持当前幕基调，但 **delta 只在 `enterNewAct=true` 那一轮叠加一次**，避免等待轮把信任/阻抗反复滚高。

### 5.3 `force_override` 强覆盖合成（`applyTrajectory`）

- `plan.node` 为空 → 透传 BDI（终态/越过末幕）。
- `target.strategy` 有值 → 替换 BDI `strategy`；缺省 → 保留 BDI。
- `target.emotion` 有值字段替换 `bdi.emotion`：显式给了 `label` 则沿用；只给 `valence/arousal`（或给了双轴未给 label）时，label 由双轴 `resolveEmotionLabel` 重算，不沿用旧 label。
- `target.resistance / target.transference` 有值子字段替换。
- `target.forbiddenBehaviors` 与 `bdi.forbiddenBehaviors` **并集**（去重，不丢弃 BDI 原有禁止项）。
- `delta`：**仅 `enterNewAct=true` 时**叠加（§5.5）；等待轮不叠加。
- `activated=true`。

### 5.4 `weighted_correct` 修正合成

- `plan.node` 为空（未命中）→ 透传 BDI，`activated=false`。
- `target.strategy` 有值 → 取 target；缺省 → 保留 BDI（**不做策略概率混合**）。
- 数值字段按 `w = clamp01(node.correctWeight ?? DEFAULT_CORRECT_WEIGHT=0.6)` 混合：
  `outcome = w*targetValue + (1-w)*bdiValue`，再 `clamp01`（情绪 valence 用 `clampValence`）。
  覆盖字段：`emotion.valence / emotion.arousal`、`resistance.verbal/depth/style`、`transference.positive/negative/dependency`。
  target 未给的数值字段保留 BDI 原值。
- `emotion.label` 混合后由双轴重算。
- `forbiddenBehaviors` 取并集（同强覆盖）。
- `enterNewAct=true` 时叠加 delta。
- `activated=true`。

### 5.5 `trigger` 触发合成

- `plan.node` 为空（`order >= cursor` 无命中）→ **原样返回 BDI `Intention` 与原快照**，`activated=false`，不叠加任何 delta。
- 命中幕 → 按 **§5.3 强覆盖语义**激活（替换 + 并集 + 进入新幕叠加 delta），`activated=true`。
- 设计理由：触发模式的价值是"平时自由、踩坑才出手"，出手那一下要足够明确，避免修正的柔化让隐藏伦理坑的信号被稀释。

### 5.6 状态偏移叠加（仅 `enterNewAct=true`，三模式共用）

`delta` 对快照做**一次性增量**（不是覆盖）：

- `trust = clamp01(base.trust + (delta.trust ?? 0))`
- `resistance.{verbal,depth,style} = clamp01(base + delta 对应项 ?? 0)`
- `transference.{positive,negative,dependency} = clamp01(base + delta 对应项 ?? 0)`
- `emotion.valence = clampValence(base + delta.emotion.valence ?? 0)`；`emotion.arousal = clamp01(...)`；`label = resolveEmotionLabel(valence, arousal)`
- 信念层（core/temporary/memoryBeliefs、underlying/situationalDesires）**本期不动**，原样透传（信念演进属后续认知轮）。

### 5.7 完成 / 异常判定

每轮 `planAct` 之后：

1. `abort` 命中（`plan.aborted`）→ 终态 `aborted`，游标冻结，不调 `closeSession`。
2. 否则 `evaluateTrigger(script.completion.when, ctx)` 命中 → 终态 `completed`。
3. 终态只写一次进 `trajectoryTrace.outcome`；终态后后续轮次 BDI 自由运行、不再推进/叠加；**内核不自动 closeSession**（关闭含收尾记忆晋升、报告生成，属编排/传输层）。

### 5.8 管线插入位置（`in-memory-engine-session.turn`）

```
loadState → classify → transitionState → planIntention(bdi)
         → [有剧本] planAct(cursor, ctx) → applyTrajectory(mode, bdi, snapshot, plan)
         → 得 finalIntention / 叠加后快照; 推进 cursor / 记 activatedOrders / 落终态
         → save(用叠加后快照) → rememberTurn → openingContext
         → 出参挂 trajectoryTrace
```

无剧本（`runtime.trajectory` 为空）时跳过本步，`finalIntention=bdi`、快照不变、游标不出现，其余与 WP1/WP2 完全一致。

---

## 6. 软降级与容错

| 场景 | 行为 |
|---|---|
| `openSession` 传入非法剧本（scriptId 空 / nodes 非数组 / order 重复 / completion 缺 when） | 抛 `EngineCoreError(INVALID_INPUT)`，校验集中在 `validateTrajectoryScript` |
| 幕 `correctWeight` 越界（≤0 或 >1） | clamp 到 (0,1]，不抛（工程宽容，避免一条脏配置炸整场） |
| `onKeywords` 含空串 / 全空白 | 该原子跳过（不视为命中），不抛 |
| `state` 谓词区间倒挂（min>max） | 该谓词不满足（安全方向：不触发/不推进），不抛 |
| force 当前幕 trigger 长期不满足 | 停在该幕等待，持续施加 target 基调，不强行跳幕、不报错 |
| weighted/trigger 全程未命中 | 透传 BDI，`activated=false`，正常出参 |
| 终态后继续发轮次 | outcome 只写一次，游标冻结，BDI 自由运行，不再叠加 |
| 幕缺省 order | 取数组下标；校验时补齐为唯一序 |

---

## 7. 异常与边界

| 场景 | 行为 |
|---|---|
| 无 `trajectory` 注入 | 整条 turn 与 WP1/WP2 逐字一致（零回归硬要求） |
| 跳幕 | 禁止：weighted/trigger 只匹配 `order >= cursor`，已过幕不再回头；force 只看 `order===cursor` |
| force 等待轮 | target 持续施加但 delta 不重复叠加（避免滚累积） |
| 同轮多幕命中（weighted/trigger） | 只取升序首个，其余不叠加、不推进 |
| abort vs completion | abort 每轮最先判，命中即 aborted，不再判 completed |
| 跨租户 / 跨会话 | 剧本与游标随句柄实例持有，不跨句柄共享；不串场 |
| 数值 NaN | 混合/叠加结果 NaN 时回落 clamp 边界（0 或 valence 0），不向快照写 NaN |
| 信念/愿望层 | 全程透传，轨迹不改写 |

---

## 8. 单测清单（`test/engine-core/wp3-trajectory.spec.ts`，纯内存）

1. **强覆盖替换**：幕给 `strategy/emotion/resistance/transference/forbiddenBehaviors`，合成结果对应字段被替换，`forbiddenBehaviors` 与 BDI 并集去重。
2. **强覆盖缺省回退**：幕只给部分字段，未给字段保留 BDI。
3. **修正加权**：`w=0.6` 时数值字段等于 `0.6*target+0.4*bdi`，clamp [0,1] / valence[-1,1]；`strategy` 缺省回退 BDI；`correctWeight` 越界被 clamp。
4. **触发未命中透传**：`trigger` 模式无命中幕，返回 BDI 原 intention、原快照，`activated=false`，无 delta。
5. **触发命中激活**：命中幕按强覆盖替换 + 进入新幕叠加 delta，`activated=true`，游标前进。
6. **原子条件**：`onEvents` 交集命中/不命中；`onKeywords` 小写子串（大小写、空白）；`afterTurns` 边界（等于/小于）；`state` 各谓词（trust 区间、resistanceAgg、emotionLabel）；多原子 AND 缺一不命中。
7. **force 游标步进**：当前幕 trigger 满足 → `enterNewAct=true`、`nextCursor=cursor+1`、delta 叠加一次；不满足 → `enterNewAct=false`、游标不动、target 持续施加但 **delta 不叠加**。
8. **不跳幕**：weighted/trigger 中 `order < cursor` 的已过幕即使条件命中也不激活；游标只增不减。
9. **一次性 delta**：同一幕不被叠加两次；等待轮、终态轮均无额外 delta。
10. **abort 优先**：同一轮 abort 与 completion.when 同时满足 → 落 `aborted`，且 abort 后不再推进/叠加。
11. **完成判定**：`completion.when` 命中 → trace.outcome=completed 且只写一次；未命中省略 outcome；不自动 close。
12. **无剧本零回归**：不传 `trajectory`，turn 产出的 intention/snapshot/turnIndex 与 WP1 路径一致，出参无 `trajectoryTrace`。
13. **非法剧本**：缺 scriptId / completion.when / order 重复 → `INVALID_INPUT`。
14. **同轮多幕命中**：weighted/trigger 只取升序首个，其余不叠加、不推进。

---

## 9. 验收清单（逐条可勾选）

- [ ] `npx tsc -p tsconfig.build.json --noEmit` 0 错。
- [ ] `npx eslint "src/**/*.ts"` 0 error（新文件遵守既有 complexity / prettier / import-order）。
- [ ] `npx jest test/engine-core` 全绿；**WP0/WP1/WP2 既有 engine-core 用例零回归**（WP2 的 engine-adapters 用例本期不动，复跑 `npx jest test/engine-adapters` 仍绿即可）。
- [ ] `boundary.spec.ts` 全绿：内核整树零 `@nestjs`/`typeorm`；本期新增导出已进断言⑥白名单、新文件已进断言⑦目录清单（双向比对不漏不多）。
- [ ] 同一剧本 + 同一行为序列，重复两轮模拟，游标位置、激活幕、finalIntention、叠加后快照逐轮一致（确定性可复现）。
- [ ] 游标单向推进、不跳幕、不回退；force 等待轮不重复叠加 delta。
- [ ] 三模式行为差异可观测：强覆盖替换 / 修正混合 / 触发未命中透传。
- [ ] abort 优先于 completion；终态写 trace 但不自动 closeSession。
- [ ] 本期零口语、零 LLM 调用、零 migration/entity/新表、零 `.env` 改动、零新第三方依赖、游标不落库。
- [ ] 未改动 `src/counselor/drills/` 任何文件。

---

## 10. 交付闸门（大炮在 Windows 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
```

**新增 env 开关**：无。本期纯内核策略，不新增 `.env` 项、不接 Qdrant/embedding。

---

## 11. 关键决策记录（已定，实施中不反复）

| # | 决策 | 理由 / 备选 |
|---|---|---|
| M1 | 轨迹步插在 `planIntention` 之后、`save` 之前，不改三方法签名 | 守契约稳定；BDI 自由规划永远先发生，轨迹只做后处理，便于开关对比与回退 |
| M2 | 三模式差异只落在 `applyTrajectory` 合成语义，选幕统一走 `planAct` | 避免三套选幕逻辑双胞胎；模式是"怎么合成"，游标/选幕是公共骨架 |
| M3 | 触发模式命中后按强覆盖激活，而非修正 | 隐藏伦理坑/突发危机出手要信号明确，柔化会稀释触发价值 |
| M4 | **本期做线性游标 V1**：order 升序、单向只增、不跳幕不回退；force 看当前幕、weighted/trigger 只在 `order>=cursor` 匹配 | 满足标准化考核/盲盒"按幕走、可复现"；子图/回环/并行/跳幕评分属状态机复杂度，留 Phase2 |
| M5 | delta 一次性叠加（仅 enterNewAct），force 等待轮只持续施加 target 基调 | 防止等待轮把信任/阻抗反复滚高；基调保持但状态不漂移 |
| M6 | 触发条件本期只做 AND，OR 用多幕表达 | 不上 DSL、不上表达式引擎，纯函数可测；OR 自然展开为多个同效幕 |
| M7 | delta 是增量叠加，信念/愿望层透传 | 轨迹控制情绪/阻抗/移情/信任即可影响来访表现；信念演进属后续认知轮，本期不动 |
| M8 | 剧本作为纯对象经 `openSession.trajectory` 注入，不落库；游标/终态仅进程内存 | 守"内核不感知存储"，落库/CRUD/审核/游标持久化留 Phase2 |
| M9 | abort 全局优先于 completion，终态冻结推进 | 异常分支先于正常结束判定；终态后不叠加避免终态轮漂移 |
| M10 | 完成/异常只写 outcome，不自动 close | 关闭是编排/传输层职责（含收尾记忆晋升、报告生成），内核不越权 |

### 待大炮过目（不阻塞开工，有异议再调）

- `DEFAULT_CORRECT_WEIGHT=0.6` 是工程种子值（幕目标占六成、BDI 占四成），非临床标定，后期靠训练数据校准，集中为常量便于调。
- 本期是否内置 **1 条确定性伦理盲盒样例剧本**供复现测试：建议至少在单测里内联构造一条（不进生产静态配置）；若要一条可被 adapter 直接加载的样例，放后期剧本装配轮，避免本期混入内容运营。
- force 等待轮"持续施加 target"是为保持当前幕基调；若某幕纯过渡（无 target），等待轮自然回退 BDI，无害。

---

## 12. 下一步（本期不做，另起任务单）

1. **WP2 遗留补漏（与 WP3 无关，单独成单，勿并入本期）**：
   1. Qdrant 写侧冲突标记：给 `QdrantService` 补 `setPayload` 与按 filter 的 scroll 取点能力，实现内核已就位的 `resolveConflict/applyConflictResolution` 在向量库内原地标记（基建改动）。
   2. 短时记忆自动写入路径 + 会话结束编排层接线（调 `promoteShortTermToLongTerm` 异步落长时）。
   3. 衰减半衰期 30 天 / 阈值 0.1 的真实数据标定。
2. WP4 伦理安全引擎（危机升级阈值、安全兜底、强制转介信号）。
3. WP5 渲染接线：消费最终 `Intention` + 幕 `referenceNotes` 生成来访口语，填值 `reply=''`。
4. Phase2：剧本落库/CRUD、可视化编辑器、**分支图/回环/并行幕/跳幕评分的高级状态机**、游标跨进程持久化、UGC 审核流、修正模式策略层概率混合。

---

## 13. 交付状态

（待后端交付后回写：闸门结果、与本单差异、已知缺口。）
