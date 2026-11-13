# D-7 · 模型轨 `llm_active` 生效轨接线 —— 评审 + 实现完成

- **仓库**：`E:\Work\Project\backend\mofang-nestjs`（分支 `integrate`，基线 HEAD `7ad1644`）
- **完成时间**：2026-11-13 09:40:36 +08:00
- **交付记录**：`docs/worklog/completed/phase2.5/phase2.5-d7-classifier-llm-active-wiring-implementation-2026-11-13.md`
- **任务单**：`docs/worklog/completed/phase2.5/phase2.5-d7-classifier-llm-active-wiring-task-2026-11-13.md`（状态行已改 ✅，§7.2 checklist 7 项全勾）

---

## 一、开工单四点评审结论（先评审挑遗漏，再实现）

### (a) 两处挂点放开后，反向 grep 消费链 —— 有无遗漏装配注入点？

**结论：无遗漏。** 装配注入点恰好两处（`engine.module.ts:436` 内核会话 `classifier` 端口、`:499` 门面 `modelClassifierContext` 跨轮上下文端口），本单各改一行；其余 grep 命中全是消费端或 provider 单例。逐段读源码核实：

- **内核侧**：`:436` → `createEngineSessionPort(..., { classifier })` → `engine.providers.ts` 的「有才传」三元 → `InMemoryEngineSession` 构造项 → `in-memory-engine-session.ts:419-426` 的 `classifyAsync ? await : classify`（**两分支互斥**）。**没有第三个注入点。**
- **门面侧**：`:499` → `createEngineOrchestrator({ modelClassifierContext })` → `turn-render-orchestrator.ts:456`（窄端口 `ModelClassifierContextPort`）+ `:782-788` `prepareModelClassifierContext`（每轮前写上一轮来访话语）+ `:795-801` `clearModelClassifierContext`（会话关闭清分桶）+ 调用点 `:625` / `:771`。
- **唯一真相源未被破坏**：逐场判定仍是 `resolveModelClassifierSessionMode`（`model-classifier-mode.config.ts:155-167`），配置层与分类器共用同一份 modeConfig；装配层**没新增第二套判定**。
- **`ModelEventClassifier` 是单例 provider**（`:358`）——跨轮状态分桶要求内核与门面拿**同一个**实例，本单**不动 provider**；`:402` / `:470` / `:512` 三处依赖注入的参数不变。
- **反向确认**：`rule_only` 形态下内核走缺省 `RuleBasedClassifier`，与模型轨同接口可替换，不存在「第三条路径」。

### (b) `:373-377` warn 文案 —— 原文案不妥当，已改

原文案 `[d1] 模型轨 llm_active 通路本单**未接线** (留 D-2) —— 按 rule_only 运行` 在本单之后是**假话**（两处都错：通路已接线；且不是「按 rule_only 跑」，是「名单内按 llm_active、名单外按 rule_only」）。

**改为**：`[d7] 模型轨 llm_active 生效轨已装配 —— 名单内场次每轮关键路径多一次 LLM 往返`

理由：① 去掉误导性断言；② **保留并强化「烧钱提醒」**（运维真正需要的信息，即 `.env.example` 那句提醒的正式版）；③ 写清「全局 ≠ 全场生效」，逐场判定在分类器内部；④ 前缀 `[d1]` → `[d7]`（否则误导成「还是 D-1 的中间态」）；⑤ **隐私红线** —— 只出形态提示，不含会话 id / 名单内容 / 心理内容（名单规模上一行 info 日志已有 `灰度名单=N 场`，warn 不重复、不细化）。

### (c) 三例 spec —— 是下限，不够；补到 9 例（含 1 例内核级落地断言）

三例覆盖了「有效标签 / 回落 / 名单外」，漏掉了**红线类**与**跨层类**。补的 6 例：

1. `llm_active` + 考核场景 → 零 LLM（exam 红线**不被名单穿透**；既有 spec 只在配置层与 shadow 下守过，**没有生效态下的分类器层守护**）。
2. 总开关关 + 模式写着 `llm_active` → 装配层读到 `rule_only`、零 LLM（配置层 + 分类器层各一条；既有只测了「总开关开 + 模式没配」，**没测「总开关关 + 模式写 llm_active」**）。
3. 低置信回落**不计入熔断**（阈值 = 1 时第二轮照样发 LLM，且模型结果进 core）。
4. `llm_active` + 拿不到 sessionId → 零 LLM、逐字回落规则轨。
5. **内核级断言**：装配挂端口 → 内核 await `classifyAsync` → 模型事件真进 core events（证明整条链通，不只是分类器返回值对）。
6. 配置层：总开关先于模式。

