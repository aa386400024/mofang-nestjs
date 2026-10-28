# WP1 · BDI 认知引擎（规则轨 · 先决策后说话）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP1（114–125 行）
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（内核边界骨架，已交付）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: 引擎内核纯 TS 算法层（不接线、不触框架）
> 目标读者: 后端；做完由大炮在 Windows 复跑 `build` / `test`（内核命令同 WP0）

---

## 0. 一句话目标

在 WP0 的 `BdiSnapshot` + `turn` 管线里，把咨询师本轮文本**先分类成标准会话事件 → 再用确定性算子推进信念/愿望/情绪/阻抗/移情/信任 → 最后产出本轮结构化意图**，让来访从"prompt 直接扮演"变成"先决策、后说话"。**本期只做规则轨（关键词/正则硬规则兜底），不接 LLM，不渲染口语，不接线。**

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. 把 WP0 快照里 5 个 `unknown` 占位槽位（beliefs / desires / intention / emotion / transference）+ 新增的 `trust` 落地为**具体只读类型**，并把 `resistance` 从可空改为总有基线。
2. 规则轨**事件分类器**：咨询师文本 → 标准 `SessionEvent[]`（纯函数，关键词/正则词典，无随机）。
3. **状态迁移算子**：事件 → 信任 / 三维阻抗 / 情绪（valence+arousal）/ 移情三态的确定性增减，统一 clamp。
4. **意图规划器**：从当前状态推导出本轮结构化 `Intention`（行为策略 + 情绪 + 阻抗 + 移情 + 禁止行为），作为 `turn` 出参；**不生成任何口语**。
5. **角色内核注入**：`openSession` 新增可选 `characterProfile`，全新会话据此装配初始状态基线；内核不读 MySQL / persona 实体。
6. 规则轨双轨**接口位**：`EventClassifier` 抽象成可替换接口，规则实现注入；模型微调轨只留接口与注释，本期不实现、不调模型。
7. 可复现性：同一 profile + 同一文本序列，两次跑逐轮快照深比较相等（无 `Math.random`、无墙钟扰动，`now` 已可注入）。
8. 单测覆盖正向/负向/触发事件、clamp、默认基线、可复现、意图结构、角色注入。

### 1.2 明确不做（Out of Scope，后期 WP 再入）

| 不做项 | 归属 |
|---|---|
| 调用 LLM / 模型微调轨 / 情绪大模型，任何 HTTP 到模型服务 | 后续模型轨，本期只留接口 |
| 渲染来访口语 / TTS / WS / 对接旧 `src/agent/visitor/` 链路 / NestJS 装配（B 层） | WP5 / 接线轮 |
| 长时记忆召回、记忆摘要、向量检索、跨会话语义接续 | WP2 |
| 会话剧本轨迹、三模式覆盖、伦理盲盒触发点 | WP3 |
| 危机/伦理检测器、风险分级 | WP4 |
| 多流派差异化参数、情绪复杂动力学（疲劳/转移/累积衰减）、情绪自由标签 | Phase2 / 后续 |
| 新增表/列/migration、改 `.env`、改既有 entity / module / 端点 | 本期零存储改动 |
| 从来访自己的输出反推阻抗/情绪（循环论证：来访输出是 WP5 渲染结果） | 架构原则，见 §4.4 |

---

## 2. 边界红线（继承 WP0，继续生效）

- `src/engine-core/` 整树**零** `@nestjs/*`、零 `typeorm`、零逃出本目录的相对 import、零 NestJS 装饰器。
- 第三方依赖白名单仍是 `{ nanoid }` + `node:*`；**WP1 不得新增任何第三方包**（规则词典是纯 TS 常量，不需要 NLP 库）。
- 端口方法签名**不破坏**：`openSession` / `turn` / `closeSession` 三个方法名与返回形态不变；只给入参/出参**追加可选字段**（向后兼容）。
- 内核不读数据库、不读 persona 实体、不发网络请求；角色数据由 adapter 解析成 `characterProfile` 纯对象后传入。
- 测试仍放 `test/engine-core/`，直接 `new` 内存实现跑，不启动 NestJS 容器。

> ⚠️ `test/engine-core/boundary.spec.ts` 的公开面白名单（断言⑥）与目录清单（断言⑦）是**硬编码**的。本期新增导出/新文件后，**必须同步更新这两个断言**，而不是删断言绕过它。这是刻意的摩擦，用来防止公开面悄悄膨胀。

---

