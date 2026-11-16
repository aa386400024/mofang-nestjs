# WP36 交付记录 — 跨会话间隔自然衰减（resume 时情绪 / 阻抗 / 同盟按半衰期回落）

> 状态: ✅ 已交付
> 任务单: [`wp36-cross-session-decay-2026-11-03.md`](wp36-cross-session-decay-2026-11-03.md)
> 日期: 2026-11-03
> 红线: **engine-core 预批准例外**（已在 Phase2 WP 清单登记；改完 `boundary.spec.ts` **11 条断言全绿**）

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`，预批准例外）：1 增 + 2 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/cognition/session-decay.ts` | **新增**：衰减端口（`SessionDecayConfig` / `DEFAULT_SESSION_DECAY_CONFIG`）+ 纯函数 `applySessionDecay(snapshot, ageMs, config?)` |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | 构造注入 `sessionDecayConfig?`；**resume 接续分支**按 `now() - resumed.updatedAt` 衰减后返回（不再原样搬快照） |
| `src/engine-core/index.ts` | barrel 追加 3 个公开符号（WP26 P2-16 同款理由：公开面由断言⑥ 双向白名单守住） |

### 1.2 适配层（`src/engine-adapters/**`）：1 增 + 2 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/session-decay.config.ts` | **新增**：`resolveSessionDecayConfig(config)` —— 3 个 `ENGINE_DECAY_*` 键**逐个字面量**读，非法值回退内核种子值 |
| `src/engine-adapters/wiring/engine.providers.ts` | `EngineSessionTuningDeps` 加 `sessionDecayConfig?`，透传给内核会话 |
| `src/engine-adapters/wiring/engine.module.ts` | `ENGINE_SESSION_PORT` 的 useFactory 注入 `sessionDecayConfig: resolveSessionDecayConfig(config)` |

### 1.3 配置

| 文件 | 改了什么 |
|---|---|
| `.env.example` | **新增** `ENGINE_DECAY_EMOTION_HALF_LIFE_MS` / `ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS` / `ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS`（**全部留空** = 继承内核种子值） |
| `typings/global.d.ts` | 显式声明 3 个 `ENGINE_DECAY_*` 键（仓库约定：不许用 bracket / 计算键绕过） |

