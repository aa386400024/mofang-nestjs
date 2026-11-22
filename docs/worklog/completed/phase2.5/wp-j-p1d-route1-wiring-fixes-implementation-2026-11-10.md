# WP-J P1d · 路线1 三处结构修复的遗留问题修复 — 交付记录

> 日期：2026-11-10
> 执行方：MiniMax Code（后端仓库 `mofang-nestjs`，分支 `integrate`，基线 HEAD `3e9646f`）
> 任务单：[`wp-j-p1d-route1-wiring-fixes-task-2026-11-10.md`](./wp-j-p1d-route1-wiring-fixes-task-2026-11-10.md)
> 前序：[`wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md`](./wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md)
> 交付后验收/重跑方案：`docs/worklog/pending/phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md`

---

## 一、一句话结论

P1c 遗留的 7 条里 **6 条全修完并逐条取证**（#3 上游限流按大炮指示不改代码）。最关键的两条拿到的是**硬证据**，不是推断：

| 项 | 修前 | 修后 |
|---|---|---|
| #1 anxious 指引进 prompt | 构建前 57 份逐字稿 **0 命中** | 新代码 4 份 anxious 逐字稿 **各 8 次命中**，avoidant 对照 **0 命中** |
| #2 批次有效性门禁 | `valid=0`，flags=`LLM_CALL_RATIO_LOW,FALLBACK_RATIO_UNKNOWN` | `valid=1`，flags=`null`，`llm_call_ratio=1.0000`，`fallback_ratio=0.0000` |

闸门全绿：`tsc` 0 错 / `eslint` 0 错 / 新增 43 例单测全绿 / 全量 vitest 回到既有基线（4 failed，均在豁免清单内）/ `git diff --stat HEAD -- src/engine-core` **为空**。

---

## 二、#1 P0・`attachmentStyle` 接线（anxious 行为通道）

### 2.1 根因

渲染层的依恋行为指引**只认 `spec.attachmentStyle`**，而这个字段从角色基线到 spec 之间有 3 段链路，**每一段的装配点都漏传了**：

| 段 | 文件:行（修前状态） | 漏传后果 |
|---|---|---|
| ① 会话上下文 | `src/engine-adapters/rendering/turn-render-orchestrator.ts` 的 `TurnSessionContext`（修前无 `attachmentStyle` 字段）、`assemble()`（修前 `L1005` 附近只透传 `speechVolumeBaseline` / `narrativeStyle` / `expressionTone` / `verbalVoice`） | 编排器**拿不到**依恋风格 |
| ② 装配层登记 | `src/engine-adapters/wiring/engine-turn.service.ts` 的 `EngineTurnService.open()` options（修前只登记 4 个表达字段，`L177` 附近） | `registry.register()` 里没有依恋风格 |
| ③ 生产开场路径 | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` 的 `openKernelSession()`（修前 `L422-455` 不读 profile.attachmentStyle）、`src/admin-debug/debug-session.service.ts` 的 `createSession()`（修前 `L456-474`）与 `restore()`（修前 `L682-703`） | 两条生产路径都拿不到角色基线的依恋风格 |

**结果**：`spec.attachmentStyle` 恒 `undefined` → `appendAttachmentBehavior()`（修前 `L1793`）拿到空串 → **anxious 行为指引块从来没进过 prompt**。P1c 看到的 "anxious 角色 0%/0%" 有一部分是接线断了造成的，不是内容质量问题。

### 2.2 修法（5 处，不是 3 处）

```diff
--- src/engine-adapters/rendering/turn-render-orchestrator.ts
+++ src/engine-adapters/rendering/turn-render-orchestrator.ts
@@ TurnSessionContext (L225)
+  readonly attachmentStyle?: RenderSpec['attachmentStyle'];
@@ assemble() (L1017)
+  ...(context?.attachmentStyle === undefined ? {} : { attachmentStyle: context.attachmentStyle }),
@@ appendAttachmentBehavior() (L1793)
+  const style = spec.attachmentStyle;
+  if (style === undefined) return;
+  const behavior = ATTACHMENT_BEHAVIOR_INSTRUCTION[style];
   if (behavior.length > 0) {
     lines.push('', '你的依恋模式带来的行为习惯（……）：', behavior);
+    logAttachmentBehaviorInjection(style, behavior.length);
   }

