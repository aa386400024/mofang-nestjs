# AF-133 · 长会话收束可达性与硬模板（AF-130/AF-131 未达标项修复）

> **taskId**：AF-133 · **contextId**：phase2.5-ai-proxy-acceptance · **agentRole**：executor
> **分支**：task/AF-133-long-session-closure · **基线**：6b4b8baafef92cc2bdedcef28b1696606f071906 · **日期**：2026-11-19
> **性质**：实现单。改 runner 出口 + prompt 硬模板；**不改**评分器、阈值、数据库、队列；**未跑** LLM 批次；**未** commit / push。
> **免责**：本单**不产生任何新的质量分**。本报告只记录"收束在结构上是否可达"的代码级证据，**不是**质量达标证据。`humanSupervision=false`、`clinicalAcceptanceEligible=false`。

---

## 0. 结论速览

AF-131 的核心结论是：**14/16 场次收束不是"模型不执行"，而是"runner 出口让收束不可达"**。本单按这个结论改了两侧：

| 面 | 改了什么 | 落在哪 |
| --- | --- | --- |
| **runner 出口** | ① 最后 3 轮注入 `closingCue='forced'`（强制收束 cue）；② 危机窗用满**不再硬切**，多留 1 轮**风险收束轮**；③ 危机窗内模型的收尾请求**优先于**危机计数器 | `src/auto-practice/practice-runner.service.ts` |
| **档案** | 新增 `crisisRiskClosingRound` 开关：standard / long = true，legacy = false | `src/auto-practice/session-profile.ts` |
| **prompt** | 开场五要素硬模板 + 前 3 轮补检；常规收束三件套硬模板 + END 前自检三问；危机收束五项**独立成块** | `prompt-sections/{opening-framework,close-discipline,crisis-stabilization}.ts` |
| **legacy 红线** | legacy 档 prompt **逐字不变**（两份 golden 断言：非危机 / 危机窗两条路径） | `test/auto-practice/counselor-prompt-builder.spec.ts` |

**一句话**：AF-131 指出的"收束不可达"从**结构上**被拆掉了 —— 收束轮现在一定存在（危机窗 +1 轮）、模型一定知道快到头了（forced-close cue）、模型的收尾请求不再被计数器抢走（顺序反转）。

**本单不改变 AF-130 的结论**：style 3.312 / κ 0.138462 仍然是未达标状态；复评必须另登记 verification 任务并跑新批次（见 §6）。

---

## 1. 改动清单

### 1.1 源码（6 个文件）

| 文件 | 改动 | 关键决策 |
| --- | --- | --- |
| `src/auto-practice/practice-runner.service.ts` | ① `runConversationLoop` 计算 `remaining = maxTurns - i`，`remaining <= 2` → 传 `closingCue:'forced'` + `remainingTurns`；② `decideTurn` 的危机窗计时**只计数不结束**，结束判定挪到 `decideCrisisWindowStop`；③ 新增 `decideTurnCue` / `buildCounselorOptions` / `decideCrisisWindowStop` 三个纯函数 | 顺序反转是本单的核心：老实现"计数先于关闭判定"，模型请求 END 会被计数器抢走（packet-12） |
| `src/auto-practice/session-profile.ts` | `SessionProfile` / `SessionThresholds` 新增 `crisisRiskClosingRound: boolean`；`sessionThresholdsOf` 透传；legacy = false、standard / long = true | 判据必须**由调用方显式传入**（本文件既有纪律），所以开关挂在档案上而不是 `decideTurn` 里读常量 |
| `src/auto-practice/counselor-agent.service.ts` | 新增 `CounselorGenerateContext`（扩展 `CounselorGenerateOptions`，多 3 个**可选**字段：`closingCue` / `remainingTurns` / `crisisClosing`）；`generate` / `buildMessages` 透传 | 扩展接口而不是改 DTO 文件，见 §5 偏差表 |
| `src/auto-practice/counselor/builder/counselor-prompt-builder.ts` | `build()` 增加第 5 个入参 `cue?: PromptBuildCue`；注册 `forced-close`（order 36）与 `crisis-risk-closing`（order 55）两个动态块 | 顺序：开场 25 → 收尾纪律 30 → 长会话收尾 35 → **强制收束 36** → 危机协议 40 → 危机稳定化 50 → **风险收束 55**（最后，recency 优势） |
| `src/auto-practice/counselor/builder/prompt-sections/close-discipline.ts` | ① `sessionCloseDisciplineSection` 追加"收束三件套 · 硬模板"+"输出 END 之前 · 自检三问"；② 新增 `forcedCloseSection` | 静态块 `CLOSE_DISCIPLINE` **一行未动**（legacy golden 靠它） |
| `src/auto-practice/counselor/builder/prompt-sections/opening-framework.ts` | 五要素改为"硬模板"形态：每项给可照着说的句式 + 关键词提示；追加"前 3 轮补检" | 关键词必须能被结构审计命中，但保留自然口语 —— 所以给的是**句式 + 关键词提示**，不是"照念" |
| `src/auto-practice/counselor/builder/prompt-sections/crisis-stabilization.ts` | 新增 `crisisRiskClosingSection`（风险收束五项独立成块） | 与 `crisis-stabilization` 同文件：危机窗的"做什么"是一件事，拆成两个文件会多出一个要登记进 `PROMPT_TEMPLATE_FILES` 的指纹文件（见 §5） |

