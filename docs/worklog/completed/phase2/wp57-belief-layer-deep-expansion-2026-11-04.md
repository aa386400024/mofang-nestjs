# WP57 任务单 — BDI 信念层深度扩展（核心信念激活 + 短期信念置信度衰减）

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp57-belief-layer-deep-expansion-implementation-2026-11-04.md`](engine-wp57-belief-layer-deep-expansion-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp57-belief-layer-deep-expansion-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ **预批准改 engine-core**（信念算子是决策层逻辑，放适配层破坏纯层）
> **前置依赖**：WP1（基础算子）、WP42（同盟三维）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 推理层

---

## 1. 任务概述

### 1.1 一句话目标

给 BDI 的"B"（信念）补上最基础的动态算子——核心信念有了"激活强度"，短期信念的置信度会随轮次自然衰减。现在信念三层都只是静态结构，没有演化机制。

### 1.2 为什么现在做

- 终局蓝图里 BDI 推理层只完成了 **30%**，其中信念层是最薄的一块——结构有了，算子为零
- 现在 `applyDeltaVector` 里信念三层全部原样透传，一行都不改
- `CoreBelief.activationTags` 定义了"什么议题会激活这个信念"，但**没有任何代码消费它**——activationTags 是死数据
- `TemporaryBelief.confidence` 一旦形成就永远不变——咨询师引入的信念和来访自发形成的信念，衰减速度没有区别

---

## 2. 现状盘查结论（已 grep 全 src/ 核实）

### 2.1 信念三层结构（`domain/beliefs.ts`）

| 层 | 结构 | 现状 |
|---|---|---|
| **CoreBelief** | `theme` / `statement` / `activationTags[]` | 永久不可变，✓ 结构对；但 `activationTags` **没有任何代码消费它**——"激活"只是概念，没有实际机制 |
| **TemporaryBelief** | `id` / `statement` / `confidence` / `source: 'observed' \| 'introduced'` | 初始是空数组；`confidence` **不会衰减**——introduced 和 observed 衰减速度没有区别 |
| **MemoryBelief** | `id` / `statement` / `confidence` / `expiresAt` | 召回是 WP2 的事，本期不碰 |

### 2.2 状态迁移管道（`cognition/state-transition.ts`）

- `applyDeltaVector()` 第 644-646 行：信念三层**全部原样透传**——`coreBeliefs: snapshot.coreBeliefs` / `temporaryBeliefs: snapshot.temporaryBeliefs` / `memoryBeliefs: snapshot.memoryBeliefs`
- delta 表 11 个维度：trust / safety / bond / verbal / depth / style / valence / arousal / positive / negative / dependency——**没有一个和信念相关**
- 注释明确写了："信念层 / 愿望层规则轨不改写（原样透传，其演进入模型轨 / 后续）"

### 2.3 事件与 activationTags 的关系

- `sensitive_touch` 事件来自角色的 `sensitiveTopics` 词表（`rule-based-classifier.ts` 第 32-37 行）
- 核心信念的 `activationTags` 是另一组词表——**两者完全独立，没有关联**
- 也就是说：咨询师提到"被抛弃"这个词时，`sensitiveTopics` 里有就触发 `sensitive_touch`，但核心信念里"我是不值得被爱的"这个信念的激活强度**不会变化**

### 2.4 初始状态（`domain/bootstrap.ts`）

- `coreBeliefs`：从 profile 拷贝，有 activationTags ✓
- `temporaryBeliefs`：初始空数组 `[]`
- `memoryBeliefs`：初始空数组 `[]`

---

## 3. 本期做什么（范围严格控制）

### 3.1 核心信念激活机制

**目标**：咨询师文本命中某个核心信念的 activationTags 时，该信念的激活强度上升；不命中时，激活强度逐轮衰减。

**设计决策**：
- `CoreBelief` 结构**不改**——它是角色内核，永久不可变
- 激活强度是**动态状态**，放在 `BdiSnapshot` 里，而不是 CoreBelief 结构里
- 新增字段：`coreBeliefActivation: Readonly<Record<string, number>>` —— key 是 `CoreBelief.theme`，value 是激活强度 [0,1]
- 初始：所有核心信念的激活强度都是 `0`（没被激活）

**激活规则**：
- 当咨询师本轮文本命中某个信念的 `activationTags`（任一标签命中）→ 该信念激活强度 += 固定增量（种子值 +0.15，工程种子值，待校准）
- 每轮结束后，所有信念的激活强度逐轮衰减（乘性衰减，每轮 ×0.8，工程种子值）
- 激活强度 clamp 到 [0,1]

**为什么放在快照里而不是 CoreBelief 里**：
- CoreBelief 是角色内核的一部分——同一个角色，不同场次会话，激活状态应该是独立的
- 激活强度是会话级动态状态，不是角色属性

### 3.2 短期信念置信度衰减

**目标**：`TemporaryBelief.confidence` 随轮次自然衰减，introduced（咨询师引入）衰减快，observed（来访自发形成）衰减慢。

**衰减规则**：
- 每轮结束后，所有 temporaryBeliefs 的 confidence 乘性衰减
- `source: 'introduced'`：每轮 ×0.9（衰减快——咨询师说的道理，来访慢慢就忘了）
- `source: 'observed'`：每轮 ×0.95（衰减慢——来访自己悟出来的，记得更久）
- confidence clamp 到 [0,1]
- confidence 低于阈值（0.1）时，自动从 temporaryBeliefs 里移除（工程种子值，待校准）

**为什么 introduced 衰减快**：
- 临床上，咨询师给的解释（"你这是因为害怕被抛弃"）如果来访没有自己消化，只是"听见了"，慢慢就淡化了
- 来访自己在对话中形成的想法（"我好像真的不太敢相信别人"），是自己悟出来的，记得更久
- 这个区别是设计出来的，不是临床标定——标"工程种子值，待校准"

---

## 4. 具体改动点

### 4.1 `domain/beliefs.ts` —— 不改结构，加类型

- 不改 `CoreBelief` / `TemporaryBelief` / `MemoryBelief` 的接口
- 新增类型：`CoreBeliefActivation = Readonly<Record<string, number>>` —— theme → 激活强度

### 4.2 `domain/bdi-snapshot.ts` —— 加字段

- `BdiSnapshot` 新增字段：`readonly coreBeliefActivation: CoreBeliefActivation`
- `createEmptyBdiSnapshot()` / `buildInitialSnapshot()` 初始化：空对象 `{}`（没有核心信念就没有激活）
- `cloneBdiSnapshot()` 浅拷贝一层：`coreBeliefActivation: { ...snapshot.coreBeliefActivation }`

### 4.3 `cognition/state-transition.ts` —— 信念算子接入管道

- 新增纯函数：`applyBeliefActivationDelta(snapshot, events): BdiSnapshot`
  - 输入：当前快照 + 本轮事件
  - 逻辑：
    1. 先算激活增量：遍历事件，对每个事件的 `matchedTerms`，检查是否命中某个 coreBelief 的 activationTags
    2. 命中的信念，激活强度 += 增量（种子值 +0.15）
    3. 然后所有信念的激活强度乘性衰减（×0.8）
    4. clamp 到 [0,1]
- 新增纯函数：`applyTemporaryBeliefDecay(snapshot): BdiSnapshot`
  - 遍历 temporaryBeliefs，按 source 乘性衰减
  - confidence < 0.1 的移除
- `transitionState()` 管道里接入：聚合 delta → 人格调节 → cap → 落快照 → **信念激活更新** → **短期信念衰减**
  - 信念算子放在 `applyDeltaVector` **之后**——因为信念衰减是每轮自动发生的，和事件 delta 无关
  - 顺序：状态迁移 → 信念激活更新 → 短期信念衰减 → 返回新快照

### 4.4 `domain/bootstrap.ts` —— 初始激活

- `buildInitialSnapshot()` 里：如果有 coreBeliefs，初始化 `coreBeliefActivation` 为所有 theme 对应 0
- 没有 coreBeliefs 就是空对象 `{}`

### 4.5 `index.ts` —— 导出新符号

- 导出 `CoreBeliefActivation` 类型
- 导出 `applyBeliefActivationDelta` / `applyTemporaryBeliefDecay` 纯函数
- 导出默认种子常量：`DEFAULT_BELIEF_ACTIVATION_DELTA` / `DEFAULT_BELIEF_DECAY_RATE` / `DEFAULT_TEMPORARY_BELIEF_REMOVE_THRESHOLD`

---

## 5. 边界问题补充（专家级扫描后新增）

### 5.1 ⚠️ activationTags 和 sensitiveTopics 是两个独立词表

**现状**：
- `sensitive_touch` 事件的 `matchedTerms` 来自角色的 `sensitiveTopics` 词表（`rule-based-classifier.ts` 第 32-37 行）
- 核心信念的 `activationTags` 是另一组词表——**两者完全独立，没有关联**

**本期怎么匹配**：
- 在状态迁移层面做匹配，**不改分类器**（分类器是适配层的事）
- 当 `sensitive_touch` 事件触发时，遍历所有 `coreBeliefs`，检查事件的 `matchedTerms` 是否命中该信念的 `activationTags`
- 匹配方式：**双向子串匹配**（大小写不敏感）—— 只要 `matchedTerm.toLowerCase()` 包含 `activationTag.toLowerCase()`，或者反过来包含，就算命中
- 命中的信念，激活强度 += 增量
- 没命中任何 activationTags 的 sensitive_touch 事件，不影响任何信念激活强度

**为什么不在分类器层面做**：
- 分类器是规则轨，本期不改——改分类器要动 `rule-based-classifier.ts` 和 `ClassifyContext`，那是另一个 WP 的范围
- 状态迁移层面做匹配，虽然不是最精确的，但本期够用了——后续要精确了再下沉到分类器

### 5.2 ⚠️ WP36 跨会话衰减不覆盖信念激活

**现状**：`session-decay.ts` 第 18-22 行明确说了：
> "coreBeliefs / temporaryBeliefs / memoryBeliefs / underlyingDesires / situationalDesires / transference 是稳定人格特质或认知结构 —— 它们不因为'隔了几天没说话'而改变。"

**问题**：`coreBeliefActivation` 是**动态状态**，不是稳定人格特质——隔了一周，激活强度应该自然回落（就像情绪会平复一样）。但 `applySessionDecay` 里信念相关的字段是逐字不动的。

**本期处理**：
- 本期**先不扩展** `applySessionDecay`——保持零回归
- 在任务单里登记这个缺口，后续 WP 再补：跨会话时，`coreBeliefActivation` 应该按某个半衰期衰减（比如和情绪同档 7 天）
- 理由：本期先把"场内"的激活机制做出来，"跨会话衰减"是锦上添花，不阻塞主流程

### 5.3 ⚠️ coreBeliefActivation 的 key 唯一性

**现状**：`coreBeliefActivation: Record<string, number>`，key 是 `CoreBelief.theme`。

**问题**：如果两个核心信念 theme 一样怎么办？会互相覆盖。

**本期处理**：
- 假设 `theme` 在角色种子里是唯一的——这是角色配置的责任，不是引擎的责任
- 如果真有重复 theme，后者覆盖前者（和 JS 对象行为一致），不报错
- 在测试里加一条：两个 theme 相同的信念，激活强度共享（因为 key 相同）

### 5.4 ⚠️ temporaryBeliefs 初始为空数组，衰减没有对象

**现状**：`temporaryBeliefs` 初始是空数组 `[]`，本期不做形成机制。

**问题**：那衰减算子本期是不是就没有实际效果？

**答案**：是的，本期只做**机制**，不做**内容**——就像 WP1 先立状态机骨架，再往里填算子。后续 WP 做形成机制时，衰减算子直接就能用。

**在测试里要覆盖**：
- 空数组输入 → 空数组输出，不报错
- 有 1 条 introduced + 1 条 observed → 衰减后 confidence 不同

### 5.5 ⚠️ 信念算子在管道里的接线位置

**现状**：`transitionState()` 管道是：聚合 delta → 人格调节 → cap → 落快照。

**本期接线**：
- 信念激活更新和短期信念衰减，放在 `applyDeltaVector` **之后**——因为它们是每轮自动发生的，和事件 delta 无关
- 顺序：状态迁移（事件 delta 落快照）→ 信念激活更新 → 短期信念衰减 → 返回新快照
- 为什么放后面：信念算子不影响 delta，只是状态的额外演化——放在后面，即使信念算子出 bug，也不会影响 delta 计算的正确性

---

## 6. 边界约束

### 6.1 engine-core 预批准例外

按 `team/conventions.md` §1.1，以下改动**预批准**改 engine-core：

| 改什么 | 为什么必须改内核 |
|---|---|
| `domain/beliefs.ts` 加类型 | 信念算子是决策层逻辑，放适配层破坏纯层 |
| `domain/bdi-snapshot.ts` 加字段 | 状态结构变化，必须在内核 |
| `cognition/state-transition.ts` 加信念算子 | 状态迁移规则，必须落在纯层 |
| `domain/bootstrap.ts` 初始化新字段 | 初始装配，必须在内核 |

**必须通过 `boundary.spec.ts` 的 11 条断言**：零 @nestjs / 零网络 / 零 env / 零 prompt。

### 6.2 不碰的地方

- ❌ 不改 `CoreBelief` / `TemporaryBelief` / `MemoryBelief` 的接口结构
- ❌ 不做短期信念的**形成**机制（判断"来访接不接受咨询师的解释"太复杂，那是另一个 WP）
- ❌ 不做信念对情绪/阻抗的**反作用**（先做激活机制本身，效果后续再接）
- ❌ 不做愿望层、意图层（那是 WP57 之后的事）
- ❌ 不碰适配层的任何代码（本期纯内核改动，适配层接线后续再做）
- ❌ 不改 delta 表的 11 个维度——信念激活是独立的状态演化，不是 delta 维度

---

## 7. 验收标准

### 7.1 功能验收

- [ ] 咨询师文本命中核心信念 activationTags 时，该信念的激活强度上升
- [ ] 连续多轮不命中时，激活强度逐轮衰减，最终趋近于 0
- [ ] introduced 短期信念衰减比 observed 快
- [ ] confidence 低于阈值的短期信念自动移除
- [ ] 没有核心信念的角色（coreBeliefs 为空），coreBeliefActivation 是空对象，不报错
- [ ] 同 seed 同事件序列，逐字同输出（值语义可复现）

### 7.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只有本 WP 改的那几个文件

### 7.3 测试用例要求

新增测试文件：`test/engine-core/wp57-belief-layer.spec.ts`

至少覆盖：
1. 核心信念激活：命中 activationTags → 激活强度上升
2. 核心信念衰减：不命中 → 逐轮衰减
3. 多个信念同时激活：不同 theme 各自独立
4. 短期信念衰减：introduced vs observed 衰减速度不同
5. 短期信念移除：confidence < 阈值 → 自动移除
6. 空信念角色：coreBeliefs 为空 → 不报错，行为不变
7. 重复 theme：两个信念 theme 相同 → 激活强度共享（key 相同，互相覆盖）
8. 零回归：不传信念相关选项时，行为和之前逐字一致

---

## 8. 本期没做的（明确留给后续）

1. **短期信念形成机制**——什么时候形成 introduced 信念？什么时候形成 observed 信念？需要判断"来访接不接受咨询师的解释"，太复杂，另开 WP
2. **信念对渲染的影响**——激活强度高时，来访的措辞应该更防御、更短。本期只做状态，不接渲染
3. **信念对 delta 的调节**——激活强度高时，共情的 trust 增益应该打折扣（来访心里在防御）。本期不做
4. **愿望层 / 意图层扩展**——终局蓝图里 BDI 的"D"和"I"，那是后续 WP
5. **信念冲突消解**——两个矛盾的信念同时激活怎么办？本期不做

---

## 9. 转述给后端的话术

> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 这个 WP 预批准改 engine-core（信念算子是决策层逻辑，放适配层破坏纯层），但必须过 `boundary.spec.ts` 的 11 条断言。
>
> 任务单里写的所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 如果真的有必要改 engine-core 的其他地方（比如架构设计不合理、或者改完收益很大），先和我确认，不要自己拍板。
>
> 交付时按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 10. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §4.3 只在 `transitionState()` 管道接入 | **落库路径单独接一次**（`applyBeliefEvolution(applyDeltaVector(base.snapshot, cappedTotal), userText)`），并改了 `in-memory-engine-session.ts` | 内核落库走的是「事件 + 剧本合并后统一过一次 cap」（WP26 P2-12），用的是 `applyDeltaVector` 而**不是** `transitionState` —— 只在 `transitionState` 里接，落库快照**永远不会**带上信念演化（机制空转，比不做还坏）。⚠️ `in-memory-engine-session.ts` **不在** §6.1 预批准清单里，**已获用户 2026-11-04 当面批准** |
| 2 | §4.3 / §5.1 匹配源 = 事件 `matchedTerms` | 匹配源 = **咨询师原文**（`TransitionStateOptions.counselorText`，会话层注入 `userText`） | `matchedTerms`（静态词典 + 角色 `sensitiveTopics`）与 `activationTags` 是**两组独立词表**（本单 §2.3 自己核实过），不重叠时按事件匹配会让机制**永远是死的**；咨询师原文才是「提到了这个议题」的真相源 |
| 3 | §5.1 **双向**子串匹配 | **单向**（只做「文本包含标签」，大小写不敏感，空白标签不命中） | 双向口径是为「短词 ↔ 短标签」设计的；换成「长文本 ↔ 标签」后，反向（标签包含整段文本）只在文本比标签还短时才命中 —— 那是噪声不是命中 |
| 4 | §5.3 同 theme「后者覆盖前者」 | 同 theme **共享**一份激活强度，**命中任一即命中**，与数组顺序**无关** | 「后者覆盖前者」= 同 theme 只有一个信念的标签生效，引擎在替角色配置做取舍，且取舍取决于数组顺序。theme 唯一是**角色配置的责任**，引擎不该让配置笔误变成行为不确定性 |
| 5 | §4.3 算子放 `cognition/state-transition.ts` | **一致**（未新开 `cognition/belief-operators.ts`） | 新开文件会把 engine-core 改动面从「1 个认知文件 + 3 个域文件」变成「4 个认知文件」，二次触发「改 engine-core 其他地方需确认」 |
| 6 | §4.3 两个算子分别接入 | 新增**组合函数** `applyBeliefEvolution`（先激活 → 后衰减），两处消费点都调它 | 内核有**两处**消费点（临时快照 / 落库快照），各写一遍顺序迟早有一处写反；组合口径只有这一份 |
| 7 | §4.2 / §4.3 / §4.5 字段与初始化 | **一致**（`coreBeliefActivation` 在 `BdiSnapshot` / `cloneBdiSnapshot` / `buildInitialSnapshot` 三处都带） | 快照构造点只有这 3 处，漏一处 = 每回合清零 / 克隆丢字段 |
| 8 | §4.5 导出 3 个种子常量 | 导出 **6 个**（多 `DEFAULT_BELIEF_OPERATOR_CONFIG` / `DEFAULT_INTRODUCED_BELIEF_DECAY_RATE` / `DEFAULT_OBSERVED_BELIEF_DECAY_RATE`） | 任务单只列了 3 个，实际两个来源的衰减率不同（introduced ×0.9 / observed ×0.95）也该是公开种子值；聚合常量 `DEFAULT_BELIEF_OPERATOR_CONFIG` 便于适配层整份注入 |
| 9 | §4.3 未提系数如何注入 | 走 **`BeliefOperatorConfig` 端口**，非法值**逐项**回退种子值；**本期不接 env** | 与 cap（WP26 P2-14）/ 人格（WP34）/ 同盟（WP42）同一范式：内核只认端口，不读 env（§6.2 本期不碰适配层） |
| 10 | §7.3 断言⑥ 白名单未提 | `boundary.spec.ts` 断言⑥ 白名单**追加 12 个新符号**（断言本身未改） | barrel 双向白名单不登记 = 新符号没被守卫；内核改文件名 adapter 直接断且无断言会红 |

> 本期**没做**的（跨会话衰减 `coreBeliefActivation`（§5.2 登记的缺口）/ 短期信念形成机制 / 信念对渲染与 delta 的反作用 / 愿望层与意图层 / 信念冲突消解 / env 接线）已在交付记录 §4 逐条留档。
