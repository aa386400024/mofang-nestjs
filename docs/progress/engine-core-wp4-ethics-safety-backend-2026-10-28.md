# WP4 · 伦理安全引擎（规则层主体 + PsyGUARD 双层降级 + 双侧检测 + 会后伦理报告）后端任务单

> 母版: [`../architecture/ai-engine-roadmap-v1.1.md`](../architecture/ai-engine-roadmap-v1.1.md) WP4（伦理安全 / 危机升级阈值 / 安全兜底 / 强制转介信号）+ §7 伦理分层（规则层 / PsyGUARD / MindGuard）
> 前置: [`engine-core-wp0-boundary-skeleton-backend-2026-10-28.md`](./engine-core-wp0-boundary-skeleton-backend-2026-10-28.md)（边界骨架，已交付）、
>       [`engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md`](./engine-core-wp1-bdi-cognitive-engine-backend-2026-10-28.md)（BDI 规则轨，已交付）、
>       [`engine-core-wp2-layered-memory-backend-2026-10-28.md`](./engine-core-wp2-layered-memory-backend-2026-10-28.md)（分层记忆 V1，已交付）、
>       [`engine-core-wp3-trajectory-control-backend-2026-10-28.md`](./engine-core-wp3-trajectory-control-backend-2026-10-28.md)（会话轨迹控制，**已交付并复跑绿：eslint 0 / tsc 0 / jest engine-core 全绿零回归**）
> 仓库: `E:\Work\Project\backend\mofang-nestjs`
> 日期: 2026-10-28 ｜ 类型: 引擎内核安全层（确定性硬规则 + 可选风险探测端口 + 超时降级 + 会话内累计报告），本期无 B 层网络实现、无模型、无落库
> 目标读者: 后端；内核命令同 WP0/WP1/WP2/WP3，由大炮在 Windows 复跑 `lint` / `tsc` / `jest`
> **状态**: 🟢 **已交付并自跑复跑绿**（eslint 0 / tsc 0 / jest engine-core 6 套件 153 用例全绿、engine-adapters 13 用例全绿；WP0–WP3 既有 123 用例零回归）
> **交付记录**: [`engine-core-wp4-ethics-safety-implementation-2026-10-28.md`](./engine-core-wp4-ethics-safety-implementation-2026-10-28.md)

---

## 0. 一句话目标

在 WP1–WP3 之上给内核加一层**伦理安全护栏（Safety Layer）**：咨询师每轮输入先过一层**毫秒级确定性硬规则**（承诺治愈、价值审判、双重关系、违法指导、歧视、提供自杀/自残方法等），同时预留一个**可替换的风险探测端口（RiskProbePort，未来由独立 PsyGUARD-RoBERTa Python 服务实现）**；规则未拦住时才异步问探测服务，**探测超时 / 报错自动降级回规则结果，绝不阻断对话**；本轮判定写进出参，本场所有判定在进程内累计成一份**伦理风险报告**供会后复盘。本期内核**只判定、不拦截、不改 BDI 决策、不内置模型、不发网络、不落库**；是否阻断提交由 adapter / 表现层根据 `verdict.level` 决定。

> 衔接说明：WP1–WP3 的 `turn` 管线固定为 `loadState → classify → transitionState → planIntention → [WP3 轨迹步] → save → rememberTurn → openingContext`。**WP4 不重写、不改这条管线、不改快照与 Intention**，只在 `userText` 清洗校验之后、`classify` 之前插入一个**只读安全判定步**：算出 `SafetyVerdict`，累计进本场事件列表，随出参挂出；BDI 照常自由运行。未注入探测端口、规则未命中时，本轮行为与 WP1–WP3 **逐字一致**（零回归硬要求）。

---

## 1. 范围与 Done 定义

### 1.1 本期做到（In Scope）

