# engine-core 结构债分层评估（只读预研草案）

> 状态：**只读预研草案，非待开工任务单**。本文只做现状盘点、分层归因、改动面与风险评估，不写代码、不改 `src/engine-core/**`、不改 `boundary.spec.ts`。
> 仓库：`mofang-nestjs`，分支 `integrate`。口径真相源：代码文件与 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`（下称"台账"）。
> 锚点行号随编辑可能漂移；落地前先按函数名/常量名 grep 定位，不凭行号直改。
> 纪律：engine-core 改动须由任务单明确例外批准；灰度期默认不调子强度与阈值，确需调整走例外批准。详见 `docs/team/conventions.md` §1.1。

## 0. 复核记录

- **首轮**：2026-11-12，core 规则 / 类型 / 台账归因只读扫描，产出本草案。
- **二次专家复核**：2026-11-12，对 47 个 core 文件逐一核对导出性质，回验全部代码锚点、种子值、优先级裁决、测试基线与台账事件率口径；对照 DOC-2 备忘的白名单硬前置与可行性结论校正改动面与顺序。复核未发现分层归类错误；校正项见 §2.1（双路径与 turnIndex）、§2.2（断言全量）、§4.1（改动面精确化）、§4.2（判定器缺口与方案 1 结论）、§4.3（I-19 五条前置）、§6（D-1→D-2→D-3 顺序）。
- 复核仍为只读：未改 `src/`、未改 `boundary.spec.ts`、未跑全量测试。

## 1. 背景与结论摘要

### 1.1 问题的由来

从 Phase1 封版到 Phase2.5，engine-core 长期只被"调系数"，未动结构。前两轮只读核查 git 历史与边界断言后，结论收敛为三句：

1. **"绕开 core"是误会**：core 一直在改（近 20 条提交覆盖 11-03 至 11-11，WP-L、WP42、WP53、WP57、WP60、I-12、I-20 均落 core）。被 `boundary.spec.ts` 锁死的只是**框架纯度**（零 `@nestjs/typeorm/env/装饰器/逃出目录/globalThis`），并不锁功能扩展；纯度隔离维持不松。
2. **真正的债在 core 领域模型与状态规则**：三项结构债留在 core——探索双门槛与 delta 互为因果（I-11）、neutral 把"稳定在场"与"冷漠缺席"合并成 ZERO（I-10/I-18）、纯累加模型看不见事件时序（I-19）。这三项调 adapter 参数解决不了。
3. **清单与公开白名单机制本身正确**，只需盯两个副作用：新 core 文件漏登记被断言⑦误拦；为绕白名单把纯逻辑挪去 adapter 制造副本分叉（历史 `clamp01` 三份副本，提交 `cb45025` 才统一回 core）。

### 1.2 本文要回答的问题

被早期架构决策锁死的"纯度"与"公开面/文件清单"是否也成了束缚；若确有结构债，逐项归层（core 规则表 / core 策略门槛 / core 事件模型 / core 状态模型结构 / 评测判据层 / adapter 装配 / 待数据标定），给出改动面、回归风险、边界复核要点与建议顺序，供拍板哪些进 core、哪些留 adapter。

### 1.3 分层类别定义

| 代号 | 层                   | 典型内容                                                | 落点范式                                                                |
| ---- | -------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| C1   | core 规则表数值      | `DELTA_TABLE` 各事件对维度的增量系数                    | 基础值在 core 种子表，覆写走 `DeltaTableConfig` 端口（WP60 唯一裁决口） |
| C2   | core 策略 / 门槛逻辑 | 意图分支条件、门槛常量与聚合方式                        | 门槛走 `AllianceConfig` 端口；纯策略比较在 core                         |
| C3   | core 事件模型        | 事件种类联合类型、`SessionEvent` 形状、规则分类器与词表 | 纯 TS；分类器接口可被模型轨同接口替换                                   |
| C4   | core 状态模型结构    | `DeltaVector` 维度集合、累加算子、快照形状              | 值语义快照；演化一律造新快照整体替换                                    |
| C5   | 评测 / 判据层        | 批次门禁口径、分层指标、判据档位                        | adapter / `auto-practice` 评测脚本与阈值表，不进 core                   |
| C6   | adapter 装配与配置   | env 组装、会话级 resolver、DB 角色配置透传              | 依赖方向：env → adapter → core 端口                                     |
| D    | 待数据 / 标定        | 临床倍率、样本外阈值、漏判率取证                        | 非代码任务，需真实批次或人工标注                                        |

## 2. 现状证据基线

### 2.1 core 结构与调用链（已读核实）

- `cognition/state-transition.ts`
  - `DeltaVector` 11 维：trust / safety / bond / verbal / depth / style / valence / arousal / positive / negative / dependency；`ZERO` 全零向量。
  - 维度分组：同盟（trust/safety/bond）、阻抗（verbal/depth/style，在 `snapshot.resistance`）、情绪（valence/arousal）、移情（positive/negative/dependency，在 `snapshot.transference`）。
  - `DELTA_TABLE: Record<CounselorEventKind, DeltaVector>`；`neutral: ZERO`。
  - `aggregateTurnDelta(events, alliance?, deltaTable?)`：按事件 kind 查表 × `clamp01(strength)` 逐维累加；无轮次位置、无时序语义。
  - `transitionState` 链路：`aggregateTurnDelta` → `capTurnDelta` → `applyDeltaVector` → `applyBeliefEvolution`；另有 `transitionStateDetailed`（不改 `transitionState` 返回形状，公共契约不动）。
  - `applyDeltaVector`：逐维 `clamp01`（valence 走 `clampValence`），纯加法；信念层字段原样带过。
  - 优先级：`DeltaTableConfig` 覆写 > `AllianceConfig` 覆写 > `DELTA_TABLE` 基础值，裁决只在 `resolveDeltaVector` 一处。
- `cognition/intention-planner.ts`
  - `planIntention(snapshot, profile?, alliance?)`：`allianceGate = Math.min(trust, safety)`；抗拒 `trust < resistanceTrust || safety < resistanceSafety`；探索分支 `allianceGate >= thresholds.open && depth < LOW_DEPTH`，按 valence 选 affective / cognitive exploration。
  - 常量：`HIGH_RESISTANCE_AGG=0.6`、`HIGH_VERBAL=0.55`、`LOW_DEPTH=0.35`。三者均为 planner 局部常量；其中门槛性质的 `LOW_DEPTH` **未进 `AllianceConfig` 端口**，另两项属策略内判别阈值。
- `cognition/alliance-config.ts`
  - `AllianceThresholds{open, resistanceTrust, resistanceSafety}`；`DEFAULT_ALLIANCE_CONFIG` 种子 open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3；`resolveAllianceThresholds` 非法或缺项回落种子；`resolveSessionAllianceConfig`（I-12 会话级覆盖，刻意不进 barrel）；`resolveAllianceDelta`。
- `cognition/personality-modulator.ts`
  - `AttachmentModulation`：trustScale / resistanceScale / safetyScale / bondScale / valenceScale / arousalScale；后两者只作用于正向增量，种子全 1.0（I-20 端口已通、倍率待标定）。
- `cognition/rule-based-classifier.ts` + `domain/events/event-lexicon.ts` + `domain/events/session-event.ts`
  - 分类器：小写子串包含 + 可选正则；一轮可命中多类；未命中归 `neutral`；`sensitive_touch` 走上下文敏感议题词表。
  - `SessionEvent{kind, matchedTerms, strength}`；规则轨 strength 恒 1，预留模型轨加权；**无位置 / 时序字段**。
- `domain/bdi-snapshot.ts`：信念层四槽 + 核心信念激活、愿望两层、情绪、阻抗三维、移情三态、同盟三维；全 readonly 值语义；无"在场稳定度 / 节奏"维度。
- 会话管线（`in-memory/in-memory-engine-session.ts` `turn`）：loadState → `assessSafety`（只读不改快照）→ `classifier.classify` → `aggregateTurnDelta` → `modulateDeltaByPersonality`（事件 delta）→ `transitionState`（临时快照 provisional，供意图规划与轨迹触发判定）→ `planIntention` → 轨迹步 → 事件 delta + 剧本 delta 合并 → `capTurnDelta` → 可选审议钩子 → `applyBeliefEvolution(applyDeltaVector(base.snapshot, finalDelta))`（落库快照）→ 落库 → 工作窗口维护。
  - **双路径口径**：provisional 走 `transitionState`（内部聚合 + cap + 信念演化）；落库快照走 `applyDeltaVector(finalDelta)` + 信念演化，`finalDelta` = 事件 + 剧本 + 审议合并后统一过一次 cap。两条路径都从 `base.snapshot` 出发，须保持口径一致。
  - **turnIndex 现状**：`runtime.turnIndex` 存在并每轮自增，出参与轨迹触发器、安全事件、审议上下文都已消费它；但聚合环节（`aggregateTurnDelta` / `transitionState` 入参）当前拿不到轮次号。轨迹触发器 `evaluateTrigger` 已是"内核纯函数按轮次做判定"的既成先例并有既有 spec。
- `cognition/session-decay.ts`：跨会话间隔的指数半衰期衰减（emotion / resistance / alliance 三组因子）。这是**会话之间**的时间语义；与 I-19 所指**会话内轮次位置 / 节奏**不是同一层，勿混淆。
- 其余 core 模块（memory 窗口与召回策略、trajectory 脚本与游标、safety 规则与探测端口、rendering 预算与故障切换、ports 与 runtime 端口）导出均为类型或无状态纯函数，未发现隐藏的跨轮状态累积或 IO；愿望权重规则轨不演化（`currentWeight` 初始 = 基线权重，属设计留位，非债）。
- 调用点：`in-memory/in-memory-engine-session.ts`；adapter `wiring/turn-delta-audit/turn-delta-audit.service.ts` 复用 `aggregateTurnDelta`。改累加模型会同时影响会话临时快照路径、落库快照路径与审计复用点。

### 2.2 边界断言现状

`test/engine-core/boundary.spec.ts`：12 个 `it`，其中 1 个扫描自检（防清单空转）+ ①~⑪ 共 11 条断言。与本次评估相关的关键断言：

- ① 零 `@nestjs/*` import；② 零 typeorm import；③ 零逃出 `engine-core` 的相对 import；④ 外部依赖白名单 = `{ nanoid }` + `node:*`；⑤ 零 NestJS 装饰器。
- ⑥ `index.ts` 公开面双向白名单：少导出、多导出都红；另含两条 `in-memory` 名字 / 路径不外露的 expect。
- ⑦ 文件清单双向锁定：core 树内每个 `.ts` 必须登记；反向 `extra` 检查系 WP45 P3-9 补，新增 core `.ts` 未登记则 `extra` 变红（清单含 `adapters/README.md`）。
- ⑧ 根目录无散落文件；⑨ B 层（Qdrant / embedding 实现）必须在 core 包外；⑩ 零 `process.env` / `globalThis`；⑪ adapter 不得深路径 import core 内部模块（只走 barrel 或 `in-memory/`）。
- 白名单推论（DOC-2 A.4 已核）：扩**已导出**类型的可选字段、或模块私有函数 / 内部运行时字段，不触发⑥⑦；新增具名公开导出名或新增 core `.ts` 文件才会撞红。

### 2.3 测试基线（开工前须复跑核对）

- core 测试目录现有 21 个 spec 文件（`boundary.spec.ts`、`engine-core.spec.ts`、I-12、I-20、WP1/2/3/4/5/15/26/34/36/37/42/51/53/57/60、clamp 统一、r9 hook）。
- 最近全量基线（P0 度量层收口，交付记录 §4）：187 测试文件（1 skipped）/ 3058 passed / 4 skipped / 0 failed，墙钟 85.07s；boundary 全绿。上一基线 3029 passed / 4 skipped，净增 +29 全为 P0 新增 spec。该数字来自交付记录而非本草案复跑；任何 core 改动开工单阶段须当场复跑并回填，不沿用历史数字；墙钟须同时标注机器状态（是否有长驻进程、盘读取延迟）。

## 3. 逐项分层归因总表

现状口径以台账为准；"已闭环"指代码与装配已落地，复验或样本外取证可能仍挂起。

| ID   | 问题                                 | 分层                      | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 代码落点（先 grep 定位）                                         | 备注                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-01 | 事件判定纯关键词子串匹配             | C3                        | 未修；**D-1 取证已交付**（2026-11-12）；**D-1 第二段模型轨实现单已交付**（2026-11-12，中间态：仅 `rule_only` + `shadow`，`llm_active` 不接线，规则轨未改）；P2 模型轨方向                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `rule-based-classifier.ts`、`event-lexicon.ts`                   | 蓝图定位后期模型轨替换；D-1 已把漏判率钉死（96 场 / 1112 轮，`neutral` 89.39%，Wilson 95% [0.8744, 0.9107]），**规则轨本身仍未修**                                                                                                                                                                  |
| I-02 | 词表漏判下界                         | C3 + D                    | 误吞上界已钉死（89.39%）；人工标注对照已出（60 条抽样，台账 §7.1）：在场承接 56/56 被吞，empathy/judgment 样本内 P=R=1.0；**模型轨对照臂已落地**（2026-11-12，中间态）：观测带 `agreement` / `fallbackReason` / `latencyBucket` 口径，**规则轨未改**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 同 I-01                                                          | expert 涉情发言未被识别的比例介于台账给出的区间内；D-1 实测 cold 96.19% vs expert 82.71%                                                                                                                                                                                                            |
| I-03 | trust 与 depth/style 对称配平        | C1                        | WP-L 已调系数解耦，纯内核复算通过；真实曲线待批次复验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `state-transition.ts` `DELTA_TABLE`                              | 调的是规则表数值，未动维度结构                                                                                                                                                                                                                                                                      |
| I-04 | depth 12 轮内大幅下降                | C1                        | 同 I-03，待复验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 同 I-03                                                          | —                                                                                                                                                                                                                                                                                                   |
| I-05 | style 同步下降                       | C1                        | 同 I-03，待复验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 同 I-03                                                          | —                                                                                                                                                                                                                                                                                                   |
| I-06 | verbal 与 depth 未解耦               | C1                        | 同 I-03，待复验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 同 I-03                                                          | —                                                                                                                                                                                                                                                                                                   |
| I-07 | valence 单调改善                     | C1                        | WP-L 已调收益/代价比；待复验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `DELTA_TABLE` valence 列                                         | —                                                                                                                                                                                                                                                                                                   |
| I-08 | arousal 单调下降                     | C1 + C4                   | WP-L 部分缓解；角色倍率见 I-20                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `DELTA_TABLE` arousal 列、`personality-modulator.ts`             | 真实曲线待标定批次                                                                                                                                                                                                                                                                                  |
| I-09 | safety 三重折扣                      | C1 + C6                   | 归因完成；结论"慢本身临床正确"，不调表                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `state-transition.ts`、`personality-modulator.ts`、事件率数据    | 基础系数 × 依恋倍率 × 正事件率叠加；上调基础系数的旧判断已撤回                                                                                                                                                                                                                                      |
| I-10 | 4 场 cold 八维全零                   | C3 + C4                   | 未修；结构债 S-2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `neutral: ZERO`、分类器兜底分支                                  | 极端表现，与 I-18 同根                                                                                                                                                                                                                                                                              |
| I-11 | 探索双门槛使多数角色 12 轮内不可达   | C2 + C1                   | 未修；结构债 S-1 · **深度门槛已端口化**（S-1 交付 2026-11-12：只补能力，不解决可达性）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `intention-planner.ts`、`alliance-config.ts`、`DELTA_TABLE` 速率 | 双条件交集仅安然：min(trust,safety)≥0.6 仅安然满足；depth<0.35 仅安然 0.25、语桐 0.30 满足；门槛结构与 delta 速率互为因果。S-1 后 depth 上限已从 planner 局部常量 `LOW_DEPTH` 并入 `AllianceThresholds.openDepth`（种子 0.35 逐字不变），**门槛取值、可达性判定与 delta 速率均未动**，I-11 结论不变 |
| I-12 | 门槛实例级单例                       | C6 装配缝 + C2 端口       | 已闭环；真实覆盖来源待标定批次接入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `resolveSessionAllianceConfig`、adapter resolver                 | 缺省零回归；全量与 boundary 已绿                                                                                                                                                                                                                                                                    |
| I-13 | 单场 LLM 全失败                      | 环境 / 瞬时故障           | 已闭环                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 不涉及 core                                                      | 并发抢 Redis 队列与 429；单实例重跑 12/12 成功                                                                                                                                                                                                                                                      |
| I-14 | `prompt_version` 填充率突变          | C6 落库路径               | 已闭环；G-2 边角（failed 场次恒 NULL）待口径拍板                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | adapter runner / 批次健康服务                                    | 历史旧行默认 NULL，非活路径漏写                                                                                                                                                                                                                                                                     |
| I-15 | `gate_decisions` 0 行                | C6 开关                   | 已闭环；G-3（rule_only 无 skip 留痕）待口径拍板                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | adapter 审议模式配置与模块装配                                   | 生产缺省开关关，预期行为                                                                                                                                                                                                                                                                            |
| I-16 | 探索率用全局总量做门禁               | C5                        | 未修；应废总量改分层                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | auto-practice 评测 / 验收脚本                                    | 总量指标掩盖"7/8 角色完全不可达"的结构问题                                                                                                                                                                                                                                                          |
| I-17 | L1 / L4 标签复核                     | C5 + D                    | 未决：与 I-11 是否同源待跟踪                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 评测词表与逐字稿离线复算                                         | 本轮未证明同源；继续跟踪                                                                                                                                                                                                                                                                            |
| I-18 | neutral 吞掉「冷漠缺席」             | C3 + C4                   | 未修；结构债 S-2；规则轨结构性不可达（看不到来访话语、无跨轮状态、词表无在场标记），模型轨可达；**D-1 第一段取证已交付**（2026-11-12：neutral 误吞上界 89.39%；标注对照见台账 §7.1，在场承接 56/56 被吞、cold_absent 本样本 0；规则轨未改）；**D-1 第二段模型轨实现单已交付**（2026-11-12，中间态）：模型轨**已跨过「看不到来访话语」与「无跨轮状态」两条结构性缺口**（跨轮状态含连续中性 / 连续缺席 / 熔断计数），但两类新 kind **未进 core 联合** → **不改 delta**，事件拆分仍属 D-2；**D-2 事件拆分已交付**（2026-11-12，中间态）：两类新 kind **已进 core 联合**（11 → 13 类）+ `DELTA_TABLE` 两行（**种子 = `ZERO`**）+ 口径登记表；审计**恢复词表命中明细**；**临床幅度与缺席阈值留标定批次**，`llm_active` 生效轨**独立成单** → [D-2 交付记录](../completed/phase2.5/phase2.5-d2-event-kind-split-implementation-2026-11-12.md) | `session-event.ts` 类型、分类器、`DELTA_TABLE.neutral`           | 不能简单给 neutral 加正向（方向错误）；是 I-19 的前置条件；D-1 已提供误吞上界与 cold/expert 分层证据，事件拆分仍待 D-2                                                                                                                                                                              |
| I-19 | 状态演化对轮次位置不敏感             | C4                        | **端口骨架已落地**（2026-11-13，仅 `none` 形态，零行为变化）；结构债 S-3，风险最高；有条件可行；**D-2 已落地（P3 满足）**；**D-3 开工前复核备忘已交付**（2026-11-13）：P1 / P2 / P3 / P4 满足，P5 拍板 **cap 后折损**，范围仅 `none` 端口骨架、非 none 形态留标定批次 → [D-3 复核备忘](../completed/phase2.5/phase2.5-d3-timing-weight-protocol-review-2026-11-13.md)；**D-3 实现单已交付**（2026-11-13，仅 `none` 形态骨架，零行为变化）→ [D-3 交付记录](../completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-2026-11-13.md)                                                                                                                                                                                                                                                                                           | `aggregateTurnDelta`、`SessionEvent`、`TransitionStateOptions`   | 纯累加跨轮可交换；属协议变更候选；裁决顺序已定 cap 后折损；指纹 `stateTransition` 段挂既有文件哈希、自动覆盖                                                                                                                                                                                        |
| I-20 | valence / arousal 无角色级调节       | C1 倍率端口 + C6 env 扩列 | 端口已通；种子全 1.0 零调节；临床倍率待标定批次                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `personality-modulator.ts`                                       | 必须排在 I-07/I-08 幅度修复复验之后                                                                                                                                                                                                                                                                 |
| I-21 | intake-v1 判据未按咨询师模式分档     | C5                        | 已交付 intake-v2；cold 档 `provisional`，待样本外复现                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 评测阈值表与 resolver                                            | 判据版本保留 v1 作历史口径                                                                                                                                                                                                                                                                          |
| I-22 | `zero_motion` 在 cold 模式语义未定义 | C5                        | 语义已落地；豁免/计入方向待新批次取证，代码维持字面                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 评测判定规则、逐字稿事件标签投影                                 | 本批 38 场零变化与全 neutral 集合重合，两方向不可区分                                                                                                                                                                                                                                               |
| I-23 | safety 增量全角色系统性偏低          | C1 归因 + D               | 归因完成：表内系数未被压小；不调表；safetyScale 是否调待标定批次                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `DELTA_TABLE` safety 列、依恋倍率                                | 剔除 cold 后非 secure 角色偏低但不极端                                                                                                                                                                                                                                                              |
| I-24 | 探索触发全部集中于安然               | C2 + C5                   | 并入 I-11 / I-16 后续复核                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 同 S-1 与 I-16                                                   | 40 轮档与后续批次跟进                                                                                                                                                                                                                                                                               |

## 4. 三项 core 结构债详述

### 4.1 S-1 · I-11 探索双门槛不可达（C2 策略门槛 + C1 速率）

**现象**：探索需同时满足 `min(trust, safety) >= open(0.6)` 与 `depth < LOW_DEPTH(0.35)`。同盟三维靠事件累加，正事件率低（台账两批口径：16 场批 expert 14.9%；96 场批 expert 16.6%；cold 3.1%；精确值以对应批次报告为准，不混作同批口径）。双条件交集仅安然：同盟门槛只安然满足；depth 门槛仅安然 0.25、语桐 0.30 满足，晚晴 0.40 / 小满 0.55 / 念安 0.50 / 沉舟 0.70 / 亦舟 0.65 / 惊尘 0.60 超标。台账按 safety 基线与 expert 实际速率估算的可达轮次：语桐约 50、小满约 125、沉舟约 200、惊尘约 250（理论估算，非实测）。

**机制与互为因果**：门槛决定"何时换策略"，delta 速率决定"多久攒到门槛"。提门槛压探索、降门槛放松临床标准；调 delta 速率又改动状态模型。两者缠在一起，单调任一维都无法同时满足"临床标准"与"12 轮可达"。

**为什么调 adapter 参数解决不了**：

- 双条件 AND、`min` 短板聚合、depth 下限是 core 策略结构；
- `LOW_DEPTH=0.35` 是 planner 局部常量，**未进 `AllianceThresholds` 端口**，连"按角色 / 按档位配置深度门槛"当前都做不到；
- adapter 只能覆写已端口化的 open / resistanceTrust / resistanceSafety，碰不到深度门槛与分支结构。

**候选方向（仅方向，不含实现）**：

1. `LOW_DEPTH` 并入 `AllianceThresholds` 端口，与 open 同范式（复用 `sanitizeThreshold` 回落种子）。纯配置可注入，不动分支结构。
2. 门槛结构复核：临床确认"低 depth 是探索前提"则结构保留；否则拆为独立条件。此判断与 C5 判据分层（12 轮档不验探索，40 轮档才验）分开决策。
3. 可达性对账：用快照序列算各角色达到门槛所需轮次，作为门槛与速率的标定依据；方法参照批次评估中"策略分支恒 0"的状态序列可达性复核。

**改动面**：`alliance-config.ts`（端口字段与种子）、`intention-planner.ts`（读端口）、core spec。白名单口径：`AllianceThresholds` 类型已在 barrel，并入字段属"扩已导出类型可选字段"，不新增导出名、不新增文件，不触发断言⑥⑦；仅当需要新增具名类型或新文件时才需同步登记 barrel 与断言清单。

**回归风险：中**。缺省种子必须逐字等于现状（open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3 / LOW_DEPTH 0.35），保证零行为变化；门槛回落校验复用既有唯一校验口，不新写一套。

**前置**：C5 判据分层先落地（12 轮档不验探索），避免门槛改动与验收口径改动叠加、归因不清。

**落地状态（2026-11-12，S-1 已交付 · 候选方向 1 已落地）**：方向 1 已实现 —— `LOW_DEPTH = 0.35` 并入 `AllianceThresholds.openDepth`（可选字段，缺省种子 **0.35 逐字不变**，**不接 env**），`intention-planner` 改读端口、局部常量已删，会话级镜像类型同步，适配层 `wiring/alliance-config.ts` 补一行 `openDepth: seed.openDepth`。改动面 = 内核三文件 + 适配层一行 + 新增 core spec 14 例 + 适配层断言 1 处；**零新增内核导出名 / 零新增内核文件**（不触发 `boundary.spec.ts` 断言⑥/⑦，该文件未改）。闸门：`tsc -p tsconfig.build.json` 0 错、`pnpm lint` 0 error 0 warning、定向 **91 文件 / 1643 例**（基线 90 / 1629）、全量 **3072 passed / 4 skipped（3076 例，189 文件）**、boundary 12 绿。**方向 2 与方向 3 未做**：门槛取值与临床口径、可达性对账仍待另案；S-1 **不解决 I-11 的数学不可达**（门槛值未动，12 轮内除安然外仍不可达）。→ [S-1 交付记录](../completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md)

### 4.2 S-2 · I-10 / I-18 neutral 语义合并（C3 事件模型 + C4 状态模型）

**现象**：两类完全不同的咨询师行为都无词表命中，同归 `neutral`，同乘 `ZERO`：

- 有效中性（`holding_present`）：结构化过渡、稳定在场；临床上应微正向；
- 冷漠缺席（`cold_absent`）：敷衍、无回应、语气平；临床上应零或负向。

结果：cold 模式"测冷漠 → 阻抗上升 / 同盟破裂"的设计意图落空，7 场中 4 场八维全零。

**为什么调系数解决不了**：问题在事件类别粒度，不在某类事件的增量大小。给 `neutral` 加一个微小正向会让冷漠咨询师也吃到 holding 增益，方向错误。

**候选方向（DOC-2 备忘已评估，结论据此校正）**：

1. 事件类型拆分（方案 2，正解路径）：新增 `holding_present` / `cold_absent`（或保留 `neutral` 作第三类），各自独立 delta 向量；新事件增量走 `DeltaTableConfig` 覆写（既有 WP60 范式），基础值留 core 种子表。快照不新增维度，增量仍落现有同盟三维。下游 delta 表与消费逻辑零改动，只需新增 kind 与表行。
2. 判定器缺口（规则轨结构性不可达，三点）：分类器只看咨询师本轮文本、看不到来访上一轮话语；`classify` 无跨轮状态，记不了连续缺席轮数；词表无"在场标记"类条目。模型轨 `EventClassifier` 接口本就为替换设计，可达。
3. 模式先验（方案 1，短期退路）：cold 模式整体不享 holding 增益，由 adapter 配置注入。**DOC-2 结论：不建议单独实施**——只消掉失真前一半（不误计增益），trust 走平线，不产生"从有信任到失去信任"的落差，仍交付不了 cold 模式要测的阻抗上升 / 同盟破裂；且改动是全局性的，须单独立单 + 全量批次重跑。若仍要做，列为 P3 待拍板（D-4）。
4. 类型扩展须同步：分类器输出形状、审计事件标签统计、既有逐字稿 traces 回放口径；新 kind 会改变事件分布，既有批次与新批次不可直接比，须进配置指纹对应段。

**附带登记（G-4，不在本债内修）**：词表子串重叠——`empathy` 的词条 `'你觉得'` 是 `open_probe` 词条 `'你觉得呢'` 的子串，一句"你觉得呢"可同时命中两类，单轮 trust 合计 +0.15；cold 场小幅正向是否由此贡献，属未经证实的假设，留待逐字稿复算。**→ D-1 已把前半句变成可执行证据**（2026-11-12）：规则轨基线快照 spec 逐字锁定「`你觉得呢` 同时命中 `empathy` + `open_probe`」；但「cold 场小幅正向里有多少由此贡献」这一**量级问题仍待**逐字稿复算（D-1 第一段只做规则轨基线，未做 delta 归因）。

**改动面**：`session-event.ts`（类型联合）、分类器与词表（判定信号）、`state-transition.ts`（表项）、core spec；模型轨分类器实现属 adapter / 判定器层。若新增 kind 不改具名导出形态，不触发断言⑥；新增文件才需登记断言⑦。模式先验部分在 adapter。

**回归风险：中高**。事件类型扩展影响分类器输出、审计标签统计与回放；须先建旧分类器逐字快照基线；新类型缺省映射回旧 `neutral` 行为。

**前置**：I-03 至 I-08 的数值修复已批次复验，避免参数叠加；事件拆分依赖模型轨分类器（D-1）先具备产出两类事件的能力；先拍板走"事件拆分"还是"模式先验退路"。

**D-1 进度（2026-11-12 · 第一段取证已交付）** → [交付记录](../completed/phase2.5/phase2.5-d1-event-classifier-evidence-implementation-2026-11-12.md)

- **已钉死**：96 场 / 1112 轮逐轮投影，`neutral` 994 轮 = **89.39%**（误吞上界，Wilson 95% 区间 **[0.8744, 0.9107]**）；正向事件率 0.0989、负向**词**事件率 0.0099（4 类：judgment / preaching / minimizing / boundary_cross，不含 `sensitive_touch`）。
- **分层证据**：cold 530/551 = **96.19%** vs expert 464/561 = **82.71%**（cold 误吞显著更高）；按段 head 89.07% / middle 92.00% / tail 87.02%。
- **已补回归锚**：规则轨基线快照 spec（`test/quality/d1-event-classifier-evidence.spec.ts` 第 ⑨ 组，39 例）逐字锁定旧分类器口径；其中 `你觉得呢` **同时命中 `empathy` + `open_probe`** —— 即本节「附带登记 G-4」的**可执行证据**（此前是未经证实的假设）。
- **待补**：per-kind precision / recall 与**两向漏判率**（漏 `holding_present` / 漏 `cold_absent`）需人工标注 → 标注骨架 CSV + `--labels` 通路已就绪（60 条分层抽样）。
- **未动**：core 零改动、规则轨一个字未改；本节「事件拆分」与「模式先验」的选型仍待拍板（D-2）。

**D-1 第二段进度（2026-11-12 · 模型轨实现单已交付 · 中间态）** → [交付记录](../completed/phase2.5/phase2.5-d1-model-classifier-implementation-2026-11-12.md)

- **落地形态**：core 恰好 **2 个文件**（`EventClassifier.classifyAsync?` + `ClassifyContext.sessionId?`，不新增文件 / 不新增导出名 / 不改 `CounselorEventKind` 联合）；adapter 新增 `src/engine-adapters/cognition/` 四个文件（三态模式 + 标签映射 + 旁路观测 + 模型轨实现）。
- **本节 §4.2 候选方向 2「判定器缺口」的三点结构性不可达**：①「只看咨询师本轮文本、看不到来访上一轮话语」→ **已跨过**（模型轨 prompt 送上一轮来访话语，来源是编排器已有历史，未扩 core 输入类型）；②「`classify` 无跨轮状态、记不了连续缺席轮数」→ **已跨过**（按业务 `sessionId` 分桶，跨轮状态含 `turnIndex` / 连续中性 / 连续缺席 / 熔断计数，`forgetSession` + TTL 2h 双保险）；③「词表无在场标记类条目」→ **仍在**（模型轨靠语义判定，不靠词表，但本单**不产出新 core kind**，故仍进不了 delta）。
- **本节 §4.2 候选方向 1「事件类型拆分」**：**本单未做**，属 D-2。改动面按预研结论 F2 仍是 **4 个文件**（`state-transition.ts:197` 的穷尽 `Record` + `event-tag-labels.ts:35` 的穷尽 `Record` + 2 个 core）。本单**未扩联合** → GATE2 类型检查通过时这两处无需改。
- **本节 §4.2 候选方向 3「模式先验」**：仍不复议（DOC-2 结论）；模型轨可见来访上一轮话语，不依赖 cold 先验。
- **新增的审计侧约束（C3）**：审计**停止自行分类**、只吃内核事件 → 审计事件 `matchedTerms` **归零**（内核出参只带 kind），`wp58` 两条既有断言已按任务单授权调整（`strength` 断言保留、`matchedTerms` 断言改 `toEqual([])`），并新增「审计事件集合 == 内核事件集合」断言。恢复需扩内核出参（第 3 个 core 文件）→ D-2 或另开例外。
- **闸门**：lint **0 error 0 warning** / boundary **12 绿** / 定向 **100 文件 1839 例**（基线 99/1779）/ 全量 **3171 passed + 4 skipped（3175 例，191 文件）** / `git diff --stat HEAD -- src/engine-core` 恰好 2 文件。

**D-2 进度（2026-11-12 · 事件类型拆分已交付 · 中间态）** → [交付记录](../completed/phase2.5/phase2.5-d2-event-kind-split-implementation-2026-11-12.md)

- **本节 §4.2 候选方向 1「事件类型拆分」**：**已落地**。两类新 kind（`holding_present` 稳定在场 / `cold_absent` 冷漠缺席）进 `CounselorEventKind` 联合（11 → **13** 类）+ `DELTA_TABLE` 两行 + 三处口径登记表（`COUNSELOR_EVENT_LABELS` / `TRACKED_EVENTS` / `CORE_EVENT_KIND_TABLE`）；`neutral` **保留**作兜底第三类（不删）。
- **改动面**：core **恰好 4 个既有文件**（`session-event.ts` / `state-transition.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts`，+44/−5）—— 任务单例外批准表逐条对应，**零新增 core 文件 / 具名导出**，`boundary.spec.ts` 未改（12 绿）。adapter 7 个既有文件 + 业务层 2 个 + 脚本 1 个。
- **种子 = `ZERO`**：临床方向与幅度**不进** core 基础表，只登记为**标定批次候选**（`holding_present` safety +0.002 / bond +0.001；`cold_absent` trust −0.002）。理由 = T3 幅度叠加（I-08 仍待批次复验）。**零回归**：两类事件的当轮 delta 与 `neutral` 逐字相同。
- **本节 §4.2 附带登记（G-4 词表子串重叠）**：**未动** —— 规则轨词表**不扩**（`event-lexicon.ts` 一字未改），D-1 第一段的基线快照 spec **一字未改**（39 例仍绿）。
- **本节 §4.2 候选方向 2「判定器缺口」**：D-1 第二段已让模型轨跨过「看不到来访话语」「无跨轮状态」两条；D-2 把「词表无在场标记」那条**在模型轨侧**也跨过（模型轨靠语义判定）—— 但**规则轨仍产不出**两类新 kind（本单不扩词表）。
- **新增的连带面（已登记）**：① 审计恢复词明细（内核出参新增 `eventDetails`），D-1 期间「`matchedTerms` 归零」的已知代价**解除**；② 配置指纹 `stateTransition` 段**会变**（`state-transition.ts` 内容变了）→ 跨批次比较会报「配置变了」，这是**正确归因**；③ 指标字典版本 `dict-v2` → **`dict-v3`**（新增 4 个纯数值事件指标）；④ 两类新 kind **刻意不开 env 覆写通道**（本单不新增 env 键），标定批次那一单再开。
- **闸门**：tsc build 0 错 / 全量类型检查 **401 条 / 87 文件 = HEAD `2bf32f0` 实测基线逐字一致**（本单相关 0 错）/ lint **0 error 0 warning** / boundary **12 绿** / 定向 **101 文件 1866 例**（基线 100/1839）/ 全量 **3201 passed + 4 skipped（3205 例，192 文件）**。

### 4.3 S-3 · I-19 时序 / 节奏不敏感（C4 状态模型结构，风险最高）

**现象**：`aggregateTurnDelta` 对事件 kind × strength 逐维累加，`SessionEvent` 无位置 / 时序字段；跨轮纯加法完全可交换，第 2 轮共情与第 12 轮共情对最终状态贡献等价。台账证据：两场对话内容不同、事件位置不同，但事件计数相同 → 状态演化结果完全相同。同轮内多事件叠加撞 `capTurnDelta` 是唯一有顺序 / 组合语义的地方。

**为什么调系数解决不了**：缺的是状态模型对"节奏"的表达能力，不是任何一维的幅度；属结构债，不是数值债。

**候选方向（仅方向，须先做协议评估；形态比较与硬伤据 DOC-2 B.3）**：

1. 轮次衰减 / 近期加权 / 事件时序窗口三种形态：权重只作用于**已发生事件**。共同硬伤——三者都表达不了"缺席"（缺席是没有事件，累加模型里没有它的位置）；且权重在聚合前缩放会改变 cap 判定，同一事件在第 2 轮与第 12 轮被砍 / 不砍的结论可能翻转；既有批次轨迹不再可比。
2. 或引入"在场 / 节奏"状态量（与 S-2 的 holding 通道协同），而非直接给 delta 加时序权重；语义变更最大，下游全部消费者（轨迹 / 安全 / 意图 / 批次指标）心智模型都要换。
3. 协议变更评估先行：`transitionState` 是已发布公共契约；参照 `transitionStateDetailed` 先例——不改原出口返回形状，新能力另起出口。新算子端口化，缺省回退旧纯累加行为。

**硬前置（DOC-2 B.4，全部满足才可开工）**：

- P1 不新增内核公开导出名、不新增内核 `.ts` 文件：权重配置优先扩已导出的 `TransitionStateOptions` 可选字段，用内联结构类型承载；权重纯函数做既有文件内模块私有函数。确需新增具名导出或新文件，必须同步改 `boundary.spec.ts` 白名单与清单——本批禁止，须任务单例外批准。
- P2 权重配置走注入端口，内核零 `process.env`（断言⑩），与 cap / 人格 / 同盟 / 衰减同款范式。
- P3 必须先落地 I-18 的 `cold_absent` 事件：否则权重只能重分配已发生事件，表达不了"什么都没发生"；顺序不可反（先 D-2 拆事件，再 D-3 加权重）。
- P4 权重配置进 WP-K 配置指纹 `stateTransition` 段：该段已存在（挂 `state-transition.ts` 文件哈希）；配置载体落在既有文件内即自动覆盖，若新增载体文件须扩段映射，否则新旧批次会被当成同口径比较。
- P5 先定权重与 cap 的裁决顺序（权重在 cap 前还是 cap 后），写进口径文档。

**改动面**：`TransitionStateOptions`（可选字段，非新增导出）、`aggregateTurnDelta` / `transitionState`、`in-memory-engine-session` 调用链（轮次号由 `runtime.turnIndex + 1` 填入，口径同轨迹触发器 `MatchContext.turnIndex`）、adapter 审计复用点、快照回放与既有测试；配置指纹段映射。

**回归风险：高**。影响状态可复现性契约、落库快照口径、轨迹回放。必须先产出旧模型逐字可复现基线（固定事件序列 → 快照序列）；新算子缺省关闭、回退旧路径；灰度期不默认启用。

**前置**：S-2 事件拆分（D-2）已落地并复验；单独协议评估备忘（参照 DOC-2 备忘体例），明确是否破坏 boundary 纯函数契约。
**D-3 进度（2026-11-13 · 端口骨架已落地 · 仅 `none` 形态 · 零行为变化）**：

- **已落地**：`TransitionStateOptions` 扩 `timingWeight?` / `turnIndex?` 两个可选字段；`state-transition.ts` 内新增**模块私有纯函数** `resolveTimingWeight` / `scaleDeltaVector`；两处管道在 **`capTurnDelta` 之后**接入折损点（P5 口径落地：cap 是最后一道尺子，权重不得绕过它；cap 报告仍按 `raw → capped` 构造，**折损不改变砍幅结论**）；会话层透传 `runtime.turnIndex + 1`（1 起）+ 构造注入的 `timingWeightConfig`；adapter `engine.providers.ts` 透传同款端口。
- **本单只落地 `none` 形态**：三形态曲线与临床斜率（`slope` / `windowTurns`）**留标定批次单**；未实现形态**回退等权 1.0**（未实现形态不得改变行为）。
- **零行为变化**：缺省 = 内核决策链里没有折损这一步；缺省 / `none` / 三种非 `none` 形态的整快照逐字相同（`toEqual`）。**结构表达能力已就位，但行为差异仍未发生** —— 状态演化仍然对轮次位置不敏感，这是预期。
- **仍未闭合**：① 三形态纯函数实现 + 标定值；② 权重 env 覆写通道（本单刻意不开）；③ **落库路径**折损接入（`none` 恒等下两路径逐字一致，接入点与口径已登记）。
- **闸门**：tsc build 0 错 / 全量类型检查 **401 条 / 87 文件 = HEAD `960adbc` 实测基线逐字一致** / lint **0 error 0 warning** / boundary **12 绿** / 定向 **102 文件 / 1881 例** / 全量 **3216 passed + 4 skipped（3220 例，193 文件）** / engine-core **恰好 2 文件**（+111/−4）。
- **交付记录**：[`phase2.5-d3-timing-weight-port-implementation-2026-11-13.md`](../completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-2026-11-13.md)。

## 5. 边界复核

### 5.1 纯度断言：维持不松

上述三个方向都可以用纯函数 + 注入端口满足，不需要把 `@nestjs` / typeorm / env / prompt / 随机状态放进 core。前两轮核查未发现"纯度锁死导致纯逻辑被迫下放"的既成事实；历史唯一一次副本分叉是 `clamp01` 三份副本，已由 `cb45025` 统一回 core。

### 5.2 形状与公开面断言：伴随登记，不私改测试

- 断言⑥ barrel 双向白名单、断言⑦ 文件清单双向锁定是刻意摩擦，目的是防公开面漂移与散落文件。新增 core 导出或文件时，在开工单里显式列出需同步登记的断言清单；本草案不修改 `boundary.spec.ts`。
- 副作用盯防：
  1. 新 core 文件漏登记 → 被断言⑦ `extra` 误拦；
  2. 为绕白名单把纯逻辑挪去 adapter → 制造第二套副本与口径分叉。

### 5.3 领域模型缺口对照

| 缺口            | 当前状态                                                  | 归属                  |
| --------------- | --------------------------------------------------------- | --------------------- |
| 同盟与防御正交  | WP-L 在数值层解耦；类型上 resistance 与 alliance 本就分组 | C1 已缓解，待批次复验 |
| 节奏 / 在场表达 | 模型无位置字段、无在场状态量                              | S-2 / S-3             |
| 情绪角色差异    | 端口已通（valenceScale / arousalScale），倍率种子 1.0     | I-20，待标定批次      |
| 事件类别粒度    | neutral 合并有效中性与冷漠缺席                            | S-2                   |

## 6. 建议顺序（供拍板，不在本草案批准开工）

1. **C5 判据分层（I-16 / I-24 口径）**：12 轮档只验 intake 阶段行为、不验探索；探索放 40 轮档。评测层改动，不碰 core，先做以解除验收口径对 core 改动的叠加干扰。
2. **S-1 门槛端口化（I-11，D 编号外独立项）**：`LOW_DEPTH` 并入端口 + 可达性对账；core 低风险结构改动，缺省零回归；与模型轨解耦，可先行。
3. **模型轨事件分类器（D-1，对应 I-01 / I-02 / I-18 共同根因）**：~~先人工抽 30 轮 expert 发言与规则判定对比，把真实漏判率钉死~~ → **第一段取证已交付**（2026-11-12）：96 场 / 1112 轮全量逐轮投影，`neutral` 误吞上界 **89.39%**（Wilson 95% [0.8744, 0.9107]）+ 分层证据 + 规则轨基线快照 + 标注骨架 + 人工标注对照（台账 §7.1：在场承接 56/56 被吞，cold_absent 本样本 0）；**模型轨分类器本身仍未实现**，产出 `holding_present` / `cold_absent` 的能力待第二段开工单。
4. **事件级拆分（D-2，S-2）**：新增 2 个 kind + 表行 + 分类器接线；依赖 D-1。模式先验（D-4）DOC-2 不建议单独实施，列 P3 待拍板。
5. **时序权重端口（D-3，S-3，I-19）**：协议评估先行，风险最高，排在 D-2 之后；缺省回退旧纯累加；满足 §4.3 P1~P5 全部前置。
6. **标定批次后**：I-20 临床倍率填值 + adapter env 键扩列；I-23 `safetyScale` 复核；I-21 cold 阈值样本外转正；I-22 反向语义取证。

## 7. 待拍板项（本草案不替用户批准）

1. 哪些结构债进 core、哪些留 adapter（分层见 §3、方向见 §4）。
2. ~~I-19（D-3）是否做、何时做；若做，接受何种协议变更形式；权重与 cap 裁决顺序取哪种。~~ **已拍板（2026-11-13）**：做，先复核备忘（已交付）后派实现开工单；协议形式 = 扩已导出 Options 可选字段 + 模块私有纯函数；形态仅 `none` 骨架；裁决顺序 cap 后折损。
3. S-2 走事件类型拆分（D-2，依赖模型轨 D-1）；模式先验（D-4）DOC-2 不建议单独实施，是否仍列为 P3 过渡。
4. `LOW_DEPTH` 是否端口化；若端口化，种子值是否维持 0.35。
5. 灰度期阈值冻结纪律是否对上述端口化改动例外：按 conventions，灰度期默认不调子强度 / 阈值，确需调整须在任务单明确例外批准。
6. 是否授权未来在确有必要时新增 core 具名导出 / 文件（D-6），同步扩 `boundary.spec.ts` 白名单；当前口径是不新增、只扩已导出类型可选字段。

## 8. 开工阶段闸门要求（仅约束未来任务单，本文不执行）

- 先建旧模型逐字快照基线（固定事件序列 → 快照序列）；新算子缺省配置下行为与现状逐字一致。
- 全量 `pnpm typecheck`、`pnpm lint`、`pnpm test` 当场复跑并回填真实数字（命令以仓 `package.json` 为准，禁裸 npx）；时间数字须带机器状态（是否有长驻进程、盘读取延迟）。
- boundary 断言⑥⑦同步登记；`src/engine-core` diff 须在任务单例外批准范围内。
- 隐私：文档与审计输出只出 id、计数、比率、布尔、归一化字符数；不含心理对话原文。
- 既有债与本次新增改动分开记录；不顺手重构相邻旧文件。

## 9. 附录

### 9.1 关键参考文档

- 台账：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md`
- 规范：`docs/team/conventions.md` §1.1（core / adapter 判定）、§二（交付格式）
- 边界测试：`test/engine-core/boundary.spec.ts`
- I-12 交付记录：`docs/worklog/completed/phase2.5/i12-per-session-threshold-plumbing-2026-11-11.md`
- I-20 交付记录：`docs/worklog/completed/phase2.5/i20-valence-arousal-role-coefficients-2026-11-11.md`
- neutral 拆分与时序权重评估备忘：`docs/worklog/completed/phase2.5/doc2-neutral-split-timing-weight-assessment-2026-11-11.md`
- I-23 归因备忘：`docs/worklog/completed/phase2.5/phase2.5-i23-safety-delta-attribution-2026-11-12.md`

### 9.2 已闭环 / 挂起复验项速查

- 代码与装配已闭环：I-12、I-13、I-14（G-2 待口径）、I-15（G-3 待口径）、I-21（cold 档待样本外）、I-22（方向待新批次）。
- 数值已调、待批次复验：I-03、I-04、I-05、I-06、I-07、I-08。
- 端口已通、待标定批次填值：I-20 倍率；I-23 safetyScale 复核。
- 非 core 待数据：I-02 漏判率人工标注；I-17 同源性跟踪；I-24 的 40 轮档。

### 9.3 DOC-2 后续任务编号对照（备忘 §七，本草案不派单）

| 编号      | 条目                                                                                                        | 优先级 | 前置                                                                                                                                  | 对应本草案                                                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1       | 模型轨事件分类器（产出 `holding_present` / `cold_absent`）                                                  | P0     | —（**第一段取证已交付** 2026-11-12）                                                                                                  | §6 第 3 步；I-01 / I-02 / I-18 共同根因；中性误吞上界 89.39% 已钉死                                                                                                                                         |
| D-2       | 事件级拆分（2 个 kind + 表行 + 分类器接线）                                                                 | P0     | D-1（**已交付** 2026-11-12）                                                                                                          | §6 第 4 步；S-2（**事件拆分已交付** 2026-11-12：2 个 kind + 表行 + 映射收敛，**种子 ZERO**；「分类器接线」只剩 `llm_active` 生效轨，**独立成单**）                                                          |
| D-3       | 时序权重端口（扩 `TransitionStateOptions` + 模块私有纯函数 + adapter env 装配 + 指纹 `stateTransition` 段） | P2     | D-2（已交付）+ P1 不新增导出 / 文件；**复核备忘已交付** 2026-11-13；**实现单已交付** 2026-11-13（仅 `none` 形态骨架，**零行为变化**） | §6 第 5 步；S-3（**端口骨架已落地** → [D-3 交付记录](../completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-2026-11-13.md)；三形态曲线与临床斜率留标定批次，env 通道未开，落库路径接入待同批） |
| D-4       | cold 模式先验（方案 1）                                                                                     | P3     | —                                                                                                                                     | DOC-2 不建议单独实施；待拍板                                                                                                                                                                                |
| D-5 / G-4 | 词表子串重叠：`'你觉得'` ⊂ `'你觉得呢'`，单轮 trust 双计                                                    | P3     | —                                                                                                                                     | §4.2 附带登记                                                                                                                                                                                               |
| D-6       | `boundary.spec.ts` 白名单扩展授权（确需新增 core 导出 / 文件时）                                            | P2     | —                                                                                                                                     | §7 第 6 项待拍板                                                                                                                                                                                            |

### 9.4 复核取证说明

- 二次复核的 core 文件清单与字节大小留存在 `data/quality/verify-core-tree-2026-11-12.log`（gitignore 隐藏，不入库）；复核脚本 `scripts/ops/quality/phase25-verify-17-22-2026-11-12.ts` 只读 DB 元数据与离线逐字稿，无对话原文。
- 本草案引用的事件率、可达轮次、测试基线均来自台账或已归档交付记录，属批次 / 历史口径；开工单阶段须当场复跑复算，不沿用本文数字。
