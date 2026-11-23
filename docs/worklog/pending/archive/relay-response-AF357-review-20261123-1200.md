# AF-357 独立评审回复 · BDI 临床语义补齐（角色愿望映射 + 短期信念生成）

- 评审对象：分支 `task/AF-357-bdi-desire-belief`（worktree `D:\work\Project\backend\mofang-nestjs-af281r`）
- 基线：`cb3cb868d5b27c134862a333a32f9bd76d6bd9af`
- 评审时间：2026-11-23 12:17–12:40
- 评审方式：只读（未改工作区任何文件、未提交、未跑全量 `pnpm test`）
- 评审维度：遗漏的坑 / 工程纪律对齐 / 更优雅实现

> **⚠️ 时序说明（请先读）**
> 评审进行期间（12:22 / 12:23）主控已提交并归档了本单：
> `d04d3e85 feat(af357): 补齐 BDI 角色愿望映射与短期信念生成` + `c365be2b chore(orchestration): AF-357 验收归档与回执入包`。
> 我已核对 `git show --stat d04d3e85`，其文件集与我在评审时读到的未提交 diff **逐字一致**，因此本回复引用的代码位置、行号与结论**仍然成立**。
> 但 AF-357 的事件链已 closed → **P0 / P1 不能在本单上直接改**：建议新开返修单（或补丁单），把 §2 三条 P0 与 §3 的 P1-1 / P1-3 一并处理；角色愿望映射部分可单独放行。

---

## 0. 结论速览

**裁决建议：条件通过（conditional pass）。**

- **角色愿望映射**可以独立放行（它不受信念生成开关控制，缺省即生效），但交付记录需要补一条被漏掉的行为变化：**映射让 `avoidanceDominant` 第一次变成可计算的信号，惊尘的整个策略空间因此收窄**（见 P1-2）。
- **短期信念生成**在 `ENGINE_BELIEF_FORMATION_ENABLED=true` 之前必须先修 P0-1 / P0-2 / P0-3。三条都是**可复现**的，不是理论风险；其中 P0-1 与渲染降级耦合，**一次 LLM 降级就能凭空造出"整合领悟"**。

一句话概括三条 P0：

| 编号 | 一句话                             | 后果                                                                                     |
| ---- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| P0-1 | 同一句来访原话会被连续多轮重复计分 | 一次渲染降级 → 置信度 0.55→0.75 → 越过 `reflectiveBeliefGate` → 系统替来访宣布"他领悟了" |
| P0-2 | 否定式过滤窗口锚错位置             | "我似乎**没有**意识到…" 被记成来访的自我觉察（临床语义正好相反）                         |
| P0-3 | 问句过滤只查句尾                   | "我发现我**是不是**太敏感了" 被记成来访信念                                              |

两条额外发现（不在主控的 backlog 里）：

- **spec 里那条"否定式"用例是假绿**：`我并未发现我一直在讨好别人` 之所以被排除，是因为它**根本不含**连续的标记"我发现"（被"无标记"规则挡掉的），不是因为否定规则生效。否定规则实际上几乎是死代码。
- **任务单登记的定向闸门命令是空转**：命令里写的是 `af356-*.spec.ts`（重签发前的残留文件名），vitest 对不存在的过滤器**静默忽略**，实跑只出来 2 files / 24 tests（boundary + env），AF-357 的三个新测试文件**根本没被执行**。

---

## 1. 我实际做了什么（可复核）

### 1.1 读了什么

| 文件                                                                                                                      | 关注点                                        |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `src/engine-core/cognition/state-transition.ts`                                                                           | 生成算子、抽取规则、接线顺序                  |
| `src/engine-core/domain/beliefs.ts` / `engine-session.types.ts` / `in-memory/in-memory-engine-session.ts`                 | 新字段、临时/落库两条路径口径                 |
| `src/engine-adapters/rendering/turn-render-orchestrator.ts`                                                               | `priorVisitorText` 取数点、降级路径、历史裁剪 |
| `src/engine-adapters/wiring/bdi-runtime.config.ts` / `engine.module.ts`                                                   | env 解析、装配                                |
| `src/engine-adapters/wiring/character/character-desire-mapping.ts` + 三条装配路径                                         | 映射与合并                                    |
| `src/engine-core/cognition/intention-planner.ts` / `alliance-config.ts`                                                   | 门槛口径与分支可达性                          |
| `bin/bdi-readiness-audit.ts`                                                                                              | 审计产物是否含心理内容                        |
| `test/engine-core/af357-bdi-belief-formation.spec.ts` 等 3 个新测试 + `test/engine-adapters/af106-character-pool.spec.ts` | 断言强度                                      |
| `docs/worklog/records/.../AF-357/{task-sheet.md,manifest.json}`、`docs/worklog/completed/phase2.5/af357-*.md`             | 任务单与交付记录一致性                        |

### 1.2 跑了什么