1. **安全类型模型（纯 TS，不落库）**：`SafetyLevel`（`pass / warn / block`）、`SafetySide`（`counselor_input / visitor_output`）、咨询师侧违规类别枚举、来访侧 PsyGUARD 11 类归一类别、`SafetyVerdict / SafetyEvent / SafetyReport`。
2. **PsyGUARD 11 类 → 归一等级映射表（常量，集中一处）**：把参考模型的细粒度标签映射到 `pass / warn / block`，供未来探测结果归一，避免散落在调用处。
3. **确定性规则引擎纯函数 `evaluateSafety(text, side)`**：小写子串匹配（本期不上正则），命中取最高级别、聚合类别；无 IO、无随机、无网络。
4. **风险探测端口 `RiskProbePort`（接口，不实现）**：`probe(text, side): Promise<RiskProbeResult>`，范式照 `Embedder`：内核只依赖接口，HTTP / Python 服务实现留 B 层与独立服务。
5. **安全编排纯函数 `assessSafety`**：先规则（同步）→ 探测存在且规则未达 `block` 时异步调用并 `Promise.race` 超时兜底 → 合并结果；**超时 / 抛错一律回落规则结果，不炸穿 turn**。
6. **双侧检测骨架**：咨询师输入 `counselor_input` 每轮必检；来访输出 `visitor_output` 复用同一规则器与端口形状，但本期 `reply` 恒空，**turn 内不调用来访侧检测**（WP5 渲染后接入），仅把规则器 / 端口留好。
7. **出参追加可选 `safety?: SafetyVerdict`**：仅本轮咨询师侧判定；`pass` 且探测无额外结果时省略该字段（保零回归），`warn / block` 或探测有结果时携带。
8. **会话内累计 + 观测报告**：`InMemoryEngineSession` 构造选项可注入 `riskProbe`；本场 `SafetyEvent` 在进程内累计，提供非端口观测方法 `getSafetyReport(handleId)`；**不落 MySQL / Qdrant**，入档案留装配轮。
9. **MindGuard 临床层占位**：只在端口 / 类型文件留注释说明（临床精算 / 危机升级处置属后期云 API），本期不实现、不留行为字段。
10. 单测覆盖规则命中与分级、多规则取最高、探测成功合并、探测超时 / 抛错降级、block 不等探测、零回归、隔离、报告累计。

### 1.2 明确不做（Out of Scope，后期再入）

| 不做项 | 归属 |
|---|---|
| 内置 PsyGUARD-RoBERTa 模型权重、本地推理、写独立 Python FastAPI 服务、真实 HTTP 客户端 | 独立服务 / B 层装配轮（本期只留 `RiskProbePort` 接口与降级路径） |
| 规则落 MySQL、规则热更新 / 运营后台 / 规则 CRUD、规则灰度 | 后期（规则本期为内核种子常量） |
| 来访输出实际检测（`reply` 恒空，无文本可检） | WP5 渲染接线后 |
| 伦理报告落 MySQL / Qdrant、审计表、报告归档入实训档案的持久化 | 装配轮（本期仅进程内存累计） |
| MindGuard 临床精算层本地实现 / 4B8B 自托管 / 临床转介处置动作 | 后期云 API（仅占位） |
| 内核直接"禁言 / 回滚提交 / 弹窗阻断" | adapter / 表现层职责，内核只给判定 |
| 内核写审计日志 / 高风险落审计表 | 内核零 IO 不打日志；adapter 依据 `verdict` 落审计，内核只提供结构化判定 |
| 接入 `app.module.ts` / WS / HTTP 端点、真实 PsyGUARD 地址 / 超时配置进 `.env` | 装配轮 |
| 把业务侧 `counselor/drills` 危机练习壳数据、`live-hint` 的 LLM `suicide_cue` 规则搬进内核或合并 | 见 §1.3，分层并列 |
| 调 LLM 判定安全、用模型润色 `reason`、生成干预话术 | WP5 / 模型轨 |

### 1.3 与现有业务侧危机 / 提示规则的关系（重要，别搬错）

仓内已有两套与"风险"相关但**不同层**的东西，本期都不迁移、不合并：

- `src/counselor/drills/`（boundary 边界压力 / crisis 危机识别）是**单轮教学练习壳数据**，合规上"只练习识别与转介，不是真实危机干预"，静态录入、不走模型。
- `live-hint` / turn-analysis 的 `suicide_cue` 是 **LLM 实时会中提示**的一个类别，属传输/表现层观察。

WP4 的 `engine-core/safety` 是**内核确定性护栏 + 探测抽象**：对咨询师输入做硬分级，为未来的自动化拦截 / 考核判罚提供信号。三者并列；后期若要打通，由编排层桥接，不在本期。

---

## 2. 边界红线（继承 WP0/WP1/WP2/WP3，继续生效）

- `src/engine-core/` 整树**零** `@nestjs/*`、零 `typeorm`、零逃出本目录的相对 import、零 NestJS 装饰器；新增第三方依赖仍仅限 `{ nanoid }` + `node:*`。本期**不新增任何第三方包**（超时用 `node:setTimeout`，纯函数 + 标准库）。
- 端口方法签名**不破坏**：`openSession / turn / closeSession` 三方法名、同步/异步形态、既有返回形态不变；入参/出参/DTO **只追加可选字段**。
- 内核不读数据库、不发网络、不调模型；`RiskProbePort` 由 adapter 装配时注入，未注入即纯规则；事件列表 / 报告不落库。
- 测试仍放 `test/engine-core/`，直接 `new` 内存实现跑，不启动 NestJS 容器；本期无 B 层，不建 `test/engine-adapters/` 新用例。
- 安全判定**不改写** `snapshot` / `intention` / 轨迹游标，不阻断 BDI 管线；内核无副作用。