## 3. 目录落点（在现有内核包内新增子目录）

```
src/engine-core/
├── domain/
│   ├── bdi-snapshot.ts            【改】落地具体类型 + 新增 trust；createEmpty/clone 同步重写
│   ├── beliefs.ts                 【新】核心/短期/记忆信念类型
│   ├── desires.ts                 【新】底层/情境愿望类型
│   ├── emotion.ts                 【新】情绪标签枚举 + EmotionState(valence/arousal)
│   ├── transference.ts            【新】移情三态强度
│   ├── intention.ts               【新】本轮 Intention（五字段，派生输出，不存快照）
│   ├── character-profile.ts       【新】角色内核注入 schema（初始基线/禁止行为/敏感议题）
│   └── events/
│       ├── session-event.ts       【新】事件种类枚举 + SessionEvent + EventClassifier 接口
│       └── event-lexicon.ts       【新】规则词典（正向/负向/触发关键词与正则，纯常量）
├── cognition/                     【新】认知算子（纯函数层，无状态）
│   ├── rule-based-classifier.ts   【新】EventClassifier 的规则实现
│   ├── state-transition.ts        【新】事件 → 状态迁移（delta 表 + clamp）
│   └── intention-planner.ts       【新】状态 → 本轮 Intention
├── in-memory/
│   └── in-memory-engine-session.ts【改】turn 插入 classify → transition → plan；openSession 持有 profile
├── engine-session.types.ts        【改】OpenEngineSessionInput 加可选 characterProfile；EngineTurnOutput 加可选 intention
└── index.ts                       【改】导出新增公开类型（同步 boundary 白名单）
```

> `cognition/` 是纯函数层：不持有可变状态、不碰仓储，输入快照+事件，输出新快照/意图，便于单测与未来替换为模型轨。

---

## 4. 类型契约（可直接施工）

### 4.1 信念层 `domain/beliefs.ts`

```ts
/** 核心信念: 源自角色内核, 本场永久不可变 (事件只触发它, 不改写它). */
export interface CoreBelief {
  readonly theme: string;                 // unlovable / worthless / helpless / 自定义字符串
  readonly statement: string;             // 第一人称陈述, 如"我是不值得被爱的"
  readonly activationTags: readonly string[]; // 命中后会激活该信念的议题标签
}

/** 短期信念: 会话中形成, 带置信度, 可被咨询师干预提升/削弱. */
export interface TemporaryBelief {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;              // [0,1]
  readonly source: 'observed' | 'introduced'; // observed=来访自发, introduced=咨询师引入
}

/** 记忆信念: 长时召回用, 带时效. 本期只定义类型, 不接召回 (WP2). */
export interface MemoryBelief {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;
  readonly expiresAt: number | null;      // null = 不过期
}
```

### 4.2 愿望层 `domain/desires.ts`

```ts
/** 底层愿望: 稳定, 随信念缓慢变化, 本期由 profile 给基线权重. */
export interface UnderlyingDesire {
  readonly key: string;                  // understood / accepted / avoid_pain / control 等
  readonly label: string;
  readonly baselineWeight: number;       // [0,1]
  readonly currentWeight: number;        // [0,1], 初始 = baselineWeight
}

/** 情境愿望: 本轮具体诉求, 带优先级; 本期由规划器给占位, 不做复杂愿望推理. */
export interface SituationalDesire {
  readonly id: string;
  readonly text: string;
  readonly priority: number;            // [0,1]
  readonly active: boolean;
}
```

### 4.3 情绪 `domain/emotion.ts`

```ts
export type EmotionLabel =
  | 'neutral' | 'sad' | 'anxious' | 'angry' | 'hurt'
  | 'guarded' | 'relieved' | 'hopeful' | 'ashamed' | 'empty';

/** 情绪 = 离散标签 + 效价 valence[-1,1] + 唤醒 arousal[0,1]. 双轴决定标签, 不做自由文本. */
export interface EmotionState {
  readonly label: EmotionLabel;
  readonly valence: number;             // -1(极负) .. 1(极正)
  readonly arousal: number;              // 0(平静) .. 1(高唤醒)
}
```

> 规则轨本期：迁移算子只改 `valence` / `arousal` 数值；`label` 由一个轻量落点映射（valence×arousal 象限 → 标签）得出，不训练情绪模型。

### 4.4 移情 `domain/transference.ts`（决策 D3：三态强度向量，不单选）