| 命令                                                                                                                                                                                                                           | 结果                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run test/engine-core/af357-bdi-belief-formation.spec.ts test/engine-adapters/af357-character-desire-mapping.spec.ts test/engine-adapters/af357-bdi-runtime-config.spec.ts test/engine-core/boundary.spec.ts` | **4 files / 73 tests 全绿**（8.5s）                                                                                                                                                                |
| `pnpm exec vitest run test/config/wp25-env-example-coverage.spec.ts`                                                                                                                                                           | **12 tests 绿**                                                                                                                                                                                    |
| 任务单登记的定向闸门命令（原样执行）                                                                                                                                                                                           | **只跑出 2 files / 24 tests** —— `af356-*` 三个文件不存在，被静默忽略                                                                                                                              |
| 临时探针（脚本放系统临时目录，**未写仓内任何文件**，跑完即删）                                                                                                                                                                 | 直接调用 `extractReflectiveStatements` / `applyBeliefFormation`，见 §2 证据                                                                                                                        |
| `pnpm orchestration:status`                                                                                                                                                                                                    | 评审时（12:19）：`AF-357 [submitted]`，`ready=0 / submitted=1 / working=0`，归档 346 —— **状态机合规**（≥ submitted 才实现，符合 AGENTS.md §0）。**评审期间（12:23）已被主控归档**，见文首时序说明 |

### 1.3 没跑 / 没做

- 没跑全量 `pnpm test`（主控在跑）。
- 没改工作区任何文件、没提交、没 `git add`。
- 没动 `admin-dashboard/`、Flutter、`scripts/`、`typings/`。

---

## 2. P0 —— 阻断"开启"的问题

> 当前缺省关闭，所以 P0 不是"线上正在出错"，而是**"按现在的实现打开开关就会出错"**。三条都必须在 `ENGINE_BELIEF_FORMATION_ENABLED=true` 之前修掉。

### P0-1 同一句来访原话被连续多轮重复计分 → 一次渲染降级就能造出"整合领悟"

**机制（三段）**

1. 门面每轮取"history 里最近一条**真实来访发言**"喂给内核（`turn-render-orchestrator.ts:833` `withPriorVisitorText` → `:848` `lastVisitorText`）。
2. **降级渲染轮不追加来访腿**（`:1362-1364`：`if (!rendered.degraded) next.push({ role: 'visitor', ... })`）。所以连续几个降级轮里，"最近一条来访发言"**是同一句**。
3. 内核每次读到都算一次"新的观察"：`max(existing.confidence, base) + reinforcement`（`state-transition.ts` `applyBeliefFormation`）。

**证据（探针输出，同一句原话连续三轮）**

```
第1次后 confidence = 0.55 evidenceCount = 1
第2次后 confidence = 0.65 evidenceCount = 2     ← 已越过 reflectiveBeliefGate = 0.60
第3次后 confidence = 0.75 evidenceCount = 3
```

**影响**

- `reflectiveBeliefGate = 0.60`（`alliance-config.ts:202`），`insightMinTurn = 8`（`:183`）。也就是说：**连续 2 次降级渲染，就能让引擎在第 8 轮之后进入 `insight`（整合领悟）策略** —— 而这期间来访**一个字都没说过新的**。
- 临床后果是这条链里最糟的一类：系统替来访宣布"你已经整合了这条领悟"，而真实情况是**渲染服务在超时/限流/空返回**。来访者收到的是一段"整合领悟"式回应 —— 与他此刻的状态毫无关系。
- 同一条 bug 还有一个温和版：LLM 来访者逐字复读一句模板话时，也会走进"强化"分支（这一支**可能**是设计意图，但与上面的降级重复**无法区分** —— 内核目前没有信息可区分）。

**为什么"取最近一条来访发言"这个设计本身是对的**：兜底句不进 history 的设计（`:1353-1357`）是对的，问题只在于**内核无法知道"我读到的是不是同一条"**。修法是给来访发言一个**会话内单调序号**，让内核能区分"来访真的又说了一遍"与"同一条被重复读"。

**修复**：见 §7 Diff A（5 个文件：`engine-session.types.ts` / `beliefs.ts` / `state-transition.ts` / `in-memory-engine-session.ts` / `turn-render-orchestrator.ts`）。

**附带收益**：Diff A 落地后，`engine-core` 侧**只在传了序号时**才做序号判定，**不传序号时行为逐字不变** → AF-357 现有的 core 单测一条都不用改。

---

### P0-2 否定式过滤的窗口锚错了位置 → "我似乎没有意识到…" 被当成自我觉察

**机制**

```ts
const prefix = clause.slice(Math.max(0, markerIndex - 3), markerIndex);
if (/没|没有|不|未/.test(prefix)) continue;
```

否定词只在**标记之前 3 字**里找。但中文否定句的常态是**插在"我"与动词之间**：

| 句子                                                     | 实际走的规则                           | 结果                                |
| -------------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| `我没发现我总是焦虑`                                     | 标记"我发现"**不连续** → "无标记"排除  | ✅ 排除对了，但**靠的是另一条规则** |
| `我并未发现我一直在讨好别人`（**就是 spec 里那条用例**） | 同上                                   | ✅ 通过了，但测的**不是否定规则**   |
| `我似乎没有意识到我很容易焦虑`                           | 标记"我似乎"命中；否定词在标记**之后** | ❌ **被当成自我觉察**               |
| `我好像没发现自己很生气`                                 | 标记"我好像"命中；否定词在标记**之后** | ❌ **被当成自我觉察**               |

**证据（探针输出）**

```
"我似乎没有意识到我很容易焦虑" -> ["我似乎没有意识到我很容易焦虑"]   ← 应当排除
"我好像没发现自己很生气"       -> ["我好像没发现自己很生气"]         ← 应当排除
"我并没有发现我总是讨好别人"   -> (空)   ← 排除对了，但走的是"无标记"
"我没发现我总是焦虑"           -> (空)   ← 同上
```

**影响**

- 任务单 §4 规则 2 写的是"**直接否定该标记**"。"我似乎没有意识到…" 正是对"觉察"的直接否定，现在却生成了 `source=observed`、置信度 0.55 的**来访自我觉察信念**。
- 语义完全相反的信念进了来访者画像，并且只要来访再复述一次就越过门槛、触发"整合领悟"。**这是把否认读成了领悟**。
- 主控的 backlog 第 3 条已经嗅到了这个方向（"是否要增加独立否定词表"），但结论写成"靠无标记被排除，不是靠否定规则" —— 真实情况是**否定规则在它该管的那一类句子上完全缺席**（标记后置否定），这比原判断更严重。

**修复**：见 §7 Diff B（`state-transition.ts` 单文件，判据从"标记前 3 字包含否定词"改成"否定词**紧邻**标记（前后各一侧）"）。

**顺带修掉的假绿**：把 spec 里那条"否定式"用例换成**真正会命中否定规则**的句子（例如 `我似乎没有意识到我很容易焦虑`），并加一条断言"它是被否定规则排除的"，否则这条用例永远在测另一条路径。

---

### P0-3 问句过滤只查句尾 → "我发现我是不是太敏感了" 被当成自我觉察

**机制**

```ts
const QUESTION_TAIL = /[吗么呢吧]$/; // 只看小句**结尾**
```

中文的疑问句大量把疑问结构放在**句中**（是不是 / 有没有 / 会不会 / 为什么…），句尾不带语气词。

**证据**

```
"我发现我是不是太敏感了" -> ["我发现我是不是太敏感了"]   ← 问句，被当成信念
```

**影响**

- 任务单 §4 规则 2 明写"是陈述句，不是问句"。自我怀疑式问句（"我发现我是不是太敏感了"）恰恰是咨询里最高频的来访句式之一，被逐字写进"来访已形成的自我觉察"画像。
- 再叠加 `normalizeBeliefStatement` 会把标点全去掉（`\p{P}`），于是 `…太敏感了？` 与 `…太敏感了。` 归一化成**同一个 key** —— 问句与陈述句在去重层被合并，误差不会自我纠正。

**顺带**：第三人称过滤同样偏弱（`THIRD_PERSON_REPORT` 要求代词与言说动词**紧邻**）：

```
"我发现她总是这样"         -> ["我发现她总是这样"]           ← 含第三人称内容
"我发现我朋友说我很焦虑"   -> ["我发现我朋友说我很焦虑"]     ← 含第三方转述
```

任务单 §4 规则 3 要求"不含第三人称转述"。`我朋友说` 这一类没有"他/她"前缀，直接漏网。

**修复**：见 §7 Diff C（`state-transition.ts` 单文件：问句改为**句中疑问结构词表 + 句尾语气词**双判；第三人称改为"第三人称主体 + 短窗口内的言说动词"）。

> 临床口径说明：`我发现她总是这样` 这类"来访对第三方的观察"，我的建议是**允许**（它仍是来访自己的知觉，不是转述）；真正要拦的是"**别人对我说什么**"（`我朋友说` / `老师认为`）。Diff C 按这个口径写。

---

## 3. P1 —— 交付前应处理

### P1-1 "重复一次 = 整合领悟"这条临床假设站不住（对应待决策点 2）

**数值层**

| 口径                                  | 首次 | 第二次   | 越门槛   |
| ------------------------------------- | ---- | -------- | -------- |
| 任务单 §4 写的 `confidence += 0.10`   | 0.55 | **0.60** | 刚好压线 |
| 实现写的 `max(existing, base) + 0.10` | 0.55 | **0.65** | 越门槛   |

实现比任务单**更陡**（已有 0.5 时给 0.65 而不是 0.60）—— 交付记录 §7 没有记这条偏差。

**临床层（这是更根本的问题）**

"来访把同一句话逐字说两遍" **不构成**"整合领悟"的证据：

- 逐字复读更常见的两种成因是 **LLM 来访者的模板化复读** 与 **来访者的防御性复述 / 未加工的重复** —— 后者在临床上恰恰指向"**尚未整合**"，而不是"已整合"。
- 支持"整合"的证据是**展开与迁移**：同一主题更具体的表述、来访自己给出的总结、跨情境的一致性。
- 所以同一现象（反复回到同一主题）在 BDI 里**更可能应该触发的是"固执 / 未整合"分支，而不是 `insight`**。当前实现把它接到了 `insight` 上。

**建议（三选一，推荐第 1 个）**

1. **强化只认"展开"**：逐字复读不强化（置信度不动），只有"新句包含旧句且更长"（同一条被展开）才强化 → 见 §7 Diff D。语义上最对，且**不改任何阈值**。
2. **递减步进**：第 n 次强化增量按 `reinforcement / n` 衰减，避免复读把置信度堆到 1.0。
3. **纯数值路线**（若临床负责人坚持"复读也算证据"）：把种子降到 `base=0.45 / reinforcement=0.05` → 需要 5 次复读才越过 0.6。⚠️ 这两个值是 AF-357 自己的种子（不属于被冻结的 12 个决策阈值），但**改它们属于标定决策，应由临床/产品拍板**，不该由实现侧单方面改。

> 提醒：Diff D 会让 `af357-bdi-belief-formation.spec.ts` ④ 组的"逐字重复 → 0.65"用例失效，需要同步改断言并在 `deviationTable` 记一条语义偏差。

---

### P1-2 映射把"合并"做成了"删除"，且惊尘的策略空间被整体收窄（对应待决策点 3）

**（a）合并 = 删除，不只是"取最大权重"**

`mapRoleDesiresToCoreDetailed` 对同一内核键**只保留权重最大的一条**，另一条角色级愿望连同它的 `label` 一起从快照里消失。

- 例：安然 `acceptance(被接纳与认可, 0.6)` + `authenticity(能按自己的样子生活, 0.55)` → 快照里只剩 `accepted 0.6`，"能按自己的样子生活"这个诉求**整个不见了**。
- 任务单 §3 的原话是"取**最大基线权重**，不求和"——说的是**权重口径**，不是"删掉另一个诉求"。实现多走了一步。
- 连带影响：种子写库时写进去的也是合并后的形态（`character-profile.seed.ts:830` 用的是 `seed.underlyingDesires`，而 `seed` 已经是 `assembleCharacterProfileSeed` 的映射结果）→ **下一次跑 seed 脚本会把 `character_profiles` 表的这 8–10 行改写成合并后的形态**（`hasDrift` 的 `canonicalJson` 比对会判定为漂移）。这是一次**未在交付记录里声明的数据改写**，而且**原始角色键会被永久抹掉**。
- 督导场景影响：学员/督导看到的"这个来访者想要什么"少了一条诉求，"未被满足的次级愿望"这条督导线索消失了。

**（b）`avoidanceDominant` 第一次变成真信号 —— 惊尘的变化比任务单描述的大**

映射前，所有角色的 `avoid_pain` 都是 `undefined ?? 0` → `avoidanceDominant` 恒为 false。映射后它才可计算：

| 角色 | avoid_pain | max(understood, accepted) | 差值     | 是否 dominant（margin 0.1）        |
| ---- | ---------- | ------------------------- | -------- | ---------------------------------- |
| 惊尘 | 0.72       | 0                         | **0.72** | **是**                             |
| 念安 | 0.68       | 0.58                      | 0.10     | 否（**刚好压线**，`> 0.1` 不成立） |
| 沉舟 | 0.55       | 0.50                      | 0.05     | 否                                 |
| 晚晴 | 0.55       | 0.72                      | −0.17    | 否                                 |

`avoidanceDominant=true` 的后果**不止**于"discussing_plans 不可达"：`intention-planner.ts:309-317`（后段分支）与 `:357-368`（探索分支）**都**用它做否决条件 → **惊尘实际上恒为 `recounting`**，深度探索与整合领悟全部不可达。

- 任务单 §3 与交付记录 §2 只写了"惊尘 control 0.50 低于 0.55，保持不达标" —— **漏记了 avoidanceDominant 带来的整体收窄**。
- 念安 0.10 压线更危险：愿望演化机制（`ENGINE_DESIRE_EVOLUTION_ENABLED`，也是缺省关闭）一旦开启，`avoid_pain` 涨 0.01 就会翻转念安的探索路径。

**（c）映射表是"全局键 → 内核键"，不是"角色 × 键 → 内核键"**

`ROLE_DESIRE_TO_CORE` 是全局表：同一个角色键在 10 个角色里语义相同。一旦某一条映射偏了，**10 个角色一起偏**。任务单 §3 的表本身也是按"键"列的，没有按角色区分。

**建议**

- 映射**不删信息**：内核读 4 个投影键的同时，把角色原始键+label 一起留在快照里（`UnderlyingDesire` 加一个可选 `sourceRoleKey`，一条记录同时承载两种语义，映射可逆）。或者至少保留被合并掉的那条（带 label）在一条独立列表里，供督导/Admin 展示。
- 交付记录补两条：**惊尘 avoidanceDominant 收窄**、**seed 脚本会改写 character_profiles 行**（含"原始键被抹掉"的后果与回滚办法）。
- 念安的压线状态写进 backlog（愿望演化开启前必须复评）。

**关于待决策点 3 的正面回答**：`acceptance→accepted`（无条件积极关注）与 `recognition→understood`（被看见/被知晓）**站得住**，内核把两者拆成独立信号（AF-322 的注释）也支持这个切分。真正值得督导质询的是另外三条，建议单列入督导纪要：

| 键                    | 现映射     | 争议点                                                                |
| --------------------- | ---------- | --------------------------------------------------------------------- |
| `safe_grief`          | understood | "悲伤被安放/被承接"更像**被陪伴**，不完全是"被理解"                   |
| `belonging`           | accepted   | 群体归属 ≠ "真实自我被接纳"                                           |
| `continuity` / `rest` | avoid_pain | "维持生活秩序"归到"回避痛苦"是一个**较强**的解读，更像回避↔掌控的冲突 |

惊尘 `control=0.50` **同意保持不达标**（不要为"让分支可达"调数值），但理由要进督导纪要，而不只停在交付记录里。

---

### P1-3 置信度种子与门槛之间没有任何耦合校验（config footgun）

`ENGINE_BELIEF_FORMATION_BASE_CONFIDENCE` 与 `ENGINE_INTENTION_REFLECTIVE_BELIEF_GATE` 是两把**互不相关的尺子**：

- 运维把 `BASE_CONFIDENCE` 配成 `0.6`（或更高）→ **一次**自我觉察陈述就直接越过门槛 → 第 8 轮起 `insight` 可判。"必须复述两次"这个语义前提**消失**，而没有任何东西会报警。
- 配成 `0.4` + `REINFORCEMENT=0.1` → 第 4 次才越过门槛，语义又完全变了。
- `.env.example` 与 `bdi-runtime.config.ts` 都没写这个耦合关系。

**同时有一处文档事实错误**：交付记录 §2 写"重复两次 → 0.65 ≥ reflectiveBeliefGate 0.6 → **turnNumber >= 12** 时 insight 可判"。

> 实际是 `insightMinTurn = 8`（`alliance-config.ts:183`），`planMinTurn = 12`（`:184`）才是 12。**insight 的最早可达轮次是第 8 轮，不是第 12 轮。**
> `af357-bdi-belief-formation.spec.ts` 的用例名也写着"第 12 轮 insight 分支可达"（它在 12 轮断言通过，但把门槛写错了），会让人误以为有 4 轮安全余量。

**修复**：装配层加一条启动告警（见 §7 Diff E）+ 修正 `.env.example` 注释 + 修正交付记录与用例名。

---

### P1-4 任务单登记的定向闸门命令是空转的（"绿灯"没有含金量）

- 任务单 `gates[2].command` 写的是 `test/engine-core/af356-bdi-belief-formation.spec.ts` 等三个 **af356** 文件名（AF-356 取消后重签发为 AF-357，文件名没跟着改）。
- 我原样执行这条命令：**退出码 0，但只跑出 2 files / 24 tests**（boundary.spec.ts + wp25 env coverage）—— vitest 对**不存在的文件过滤器静默忽略**，不报错。
- 也就是说：**CI/编排 Gate 重跑任务单里的命令时，AF-357 的三个新测试文件一个都不会执行，闸门照样绿。**
- 交付记录 §7 的 `deviationTable` 已记了"文件名残留 AF-356"，但**任务单本体与 manifest 没修**（manifest 记录 `taskSheet.immutable: true` + sha256，`orchestration task` 子命令只有 register/import/resume/promote/cancel/reissue/rescope，**没有改 gates 的入口**）。
- 附：`manifest.json` 的 `"status": "backlog"`、`"receipts": []` 与索引里的 `submitted` 不一致 —— 这个大概率是 CLI 在归档时统一写的，可接受；但闸门命令这处是**实质性的空转**。

**建议**

1. 交付记录 §3 已经有真实命令（`af357-*` + af106 + boundary + env，6 files / 88 tests）→ 请把它**升级成机读字段**（例如 manifest 里加 `gatesOverride`），让 CI 与编排 Gate 以它为准；
2. 或用 `task reissue` 重签发一版把闸门命令改正（成本更高，且要重走登记流程）；
3. 无论走哪条，**在 CI 闸门里加一条"测试文件数 ≥ N"或"过滤器必须全部命中"的断言** —— 否则以后任何一个写错文件名的闸门都会这样静默通过。

---

### P1-5 隐私：原文落点比交付记录写的多两处

交付记录 §5 的 privacy 一行写"信念只进 BDI 快照；审计只输出键名、数值、布尔与计数"。

- ✅ **审计侧我核实过没问题**：`bin/bdi-readiness-audit.ts` 只输出角色键、映射、权重、布尔与计数，**不含任何对话原文**，与它自己的免责声明一致。
- ⚠️ 但 `statement` 是**来访原话原文**，现在会：
  1. **落进 BDI 快照 JSON**（`bdiStates.save`）—— 这是新增的一份"心理原文"存储面，且**没有条数上限**；
  2. **经 `src/admin-debug/debug-kernel-state.ts:199` 回到 admin 调试接口**（该 controller 有 `AdminRoleGuard`，非 admin 403 → 权限边界 OK，但**这是新增的原文出网点**，此前 `temporaryBeliefs` 恒为空所以没人注意到）。
- 关于 (1) 的量级：observed 衰减 0.95/轮 → 一条 0.55 的信念要 ~34 轮才跌破 `removeThreshold=0.1`；单轮最多新增 2 条 → 一场长会话里可同时存活 **~60+ 条**原文条目，且它们**逐轮衰减**（写回 DB 的是衰减后的值，条目还在）。
- **建议**：给 `temporaryBeliefs` 加一条**条数上限**（例如按 confidence 保留 Top-N，其余丢弃）—— 同时护住快照体积、原文存储面与隐私暴露面；并在交付记录的 privacy 一行补上"admin 调试接口会带出信念原文"这一条。

---

## 4. P2 —— 记账级问题（不阻断，但建议记进 backlog）

| #     | 问题                                                                                                                                                                                                                                                                                                       | 位置                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P2-1  | **两个测试断言互斥**：`af357-character-desire-mapping.spec.ts` ②"映射后出现的键只可能是内核四键" 与 ④"未知键原样保留"不能同时成立；② 目前只因 10 个角色都没有未登记键才绿。**下一个带未知键的角色进来就会红**。建议 ② 改成"内核四键 ⊆ 映射后键"。                                                          | `test/engine-adapters/af357-character-desire-mapping.spec.ts:51` |
| P2-2  | 新的 env 族没有进 `wp25-env-example-coverage.spec.ts` 的"键一个不多一个不少"清单（`INTENTION_ENV_KEYS` 那种），将来多打一个 `ENGINE_BELIEF_FORMATION_FOO` 不会被断言拦住。                                                                                                                                 | `test/config/wp25-env-example-coverage.spec.ts`                  |
| P2-3  | 信念 `id` 由**内容哈希**决定 → 同一句话在两个不同会话里得到**同一个 id**。当前 id 只在单个快照内使用，无碍；但将来若做跨会话聚合统计会撞。32 位 FNV-1a 在万级条目上碰撞概率也不可忽略。建议 id 加会话盐。                                                                                                  | `state-transition.ts` `stableBeliefHash`                         |
| P2-4  | `stableBeliefHash` 用 `input.length`（UTF-16 码元）循环却用 `codePointAt` 取值 → 代理对被拆开算两次。哈希值仍稳定（只是分布略偏），但循环边界与取值的意图不一致。                                                                                                                                          | 同上                                                             |
| P2-5  | `evidenceCount` / `firstFormedAtTurn` / `lastObservedAtTurn` 三个新字段**目前没有任何读取方**（注释说"只用于证据强度与审计"，但审计 CLI 没读、规划器没读）。要么接进门槛，要么别在注释里承诺。                                                                                                             | `beliefs.ts` / `state-transition.ts`                             |
| P2-6  | `introduced → observed` 的升级分支**当前不可达**（全仓没有 `source:'introduced'` 短期信念的写入点，任务单 §2 也明确不生成 introduced）。但一旦将来有人加咨询师引入信念，**来访复述一次**就会被升级成 observed 并冲到 ≈0.95 —— 那是任务单想避免的污染的**镜像版**。建议：升级 `source` 需要 ≥2 次独立观察。 | `applyBeliefFormation`                                           |
| P2-7  | 文档口径："**连续**复述达到 reflectiveBeliefGate"（`.env.example` 与审计 CLI 的 `reason` 文案）—— 实现并不要求连续，隔 20 轮再说一次也算强化。                                                                                                                                                             | `.env.example` / `bin/bdi-readiness-audit.ts`                    |
| P2-8  | 审计 CLI 的"原始键 → 内核键"列读的是**种子 spec**，不是 DB 里的活数据；Admin 改过的角色在审计里看不到真实映射。                                                                                                                                                                                            | `bin/bdi-readiness-audit.ts` `buildCoverage`                     |
| P2-9  | `extractReflectiveStatements` 的切句符不含 `，`、`…`、`．`；逗号不断句会让后半句被并进同一条候选。                                                                                                                                                                                                         | `state-transition.ts`                                            |
| P2-10 | 编排状态：评审期间（12:23）AF-357 已 `archive` 并写入 durable 回执 `receipt-RC-AF-357-1.json` —— 事件链完整 ✅。但**归档发生在本评审回复之前**，因此 P0/P1 需要新开返修单，不能在本单上直接改（见文首时序说明）。                                                                                          | `docs/team/agent-orchestration/state/`                           |

---

## 5. 更优雅的实现方向

1. **把"频次"与"深度"从 confidence 一个标量里拆出来。**
   现在 `confidence` 同时承担"这条信念多强"与"这条信念被重复了几次"，而门槛只看它一个数。更健康的形状是：`confidence` = 强度、`evidenceCount` = 频次、`depth`（展开/迁移/自我总结）= 加工深度；门槛读**组合条件**（如 `confidence ≥ gate && depth ≥ 1`）。这样"复读"与"领悟"在模型里就不再共用一个数字。

2. **让内核消费"来访事件流"，而不是"最近一条文本快照"。**
   现在内核每轮被喂一句文本（于是有了"同一条被重复读"的问题、也拿不到"这句话是第几次说"）。改成让适配层投喂 `visitorUtterance { text, seq, degraded, at }` 事件，生成算子作为事件消费者 —— 序号、降级标记、幂等一次性解决，而且**不用给内核塞"上一轮文本"这种容易用错的接口**。

3. **否定 / 问句 / 第三人称不要靠正则，靠一张小判定表 + 句式矩阵。**
   建议建 `test/engine-core/af357-belief-extraction-matrix.spec.ts`：30 条真实中文句式（否定 8 条、问句 8 条、第三人称 6 条、边界 8 条），每条断言**被哪条规则排除**（给规则名），避免现在的"假绿"。规则本身用词表 + 邻接判定就够，不需要 NLP。

4. **角色愿望映射不要"合并后丢标签"，改成"同一记录承载两种语义"。**
   给 `UnderlyingDesire` 加可选 `sourceRoleKey`（+ 原始 label），一条记录同时保留"角色诉求（被看见 / 能按自己的样子生活）"与"内核投影（understood / accepted）"。映射可逆、督导视图不丢信息、Admin 存回 DB 也不会把角色语义冲掉。

5. **映射表从"全局键 → 内核键"改成"角色 × 角色键 → 内核键"。**
   同一个角色键在不同角色里的临床含义未必相同（`continuity` 在不同创伤结构里含义差别很大）。全局表一旦偏就是 10 个角色一起偏；按角色登记后，偏了只影响一个角色，审计也能逐角色追责。表会变大，但**可审计性**才是这个表存在的理由。

6. **三个数（base / reinforcement / reflectiveBeliefGate）应该被当成一组约束来校验。**
   装配层做一次交叉校验并告警（Diff E），把"单句即过门槛""复读永不过门槛"这两种配置从"静默生效"变成"启动就喊"。

---

## 6. 四个待决策点的直接回答

### ① 否定式过滤是不是实际失效？

**部分失效，而且失效的位置比原判断更糟。**

- 对 `我没发现` / `我并没有发现` / `我并未发现` 这一类：**结果对，理由错** —— 它们不含连续的标记"我发现"，是被"无标记"规则挡掉的，**否定规则一次都没执行**。所以 spec 里那条"否定式"用例是**假绿**（它测的是另一条路径）。
- 否定规则真正能命中的，只有"标记前 3 字恰好有否定词"的怪句（如"我不知道我发现…"），日常语料里几乎不出现。
- 真正的漏网在另一侧：**标记后置否定**（`我似乎没有意识到…` / `我好像没发现…`）—— 否定词在标记**后面**，3 字前缀窗口永远看不到 → 被当成来访的自我觉察。

**结论**：不是"规则失效"，是"规则在它该管的那类句子上够不着，在最该管的那类句子上缺席"。修法不是把窗口调大（窗口调大只会引入更多假阴），而是：

1. 独立否定词表（`没 / 没有 / 不 / 未 / 无 / 别`）；
2. 判定改成"否定词**紧邻**标记（前后任一侧）"，而不是"标记前 3 字内出现"；
3. 补一条"它是被否定规则排除"的断言，让 spec 不再假绿。

### ② `max(existing, base) + 0.1` 这个步进是不是过陡？一句话重复算"整合领悟"临床上成立吗？

**数值上过陡，临床上不成立。**

- 数值：任务单写的是 `+= 0.10`（0.55 → 0.60，压线），实现是 `max(existing, base) + 0.10`（0.55 → **0.65**，越线）—— 实现比任务单更陡，且这条偏差没进 `deviationTable`。再叠上 `max(existing, base)` 的"抬底"，一条曾衰减到 0.30 的信念会被直接抬回 0.65。
- 临床上：**逐字重复 ≠ 整合领悟**。复读的两种常见成因（LLM 模板化复读、来访防御性复述）都不支持"已整合"这个解释；它更接近"未整合 / 固执"。支持整合的证据是**展开与迁移**。
- 还有一个现实推论：来访者逐字重复同一句在真实咨询里并不罕见（尤其是被复述时），把"复读一次"接成 `insight`，会让引擎在一个**尚未加工**的议题上提前给出整合式回应。

**建议**：把"强化"的触发条件从"文本相同"改成"**同一条被展开**"（新句包含旧句且更长），逐字复读只刷新"最近一次被读到"而不改置信度（Diff D）；同时把增量改成递减（`reinforcement / evidenceCount`），防止复读把置信度堆到 1.0。若临床负责人坚持"复读也算证据"，走数值路线（`base 0.45 / reinforcement 0.05` → 需 5 次），但那属于标定决策。

### ③ `acceptance→accepted`、`recognition→understood` 的语义边界会在督导场景被质疑吗？惊尘 `control=0.50` 该不该保持不达标？

- **前两个映射我认为站得住**：accepted ≈ 无条件积极关注，recognized ≈ 被看见/被知晓，是两个可区分的构念；内核把它们拆成两个独立信号（AF-322）也支持这个切分。督导上更可能被质疑的是另外三条：`safe_grief→understood`（"悲伤被安放"更像被承接）、`belonging→accepted`（群体归属 ≠ 真实自我被接纳）、`continuity/rest→avoid_pain`（维持秩序 ≠ 回避痛苦，这是较强解读）。建议这三条单列入督导纪要，而不是只留工程映射表。
- **惊尘 `control=0.50` 保持不达标，我同意** —— 不用调数值去凑可达性。但要补两件事：
  1. 理由（创伤解组状态不适合进入计划讨论）要进**督导纪要**，不只停在交付记录；
  2. **必须补记 `avoidanceDominant` 的连带效果**：惊尘 `avoid_pain 0.72` vs `understood/accepted 0` → 差值 0.72 > 0.1 → **探索分支与后段分支同时被否决 → 惊尘恒为 `recounting`**。这比"discussing_plans 不可达"的影响大得多，而任务单与交付记录都只写了后者。
- 另：**念安压线**（0.68 − 0.58 = 0.10，`> 0.1` 不成立）—— 愿望演化一旦开启就可能翻转，列入 backlog。

### ④ 还有什么遗漏的临床 / 隐私 / 回归风险？

**并发**

- ✅ **跨会话无串扰**：信念挂在各自的 BDI 快照上，按会话隔离。
- ✅ **同会话并发轮次**：临时快照与落库快照**都从同一个 `base.snapshot` 各演一次**（`in-memory-engine-session.ts:499` 与 `:553`），因此**不会重复计数**；并发下的写冲突仍走既有乐观锁（`STATE_CONFLICT`）。
- ⚠️ **门面的 history 与新加的来访序号是进程内状态**：多实例部署 / 后端重启后，history 丢失 → `priorVisitorText` 拿不到 → **信念生成 fail-closed**（不生成），这一点是安全的；但重启前已形成的信念保留在快照里、之后不再被强化，行为上"半冻结"，值得在灰度观察里记一笔。
- ⚠️ 新增的序号状态必须和 `forgetSession`/关会话路径**一起清**（Diff A 已含），否则句柄复用会串号。

**旧快照兼容**

- ✅ 三个新字段全是可选；`evidenceCount ?? 1`、`firstFormedAtTurn ?? turn` 都兜住了旧快照。
- ⚠️ 唯一需要留意的：旧快照里若存在 `introduced` 信念（当前全仓没有写入点，实际不会有），来访复述一次就会被升级成 `observed` 并冲到 ≈0.95 —— 见 P2-6。

**隐私**（详见 P1-5）

- ✅ 审计 CLI 无原文；`auditTurn` 只记内核事件（`engine-turn.service.ts:483`），不带咨询师原话也不带信念。
- ⚠️ 新增两个原文落点：BDI 快照 JSON（无条数上限）+ admin 调试接口（admin-only，但确实是新增出网点）。

**回归**

- ✅ 定向 4 files / 73 tests 绿、wp25 env 12 绿、boundary 绿。
- ⚠️ **任务单登记的闸门命令空转**（P1-4）。
- ⚠️ 两处**假绿**用例（否定式用例、映射 ② 断言）。
- ⚠️ **两个机制叠加后的复合风险没有评估**：愿望映射让 `discussing_plans`/`insight` 在真实角色上第一次可达，信念生成又给 `insight` 供能 —— 单看各自都合规，同时打开时"后段策略"在真实角色上的触发面明显变大。灰度前建议**先只开一个**（建议先开映射，信念生成再单独开），并对 `strategy=insight|discussing_plans` 的触发率做单独观测。

---

## 7. 最小 unified diff 建议

> 以下 diff 以 `D:\work\Project\backend\mofang-nestjs-af281r` 为基准。**我没有在工作区应用它们**，请主控决定后再落。
> 约束遵守：只改授权的 4 个 engine-core 文件 + 适配层文件；`boundary.spec.ts` 不改；不改任何阈值数值。

### Diff A —— P0-1：来访发言序号，区分"新发言"与"同一句被重复读"

```diff
--- a/src/engine-core/domain/engine-session.types.ts
+++ b/src/engine-core/domain/engine-session.types.ts
@@
   readonly priorVisitorText?: string;