> ⚠️ `test/engine-core/boundary.spec.ts` 的公开面白名单（断言⑥ `expectedPublic`）与目录清单（断言⑦ `expected`）是**硬编码**。本期新增公开导出 / 新文件后，**必须同步更新这两个断言**，不得删断言、不得改断言绕过去。

---

## 3. 目录落点

### 3.1 内核层（`src/engine-core/`，纯 TS，零框架）

```
src/engine-core/
├── domain/
│   ├── safety/
│   │   └── safety-types.ts            【新】level/side/类别/SafetyVerdict/SafetyEvent/SafetyReport + PsyGUARD 映射常量
│   └── ports/
│       └── risk-probe.ts              【新】RiskProbePort 接口 + RiskProbeResult（MindGuard 占位注释写在这里）
├── cognition/
│   └── safety/                       【新目录】安全纯算子（无状态、无 IO、无随机）
│       ├── rule-engine.ts             【新】规则词典（咨询师/来访种子词）+ evaluateSafety 纯函数
│       └── assess-safety.ts           【新】规则+可选probe+超时/异常降级编排
├── in-memory/
│   └── in-memory-engine-session.ts    【改】构造选项 riskProbe；累计 events；getSafetyReport；turn 插只读安全步
└── index.ts                           【改】导出新增类型/纯函数（同步 boundary 白名单）
```

> 说明：规则词典是内核种子常量，集中在 `rule-engine.ts`；`assessSafety` 是无状态编排，运行时只负责喂文本、持有注入的 probe、累计事件。事件列表挂在句柄实例上，不跨句柄共享、不落库。

### 3.2 B 层

本期**无 B 层**：不写 PsyGUARD HTTP 客户端、不接 embedding、不建表。`src/engine-adapters/` 现有文件不动；`RiskProbePort` 的真实实现（未来 Python 服务的 HTTP 适配）留装配轮。

---

## 4. 类型契约（可直接施工）

### 4.1 安全类型（`domain/safety/safety-types.ts`，新）

```ts
/** 三级安全等级: pass 放行 / warn 中低告警 / block 高危拦截信号. */
export type SafetyLevel = 'pass' | 'warn' | 'block';

/** 检测面向: 咨询师输入 / 来访输出. */
export type SafetySide = 'counselor_input' | 'visitor_output';

/** 咨询师侧违规类别 (规则层硬规则覆盖). */
export type CounselorSafetyCategory =
  | 'promise_cure'         // 承诺治愈 / 保证疗效 / "肯定能好"
  | 'value_judgment'       // 价值审判 / 说教 / 给来访者贴病理标签
  | 'double_relationship'  // 双重关系 / 私下联系 (加微信/电话/约会/转账)
  | 'premature_advice'     // 过早直接给诊断 / 开药 / 处置建议 (跳过评估)
  | 'illegal_guidance'     // 违法指导 (伪造证明/非法药物/自残方法/帮助实施)
  | 'discrimination'       // 歧视 (性别/性取向/地域/疾病/残障)
  | 'suicide_coaching';    // 提供自杀/自残方法细节 / 帮助实施

/**
 * 来访侧 = PsyGUARD 11 类归一 wire 名 (probe 回传 + 规则种子共用).
 * 顺序对应参考模型细粒度标签, 名称本期自定为内核内部契约, 不要求与模型输出原文一致.
 */
export type VisitorRiskCategory =
  | 'suicide_attempt'       // 自杀未遂
  | 'suicide_plan'          // 自杀计划
  | 'suicide_preparation'   // 自杀准备行为
  | 'active_ideation'       // 主动自杀意图
  | 'self_harm_behavior'    // 自伤行为
  | 'passive_ideation'      // 被动自杀意图
  | 'suicide_exploration'   // 关于自杀的探索
  | 'self_harm_ideation'    // 自伤意图
  | 'aggression_others'     // 他人攻击行为
  | 'aggression_self'        // 用户攻击行为
  | 'neutral';              // 与自杀/自伤/攻击无关

export type SafetyCategory = CounselorSafetyCategory | VisitorRiskCategory;

/** 本轮判定结果 (纯观测, 不含口语, 不携带动作指令). */
export interface SafetyVerdict {
  readonly level: SafetyLevel;
  readonly side: SafetySide;
  /** 命中类别去重集合 (规则类别 / probe 类别合并). */
  readonly categories: readonly SafetyCategory[];
  /** 命中的规则 id (规则层); 纯 probe 来源时为空数组. */
  readonly matchedRules: readonly string[];
  /** 判定来源. */
  readonly source: 'rule' | 'probe' | 'rule+probe';
  /** 供督导/报告的中性说明 (一句话, 不渲染给来访者). */
  readonly reason?: string;
}

/** 单条累计事件 (进程内存, 不落库). */
export interface SafetyEvent {
  readonly turnIndex: number;
  readonly at: number;
  readonly verdict: SafetyVerdict;
  /** 命中片段截断 (供报告回看), 不作额外识别依据. */
  readonly snippet: string;
}

/** 会后伦理风险报告 (进程内聚合, adapter 取走后自行决定是否落库). */
export interface SafetyReport {
  readonly sessionId: string;
  readonly maxLevel: SafetyLevel;
  readonly blockCount: number;
  readonly warnCount: number;
  readonly events: readonly SafetyEvent[];
}
```

