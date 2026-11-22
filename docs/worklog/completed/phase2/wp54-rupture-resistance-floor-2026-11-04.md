# WP54 任务单 — 破裂态阻抗反升（跨会话衰减补完）

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp54-rupture-resistance-floor-implementation-2026-11-04.md`](engine-wp54-rupture-resistance-floor-implementation-2026-11-04.md)
> **路径**：`docs/worklog/pending/wp54-rupture-resistance-floor-2026-11-04.md`
> **优先级**：🟢 P2
> **引擎内核**：✅ 预批准改 engine-core（跨会话衰减算子扩展，与 WP36 同文件同范式）
> **前置依赖**：WP36（跨会话衰减）、WP42（同盟三维门槛）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 推理层

---

## 1. 任务概述

### 1.1 一句话目标

WP36 已交付「情绪 / 阻抗 / 同盟差异化半衰期回落」，但蓝图 §4.5 里的**「破裂态阻抗反升」没做**——现在不管上一场结束时是什么状态，阻抗都按 14 天半衰期自然回落。但真实场景里，如果上一场是"破裂"状态（trust 很低 / safety 很低），隔了一段时间回来，阻抗不应该完全回落——来访对咨询师还有怨气，防御姿态不会完全放下。本期补完这个分支：破裂态下，阻抗衰减有一个更高的下限，不会回落到正常水平。

### 1.2 为什么现在做

- WP36 交付记录自己登记了缺口：「破裂态阻抗反升本期未做 —— 缺破裂态阈值定义（不发明临床数字），待后续校准轮」
- 现在内测时会出现：上一场闹崩了（trust 0.2 / safety 0.1），隔了一周回来，阻抗从 0.9 回落到 0.6——但真实来访隔一周回来，怨气还在，阻抗应该还是硬的，甚至更硬
- 这是 WP36 的补完项，做完之后跨会话衰减机制才完整

---

## 2. 现状盘查结论（已 grep 全 engine-core 核实）

### 2.1 现有 session-decay.ts 结构

```ts
export interface SessionDecayConfig {
  readonly emotionHalfLifeMs: number;    // 情绪半衰期 7 天
  readonly resistanceHalfLifeMs: number; // 阻抗半衰期 14 天
  readonly allianceHalfLifeMs: number;   // 同盟半衰期 30 天
}
```

`applySessionDecay(snapshot, ageMs, config)` 的逻辑：
- 情绪：`valence / arousal *= emotionFactor`
- 阻抗：`verbal / depth / style *= resistanceFactor`
- 同盟：`trust / safety / bond *= allianceFactor`

**问题**：阻抗衰减是"一刀切"——不管上一场是什么状态，都按 14 天半衰期回落。

### 2.2 AllianceConfig.thresholds（破裂态判断依据）

```ts
export interface AllianceThresholds {
  readonly open: number;              // 探索门槛 0.6
  readonly resistanceTrust: number;   // 抗拒门槛（信任维）0.4
  readonly resistanceSafety: number;  // 抗拒门槛（安全感维）0.3
}
```

**破裂态定义**（复用既有门槛，不新造）：
```
破裂态 = snapshot.trust < resistanceTrust || snapshot.safety < resistanceSafety
```

—— 这条逻辑已经在 `intention-planner.ts` 里用来判断"当前是否倾向抗拒"，本期直接复用它作破裂态的定义。

### 2.3 调用位置

`applySessionDecay` 在 `in-memory-engine-session.ts` 的 resume 路径里被调用（跨会话接续时）。

### 2.4 boundary.spec.ts 白名单现状

- `SessionDecayConfig` 已在白名单（第 422 行）
- `applySessionDecay` 已在白名单（第 424 行）
- `cognition/session-decay.ts` 已在白名单（第 459 行）

**接口内部加可选字段不需要新增白名单条目**。

### 2.5 现有测试

- `test/engine-core/wp36-session-decay.spec.ts` —— 现有测试文件

---

## 3. 本期做什么

### 3.1 SessionDecayConfig 加一个可选参数

```ts
export interface SessionDecayConfig {
  readonly emotionHalfLifeMs: number;
  readonly resistanceHalfLifeMs: number;
  readonly allianceHalfLifeMs: number;
  /**
   * 破裂态阻抗下限 (工程种子值, 非临床标定).
   *
   * 当上一场结束时处于破裂态 (trust < resistanceTrust || safety < resistanceSafety),
   * 阻抗衰减后**不会低于这个值** —— 怨气还在, 防御不会完全放下.
   *
   * 缺省 = 0 (不启用, 行为与 WP36 完全一致).
   */
  readonly ruptureResistanceFloor?: number;
}
```

**为什么是可选不是必填**：
- 缺省 = 0 = 不启用破裂态下限，行为与 WP36 完全一致
- 现有的 `DEFAULT_SESSION_DECAY_CONFIG` 不用改（不传 = 不启用）
- 适配层要启用时，通过 env 注入这个值

### 3.2 DEFAULT_SESSION_DECAY_CONFIG 不用改

缺省 = 不启用破裂态下限，零回归。

### 3.3 applySessionDecay 加一个可选参数

```ts
export function applySessionDecay(
  snapshot: BdiSnapshot,
  ageMs: number,
  config?: SessionDecayConfig,
  allianceThresholds?: AllianceThresholds,  // 新增：用来判断是否破裂态
): BdiSnapshot
```

**为什么加这个参数而不是硬编码门槛**：
- 门槛值的真相源是 `AllianceConfig.thresholds`（WP42 加的），不应该在 session-decay.ts 里再写一份
- 复用既有门槛 = 单一真相源，不会漂移

### 3.4 加破裂态分支逻辑

在现有阻抗衰减的基础上，加一个分支：

```ts
// 现有逻辑（正常状态）：
const verbal = clamp01(base.resistance.verbal * resistanceFactor);
const depth = clamp01(base.resistance.depth * resistanceFactor);
const style = clamp01(base.resistance.style * resistanceFactor);