**明确不补**：① engine.module 工厂级挂点 spec —— §1.2.1 已拍板，仓库无此范式；起 Nest 容器会破坏「零 IO / 不连 DB」的全 mock 纪律。② `d2-event-kind-split.spec.ts` —— 逐条核过，现有断言**无一条**显式引用「llm_active 未接线」措辞，无需同步（§3.1-C-8 的条件不成立）。③ 门面消费端 spec —— 代码一字未改，D-1 既有集成 spec 已覆盖。

### (d) 隐式 core 耦合 —— 不需要碰 core；但「纯装配层小改」这个判断本身是错的

**core 侧零耦合（逐段核查，不靠猜）：**

- 内核 `classifyAsync` 异步口 D-1 已开好（两分支互斥），内核不需要任何改动。
- `DELTA_TABLE` 两类新 kind 种子**仍是 `ZERO`**（`state-transition.ts:358-359`，D-2 已落）→ 模型判 `holding_present` / `cold_absent` 那轮 delta **逐字为零**，不触发任何数值路径变化。
- core 内**唯一**按事件 kind 分支处是 `personality-modulator.ts:313`（`agreeableness` 的 trust 调节门槛：本轮**有 empathy 事件**才调节）。生效轨下该门槛跟**模型判定**走（模型判 `holding_present` 而规则轨判 `empathy` → 本轮不调节）。这是「模型事件替换规则轨事件」的必然推论，语义正确，**登记为观测点不改代码**。
- D-2 L-8 提到的 `hasNonNeutralEvent`，实测**不在 core**，在**评测层** `src/auto-practice/metrics/batch-metrics.compute.ts:208`（零变化场次细分）。生效轨下两类新 kind 会被判为非 neutral → 该场从「空转」改判「合理封闭」。**属评测口径，留标定批次反向取证**，本单不改。

**但接线逮到一处真缺陷 —— 必须多改一行 adapter 业务分支，不改就是「接线即埋雷」：**

D-1 留下的 `classifyAsync` 分支只判 `outcome.labels`、**不判 `fallbackReason`**：

```ts
// 接线前 (D-1 留下)
if (mode === 'llm_active' && outcome.labels) {
  return outcome.labels.coreKinds.map((kind) => ({ kind, matchedTerms: [], strength: 1 }));
}
```

- 低置信路径返回 `{ labels: <非 null>, fallbackReason: 'low_confidence' }` —— 标签**带着**回来（模型标签仍要进观测），但这一轮**判定不可用、已回落**。
- 原分支只看 `labels` → 低置信轮会把模型事件**当生效结果**送进 core events。
- **shadow 模式下看不见**：shadow 分支永远返回 `ruleEvents`，压根不走这条路径 —— **接线 = 把这条分支暴露到生产路径**。
- **违反硬约束 4**：「回落路径（… / 低置信 / …）一律返回规则轨等价事件」。
- **修法**：条件加 `&& outcome.fallbackReason === null`（**一行**）；熔断 / 低置信 / 超时参数一个未动，回落代码仍只有 `this.rule.classify` 一处。

这条是新增用例 #3「低置信回落不计入熔断」**直接逮到的**——它先红后绿，是本单最有价值的产出之一。

---

## 二、实现（改动文件全部既有，零新增文件）