### 4.2 PsyGUARD 映射常量（`domain/safety/safety-types.ts`，新）

```ts
/**
 * PsyGUARD 11 类 → 归一等级 (集中一处, 避免调用处各写一套漂移).
 * critical(行动层) → block; 意念/探索层 → warn; 无关 → pass.
 */
export const PSYGUARD_LEVEL_MAP: Readonly<Record<VisitorRiskCategory, SafetyLevel>> = {
  suicide_attempt: 'block',
  suicide_plan: 'block',
  suicide_preparation: 'block',
  active_ideation: 'block',
  self_harm_behavior: 'block',
  passive_ideation: 'warn',
  suicide_exploration: 'warn',
  self_harm_ideation: 'warn',
  aggression_others: 'block',
  aggression_self: 'warn',
  neutral: 'pass',
};
```

### 4.3 探测端口（`domain/ports/risk-probe.ts`，新）

```ts
import type { SafetyLevel, SafetySide, VisitorRiskCategory } from '../safety/safety-types';

export interface RiskProbeResult {
  readonly level: SafetyLevel;
  readonly categories: readonly VisitorRiskCategory[];
  /** 模型置信度 (0..1), 可选; 内核只归一等级, 不拿它做决策阈值. */
  readonly score?: number;
}

/**
 * 风险探测抽象 (未来 = 独立 PsyGUARD-RoBERTa Python 服务的 HTTP 适配).
 * 内核只依赖该接口, 不关心模型部署/网络. 失败语义由实现/编排层负责降级,
 * 端口本身不承诺"一定成功".
 *
 * MindGuard 临床层 (危机升级精算 / 处置建议) 属后期云 API: 此处仅占位,
 * 本期不定义其方法、不留行为字段.
 */
export interface RiskProbePort {
  probe(text: string, side: SafetySide): Promise<RiskProbeResult>;
}
```

### 4.4 规则引擎纯函数（`cognition/safety/rule-engine.ts`，新）

```ts
import type { SafetyCategory, SafetyLevel, SafetySide, SafetyVerdict } from '../../domain/safety/safety-types';

export interface SafetyRule {
  readonly id: string;
  readonly side: SafetySide;
  readonly category: SafetyCategory;
  readonly level: SafetyLevel;
  /** 小写子串 (本期不上正则: 可测、可控误报; 正则留后期规则运营轮). */
  readonly patterns: readonly string[];
}

/**
 * 确定性规则判定 (纯函数, 无 IO).
 * 命中取最高级别, 类别/规则去重聚合; 无命中 → pass / 空集合 / source='rule'.
 */
export function evaluateSafety(text: string, side: SafetySide): SafetyVerdict;
```

### 4.5 安全编排纯函数（`cognition/safety/assess-safety.ts`，新）

```ts
import type { RiskProbePort } from '../../domain/ports/risk-probe';
import type { SafetySide, SafetyVerdict } from '../../domain/safety/safety-types';

export interface AssessSafetyInput {
  readonly text: string;
  readonly side: SafetySide;
  /** 装配时注入的探测端口; 缺省 = 纯规则. */
  readonly probe?: RiskProbePort;
  /** 探测超时 (种子值 DEFAULT_PROBE_TIMEOUT_MS=150); 到点回落规则. */
  readonly timeoutMs?: number;
  /** 时钟 (测试可注入; 用于事件 at, 不影响判定). */
  readonly now?: () => number;
}

/**
 * 规则 → 可选探测 → 合并/降级. 永不抛穿 (探测异常/超时被内部捕获为规则结果).
 */
export function assessSafety(input: AssessSafetyInput): Promise<SafetyVerdict>;

export const DEFAULT_PROBE_TIMEOUT_MS = 150;
```

### 4.6 端口 DTO 追加（`domain/engine-session.types.ts`，全部可选）

```ts
// EngineTurnOutput 追加 (仅本轮咨询师侧判定; pass 且探测无额外结果时省略):
/** 本轮安全判定 (WP4). 仅 counselor_input; 内核不据此阻断, 由 adapter 决策. */
readonly safety?: SafetyVerdict;
```

