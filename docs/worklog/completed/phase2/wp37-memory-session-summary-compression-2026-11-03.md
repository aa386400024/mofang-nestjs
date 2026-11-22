# WP37：记忆会话级摘要压缩（滚动摘要）

> 状态: ✅ 已交付（2026-11-03）→ [`engine-wp37-rolling-session-summary-implementation-2026-11-03.md`](engine-wp37-rolling-session-summary-implementation-2026-11-03.md)
> 优先级: 🟡 P1（专业能力主线）
> 预估: 中
> 依赖: WP2 记忆系统（已交付 ✅）
> 红线: **engine-core 预批准例外**

---

## 1. 背景

现在 working memory 的逻辑（`in-memory-engine-session.ts:376`）：
```typescript
runtime.workingWindow = trimWorkingWindow([...runtime.workingWindow, userText], 8);
```

第 9 轮开始，前面的对话被 `trimWorkingWindow` 直接丢掉——用户聊了 30 轮，来访完全不记得第 1-22 轮聊过什么。

**关键发现**：记忆契约（`memory.store.ts:42-48`）里早就定义了三级记忆：
- `WORKING` — 最近 8 轮（已实现）
- `SHORT_TERM` — "单会话完整摘要，伴随会话全程"（**契约预留了，但从来没人实现**）
- `LONG_TERM` — 跨会话核心事实（已实现）

`MemorySource.SUMMARY`（`memory.store.ts:56`）也早就定义了："来自模型生成的会话摘要"。

本 WP 就是把这个预留的口子填上——当对话挤出工作窗口时，异步压缩成摘要，存成 SHORT_TERM 记忆条目。

---

## 2. 任务目标

当对话轮次挤出 8 轮工作窗口时，把被挤出的轮次收集起来，异步调用 LLM 压缩成一段会话摘要，存为 SHORT_TERM 层级的 MemoryEntry。召回时，摘要和最近 8 轮原始对话一起可用。

---

## 3. 具体改动（全部基于真实代码盘查）

### 3.1 engine-core：提供"挤出回调"钩子

**文件**：`src/engine-core/in-memory/in-memory-engine-session.ts`

现在第 376 行：
```typescript
runtime.workingWindow = trimWorkingWindow([...runtime.workingWindow, userText], WORKING_MEMORY_WINDOW_TURNS);
```

改成：trim 之前先算"被挤出了哪些轮次"，如果有被挤出的，调一个回调把这些轮次交出去。

**回调签名**（在构造函数注入，跟 personalityModulatorConfig / allianceConfig / sessionDecayConfig 同款范式）：

```typescript
/**
 * 工作窗口挤出回调 —— 当对话轮次被 trimWorkingWindow 挤出窗口时触发.
 * engine-core 不调 LLM（边界：零网络 / 零 prompt），由适配层接这个回调做摘要.
 */
onWorkingWindowOverflow?: (pushedOut: readonly string[]) => void;
```

**逻辑**：
- trim 前：`const oldWindow = runtime.workingWindow`
- trim 后：`const newWindow = trimWorkingWindow([...oldWindow, userText], WORKING_MEMORY_WINDOW_TURNS)`
- 被挤出的 = `oldWindow.length + 1 - newWindow.length` 条
- 如果有被挤出的，调 `onWorkingWindowOverflow?.(pushedOutLines)`

### 3.2 engine-core：新增摘要记忆条目类型

**文件**：`src/engine-core/domain/ports/memory.store.ts`

这个文件已经定义了 `MemoryTier.SHORT_TERM` 和 `MemorySource.SUMMARY`，**不需要改**——契约早就留好了。

### 3.3 适配层：接回调，调 LLM 生成摘要

**新文件**：`src/engine-adapters/memory/session-summary.service.ts`

职责：
1. 实现 `onWorkingWindowOverflow` 回调
2. 把被挤出的轮次攒起来（攒够 N 轮再生成，不要每挤出一轮就调一次 LLM）
3. 调 LLM 生成摘要（复用现有的 `CounselorLlmJsonClient` 或文本生成接口）
4. 把摘要写回 memory store：
   - `tier: MemoryTier.SHORT_TERM`
   - `source: MemorySource.SUMMARY`
   - `content: "本场会话已讨论：..."`
   - `importance: 0.5`（中等，不是最关键的）
   - `ttlMs: null`（会话全程有效）

**攒批策略**：每挤出 3 轮生成一次摘要（种子值，env 可配）。

### 3.4 适配层：会话结束时生成最终摘要

**文件**：`src/engine-adapters/memory/session-summary.service.ts`（同上）

会话结束时（用户断开 / 超时），把当前工作窗口里剩下的轮次也压缩进摘要，生成一份"本场会话完整摘要"。这份摘要的 importance 调高（0.7），下次 resume 时可以直接召回。

### 3.5 配置

**文件**：`.env.example`
新增：
- `SESSION_SUMMARY_BATCH_SIZE=3`（每攒够 3 轮生成一次摘要）
- `SESSION_SUMMARY_FINAL_IMPORTANCE=0.7`（会话结束最终摘要的重要度）

（留空 = 继承内核默认值）

**文件**：`typings/global.d.ts`
显式声明 2 个 `ProcessEnv` 键。

### 3.6 barrel 导出

**文件**：`src/engine-core/index.ts`
追加 `onWorkingWindowOverflow` 相关类型（如果有的话）。