// 新增：破裂态下限
const floor = config?.ruptureResistanceFloor ?? 0;
const isRuptured = allianceThresholds
  ? snapshot.trust < allianceThresholds.resistanceTrust || snapshot.safety < allianceThresholds.resistanceSafety
  : false;

const finalVerbal = isRuptured ? Math.max(verbal, floor) : verbal;
const finalDepth = isRuptured ? Math.max(depth, floor) : depth;
const finalStyle = isRuptured ? Math.max(style, floor) : style;
```

**口径说明**：
- 破裂态下，阻抗衰减后**不会低于 floor**
- 不是"反升到 floor"——而是"衰减到 floor 就不再往下了"
- 如果正常衰减后的值已经高于 floor，就按正常衰减后的值（不强行抬升）

### 3.5 种子值（工程种子值，待校准）

`ruptureResistanceFloor` 的缺省值是 0（不启用）。
如果要启用，建议工程种子值是 0.7（破裂态下阻抗最少保持在 0.7，不会回落到 0.3）。

⚠️ 全部是**工程种子值，非临床标定**——内测后按真实对练校准。

---

## 4. 边界问题补充

### 4.1 ⚠️ 破裂态的判断门槛为什么复用 AllianceConfig.thresholds？

**不新造阈值**。理由：
- WP42 已经有 `resistanceTrust: 0.4` / `resistanceSafety: 0.3` 这两个门槛
- 它们本来就是用来判断"当前是否倾向抗拒"的
- 破裂态 = 严重的抗拒状态，复用同一套门槛是合理的
- 新造一套阈值 = 两个真相源，迟早会漂移

### 4.2 ⚠️ 破裂态下情绪 / 同盟要不要也加下限？

**本期不做**。理由：
- 情绪是最易平复的——隔一周，哪怕是破裂状态，情绪也会自然平复
- 同盟是最持久的——trust / safety / bond 本来就有 30 天半衰期，衰减很慢
- 只有阻抗是"破裂态下不回落"的——防御姿态是练出来的，不会因为隔了一周就放下
- 不发明临床数字——先只补阻抗这一维，内测后看数据再决定要不要给情绪 / 同盟也加下限

### 4.3 ⚠️ 破裂态下限是"衰减下限"还是"反升"？

**是衰减下限，不是反升**。理由：
- "反升"意味着阻抗比上一场结束时还高——这太极端了
- 更合理的是：隔了一周，阻抗会自然回落一点，但不会回落到正常水平——有一个下限兜住
- 如果正常衰减后的值已经高于 floor，就按正常衰减后的值（不强行抬升）

### 4.4 ⚠️ SessionDecayConfig 为什么不把门槛值也放进来？

**门槛值的真相源是 AllianceConfig.thresholds**。如果在 SessionDecayConfig 里再写一份 `ruptureTrustThreshold` / `ruptureSafetyThreshold`，就有两个真相源了——用户调 AllianceConfig.thresholds 时，session-decay 里的门槛不会跟着变，就会漂移。

所以加一个 `allianceThresholds` 参数，由调用方传进来，复用既有门槛。

---

## 5. 边界约束

### 5.1 engine-core 预批准例外（1 个文件 + 1 个测试）

1. `src/engine-core/cognition/session-decay.ts` —— SessionDecayConfig 加可选参数 + applySessionDecay 加破裂态分支
2. `test/engine-core/wp36-session-decay.spec.ts` —— 扩展测试用例

必须通过 `boundary.spec.ts` 的断言：零 @nestjs / 零网络 / 零 env / 零 prompt。

> 注：`boundary.spec.ts` 白名单已有 `SessionDecayConfig` / `applySessionDecay` / `cognition/session-decay.ts` 三个条目，接口内部加可选字段不需要新增白名单条目。

### 5.2 不碰的地方

- ❌ 不改 `AllianceConfig.thresholds`（门槛值是既有真相源）
- ❌ 不改 `DEFAULT_SESSION_DECAY_CONFIG`（缺省 = 不启用，零回归）
- ❌ 不改情绪 / 同盟的衰减逻辑（只补阻抗的破裂态下限）
- ❌ 不改 `in-memory-engine-session.ts` 的调用方式（新增参数是可选的，不传 = 行为不变）
- ❌ 不做破裂态下情绪 / 同盟的下限（留后续）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 正常状态（trust 高 / safety 高）：隔一周，阻抗按 14 天半衰期正常回落，和 WP36 完全一致（零回归）
- [ ] 破裂状态（trust < 0.4 || safety < 0.3）：隔一周，阻抗衰减后不会低于 `ruptureResistanceFloor`
- [ ] 破裂状态 + 不传 `allianceThresholds`：行为和正常状态完全一致（不启用破裂态判断）
- [ ] 不传 `ruptureResistanceFloor` 或传 0：行为和 WP36 完全一致（不启用下限）
- [ ] 破裂状态下，阻抗衰减后的值如果本来就高于 floor，就按正常衰减后的值（不强行抬升）

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只有 1 个文件（session-decay.ts）

### 6.3 内核测试用例要求

扩展文件：`test/engine-core/wp36-session-decay.spec.ts`

至少补充：
1. 正常状态（高 trust / 高 safety）：阻抗按半衰期正常回落，和 WP36 一致
2. 破裂状态（低 trust / 低 safety）：阻抗衰减后不低于 floor
3. 破裂状态 + floor = 0：行为和正常状态一致（不启用下限）
4. 破裂状态 + 不传 allianceThresholds：行为和正常状态一致（不启用破裂态判断）
5. 破裂状态 + 正常衰减后的值本来就高于 floor：按正常衰减后的值，不强行抬升

---

## 7. 本期没做的（明确留给后续）

1. **破裂态下情绪 / 同盟的衰减下限** —— 先只补阻抗，内测后看数据再决定
2. **破裂态阻抗"反升"（比上一场还高）** —— 本期是"衰减下限"，不是"反升"。如果内测发现需要反升，再加
3. **适配层 env 接线** —— 端口已就位，env 留空继承内核种子值（不启用），内测后再调
4. **跨会话衰减的人格调节** —— 人格影响的是建立速度，不是保持时长，不做

---

## 8. 转述给后端的话术

> WP54：破裂态阻抗反升（跨会话衰减补完）。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp54-rupture-resistance-floor-2026-11-04.md`。
>
> 预批准改 engine-core，只改 1 个内核文件：
> - `cognition/session-decay.ts` —— SessionDecayConfig 加可选参数 `ruptureResistanceFloor` + applySessionDecay 加可选参数 `allianceThresholds` + 破裂态分支逻辑
>
> 关键口径：
> - `ruptureResistanceFloor` 是**可选**参数，缺省 = 0 = 不启用，行为和 WP36 完全一致
> - 破裂态判断**复用 AllianceConfig.thresholds**（resistanceTrust / resistanceSafety），不新造门槛
> - 是"衰减下限"不是"反升"——阻抗衰减后不会低于 floor，但如果本来就高于 floor，就按正常值
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 如果真要改 engine-core 的其他地方，先和我确认，不要自己拍板。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`SessionDecayConfig` 接口 / `applySessionDecay` 函数 / `AllianceConfig.thresholds` 门槛 / boundary.spec.ts 白名单 / 调用位置，全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §5.1 改 2 个文件（1 内核 + 1 测试） | **完全一致**（零意外） | 本单只加一个**可选**字段 + 一个**可选**参数，不碰 env 面、不改接口的必填性 → 既有调用方（`in-memory-engine-session.ts`）**一行不用改**，适配层 `session-decay.config.ts` 也**一行不用改** |
| 2 | §3.3 第 4 参 `allianceThresholds?: AllianceThresholds` | **一致**（参数名与类型都照办） | 备选方案（传整个 `AllianceConfig`）被否：会让签名偏离任务单与用户话术里点名的参数名，收益只省一个空壳对象 |
| 3 | §3.4 草图直接用 `allianceThresholds.resistanceTrust` 比较（**无校验**） | **补了校验** —— 复用 `resolveAllianceThresholds` | 照抄的话，调用方传越界门槛（如 `resistanceTrust: 5`）会让「trust < 5」恒真 → **破裂态恒成立** → 阻抗永远被兜住。本单只允许改 1 个内核文件（不能改 `alliance-config.ts`）→ 构造 `{ deltas: {}, thresholds }` 空壳过一遍既有校验，**不复制 `sanitizeThreshold`**（门槛校验的唯一真相源在 `alliance-config.ts`） |
| 4 | 任务单未写 `ruptureResistanceFloor` 的校验口径 | **非法 → 回退 0（禁用）** | floor 不是半衰期，**没有内核种子值可退**；且 >1 是**方向性错误**（阻抗被 clamp 在 [0,1]，`Math.max` 会把它顶出合法区间，「衰减」变「抬升」）。回退 0 = 退回 WP36 裸衰减，方向永远正确 |
| 5 | §3.2 `DEFAULT_SESSION_DECAY_CONFIG` 不用改 | **一致**，但登记了具体后果 | 适配层 `test/engine-adapters/wp36-session-decay-config.spec.ts` 有 **2 处** `expect(config).toEqual(DEFAULT_SESSION_DECAY_CONFIG)` —— 若把 `ruptureResistanceFloor: 0` 写进种子对象，**这两处会红**（`toEqual` 比完整对象）。种子保持 3 字段，缺省走 `undefined` 分支 → 0 → 禁用 |
| 6 | §2.2 说「这条逻辑已经在 `intention-planner.ts` 里」，但该处实际还有阻抗聚合前提（`aggregate >= 0.6`） | **只取 `allianceLow`**，不含聚合前提 | 聚合前提回答的是「**本轮意图**要不要选抗拒策略」，跨会话衰减回答的是「**一场开始前**的状态要不要兜底」—— 两个问题。且 resume 那一刻还没有「本轮意图」，套聚合前提会让「上一场阻抗低但关系破裂」的状态**兜不住**，而那恰恰最该兜 |
| 7 | §3.4 判定用 `snapshot.trust` / `snapshot.safety` | **读 `base.trust` / `base.safety`**（逐字相同：此刻 `base` 还是衰减前的 clone） | 语义是「上一场结束时的状态」。判定若用**衰减后**的值，会把「隔得越久越算破裂」写进内核（衰减后 trust 必然更低）。用例专门钉这条 |
| 8 | §3.4「是衰减下限，不是反升」 | **一致** —— 用 `Math.max` 不用赋值 | 已高于 floor 的值保持不变；用例双向断言（等于正常衰减值 **且** 低于上一场原值） |
| 9 | §4.2 情绪 / 同盟不加下限 | **一致** | 用例钉死：破裂态 + floor 0.7 时 `valence` 恰好减半、`trust` 仍 < 0.2 —— 没有任何下限 |
| 10 | §6.3 测试用例要求 5 条 | **扩到 13 例** | 补：隔 365 天仍兜得住 / 判定用衰减前的值 / 情绪同盟无下限 / 非法 floor 回退且不越界 / 非法门槛回退种子门槛 / 破裂态下值语义 / 正常态零回归 / 不传 floor 零回归 |
| 11 | §2.4 boundary 白名单行号 422 / 424 / 459 | **完全一致**（逐行核实） | 白名单早已有这三个条目 → 接口内部加可选字段不需要新增 → `boundary.spec.ts` **12 例零改动**通过 |
| 12 | §7 第 3 条「适配层 env 接线」本期不做 | **一致**，但把「生产上不生效」写明 | 适配层仍只装配 3 个 `ENGINE_DECAY_*` 键（floor 恒 `undefined` → 禁用）；`in-memory-engine-session.ts` 仍只传 3 个参数（不启用破裂态判断）→ **生产行为逐字不变**。要看到实际效果，后续 WP 需**同时**做「接 env」+「传门槛」，只做一件不生效 |

> 本期**没做**的（破裂态的情绪 / 同盟下限 / 阻抗真「反升」/ 适配层 env 接线 / 跨会话衰减的人格调节 / 破裂态判定接入阻抗聚合前提）已在交付记录 §4 逐条留档。
>
> ⚠️ 提醒：本期只把**内核机制**做完并用测试钉死，**适配层与调用方一行没改** → 生产上这条下限**暂时不生效**（缺省 0 = 禁用）。