--- src/engine-adapters/wiring/engine-turn.service.ts
@@ open() options (L141) / register (L177)
+  readonly attachmentStyle?: TurnSessionContext['attachmentStyle'];
+  ...(options?.attachmentStyle === undefined ? {} : { attachmentStyle: options.attachmentStyle }),

--- src/engine-adapters/wiring/engine-stream-backend.adapter.ts
@@ openKernelSession() (L444)
+  ...attachmentStyleOption(profile),
@@ 模块级新函数 (L1697)
+function attachmentStyleOption(profile: CharacterProfile | undefined) {
+  const style = profile?.attachmentStyle;
+  return style === undefined ? {} : { attachmentStyle: style };
+}

--- src/admin-debug/debug-session.service.ts
@@ createSession() (L471) / restore() (L698-700)
+  ...(resolved.characterProfile.attachmentStyle === undefined ? {} : { attachmentStyle: resolved.characterProfile.attachmentStyle }),
```

**为什么是 5 处而不是任务单写的 3 处**：任务单点名的 3 处是**链路骨架**，但仓库里其实有**两条生产开场路径**：

1. 自动对练 / 调试面板 → `DebugSessionService.createSession()` / `restore()` → `engine.open()`
2. 语音链路 → `EngineStreamBackend.openKernelSession()`

只修点名的 3 处，**自动对练这条路径仍然不生效**（P1c 的重跑正是走自动对练）。所以两条路径都接了。

**为什么 `attachmentStyleOption` 抽成模块级函数**：内联条件展开会让 `openKernelSession` 的圈复杂度从 20 顶到 21，撞 eslint `complexity ≤ 20`。抽出去既过闸门，又让"有没有登记"这件事单点可测。

### 2.3 额外加的一行 dev-only 日志（超出任务单，说明理由）

`turn-render-orchestrator.ts` 新增 `logAttachmentBehaviorInjection()`（L1817）：

```
[TurnRenderOrchestrator] 依恋行为指引已注入 prompt: style=anxious len=106
```

- **为什么必须有**：旧的 `logPromptCharacterFragment()` 只能证明"spec 带了这个字段"，证不了"指引文案进了 prompt" —— 这两件事之间还有漏点，**P1c 就是死在这个区别上**。新行直接打在插入点之后，打印时文案已经在 `lines` 里了。
- **隐私**：只打印**风格名 + 文案长度**，不打印指引文案本身，更不打印任何来访者台词原文；只在 `NODE_ENV !== 'production'` 打印。

### 2.4 验证

**静态（3 段链路都通）**：

| 检查 | 结果 |
|---|---|
| `TurnSessionContext.attachmentStyle` | `turn-render-orchestrator.ts:225` ✅ |
| `assemble()` 透传 | `turn-render-orchestrator.ts:1017` ✅ |
| `EngineTurnService.open()` options + 登记 | `engine-turn.service.ts:141` / `:177` ✅ |
| `openKernelSession()` 登记 | `engine-stream-backend.adapter.ts:444` + `:1697` ✅ |
| `debug-session.service.ts` 两处登记 | `:471` / `:698-700` ✅ |
| `git diff --stat HEAD -- src/engine-core` | **空**（红线未碰）✅ |

**动态（3100 临时实例，实例日志）**：

```
[TurnRenderOrchestrator] 依恋行为指引已注入 prompt: style=anxious len=106
```

—— 每场 4 轮出现 4 次；avoidant 角色场次 **0 次**（条件渲染正确，不是无差别塞给所有人）。

**逐字稿级 before/after**（最硬的证据）：

| 逐字稿集合 | 份数 | 含依恋指引的文件数 | 命中次数 |
|---|---|---|---|
| 构建前（57 份基线 + P1c 归档 32 份） | 57（另 32 份在 archives） | **0** | **0** |
| 构建后新跑（2 批 × 3 场） | 6 | **4**（2 anxious × 2 批） | **8/份**（4 轮 × 2 处标记） |

其中 avoidant 对照（`vpt_depression_avoidant_l1`）两份均为 **0 命中**。

**单测（10 例全绿）**：`test/engine-adapters/wp-j-p1d-attachment-style-wiring.spec.ts`

| # | 用例 | 作用 |
|---|---|---|
| ① | 渲染层含指引块 | spec 带 `attachmentStyle='anxious'` → prompt 含依恋行为指引块 |
| ② | 零回归 | 缺省版与 secure 版 prompt **逐字相同**（没给字段 = 一个字都不变） |
| ③ | 编排器透传 | 会话归属带 `attachmentStyle` → 交给渲染端口的 spec 带它 |
| ④ | 装配层登记 | `EngineTurnService.open({attachmentStyle})` → 归属登记里有它 |
| ⑤ | 端到端 | open → turn → `spec.attachmentStyle === 'anxious'`（接线断了就红的那条） |
| ⑥ | 生产接线点源码扫描 | 两个生产开场路径的源码里必须留着登记（防以后被人顺手删掉） |

```
npx vitest run test/engine-adapters/wp-j-p1d-attachment-style-wiring.spec.ts
# → Test Files 1 passed (1) / Tests 10 passed (10)
```

---

## 三、#2 P1・门禁相关四列落库（`llm_call_turns` / `render_fallback_turns` + **两列同族**）

### 3.1 根因：不是两列，是**四列**，而且是**两个批次才暴露出来的**

第一批只按任务单落了两列，跑完实测批次仍然 `valid=0`，flags=`FALLBACK_RATIO_UNKNOWN` —— 顺着这条线查下去，发现同一族还有两列同样"建了但全库无人写"：

| 列 | 用途 | 修前状态 | 卡住什么 |
|---|---|---|---|
| `ap_practice_sessions.llm_call_turns` | 本场真实 LLM 调用轮数 | **无人写** | `LLM_CALL_RATIO_LOW`（永远） |
| `ap_practice_sessions.render_fallback_turns` | 本场访客侧渲染兜底轮数 | **无人写** | `FALLBACK_RATIO_*` |
| `ap_practice_sessions.render_fallback_ratio` | 渲染兜底率（实体注释口径 = `render_fallback_turns / turn_count`） | **无人写** | `FALLBACK_RATIO_UNKNOWN`（永远） |
| `ap_practice_sessions.counselor_degraded_turns` / `visitor_degraded_turns` | 两侧降级拆分（WP-H 改动 5） | **无人写** | 看板/审计拿到的永远是 0 |

根因位置：`src/auto-practice/practice-runner.service.ts` 的 `updateSessionResult()`（修前 `L639-690`）只写了 `degradedTurns` 一个降级计数，四列全没落。

而 `practice-batch-health.service.ts` 的批次门禁（修前 `L186-190`）算 `renderFallbackRatio` 时读的是**单场 ratio 列**（`toBatchSessionMetrics` → `toRatio(row.renderFallbackRatio)`），该列永远 NULL → `measuredRatioCount = 0` → 批次 ratio = null → `FALLBACK_RATIO_UNKNOWN` → **任何批次永远 `valid:false`**。

### 3.2 修法

```diff
--- src/auto-practice/practice-runner.service.ts
@@ runConversationLoop() (L472-482)
     let degradedTurns = 0;
