# Phase2.5 WP-J · P1a 交付记录：停滞判定重设计 + 危机后置练习窗

> 状态：**P1a 已落地并通过验证**（`tsc` 干净 / lint 0 error / 单测 39 绿 / 48 份真实逐字稿标定完成）
> 日期：2026-11-10
> 分支：`integrate`，未提交
> 关联：`wp-h-wave2-3-and-observability-task-2026-11-10.md`（P3 由 MiniMax 承接）、`phase2.5-wp-h-wave1-canary-verification-2026-11-09.md`（金丝雀原始数据）

---

## 0. 一句话结论

金丝雀 24 场里被判"停滞"的 5 场，**全部是咨询师侧误判**，且触发文本的字符相似度只有 0.00~0.04（阈值 0.6，差两个数量级）—— 真正命中的是语义层（阈值 0.5）在连续命中。新口径下这 5 场**全部翻案**，且在有效批次上**没有产生一条新的误判**。

---

## 1. 立论：判据对象错位，不是阈值太严

### 1.1 我先前猜错了

第一版猜测是"阈值太严"。为验证，写了临时回放脚本（`.tmp-stagnant-probe.mjs`）逐对回放 5 场 `stagnant` 的逐字稿，结果推翻了这个猜测：

| 观察 | 数值 | 含义 |
|---|---|---|
| 触发判定的一侧 | 5/5 全是**咨询师**侧 | 来访者侧一次都没触发 |
| 触发对的字符 3-gram Jaccard | 0.00 ~ 0.04 | 字面层（阈值 0.6）差两个数量级 |
| 真正命中的层 | 第④层"语义簇"（阈值 0.5） | 抓的是"连续两轮都在谈工作/领导/担心" |

语义相邻是什么？**反映式复述**——把来访者的话用咨询师的语言还回去。这是真人咨询师最基础的技术动作，AI 比真人更容易踩。**判定抓的是技术动作，不是停滞**。属产品级 bug。

### 1.2 由此得出的判据重设计

判定要回答的问题不是"这句话像不像上一句"，而是**"来访者有没有产出新信息"**。因此拆成三条，且**只有来访者侧能终止对话**：

| 判据 | 度量 | 阈值 | 含义 |
|---|---|---|---|
| A-① 字面复读 | 全等 / 长文前 15 字 + 长度差 <10% / 字符 3-gram | 连 2 轮 | 同一句话反复说 = 真卡死 |
| A-② 无推进 | 与**历史全部**来访文本的最大字符 3-gram | ≥0.8 连 3 轮 | 聊了 N 轮没有新信息（含跨轮绕回） |
| A-③ 语义回响 | 表达状态簇交集 + 话题不冲突 | ≥0.5 | **只记指标**，永不终止 |

**为什么要 A-② 而不是只保留 A-①**：旧口径只跟"上一轮"比。来访者来回打转 A→B→A′→B′，每一对相邻都不同，旧口径完全漏判，一路跑到 maxTurns（历史 1034 场里 49.7% 跑满就是这个形态）。A-② 跟**全部历史**比，才抓得到"回到老话题"。

**口径重叠（设计事实，不是退化）**：0.8 与 0.6 建立在同一个字符 3-gram 度量上，所以"与上一条 ≥0.8"必然同时命中字面层。两者行为一致（都终止），A-② 的独有价值在**跨轮**形态。这一点已写进单测注释，避免后人误以为是 bug。

---

## 2. 改动清单（P1a，逐处理由在代码注释里）

### 2.1 `src/auto-practice/practice-runner.service.ts`

| 改动 | 内容 |
|---|---|
| 常量 | 新增 `STAGNANT_LITERAL_STREAK_LIMIT=2` / `STAGNANT_NO_PROGRESS_LIMIT=3` / `NO_PROGRESS_SIMILARITY_THRESHOLD=0.8` / `CRISIS_PRACTICE_TURNS=4`；删除 `STAGNANT_REPEAT_LIMIT` |
| 纯函数 | `isLiteralRepeat` / `maxCharNgramSimilarity` / `probeStagnation` / `isSemanticEcho`（原 `isSemanticNearDuplicate` 改名并**降级为指标**）/ `crisisLevelOf`；旧的 `isNearDuplicate` 已删除 |
| 判定收敛 | **新增 `decideTurn()`** —— 单轮"要不要停、停成什么"的唯一出口；`runConversationLoop` 只执行副作用。判定与执行分离，标定脚本可按同一份代码回放，避免两条路径漂移 |
| 危机 | `crisisDetected → break` 改为**进后置练习窗**：披露当轮不终止；之后满 4 轮 → `crisis_practice_max`；咨询师 `closeRequested` → `crisis_practice_close`；**只有强度档位上升**（`level > peakLevel`）才 `crisis_escalated` |
| 危机轮收尾保护 | 披露当轮就想收尾 → 挡一次并 `logger.warn`（不能把来访者一个人留在危机里） |
| 指标 | 新增 `PracticeRunMetrics`：`counselorSemanticEchoTurns` / `crisisPracticed` / `crisisFirstTurn` / `crisisPostTurns` / `crisisPeakLevel` / `crisisCategory` / `crisisEscalated`，`RunPracticeResult.metrics` 必填 |

