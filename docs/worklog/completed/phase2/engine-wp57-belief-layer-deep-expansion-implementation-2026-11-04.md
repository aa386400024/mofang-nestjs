# WP57 交付记录 — BDI 信念层深度扩展（核心信念激活 + 短期信念置信度衰减）

> 状态: ✅ 已交付
> 任务单: [`wp57-belief-layer-deep-expansion-2026-11-04.md`](wp57-belief-layer-deep-expansion-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ⚠️ **engine-core 已改（预批准例外）** —— `git diff --stat HEAD -- src/engine-core` 含 **6 个本 WP 文件**（295 insertions / 8 deletions），**无其他文件**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：6 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `domain/beliefs.ts` | **新增** `export type CoreBeliefActivation = Readonly<Record<string, number>>`（key = `CoreBelief.theme`，value = 激活强度 [0,1]）。`CoreBelief` / `TemporaryBelief` / `MemoryBelief` 三个接口**一行未动** |
| `domain/bdi-snapshot.ts` | `BdiSnapshot` **新增字段** `readonly coreBeliefActivation: CoreBeliefActivation`；`cloneBdiSnapshot()` 带 `{ ...snapshot.coreBeliefActivation }`（浅拷贝一层） |
| `domain/bootstrap.ts` | `buildInitialSnapshot()` 用 `Object.fromEntries(coreBeliefs.map((b) => [b.theme, 0]))` 初始化（无核心信念 = 空对象 `{}`） |
| `cognition/state-transition.ts` | **新增** `BeliefOperatorConfig` 端口 + 6 个种子常量 + 3 个纯函数（`applyBeliefActivationDelta` / `applyTemporaryBeliefDecay` / `applyBeliefEvolution`）；`applyDeltaVector()` 显式带过 `coreBeliefActivation`；`TransitionStateOptions` 新增 `counselorText?` / `beliefConfig?`；`transitionState()` 与 `transitionStateDetailed()` 管道**末端**接入 `applyBeliefEvolution` |
| `in-memory/in-memory-engine-session.ts` | 临时快照传 `counselorText: userText`；**落库路径**改为 `applyBeliefEvolution(applyDeltaVector(base.snapshot, cappedTotal), userText)`（详见 §2.1 —— 这是本单最关键的一处发现） |
| `index.ts` | barrel 导出新符号（类型 + 3 个纯函数 + 6 个常量），供 boundary 断言⑥ 白名单同步 |

### 1.2 测试

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp57-belief-layer.spec.ts` | **新增**，397 行 / **33 例**（激活 / 衰减 / 多信念独立 / introduced-vs-observed / 阈值移除 / 空信念 / 重复 theme 顺序无关 / 零回归 / 管道接线 / **落库路径** / 边界） |
| `test/engine-core/boundary.spec.ts` | 断言⑥ 白名单**追加 12 个新符号**（断言本身一行未改）—— barrel 双向白名单不登记就等于新符号没被守卫 |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp57-belief-layer-deep-expansion-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§10 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP57 行 ✅ + 交付记录链接；统计进度 6/35 → 7/35；engine-core 例外表 +WP57 行 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP57；进度回写 7/35；目录结构说明 +WP57 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 偏差①（最重要）：**落库路径必须单独接一次信念算子** —— 否则整套机制空转

任务单 §4.3 写的是「`transitionState()` 管道里接入」。按字面实现，机制看着跑、实际**永远不生效**。

**为什么**：内核**落库**走的不是 `transitionState`。`in-memory-engine-session.ts` 的落库口径是（WP26 P2-12）：

```
事件 delta + 剧本 delta → 合并 → 过一次 cap → applyDeltaVector(base.snapshot, cappedTotal) → 落库
```

而 `transitionState` 只产出**临时快照**（`provisional`，供意图规划与轨迹触发判定用）。所以只在 `transitionState` 里接信念算子的话，**每轮算出来的激活强度随临时快照一起被丢掉**，落库快照永远不带信念演化 —— 这比不做还坏：测试会误以为通了，实际状态里什么都没有。

**实际交付**：落库路径显式接一次 ——

```ts
const nextSnapshot = applyBeliefEvolution(applyDeltaVector(base.snapshot, cappedTotal), userText);
```

**代价**：改了 `in-memory-engine-session.ts`。它**不在**任务单 §6.1 的预批准清单里（清单只列了 `beliefs.ts` / `bdi-snapshot.ts` / `state-transition.ts` / `bootstrap.ts` 四个文件）→ **已获用户 2026-11-04 当面批准**。

**两处口径为什么必然一致**：临时快照与落库快照**各自从 `base.snapshot` 出发**，各演一次 → 结果相同，且**不会重复演化**（同 WP34 人格调节的「两处口径」模式）。两条用例把这条钉死：
- 「落库路径真的带上信念演化」—— 断言 `out.snapshot` **和** `bdiStates.load()` 读回的落库记录**都**带上了激活强度；
- 「第二轮不命中 → 上一轮的激活强度被衰减」—— 断言状态真的接续了（第二轮读到的是第一轮的结果）。

### 2.2 偏差②：匹配源从「事件 `matchedTerms`」改为「**咨询师原文**」

任务单 §4.3 / §5.1 写的是「遍历事件，对每个事件的 `matchedTerms`，检查是否命中某个 coreBelief 的 `activationTags`」。

**问题**：两组词表**完全独立**（任务单 §2.3 自己核实过的事实）：

- `matchedTerms` 来自规则分类器：静态词典（empathy / judgment / …）+ 角色的 `sensitiveTopics`；
- `activationTags` 是**另一组**词表，来自角色种子的核心信念。

两组词表**不重叠**时，按事件匹配会让这套机制**永远是死的** —— 而角色种子通常不会把 `activationTags` 抄进 `sensitiveTopics`（它们语义本就不同：`activationTags` = 「什么议题会激活这个信念」，`sensitiveTopics` = 「什么话题要小心碰」）。任务单 §5.1 的设计恰好踩在这个空档上。

**实际交付**：匹配源 = 本轮**咨询师原文**（`TransitionStateOptions.counselorText`，由会话层注入 `userText`）。咨询师原文才是「提到了这个议题」的真相源 —— 事件是「原文经词典筛过之后」的二次结果，拿二次结果去匹配另一张词典，必然漏。

**代价**：需要把原文传进内核（`TransitionStateOptions` 多一个字段）。这是**纯注入**，不违反内核边界（断言② 零网络 / 断言④ 零 prompt / 断言⑩ 零 env 仍绿）。

### 2.3 偏差③：匹配只做**单向**包含（任务单 §5.1 写的是双向）

任务单 §5.1 写「双向子串匹配」。双向口径是为「**事件 matchedTerms ↔ 激活标签**」设计的 —— 两边都是**短词**。

换成「**长文本 ↔ 标签**」后，反向（标签包含整段文本）只在文本比标签还短时才命中 —— 比如来访只说了「嗯」而标签是「不安全感」，那不是命中，是噪声。

**实际交付**：只做「文本包含标签」这一向（`matchesActivationTag`）：大小写不敏感、空白标签不参与匹配（`trim()` 后为空 → 直接不命中）。

### 2.4 偏差④：同 theme 的多个信念**共享**一份激活强度，且「命中任一即命中」（与顺序无关）

任务单 §5.3 写「如果真有重复 theme，后者覆盖前者（和 JS 对象行为一致），不报错」。

**问题**：「后者覆盖前者」意味着同 theme 的两个信念**只有一个的标签生效** —— 引擎在替角色配置做取舍，而且取舍结果**取决于数组顺序**。

**实际交付**：按 theme 归并，**同 theme 的所有信念的 `activationTags` 合并成一个标签集**，命中任一即算命中；两个数组顺序不同的同 theme 信念，激活强度**逐字相同**（专门用例钉死）。

**理由**：theme 唯一是**角色配置的责任**，引擎不该让一个配置笔误变成「行为取决于数组顺序」的不确定性。`bootstrap.ts` 的初始激活强度用 `Object.fromEntries` 建，同 theme 也只留一个键（值为 0）—— 与算子口径一致。

### 2.5 决策：算子放在 `cognition/state-transition.ts`，**不新开** `cognition/belief-operators.ts`

任务单 §4.3 指定放在 state-transition.ts（与实际一致）。这里补记**为什么不新开文件**：新开文件会把 engine-core 的改动面从「1 个认知文件 + 3 个域文件」变成「4 个认知文件」，二次触发「改 engine-core 其他地方需确认」；而且信念算子与 delta 算子共用同一批端口范式、也共用同一个管道末端 —— 同文件 = 口径只有一份。

### 2.6 决策：新增组合函数 `applyBeliefEvolution`（先激活 → 后衰减）

内核有**两处**消费点（临时快照 / 落库快照）。两处各写一遍「先激活后衰减」的顺序，迟早有一处写反。

**实际交付**：导出 `applyBeliefEvolution(snapshot, counselorText, config?)` = `applyTemporaryBeliefDecay(applyBeliefActivationDelta(...))`，两处都调它 → 组合口径只有这一份。

**顺序**：先加后衰减（任务单 §3.1 口径）。本轮命中 +0.15 后乘 0.8 → **0.12**；反复命中的渐近上限 = 0.15 / (1 − 0.8) = **0.6**（用例钉死：既不会瞬间拉满，也不会永远回到 0）。

### 2.7 决策：系数走 `BeliefOperatorConfig` 端口，非法值**逐项**回退种子值

与 cap（`DeltaCapConfig`，WP26 P2-14）/ 人格（WP34）/ 同盟（WP42）同一范式：内核只认端口，不读 env（断言⑩ 仍绿）。端口是**公开契约**，任何人都能 new 一份配置塞进来 —— 一个 > 1 的衰减率会让置信度**不降反升**，一个负数会让它变号，两者都会把整份快照污染成不合法状态。所以内核这层再校验一遍：**无论谁注入，衰减都还是衰减**（同 `session-decay.ts` 的 `sanitizeHalfLife` 纪律，WP36）。

**本期不接 env**（任务单 §6.2「不碰适配层的任何代码」）—— 适配层将来要调参时在构造注入处覆写即可。

### 2.8 决策：激活强度放**快照**而不是 `CoreBelief` 结构里

`CoreBelief` 是**角色内核**的一部分 —— 同一个角色、不同场次会话，激活状态应该独立（A 场被激活过，不代表 B 场也带着这份强度）。把动态状态放进静态结构 = 角色种子被运行时状态污染，换场就串味。所以激活强度是**会话级动态状态**，与快照同生命周期。

### 2.9 决策：`applySessionDecay` **不用改**（跨会话自动保留，但**不衰减**）

`session-decay.ts` 用 `cloneBdiSnapshot(snapshot)` + `...base` 展开 → `cloneBdiSnapshot` 带过新字段即自动跨会话保留，**零改动**。

但：跨会话时激活强度**不衰减** —— 这是任务单 §5.2 登记的缺口，本期明确**不做**（保持零回归）。已登记进 backlog，见 §4 第 1 条。

### 2.10 决策：信念状态本期**不参与任何决策**

grep 确认 cognition 内**无任何代码读 beliefs**。「激活强度高 → 来访更防御 / 措辞更短」是**后续 WP** 的事（任务单 §8 第 2/3 条）。本期只立机制。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **94 个测试文件 / 1433 例全绿**（WP55 基线 93 文件 / 1400 例 + 本轮新增 **1 文件 / 33 例**，**零回归**：1400 + 33 = 1433 ✓） |
| `npx vitest run test/engine-core/wp57-belief-layer.spec.ts` | **33 例全绿** |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（边界断言全过：零 @nestjs / 零网络 / 零 env / 零 prompt） |
| `git diff --stat HEAD -- src/engine-core` | **6 个文件**（`state-transition.ts` / `bdi-snapshot.ts` / `beliefs.ts` / `bootstrap.ts` / `in-memory-engine-session.ts` / `index.ts`），295 insertions / 8 deletions —— **全是本 WP 文件，无其他** |

**回归确认**：

- 信念算子**不碰** delta 维度 —— `transitionState` 带 / 不带 `counselorText` 两次调用的 `trust` / `safety` / `bond` / `emotion` / `resistance` / `transference` **逐字相同**（用例钉死）；
- 初始激活强度全为 0 时，整轮下来信念层**逐字不变**（零回归基线）；
- `applyDeltaVector` 显式带过 `coreBeliefActivation` —— 漏掉它 = 每回合把激活状态清零；
- `cloneBdiSnapshot` 带过新字段 —— 克隆不是清零；
- 快照是**值语义**：算子不就地改传入快照；同输入同输出。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **跨会话时 `coreBeliefActivation` 不衰减** —— 任务单 §5.2 登记的缺口。激活强度是**动态状态**，隔了一周它应该回落（像情绪平复一样），但 WP36 的 `applySessionDecay` 里信念相关字段逐字不动（`session-decay.ts` 的注释明确列了 `coreBeliefs / temporaryBeliefs / memoryBeliefs` 属于「稳定人格特质或认知结构」）。本期保持零回归不动，**后续 WP 补**（可考虑与情绪同档 7 天半衰期）。⚠️ 不补的话，「隔一周回来，激活强度还满着」是**已知偏差**。
2. **短期信念形成机制** —— 什么时候形成 introduced / observed 信念？需要判断「来访接不接受咨询师的解释」，另开 WP（任务单 §8 第 1 条）。本期 `temporaryBeliefs` 初始是空数组 → 衰减算子**没有对象可衰减**（机制已立、内容待填）。
3. **信念对渲染 / delta 的反作用** —— 激活强度高时共情的 trust 增益该不该打折扣？本期不做（任务单 §8 第 2/3 条）。
4. **愿望层 / 意图层**、**信念冲突消解**（两个矛盾的信念同时激活怎么办）—— 后续 WP（任务单 §8 第 4/5 条）。
5. **env 接线** —— `BeliefOperatorConfig` 端口已就位，但适配层本期不读 env（任务单 §6.2）。

---

## 5. 系数说明

本期全部系数是**工程种子值，非临床标定** —— 待真实对练校准：

| 系数 | 种子值 | 形状的理由 |
|---|---|---|
| `activationDelta` | +0.15 | 一次命中抬到「明显被激活」，但不至于一击拉满 |
| `activationDecayRate` | ×0.8 | 议题不在眼前时信念就该淡下去（否则它一直挂着，变成常驻背景音） |
| `introducedDecayRate` | ×0.9 | 咨询师**给的**解释只是「听见了」，来访没消化就慢慢淡下去 |
| `observedDecayRate` | ×0.95 | 来访自己悟出来的记得更久 —— **设计选择**，不是临床标定 |
| `removeThreshold` | < 0.1 移除 | 低于这条线的短期信念不再值得留在工作记忆里 |

---

_创建：2026-11-04_
_深度通知：任务单 §2.3（两组词表独立）/ §4.3（管道末端）/ §5.1（匹配口径）/ §5.2（跨会话缺口）/ §5.3（theme 唯一性）逐条核实 + 真实代码 grep（transitionState 两处消费点 / loadState 落库口径 / session-decay 的 cloneBdiSnapshot 展开）_