+  /**
+   * 本条 priorVisitorText 对应的**来访发言序号** (1 起, 会话内单调递增).
+   *
+   * 为什么需要 (AF-357 · P0-1): 门面取的是"history 里最近一条来访发言" ——
+   *   渲染降级轮**不追加来访腿** (兜底句不是来访真说的话), 于是同一句原话会被
+   *   **连续多轮**重复喂进内核. 若内核按"读到一次 = 观察一次"计分, 一句原话就能
+   *   把置信度顶过 reflectiveBeliefGate, 凭空造出"整合领悟".
+   *   有了序号, 内核能分清"来访真的又说了一遍"与"同一条被重复读到".
+   *
+   * 缺省 = 不传 = 不做序号判定 (旧行为: 读到即计分) —— 内核层单测逐字不变.
+   */
+  readonly priorVisitorSeq?: number;

--- a/src/engine-core/domain/beliefs.ts
+++ b/src/engine-core/domain/beliefs.ts
@@
   readonly lastObservedAtTurn?: number;
+  /**
+   * 最近一次被观察到的**来访发言序号** (1 起; 旧快照缺省).
+   *
+   * 只有序号**变大**才算一次新的观察 —— 同一句原话被重复读到时序号不变, 不重复计分.
+   */
+  readonly lastObservedAtVisitorSeq?: number;