+    let counselorDegradedTurns = 0;
+    let visitorDegradedTurns = 0;
     let renderFallbackTurns = 0;
     let llmCallTurns = 0;
@@ 计数口径 (L493-515)
     if (counselorReply.degraded) { degradedTurns += 1; counselorDegradedTurns += 1; }
     if (result.trace.degraded)  { degradedTurns += 1; visitorDegradedTurns += 1; }
     if (result.trace.degraded)  { renderFallbackTurns += 1; }
     else if (result.reply.trim().length > 0) { llmCallTurns += 1; }
@@ updateSessionResult() (L746-751 + 落库处)
+  counselorDegradedTurns: number;
+  visitorDegradedTurns: number;
@@ repo.update()
     ...fields,
+    renderFallbackRatio: fields.turnCount > 0 ? fields.renderFallbackTurns / fields.turnCount : null,
     finishedAt: new Date(),
```

**口径定义（写进代码注释，单测钉住）**：

| 列 | 口径 |
|---|---|
| `llm_call_turns` | 访客侧**真调了 LLM** 的轮数 —— 兜底轮（`trace.degraded`）与阻断轮（`reply` 为空）都**不算** |
| `render_fallback_turns` | 访客侧渲染兜底轮数（`trace.degraded`） |
| `render_fallback_ratio` | `render_fallback_turns / turn_count`（**与实体注释里的口径一致**）；`turn_count = 0` → 落 `null` |
| `counselor_degraded_turns` / `visitor_degraded_turns` | 两侧降级**分开**计数；`degraded_turns` 仍是**两侧合计**（口径不变，不影响既有报表） |

**为什么用"回复非空"而不是 token 数判"真调了 LLM"**：token 可能是 0 而调用是真的；反过来兜底轮回复非空但根本没调用。只有"有内容且没降级"才等于真调用。

**为什么 `turn_count = 0` 落 null 而不是 0**：实体注释写明 "NULL = 没记录 …… **不许**当成 0（那等于替历史数据编了一个'当时没问题'的结论）"。没跑起来的场次就是"没测过"。

### 3.3 验证：DB 实查三段对照（同一个库、同一张表）

```sql
SELECT batch_id, total_sessions, total_turns, valid, validity_flags,
       fallback_ratio, llm_call_ratio, render_fallback_turns, llm_call_turns
  FROM ap_practice_batches ORDER BY updated_at DESC LIMIT 3;