> `OpenEngineSessionInput` **不加** `riskProbe`：探测端口是行为依赖，照 `classifier` / 仓储走 `InMemoryEngineSessionOptions` 构造注入，不塞进开场纯对象（开场对象是可序列化的会话参数）。

### 4.7 构造选项与观测（`in-memory/in-memory-engine-session.ts`，改）

```ts
// InMemoryEngineSessionOptions 追加:
/** 可选风险探测端口 (未来 PsyGUARD 适配); 缺省纯规则. */
readonly riskProbe?: RiskProbePort;

// 非端口观测方法 (测试 / adapter 用, 不进 EngineSessionPort 契约):
getSafetyReport(handleId: string): SafetyReport;
```

---

## 5. 规则与分级语义（实施中不反复）

### 5.1 规则词典（`rule-engine.ts`，种子常量，保守起步）

本期只放**最硬、误报代价低**的种子词，宁少勿滥（避免训练日常对话被误拦）。词典按 `side` 分两组：

**咨询师侧 `counselor_input`（示例种子，可在常量表内增删，不改函数结构）：**

| category | level | 种子子串示例（小写，实际以代码常量为准） |
|---|---|---|
| `promise_cure` | block | “肯定能治好”“包好”“保证治愈”“一定没问题”“我担保你会好” |
| `double_relationship` | block | “加我微信”“私下联系”“下班见面”“跟你约会”“留你私人电话”“转账给我” |
| `illegal_guidance` | block | “教你怎么割/烧才…”“帮你弄到处方药/安眠药”“伪造诊断证明” |
| `suicide_coaching` | block | 提供自杀/自残方法细节、步骤、工具获取 |
| `discrimination` | block | 基于性别/性取向/地域/疾病/残障的贬损子串（母版列高危） |
| `value_judgment` | warn | “你就是太矫情”“这有什么想不开的”“你这种人…”（说教/贴标签，中低告警） |
| `premature_advice` | warn | 未评估直接“你该吃 XX 药”“你这就是抑郁症/XX 病，按我说的做”（过早给诊断/处置建议，中低告警） |

**来访侧 `visitor_output`（本期 turn 不调用，仅备 WP5）：** 危机信号种子词（自杀/自伤/不想活等表达），映射到 §4.2 的 `VisitorRiskCategory`。

- 匹配一律先 `text.trim().toLowerCase()`，子串包含即命中；**本期不使用正则**。
- 一条文本命中多条规则：`level` 取最高（`block > warn > pass`），`categories` / `matchedRules` 取并集去重，`source='rule'`。
- 全空白文本 → `pass`、空集合，不抛。

### 5.2 探测合并与降级（`assessSafety`）

1. 先 `evaluateSafety(text, side)` 得 `ruleVerdict`（同步）。
2. 未注入 `probe` → 直接返回 `ruleVerdict`。
3. 已注入 `probe` 且 `ruleVerdict.level === 'block'` → **不再等网络**，直接返回规则结果（高危已由规则兜住，无需为网络延迟付出代价），`source='rule'`。
4. 已注入 `probe` 且规则非 block → `Promise.race(probe.probe(...), timeout(timeoutMs))`：
   - **成功**：等级取 `max(rule.level, 归一后的 probe.level)`；`categories` 并集；`source` 规则与探测都有命中时 `'rule+probe'`，仅探测命中（规则 pass）时 `'probe'`。probe 的来访类别先过 `PSYGUARD_LEVEL_MAP` 归一。
   - **超时 / 抛错 / 返回非法**：内部 `catch`，回落 `ruleVerdict`，`source='rule'`，**不向 turn 抛任何异常**。
5. 时钟 `now` 仅用于事件 `at`，不参与判定；缺省 `Date.now`。

### 5.3 双侧检测边界

- `counselor_input`：每轮在 `assessSafety({ side: 'counselor_input' })` 调用，结果进 `safetyEvents`、挂出参。
- `visitor_output`：本期 `reply` 恒空，**turn 内不调用**；`evaluateSafety` / `assessSafety` 已支持该 `side`，WP5 拿到真实来访口语后直接复用。

### 5.4 管线插入位置（`in-memory-engine-session.turn`）

```
loadState → [只读安全步] assessSafety(counselor_input) → 累计 event → classify
         → transitionState → planIntention → [WP3 轨迹步] → save
         → rememberTurn → openingContext → 出参挂 safety
```

- 安全步在 `userText` 空白校验**之后**、`classify` **之前**；只读取 `userText`，不读、不改 `snapshot` / `intention` / 轨迹游标。
- 即使 `level==='block'`，BDI 管线照常跑完（内核不阻断）；是否拦下这一轮提交由 adapter 看 `output.safety.level` 决定。
- 未注入 probe、规则 pass 时：不写 `safetyEvents`（只累计 warn/block，见 M7），出参**省略 `safety` 字段**，保证零回归。