危机强度档位映射（`CRISIS_LEVEL_BY_CATEGORY`）：

| 档 | 类别 |
|---|---|
| 0 | `suicide_exploration` |
| 1 | `passive_ideation`（未知类别也按 1：承认判出危机，但不冒充最严重档） |
| 2 | `active_ideation`、`self_harm_ideation` |
| 3 | `suicide_plan`、`suicide_preparation`、`suicide_attempt`、`self_harm_behavior`、`aggression_*` |

### 2.2 `src/auto-practice/counselor-agent.service.ts`

新增 `CRISIS_STABILIZATION` 阶段任务（安全确认 / 稳定化 / 下一步），**不推进新议题、不深挖创伤细节、不做解释性诠释**，安全确认未完成前不收尾。

理由：后置窗若沿用 `CRISIS_PROTOCOL`，咨询师会顺着剧情深挖，把训练目标从"危机应对"带成"创伤暴露"——那不是这个产品的训练目标。

`generate` 与 `buildMessages` 加第三参 `crisisMode`，system 末尾条件拼接。

### 2.3 `src/auto-practice/auto-practice.events.ts`

`AutoPracticeSessionEndPayload` 加可选 `crisisPracticed` / `crisisPostTurns`。注释写明 `crisisEnded`（因危机**终止**）与 `crisisPracticed`（**继续练过**）是两个维度，可同时为 true。

### 2.4 单测（30 例）

- `test/auto-practice/practice-runner.spec.ts`（11 例）：危机后置窗三支（`crisis_practice_max` / `crisis_escalated` / 收尾被挡）、复读、**来回打转判 no_progress@5**、咨询师复读**不再终止**只记指标、引擎异常
- `test/auto-practice/dialogue-quality.spec.ts`（19 例）：`isLiteralRepeat` / `isSemanticEcho` / `maxCharNgramSimilarity` / `probeStagnation` / `crisisLevelOf`

日志实证（单测输出，已脱敏为数字）：

```
危机披露 → 进入后置练习窗 turn=2 level=1 (不终止, 续 4 轮)
对练结束 reason=crisis_practice_max crisis=1/post=4/peak=1
对练结束 reason=crisis_escalated    crisis=1/post=1/peak=3
判停滞 turn=5 literal=0 no_progress=3 max_sim=0.96     ← 来回打转
对练结束 reason=max_turns semantic_echo=4            ← 咨询师一直同一状态，但不再终止
```

### 2.5 标定脚本 `scripts/ops/calibration/stagnation-calibration.ts`

- 直接 `npx tsx` 跑 `src` 源码（`tsx` 在 devDependencies），不必等全量构建
- 调**生产同款** `decideTurn()` 回放，不另写一套规则（否则标定会跟线上漂移）
- 隐私红线：只输出 session id / 状态 / 轮次 / 相似度数字，**不打印任何对话文本**
- 刻意不叫"准确率"：DB 里的 `status` 是**旧口径**产物，不是人工真值

---

## 3. 标定结果（48 份真实逐字稿）

```
npx tsx scripts/ops/calibration/stagnation-calibration.ts YiBgpQSxbQh_q663IiVbT gzu9tnrBuXzztNMizliYh
```

### 3.1 全量

| 项 | 数 |
|---|---|
| 场次总数 | 48 |
| 有逐字稿可回放 | 48（缺 0） |
| 旧口径判停滞 | 8 |
| ├ 新口径**不再判**（翻案） | **5** |
| └ 新口径仍判 | 3（全为 `literal`，字面复读） |
| 旧口径漏判 / 新口径判 | 17 |

### 3.2 分批 —— 这是关键，决定了怎么解释

| 批次 | 性质 | 旧判停滞 | 翻案 | 仍判 | 新增命中 |
|---|---|---|---|---|---|
| `YiBgpQSxbQh_q663IiVbT` | **有效批**（HEAD 代码，真实 LLM，兜底率 0.0%） | 5 | **5** | 0 | **0** |
| `gzu9tnrBuXzztNMizliYh` | **无效批**（旧 dist，兜底率 82.9%，tokens=0） | 3 | 0 | 3 | 17 |

结论分两半，必须分开说：

1. **有效批上：误判清零，且新增误判为 0。** 这是本次改动的核心验收项。
2. **无效批上：17 条新增命中不是"新误判"，而是把旧产物的兜底句停滞如实抓了出来。** 该批来访者台词来自 4 句兜底池（263 句中 218 句兜底，重复率 81.4%），"聊了没新东西"在那批数据里**字面成立**。它是负对照，不是新口径的质量证据。

→ **不能拿坏数据批当标定依据**。新口径的质量结论只取自有效批，以及未来的人工标注集。