### 1.2 测试（3 个文件）

| 文件 | 性质 | 内容 |
| --- | --- | --- |
| `test/auto-practice/practice-runner-decide-turn.spec.ts` | **新增**（任务单允许） | 11 例：危机窗用满不硬切（6 轮练习 + 1 轮风险收束）、legacy 仍是 4 轮、收尾请求优先于计数器、披露当轮仍被挡、危机窗内放开 `minTurnsBeforeClose`、非危机场门槛不变、runner 层 forced-close cue 注入、风险收束轮 `crisisClosing=true`、`crisis_practice_close` 出口 |
| `test/auto-practice/counselor-prompt-builder.spec.ts` | 改（任务单允许） | 23 例：五要素硬模板关键词逐组断言、三件套 + 自检三问、强制收束块、风险收束五项块、**legacy golden（两份）** |
| `test/auto-practice/session-profile.spec.ts` | 改（**scope 偏差**，见 §5） | 2 处断言同步：阈值子集从 4 个数变 5 个；long 档危机窗断言从"第 6 轮停"改成"第 6 轮继续、第 7 轮（风险收束轮）之后停" |

---

## 2. AF-131 的 D-1 / D-2 被怎么改变了

### 2.1 D-1「AF-129 的 prompt 块并未被模型稳定执行」→ **部分成立，本单把它拆成两半**

AF-131 的判断是"证据不足，且方向部分相反"：唯一走到收尾路径的 2 场都产出了 takeaway，14 场里有 6 场**结构上不可能**执行。

本单之后，两件事分开处理：

| AF-131 的归因 | 本单怎么处理 | 仍归谁 |
| --- | --- | --- |
| **6/16 收束路径不可达**（危机窗计数器硬切） | 改 runner：危机窗用满 → 多留 1 轮风险收束（`crisis_practice_max` 不再在计数到点时立刻触发） | **runner 侧已修**；是否真的落地要看新批次的结构审计 |
| **8/16 max_turns 硬切**（模型在合法窗口不请求 END，且无从知道会被切） | 改 runner + prompt：最后 3 轮注入强制收束 cue，prompt 明确"本场即将结束 + 三件套 + END 前自检三问" | **runner + prompt 两侧已修**；模型依从性仍有残余（见 §6） |
| **prompt 块在可达路径上 2/2 有效** | 保留并强化：硬模板把"说什么"变成"照着说" | — |

> ⚠️ **D-1 现在不再是一个整体命题**：它被拆成"路径可达性（runner，已修）"与"路径内的依从性（prompt + 模型，未验证）"。**本单没有产生任何新证据去判定后者**，所以不能说"D-1 已被推翻"。

### 2.2 D-2「不是某个角色差，而是长会话开场/收束的结构依从性缺陷」→ **归因被改写**

AF-131 把 D-2 判为"归因错位"：开场是**前移失败**（8 个从未说、4 个晚到第 13–44 轮、真实完整只有 3/16），收束是**路径不可达**（14/16）。本单对应地做了两件事：