### 5.5 报告聚合（`getSafetyReport`）

- `maxLevel`：已累计事件中的最高等级（无事件 → `pass`）。
- `blockCount / warnCount`：按 `level` 计数；`pass` 不计。
- `events`：按轮次升序的快照副本（调用方可安全持有，不回写内部数组）。
- `handleId` 不存在 → 返回空报告（`maxLevel='pass'`、计数 0、events `[]`），不抛（观测接口不该把调用搞崩，同 WP3 观测口径）。

---

## 6. 软降级与容错

| 场景 | 行为 |
|---|---|
| 未注入 `riskProbe` | 纯规则返回；本轮与 WP1–WP3 完全一致 |
| 探测超时（超 `DEFAULT_PROBE_TIMEOUT_MS=150`） | 回落规则结果，`source='rule'`，不抛、不阻断 |
| 探测 `throw` / 网络错误 / 返回非法形状（无 level / 未知 level） | 内部捕获，回落规则结果，不炸穿 turn |
| 规则已 `block` | 不发起探测，直接返回规则结果 |
| 一条文本命中多条规则 | 等级取最高，类别/规则并集去重 |
| `probe` 返回 `neutral` / 规则 pass | 合并后仍 `pass`，出参省略 `safety`，不落事件 |
| `timeoutMs` 越界（≤0 / NaN） | 回落 `DEFAULT_PROBE_TIMEOUT_MS`，不抛 |
| 文本全空白 | 提前返回 `pass`，不跑规则、不调探测（空白已在入参校验拦截，此处兜底） |
| 未知 probe 类别 | 归一为 `pass` 忽略，不让脏类别炸合并 |

---

## 7. 异常与边界

| 场景 | 行为 |
|---|---|
| 无 probe 注入 + 规则 pass | 整条 turn 与 WP1–WP3 逐字一致（零回归硬要求），出参无 `safety` |
| block 是否阻断 BDI | **不阻断**：快照/Intention/轨迹照常，内核无副作用 |
| 来访侧检测 | 本期不调用，仅留 `side='visitor_output'` 路径供 WP5 |
| 跨租户 / 跨会话 | 事件列表随句柄实例持有，不跨句柄共享、不串场 |
| 报告取数后会话继续 | 已累计事件保留；`getSafetyReport` 返回副本，外部改动不回写 |
| 关闭会话后取报告 | `closeSession` 只删句柄登记；报告取数口径与 WP3 一致（关闭后不再新增事件，取数行为在实现里明确，不抛） |
| 规则大小写 / 全半角 | 统一小写子串；全半角差异本期不做归一（种子词选常用写法，误报留后期） |

---

## 8. 单测清单（`test/engine-core/wp4-safety.spec.ts`，纯内存）

1. **咨询师规则命中分级**：`promise_cure / double_relationship / illegal_guidance / suicide_coaching / discrimination` → `block`；`value_judgment / premature_advice` → `warn`；干净对话 → `pass`。
2. **多规则取最高**：同一句同时命中 warn 与 block → `level=block`，两类类别都进 `categories`，`matchedRules` 并集去重。
3. **规则纯函数无探测**：`evaluateSafety` 直接返回，`source='rule'`；无命中返回 pass/空集合。
4. **探测成功合并**：注入 fake probe 返回 `warn`/block 类别，规则非 block → 等级取高、类别并集、`source='rule+probe'` 或 `'probe'`。
5. **探测超时降级**：fake probe 永不 resolve，到超时回落规则结果，`source='rule'`，turn 正常返回不抛。
6. **探测抛错降级**：fake probe `reject` → 回落规则，不炸穿。
7. **规则 block 不等探测**：规则命中 block 时，即便 probe 慢/抛错，结果也是规则 block，且不等待（fake probe 可加计数，断言未被调用）。
8. **PsyGUARD 映射**：`suicide_attempt/plan/preparation/active_ideation/self_harm_behavior/aggression_others` → block；`passive_ideation/suicide_exploration/self_harm_ideation/aggression_self` → warn；`neutral` → pass。
9. **零回归**：不传 probe、干净对话，turn 产出的 snapshot/intention/turnIndex/trajectoryTrace 与 WP3 路径一致，出参**无 `safety` 字段**。
10. **事件累计与报告**：连续多轮产生 warn/block，`getSafetyReport` 的 `maxLevel`/`blockCount`/`warnCount`/`events` 计数正确，pass 轮不计数。
11. **报告返回副本**：拿到报告后改 `events` 数组，再次取数不受影响。
12. **未知句柄取报告**：`getSafetyReport(未知 id)` 返回空报告，不抛。
13. **来访侧路径存在但不被调用**：`evaluateSafety(text,'visitor_output')` 可独立调用（供 WP5）；本期 turn 断言未对 `reply`（空）做探测调用。
14. **非法 probe 返回**：probe 返回未知 level/类别 → 归一/忽略，回落规则，不抛。

