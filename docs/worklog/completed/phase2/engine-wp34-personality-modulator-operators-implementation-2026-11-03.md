# WP34 交付记录 · P1 人格调节算子（依恋调节 + 人格特质调节）

> 状态: ✅ 已交付
> 任务单: [`wp34-personality-modulator-operators-2026-11-03.md`](wp34-personality-modulator-operators-2026-11-03.md)
> 日期: 2026-11-03
> 红线: **engine-core 预批准例外**（已在 Phase2 WP 清单「engine-core 红线例外（预批准）」表登记）—— 改完 `boundary.spec.ts` **11 条断言全绿**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**` —— 预批准例外：4 改 + 1 增）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/cognition/personality-modulator.ts` | **新增**：人格调节算子 —— `PersonalityModulatorConfig` 端口 / `DEFAULT_PERSONALITY_MODULATOR_CONFIG` 种子值 / `modulateDeltaByPersonality` 纯函数 |
| `src/engine-core/cognition/state-transition.ts` | 管道加一环：**聚合 → 人格调节 → cap → 落快照**；`TransitionStateOptions` 加 `personality?`；cap 报告的 raw 口径改为「人格调节后」 |
| `src/engine-core/domain/character-profile.ts` | 新增 `PersonalityTraits`（大五，5 项可缺省）+ `CharacterProfile.personalityTraits?` |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | 构造注入 `personalityModulatorConfig?`；turn 里**两处**消费人格调节（临时快照 + 落库路径），共用同一个纯函数 |
| `src/engine-core/index.ts` | barrel 追加 7 个公开符号（WP26 P2-16 同款理由：进公开出口才被断言⑥守住） |

### 1.2 适配层（`src/engine-adapters/**`）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/personality-modulator.config.ts` | **新增**：`resolvePersonalityModulatorConfig(config)` —— 10 个 `ENGINE_MOD_*` 键**逐个字面量**读，非法一律回退内核种子值（照 `delta-cap.config.ts` 范式） |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineSessionCapDeps` → `EngineSessionTuningDeps`（多了人格系数，名字得跟职责一致）；`createEngineSessionPort` 第三个参数改为 `tuning`，透传 `personalityModulatorConfig` |
| `src/engine-adapters/wiring/engine.module.ts` | `ENGINE_SESSION_PORT` 的 useFactory 追加 `personalityModulatorConfig: resolvePersonalityModulatorConfig(config)` |

### 1.3 配置

| 文件 | 改了什么 |
|---|---|
| `.env.example` | 新增 10 个 `ENGINE_MOD_*` 生效行（**故意留空** = 继承内核种子值，见 §2.6） |
| `typings/global.d.ts` | 显式声明 10 个 `ProcessEnv` 键（仓库约定：不用计算键 / bracket 访问绕过） |