--- a/src/engine-core/cognition/state-transition.ts
+++ b/src/engine-core/cognition/state-transition.ts
@@ TransitionStateOptions
   readonly priorVisitorText?: string;
+  /** 本轮 priorVisitorText 对应的来访发言序号 (缺省 = 不做序号判定). */
+  readonly priorVisitorSeq?: number;
@@
 export function applyBeliefFormation(
   snapshot: BdiSnapshot,
   visitorText: string,
   config?: BeliefOperatorConfig,
   turnNumber?: number,
+  visitorSeq?: number,
 ): BdiSnapshot {
@@
     const existing = existingIndex === -1 ? undefined : beliefs[existingIndex];

     if (existing) {
+      // AF-357 · P0-1: 同一句原话被**重复读到** (降级轮不追加来访腿) 不算新的观察.
+      //   序号没变大 = 还是那一句 → 不重复计分, 更不重复升级 source.
+      const lastSeq = existing.lastObservedAtVisitorSeq;
+      if (visitorSeq !== undefined && lastSeq !== undefined && visitorSeq <= lastSeq) continue;
       const nextConfidence = clamp01(
         Math.max(existing.confidence, cfg.formationBaseConfidence ?? DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE) +
           (cfg.formationReinforcement ?? DEFAULT_BELIEF_FORMATION_REINFORCEMENT),
       );
@@
         firstFormedAtTurn: existing.firstFormedAtTurn ?? turn,
         lastObservedAtTurn: turn,
+        lastObservedAtVisitorSeq: visitorSeq ?? lastSeq,
       };
       continue;
     }
