# WP54 交付记录 — 破裂态阻抗反升（跨会话衰减补完）

> 状态: ✅ 已交付
> 任务单: [`wp54-rupture-resistance-floor-2026-11-04.md`](wp54-rupture-resistance-floor-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ⚠️ **engine-core 已改（预批准例外）** —— `git diff --stat HEAD -- src/engine-core` 含 **1 个文件**（`cognition/session-decay.ts`），**无其他文件**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：1 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/cognition/session-decay.ts` | ① `SessionDecayConfig` 加 `ruptureResistanceFloor?: number` 一个**可选**字段（各带口径注释：缺省 = 0 = 不启用；合法取值 [0,1]）；② `applySessionDecay` 加第 4 个可选参数 `allianceThresholds?: AllianceThresholds`；③ 新增 4 个私有 helper —— `sanitizeRuptureFloor` / `resolveThresholdSubset` / `isRupturedState` / `applyRuptureFloor`；④ 破裂态分支：阻抗三维衰减后过 `Math.max(value, floor)`；⑤ import 加 `resolveAllianceThresholds` / `type AllianceThresholds`；⑥ 文件头加 WP54 段（口径 / 缺省语义 / 为什么要复用既有门槛） |

### 1.2 测试：1 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp36-session-decay.spec.ts` | **扩展**：新增「WP54 · 破裂态阻抗衰减下限 (纯函数)」describe 块 **13 例**；新增 `makeRupturedSnapshot()` 助手 + `THRESHOLDS` 常量；import 补 `DEFAULT_ALLIANCE_CONFIG` / `type AllianceThresholds`；文件头补 WP54 段（8 条断言口径） |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp54-rupture-resistance-floor-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP54 行 ✅ + 交付记录链接；统计进度 9/35 → 10/35；engine-core 例外表 +WP54 行 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP54；进度回写 10/35；目录结构说明 +WP54 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 决策：第 4 参的**类型形态**照任务单，但门槛**校验**复用 `resolveAllianceThresholds`

任务单 §3.3 给的签名是 `allianceThresholds?: AllianceThresholds`（传**门槛对象**，调用方自己从 `AllianceConfig` 里取）。**照办** —— 参数名与类型都按任务单来。

但**校验方式**做了一个调整：任务单 §3.4 的草图直接用 `allianceThresholds.resistanceTrust` 比较，**没有任何校验**。如果照抄，调用方传一个越界门槛（比如 `resistanceTrust: 5`）就会让「trust < 5」恒真 → **破裂态恒成立** → 阻抗永远被兜住。

复用 `alliance-config.ts` 的 `resolveAllianceThresholds` 来校验，但那个函数收的是 `AllianceConfig`（要 `.thresholds`），不是 `AllianceThresholds`。本单只允许改 1 个内核文件，**不能改 `alliance-config.ts`** —— 于是构造一个空壳过一遍：

```ts
function resolveThresholdSubset(thresholds: AllianceThresholds | undefined): AllianceThresholds | undefined {
  if (!thresholds) return undefined;
  return resolveAllianceThresholds({ deltas: {}, thresholds });
}
```

**为什么绕这一圈而不是复制一份 `sanitizeThreshold`**：门槛校验的**唯一真相源**在 `alliance-config.ts`。复制一份就是第二个真相源 —— 两个真相源迟早漂移（仓库「反双胞胎」纪律要防的正是这个）。`AllianceConfig.deltas` 在这一步用不到（内核不读它），传空表即可。

> 备选方案（传整个 `AllianceConfig`）被否掉了：那会让 `applySessionDecay` 的签名偏离任务单 §3.3 与用户话术里点名的 `allianceThresholds` 参数名，而收益只省掉一个空壳对象。

### 2.2 决策：`ruptureResistanceFloor` 的 sanitize 口径 —— 非法 → 回退 **0（禁用）**

任务单没写这个字段的校验口径（只说「缺省 = 0」）。本单补上，**回退目标是 0 而不是某个种子值**。

**为什么没有种子值可退**：floor 是一把「至少保留多少阻抗」的刻度，它**不是半衰期** —— 半衰期有「7 / 14 / 30 天」这套内核种子，floor 没有（任务单 §3.5 建议的 0.7 是「**建议启用时**的工程种子」，本期不启用）。

**为什么 >1 必须当非法值而不是 clamp 到 1**：阻抗三维被 `clamp01` 在 [0,1]，若 floor = 1.5，破裂态下 `Math.max(0.64, 1.5) = 1.5` 会把阻抗**顶出合法区间** —— 那是方向性错误（「衰减」变成「抬升」）。回退到 0（禁用）= 退回 WP36 的裸衰减，方向永远正确。

**为什么 <0 / NaN 也当非法**：同上，负 floor 语义上无意义（阻抗不可能是负的），NaN 会污染整份快照。

用例把这条钉死：`floor = 1.5 / -0.2 / NaN` 三种非法值 → 行为与 WP36 **逐字一致**，且阻抗 `<= 1`（不会越界）。

### 2.3 决策：`DEFAULT_SESSION_DECAY_CONFIG` 保持 **3 个字段** —— 并登记一个具体后果

任务单 §3.2 明写「不用改」，照做。但**这里有个具体后果，必须写下来**：

适配层 `src/engine-adapters/wiring/session-decay.config.ts` 只装配 3 个 `ENGINE_DECAY_*` 键，返回的对象**没有** `ruptureResistanceFloor` 字段；而 `test/engine-adapters/wp36-session-decay-config.spec.ts` 有 **2 处** `expect(config).toEqual(DEFAULT_SESSION_DECAY_CONFIG)`。

→ **如果把 `ruptureResistanceFloor: 0` 写进 `DEFAULT_SESSION_DECAY_CONFIG`，这两处断言会红**（`toEqual` 比的是完整对象，缺键 / 多键都不相等）。

所以种子对象保持原样，缺省走 `config?.ruptureResistanceFloor` 的 `undefined` 分支 → `sanitizeRuptureFloor` → 0 → 禁用。**零回归**。

### 2.4 决策：破裂态判定只看**上一场结束时**的 trust / safety，**不含** intention-planner 的阻抗聚合前提

`intention-planner.ts:55` 那句判定是：

```ts
const allianceLow = snapshot.trust < thresholds.resistanceTrust || snapshot.safety < thresholds.resistanceSafety;
```

而它真正选「抗拒策略」时还有**另一个**前提：`aggregate >= HIGH_RESISTANCE_AGG (0.6)`（阻抗三维平均）。

本单**只取 `allianceLow`**，不含聚合前提。理由：

- 任务单 §2.2 / §3.4 明确把破裂态定义成 `trust < resistanceTrust || safety < resistanceSafety`，§3.4 的代码草图也是这么写的；
- 聚合前提回答的是「**本轮意图**要不要选抗拒策略」，而跨会话衰减回答的是「**一场开始前**的状态要不要兜底」—— 两个不同的问题；
- 跨会话衰减发生在 resume 那一刻，那时还没有「本轮意图」，套聚合前提会让「上一场阻抗低但关系破裂」的状态**兜不住** —— 而那恰恰是最该兜的一种。

### 2.5 决策：判定读的是**衰减前**的值（`base.trust` / `base.safety`）

任务单 §3.4 写的是 `snapshot.trust` / `snapshot.safety` —— 传入的**上一场快照**。本单实现读 `base.trust` / `base.safety`（`base = cloneBdiSnapshot(snapshot)`，此刻还是衰减前的原值，与 `snapshot` 逐字相同）。

**为什么这条值得单独钉**：判定用**衰减后**的 trust / safety 会把「隔得越久越算破裂」写进内核 —— 因为衰减后 trust 必然更低。于是「上一场结束时信任 0.45（> 0.4，没破裂）、隔 60 天回来」会被判成破裂，阻抗被无端兜住。

用例专门钉这一条：上一场 trust 0.45 / safety 0.5（都不破裂）→ 隔 60 天后 trust 衰减到 0.1125（**已跌破门槛**）→ 但阻抗**照常裸衰减**，没被兜到 0.5。

### 2.6 决策：情绪 / 同盟**不加下限**（任务单 §4.2，照做）

破裂态下情绪照常按 7 天半衰期平复，同盟照常按 30 天半衰期回落 —— 只有阻抗有下限。用例钉死（⑥ 组）：破裂态 + floor 0.7 时，`valence` 恰好减半（-0.4）、`trust` 仍小于 0.2，**没有任何下限**。

### 2.7 决策：破裂态下**不抬升**（是「衰减下限」，不是「反升」，任务单 §4.3，照做）

用的是 `Math.max` 而不是赋值 —— 已经高于 floor 的值**保持不动**。用例双向断言：floor = 0.3 时阻抗等于正常衰减值，**且** `toBeLessThan` 上一场的原值（0.9 / 0.8 / 0.7）—— 即阻抗只会比上一场更低，不会被抬上去。

### 2.8 决策：破裂态快照的数值选得「刚好只有一维会被兜」

`makeRupturedSnapshot()` 的阻抗取 0.9 / 0.8 / 0.7，隔 7 天（阻抗半衰期 14 天）各走半程：

```
verbal = 0.9 * 2^(-0.5) ≈ 0.6364   (> 0.5 → 不被兜)
depth  = 0.8 * 2^(-0.5) ≈ 0.5657   (> 0.5 → 不被兜)
style  = 0.7 * 2^(-0.5) ≈ 0.4949   (< 0.5 → 被兜到 0.5)
```

这样**一组断言就能同时钉死两件事**：「会跌破的被兜住」+「没跌破的不被强行抬升」。如果三维都取同一个值，这两件事就会互相掩盖（要么全兜、要么全不兜）。

### 2.9 决策：测试里的门槛**直接取内核种子配置**，不另造一份

```ts
const THRESHOLDS: AllianceThresholds = DEFAULT_ALLIANCE_CONFIG.thresholds;
```

理由与 §2.1 同源：测试与内核各写一份门槛 = 两个真相源，门槛调了测试不会跟着走，反而会给出「内核用新门槛、测试还用旧门槛」的假绿。

### 2.10 ⚠️ 留档：生产上这条下限**目前不生效**

本单**只做内核机制 + 测试**，适配层与调用方**一行没改**：

- 适配层 `src/engine-adapters/wiring/session-decay.config.ts` 仍只装配 3 个 `ENGINE_DECAY_*` 键 → `ruptureResistanceFloor` 恒 `undefined` → 缺省 0 → **禁用**；
- `in-memory-engine-session.ts` 的 resume 分支仍只传 3 个参数 → **不启用破裂态判断**；
- 本期**不接 env**（任务单 §7 第 3 条）→ 不改 `.env.example` / `typings/global.d.ts` / `test/config/wp25-env-example-coverage.spec.ts`。

所以本单交付的是「**内核机制已就位且被测试钉死**」，生产行为**逐字不变**。要看到实际效果，需要后续 WP 同时做两件事：适配层接 env + 调用方把 `AllianceConfig.thresholds` 传进来。**只做一件不生效**（不传门槛 = 不判断破裂态；不配 floor = 不启用下限）。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **95 个测试文件 / 1480 例全绿**（WP52 基线 95 文件 / 1467 例 + 本轮新增 **13 例**，**零回归**：1467 + 13 = 1480 ✓） |
| `npx vitest run test/engine-core/wp36-session-decay.spec.ts` | **34 例全绿**（原 21 例 + 本轮新增 **13 例**） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（边界断言全过：零 @nestjs / 零网络 / 零 env / 零 prompt） |
| `git diff --stat HEAD -- src/engine-core` | **1 个文件**（`cognition/session-decay.ts`）—— **正是任务单 §6.2 要求的范围，无其他** |

**回归确认**：

- **不传 floor** → 破裂态也与 WP36 逐字一致（缺省即禁用，零回归）；
- **floor = 0** → 破裂态也与 WP36 逐字一致；
- **不传 `allianceThresholds`** → 破裂态也与 WP36 逐字一致（不启用破裂态判断，不拿种子门槛去猜）；
- **正常态**（trust / safety 都在门槛之上）+ floor 0.7 → 阻抗 / 同盟 / 情绪与 WP36 **逐字一致**；
- **破裂态** → 阻抗三维衰减后**不低于 floor**（floor 0.5 / 0.7 / 0.6 三档都验过，含隔 365 天）；
- **不强行抬升** → 已高于 floor 的值保持正常衰减值，且阻抗**低于**上一场原值；
- **判定用衰减前的值** → 上一场不破裂、衰减后跌破门槛 → **不兜底**；
- **情绪 / 同盟无下限** → 破裂态下仍照常衰减；
- **非法 floor（1.5 / -0.2 / NaN）** → 回退 0（禁用），阻抗不越界；
- **非法门槛（-1）** → 回退内核种子门槛（0.4 / 0.3），不是照着越界值判；
- **值语义** → 破裂态下传入的快照也不被就地修改；
- WP36 既有 **21 例**内核用例**全部保留**（只加组，未改任何既有断言）；
- `boundary.spec.ts` 白名单**无需新增条目**（`SessionDecayConfig` / `applySessionDecay` / `cognition/session-decay.ts` 三个条目**早已在列**，行号 422 / 424 / 459 与任务单 §2.4 记的**完全一致**）—— 接口内部加可选字段不需要新增白名单条目。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **破裂态下情绪 / 同盟的衰减下限**（任务单 §4.2）—— 情绪最易平复，同盟本就有 30 天半衰期；先只补阻抗一维，内测后看数据再定。
2. **破裂态阻抗「反升」（比上一场还高）**（任务单 §7 第 2 条）—— 本期是**衰减下限**。内测发现需要反升再加。
3. **适配层 env 接线**（任务单 §7 第 3 条）—— 端口已就位，env 留空继承内核缺省（= 不启用）。见 §2.10：**不接 env = 生产上这条下限不生效**。
4. **跨会话衰减的人格调节**（任务单 §7 第 4 条）—— 人格影响的是建立速度，不是保持时长。
5. **破裂态判定接入 `intention-planner` 的阻抗聚合前提**（任务单 §2.2 未要求）—— 见 §2.4。

---

_创建：2026-11-04_
_深度通知：任务单 §2.1（现有 `SessionDecayConfig`）/ §2.2（`AllianceConfig.thresholds` 与 `intention-planner` 的同款判定）/ §2.3（调用位置）/ §2.4（boundary 白名单行号）/ §3.1–§3.5（本期做什么）/ §4.1–§4.4（边界问题补充）/ §5.2（不碰的地方）/ §6.1–§6.3（验收与用例要求）逐条核实 + 真实代码 grep（`applySessionDecay` 调用点 / `resolveAllianceThresholds` 与 `sanitizeThreshold` 实现 / `DEFAULT_SESSION_DECAY_CONFIG` 消费点与适配层 `toEqual` 断言 / `clamp01` 行为 / 白名单实际行号）_
