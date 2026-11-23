# BDI 引擎效果审计 · zero_motion 全程 neutral 根因定位（只读审计回复）

> **性质**：只读审计回复。本文件**不含任何代码改动**，审计期间未改代码 / 未改数据库 / 未跑 git 写操作。
> **对象**：批次 `hRW4V44-t43yyty_EyLke`（48 场），`metrics_json.zeroMotionBreakdown = {total:8, closure:0, idle:8}`。
> **仓库**：`D:\work\Project\backend\mofang-nestjs-af281r`（分支 `integrate`；审计起点 `2ff6cfcc`，审计结束时 HEAD 已推进到 `2e48eda6` —— AF-404 在审计期间落地）。
> **日期**：2026-11-24 · **产出方式**：源码 + 真实逐字稿 + 已编译产物回放，未采信任何未验证推断。

---

## 0. 结论摘要（一句话版）

**BDI 计算链没有坏。** 八维快照之所以纹丝不动，是因为这一场咨询师的每一句话都被规则轨判成 `neutral`，而 `neutral` 在 delta 表里就是**字面意义的零向量**（`state-transition.ts:362`），事件 delta 与剧本 delta 双零 → 快照冻结 → `isZeroMotion` 判 true。真正缺的不是算子，是**「在场 / 缺席」这一层事件在两轨上都无法产出**（AF-326 实测 `holding_present` / `cold_absent` 两轨均为 0），导致「冷漠」被结构性塌缩成「中性」。

**一句话修复方向**：不要去扩 `EVENT_LEXICON`（那会让冷漠咨询师把来访者信任推到 0.95，是刷指标不是修引擎）；要在**适配层**补一条能产出 `holding_present` / `cold_absent` 的判定轨，并让零变化指标把「全程冻结」「中途动过又回原值」「事件标签根本没落」三件事分开。

---

## 1. 事件 → delta 全链路的真实函数与行号（可直接跳转核对）

### 1.1 产生端（谁生成咨询师台词）

| 环节                           | 位置                                                    | 事实                                                                                          |
| ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| AI 咨询师台词生成 + 完整性闸门 | `src/auto-practice/practice-runner.service.ts:636`      | `applyCounselorOutputGate(structuredCounselorReply, input.encounter)` → `counselorReply.text` |
| 台词送进引擎                   | `src/auto-practice/practice-runner.service.ts:643`      | `await this.engine.turn(debugSessionId, counselorReply.text)`                                 |
| 收尾退出原因                   | `src/auto-practice/practice-runner.service.ts:732`      | `exitReason = 'natural_close'`                                                                |
| 咨询师模式 persona             | `src/auto-practice/seeds/counselor-modes.seed.ts:70-79` | `cold` 档明写「说话简短，不带温度」「**你不会说"我理解"**」「像在走流程」                     |

### 1.2 分类端（为什么是 neutral）

| 环节             | 位置                                                                        | 事实                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 分类调用         | `src/engine-core/in-memory/in-memory-engine-session.ts:484-486`             | `classifyAsync ? await ... : classify(userText, classifyContext)`；`classifyContext` 只带 `sensitiveTopics` + `sessionId`                |
| 规则轨实现       | `src/engine-core/cognition/rule-based-classifier.ts:156-209`                | `classifyV2`：词表命中 → 遮盖消歧 → 否定抑制 → 强度折算                                                                                  |
| 命中即 neutral   | `src/engine-core/cognition/rule-based-classifier.ts:205-207`                | 零命中 → `[{kind:'neutral', matchedTerms:[], strength:1}]`                                                                               |
| 词表本体         | `src/engine-core/domain/events/event-lexicon.ts:28-188`                     | **9 条规则**，全部是「行为动作」层（共情 / 接纳 / 正常化 / 开放探问 / 肯定 / 评判 / 说教 / 淡化 / 越界），主命中面是**共情与反映式句式** |
| 生产装配用哪一档 | `src/engine-adapters/wiring/engine.providers.ts:323`                        | `classifier: tuning?.classifier ?? new RuleBasedClassifier({ semantics: 'v2' })`                                                         |
| 模型轨注入点     | `src/engine-adapters/wiring/engine.module.ts:487`                           | `...(isModelTrackWired(modelClassifier.effectiveMode()) ? { classifier: modelClassifier } : {})`                                         |
| 模型轨默认形态   | `src/engine-adapters/cognition/model-classifier-mode.config.ts:80` / `:162` | 缺省 `rule_only`；`exam` 场景与**查不到场景**恒 `rule_only`                                                                              |

### 1.3 delta 应用端（为什么 neutral = 冻结）