@@
       firstFormedAtTurn: turn,
       lastObservedAtTurn: turn,
+      lastObservedAtVisitorSeq: visitorSeq,
     });
@@ export function applyBeliefEvolution(
   formation?: { readonly visitorText?: string; readonly turnNumber?: number },
+  formation?: { readonly visitorText?: string; readonly turnNumber?: number; readonly visitorSeq?: number },
@@
   return applyBeliefFormation(decayed, formation.visitorText, config, formation.turnNumber);
+  return applyBeliefFormation(decayed, formation.visitorText, config, formation.turnNumber, formation.visitorSeq);
@@ transitionState / transitionStateDetailed
   return applyBeliefEvolution(applyDeltaVector(snapshot, delta), options?.counselorText ?? '', options?.beliefConfig, {
     visitorText: options?.priorVisitorText,
     turnNumber: options?.turnIndex,
+    visitorSeq: options?.priorVisitorSeq,
   });
```

> 上面的 `applyBeliefEvolution` 片段两行都要保留（替换签名行 + 替换调用行），实际应用时请按上下文合并。

```diff
--- a/src/engine-core/in-memory/in-memory-engine-session.ts
+++ b/src/engine-core/in-memory/in-memory-engine-session.ts
@@
       priorVisitorText: input.priorVisitorText,
+      priorVisitorSeq: input.priorVisitorSeq,
       beliefConfig: this.beliefConfig,
@@
     const baseNextSnapshot = applyBeliefEvolution(applyDeltaVector(base.snapshot, weightedFinalDelta), userText, this.beliefConfig, {
       visitorText: input.priorVisitorText,
       turnNumber: runtime.turnIndex + 1,
+      visitorSeq: input.priorVisitorSeq,
     });

--- a/src/engine-adapters/rendering/turn-render-orchestrator.ts
+++ b/src/engine-adapters/rendering/turn-render-orchestrator.ts
@@ class TurnRenderOrchestrator
   private readonly histories = new Map<string, RenderContextTurn[]>();
+  /**
+   * 每个句柄**最近一条真实来访发言**及其序号 (1 起, 会话内单调递增).
+   *
+   * 为什么需要 (AF-357 · P0-1): 降级渲染轮**不追加来访腿** (兜底句不是来访真说的话),
+   *   于是"history 里最近一条来访发言"在连续几个降级轮里是**同一句**. 若内核按
+   *   "读到一次 = 观察一次"计分, 一句原话就能把置信度顶过 reflectiveBeliefGate,
+   *   凭空造出"整合领悟" —— 临床上是最糟的一种错: 系统替来访宣布他领悟了.
+   *   有了序号, 内核能分清"来访真的又说了一遍"(序号变大) 与"同一条被重复读到"(序号不变).
+   */
+  private readonly lastVisitorLegByHandle = new Map<string, { readonly seq: number; readonly text: string }>();
@@ private async settleTurn(...)
     if (!rendered.degraded) {
       next.push({ role: 'visitor', text: rendered.text });
+      // AF-357 · P0-1: 真实来访发言才占一个序号 (降级轮不占) —— 内核据此区分
+      //   "来访又说了一遍" 与 "同一条被重复读到".
+      const prev = this.lastVisitorLegByHandle.get(handleId);
+      this.lastVisitorLegByHandle.set(handleId, { seq: (prev?.seq ?? 0) + 1, text: rendered.text });
     }
@@ private withPriorVisitorText(...)
   private withPriorVisitorText(handleId: string, input: EngineTurnInput): EngineTurnInput {
     const priorVisitorText = this.lastVisitorText(handleId);
     if (!priorVisitorText) return input;
-    return { ...input, priorVisitorText };
+    const leg = this.lastVisitorLegByHandle.get(handleId);
+    // AF-357 · P0-1: 带上这条来访发言的序号.
+    //   同一条被重复读到 → 序号不变 → 内核不重复计分;
+    //   与登记腿不一致 (恢复会话等) → 自愈成新序号, 不让内核拿到脏序号.
+    const seq = leg && leg.text === priorVisitorText ? leg.seq : (leg?.seq ?? 0) + 1;
+    if (!leg || leg.text !== priorVisitorText) {
+      this.lastVisitorLegByHandle.set(handleId, { seq, text: priorVisitorText });
+    }
+    return { ...input, priorVisitorText, priorVisitorSeq: seq };
   }
@@ 关会话 / 清历史
+      this.lastVisitorLegByHandle.delete(handleId);
```

**为什么这样切分**：`visitorSeq` 不传时内核行为逐字不变 → AF-357 现有的 core 单测与边界断言**全部不用改**；只有适配层多传一个字段。

---

### Diff B —— P0-2：否定判定改成"紧邻标记"

```diff
--- a/src/engine-core/cognition/state-transition.ts
+++ b/src/engine-core/cognition/state-transition.ts
@@
+/**
+ * 否定词 (紧邻标记时 = 否定该标记).
+ *
+ * 为什么必须**紧邻**而不是"标记前 3 字内出现":
+ *   · 中文否定句的常态是插在"我"与动词之间 ("我没有意识到" / "我好像没发现") ——
+ *     这类句子里标记"我发现"根本不连续, 会被"无标记"规则挡掉, 否定规则用不上;
+ *   · 真正需要否定规则兜底的是**标记后置否定** ("我似乎没有意识到…" / "我好像没发现…"),
+ *     否定词落在标记**之后**, 前缀窗口永远看不到;
+ *   · 而"标记前 3 字内出现否定词"会误伤 ("我不知道我发现…" 里否定的是"知道", 不是"发现").
+ */
+const BELIEF_NEGATION_TOKENS = ['没有', '没', '不', '未'] as const;
+
 /** 第三人称转述: 不是来访自己的觉察. */
 const THIRD_PERSON_REPORT = /(他|她|他们|她们|别人|对方)(说|讲|告诉|觉得|认为|表示)/;
@@ extractReflectiveStatements
     const markerIndex = clause.indexOf(marker);
     const prefix = clause.slice(Math.max(0, markerIndex - 3), markerIndex);
     if (/没|没有|不|未/.test(prefix)) continue;
+
+    // AF-357 · P0-2: 标记**紧邻**否定词 → 否定的是该标记本身 ("我似乎没有意识到…").
+    //   注意只查"紧邻", 不查整句: "我发现我并不开心" 里否定的是"开心", 不是"发现", 应保留.
+    const suffix = clause.slice(markerIndex + marker.length);
+    if (BELIEF_NEGATION_TOKENS.some((token) => suffix.startsWith(token))) continue;
```

> 配套：`af357-bdi-belief-formation.spec.ts` ③ 组的"否定式"用例应改成**真正命中否定规则**的句子（例如 `我似乎没有意识到我很容易焦虑` / `我好像没发现自己很生气`），并加一条反向断言 `我发现我并不开心` **仍应被提取**（保证不是把否定一刀切）。

---

### Diff C —— P0-3：问句双判 + 第三人称加宽

```diff
--- a/src/engine-core/cognition/state-transition.ts
+++ b/src/engine-core/cognition/state-transition.ts
@@
 /** 句末疑问语气: 是问句, 不是陈述. */
 const QUESTION_TAIL = /[吗么呢吧]$/;
+
+/**
+ * 句中疑问结构 (AF-357 · P0-3).
+ *
+ * 为什么不能只看句尾语气词: 中文疑问句大量把疑问结构放在句中
+ * ("我发现我**是不是**太敏感了" —— 句尾没有语气词), 这类自我怀疑句
+ * 在咨询里高频出现, 被当成"来访已形成的自我觉察"是直接的语义错误.
+ */
+const QUESTION_STRUCTURES = [
+  '是不是',
+  '有没有',
+  '会不会',
+  '能不能',
+  '该不该',
+  '算不算',
+  '为什么',
+  '怎么办',
+  '好不',
+] as const;
+
+/**
+ * 第三人称转述: "别人对我说什么" (AF-357 · P0-3).
+ *
+ * 口径: 拦的是**转述** (第三方对来访说的话), 不是"来访对第三方的观察"
+ * ("我发现她总是这样" 仍是来访自己的知觉, 允许).
+ */
+const THIRD_PERSON_SUBJECT = '(他|她|他们|她们|别人|对方|朋友|同事|老师|医生|家人|父母|伴侣|妈妈|爸爸)';
+const REPORT_VERB = '(说|讲|告诉|觉得|认为|表示|提到|评价)';
+const THIRD_PERSON_REPORT = new RegExp(`${THIRD_PERSON_SUBJECT}[^，。！？]{0,4}${REPORT_VERB}`);
@@ extractReflectiveStatements
     if (!clause.includes('我')) continue;
     if (THIRD_PERSON_REPORT.test(clause)) continue;
     if (QUESTION_TAIL.test(clause)) continue;
+    // AF-357 · P0-3: 句中疑问结构也算问句.
+    if (QUESTION_STRUCTURES.some((structure) => clause.includes(structure))) continue;
```

> 配套测试至少覆盖：`我发现我是不是太敏感了`（排除）、`我发现自己是不是太敏感了`（排除）、`我发现我朋友说我很焦虑`（排除）、`我发现她总是这样`（**保留** —— 按上面的口径是有意允许的，写进测试把口径钉死）。

---

### Diff D —— P1-1：强化只认"展开"，逐字复读不强化（推荐）

```diff
--- a/src/engine-core/cognition/state-transition.ts
+++ b/src/engine-core/cognition/state-transition.ts
@@ applyBeliefFormation 内层循环
   for (const statement of candidates) {
     const key = normalizeBeliefStatement(statement);
-    const existingIndex = beliefs.findIndex((belief) => normalizeBeliefStatement(belief.statement) === key);
-    const existing = existingIndex === -1 ? undefined : beliefs[existingIndex];
-
-    if (existing) {
+    // AF-357 · P1-1: **逐字复读不算强化**.
+    //   复读更常见于模板化生成 (LLM 来访者) 或防御性复述 —— 临床上它指向"尚未整合",
+    //   而不是"已整合"; 把复读接成"整合领悟"是本次改动里最容易被督导质疑的一条.
+    const exactIndex = beliefs.findIndex((belief) => normalizeBeliefStatement(belief.statement) === key);
+    if (exactIndex !== -1) {
+      // 复读: 只刷新"最近一次被读到"的痕迹, 置信度与证据计数都不动.
+      const exact = beliefs[exactIndex];
+      beliefs[exactIndex] = {
+        ...exact,
+        lastObservedAtTurn: turn,
+        ...(visitorSeq !== undefined ? { lastObservedAtVisitorSeq: visitorSeq } : {}),
+      };
+      continue;
+    }
+
+    // 同一条的**展开**: 新句包含旧句且更长 → 视为同一条的深化 (这才是支持整合的证据).
+    const existingIndex = beliefs.findIndex((belief) => {
+      const existingKey = normalizeBeliefStatement(belief.statement);
+      return key.length > existingKey.length && key.includes(existingKey);
+    });
+    const existing = existingIndex === -1 ? undefined : beliefs[existingIndex];
+
+    if (existing) {
       const lastSeq = existing.lastObservedAtVisitorSeq;
       if (visitorSeq !== undefined && lastSeq !== undefined && visitorSeq <= lastSeq) continue;
+      // 递减增量: 第 n 次强化的增量按 1/n 衰减, 避免连续展开把置信度堆到 1.0.
+      const reinforcement = (cfg.formationReinforcement ?? DEFAULT_BELIEF_FORMATION_REINFORCEMENT) / (existing.evidenceCount ?? 1);
       const nextConfidence = clamp01(
         Math.max(existing.confidence, cfg.formationBaseConfidence ?? DEFAULT_BELIEF_FORMATION_BASE_CONFIDENCE) +
-          (cfg.formationReinforcement ?? DEFAULT_BELIEF_FORMATION_REINFORCEMENT),
+          reinforcement,
       );
       beliefs[existingIndex] = {
         ...existing,
+        statement,           // 展开后用更具体的那句
         source: 'observed',
         confidence: nextConfidence,
```

> ⚠️ **这条 diff 会让 `af357-bdi-belief-formation.spec.ts` ④ 组的两条用例失效**（"逐字重复 → 0.65"、"已有高置信度 0.85 → 0.95"），需要同步改断言，并在 `deviationTable` 记一条**语义偏差**（任务单 §4 写的是"同一条规范化陈述再次出现 → 置信度 += 增量"）。
> 若临床负责人不接受语义变更，替代方案是数值路线：`formationBaseConfidence 0.45` + `formationReinforcement 0.05`（需要 5 次复读才越过 0.6）—— 一行配置改动，但**属于标定决策**。

---

### Diff E —— P1-3：种子与门槛的耦合告警 + 文档事实修正

```diff
--- a/src/engine-adapters/wiring/engine.module.ts
+++ b/src/engine-adapters/wiring/engine.module.ts
@@ useFactory(...)
         const bdiRuntime = resolveBdiRuntimeConfig(config, (message) => wiringLogger.warn(message));
+        // AF-357 · P1-3: 信念生成种子与意图规划器门槛是**两把互不相关的尺子** ——
+        //   base >= reflectiveBeliefGate 时, **一句**自我觉察就够门槛 ("必须复述两次"
+        //   的语义前提消失); base + reinforcement <= gate 时, 复读多少次都过不去.
+        //   这两种配置都不会报错, 只会静默改变策略分布 → 装配期就喊出来.
+        const alliance = resolveAllianceConfig(config);
+        const belief = bdiRuntime.beliefConfig;
+        if (belief?.formationEnabled) {
+          const gate = alliance.thresholds?.reflectiveBeliefGate ?? 0.6;
+          const base = belief.formationBaseConfidence ?? 0.55;
+          if (base >= gate) {
+            wiringLogger.warn(
+              `[af357] 短期信念生成 base(${base}) >= reflectiveBeliefGate(${gate}) —— 一句自我觉察即可越过门槛, 请确认这是有意配置`,
+            );
+          }
+        }
@@
-            allianceConfig: resolveAllianceConfig(config),
+            allianceConfig: alliance,
```

```diff
--- a/.env.example
+++ b/.env.example
@@
 # 短期信念生成 (AF-357)：只从来访上一轮原话提取第一人称自我觉察陈述，source=observed.
 #   缺省关闭；开启后连续同一条自我觉察达到 reflectiveBeliefGate 才可能进入 insight 分支.
+#   ⚠️ 与门槛的耦合：BASE_CONFIDENCE 必须 < ENGINE_INTENTION_REFLECTIVE_BELIEF_GATE(缺省 0.60)，
+#     否则**一句**自我觉察就越过门槛，"需要复述才达整合领悟"的语义前提消失；
+#     装配期会就此告警 (base >= gate 时).
+#   ⚠️ insight 分支的最早轮次是 insightMinTurn (缺省 8)，不是 12 (12 是 discussing_plans 的 planMinTurn).
```

**同步要改的文档事实**：

| 位置                                        | 现写法                                  | 应改成                                                                                        |
| ------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| 交付记录 §2                                 | "turnNumber >= 12 时 insight 可判"      | "turnNumber >= **8**（insightMinTurn）时 insight 可判；12 是 discussing_plans 的 planMinTurn" |
| `af357-bdi-belief-formation.spec.ts` 用例名 | "第 12 轮 insight 分支可达"             | "第 8 轮 insight 分支可达"（并补一条第 8 轮的断言）                                           |
| `.env.example` / 审计 CLI `reason`          | "**连续**复述达到 reflectiveBeliefGate" | "**再次**出现（同一条）达到 reflectiveBeliefGate"（实现不要求连续）                           |

---

## 8. 工程纪律对齐核对表

| 纪律                                               | 结论                     | 证据                                                                                                                                            |
| -------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 有任务单才实现                                     | ✅                       | `AF-357` 已登记，评审时索引状态 `submitted`（≥ submitted 才实现，符合 AGENTS.md §0）；评审期间已归档                                            |
| engine-core 只改授权的 4 个文件                    | ✅                       | `git diff --stat HEAD -- src/engine-core` 只有 `state-transition.ts` / `beliefs.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts` |
| `boundary.spec.ts` 不改                            | ✅                       | 不在 diff 内；我定向跑过，**12 条断言全绿**                                                                                                     |
| 内核零 env / 零 IO / 零 `@nestjs`                  | ✅                       | env 全在 `bdi-runtime.config.ts`（适配层）读，内核只认 `BeliefOperatorConfig` 端口                                                              |
| 缺省关闭 → 逐字零回归                              | ✅                       | `formationEnabled` 缺省 false；未开启时 `applyBeliefFormation` 返回**入参引用**（有单测钉住）                                                   |
| 临时快照与落库快照同口径                           | ✅                       | 两处都从 `base.snapshot` 出发、各演一次 → 同结果，不会双计数（我逐行核对过 `:499` 与 `:553`）                                                   |
| 不改 12 阈值 / 愿望演化 5 参数 / 锁 TTL / 时序斜率 | ✅                       | 全部只读不改；新增的 base/reinforcement 是 AF-357 自己的种子                                                                                    |
| 心理原文不进日志 / 报告 / 审计                     | ✅（审计侧）⚠️（落点侧） | 审计 CLI 只出键/数值/布尔/计数；`auditTurn` 只记内核事件。⚠️ 但信念原文新增落进 BDI 快照 JSON 与 admin 调试接口 → 见 P1-5                       |
| 角色愿望映射不改数值                               | ⚠️ 部分                  | 权重未改；但**合并删掉了另一条角色级愿望与其 label**，且种子写库会把合并形态写回 DB → 见 P1-2                                                   |
| 交付记录六组机读标记                               | ✅                       | `gateResults` / `scopeCheck` / `contractChecks` / `backlogItems` / `deviationTable` / `reviewVerdict` 齐备                                      |
| 闸门命令可复现                                     | ❌                       | 任务单 gates 指向 `af356-*`（不存在）→ 实跑只 24 例 → 见 P1-4                                                                                   |
| 断言无假绿                                         | ❌（2 处）               | 否定式用例、映射 ② 断言 → 见 P0-2 / P2-1                                                                                                        |

---

## 9. 建议的复核清单（修完后跑这些即可，不用全量）

1. `pnpm exec vitest run test/engine-core/af357-bdi-belief-formation.spec.ts test/engine-adapters/af357-character-desire-mapping.spec.ts test/engine-adapters/af357-bdi-runtime-config.spec.ts test/engine-core/boundary.spec.ts test/config/wp25-env-example-coverage.spec.ts test/engine-adapters/af106-character-pool.spec.ts` —— 目标 **≥ 90 例**（当前 4 文件 73 例 + env 12 + af106）。
2. 新增 `test/engine-core/af357-belief-extraction-matrix.spec.ts`：30 条中文句式矩阵，每条标注**被哪条规则排除**（否定 8 / 问句 8 / 第三人称 6 / 边界 8）。
3. 新增一条**降级轮回归**：连续 3 轮降级（history 不追加来访腿）→ 断言同一句的 `evidenceCount === 1`、`confidence === 0.55`、且 `planIntention` **不**判 `insight`。
4. `pnpm exec tsx bin/bdi-readiness-audit.ts --out <tmp> --strict` —— 阻断项 0。
5. `git diff --stat HEAD -- src/engine-core` —— 仍只有那 4 个文件。
6. 灰度建议：**先只开角色映射**（缺省即生效、无开关），观察 `strategy=discussing_plans` 的触发率与角色分布；**信念生成单独开**，并在开之前确认 P0 三条已修。

---

_评审人：MiniMax Code（只读评审，未改工作区、未提交）。本回复仅回答工程与临床语义的可讨论性，不构成临床标定结论。_