```

| 批次 | 来源 | valid | validity_flags | llm_call_ratio | fallback_ratio | llm_call_turns |
|---|---|---|---|---|---|---|
| `verify-route1-2026-11-10-r2` | **P1c 老批次**（修复前） | **0** | `LLM_CALL_RATIO_LOW,FALLBACK_RATIO_UNKNOWN` | 0.0000 | null | **0** |
| `ll--zCvaQpgTEw8GvOO_w` | **本次第一批**（只落了两列） | 0 | `FALLBACK_RATIO_UNKNOWN` | 1.0000 | null | 12 |
| `6aCuNBd01rCzZgkFvRXIY` | **本次第二批**（四列齐） | **1** | **null** | **1.0000** | **0.0000** | 12 |

第二行是第一批的现场：两列修完 → `LLM_CALL_RATIO_LOW` 消失、ratio 变 1.0，但 `FALLBACK_RATIO_UNKNOWN` 还在 —— **正是它把第三列 `render_fallback_ratio` 顶出来的**。第三行是补齐第三列之后：`valid=1`，flags 干净。

**单场明细（新批次 3 场，maxTurns=4）**：

| session | character_slug | status | turn_count | degraded_turns | counselor_deg | visitor_deg | render_fallback_turns | llm_call_turns | render_fallback_ratio |
|---|---|---|---|---|---|---|---|---|---|
| `26BfSC0XGxFqTIOJJFbJK` | `vpt_self_worth_intellectualization_l1` | completed | 4 | 0 | 0 | 0 | 0 | **4** | **0.0000** |
| `3-x8vjCZpiIGpkNCl7t88` | `vpt_intimate_avoidance_l1` | completed | 4 | 0 | 0 | 0 | 0 | **4** | **0.0000** |
| `rmmggHba3uyKW5LPqxOtU` | `vpt_depression_avoidant_l1` | completed | 4 | 0 | 0 | 0 | 0 | **4** | **0.0000** |

### 3.4 单测（8 例全绿）

`test/auto-practice/p1d-render-metrics-persist.spec.ts`（全 mock：TurnEnginePort / CounselorAgentService / repo / gateway 都是替身，不起容器不连 DB）

| # | 用例 | 断言 |
|---|---|---|
| ① | 3 正常轮 + 1 兜底轮 | `llmCallTurns=3` / `renderFallbackTurns=1`，且都不是 `undefined` |
| ② | 阻断轮（来访者没出声） | 不计入 `llmCallTurns` |
| ③ | 口径分离 | 咨询师侧降级计入 `degradedTurns`，不计入 `renderFallbackTurns` |
| ④ | 不是 maxTurns | maxTurns=10 但第 5 轮收尾 → `llmCallTurns=5` |
| ⑤ | 失败路径 | 循环异常 → 两列落 0（不是 `undefined`，也不 throw） |
| ⑥ | **兜底率落库** | 1/4 轮兜底 → `renderFallbackRatio ≈ 0.25` |
| ⑦ | **没跑起来** | `turnCount=0` → `renderFallbackRatio === null`（不是 0） |
| ⑧ | **两侧拆分列** | 咨询师侧 1 + 访客侧 1 → `counselorDegradedTurns=1` / `visitorDegradedTurns=1` / `degradedTurns=2` |

> 每条用例都用 `turnCount` 把"实际跑了多少轮"钉住 —— 替身一旦把 mock 用尽，`engine.turn` 返回 undefined 会抛错，整场落进 failed 路径（两列全 0），断言会**假绿**。

---

## 四、#4 P1・audit 词表补 anxious 三维

### 4.1 根因

`scripts/ops/quality/visitor-quality-audit.ts` 的 `LABEL_LEXICON`（修前 `L120-130`）只有四个**行为标签**（approach / avoid / attack / appease），且是**单文件内联定义**：

1. 词表只覆盖"行为方式"，**没有"依恋动机"维度** —— 任务单要的求证 / 讨好 / 怕被抛弃是**动机层**，四标签装不下；
2. 覆盖率 5.7%（36 场里只有 2 场能打上标签），导致"主导标签命中率"这一栏**根本算不出来**；
3. 词表内联在脚本里 → 脚本末尾是 `await main()`，**单测无法 import**（一 import 就跑整场审计）。

### 4.2 修法

**新建纯模块** `scripts/ops/quality/visitor-quality-lexicon.ts`（无副作用、无 IO、可被单测 import）：

| 导出 | 行 | 内容 |
|---|---|---|
| `BehaviorLabel` | `:16` | 四标签类型 |
| `LABEL_LEXICON` | `:25` | 四标签词表**扩容** |
| `AnxiousChannelHits` | `:44` | 三维度命中结构 |
| `ANXIOUS_CHANNEL_LEXICON` | `:54` | **求证 / 讨好 / 怕被抛弃** 三组词表（新增） |
| `hitsAny` | `:67` | 词表命中判定 |
| `labelOf` | `:78` | 单轮行为标签 |
| `anxiousDimensionsOf` | `:98` | 单轮三维度命中 |
| `isCoveredTurn` | `:112` | 该轮是否被词表覆盖 |

脚本改为 import（`:33`），本地定义删除；新增 **D2(c)** 输出段：anxious 角色 vs 其余角色的三维度命中率 + 并集覆盖率。

**词表怎么标的**（不是拍脑袋写的）：先在有效 36 场（367 条来访者台词）上做 n-gram 词频分析，再补词（`我觉得` / `没什么` / `不想` / `你觉得我` / `万一` / `还行` 等）。**排除了渲染兜底句**（"我不太想…""我先缓一下…"）—— 它们是系统生成的，不算来访者行为，计进去会虚高。

### 4.3 验证（`npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions`，57 份基线逐字稿）

| 指标 | 修前 | 修后 | 门禁 |
|---|---|---|---|
| 四行为标签覆盖率 | 5.7% | **45.0%** | — |
| 四标签 + 三维度并集覆盖率 | — | **46.3%** | ≥15% ✅ |
| **主导标签命中率** | **算不出来**（覆盖率太低） | **17/36 = 47.2%** | ≥70% ❌ |
| D2(c) anxious 角色（11 场 / 108 轮） | — | 求证 **6.5%** / 讨好 **0.0%** / 怕被抛弃 **1.9%** / 任一命中轮占比 8.3% / 有命中场次 7/11 | |
| D2(c) 其余角色（25 场 / 259 轮） | — | 求证 **1.2%** / 讨好 **0.0%** / 怕被抛弃 **0.0%** / 有命中场次 3/25 | |
| D1 / D3 / D5 | 11.1% / 22.2% / 7-7 | **未变**（11.1% / 22.2% / 7-7） | |
| 降级口径 | 混用 | **DB(runner 落库) 57 场 / 回退逐字稿自数 0 场** | |

### 4.4 单测（15 例全绿）

`test/quality/p1d-visitor-quality-lexicon.spec.ts`：三维度词表非空且互不相同、规模下限（四标签 ≥15 / 三维度 ≥10）、代表语料命中、`labelOf`、`isCoveredTurn`、真实语料覆盖率 ≥15%（无数据则 skip）。

### 4.5 诚实结论（**这是本期暴露的新问题**）

覆盖率越过 30% 门禁后，"主导标签命中率"**第一次可算 = 47.2%，低于 70% 门禁**。

**没有为了刷分去调词表拟合数据**。词表是按真实语料标定的，47.2% 说明"四标签 + 三维度"这套分类体系本身不足以给每一轮判出唯一主导标签 —— 这是**指标体系的问题，不是词表的问题**，上报为遗留问题 L1。

---

## 五、#5 P2・degraded 口径对齐

### 5.1 根因

P1c 的 "4 vs 1" 之谜：DB `ap_practice_sessions.degraded_turns` = **咨询师侧 + 访客侧两侧合计**，而 audit 自己数 traces 只数到访客侧 —— 同一件事两个口径。

### 5.2 修法

`scripts/ops/quality/visitor-quality-audit.ts`：

- 新增 `loadDegradedTurns()`（`:238`）：从 DB 读每场的 `degraded_turns`；读失败 → `console.warn` 并**回退**逐字稿自数（`:257`）
- `auditSession()` 新增 `dbDegradedTurns` 入参（`:334`），落 `degradedFromDb` 标记（`:426`）
- `main()` 先取 DB 口径（`:471-481`），输出显式打印**两者的场次数**（`:495`）：

```
降级口径: DB(runner 落库) 57 场 / 回退逐字稿自数 0 场  (口径来源不同, 数字不可混用)
```

### 5.3 验证

- 基线复现：57 场全部从 DB 取到（DB 口径覆盖 57/57），数字与修前逐字一致；
- 新跑的 6 场：DB 口径 6/6，自数 0 —— 两者不打架；
- 输出里**同时印两个来源的场次数**，避免静默混用。

> 顺带收益：#2 落库后 DB 口径才是可信来源 —— 之前 DB 里那些 `degraded_turns` 也是"两侧合计"，现在 audit 直接用它，不再自数。

---

## 六、#6 P1・admin 请求日志 `Authorization` 脱敏

### 6.1 根因

`src/config/logger.config.ts` 的 `loggerOptions.pinoHttp`（nestjs-pino / pino-http）**自动把整个 req/res 序列化进日志**（`"headers":{...}`），basic auth 的 `Authorization: Basic <base64>` 原样落盘 —— base64 可直接还原出运维账号口令。

### 6.2 修法

走 pino 自带的 **`redact`**（写入前路径级打码），不自写序列化器：

```ts
// src/config/logger.config.ts
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["proxy-authorization"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
] as const;
export const LOG_REDACT_CENSOR = '[REDACTED]';
// loggerOptions.pinoHttp.redact = { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR }
```

**为什么用 redact 而不是自己写序列化器**：打码发生在**写入前**，所有走该 logger 的通道（stdout / stderr / Sentry）自动生效，不依赖"谁在打这条日志"自觉。

### 6.3 验证

**单测（6 例全绿）** `test/shared/p1d-log-redaction.spec.ts`：真起一个 pino 实例打日志，断言 `Authorization` / `Cookie` / `Set-Cookie` 全被打码、非凭据字段（`user-agent` / `host`）保留、且 `redact` 配置**真的接到了 `pinoHttp`**（不是导出了常量但没接线）。

**3100 实例日志实测**（打的是带 Basic Auth 的真实 admin 请求）：

```json
"headers":{"authorization":"[REDACTED]","user-agent":"Mozilla/5.0 …","host":"127.0.0.1:3100"}
"res":{"statusCode":401,"headers":{…,"set-cookie":"[REDACTED]"}}
```

凭据原样不再出现 ✅

---

## 七、#7 P2・信息增量判据补"深度"约束

### 7.1 根因

`src/engine-adapters/rendering/turn-render-orchestrator.ts` 的 `INFO_INCREMENT_INSTRUCTION`（`:1710`）只要求"带出一个之前没提过的新细节" —— **"把事实换个说法再讲一遍"也算新细节**，于是模型学会**换着法子复述**。P1c 实测：recounting 53.9% → 80.9%、表层停留 85.2% → 100%（停滞消了，深度没来，能量从"阻抗"挪到了"复述"）。

### 7.2 修法（**只改外层 prompt，不碰内核**）

```diff
 const INFO_INCREMENT_INSTRUCTION =
   '每说两三轮，要带出一个之前没提过的新细节：一个具体场景、一句当时的感受、或一个没说过的念头；不要只把同一件事翻来覆去地说。' +