| 环节                 | 位置                                                            | 事实                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| delta 种子表         | `src/engine-core/cognition/state-transition.ts:202-395`         | `DELTA_TABLE`                                                                                                                                                                  |
| **neutral = 零向量** | `src/engine-core/cognition/state-transition.ts:362`             | `neutral: ZERO`（11 维全 0）                                                                                                                                                   |
| 在场状态种子         | `src/engine-core/cognition/state-transition.ts:369-394`         | `holding_present`（safety +0.004 / bond +0.002 / valence +0.004 / verbal −0.002）；`cold_absent`（trust −0.004 / safety −0.002 / bond −0.002 / resistance 三维 +0.002~+0.004） |
| 一轮聚合             | `src/engine-core/cognition/state-transition.ts:415-447`         | `aggregateTurnDelta`：逐事件 × strength 累加                                                                                                                                   |
| 端口优先级           | `src/engine-core/cognition/delta-table-config.ts:169-192`       | `DeltaTableConfig` > `AllianceConfig` > `DELTA_TABLE` 基础值                                                                                                                   |
| 人格调节             | `src/engine-core/in-memory/in-memory-engine-session.ts:496`     | `modulateDeltaByPersonality(aggregateTurnDelta(...))`                                                                                                                          |
| 剧本 delta           | `src/engine-core/in-memory/in-memory-engine-session.ts:534`     | `applyTrajectoryStep(...)` —— **本场为 null**（`kernelState.trajectory` 证据）                                                                                                 |
| 总 delta + cap       | `src/engine-core/in-memory/in-memory-engine-session.ts:538-539` | `totalDelta = eventDelta + trajectory.delta` → `capTurnDelta`                                                                                                                  |
| 落快照               | `src/engine-core/in-memory/in-memory-engine-session.ts:555`     | `applyDeltaVector(base.snapshot, weightedFinalDelta)`                                                                                                                          |
| 意图规划（受影响）   | `src/engine-core/in-memory/in-memory-engine-session.ts:522`     | `planIntention(provisionalWithDesires, ...)` —— 快照冻结 → **意图也冻结**（本场 14 轮全 `simple_response`）                                                                    |

### 1.4 指标端（怎么判成 idle）

| 环节             | 位置                                                         | 事实                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 事件标签落 trace | `src/admin-debug/debug-session.service.ts:602`               | `const eventTags = result.events ?? []`                                                                                                                |
| 批次投影         | `src/auto-practice/metrics/batch-metrics.service.ts:88`      | `eventTags` 非数组 → 回落 `[]`（**与「全是 neutral」不可区分**）                                                                                       |
| 零变化判定       | `src/auto-practice/metrics/batch-metrics.compute.ts:192-199` | `isZeroMotion`：**只比首末快照**是否全等                                                                                                               |
| 豁免判定         | `src/auto-practice/metrics/batch-metrics.compute.ts:208-215` | `hasNonNeutralEvent`：有任一非 neutral → closure；否则 idle（**「无标签」与「全 neutral」同桶**）                                                      |
| 细分             | `src/auto-practice/metrics/batch-metrics.compute.ts:257-273` | `computeZeroMotionBreakdown`（AF-404 在办，已加 `closureSessions` / `idleSessions`）                                                                   |
| 阈值与既有判定   | `src/auto-practice/metrics/acceptance-thresholds.ts:210-216` | cold 档 `session.zero_motion` 候选阈值 ≤ 0.7；rationale **原文已写**：「空转率过高说明**"冷漠被静默成中性"**的失效面过大（cold 实测 31/48 = 0.6458）」 |

---

## 2. 候选根因排序

### R1（最高权重 · 已证实）规则轨词表覆盖不到 `cold` 咨询师的句式 → 全程 neutral → `neutral` delta = 零 → 八维冻结

**支持证据**

1. **真实分类器回放**（用本仓 `dist/` 已编译产物跑真实 `RuleBasedClassifier`）：
   - `debug_ITUgH5VCcuZ5QXw9SBb-T`（`vpt_grief_avoidance_l1`、14 轮、逐字稿与用户描述的 `488ilfS6J8QrS_Djsdd9R` 完全同型：grief_avoidance / 14 轮 / 逐轮中性）：
     - `legacy` 语义 **14/14 neutral**；`v2` 语义 **14/14 neutral** → **不是 v2 否定抑制引入的**（v2 与 legacy 在这一场结论一致）。
   - 本地 13 份逐字稿全量回放（205 个咨询师轮）：`legacy` neutral 116（56.6%）、`v2` neutral 120（58.5%）。