- **收束（路径不可达）**：runner 侧修完，见上表。收束从"结构上不可达"变成"结构上可达"。
- **开场（前移失败）**：prompt 侧从"说清楚这五件事"改成"**首轮硬模板 + 前 3 轮补检**"—— 每项给出可照着说的句式和关键词，并要求第 1/2/3 轮各补检一次。这直接针对 AF-131 §2.4 的"框架被补在中后段（p06 第 32 轮、p09 第 13 轮、p11 第 44 轮、p12 第 25 轮、p02 第 28 轮）"。

> ⚠️ **开场侧的修复强度弱于收束侧**：AF-131 §2.3 指出结构审计的 `boundary` 口径本身有双向失真（2 个假阳性 + 5 个"说了实质没名词"被判 0）。硬模板补的是**名词**（约定/框架/边界）与**实质**（不评判/不指责/不能替你决定）两组，理论上两头都能命中；但这要靠新批次复核，**本单没有新数据**。

---

## 3. 三条 runner 侧判据的精确语义

### 3.1 强制收束 cue（`decideTurnCue`）

```
remaining      = maxTurns - turnIndex      // 本轮之后还剩几轮
forcedClose    = remaining <= 2             // → 最后 3 轮注入 cue
remainingTurns = remaining + 1              // 含本轮, 写进 prompt 的数字
```

- **为什么是 3 轮而不是 2 轮**：任务单写的是"`remaining = maxTurns - i`；`remaining <= 2` 时注入"，按这个公式命中的是最后 **3** 轮（i = maxTurns-2 / -1 / maxTurns）。任务单的硬要求"maxTurns 前 2 轮注入"满足（最后 2 轮必然在内），额外提前 1 轮是刻意的 —— 多给模型一轮把三件套做完的机会。定向单测把两个口径都断言了（`cues[2..4] === 'forced'`，且 `cues.slice(3)` 必为 forced）。
- prompt 里写的数字是 `remainingTurns`（**含本轮**，由 runner 算），不是 builder 从档案反推 —— 因为 `input.maxTurns` 可以小于档案上限（HTTP 入口允许显式传轮数），反推会算错。

### 3.2 危机窗用满不再硬切（`decideCrisisWindowStop`）

| 档位 | `postTurns` 达到上限那一轮 | 之后 |
| --- | --- | --- |
| legacy | `crisis_practice_max`（**老行为不变**，档案契约"危机窗 4"） | — |
| standard / long | **继续**（下一轮 = 风险收束轮，prompt 带 `crisisClosing=true`） | 收束轮结束后 `crisis_practice_max` |

- 净效果：long 档危机窗 = **6 轮练习 + 1 轮风险收束**（`crisisPostTurns` 指标随之从 6 变 7）。
- **legacy 完全不变**：档案契约里"legacy: 危机窗 4"是明文，`session-profile.ts` 的档位注释也是这么写的 —— 为修 long 档而改 legacy 契约是不该有的副作用，所以 `crisisRiskClosingRound` 对 legacy = false。

### 3.3 收尾请求优先于计数器

```
closeRequested && crisisWindow.active && postTurns >= 1  →  crisis_practice_close
```

- 顺序反转：老实现先判 `crisis_practice_max` 再判关闭请求，模型的 END 被计数器抢走（AF-131 §2.2 的 packet-12，第 45 轮）。
- **危机窗内动态放开 `minTurnsBeforeClose`**：危机窗本身是有界的短协议（6 轮），收束是安全动作，不能被会话级门槛（long = 35 轮）卡住，否则风险收束又变成不可达。常规场（非危机）门槛不变（第 34 轮不生效 / 第 35 轮生效，单测已断言）。
- 披露当轮（`postTurns === 0`）仍然挡一次 —— 不能把来访者一个人留在危机里。

---

## 4. prompt 侧：关键词怎么对上结构审计

结构审计（`src/auto-practice/metrics/session-structure-audit.ts`，af127-v1）按**子组合取 + 位置窗口**判定，硬模板必须同时命中两组词。本单给的句式（模型会自然改写，但关键说法要求原样保留）：