+  '而且这个新细节要往深处走 —— 要么指向你当下的感受（当时其实挺难受／有点怕），要么是你自己才想明白的一点（现在我才发现……）；只是把事情重新讲一遍不算推进。';
```

内核策略 / 阈值 / 判据**一个字没动**（`src/engine-core/**` diff 为空）。

### 7.3 验证

**单测（4 例全绿）** `test/engine-adapters/wp-j-p1d-info-increment-depth.spec.ts`：深度约束句进了 prompt、点明"感受"与"才发现"两个方向、堵住"复述"、且**原句逐字保留**（零回归）。

**连带修正**：`test/engine-adapters/wp7-turn-render.spec.ts:765` 把"这一轮怎么说"块**逐字 gold** 钉死了（`toEqual([...4 行])`）—— 渲染层文案变了它必然先红。已同步更新为新文案，并加注释说明"变的是后半句，前半句一字未动"。**这是预期变更引起的 gold 更新，不是行为回归**（该文件改前 42 例中 41 例仍绿）。

---

## 八、改动文件清单

```
M src/engine-adapters/rendering/turn-render-orchestrator.ts      #1 透传+注入日志 / #7 深度约束
M src/engine-adapters/wiring/engine-turn.service.ts              #1 open() options + 登记
M src/engine-adapters/wiring/engine-stream-backend.adapter.ts     #1 openKernelSession 登记 + attachmentStyleOption
M src/admin-debug/debug-session.service.ts                       #1 createSession / restore 两处登记
M src/auto-practice/practice-runner.service.ts                   #2 四列落库 + 两侧拆分计数
M src/config/logger.config.ts                                    #6 LOG_REDACT_PATHS + pino redact
M scripts/ops/quality/visitor-quality-audit.ts                   #4/#5 词表外置 + DB 降级口径 + D2(c)
M test/engine-adapters/wp7-turn-render.spec.ts                    #7 gold 同步（预期变更）
M src/quality/quality-annotation.service.ts                      # 无关: eslint import/order 自动修复（1 行 import 换序）
A scripts/ops/quality/visitor-quality-lexicon.ts                 #4 纯模块（词表 + 判定函数）
A test/engine-adapters/wp-j-p1d-attachment-style-wiring.spec.ts  #1 10 例
A test/engine-adapters/wp-j-p1d-info-increment-depth.spec.ts     #7 4 例
A test/auto-practice/p1d-render-metrics-persist.spec.ts          #2 8 例
A test/shared/p1d-log-redaction.spec.ts                           #6 6 例
A test/quality/p1d-visitor-quality-lexicon.spec.ts              #4 15 例
A docs/worklog/completed/phase2.5/wp-j-p1d-route1-wiring-fixes-task-2026-11-10.md
A docs/worklog/completed/phase2.5/wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md  (本文件)
```

> `scripts/ops/quality/enqueue-p4-batch.ts` 与 `seed-verbal-voice.ts` **不是本次产物**（大炮的验收/重跑方案 §3.2/§4 在并行推进），本次未触碰。

**engine-core 零改动**：`git diff --stat HEAD -- src/engine-core` → 空 ✅

---

## 九、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| Lint | `npx eslint`（6 个 src + 5 个 test 文件） | **0 error** ✅ |
| 定向单测 | `npx vitest run test/auto-practice test/quality test/shared/p1d-log-redaction.spec.ts test/engine-adapters/wp-j-p1d-*.spec.ts` | **15 files / 148 tests passed** ✅ |
| 自动对练 | `npx vitest run test/auto-practice` | **7 files / 78 tests passed** ✅ |
| 全量回归 | `npx vitest run` | **4 failed / 163 passed / 5 skipped（172 文件）**；**4 failed / 2706 passed / 19 skipped（2729 例）** |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

**全量回归的 4 个失败 = 既有豁免清单**（与本次无关，任务单 §1.2 已列明"不要让 MiniMax 顺手修"）：

| 失败用例 | 归属 |
|---|---|
| `test/admin-debug/debug-session-persistence.spec.ts` → ② 保留最近 50 个会话 > 超出 500 个 | 既有（50 vs 500 断言过期） |
| `test/admin-debug/wp26-admin-role-guard.spec.ts` → ⑥ 4 个端点全部覆盖 | 既有（`characters` 路由重复注册） |
| `test/admin-debug/wp30-admin-real-api.spec.ts` → ⑤ 4 个新端点全部继承 AdminRoleGuard | 既有（同上） |
| `test/admin-debug/wp31-cost-board.spec.ts` → ⑤ 守卫继承 | 既有（同上） |

> 对照：本期改动前跑过一次全量是 **5 failed**（多出来的就是 `wp7-turn-render` 的 gold 失配，已随 §7.3 修正），修完回到 **4 failed** 基线；通过用例 2702 → **2706**（新增 3 例）。

---

## 十、临时实例纪律

| 项 | 状态 |
|---|---|
| 3100 临时实例 | ✅ **已关闭**（`listeners_3100 = 0`，PID 31712 已终止） |
| 3000 端口用户服务 | ✅ **全程未动**（实测期间该端口无监听，从未连接、从未重启） |
| `quality_annotation` 表 | ✅ **未碰**（只读不写；本次所有写入只发生在 `ap_practice_sessions` / `ap_practice_batches`） |
| 逐字稿 | 6 份新跑的已归档到 `data/archives/debug-sessions-verify-p1d-2026-11-10/`；`data/debug-sessions/` **恢复成 57 份基线** ✅ |
| 临时文件 | 全部删除（`bin/tmp-p1d-*.ts` / `.tmp-*.log` / `.tmp-*.ps1` 等）✅ |
| git | **未 commit / 未 push** ✅ |

---

## 十一、遗留问题（本期**没修**的，按严重度排）

| # | 严重度 | 问题 | 性质 |
|---|---|---|---|
| **L1** | P1 | **主导标签命中率 47.2% < 70% 门禁**（#4 覆盖率提上去后第一次可算） | 指标体系问题：四标签+三维度不足以给每轮判唯一主导标签。**没有为了刷分去调词表拟合数据** |
| **L2** | P1 | **`counterConsistent` 判据用的是两侧合计的 `degraded_turns` vs `turn_count`** —— 两侧同轮降级时 `degraded_turns` 可达 2×轮数 → **误报 `COUNTER_INCONSISTENT`** | 既有缺陷（`wp-h-wave2-3-batch-observability.spec.ts:248` 显式钉住了现语义）。本期**没改**：改门禁语义属于协议变更，按 AGENTS.md §2.5 需大炮确认。正解：判据改用本次新写的 `counselor_degraded_turns` / `visitor_degraded_turns`（每侧每轮最多 +1） |
| **L3** | P2 | **`scripts/` 不在 `tsconfig.json` 的 `include` 里**（include 只有 `typings/global.d.ts` / `src/**/*` / `test/**/*` / `bin/**/*`） | audit 脚本与新模块**不走项目 tsc**，eslint 对该目录报 "not found by the project service"（既有状况）。只能靠 `npx tsx` 运行期验证 + 新单测 import 覆盖 |
| **L4** | P2 | **讨好维度命中率恒 0.0%**（基线与新跑都是） | 词表可能仍未覆盖真实说法，或模型确实没在讨好 —— 需要真实语料标定后再判 |
| **L5** | P2 | `render_fallback_ratio` 是**派生列**（可由 counts 反推） | 本次与 counts **同源同一次写入**，无漂移风险；但若将来有人只改 counts 不重算 ratio 会漂 |
| **L6** | — | **#3 上游 Token Plan 429 限流** | 账号问题，按大炮指示**不改代码**；重跑时批次规模 + maxTurns 要一起控 |
| **L7** | — | **正式重跑（16 场，`batch_id=verify-route1-p1d-2026-11-10`，maxTurns=12）未执行** | 按验收方案 §3，是**交付后**的下一步。本期的 6 场小样本（maxTurns=4）**不构成"方向对不对"的结论** |
| **L8** | — | `verbal_voice` 8 个角色文案仍是 NULL | 按验收方案 §4，重跑 PASS 后再落库 |

### 附：本期新数据（**样本极小，仅作方向参考，不作结论**）

6 场新对练（2 anxious 角色 × 2 批 + avoidant 对照 × 2 批，maxTurns=4）跑 audit：

| 指标 | 57 场基线 | 6 场新跑（接线后） |
|---|---|---|
| anxious 角色求证命中率 | 6.5% | **37.5%** |
| anxious 角色怕被抛弃命中率 | 1.9% | 6.3% |
| anxious 任一命中轮占比 | 8.3% | **43.8%** |
| 其余角色（对照）任一命中轮占比 | 1.2% | **0.0%** |

方向向好且对照组干净，但 **6 场 / 24 轮**的样本量撑不起结论 —— 正式判读见验收方案 §3.4 的对比表。

---

## 十二、commit message

```
feat(wp-j-p1d): 修路线1 遗留 #1/#2/#4/#5/#6/#7 —— attachmentStyle 五处接线 + 门禁四列落库 + 词表三维 + 日志脱敏 + 深度约束
```