2. **逐轮 trace 直证**：`debug_ITUgH5VCcuZ5QXw9SBb-T` 的 14 轮，`bdiSnapshot` **逐字节相同**（`0.25|0.25|0.2|-0.55|0.35|0.55|0.5|0.5`），`delta` 全 0（仅首轮为 `null`，因首轮无前态），`kernelState.trajectory` 为 `null` → **事件 delta 与剧本 delta 双零**，不是提取问题。
3. **归档大规模实测**：`data/quality/g4-lexicon-substring-overlap-evidence.md` —— 真实语料 **neutral 单事件轮 17175 / 18594 = 92.38%**；词表 9 条规则。
4. **仓库既有回放**：`data/phase25-exit/af349-event-classifier-replay/report.json` —— 11 场 176 轮，neutral 107 轮（60.80%），legacy↔v2 翻转仅 4 轮（2.27%）→ v2 不是主因。
5. **persona 与词表正交**：`counselor-modes.seed.ts:70-79` 的 `cold` 档明写「你不会说"我理解"」；而 `EVENT_LEXICON` 的主命中面就是共情 / 接纳 / 反映句式（「听起来」「我理解你的」「对你来说」「可能是想」…）。**这是结构性错配，不是数据噪声。**
6. **最强判别特征 = 咨询师发言长度**（实测对照）：

   | 场次                                       | 咨询师平均字数 | v2 neutral 率    |
   | ------------------------------------------ | -------------- | ---------------- |
   | `debug_ITUgH5VCcuZ5QXw9SBb-T`（cold 同型） | **40.1**       | **14/14 = 100%** |
   | `debug_PqbSdWdJDumFk6LULjVvv`              | 60.8           | 17/20 = 85%      |
   | `debug_zenPFZu7VbSAW4LCC0_rN`              | 86.2           | 18/20 = 90%      |
   | `debug_5fF7I9GduTiJN0B_mkuZi`              | 88.3           | 9/20 = 45%       |
   | `debug_aV8cenevSHfgmGB2Zkflf`              | 99.0           | 12/20 = 60%      |
   | `debug_q_VTpzjWZQwWDcAjUuJY0`              | 109.2          | 8/20 = 40%       |
   | `debug_PNbYXZIn3MQQt-EOlUVvm`              | 142.4          | 12/20 = 60%      |
   | `debug_tOTsMJ9DRx1d9VNMUDBT_.json`         | 168.8          | 5/9 = 55.6%      |
   | `debug_xw7uAJodsn6o3ln9FGL_Q`              | 210.6          | 6/20 = 30%       |
   | `debug_-ja_HBOyvRIAn8zrKBGxP`              | 302.9          | 5/20 = 25%       |

   咨询师越短 → neutral 越接近全量。`cold` 档 persona（「说话简短、不带温度、等来访者自己说」）天然落在词表盲区。

7. **该场咨询师实际做的是临床动作，但句式全部落空**（节选，咨询师侧）：`开会具体占用了哪些时间？是白天连续开，还是晚上也开？` / `这种状态持续多久了？` / `具体是什么让你需要操心？` / `有没有试过把固定接送纳入日程？` / `你更怕的是时间真的不够，还是怕开口求助会显得自己没安排好？` / `那就给自己定一个明确期限…` —— **全是开放探问 / 澄清 / 行动规划，零命中词表**。

**反对证据 / 仍需补的数据**

- 48 场里只有 11 份逐字稿在本地，**剩余 37 份缺失**，8 场 idle 中只有 1 场能逐场定位；其余 7 场目前仍是「同型推断」，不是逐场实证。
- 本地逐字稿的 `encounter` 只有 `{mode:'online', channel:'text'}`，**不含 `counselorModeId`** → 无法在本地按模式分层复算，必须回 DB `ap_practice_sessions.counselor_mode_id`。
- 本地 13 份逐字稿并非全部来自该 48 场批次（时间跨 11-22 → 11-24）。

---

### R2（高权重 · 结构性）D-2 的「在场 / 缺席」事件在本仓**没有任何一条轨能产出**

**支持证据**

1. `src/engine-core/domain/events/session-event.ts:13-21` 原文自陈：「规则轨把这两类都吞进 neutral，同乘 ZERO —— 前者临床应微正向、后者临床应零或负向，**两者都测不出来**（台账 I-18）」。
2. **两轨实测均为 0**：`docs/worklog/completed/phase2.5/af326-classifier-shadow-recheck-2026-11-23.md` —— 66 个可用轮，模型轨与规则轨的 `holding_present` / `cold_absent` **都是 0**；模型轨 neutral 率 0.5606（规则轨 0.5758）。
3. `EVENT_LEXICON` 9 条规则里**没有一条**能产出在场状态；`state-transition.ts` 虽已备好两个 kind 与种子向量（AF-322 标定），但**没有任何生产者**。
4. `model-classifier-mode.config.ts` 缺省 `rule_only` → 模型轨默认不接线；AF-326 明确结论「**继续 shadow，不切 llm_active**」（exact 0.5000 < 0.60 建议线，3s 超时降级 5.71%）。**即：现在切模型轨也不是可行捷径。**

**这条是 R1 的「为什么无法就地修」**：词表里没有在场状态的表达位，而 D-2 的两个 kind 只在模型轨里被设计、实际也产不出来。

**仍需补的数据**

- 用 `pnpm audit:classifier-shadow` 对 **cold 场全量轮次**（而非尾部 2 轮）跑 shadow，看模型轨在真实 cold 语料上是否真的会输出 `cold_absent`。这是判断「模型轨能否兜底」的唯一实证口径。

---

### R3（中等 · 本审计已降级）eventTags 提取缺失 / delta 未累积 / 快照提取错位

**反对证据（强，基本可排除）**