---

## 9. 验收清单（逐条可勾选）

- [x] `npx tsc -p tsconfig.build.json --noEmit` 0 错。
- [x] `npx eslint "src/**/*.ts"` 0 error（新文件遵守既有 complexity / prettier / import-order）。
- [x] `npx jest test/engine-core` 全绿；**WP0/WP1/WP2/WP3 既有 engine-core 用例零回归**（WP2 的 engine-adapters 用例本期不动，复跑 `npx jest test/engine-adapters` 仍绿即可）。
- [x] `boundary.spec.ts` 全绿：内核整树零 `@nestjs`/`typeorm`；本期新增导出已进断言⑥白名单、新文件已进断言⑦目录清单（双向比对不漏不多）。
- [x] 探测超时 / 抛错时 turn 照常返回，结果回落规则，无未捕获异常。
- [x] 规则 block 不等待探测；安全步不改 snapshot/intention/轨迹。
- [x] block 判定带结构化 category / matchedRules，可供 adapter 落审计（内核自身不打日志、不落表）。
- [x] 无 probe + 干净对话时出参无 `safety`，与 WP3 逐字一致。
- [x] 本期零口语、零 LLM 调用、零 migration/entity/新表、零 `.env` 改动、零新第三方依赖、事件/报告不落库。
- [x] 未改动 `src/counselor/drills/`、`live-hint` 任何文件。

---