| 要素 | 子组 | 硬模板里给的原词 |
| --- | --- | --- |
| confidentiality | secrecy + exception | 保密 / 不会告诉别人 / 例外 / 自伤 / 自杀 / 生命危险 / 联系 / 保护你 |
| boundary | setting + limit | 约定 / 框架 / 不评判 / 不指责 / 不能替你决定 |
| duration | length + cadence | 50 分钟 / 每周一次 / 调整 |
| pauseRefusal | pause + refuse | 随时可以喊停 / 暂停 / 可以拒绝 / 可以跳过 / 不必勉强 |
| recording | recording + consent | 录音 / 不录音 / 知情同意 / 征求你的同意 |
| summary | action + understanding | 回顾 / 总结 + 我听到 / 我的理解（**同一句里**，审计要求轮差 ≤1） |
| takeaway | carry | 带走 / 记住 / 写下来 |
| nextStep | arrangement | 下次 / 回去之后 / 下一步 |
| 危机收束 | means / channel / contact / noAlone / commitment | 收起来+药物/剪刀/绳子+放到 / 心理援助热线+120+急诊 / 联系+家人 / 不要一个人+不要独处 / 安全计划+答应我+保证 |

**收束三件套 + END 前自检三问**：三件套落地后必须过三问（① 总结/回顾并复述理解 ② 留下可带走/记住的东西 ③ 说清下次或回去可以试的小行动），**三问全是"是"才允许输出 END**；答"不是"就先补进正文再 END。

---

## 5. 偏差表（必须由编排侧确认）

| # | 任务单说 | 实际 | 原因 | 动作 |
| --- | --- | --- | --- | --- |
| 1 | 允许改 `prompt-sections/`、`counselor-prompt-builder.ts`、`counselor-agent.service.ts`、`practice-runner.service.ts` + 两个测试 | 额外改了 `src/auto-practice/session-profile.ts` | 危机窗"多留 1 轮"的开关是**档案级判据**，按本仓既有纪律（"判据必须由调用方显式传入"，"哪一档阈值在生效不能靠猜"）必须挂在档案上；挂在 `decideTurn` 里读模块常量会破坏纯函数口径 | 新增 `crisisRiskClosingRound` 字段（纯增量，不改既有字段语义）；**需要编排侧决定是否重签 scope**（任务单 `scope.files` 未列该文件，且 AF-133 已 submitted，按 §5.6.1 不能原地改 scope） |
| 2 | 允许改 `test/auto-practice/counselor-prompt-builder.spec.ts`、新增 `practice-runner-decide-turn.spec.ts` | 额外改了 `test/auto-practice/session-profile.spec.ts` 的 2 处断言 | AF-133 **故意**改变了 long 档危机窗语义（6 → 6+1），既有断言必然变红；不改就是留红灯 | 断言同步为新语义（legacy 用例原样保留）；**需要编排侧确认** |
| 3 | `CounselorGenerateOptions` 未提及 | 新增 `CounselorGenerateContext` 扩展接口（放在 `counselor-agent.service.ts`，**没有**改 `dto/counselor-types.ts`） | DTO 文件不在 scope 内；扩展接口挂 3 个**可选**开关，老调用方（只传 dto 那三个字段）行为逐字不变 | 已按"最小增量 + 不越 scope"处理；若编排侧希望统一放回 DTO，可平移 |
| 4 | "危机窗达到 crisisPracticeTurns 时不得直接硬切，至少留 1 轮风险收束后再结束" | 对 **standard / long** 生效；**legacy 保持硬切**（档案契约"危机窗 4"不变） | `session-profile.ts` 明文写着 legacy = 既有行为（危机窗 4），且 legacy 是 15 轮短对练，不存在 AF-131 的"收尾不可达"问题 | 单测 `legacy 档: 危机窗计数一到就结束` 固化了这条边界；**若要求 legacy 也改，请明确，本单可平移**（代价：legacy 行为不再"逐字不变"） |
| 5 | 场景 A：最后 2 轮注入 cue | 实际注入**最后 3 轮** | 任务单公式 `remaining = maxTurns - i; remaining <= 2` 的字面结果 | 最后 2 轮必然在内（硬要求满足），额外提前 1 轮是刻意余量 |

**未改动**（逐项自查）：`src/engine-core/**`（`git diff --stat HEAD -- src/engine-core` **为空**）、`ai-double-blind.ts`、`acceptance-thresholds.ts`、`quality_annotation`、数据库 schema / migration、队列与批次脚本、`admin-dashboard/`、Flutter 仓库。