| 文件                                                      | 改动                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/engine.module.ts`             | ① import 补 `type ModelClassifierEffectiveMode`；② 新增模块私有 helper `isModelTrackWired(mode)`（**不导出**，两处挂点单一真相源）；③ `:389-396` warn 文案改写（`[d1]`→`[d7]`）；④ `:450-457` 内核 classifier 挂点条件放开 + 注释同步；⑤ `:515-521` 门面 `modelClassifierContext` 挂点条件放开 + 注释同步 |
| `src/engine-adapters/cognition/model-event-classifier.ts` | ① 文件头三态形态段重写（补 `rule_only` 行 + 改写 `llm_active` 语义）；② `:425-437` `llm_active` 分支加 `outcome.fallbackReason === null` + 注释说明                                                                                                                                                       |
| `.env.example`                                            | `:511` 主行改为「**已接线** (D-7): 名单内场次模型轨事件进 core, 名单外仍 rule_only」；`:510` 去掉已过期的「(首版形态)」括注。**键名 / 缺省值 / 行数一字未动，CRLF 行尾保持**                                                                                                                              |
| `test/engine-adapters/model-event-classifier.spec.ts`     | 文件头「六段行为」→「七段行为」；配置组 +1 例；新增 `模型轨 · 生效模式` describe 组 +7 例；内核契约组 +1 例。**既有 59 例断言一字未改**                                                                                                                                                                   |

**零改动面（实测）**：`src/engine-core` **空** / `src/admin-dashboard` **空** / 配置解析 `model-classifier-mode.config.ts` · 标签映射 `model-event-mapping.ts` · 观测带 `model-classifier-observation.ts` **空** / 审议 `deliberation/**` 与审议挂点三行 **空** / 规则轨词表 `event-lexicon.ts` **空** / DB migration · 实体 · 审计落库结构 **空**。

**三态装配行为（与任务单 §4.1 矩阵一致）**：

| 全局模式            | 装配挂点                          | 名单内场次                                                           | 名单外场次                                  | exam / 场景查不到        |
| ------------------- | --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ------------------------ |
| `rule_only`（缺省） | **不挂** classifier、不挂 context | 规则事件                                                             | 规则事件                                    | 规则事件（红线）         |
| `shadow`            | 挂 classifier + context           | 模型轨跑观测，**返回规则事件**（core / BDI 逐字不变）                | 同左                                        | 规则事件（红线，零 LLM） |
| `llm_active`        | 挂 classifier + context           | 模型轨有效标签 → **模型事件进 core events / delta**；回落 → 规则事件 | 规则事件（逐场 `rule_only`，零 LLM 零观测） | 规则事件（红线，零 LLM） |

缺省零回归 = 不配 env → 总开关关 → `effectiveMode = rule_only` → 两个端口都不挂 → **决策链里根本没有模型轨这一步**（不是「结果一样」，是「没走那条路」）。

---

## 三、闸门实测（真实命令 / exit code / 数字 / 墙钟）

前置：`cd E:\Work\Project\backend\mofang-nestjs`；`$env:PATH = 'D:\Apps\Git\cmd;' + $env:PATH`；工具链 pnpm（**禁裸 npx**）。

| 闸门                                     | 命令                                                                                         | exit            | 实测数字                                                                               | 墙钟                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 类型（build）                            | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                              | **0**           | 0 error                                                                                | 15.0s                                                     |
| 类型（含 spec）                          | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`                      | **2**（既有债） | **401 条 / 87 文件 = HEAD `7ad1644` 基线逐字一致，本单新增 0 错**                      | 21.1s                                                     |
| Lint                                     | `pnpm lint`                                                                                  | **0**           | **0 error / 0 warning**                                                                | 25.2s（首跑 200.7s 因 2 处 prettier 换行错 → 修后复跑绿） |
| 边界护栏                                 | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                     | **0**           | **12 例全绿**                                                                          | 5.0s                                                      |
| 分类器单文件                             | `pnpm exec vitest run test/engine-adapters/model-event-classifier.spec.ts`                   | **0**           | **68 例全绿**（基线 59 → **+9**）                                                      | 4.0s                                                      |
| 定向（三路径 · 开工单 §6 命令）          | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters`                    | **0**           | **102 文件 / 1890 例全绿**（基线 102 / 1881 → **+9**）                                 | 37.3s                                                     |
| 定向（四路径 · 含 `test/auto-practice`） | `pnpm exec vitest run test/auto-practice test/quality test/engine-core test/engine-adapters` | **0**           | **121 文件 / 2196 例全绿**（基线 121 / 2187 → **+9**）                                 | 49.7s                                                     |
| 全量                                     | `pnpm test`                                                                                  | **0**           | **193 文件 / 3240 例：3236 passed + 4 skipped + 0 failed**（基线 193 / 3231 → **+9**） | 85.8s                                                     |

**变更面实测**（`git diff --stat HEAD -- <path>`）：`src/engine-core` **空** · `src/engine-adapters` 2 个既有文件 **+45/−15** · `.env.example` 1 个既有文件 **+2/−2** · `src/admin-dashboard` **空** · `test` 1 个既有文件 **+130/−2**。

**机器状态**（本会话实测）：Node **v26.13.0** / pnpm **9.15.0** / PowerShell 5.1.26100.9818 / Windows NT 10.0.26300.0 / 8 核（采样负载 26%）/ 内存总 **15.88 GB**、空闲 **5.52 GB** / 常驻进程 **288**（TOP5 WS：Memory Compression 894 MB、Doubao 880 MB、Code 544 MB、explorer 500 MB、MiniMax Code 466 MB）/ 盘读延迟：连续读 `package.json`（7731 B）× 200 = **41 ms** → **avg 0.205 ms/read** / C 盘空闲 **66.8 GB**。

---

## 四、实际方案 vs 任务单偏差（5 条，均已在交付记录登记）

| #   | 任务单口径                                                                                  | 实际做法                                                               | 理由                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §3.1-B-3「classifyAsync 分支逻辑**逐字不改**」                                              | **改了分支条件一行**（加 `&& outcome.fallbackReason === null`）        | 硬约束 4（低置信必须回落规则轨）与「逐字不改」在接线后**互相矛盾**，后者会让低置信模型事件漏进 core。**红线优先**；这正是评审 (d) 的核心发现    |
| 2   | §3.1-B-2「`.env.example:511` 注释更新；行数不动」                                           | 改了 **2 行**（`:511` 主行 + `:510` 去掉过期「(首版形态)」括注）       | `:510` 的「首版形态」在接线后是**过期描述**，留着误导运维；行数 / 键名 / 缺省值一字未动                                                         |
| 3   | §3.1-A「条件从 `=== 'shadow'` 放开为 `=== 'shadow'                                          |                                                                        | === 'llm_active'`」                                                                                                                             | 抽成模块私有 helper `isModelTrackWired(mode)`，两处共用 | 两处条件必须**恒等**，写两遍就是两套真相源 |
| 4   | §3.1-B-3「只同步文件头与分支注释」                                                          | 同步文件头 + 分支注释（**含新增的低置信判定说明**）                    | 与偏差 1 配套；不写清「为什么多判一个 `fallbackReason`」，下一个人会当冗余条件删掉                                                              |
| 5   | §6 闸门表「定向 `test/quality test/engine-core test/engine-adapters` = 121 文件 / 2187 例」 | 三路径实测 **102 文件 / 1890 例**；另跑四路径 = **121 文件 / 2196 例** | 任务单的 121/2187 是 C5-1 交付记录里**四路径**命令的数字，被误标成三路径（D-3 交付记录记的三路径基线是 102/1881）。**两条命令都跑了**并分别登记 |

**未发生的偏差**：core 零改动、前端零改动、配置解析 / 标签映射 / 观测带三文件一字未动、审议挂点一字未动、阈值（3 次 / 60s / 0.6 / 3000ms）一个未调、两类新 kind 种子仍 `ZERO`、无新增 env 键、无新增文件。

---

## 五、遗留登记（本单不闭合）

沿用任务单 L-1 ~ L-7（临床幅度与缺席阈值 / L-8 语义反向取证 / 成本与 429 / 词表「在场标记」/ 前端新 kind 展示 / 既有类型债 / pending 历史回执归档），**本单新增 2 条**：

- **L-8（本单新增）**：生效轨下「模型事件替换规则轨事件」的**全部下游语义影响尚未做反向取证** —— 目前只登记了 `personality-modulator.ts:313` 一处；其余按事件 kind 分支的下游本单**未做全量审计** → 标定批次取证单。
- **L-9（本单新增）**：生效轨下门面的跨轮上下文端口也一并挂上 → 跨轮状态分桶**持续累积**（内存随场次增长）。有 `forgetSession` 主清理 + 2h TTL 兜底，但**长会话 + 多场并发的内存上限未实测** → 灰度批次评估。

另按 T7 显式留痕：**本单接的是通路，幅度改善待标定批次赋表行增量** —— 模型判 `holding_present` / `cold_absent` 那轮 delta 仍为零，**不是「接线无效」**。

---

## 六、§7.2 回写清单（全部执行）

- ✅ 交付记录写到 §7.1 路径
- ✅ 任务单移入 `completed/phase2.5/` + 状态行改 ✅ + 链接交付记录
- ✅ 任务单 §7.2 checklist 7 项全勾
- ✅ 台账 §7.5 D-2 节：L-5 状态回填（生效轨已接线）+ L-8 仍挂标定批次；另加 **§7.7 D-7** 节
- ✅ 结构债草案 §9.3 D-2 表行备注同步（→「已由 D-7 接线」）+ §6 第 4 步进度列更新；另同步 I-01 / I-18 两行的 L-5 状态
- ✅ 活清单 `phase2.5-wp-list-2026-11-08.md` **与** `phase2.5-README.md` **两处都**登记本单
- ✅ 各变更面 `git diff --stat` 实测记录进交付记录
- ✅ 提交分组隔离（未跟踪的 `data/quality/*.diff` × 7 与两个 archive 回执均非本单产出，不入库）+ commit message 草稿；**未自动 commit / push**

**commit message 草稿**：

```
feat(engine-adapters): D-7 模型轨 llm_active 生效轨接线（shadow/llm_active 两态挂分类器与跨轮上下文端口，名单内场次模型事件进 core）
```

建议正文补一句：`fix(model-event-classifier): llm_active 分支补判 fallbackReason，低置信回落不再把模型事件漏进 core`。

---

## 七、隐私自检

新增 9 例断言里只出现**事件 kind 枚举**（`holding_present` / `cold_absent` / `empathy`）与 D-1 既有的**人工构造样例**，**无真实心理内容入库、无新增 fixture**；启动 warn 文案**无会话 id / 无名单内容 / 无心理内容**；改动文件均不含 prompt 全文 / `kernelState` / 展示名；模型轨事件的 `matchedTerms` 仍为**空数组**（不造词）。