| 假设               | 反证                                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| eventTags 没提取到 | G-4 归档实测「**无 eventTags 轮 = 0**（18594 轮中 0 轮）」；本地 13 份 205 轮实测 `emptyEventTags = 0`；`deltaDetail`（由 eventTags 派生）也全在场。                                                                                                                                                      |
| delta 没累积       | 反证成立：13 份里 10 场多轮次**八维全部变化**。`debug_xw7uAJodsn6o3ln9FGL_Q` 只有 11 个非 neutral 标签 → trust 0.32→0.56、valence −0.45→−0.88、阻抗三维全部上升；`debug_zenPFZu7VbSAW4LCC0_rN` 只有 **1 个**非 neutral 标签（`preaching`）→ 八维也全部变化（trust 0.32→0.22）。**一个事件就足以动八维。** |
| 快照提取错位       | 本场 14 轮 `bdiSnapshot` 逐轮完全一致，且 `delta` 字段在第 2 轮起就是**对象且全 0**（不是 `null`、不是缺失）→ 引擎确实算了、确实算出 0。                                                                                                                                                                  |
| 跨会话衰减抵消     | `session-decay.ts` 只在 resume（跨会话间隔）生效，**不解释场内零变化**。                                                                                                                                                                                                                                  |
| 场景脚本压制       | `kernelState.trajectory` 为 null → 剧本 delta 本场未触发。                                                                                                                                                                                                                                                |

**仍需补的数据**：把「trace 存在但 `eventTags` 为空数组」的轮次计数写进批次指标（AF-404 的 `eventTagCounts` 空对象 `{}` 已能区分，但要**同时**改计数口径，见 §3 Step 1）。

---

### R4（真实存在 · 口径层）`isZeroMotion` 只比首末 → 三种不同的「没动」被压成一桶

**支持证据**

1. `batch-metrics.compute.ts:192-199`：`isZeroMotion` = 八维**首末全等** → 「中途动过又回到原值」（净零）的场次会被误判为 idle。
2. `batch-metrics.compute.ts:208-215` + `batch-metrics.service.ts:88`：`hasNonNeutralEvent` 对「全程 neutral」与「eventTags 从未落盘（回落成 `[]`）」返回同一个 `false` → **提取缺失被当成 idle 计入失效**。
3. 本地 13 份里没有「净零」样本（要么真冻结、要么八维全变），所以**这个口径缺口在本地不可见**，只有 37 份缺失逐字稿的场次里可能藏。

**结论**：R4 不是本场症状的原因，但它是**让 8 场 idle 无法自证**的原因，且**必须先修口径，否则任何校准后的数字都不可信**。

---

### R5（低权重 · 存疑）场景 / 角色脚本让来访者一直低反应

**支持证据**：本场 14 轮 `intention.strategy` 全为 `simple_response`，无探索策略 → 来访者行为也冻结。

**反对证据**：`cold` 档测的**本来就是**冷漠下的阻抗与同盟破裂（`counselor-modes.seed.ts:72`：「测引擎在冷漠/不回应下的来访阻抗与同盟破裂」）。来访者低反应是**设计意图**，但它本应表现为「阻抗上升 / 信任下降」，而不是「什么都不发生」。真实问题是**引擎没有把 cold 表达出来**（R1 + R2），不是场景写错了。

---

## 3. 最小可验证改动方案

> 通用纪律：`src/engine-core` 是红线层，以下 Step 1 / Step 2 **均不需要动内核**。
> `CounselorEventKind`（含 `holding_present` / `cold_absent`）已由 `src/engine-core/index.ts:50` 从内核 barrel 导出 → 适配层可直接构造这两个事件，**无需新增内核导出或新文件** → `test/engine-core/boundary.spec.ts` 的 11 条断言（①~⑪）零影响（断言⑥是 index.ts 导出白名单、断言⑦是目录/文件清单，两者都不涉及本次改动）。

### Step 1 · 指标口径修直（业务层，零内核改动，建议并入在办 AF-404）

**改哪里**：`src/auto-practice/metrics/batch-metrics.compute.ts`（+ `batch-metrics.schema.ts` 字段只增不删）。

**为什么先做这个**：R4 是「8 场 idle 不可自证」的成因；口径不直，任何校准后的指标都不可信。

**改什么**

1. `isZeroMotion` 拆两问：
   - `flat`：**每一轮**快照都等于首轮 → 真冻结（本场 14 轮就是这个形态）；
   - `net-zero`：首末相等但中途动过 → **不进 idle 桶**（现在会被误判）。
2. `hasNonNeutralEvent` 拆三桶：
   - `all-neutral`（有标签、且全是 neutral）→ 计入 idle；
   - `has-non-neutral` → closure；
   - `untagged`（`eventTagCounts` 为空对象 = eventTags 从未落盘）→ **单列，不计 idle**（现在是静默算作 idle）。