```ts
/** 正/负/依赖三态各带独立强度, 可叠加, 不互斥. */
export interface TransferenceState {
  readonly positive: number;      // [0,1] 理想化/依赖式好感
  readonly negative: number;      // [0,1] 挑剔/投射敌意
  readonly dependency: number;   // [0,1] 强烈依附/把咨询师当救命稻草
}
```

### 4.5 本轮意图 `domain/intention.ts`（派生输出，不落快照）

```ts
export type BehaviorStrategy =
  | 'simple_response' | 'request' | 'recounting'
  | 'cognitive_exploration' | 'affective_exploration'
  | 'insight' | 'discussing_plans' | 'resistance';

/**
 * 本轮决策目标: 供 WP5 渲染消费. 内核只给"该倾向怎么说/说多深"的结构化目标,
 * 不写一个字的口语. 五字段 = 行为策略 + 情绪 + 阻抗 + 移情 + 禁止行为.
 */
export interface Intention {
  readonly strategy: BehaviorStrategy;
  readonly emotion: EmotionState;
  readonly resistance: BdiResistance;
  readonly transference: TransferenceState;
  readonly forbiddenBehaviors: readonly string[];
  readonly rationale?: string;   // 可观测决策理由, 仅用于日志/督导, 不渲染
}
```

### 4.6 快照重写 `domain/bdi-snapshot.ts`

`BdiSnapshot` 由 `unknown` 占位改为具体结构，并新增 `trust`：

```ts
export interface BdiSnapshot {
  readonly coreBeliefs: readonly CoreBelief[];
  readonly temporaryBeliefs: readonly TemporaryBelief[];
  readonly memoryBeliefs: readonly MemoryBelief[];
  readonly underlyingDesires: readonly UnderlyingDesire[];
  readonly situationalDesires: readonly SituationalDesire[];
  readonly emotion: EmotionState;
  readonly resistance: BdiResistance;          // 不再 nullable, 总有基线
  readonly transference: TransferenceState;
  readonly trust: number;                     // 新增, 关系信任 [0,1]
}
```

- `createEmptyBdiSnapshot()` 返回**中性默认基线**（见 §6.2 默认值表），不再是全 null。
- `cloneBdiSnapshot()` 改为对所有具体字段做防御性拷贝（数组浅拷贝 + 嵌套对象 `{...}`），不可再按 `unknown` 引用透传。
- 状态更新一律**造新对象整体替换**（值语义），禁止就地 `push` / 改字段。

### 4.7 角色注入 `domain/character-profile.ts`

```ts
export interface CharacterProfile {
  readonly coreBeliefs: readonly CoreBelief[];
  readonly attachmentStyle?: 'anxious' | 'avoidant' | 'disorganized' | 'secure';
  readonly underlyingDesires?: readonly { key: string; label: string; baselineWeight: number }[];
  readonly baseline?: {
    readonly trust?: number;
    readonly resistance?: Partial<BdiResistance>;
    readonly emotion?: Partial<EmotionState>;
    readonly transference?: Partial<TransferenceState>;
  };
  readonly forbiddenBehaviors: readonly string[];
  readonly sensitiveTopics: readonly string[];   // 命中即 sensitive_touch 的议题词
}
```

### 4.8 会话 DTO 扩展（向后兼容，只加可选字段）

- `OpenEngineSessionInput` 增 `readonly characterProfile?: CharacterProfile;`
- `EngineTurnOutput` 增 `readonly intention?: Intention;`（WP0 调用方不传/不收不受影响）
- `reply` 本期仍恒为 `''`（渲染属 WP5）。

---

## 5. 事件分类（规则轨）

### 5.1 事件种类 `domain/events/session-event.ts`

```ts
export type CounselorEventKind =
  // 正向
  | 'empathy' | 'acceptance' | 'normalization' | 'open_probe' | 'affirmation'
  // 负向
  | 'judgment' | 'preaching' | 'minimizing' | 'boundary_cross'
  // 触发
  | 'sensitive_touch'
  // 未命中任何规则
  | 'neutral';

export interface SessionEvent {
  readonly kind: CounselorEventKind;
  readonly matchedTerms: readonly string[];
  readonly strength: number;          // 命中强度 [0,1], 本期词典命中数归一即可
}

/** 可替换分类器接口: 规则轨先实现, 模型轨后期替换, turn 不感知具体实现. */
export interface EventClassifier {
  classify(text: string, context?: { sensitiveTopics?: readonly string[] }): readonly SessionEvent[];
}
```