### 1.4 测试

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp34-personality-modulator.spec.ts` | **新增**：20 例（四种依恋差异化 / 基准零回归 / 边界回落 / 宜人性规则 / 端口注入 / cap 顺序 / 会话层两处一致） |
| `test/engine-adapters/wp34-personality-modulator-config.spec.ts` | **新增**：4 例（env 组装 / 10 键生效 / 非法回退 / 单键不连坐） |
| `test/engine-core/boundary.spec.ts` | 断言⑥ `expectedPublic` 追加 7 个符号；断言⑦ 目录清单追加 `cognition/personality-modulator.ts` |
| `test/config/wp25-env-example-coverage.spec.ts` | 新增断言③c：10 个 `ENGINE_MOD_*` 键已是字面量读取，且**内核树零 `ENGINE_MOD_*` 字符串** |

---

## 2. 关键设计决策（跟任务单有出入的地方 + 为什么）

### 2.1 接入点：任务单写的 `processEvent()` 在代码里不存在

任务单 §3.3 写的调用链是 `processEvent() → 基础算子 → 人格调节算子`。**代码里没有 `processEvent()`** —— 真实内核链是：

```
aggregateTurnDelta(events) → capTurnDelta → applyDeltaVector
```

落点定在 **聚合之后、cap 之前**：

- cap 是「一回合最多动多少」的**最后一道尺子**，调节若排在 cap 之后，就能把被砍掉的量再加回来，cap 的保证当场作废；
- 顺序固定为：**先按角色调幅度，再限总量**。

### 2.2 只调「靠近方向」：trust 增益 + 阻抗下降；受损方向不调

两条调节方向**都只作用于「来访向靠近方向」的变化**：

- trust：**只调增益**（`delta.trust > 0` 才乘系数）。蓝图原话是「信任**提升**系数」（`docs/reference/bdi-cognitive-engine-principles-v1.0.md:202`），任务单 §3.1 也只写「信任涨得慢 / 涨得快」。**信任受损方向不调** —— 任务单没给惩罚系数，不发明临床数字。
- 阻抗：**只调下降**（`delta.verbal/depth/style < 0` 才除系数），理由同上。

副作用（明确登记）：一个回合若同时含共情与评判，净 trust 为负 → 信任增益方向不生效。

### 2.3 阻抗系数的方向：为什么是「÷ 系数」而不是「× 系数」

任务单 §3.1 的「阻抗调节」列是**水平**语义的系数（回避型 1.3 = 阻抗更高），而内核算子只算**变化量**。两者不能直接对齐，实现口径定为：

> **阻抗下降量 ÷ 阻抗系数**（系数越大 = 阻抗越「守得住」= 越不容易被撬动）

依据是蓝图对回避型的行为描述：「回避依恋型来访，收到共情后……**不会快速敞开心扉**」（同上 `:202`）。若按字面直乘（回避型 ×1.3），回避型在共情时阻抗反而**降得更快**（−0.08 → −0.104），与蓝图直接相反。

代价要说清楚：阻抗**水平**（基线高低）不由本算子负责 —— 角色种子已经承担（wp9a 已断言「回避型阻抗高于焦虑型」）；本算子只管**变化快慢**。另外「阻抗上升」方向不调，所以回避型受评判时的阻抗升幅与安全型相同（不发明惩罚系数）。

### 2.4 回避型 trust 系数：按任务单 0.6，不按蓝图 0.5

蓝图 `:202` 写「信任提升系数打 5 折」（= 0.5），任务单 §3.1 表里是 **0.6**。**以任务单为准**（本单契约），蓝图是更早的参考稿。两者差 0.1，量级一致，不影响方向。

### 2.5 只调事件 delta，不调剧本 delta

剧本（trajectory）的 `node.delta` 是**作者写死**、且本就按角色分化的偏移；再叠一层人格系数等于把作者的设计乘两遍。事件 delta 才是「这一轮咨询师说了什么」带来的增量，它的幅度该随来访者的关系模式而异。

### 2.6 系数走端口注入，env 模板**留空**

照 WP26 P2-14 的 `DeltaCapConfig` 范式：内核零 `process.env`，只认端口；env 由适配层读好组装注入。

`.env.example` 里这 10 行**故意留空**（不写数值）—— 沿用 WP28 的教训：模板里再写一份内核种子值 = 多一份会漂移的真相源（内核改了模板没改 → 显式值会盖掉新种子）。留空 = 用内核种子值，要校准时才填数字。

> 顺带发现（**不在本单范围**）：相邻的 18 个 `ENGINE_CAP_*` 行原为**写死数值**（与内核种子重复），属同类漂移风险 —— 已于 2026-11-03 收尾清理（改为留空继承内核种子，见 §7）。

### 2.7 宜人性规则是「示例级精度」

任务单 §3.2：「实现『宜人性高 → **共情回应**的 trust 增量 ×1.1』这一条作为示例」。实现的规则：

- 宜人性 ≥ 阈值（默认 0.7）**且**本轮含 `empathy` 事件 → 本轮 trust 增益 × 1.1；
- 放大的粒度是**本轮的 trust 增益**，不是「只放大共情那一条事件的增益」（后者要逐事件 delta，会把内核的 delta 表拆散；任务单明说本期「先搭架子」）。

两条 trust 系数**相乘**（依恋 × 宜人性），不互相覆盖。

### 2.8 cap 报告的 raw 口径改为「人格调节后」

调节带来的变化不该混进「砍幅」里 —— 否则运维会把人格调节当成 cap。`buildDeltaCapReport` 的 raw 传入调节后的 delta。

### 2.9 会话层两处消费，必须口径一致

会话层有**两处**吃事件 delta：

1. `provisional = transitionState(...)` —— 临时快照，供意图规划与轨迹触发判定；
2. 落库路径 `eventDelta → addDeltaVectors(剧本) → cap → applyDeltaVector`。

两处都调同一个纯函数 `modulateDeltaByPersonality`（会话层直接调，`transitionState` 内部也调同一份），并有单测钉死「无剧本时落库快照 == `transitionState` 的结果」。

### 2.10 情绪维度（valence / arousal）本期不调

任务单 §3.1 的系数表只给了 trust 与阻抗两列，没有情绪系数 —— **不发明临床数字**。valence/arousal/移情三维本期逐字不变。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | **0 error**（本轮新增/修改的测试文件单独 lint 也 0 error） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| `npx vitest run` | **全绿**：91 文件（87 passed \| 4 skipped）/ **1321 例**（1306 passed \| 15 skipped），较基线（89 文件 / 1296 例）**+2 文件 / +25 例** |
| `git diff --stat HEAD -- src/engine-core` | 预批准例外，非空：<br>`state-transition.ts` +55 / `character-profile.ts` +24 / `in-memory-engine-session.ts` +52 / `index.ts` +14，另有**新增** `cognition/personality-modulator.ts`（未跟踪文件不在 `git diff` 里） |
| `boundary.spec.ts` | **11 条断言全绿**（断言⑥ 白名单已同步 7 个新符号；断言⑦ 目录清单已同步新文件） |
| `wp25-env-example-coverage.spec.ts` | 全绿（新增断言③c） |

> **既有时序 flake（非本轮引入）**：首轮全量跑时 `test/counselor/wp21-report-stream.spec.ts` 挂了 1 例（`status: 'timeout'` vs `completed`）。单独跑该文件 **15/15 绿**，全量复跑 **全绿**。该文件属「报告 SSE 推送」时序用例，与本轮改动无交集（WP28 期间已查实为同一类 flake，按「既有债不擅自修」处理）。

---

## 4. 影响面提示（生产行为变化）

**WP34 默认开启**（蓝图 P1 级算子的启用阶段就是「Phase2 默认」）。带 `attachmentStyle` 的角色（内置角色种子都带）行为随之变化：

| 依恋类型 | trust 增益系数 | 阻抗下降 ÷ 系数 | 同一句共情的实际效果（基准 trust +0.10 / verbal −0.08） |
|---|---|---|---|
| secure 安全型 | ×1.0 | ÷1.0 | trust +0.10 / verbal −0.080 |
| avoidant 回避型 | ×0.6 | ÷1.3 | trust **+0.06** / verbal **−0.0615** |
| anxious 焦虑型 | ×1.2 | ÷0.8 | trust **+0.12** / verbal **−0.100** |
| disorganized 混乱型 | ×0.8 | ÷1.2 | trust **+0.08** / verbal **−0.0667** |

没有 `attachmentStyle` 的角色**逐字不变**（系数全 1.0）。

⚠️ 系数是**工程种子值，非临床标定**（任务单 §3.1 原话）—— 内测期要用真实对练数据校准。env 覆盖通道已就位（10 个 `ENGINE_MOD_*` 键），改系数不用改代码。

---

## 5. 已知缺口与后续

| # | 缺口 | 影响 | 处置 |
|---|---|---|---|
| 1 | **大五人格没有数据源** —— DB 的 `character_profiles.five_ps` 是临床 5Ps（易感/维持/诱发/保护/持续），与大五人格不是一回事 | 宜人性规则在生产上**休眠**（契约与端口已就位，规则永不触发） | 已记 **WP49**：角色大五人格字段落地（DB 列 + 种子 + 适配层注入） |
| 2 | **系数未校准** —— 0.6 / 1.3 / 1.2 / 0.8 / 1.1 全是工程种子值 | 回避型角色的信任建立会明显变慢，需真实对练验证 | 内测期用 env 覆盖通道校准；任务单已声明「后续校准」 |
| 3 | **`.env.example` 里 18 个 `ENGINE_CAP_*` 仍写死数值**（与内核种子重复） | 与 WP28 修掉的 `PSYGUARD_TIMEOUT_MS` 同类漂移风险 | ✅ **已清理**（2026-11-03 收尾：18 行改留空 + 注释说明，见 §7） |
| 4 | **依恋 → 基线阻抗的缺省映射**没有统一规则 | 角色种子已按档位给基线（回避型 > 焦虑型，wp9a 有断言），但缺「按依恋类型取缺省值」的通用规则 | 随 WP49 一并评估；本轮不在范围内（会改既有角色基线） |
| 5 | 宜人性规则只精确到「本轮」而非「共情那一条事件」 | 混合回合（共情 + 评判）里整轮 trust 增益一起放大 | 任务单 §3.2 本就要求「先搭架子」；精确化留后续 |

---

## 6. 回写

- [x] 任务单 + 本交付记录 → `docs/worklog/completed/phase2/`
- [x] 任务单顶部状态行 → `✅`
- [x] `phase2-wp-list-2026-11-03.md`：WP34 状态 + 新开 WP49 + 计数同步
- [x] `phase2-overview-2026-11-03.md`：P2 计数 + P2-5 行
- [x] `docs/worklog/README.md`：计数 / 进度 / 交付链接

---

## 7. 追加收尾（2026-11-03 · WP49 ①：`.env.example` 的 cap 系数去重）

**改了什么**：`.env.example` 里 18 个 `ENGINE_CAP_*` 行的**数值全部删掉**，改成留空（`KEY=`），并加注释说明「留空 = 继承内核 `DEFAULT_DELTA_CAP_CONFIG` 种子值，校准时才填」。

**为什么**：与 WP28 修掉的 `PSYGUARD_TIMEOUT_MS` 同一个坑 —— 内核 `DeltaCapConfig` 已有种子值，模板里再写一份数值 = 多一份会漂移的真相源；内核改了模板没改，**显式值会盖掉新种子**（env 优先于代码缺省），于是出现「内核按 0.15 砍、线上还按 0.20 砍」。模板留空 = 单一真相源。

**行为无变化**：空值在适配层 `resolveBound` 里直接回退内核种子值（`if (trimmed === '') return fallback;`），运行时与「不设该键」逐字一致。

**闸门**：

| 项 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | 0 error |
| `npx tsc -p tsconfig.build.json --noEmit` | 0 error |
| `npx vitest run test/config/wp25-env-example-coverage.spec.ts` | 6/6 绿（断言① 代码读的键有生效行 / ② 生效行都被代码读 / ③b 18 键字面量读且内核零 `ENGINE_CAP_*`） |

**⚠️ 真机提示（生产机 `.env`）**：如果生产机 `/opt/mofang-nestjs/.env` 是**照抄过旧模板**，那 18 个键会带着旧数值。当前这些数值与内核种子**一致** → 行为无差异；但将来内核改种子时，显式值会盖掉新种子。建议把生产机 `.env` 里这 18 行也清空（留空 = 继承内核种子）。

---

_交付：2026-11-03 · MCode_