3. 明细字段补齐（AF-404 已加 `debugSessionId` / `characterSlug` / `counselorModeId` / `turns` / `eventTagCounts`，在此基础上加）：
   - `dimensionFirstLast`：八维首值 / 末值 / 差值（看清「冻在哪个值」）；
   - `maxExcursion`：逐轮相对首轮的最大偏移（区分 flat 与 net-zero）；
   - `eventTagPositions`：非 neutral 标签出现在第几轮（区分「全程无动作」与「前几轮有动作后空转」）；
   - `counselorTurnCharBucket`：咨询师发言长度分桶（复用 D-1 已有的分桶口径，见 `scripts/ops/quality/d1-event-classifier-evidence.lexicon.ts`）；
   - `classifierSemantics` + `lexiconVersion`：分类器语义档与词表版本戳（**见 §6 的版本戳缺口**）。

**预期指标变化**：本批 8 场 idle 中，能定位的 1 场应判为 `flat`；其余 7 场靠新明细拿到 sessionId / 八维差值 / 事件标签分布 → **从「不可定位」变成「可定位」**，`idle` 数字本身此步不变。

---

### Step 2 · 主修：适配层补「在场 / 缺席」判定轨（零内核改动，env 开关缺省关）

**改哪里**

- 新增 `src/engine-adapters/cognition/presence-classifier.ts`（**适配层**，实现内核已定义的 `EventClassifier` 接口）。
- 接线点：`src/engine-adapters/wiring/engine.module.ts:487` 旁边 —— 与模型轨同款「只在开关打开时装配」。

**判定规则（全部只吃咨询师本轮文本 + 适配层自持的跨轮计数）**

| 触发条件                                                                                                       | 产出                             | 依据                                              |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| 规则轨判 neutral，且本轮是结构化过渡 / 事实澄清 / 行动规划 / 开放式邀请（非敷衍模板）                          | `holding_present`                | D-2 定义「稳定在场的有效中性」；AF-322 已标定种子 |
| 规则轨判 neutral，且本轮是敷衍模板（「嗯 / 嗯嗯 / 然后呢 / 还有吗 / 请继续 / 我在听」）或连续超短轮 / 机械复述 | `cold_absent`                    | D-2 定义「实质缺席」；AF-322 已标定种子           |
| 规则轨已命中行为事件（empathy / open_probe / …）                                                               | **不追加**（避免与行为事件双计） | 保持事件语义单一                                  |

**关键边界（照抄内核既有纪律）**

- 判定**不引入来访侧信号**：内核口径是「事件分类只消费咨询师本轮文本」（`session-event.ts:4`）。跨轮状态（连续轮计数）**放适配层**，与 `ModelEventClassifier` 既有做法一致（`model-event-classifier.ts:340` 的 sessionId 分桶）。
- **不用 `counselorModeId` 当先验**：I-18 已判定「模式先验方案只消一半失真、不交付同盟破裂，不建议单独实施」（`phase2.5-wp-list-2026-11-08.md:87`）。cold 档必须靠**可观测的台词特征**判出来，不能靠模式 id 硬编码。
- **env 开关缺省关**（如 `ENGINE_PRESENCE_CLASSIFIER_ENABLED`）→ 不开 = 内核决策链里根本没有这一步 = 逐字零回归（与 AF-354 三项未标定机制同款纪律）。

**预期 zero_motion 指标如何变化（真实内核函数实测，非估计）**

用**本场真实快照**（`debug_ITUgH5VCcuZ5QXw9SBb-T` 的 `kernelState.snapshot`，八维首值 `trust 0.25 / safety 0.25 / bond 0.2 / valence −0.55 / arousal 0.35 / resVerbal 0.55 / resDepth 0.5 / resStyle 0.5`）+ 真实 `transitionState` 连算 14 轮：

| 方案                  | 14 轮后八维                                                                         | `zero_motion`        |
| --------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| 现状（`neutral` ×14） | `0.25 / 0.25 / 0.2 / −0.55 / 0.35 / 0.55 / 0.5 / 0.5`（逐字不动）                   | **true**（复现症状） |
| `holding_present` ×14 | `0.25 / **0.306** / **0.228** / **−0.494** / 0.322 / **0.522** / 0.5 / 0.5`         | **false**            |
| `cold_absent` ×14     | `**0.194** / 0.222 / 0.172 / **−0.606** / 0.35 / **0.606** / **0.528** / **0.528**` | **false**            |

即：

- **本场 idle 必然从 1 变 0**（无论判成 holding_present 还是 cold_absent），因为八维不再冻结；
- **方向是对的**：冷漠但有结构的咨询师 → 安全感微升、**信任不动**；冷漠且敷衍 → **信任下降、阻抗上升**；
- **批次层面**：本批 8 场 cold idle 预期 `idle: 8 → 0`，`session.zero_motion: 8 → 0`（cold 档候选阈值 ≤ 0.7，当前实测 31/48 = 0.6458）；**但必须同时验收 `dim.trust.delta_avg` 不上升** —— 信任上升 = 方向错了（见 Step 3）。

---

### Step 3 · 明确**不建议**的路线：扩 `EVENT_LEXICON` 把 cold 的问句判成 `open_probe`