---

## 4. 红线检查

- ✅ **预批准改 engine-core**（已在 WP 清单登记为例外）
- ✅ 改完必须通过 `boundary.spec.ts` 的 11 条断言（零 NestJS / 零网络 / 零 prompt / 零 process.env）
- ✅ engine-core 只提供回调钩子，不调 LLM（边界守住）
- ✅ 摘要生成在适配层（有 LLM 访问权的地方）
- ❌ 不碰前端代码
- ❌ 不碰 admin-dashboard

---

## 5. 验收标准

1. **单元测试**：
   - 工作窗口从 8 轮涨到 9 轮时，第 1 轮被挤出，回调被触发一次，参数是被挤出的那 1 轮
   - 工作窗口从 8 轮涨到 10 轮时，第 1、2 轮被挤出，回调被触发一次，参数是被挤出的那 2 轮
   - 工作窗口不足 8 轮时，回调不被触发
2. **回归测试**：WP2 / WP12 / WP34 / WP42 / WP36 既有用例全部绿（无溢出时行为不变）
3. **闸门**：eslint 0 error / tsc 0 错 / vitest 全绿

---

## 6. 交付闸门

```powershell
npx eslint "src/**/*.ts"                    # → 0 error
npx tsc -p tsconfig.build.json --noEmit     # → 0 error
npx vitest run                              # → 全绿（既有 1348 例 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core     # → 列出改了哪些文件（预批准例外，不是空）
```

---

## 7. 交付格式

按 `team/conventions.md` §2 写交付记录：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（攒批策略为什么是 3、摘要怎么写回 memory store）
3. 闸门数字

完成后把本任务单 + 交付记录从 `pending/` 移到 `completed/phase2/`。

---

## 8. 回写

交付完更新 [`phase2-wp-list-2026-11-03.md`](../../pending/phase2-wp-list-2026-11-03.md) 里 WP37 的状态。

---

## 9. 交付后补记（2026-11-03）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录：

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §3.1 回调签名 `(pushedOut: readonly string[]) => void` | 改成**事件对象** `WorkingWindowOverflowEvent`（`tenantId` / `sessionId` / `visitorId` / `pushedOut`） | 适配层要写 `MemoryEntry`，契约强制归属三件套；只给文本写不出合法条目，也不防"跨租户串摘要" |
| 2 | §3.3 新文件 `src/engine-adapters/memory/session-summary.service.ts` | 落在既有 **`persistence/`**：`rolling-session-summary.service.ts` + `rolling-summary.generator.ts` | `engine-adapters` 下**没有 `memory/` 目录**；记忆/摘要代码全在 `persistence/`（WP12 同款），新开第二个家 = 破坏单一真相源 |
| 3 | §3.3 复用 `CounselorLlmJsonClient` | 改用引擎层既有链 `LlmRouterService` + WP12 的 `parseSummaryResponse` | `CounselorLlmJsonClient` 在 `src/counselor/`（业务层），适配层依赖它 = 依赖倒置被破坏；WP12 摘要器是同款先例 |
| 4 | §3.4 会话结束最终摘要 importance **0.7** | **不重复实现** WP12 已有的收尾摘要；改为把其 importance 做成 env 可配（`SESSION_SUMMARY_FINAL_IMPORTANCE`，缺省**仍 0.9**） | WP12 已做逐字稿→摘要→晋升长时记忆；再压一份 = 两个真相源。0.7 无出处不采纳（不发明数字），0.9 有明确理由（衰减后跨会话召回门槛） |
| 5 | §5 验收#2：8→10 轮「回调被触发**一次**，参数是那 2 轮」 | 真实路径是**逐轮追加** → 回调触发**两次**、各 1 条；「一次挤 2 条」的形状由纯函数 `overflowedWorkingWindowLines` 单独覆盖并单测 | 任务单的形状只在"窗口被外部塞进超额条目"时出现；把**形状**交给纯函数、把**触发语义**按真实路径分别钉死，不是改验收凑数 |
| 6 | 全文**没提摘要怎么进 prompt** | **新增这一环**：`RenderSpec.sessionSummary` 独立字段 → system prompt"内在状态"块内一行 `- 此前我们聊过（背景，不要说出口）：…`；无摘要时 prompt **逐字不变** | 只写不读 = 功能空转。不塞进 `recall`（独立字段，避免"recall 只渲染一部分"的陷阱） |
| 7 | §3.6 只说 barrel 追加类型 | **另改** `test/engine-core/boundary.spec.ts` 断言⑥ 白名单 + **另加** `wp25-env-example-coverage.spec.ts` 断言③f | 断言⑥ 是**双向白名单**，不更新就红（照 WP42 / WP36 先例）；env 断言照 ③b/③c/③d/③e 先例 |
| 8 | §3.5 只列 2 个 env 键 | 实际 **3 个**（多 `SESSION_SUMMARY_ROLLING_IMPORTANCE`） | 滚动摘要与最终摘要是两条独立写入路径，各需一个重要度；模型名**共用** `MEMORY_SUMMARY_MODEL`（不新开真相源） |

> 另：本期**没做**的（摘要只有咨询师侧、`spec.recall` 不进 prompt 等）已在交付记录 §4 逐条留档，并挂进 Phase2 WP 清单的 **WP55 / WP56**。

---

_创建：2026-11-03_