### 5.2 规则词典 `domain/events/event-lexicon.ts`（初始种子，纯常量，集中可调）

词典是**初始种子不追求穷尽**，按类组织关键词/正则。给出最低限度样例（后端可补全，但不得把词表散落到算子里）：

| 事件 | 样例信号（中文关键词/正则，非穷尽） |
|---|---|
| empathy | "听起来你…"、"你觉得…很…"、"这种感受"、"你现在一定很"、共情式命名情绪 |
| acceptance | "没关系"、"这很正常你可以…"、"我不会评判你"、"你愿意说出来已经…" |
| normalization | "很多人都会这样"、"这不奇怪"、"换作别人也会" |
| open_probe | "能多说一点吗"、"当时发生了什么"、"你怎么看这件事"、开放式疑问 |
| affirmation | "你做得已经很好了"、"你很勇敢"、"这是你的进步" |
| judgment | "你不该"、"这是你自己想多了"、"你就是太敏感"、价值审判 |
| preaching | "你应该"、"听我的建议"、"你要学会"、直接给方案/说教 |
| minimizing | "别想太多"、"这没什么大不了"、"至于吗"、否定/淡化情绪 |
| boundary_cross | 自我暴露咨询师私事、索要私下联系方式、双重关系、越界承诺 |
| sensitive_touch | 命中 `profile.sensitiveTopics` 词表（创伤点/敏感议题） |

- 一条文本可命中多类，全部返回；冲突类（如同时命中 affirmation 与 judgment）按返回列表交给迁移算子叠加，**本期不做互斥仲裁**。
- 未命中任何规则 → `neutral`（迁移 delta = 0）。

---

## 6. 状态迁移算子 `cognition/state-transition.ts`

### 6.1 初始 delta 表（集中常量，单测钉死，便于后期调参/换模型）

数值为初始种子参数（产品可调，不在代码各处硬编码）。每个事件对下列维度施加增量，叠加后统一 clamp：

| 事件 | trust | res.verbal | res.depth | res.style | valence | arousal | negTrans |
|---|---|---|---|---|---|---|---|
| empathy | +0.10 | −0.08 | −0.10 | −0.06 | +0.10 | −0.05 | — |
| acceptance | +0.08 | −0.06 | −0.08 | −0.05 | +0.08 | −0.04 | — |
| normalization | +0.07 | −0.05 | −0.07 | −0.04 | +0.07 | 0 | — |
| open_probe | +0.05 | −0.03 | −0.06 | −0.03 | +0.04 | +0.02 | — |
| affirmation | +0.08 | −0.04 | −0.06 | −0.04 | +0.10 | −0.03 | — |
| judgment | −0.12 | +0.06 | +0.08 | +0.12 | −0.12 | +0.06 | +0.05 |
| preaching | −0.10 | +0.08 | +0.06 | +0.06 | −0.08 | +0.03 | +0.03 |
| minimizing | −0.10 | +0.05 | +0.10 | +0.05 | −0.12 | +0.04 | +0.04 |
| boundary_cross | −0.15 | +0.04 | +0.05 | +0.15 | −0.15 | +0.08 | +0.10 |
| sensitive_touch | 0 | +0.05 | +0.05 | +0.06 | −0.05 | +0.15 | +0.04 |
| neutral | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

> 移情正向随 empathy/acceptance/affirmation 小增 `positive`；dependency 本期只在重复 affirmation/acceptance 累积时做轻微上升（可先给单一小增量常量），不做复杂依附建模。`—` = 该事件不影响该维度。

### 6.2 默认基线（无 profile / 字段缺省时）

| 字段 | 默认值 |
|---|---|
| trust | 0.30（初识谨慎，非全然冷漠） |
| resistance | `{ verbal: 0.4, depth: 0.4, style: 0.35 }` |
| emotion | `{ label: 'neutral', valence: 0, arousal: 0.3 }` |
| transference | `{ positive: 0, negative: 0, dependency: 0 }` |
| coreBeliefs / desires / forbiddenBehaviors / sensitiveTopics | 空数组 |

### 6.3 clamp 规则

- `trust` / 三维阻抗 / 移情 / `arousal` / 各权重：clamp 到 `[0, 1]`。
- `valence`：clamp 到 `[-1, 1]`。
- 叠加顺序：先把所有命中事件的 delta 求和，再统一 clamp（避免逐事件 clamp 丢失叠加信号）。
- 情绪 `label`：由迁移后的 `valence` × `arousal` 象限映射得到（纯规则表，集中在本文件）。