**为什么不做（用真实内核函数在真实快照上实测 14 轮）**

| 方案             | 14 轮后八维                                                                                                                                      | 后果                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `open_probe` ×14 | trust `0.25 → **0.95**`、safety `0.25 → 0.6`、arousal `0.35 → 0.63`、valence `−0.55 → −0.27`、resVerbal `0.55 → 0.27`、resDepth `0.5 → **0.08**` | 指标「变好」（zero_motion 也变 false），但**临床方向完全反了**：冷漠咨询师把来访者信任推到 0.95、拆光全部阻抗 |
| `empathy` ×14    | trust `→ 1.0`、safety `→ 1.0`                                                                                                                    | 更荒谬                                                                                                        |

**结论**：这条路线是**刷指标**，不是修引擎 —— 它让 `zero_motion` 归零的同时，让引擎在冷咨询师场景下的临床行为更错。若坚持要走，必须先满足 `docs/reference/bdi-cognitive-engine-principles-v1.0.md` §5.1「新增算子三要素」（明确实训场景 + 专业校准依据 + 可量化验收）与 §5.2 评审流程；且 `event-lexicon.ts` 属内核红线文件，需大炮明确批准并复跑 `test/engine-core/boundary.spec.ts`。**本审计不建议。**

---

## 4. 单测 / 回放用例清单（全部可用本仓 pnpm 工具链执行）

### 4.1 现成资产（先跑，确认基线）

```bash
# 规则轨 v2 真实语料回放（只读逐字稿，只出 id / 标签 / 计数）
pnpm exec tsx bin/af347-event-classifier-v2-replay.ts \
  --dir data/debug-sessions \
  --out data/phase25-exit/af349-event-classifier-replay/report.json

# 规则轨 vs 模型轨影子审计（零 LLM 版只跑规则轨）
pnpm audit:classifier-shadow -- --rule-only \
  --ids debug_ITUgH5VCcuZ5QXw9SBb-T --sample-per-session 20

# 规则轨漏判率取证（出标注骨架 CSV，供人工标注）
pnpm exec tsx scripts/ops/quality/d1-event-classifier-evidence.ts --dir data/debug-sessions

# 批次指标单测 / 内核边界 / 分类器 v2 / 模型轨
pnpm exec vitest run test/auto-practice/wp-k-batch-compute.spec.ts
pnpm exec vitest run test/engine-core/boundary.spec.ts
pnpm exec vitest run test/engine-adapters/af349-rule-classifier-v2.spec.ts
pnpm exec vitest run test/quality/af349-event-classifier-v2-replay.spec.ts
pnpm exec vitest run test/engine-adapters/model-event-classifier.spec.ts

# 收尾闸门
pnpm lint && pnpm typecheck && pnpm test
git diff --stat HEAD -- src/engine-core    # 必须为空
```

> ⚠️ **已知保真缺口**：`scripts/ops/quality/af322-classifier-shadow-audit.ts:154` 用的是 `new RuleBasedClassifier()`（**默认 legacy**），而生产装配是 `semantics:'v2'`（`engine.providers.ts:323`）→ 影子审计的「规则轨」与生产口径**不一致**，用它做校准基线会得到偏高的命中率。建议同单把它对齐到 v2（对照 `model-event-classifier.ts:129` 的 `SHARED_RULE_TRACK`）。

### 4.2 新增用例清单

| #   | 文件                                                       | 用例                     | 断言要点                                                                                                                                                           |
| --- | ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | `test/auto-practice/wp-k-batch-compute.spec.ts`（追加）    | `flat` vs `net-zero`     | 构造「第 5 轮 trust 动过又回原值」的零变化场次 → 断言**不进** idle 桶、**不进** closure 桶、进新 `net-zero` 桶                                                     |
| T2  | 同上                                                       | `untagged` 桶            | `eventTags` 全空数组的零变化场次 → 断言**不计入** `idle`，单列 `untagged` 计数                                                                                     |
| T3  | 同上                                                       | 明细字段合规             | `idleSessions[].dimensionFirstLast` / `maxExcursion` / `eventTagPositions` / `counselorTurnCharBucket` 存在，且**只含合规字段**（不含任何原文、prompt、rationale） |
| T4  | 同上                                                       | 向后兼容                 | 旧快照（缺新增字段）仍可读 → 断言不抛错、字段按 `undefined` 处理                                                                                                   |
| T5  | `test/engine-adapters/presence-classifier.spec.ts`（新增） | cold 语料逐轮判定        | 用 `debug_ITUgH5VCcuZ5QXw9SBb-T` 的 14 轮真实咨询师台词 → 断言每轮产出 `holding_present` 或 `cold_absent`，且**不与规则轨事件重复**                                |
| T6  | 同上                                                       | 敷衍模板 → `cold_absent` | 「嗯。」「然后呢？」「还有吗？」等 → 断言 `cold_absent`                                                                                                            |
| T7  | 同上                                                       | 缺省关闭 = 零回归        | 开关 off 时输出与现状**逐字相同**（`toEqual` 快照断言）                                                                                                            |
| T8  | 同上                                                       | 跨轮升级                 | 连续 N 轮极短 → 从 `holding_present` 升级为 `cold_absent`                                                                                                          |
| T9  | 同上                                                       | 不引入来访侧信号         | 断言实现只读 `text` + `context.sessionId`，不读来访文本（可用「改来访文本但输入不变 → 输出不变」反证）                                                             |
| T10 | `test/engine-core/boundary.spec.ts`（**不改**，只跑）      | 内核边界 11 条           | Step 1/2 均为适配层与业务层改动 → 断言①~⑪ 仍全绿，证明未碰红线                                                                                                     |