> 工作区里另有 **AF-128 的未提交改动**（`src/shared/llm/reasoning-text.ts`、`test/shared/af106-reasoning-text.spec.ts`）与编排状态面文件，**不是本单产出**，本单未触碰。

---

## 6. 仍未解决的事项

1. **没有新证据**：本单**没有跑 LLM 批次**，没有产生任何新的质量分 / 结构审计数据。"收束现在结构上可达"是**代码级**结论；"收束现在真的发生"必须由新批次的结构审计 + 双盲评分回答 —— 需另登记 verification 任务。
2. **AF-130 的未达标结论未变**：style 3.312 < 3.50、overall κ 0.138462 < 0.40 仍然成立；AF-131 §3.5 的口径校准方案（B-1…B-7，含 Gwet AC1、cluster bootstrap CI、仲裁覆盖 ±1 分歧）**本单一条都没做** —— 那属于评分口径层，需要框架层决策。
3. **结构审计口径的双向失真未修**：`boundary` 2 个假阳性 + 5 个近失配、`summary` 偏严、`nextStep` 假阳假阴（AF-131 §2.3）。本单让 prompt 侧两头都命中，但**审计规则本身没动** —— 假阳性/假阴性的口径问题仍会带 ±1–2 packet 的噪声。
4. **模型依从性仍是残余变量**：forced-close cue 与硬模板只是"给了模型机会"，不能保证模型照做；8/16 场次里真正的依从性问题（合法窗口内不请求 END）需要新批次数据才能定量。
5. **开场侧弱于收束侧**：危机优先规则（"先安全评估再补开场框架"）在 AF-131 的 p16 里等于"开场框架从未出现"（危机稳定化块完全压过开场框架）。本单的硬模板没有改这条优先级 —— p16 类场景的开场完整度仍可能为 0。
6. **`crisisPostTurns` 指标口径变化**：long 档危机窗从 6 轮变 7 轮，指标随之 +1。历史批次的该列**不可直接与新批次对比**（已在 §3.2 标注，但未做数据侧标记）。

---

## 7. 闸门真实数字

全部在本工作区（`D:\work\Project\backend\mofang-nestjs-af070`，分支 `task/AF-133-long-session-closure`）实跑，命令与 exit code 如下：

| # | 命令 | exit code | 结果 |
| --- | --- | --- | --- |
| 1 | `pnpm typecheck` | `0` | 0 error |
| 2 | `pnpm lint` | `0` | 0 error 0 warning |
| 3 | `pnpm exec vitest run test/auto-practice/counselor-prompt-builder.spec.ts` | `0` | 1 file / 23 tests 全绿 |
| 4 | `pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts` | `0` | 1 file / 11 tests 全绿 |
| 5 | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | `0` | 1 file / 12 tests 全绿 |
| 附 | `pnpm exec vitest run`（全量回归） | `0` | 见下 |

**全量回归数字**（`pnpm test` = `vitest run --exclude '**/e2e/**/*.ts'`）：

```
Test Files  219 passed | 1 skipped (220)
     Tests  3854 passed | 4 skipped (3858)
  Duration  17.96s
exit code = 0
```

**`git diff --stat HEAD -- src/engine-core`**：空（engine-core 未越界）。

**未跑**：LLM 批次、任何真实模型调用；未改评分器与阈值；未碰数据库与队列。

---

## 8. 交付物

- 交付记录：`docs/worklog/completed/phase2.5/af133-long-session-closure-2026-11-19.md`（本文件）
- 任务单：`docs/worklog/pending/af133-long-session-closure-task-2026-11-19.md`
- 新增测试：`test/auto-practice/practice-runner-decide-turn.spec.ts`
- 回复件：`relay-response-AF133-20261119-1505.md` —— 按要求写入 `docs/worklog/pending/` 后，被框架自带的 relay supervisor（`scripts/orchestration/relay-supervisor.mjs`，`RELAY_ARCHIVE_DIR`）立即归档到 `docs/worklog/pending/archive/`（与 AF-131 的回复件同一路径口径），文件内容 9869 字节、逐字未改。
- 建议 commit message：`feat(af133): 长会话收束可达性 + 开场/收束硬模板（runner 侧修出口，legacy prompt 逐字不变）`