## 10. 交付闸门（大炮在 Windows 跑）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx jest test/engine-core
```

**新增 env 开关**：无。本期纯内核 + 可选端口注入，不新增 `.env` 项、不接 Qdrant/embedding/真实 PsyGUARD 地址（地址/超时留装配轮）。

---

## 11. 关键决策记录（已定，实施中不反复）

| # | 决策 | 理由 / 备选 |
|---|---|---|
| M1 | 内核**只判定不拦截**，block 只写进 verdict，阻断提交由 adapter/表现层决定 | 守"内核无副作用、无 IO"；内核一旦替表现层拦人，就跟交互/传输绑死，未来拆微服务要返工 |
| M2 | 安全步插在 `userText` 校验后、`classify` 前，只读不改 | 安全是前置信号；放 BDI 之后会让违规输入已经污染状态；只读保证零回归 |
| M3 | 三级 `pass/warn/block`，不另设 critical 枚举 | critical 信息由 category（suicide_plan 等）表达，等级只驱动动作；分级越简越好落地 |
| M4 | 规则用小写子串，本期不上正则 | 可测、可控误报；正则 / 词典运营 / 热更新留后期规则运营轮 |
| M5 | 规则 block 后不再等探测；非 block 才异步问，超时 150ms 回落 | 高危规则已兜住，网络延迟不该拖住确定信号；超时/异常静默降级，符合"探测挂掉不阻断对话" |
| M6 | `RiskProbePort` 走构造选项注入，不进 `OpenEngineSessionInput` | 行为依赖与可序列化开场参数分离，照 classifier/仓储范式；开场对象保持纯数据 |
| M7 | 本期只累计 warn/block，pass 不落事件、出参省略 safety | 零回归：干净会话的出参与 WP3 完全一致，不被空 pass 块污染 |
| M8 | 来访侧 `visitor_output` 只留路径不调用 | `reply` 恒空，无文本可检；WP5 渲染后直接复用同一规则器/端口 |
| M9 | 事件/报告仅进程内存，不落库；MindGuard 仅占位 | 落库/审计表/临床云 API 留装配轮与后期，本期先把判定与降级闭环做进内核 |
| M10 | PsyGUARD 11 类归一表集中在 `safety-types.ts` 一处 | 避免调用处各写映射导致漂移；未来换模型只改这张表 |

### 待大炮过目（不阻塞开工，有异议再调）

- `DEFAULT_PROBE_TIMEOUT_MS=150` 是工程种子值（本地/内网探测的经验上限），非标定值；集中为常量，后期按真实 Python 服务 P99 延迟校准。
- 咨询师侧种子词清单本期刻意保守：block 只放最硬的越界（承诺治愈/双重关系/违法/自杀自残指导/歧视），warn 只放明显的说教与过早建议；宁可漏报给督导事后看，也不误拦日常训练对话；扩充靠训练语料，不靠本期拍脑袋加词。
- 是否要在 `reason` 里给出可直接展示给督导的中文短句：本期只给中性类别级说明，不做自然语言润色（润色属模型轨）。

---

## 12. 下一步（本期不做，另起任务单）

1. **WP2 遗留补漏（与 WP4 无关，单独成单，勿并入本期）**：Qdrant 写侧 `setPayload`/scroll 冲突标记；短时记忆自动写入与会话结束编排层接线；衰减半衰期 30 天 / 阈值 0.1 标定。
2. **PsyGUARD 独立服务 + B 层适配轮**：独立 Python FastAPI（RoBERTa 11 类，CPU，单条 <50ms），B 层写 HTTP `RiskProbePort` 实现，超时/地址进 `.env`，接进 `InMemoryEngineSessionOptions.riskProbe`。
3. **WP5 渲染接线**：消费最终 Intention + 幕 `referenceNotes` 生成来访口语，填值 `reply=''`，并在拿到真实来访文本后启用 `visitor_output` 检测。
4. **伦理报告落库/入档案**：把进程内 `SafetyReport` 持久化进实训档案、对接会后复盘页。
5. **规则运营轮**：规则词典落库/热更新、正则支持、误报样本回流标定；MindGuard 临床层接云 API。

---

## 13. 交付状态

**代码已交付并自跑复跑绿**，逐条对照见交付记录
[`engine-core-wp4-ethics-safety-implementation-2026-10-28.md`](./engine-core-wp4-ethics-safety-implementation-2026-10-28.md)。

### 13.1 闸门

| 命令 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | exit 0，0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0，0 error |
| `npx jest test/engine-core` | 6 套件 / 153 用例全绿（WP0–WP3 既有 123 **零回归** + WP4 新增 30） |
| `npx jest test/engine-adapters` | 1 套件 / 13 用例全绿（WP2 B 层，本期未动） |

`pnpm build` 全量构建与既有业务测试本轮未跑（本期零 entity / migration / module 改动，内核未被 `app.module.ts` 引用）。

### 13.2 与本单的差异（须知会）

| # | 差异 | 理由 |
|---|---|---|
| 1 | **等级比较统一走 `maxSafetyLevel`**（`safety-types.ts` 一处） | 规则引擎 / 探测合并 / 报告聚合三处都要比"谁更严重"，各写一份 `block > warn > pass` 必然漂移 |
| 2 | **探测类别也参与等级判定** | 探测实现可能返回 `level='pass'` 却带 `suicide_plan` 类别（脏形状）；只信 level 会把高危降级。取三者最高（规则 / 探测 level / 类别经 `PSYGUARD_LEVEL_MAP` 归一）是安全方向 |
| 3 | **未知类别与 `neutral` 一律不入 `categories`** | `neutral` 是"无风险"标记不是"发现"；塞进类别列表会出现"命中类别：neutral"这种自相矛盾条目 |
| 4 | **命中片段截断 120 字** | 完整原文已在 WP2 工作记忆里；报告再抄一份全文等于把敏感对话复制进第二个存储面 |
| 5 | **超时计时器 `unref()`** | 否则"探测永不返回"时计时器会吊住 Node 事件循环 —— 进程该退出时退不出去（jest 报 "worker failed to exit gracefully"） |
| 6 | **种子词按真实口语形态列全** | 施工实测发现「我保证**你**能治好」里「保证」与「能治好」之间夹着「你」，只列 `保证能治好` 会漏判最常见说法。词典必须按真实说法写，不能只写一种形态 |
| 7 | **未用 `AbortSignal` 取消探测** | 探测实现可能不支持取消，强行 abort 会在实现侧留下未处理拒绝；改用 `Promise.race` + `node:timers` 计时器，探测实现零要求 |
| 8 | **`reason` 只给类别级中性说明** | 按 §11 待过目项：不做自然语言润色（润色属模型轨）；前缀走查表不用分支 |
| 9 | **`assessSafety` 的 `now` 字段本期未被使用** | 事件 `at` 由运行时自己的时钟记录；判定**不得**依赖时钟（同一条文本在不同轮次必须得到同一结论） |

### 13.3 已知缺口（下一轮需决策）

1. **报告随句柄释放**：`closeSession` 只删句柄登记，事件随之释放 —— 需要报告的调用方必须在 `closeSession` **之前**取走 `getSafetyReport`；报告落库/入档案属装配轮。
2. **无 PsyGUARD 真实实现**：只留 `RiskProbePort` 接口与降级路径；独立 Python FastAPI + B 层 HTTP 适配留装配轮。
3. **规则词典未标定**：本期只放最硬的种子词（宁可漏报给督导事后看，也不误拦日常训练对话）；扩充靠训练语料与误报样本回流。
4. **全半角/繁简不做归一**：种子词选常用写法，误报留后期。
5. **WP2 遗留两项另起单**：Qdrant 写侧冲突标记（需给 `QdrantService` 补 `setPayload`）、短时记忆自动写入与会话结束编排层接线。均与 WP4 无关，本期未动。