### 6.4 关键架构原则（写进代码注释，防止后端做反）

> **阻抗/情绪是来访的内部防御状态，由咨询师事件推动升降，作为 WP5 的渲染参数；本期绝不从来访自己说的话反推这些值。** 来访口语是 WP5 的渲染结果，从结果反推原因 = 循环论证。

---

## 7. 意图规划器 `cognition/intention-planner.ts`

从迁移后状态选一个主导 `strategy`（本期单主导，不做多策略混合排序），规则阈值集中常量：

| 条件（按优先级从上到下取首个命中） | strategy |
|---|---|
| 三维阻抗聚合 ≥ 0.6 且 trust < 0.4 | `resistance` |
| verbal 阻抗高（≥0.55） | `simple_response` |
| trust ≥ 0.6 且 depth 阻抗 < 0.35 | `cognitive_exploration`（次选 affective_exploration 当 valence 偏负） |
| 出现 insight 类正向事件且 valence ≥ 0.4 | `insight` |
| 现状偏好叙述事实、未进入探索 | `recounting` |
| 来访主动寻求建议/安抚 | `request` |
| 谈到具体改变计划 | `discussing_plans` |

- `intention.emotion / resistance / transference` 直接引用迁移后快照当前值。
- `forbiddenBehaviors` 透传 `profile.forbiddenBehaviors`（默认空）。
- `rationale` 记录命中了哪条规则，仅供日志/督导观测。

---

## 8. turn 管线改造（`in-memory-engine-session.ts`）

在 WP0 已留的插入点（原第 2 步"快照原样透传"）替换为：

```
loadState → classifyCounselorEvent(userText, {sensitiveTopics})
          → transitionState(base.snapshot, events, profile)
          → planIntention(newState, profile)
          → save(新快照, revision+1)
          → rememberTurn
          → output { reply: '', snapshot, turnIndex, intention }
```

- `openSession`：把 `characterProfile` 存进 runtime（同步登记，不读仓储）。
- `loadState` 全新会话分支：有 profile → 按 §4.7/§6.2 装配初始快照；无 profile → 中性默认基线。**resume 分支仍只搬上一场快照，不用 profile 覆盖接续状态。**
- 分类器/迁移/规划器通过构造选项可注入（默认给规则实现），便于单测替换；端口行为不变。
- 乐观锁 `STATE_CONFLICT`、ABORTED、INVALID_INPUT、幂等 close 等 WP0 行为原样保留。

---

## 9. 单测清单（`test/engine-core/` 新增 spec，沿用可注入 now/idFactory）

1. **正向链**：连续 empathy/acceptance → trust 上升、三维阻抗下降、valence 上升、positive 移情小增。
2. **负向链**：judgment/preaching/minimizing → trust 下降、style/depth 阻抗上升、valence 下降、negative 移情增。
3. **触发**：命中 sensitiveTopic → arousal 显著上升、防御小幅激活、trust 不变。
4. **clamp**：极端连续正负向后，所有数值停在边界内（不越界、不变 NaN）。
5. **默认基线**：无 profile 开新会话，首论前状态等于 §6.2 默认表（逐字段断言）。
6. **角色注入**：带 profile 的会话，开场核心信念/禁止行为/初始 trust 与 profile 一致。
7. **可复现**：同 profile + 同文本序列跑两遍，逐轮 `snapshot` 深比较相等（含无随机、无墙钟依赖）。
8. **意图结构**：高阻抗低信任 → `strategy='resistance'`，且 intention 五字段齐全、forbiddenBehaviors 透传。
9. **neutral**：未命中任何规则的文本 → delta 全 0，状态不变。
10. **resume 不被 profile 覆盖**：带 resumeFromSessionId 且另给 profile，开场状态取上一场而非 profile 默认。
11. 回归：WP0 既有冒烟/乐观锁/租户隔离/TTL/防御性拷贝用例继续全绿。

> 可复现性用例必须证明"两遍完全一致"，这是 roadmap WP1 的硬性验收。

---

## 10. 验收清单（逐条可勾选）