### 4.3 端到端回放验证（三段，都要留下可复现数字）

1. **词表/判定层对照**：把 presence 轨与现状轨并排跑本地 13 份逐字稿，输出 `neutral 率` 对照表 —— 预期：现状 v2 neutral 120/205（58.5%）→ 加上 presence 轨后 cold 同型场 **14/14 → 0/14**；其余场次 neutral 率下降但**不得反向增加**。
2. **批次指标层**：用 `computeBatchSnapshot` 对同一批 48 场做 **before/after 重算**（只读），比对 `zeroMotionBreakdown` 三元组 + `dim.trust.delta_avg` + `dim.safety.delta_avg` + `dim.*.per_turn_rate`。
   **验收必须同时看方向**：`zero_motion` 下降 **且** `trust` 不上升 —— 只看前者会把 Step 3 那条刷指标路线误判为成功。
3. **真批次**：跑一个 ≥8 场、咨询师模式 = `cold` 的小批次，看 `session.zero_motion` 与 `dim.trust.delta_avg`（trust **应下降或持平**，safety 微升）。

---

## 5. zero_motion 可观测性缺口的具体补法

**AF-404 在办已覆盖**（`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-404/task-sheet.md`，2026-11-24T02:38 创建）：`ZeroMotionBreakdown` 增加可选 `closureSessions` / `idleSessions`，明细含 `debugSessionId` / `characterSlug` / `counselorModeId` / `turns` / `eventTagCounts`。**本审计与 AF-404 不冲突，以下是在其之上的补充**：

| #   | 缺口                                 | 补法                                                         | 为什么必要                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | 看不到「冻在哪个值」                 | 明细加 `dimensionFirstLast`（八维首值 / 末值 / 差值）        | 只有差值才能判断「冻在 trust 0.25」是合理还是异常                                                                                                                                                                                                                                                         |
| O2  | 分不清「全程冻结」与「动了又回原值」 | 明细加 `maxExcursion`（逐轮相对首轮最大偏移）+ `isFlat` 布尔 | `isZeroMotion` 只比首末（R4），net-zero 场次现在被误判                                                                                                                                                                                                                                                    |
| O3  | 「无事件标签」与「全程 neutral」同桶 | `hasNonNeutralEvent` 拆三桶，新增 `untagged` 计数            | 提取缺失被当成失效计入 idle，是**口径级误判**                                                                                                                                                                                                                                                             |
| O4  | 不知道动作发生在第几轮               | 明细加 `eventTagPositions`（非 neutral 标签所在轮号）        | 区分「全程没动作」与「前几轮有动作后空转」——后者才是衰减问题                                                                                                                                                                                                                                              |
| O5  | 缺最有效的分层特征                   | 明细加 `counselorTurnCharBucket` + `counselorModeId` 切片    | 实测：咨询师平均字数 40.1 的场 neutral 率 100%，302.9 的场 25%（§2 R1 表）                                                                                                                                                                                                                                |
| O6  | 历史批次无法按同一口径重算           | 批次指纹 / trace 带 `classifierSemantics` + `lexiconVersion` | **实证**：本地 `debug_GJ_HGNcuo9Z9NoxjzMf8V` 落盘 `eventTags=['neutral']`，但用**当前**词表对同一句「你好，我在这里。…」回放得 `acceptance`（命中「我在这里」）→ 落盘标签是**当时词表的快照**；逐字稿跨 11-22→11-24，而 AF-349 v2 是 11-23 落地，**AF-349 自身的回放就已经出现「旧语料 × 新词表」的错位** |
| O7  | 切换模型轨缺依据                     | 把 shadow 观测（规则轨 vs 模型轨标签 + 置信度）并入批次      | AF-326 结论「不切 llm_active」，但缺 `cold_absent` 在真实 cold 语料上的实测；这是 R2 的关键补数                                                                                                                                                                                                           |
| O8  | 影子审计规则轨口径偏                 | `af322-classifier-shadow-audit.ts:154` 改用 `semantics:'v2'` | 否则影子基线与生产不一致，校准结论会偏                                                                                                                                                                                                                                                                    |

**批次指标 CLI（只读）**：`node scripts/ops/canary/batch-metrics.mjs <batchId>` 可查批次场次表（轮数 / token / 退出原因 / `counselor_mode_id`），是补「本地逐字稿缺 `counselorModeId`」缺口的现成工具（需 `.env` 的 DB 配置；本审计未执行）。