### 3.3 5 场翻案明细（全部来自有效批）

| session | 角色 / 模式 | 旧 | 新 |
|---|---|---|---|
| `debug_STX1vBcXb8_sQajNld4eq` | secure / expert | stagnant@8 | 不终止（语义回响 2 轮） |
| `debug_YE_Ta5QZoqggDqafrJhyT` | social_anxious / expert | stagnant@9 | 不终止（回响 3 轮） |
| `debug_rnICjW43kUGeU8l3pVRhZ` | social_anxious / expert | stagnant@5 | 不终止（回响 2 轮） |
| `debug_xQyqRZfvSOMYwHoGqoLP1` | trauma_disorganized / expert | stagnant@6 | 不终止（回响 2 轮） |
| `debug_oOHbWm6X_hC3WN9fyn5pS` | trauma_disorganized / cold | stagnant@9 | 不终止（回响 2 轮） |

### 3.4 3 场"仍判"是对的

`debug_cYpvR9nLljZ2NVOLQmQ_Q` / `debug_YEWI13yG6o5HXCGQq0B8S` / `debug_C1VYZHBkPahhSkZhABEx1`，旧状态均为 `stagnant_heavy_degraded`，新判全是 `literal`。它们是旧产物的兜底句重复，**判停滞正确**——这也反过来证明新口径没有一刀切地"放行"。

---

## 4. 闸门

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**（整仓干净，含 MiniMax 并行改的 P3 文件）。中途曾因为我 lint 重构期间它半成品文件里的 `TS6133` 红过一次，它修完后重新全绿 —— 判红绿灯时必须先看报错文件属于谁 |
| lint | `npx eslint src/auto-practice/*.ts test/auto-practice/*.spec.ts` | **0 error**（重构前 7 error：复杂度 29/20、认知 44/25、prettier、3 处 mock 类型） |
| 单测 | `npx vitest run test/auto-practice` | **39 passed**（4 文件；含本次两个 spec 的 30 例） |
| 标定 | 见 §3 | 有效批 5/5 翻案，0 新增误判 |

> 重构说明：为把 lint error 清零，把 `runConversationLoop` 的判定逻辑抽成纯函数 `decideTurn()`，圈复杂度从 29 降到阈值内，认知复杂度从 44 降到阈值内。这是结构性改善，不是压 lint 数字。

---

## 5. 未完成（明确记录，不假装完成）

| 项 | 状态 | 阻塞点 |
|---|---|---|
| **P1b 危机指标落库** | 未做 | 等 MiniMax 交"实体列与迁移已落地"。**它当前只落了 render 5 列，危机 4 列还没有** |
| **P2 来访者质量评测体系 v1** | 未开始 | — |
| **阈值人工标定** | 未做 | 0.8 / 连 3 轮 / 危机窗 4 轮仍是工程种子值；方案承诺的"真阳召回 ≥90%、假阳 ≤5%"需 20 场人工标注集验证 |
| **jump 与 P2 素材** | 就绪 | `data/archives/debug-sessions-baseline-20261109/`（501 份 + MANIFEST） |
| **临时脚本清理** | 待办 | `.tmp-stagnant-probe.mjs` 已被标定脚本取代，应删除 |

### 并发编辑告警（重要）

MiniMax 正在**同一仓库**执行 P3。实测证据：

- 新增（未跟踪）：`src/auto-practice/practice-batch-health.service.ts`（16KB，mtime 0:40:28）、`src/config/envs/db-logging.ts`、`src/migration/1714900000039/…0040…`、`src/auto-practice/entities/practice-batch.entity.ts`、`bin/ormconfig.ts` 改动
- 已改：`practice-session.entity.ts`（+58 行，render 5 列）、`inference-fingerprint.service.ts`、`practice-queue.service.ts`、`auto-practice.controller.ts`

**文件所有权边界仍守住了**：`practice-runner.service.ts`（mtime 0:34，我最后一次编辑）与 `practice-runner.spec.ts` 没有它的改动痕迹。

因此：**任何 tsc 红灯都要先看报错文件属不属于我**。属于它的半成品，不动、等它交付；属于我的，当场修。当前那条 `practice-batch-health.service.ts(19,16) TS6133 'resolve' is unused` 属于前者。

---

## 6. 下一步顺序

1. 等 MiniMax 交 P3（含危机 4 列？**不在**它的任务单里 —— 危机列是我 P1b 的活，需它交列后我自己加）→ 澄清交接范围
2. P1b：加 `crisis_practiced` / `crisis_post_turns` / `crisis_peak_level` / `crisis_first_turn` 四列 + 迁移，把 `PracticeRunMetrics` 写进 `updateSessionResult`
3. P2：来访者质量评测 v1（离线脚本先出数，不落库）—— 6 维度 + 随机基线，**先测基线再定目标**
4. P4：100 场批次（P1 不通过不开跑，那 5 元/批就是白花）