- [x] `npm run build` 0 错（tsc 全量，`tsc -p tsconfig.build.json --noEmit` 0 错）。
- [x] `npm run lint` 0 error（全量 `src/**/*.ts`，exit 0；lint glob 不覆盖 test）。
- [x] `npm test engine-core` 全绿：3 suites / 42 tests passed；WP0 旧用例不回归。
- [x] `boundary.spec.ts` 边界不变量仍全绿：零 `@nestjs`/`typeorm`、零逃出目录 import、白名单仍只有 `nanoid`+`node:*`、零装饰器；新增导出/文件已同步进白名单与目录清单。
- [x] 同一角色同一行为序列产出可复现快照（§9.7，两遍深比较 `toEqual` 相等）。
- [x] 意图五字段结构化进 `turn` 出参（可被日志/督导读取），但**零口语生成**（`reply` 恒 `''`）。
- [x] 内核不读 DB/persona、不发网络、不接 LLM；无 migration/entity/module/端点改动。
- [x] 端口三方法签名未破坏，仅追加可选 DTO 字段（`characterProfile` / `intention`）。

---

## 11. 交付闸门（大炮在 Windows 跑，后端不代跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npm run lint
npm run build
npm test engine-core
npm test
```

**新增 env 开关**：无。本期不读 `process.env`、不动 `.env`、不加配置文件。

---

## 12. 关键决策记录（本任务单已定，实施中不反复）

| # | 决策 | 理由 / 备选 |
|---|---|---|
| D1 | 本期**纯规则轨**，模型微调轨只留 `EventClassifier` 接口位，不实现不调 LLM | 先把确定性状态机与可复现跑通；模型轨后期替换实现即可，turn 不感知 |
| D2 | 情绪 = 离散标签 + valence[-1,1] + arousal[0,1] | 双轴可被规则迁移驱动、可复现；纯离散无法表达强度，自由字符串不可比 |
| D3 | 移情 = 正/负/依赖三态**各自强度向量**，可叠加 | 单值三选一无法表达"又依赖又挑剔"的矛盾移情，临床更真实 |
| D4 | 阻抗/情绪由咨询师事件推动，**不从来访输出反推** | 来访输出是 WP5 渲染结果，反推 = 循环论证 |
| D5 | 新增独立关系变量 `trust[0,1]`（借 PatientHub 五档信任增量思路） | 信任是开放度/披露深度的总闸门，需独立于阻抗跟踪 |
| D6 | 意图**不落快照**，作为每轮 turn 派生出参 | 快照存持久人格状态，意图是本轮决策；分离后快照可回放、意图可观测 |
| D7 | 角色基线在首个 turn 的全新会话分支装配，openSession 仍同步 | 保持 WP0"open 不读仓储、签名不改"的契约稳定 |

### 待大炮过目（不阻塞开工，有异议再调）

- 初始 delta 表（§6.1）与默认基线（§6.2）是**工程种子值**，非临床标定值，后期靠真实训练数据校准；本期只需可复现、方向正确。
- 规则词典（§5.2）为最小种子，不追求一次穷尽；漏判走 `neutral`（delta=0），不会恶化状态。

---

## 13. 下一步（本期不做，另起任务单）

1. WP2 分层记忆 V1（Qdrant 替换内存记忆仓，接口不变；记忆信念/短期信念在此接召回）。
2. 模型微调轨 `EventClassifier` 实现（替换规则实现，turn 管线不动）。
3. WP5 渲染接线（消费 `Intention` 生成口语，本期 `reply=''` 的占位在此填值）。

---

## 14. 交付与复跑记录（2026-10-28）

- **实现**：规则轨三算子（`RuleBasedClassifier` / `transitionState` / `planIntention`）+ 五槽位具体类型 + `buildInitialSnapshot` 角色基线装配；`openSession` 追加可选 `characterProfile`，`EngineTurnOutput` 追加可选 `intention`，`reply` 恒 `''`。
- **复跑结果**（本地，纯内存）：
  - `npx jest test/engine-core` → 3 suites / 42 tests passed（含 WP0 回归）。
  - `npx tsc -p tsconfig.build.json --noEmit` → 0 错。
  - `npx eslint "src/**/*.ts"` → 0 error。
- **修复记录**：
  1. `aggregate()` 原在 `readonly DeltaVector` 上直接 `+=` 赋值（TS2540），改为内部可变对象累加、返回只读向量。
  2. 默认愿望/核心信念装配直接引用全局常量数组，多次调用共享引用；改为装配时浅拷贝，保证值语义独立。
  3. `buildInitialSnapshot` 圈复杂度 41（超 20），拆出 `buildResistance`/`buildEmotion`/`buildTransference` 三个纯辅助函数。
- **未接外部依赖**：无 DB、无网络、无 LLM、无 migration、无新增 env；delta 表与默认基线为工程种子值，待真实训练数据校准。