---

## 6. 还需要补的数据（按优先级）

| 优先级 | 数据                                                                        | 为什么                                                                                                    | 怎么拿                                                                                                                     |
| ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P0     | 48 场批次缺失的 **37 份逐字稿**                                             | 否则 8 场 idle 里 7 场只能靠同型推断，无法逐场定性                                                        | `batch-metrics.service.ts:136-140` 已支持 `data/archives/<子目录>/<debugSessionId>.json` 回退；确认归档目录是否在库/在本机 |
| P0     | 48 场每场的 **`counselor_mode_id` 分布**                                    | 验证「8 场 idle 是否全是 cold」这一前提                                                                   | `scripts/ops/canary/batch-metrics.mjs hRW4V44-t43yyty_EyLke`（只读）                                                       |
| P1     | 逐字稿落盘 **`counselorModeId`**（现在 `encounter` 只有 `{mode, channel}`） | 本地无法按模式分层复算                                                                                    | 改 `debug-session` 落盘字段（业务层，不涉内核）                                                                            |
| P1     | 逐字稿 / 批次带 **分类器语义档 + 词表版本戳**                               | 历史批次按同一口径重算的前提（O6）                                                                        | 批次指纹 `config-fingerprint.ts` 增段                                                                                      |
| P1     | cold 场真实咨询师台词的**人工标注**（漏判率）                               | 现成工具 `d1-event-classifier-evidence.ts --labels` 已能出标注骨架，但 `data/quality/` 下**尚无标注文件** | 人工双标 → 产出规则轨 vs 人工的漏判率基线                                                                                  |
| P2     | shadow 轨在 **cold 全量轮次**上的 `cold_absent` 产出率                      | 决定「模型轨能否兜底」                                                                                    | `pnpm audit:classifier-shadow -- --ids <cold 场> --sample-per-session 20`                                                  |

---

## 7. 过程与并发状态说明（交主控时必读）

1. **本审计期间仓库被并发修改**：审计起点 `2ff6cfcc`（`batch-metrics.compute.ts` 424 行），02:27→02:30 之间该文件变为 454 行（新增 `countEventTags` / `summarizeZeroMotionSession` / `closureSessions` / `idleSessions`）—— 对应 **AF-404**，并已于审计期间提交（`49c85780 feat(metrics): AF-404 zero_motion 明细可观测性` + `cc022f2d` + `2e48eda6`，HEAD = `2e48eda6`）。**本报告已按修改后的代码口径书写**；§5 的 O1~O8 是**在 AF-404 之上**的补充，不是重复。本文件自身是本次审计**唯一**写入（`git status` 仅此一条 `??`）。
2. **本文件是只读审计回复，不含代码改动**。按 `AGENTS.md` §0 强制编排门：**Step 1 中 AF-404 已覆盖的部分**（`closureSessions` / `idleSessions` / `eventTagCounts` 明细，已随 `49c85780` 落地）不再重复；**Step 1 剩余的 O1~O8（八维首末差值 / flat-vs-net-zero / untagged 桶 / 标签轮次位置 / 发言长度分桶 / 分类器版本戳）与 Step 2（presence 判定轨）需要单独落任务单**再开工（Step 2 改动面：`src/engine-adapters/cognition/` + `src/engine-adapters/wiring/engine.module.ts` + `test/engine-adapters/` + 交付记录），**均不涉及 `src/engine-core`**。
3. **本审计未执行**：任何 DB 写入、任何 git 写操作、任何代码/配置改动；未运行 `pnpm lint / typecheck / test`（只读审计不需要过闸门，改动落地时才需要）。
4. **未使用外部资料**，全部证据来自本仓源码、已编译产物（`dist/`）与真实数据文件（`data/debug-sessions/`、`data/phase25-exit/`、`data/quality/`、`docs/worklog/`）；控制台输出只含 id / 计数 / 比率 / 标签 / 数值，未打印任何 API key、cookie、数据库密码，咨询师与来访者原话仅在内存中用于分类与长度统计，未落盘。

---

## 8. 建议的下一步（三件事，按顺序）

1. **主控裁决**：接受或驳回「Step 2 = 适配层补在场/缺席判定轨」这条路线（唯一需要大炮点头的架构决策；Step 1 可直接并入 AF-404）。
2. **补数据**：跑 `scripts/ops/canary/batch-metrics.mjs hRW4V44-t43yyty_EyLke` 拿到 48 场的 `counselor_mode_id` 分布，确认「8 场 idle 全是 cold」；同时确认 37 份缺失逐字稿的归档位置。
3. **排期**：Step 2 落任务单 → 实现 presence-classifier（env 缺省关）→ 按 §4.2 补 T5~T9 用例 → 跑一个 cold 小批次验收「zero_motion 下降 **且** trust 不上升」。

---

_产出时间：2026-11-24 02:27–02:50 · 全程只读 · 本文件为唯一写入_