### 1.4 测试

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp36-session-decay.spec.ts` | **新增**，22 例（三组半衰期恰好减半 / 不衰减维度逐字不变 / 边界 / 端口注入 / 会话层接线） |
| `test/engine-adapters/wp36-session-decay-config.spec.ts` | **新增**，6 例（env 装配 / 非法值回退 / 逐项回退） |
| `test/engine-core/boundary.spec.ts` | 断言⑥ 白名单 +3 个符号；断言⑦ 目录清单 +`cognition/session-decay.ts` |
| `test/config/wp25-env-example-coverage.spec.ts` | **新增断言③e**（`ENGINE_DECAY_*` 3 键逐个字面量读 + 内核树零该族字符串） |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP36 行 ✅ + 交付记录链接；engine-core 例外表登记本轮实际改了什么；统计 27 → 28 条、进度 3 → 4；**新增 WP54**（本轮遗留的「破裂态阻抗反升」） |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP36；进度 3/23 → 4/28；目录结构说明 +WP36 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 偏差①：任务单没说要改 `boundary.spec.ts`，但不改就红（照 WP42 先例补上）

任务单 §3.6 只说「`src/engine-core/index.ts` 追加 3 个公开符号」。但 `boundary.spec.ts` 断言⑥ 是**双向白名单** —— 少导出（消费方 import 不到）与多导出（把内部实现泄进公开面）**都会变红**。WP42 交付时同样改了这份白名单（见其交付记录 §1.4），本轮照同一先例：

- 断言⑥ 白名单 +`SessionDecayConfig` / `DEFAULT_SESSION_DECAY_CONFIG` / `applySessionDecay`；
- 断言⑦ 目录清单 +`cognition/session-decay.ts`（断言⑦ 只查"缺失"，但目录清单是**契约**，新增文件要显式登记，否则"结构不漂移"这条守卫等于名存实亡）。

### 2.2 偏差②：任务单没提 env 覆盖断言，但适配层"逐个字面量读"的前提就是它（新增断言③e）

`ENGINE_DECAY_*` 三个键走适配层**逐个字面量**读（不走计算键），这样 WP25 的 env 双向断言（AST 抽取）才看得到 —— 漏写一个键，断言① 立刻变红。WP26 / WP34 / WP42 各自都为此加了一条族断言（③b / ③c / ③d），本轮加 **③e** 同款：3 个键一个不多一个不少 + **内核树零 `ENGINE_DECAY_` 字符串**。

### 2.3 偏差③：非法半衰期**回退种子值**而不是抛错（内核侧也兜一层）

任务单 §3.1 只给了签名，没说非法值怎么办。按 WP42 `resolveAllianceThresholds` 的同一纪律实现：

- **适配层**（`resolveSessionDecayConfig`）：空串 / 非数字 / ≤0 → 回退 `DEFAULT_SESSION_DECAY_CONFIG`；
- **内核侧**（`sanitizeHalfLife`）：端口是**公开契约**，任何人都能 new 一个配置塞进来 —— 0 会让 `2^(-age/0)` 变成 `Infinity`、负数会让"越久越淡"变成"越久越浓"，两者都会把整份快照污染成 `NaN`/`Infinity`。内核这层兜底保证**无论谁注入，衰减都还是衰减**。

**为什么不抛错**：`decayImportance` 在半衰期非法时是抛 `EngineCoreError` 的，但那是**记忆召回**的内部调用方，错了要立刻暴露；这里是 **resume 路径**——抛错会让"隔了 30 天回来"这一场对练**整场开不起来**，代价与收益完全不成比例。回退到种子值 = 行为仍然确定，且配置层的非法值已经由 env 断言与适配层单测覆盖。

### 2.4 偏差④（最重要）：「破裂态阻抗反升」本期**不做** —— 任务单与 WP 清单口径不一致，按任务单逐字交付并留档

**两处口径不一致**：

| 出处 | 原文 |
|---|---|
| Phase2 WP 清单 WP36 行 / 蓝图 §4.5 | 「resume 前按间隔对情绪/阻抗/**信念**差异化半衰期回落，**破裂态阻抗反升**」 |
| 任务单 §3.1 衰减表 + §5 验收标准 | 不衰减维度含 `coreBeliefs` / `temporaryBeliefs` / `memoryBeliefs`；验收要求「ageMs = 14 天时，**resistance 三维恰好减半**」 |

**实现口径**：按**任务单**逐字做 —— 情绪（7 天）/ 阻抗（14 天）/ 同盟（30 天）三组差异化半衰期；信念 / 欲望 / 移情**不衰减**；不引入任何"破裂态"分支。

**为什么「破裂态阻抗反升」本期不做**：

1. **它需要一个"破裂"的阈值定义**（多低的信任 / 安全感算破裂？阻抗反升升多少？）。任务单与蓝图**都没给** —— 这就是仓库反复强调的"不发明临床数字"。硬造一个阈值 = 又一个不可校准的数。
2. **它与任务单 §5 的验收标准直接冲突**：「ageMs = 14 天时 resistance 三维恰好减半」是无条件断言；加一条"破裂态不衰减"的分支，这条验收就得开口子。
3. **"破裂"在内核里已经有机器定义**，但它住在**另一个端口**里（`AllianceConfig.thresholds` 的 `resistanceTrust` / `resistanceSafety`，是意图规划的抗拒门槛）。让衰减端口去读另一个端口的门槛，是两个配置面耦合 —— 校准一条线就会牵动另一条。

**建议的落法（下一轮校准时做）**：复用内核既有的抗拒门槛作破裂态定义（`trust < 0.4 || safety < 0.3` —— 即内核自己已经认定的"抗拒/破裂"状态），在 `SessionDecayConfig` 上再加一个可配的"破裂态阻抗下限"，而不是新造阈值。

**已挂进 backlog**：Phase2 WP 清单新增 **WP54「破裂态阻抗反升（跨会话衰减补完）」**（P2 技术债层），落法建议写进了那一行 —— 照 WP42 的先例（WP42 交付时的四条遗留分别成了 WP50 / WP51 / WP52 / WP53）。

### 2.5 衰减是**跨场边界的一次性事件**，不是"每轮都在衰减"（任务单没明说，必须讲清）

`loadState()` 每轮都调，但它的第一分支是「本场已有状态」—— 只有本场**第一轮**才会走到接续分支。第一轮算出的衰减值随本轮 delta 一起落库，之后各轮读的是**本场自己的**状态（不再衰减）。

于是口径是：**衰减只发生在从上一场跨到这一场的那一次边界上**，而不是"时间每走一秒状态就淡一分"。若做成持续衰减，用户在一场会话里聊两小时，信任会在场中悄悄流失 —— 那是错的。

（`test/engine-core/wp36-session-decay.spec.ts` 有一条用例专门钉这个语义：本场第二轮即使又过了 10 天，数值不变。）

### 2.6 衰减的是**幅度**，不改变符号；标签随数值重算

- **负效价保留符号**：valence = -0.8 过 7 天 → -0.4（"委屈还在，但没那么尖锐了"），不是 +0.4。用 `value * 2^(-age/halfLife)` 天然满足，不需要额外分支。
- **`emotion.label` 必须随数值重算**（任务单 §3.1 已点名）：渲染层按标签选词、按数值选强度 —— 数值动了标签没动，两边会打架。用 `resolveEmotionLabel(valence, arousal)` 重算（内核既有函数，与 `state-transition.ts` 的 `applyDeltaVector` 同一口径）。
- **衰减因子恒 > 0**（`2^(-age/halfLife)` 渐近不归零）：任务单背景里那句"关系不会因为一周不见就回到陌生人"在数值上成立 —— 30 天减半，但不会清零。已单测钉住。

### 2.7 三组半衰期**彼此独立**（不是一个"全局衰减率"的三种写法）

任务单的表格给的是三组不同维度各自的半衰期（情绪 7 / 阻抗 14 / 同盟 30），实现严格照此：情绪只受 `emotionHalfLifeMs` 影响，阻抗只受 `resistanceHalfLifeMs`，同盟三维（trust / safety / bond，共用 `allianceHalfLifeMs`）只受 `allianceHalfLifeMs`。已单测钉住"情绪半衰期处阻抗与同盟不跟着减半"。

> 同盟三维共用一个半衰期，是任务单 §3.1 的表只有一行"同盟"决定的；WP42 把 trust / safety / bond 拆成三维是**建模**上的拆分，不是**衰减速率**上的拆分 —— 本轮不发明"安全感比纽带感掉得快"这种临床数字。

### 2.8 衰减落点：`loadState()` 的接续分支（任务单 §3.2 指定的同一处）

任务单给的行号 461–471，实际接续分支在 461–472（差 1 行，实质一致）。`resumed.updatedAt` 确实是 `BdiStateRecord` 的 ms timestamp 字段（`bdi-state.repository.ts:56`），可直接用。

`ageMs = this.now() - resumed.updatedAt`：取的是**上一场最后一次落库时刻**到当前时刻的间隔 —— 即"距上一场结束多久"，与任务单口径一致。

### 2.9 内核侧多做了一层 clamp（防御脏数据，不改正常路径）

衰减后的 valence / arousal / 阻抗三维 / 同盟三维都过一遍 `clampValence` / `clamp01`。理由：衰减只会把数值往 0 拉，**域内数值不可能越界** —— 这层 clamp 只在"快照来自脏数据 / 将来落库迁移出错"时才起作用。它保证 `applySessionDecay` 的输出**永远是域内快照**（domain 契约），代价为零。

### 2.10 env 面：3 个 `ENGINE_DECAY_*` 键，单位毫秒，**全部留空**

- 与 `ENGINE_CAP_*` / `ENGINE_MOD_*` / `ENGINE_ALLIANCE_*` 同一口径：模板里**不写数值** —— 写一份就是多一个会漂移的真相源（内核改了种子而模板没改时，显式值会**盖掉**新种子）。留空 = 继承内核种子值。
- 单位统一 **毫秒**（与内核端口 `SessionDecayConfig` 一致），三处口径统一，避免"天 / 毫秒混着填"这类静默错配。
- 适配层**逐个字面量**读 → env 覆盖断言的 AST 抽取看得到（新增断言③e）。

### 2.11 半衰期是**工程种子值，非临床标定**

三处（内核常量 / 适配层注释 / `.env.example` 注释）都写明"待真实对练校准"。半衰期种子值的形状理由（写在内核文件头）：情绪 < 阻抗 < 同盟 —— 越"结构化"的东西衰减越慢；同盟 30 天与内核既有的记忆重要度半衰期（`DEFAULT_DECAY_HALF_LIFE_MS` = 30 天）同量级 —— 长时记忆与关系记忆的持久性本该一致，不该一个记一个月另一个记半年。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts"` | **0 error**（exit 0） |
| `npx eslint "test/**/*.ts"` | **0 error**（exit 0） |
| `npx eslint "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **90 个测试文件 / 1348 例全绿**（Phase1+WP42 基线 88 文件 / 1320 例 + 本轮新增 2 文件 / 28 例，**零回归**） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（11 条编号断言 ①–⑪ + 1 例"扫描到内核源文件"自检） |
| `git diff --stat HEAD -- src/engine-core` | **2 改 + 1 增**（**预批准例外，不是空**）：`cognition/session-decay.ts`（新）、`in-memory/in-memory-engine-session.ts`、`index.ts` |

**回归确认**：既有 WP1 / WP2 / WP12 / WP15 / WP26 / WP34 / WP42 用例**零改动通过**。

- `test/engine-core/wp1-bdi.spec.ts` 的 resume 用例（断言接续后 `trust` 与上一场逐字相同）仍绿 —— 该用例的测试台用**固定时钟**，间隔为 0 → 不衰减（新增用例「零间隔的接续 = 原样搬」把这条口径显式钉住）。
- `test/engine-core/engine-core.spec.ts` 的接续用例仍绿 —— 它只断言 `coreBeliefs` 与 revision，不涉及衰减数值。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **「破裂态阻抗反升」**（见 §2.4）—— 需要一个破裂态阈值定义，任务单与蓝图都没给；不发明临床数字。已挂进 Phase2 WP 清单的 **WP54**，落法建议：复用内核既有的抗拒门槛作破裂态定义 + 在 `SessionDecayConfig` 上加可配下限。
2. **衰减不覆盖 `transference`（移情三态）** —— 任务单 §3.1 明确列入"不衰减"（移情是关系结构，不是瞬时状态），照做。
3. **衰减不覆盖 `temporaryBeliefs` / `memoryBeliefs`** —— 任务单 §3.1 明确列入"不衰减"，照做。（若将来要做"短期信念也随时间淡出"，那是记忆机制 WP2 的地盘，不是本 WP。）
4. **BDI 快照落库仍是内存态**（WP32 的活）—— `resumed.updatedAt` 目前来自内存仓储；等 WP32 把快照落 DB 时，`updatedAt` 会变成"上一场最后落库时刻"，衰减口径**不需要改**（用的就是仓储记录上的时间戳）。
5. **渲染层不知道"这是衰减过的状态"** —— 衰减后的快照与自然演化出来的快照在内核里不可区分（也没必要区分）；渲染层要"开场先重建关系"是另一件事（见 WP50 渲染层接入同盟三维）。

---

_创建：2026-11-03_
