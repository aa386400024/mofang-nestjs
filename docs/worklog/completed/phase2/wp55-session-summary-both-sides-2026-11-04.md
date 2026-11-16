# WP55：会话摘要补齐来访者侧（滚动摘要从「咨询侧纪要」→「两侧对话纪要」）

> 状态: ✅ 已交付（2026-11-04）→ [`engine-wp55-rolling-summary-both-sides-implementation-2026-11-04.md`](engine-wp55-rolling-summary-both-sides-implementation-2026-11-04.md)
> 优先级: 🟡 P1（专业能力主线）
> 预估: 中
> 依赖: WP37 滚动摘要（已交付 ✅）
> 红线: ❌ 不改 engine-core（纯适配层改动）

---

## 1. 背景与问题

WP37 交付了滚动摘要：工作窗口（最近 8 轮咨询师发言）挤出旧轮次时，攒批异步压成摘要，存 SHORT_TERM 记忆并进渲染 prompt。

**但现在的摘要是「咨询侧纪要」，不是「对话纪要」**：

- 内核 `WorkingWindowOverflowEvent.pushedOut` 只带**咨询师原话**——内核不渲染，拿不到来访者的话（见 `engine-core/domain/engine-session.types.ts:113-115` 注释）
- 生成器 `RollingSummaryInput.newLines` 只有咨询师发言，每行标 `"咨询师: xxx"`（见 `engine-adapters/persistence/rolling-summary.generator.ts:151`）
- 系统提示词明确写「来访者的话没有出现在这里」（见 `rolling-summary.generator.ts:69`）

**后果**：摘要里只有「咨询师聊了什么」，没有「来访者说了什么」。模型拿到摘要后，能想起"咨询师之前问过睡眠问题"，但想不起"来访者当时说自己凌晨 3 点才睡"——摘要丢失了来访者侧的关键信息。

**来访者文本在哪？** 在门面（`TurnRenderOrchestrator`）的 `histories: Map<string, RenderContextTurn[]>` 里——两侧对话都存，截断到 `MAX_HISTORY_TURNS = WORKING_MEMORY_WINDOW_TURNS * 2 = 16` 半轮（见 `turn-render-orchestrator.ts:310, 322, 771`）。

---

## 2. 任务目标

把门面历史缓冲里**被截断挤掉的来访者文本**也收集起来，与内核溢出回调给的咨询师文本**配对**，一起交给摘要生成器。摘要从"咨询侧纪要"升级为"两侧对话纪要"。

**顺手修一个 WP37 遗留的内存泄漏**：会话关闭时没调 `rollingSummary.forgetSession`，每场会话的滚动摘要状态留在内存里不释放。

**不发明临床数字，不改内核，不动 WP12 最终摘要路径。**

---

## 3. 时序对齐（先搞清楚配对关系，再写代码）

### 3.1 一轮对话的完整时序（正常轮次）

```
第 N 轮（N > 8）：

① session.turn(handleId, {userText: "第N轮咨询师话"})
   ├─ 内核 workingWindow 已有 8 条（第 1~8 轮咨询师）
   ├─ 加第 N 条 → trimWorkingWindow → 挤掉第 (N-8) 条
   └─ onWorkingWindowOverflow 回调触发
      └─ RollingSessionSummaryService.recordOverflow(event)
         └─ counselorPending.push(第(N-8)轮咨询师文本)
         └─ 此时 counselorPending.length += 1
         └─ maybeFlush: min(counselorPending, visitorPending) < batchSize → 不触发
            （visitor 还没到，因为 visitor 是门面渲染后才有的）

② resolveDisposal（学员侧处置闸门）

③ assemble spec + renderSafely / streamSafely（LLM 渲染来访者回复）

④ settleTurn(handleId, counselorText, rendered)
   ├─ history = histories.get(handleId) → 已有 16 半轮（第 1~8 轮的 counselor + visitor）
   ├─ next = [...history, {counselor: "第N轮咨询师话"}, {visitor: "第N轮来访者回复"}] → 18 半轮
   └─ setHistory(handleId, next)
      ├─ overflowCount = 18 - 16 = 2
      ├─ dropped = next.slice(0, 2) = [第(N-8)轮counselor, 第(N-8)轮visitor]
      ├─ droppedVisitorTexts = [第(N-8)轮visitor文本]
      └─ RollingSessionSummaryService.recordVisitorOverflow(tenantId, sessionId, visitorId, droppedVisitorTexts)
         └─ visitorPending.push(第(N-8)轮visitor文本)
         └─ 此时 visitorPending.length += 1
         └─ maybeFlush: min(counselorPending, visitorPending) >= batchSize → 触发压缩！
            （压缩是异步 fire-and-forget，不阻塞主链路）
```

**关键结论**：
- 内核回调（counselor）**先到**，门面截断（visitor）**后到**
- 同一轮的问答对，counselor 在步骤①入队，visitor 在步骤④入队
- 压缩**一定是在 visitor 到达后才触发**（因为 visitor 总是后到，counselor 先到但凑不齐两边）

### 3.2 两种"只有 counselor 没有 visitor"的边界情况

| 场景 | 为什么 counselor 有但 visitor 没有 |
|---|---|
| **阻断轮次**（`disposal.action === 'block'`） | session.turn 内部还是会 trim workingWindow → overflow 回调触发（counselor 入队）；但门面走 `settleBlockedTurn`，只 push counselor 不 push visitor（行 726-729），setHistory 截断时被挤掉的条目里**没有 visitor** → recordVisitorOverflow 不触发 |
| **渲染降级轮次** | settleTurn 里 `if (!rendered.degraded)` 才 push visitor（行 643-645）；降级轮次只 push counselor → 同上 |

**处理**：取 `min(counselorPending.length, visitorPending.length)` 作为本次压缩的对数，**多余的 counselor 留在队列里等下一批**。这不是 bug——那几轮的来访者本来就没说话（阻断/降级），摘要里本来就不该有它们的 visitor 文本。

---

## 4. 具体改动（全部基于真实代码盘查）

### 4.1 门面：截断 histories 时捕获被挤掉的来访者文本

**文件**：`src/engine-adapters/rendering/turn-render-orchestrator.ts`

现在 `setHistory` 是：
```typescript
// 行 770-772
private setHistory(handleId: string, turns: readonly RenderContextTurn[]): void {
  this.histories.set(handleId, turns.slice(-MAX_HISTORY_TURNS));
}
```

改成：截断前先算溢出数量，从被挤掉的条目中筛出 `role === 'visitor'` 的文本，交给滚动摘要服务。

**新增逻辑**：
```typescript
private setHistory(handleId: string, turns: readonly RenderContextTurn[]): void {
  const overflowCount = turns.length - MAX_HISTORY_TURNS;
  if (overflowCount > 0) {
    const dropped = turns.slice(0, overflowCount);
    const droppedVisitorTexts = dropped
      .filter((t) => t.role === 'visitor')
      .map((t) => t.text);
    if (droppedVisitorTexts.length > 0 && this.deps.rollingSummary) {
      const context = this.resolveContext(handleId);
      if (context) {
        try {
          this.deps.rollingSummary.recordVisitorOverflow(
            context.tenantId,
            context.sessionId,
            context.visitorId,
            droppedVisitorTexts,
          );
        } catch {
          // 摘要写失败是增强缺失, 不是渲染失败 (与 resolveSessionSummary 同款理由)
        }
      }
    }
  }
  this.histories.set(handleId, turns.slice(-MAX_HISTORY_TURNS));
}
```

**为什么放 setHistory 里**：截断逻辑只有这一处，放这里 = 所有写 histories 的路径（正常 `settleTurn` + 阻断 `settleBlockedTurn`）都自动覆盖，不用每处单独调。

**边界覆盖**：
- 正常轮次：被挤掉的是一对问答 → visitor 文本被收集 ✅
- 阻断轮次（`settleBlockedTurn`）：只 push counselor → 被挤掉的条目里没有 visitor → `droppedVisitorTexts` 为空数组 → 不调 recordVisitorOverflow ✅
- 渲染降级轮次：同阻断轮次 ✅

### 4.2 滚动摘要端口：加写方法

**文件**：`src/engine-adapters/persistence/rolling-session-summary.service.ts`

现在 `RollingSummaryPort` 只有读方法：
```typescript
// 行 74-83
export interface RollingSummaryPort {
  latestSummary(tenantId: string, sessionId: string): string | undefined;
}
```

加一个写方法（**带 visitorId**，因为门面的 `TurnSessionContext` 本来就有，见 `turn-render-orchestrator.ts:88`）：
```typescript
export interface RollingSummaryPort {
  latestSummary(tenantId: string, sessionId: string): string | undefined;
  /**
   * 记录门面历史缓冲被截断挤掉的来访者文本 (WP55).
   *
   * 与内核的 onWorkingWindowOverflow (给咨询师文本) 配对:
   * 内核回调先到 (session.turn 内部), 门面截断后到 (settleTurn 内).
   * 两者攒在同一批里, 一起压摘要.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @param visitorId 来访者 id (首次创建状态时填入; 状态已存在则忽略, 以第一次的为准)
   * @param visitorTexts 被挤掉的来访者文本 (按时间正序)
   */
  recordVisitorOverflow(
    tenantId: string,
    sessionId: string,
    visitorId: string,
    visitorTexts: readonly string[],
  ): void;
}
```

### 4.3 滚动摘要服务：双队列攒批 + 配对

**文件**：`src/engine-adapters/persistence/rolling-session-summary.service.ts`

**当前状态结构**（行 108-120）：
```typescript
interface SessionRollingState {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  pending: string[];          // ← 现在只有咨询师文本
  summary?: string;
  flushing: boolean;
  flushRequested: boolean;
}
```

**改成**：
```typescript
interface SessionRollingState {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  /** 待压的咨询师文本 (来自内核 onWorkingWindowOverflow 回调). */
  counselorPending: string[];
  /** 待压的来访者文本 (来自门面 histories 截断). */
  visitorPending: string[];
  summary?: string;
  flushing: boolean;
  flushRequested: boolean;
}
```

**`recordOverflow` 改造**：从 `state.pending.push(...)` 改成 `state.counselorPending.push(...)`，队列上限检查同理改到 `counselorPending`。

**`stateOf` 重构**：现在 `stateOf(event)` 用完整 event 创建状态。改成两个方法：
```typescript
/** 内核回调用: 完整 event 创建状态 (含 visitorId). */
private stateOf(event: WorkingWindowOverflowEvent): SessionRollingState { ... }

/** 门面截断用: 只有 tenant/session, visitorId 传入或从已有状态取. */
private stateOfByKey(tenantId: string, sessionId: string, visitorId: string): SessionRollingState {
  const key = sessionKey(tenantId, sessionId);
  const existing = this.states.get(key);
  if (existing) return existing;
  // 正常路径下这里不会走到: visitor 总是比 counselor 后到, 状态已由 recordOverflow 创建.
  // 兜底: 万一先到了 (比如 resume 会话的第一论就溢出), 就用传入的 visitorId 创建.
  const created: SessionRollingState = {
    tenantId, sessionId, visitorId,
    counselorPending: [], visitorPending: [],
    flushing: false, flushRequested: false,
  };
  this.states.set(key, created);
  return created;
}
```

**新增 `recordVisitorOverflow` 方法**：
```typescript
recordVisitorOverflow(
  tenantId: string,
  sessionId: string,
  visitorId: string,
  visitorTexts: readonly string[],
): void {
  try {
    const state = this.stateOfByKey(tenantId, sessionId, visitorId);
    state.visitorPending.push(...visitorTexts);
    // visitor 队列上限 (与 counselor 同口径: 3 × batchSize, 超限丢最旧)
    const limit = this.pendingLimit;
    if (state.visitorPending.length > limit) {
      state.visitorPending.splice(0, state.visitorPending.length - limit);
    }
    this.maybeFlush(state);
  } catch (error) {
    this.logger.warn(`[rolling-summary] 记录来访者溢出失败 (已忽略): ${messageOf(error)}`);
  }
}
```

**攒批触发条件改造**：
```typescript
private maybeFlush(state: SessionRollingState): void {
  if (state.flushing) {
    state.flushRequested = true;
    return;
  }
  // 两边都达到 batchSize 才压 (取较小值, 多余的留队列等下一批).
  // 为什么取 min 而不是等齐: 阻断/降级轮次的 visitor 本来就没有,
  //   死等 visitor 齐 = 那批 counselor 永远压不进去.
  const minLen = Math.min(state.counselorPending.length, state.visitorPending.length);
  if (minLen < this.batchSize) return;
  state.flushing = true;
  void this.flush(state).finally(() => {
    state.flushing = false;
    if (state.flushRequested) {
      state.flushRequested = false;
      this.maybeFlush(state);
    }
  });
}
```

**flush 改造**：
```typescript
private async flush(state: SessionRollingState): Promise<void> {
  if (!this.generator) {
    // 没装配生成器 → 清空两个队列 (别让内存白涨).
    state.counselorPending = [];
    state.visitorPending = [];
    return;
  }
  // 取两边各自前 N 条 (一一配对, N = min(count, batchSize)).
  const count = Math.min(
    state.counselorPending.length,
    state.visitorPending.length,
    this.batchSize,
  );
  if (count === 0) return;
  const counselorBatch = state.counselorPending.splice(0, count);
  const visitorBatch = state.visitorPending.splice(0, count);

  let summary: string;
  try {
    summary = await this.generator.generate({
      ...(state.summary ? { previousSummary: state.summary } : {}),
      counselorLines: counselorBatch,
      visitorLines: visitorBatch,
    });
  } catch (error) {
    // 失败: 两边都放回队列 (内容不丢, 下一批连着一起压).
    state.counselorPending.unshift(...counselorBatch);
    state.visitorPending.unshift(...visitorBatch);
    this.logger.warn(`[rolling-summary] 摘要生成失败, 本批 ${count} 对留待下次 session=${state.sessionId}: ${messageOf(error)}`);
    return;
  }

  const content = summary.trim();
  if (content.length === 0) {
    state.counselorPending.unshift(...counselorBatch);
    state.visitorPending.unshift(...visitorBatch);
    this.logger.warn(`[rolling-summary] 摘要为空, 本批留待下次 session=${state.sessionId}`);
    return;
  }

  // 写记忆失败不阻断 (摘要仍然缓存, 本场对话还能用).
  try {
    const entry: MemoryEntry = {
      tenantId: state.tenantId,
      id: `rs-${this.makeId()}`,
      sessionId: state.sessionId,
      tier: MemoryTier.SHORT_TERM,
      source: MemorySource.SUMMARY,
      content,
      importance: this.importance,
      occurredAt: this.now(),
      ttlMs: null,
      visitorId: state.visitorId,
    };
    await this.memories.remember(entry);
  } catch (error) {
    this.logger.warn(`[rolling-summary] 摘要写入记忆仓储失败 session=${state.sessionId}: ${messageOf(error)}`);
  }

  state.summary = content;
  this.logger.log(`[rolling-summary] 摘要已更新 session=${state.sessionId} batch=${count}对 chars=${content.length}`);
}
```

### 4.4 顺手修：会话关闭时清理滚动摘要状态（WP37 遗留泄漏）

**问题**：`engine-turn.service.ts:close()`（行 155-163）现在只调了：
```typescript
this.orchestrator.forgetSession(handleId);   // 删门面 histories
this.session.closeSession(handleId);           // 关内核句柄
this.registry.remove(handleId);              // 清归属表
```

**没调** `rollingSummary.forgetSession(tenantId, sessionId)`——每场会话关闭后，rollingSummary 的 `states` Map 里还留着那场会话的 pending 队列 + summary 对象。会话多了就是缓慢的内存泄漏。WP55 扩展了状态（多了 visitorPending），泄漏更严重。

**修法**：在 `engine-turn.service.ts` 的 `close()` 里，加上对 rollingSummary 的清理。

**接线位置**：`engine.module.ts` 里 `EngineTurnService` 的 deps 注入 `RollingSessionSummaryService`，close 时调 `rollingSummary.forgetSession(context.tenantId, context.sessionId)`。

**注意**：close 是幂等的，forgetSession 也是幂等的（`states.delete` 不存在的 key 不报错）。

**会话关闭时未压队列的处理**：直接丢弃，不做最后一次 flush。这是预期行为——WP12 的 `session-closeout.service.ts` 会从逐字稿全量压最终摘要并晋升长时记忆，那几轮没压进去的内容会被最终摘要覆盖。滚动摘要的未压队列丢掉没关系。

### 4.5 摘要生成器：输入结构改造 + prompt 改写

**文件**：`src/engine-adapters/persistence/rolling-summary.generator.ts`

**当前输入结构**（行 36-41）：
```typescript
export interface RollingSummaryInput {
  readonly previousSummary?: string;
  readonly newLines: readonly string[];  // ← 只有咨询师
}
```

**改成**：
```typescript
export interface RollingSummaryInput {
  readonly previousSummary?: string;
  /** 本批新增的咨询师发言 (按时间正序). */
  readonly counselorLines: readonly string[];
  /** 本批新增的来访者发言 (按时间正序, 与 counselorLines 一一对应). */
  readonly visitorLines: readonly string[];
}
```

**`formatRollingSummaryInput` 改造**（行 146-154）：
```typescript
export function formatRollingSummaryInput(input: RollingSummaryInput): string {
  const parts: string[] = [];
  if (input.previousSummary && input.previousSummary.trim().length > 0) {
    parts.push(`[上一版摘要]\n${input.previousSummary.trim()}`);
  }
  const dialogue = input.counselorLines
    .map((c, i) => {
      const visitor = input.visitorLines[i];
      const visitorLine = visitor && visitor.trim().length > 0
        ? visitor.trim()
        : '（本轮来访者无回复）';
      return `咨询师: ${c.trim()}\n来访者: ${visitorLine}`;
    })
    .join('\n');
  parts.push(`[新增的对话记录]\n${dialogue}`);
  return parts.join('\n\n');
}
```

**`ROLLING_SUMMARY_SYSTEM_PROMPT` 改写**（行 68-79）：

从：
```
你是一名咨询训练场景的会话纪要助手。下面给你的是一段**咨询师一侧**的发言记录（来访者的话没有出现在这里）。
```

改成：
```
你是一名咨询训练场景的会话纪要助手。下面给你的是一段**咨询师与来访者的对话记录**（问答交替）。
```

**「不要编造」约束调整**：原来怕模型脑补来访者的话，现在来访者的话真的在输入里了，约束改成：
```
1. 只写已经出现过的内容：谈到的议题、情绪线索、关系进展。不要编造对话里没有提到的经历、感受或承诺。
```

其余约束（滚动并入、120 字上限、JSON 输出格式）不变。

### 4.6 配置：无新增 env 键

攒批阈值仍然是按「轮次对」算的（一对问答 = 1 条咨询师 + 1 条来访者），不需要新增 env 键。`SESSION_SUMMARY_BATCH_SIZE=3` 的语义从「3 条咨询师发言」变成「3 轮问答对」——口径更清晰了。

---

## 5. 红线检查

- ✅ **不改 engine-core**：所有改动都在 `src/engine-adapters/` 和门面（`rendering/`）里
- ✅ 不动内核的 `WorkingWindowOverflowEvent` 结构（它本来就只该带咨询师文本——内核不渲染，拿不到来访者的话）
- ✅ 不动 WP12 的最终摘要路径（`session-closeout.service.ts`）
- ❌ 不碰前端代码
- ❌ 不碰 admin-dashboard

---

## 6. 验收标准

### 6.1 单元测试

**`test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts`（新增）**：

**A. 双队列攒批与配对**：
1. 内核回调 3 条咨询师 + 门面给 3 条来访者 → 触发一次压缩，生成器收到 `counselorLines.length=3, visitorLines.length=3`
2. 内核回调 2 条咨询师 + 门面给 2 条来访者 → 不触发（不够 batchSize=3）
3. 内核回调 4 条咨询师 + 门面给 2 条来访者 → 不触发（visitor 不够，min(4,2)=2 < 3）
4. 再补 1 条来访者 → min(4,3)=3 >= 3 → 触发，压 3 对，剩下 1 条 counselor 留在队列

**B. 降级/阻断轮次边界**：
5. counselorPending=3, visitorPending=2（缺 1 条 visitor）→ min(3,2)=2 < 3 → 不触发
6. 再补 counselor 到 4 条 → min(4,2)=2 < 3 → 还是不触发（visitor 不够就死等）
7. 再补 visitor 到 3 条 → min(4,3)=3 >= 3 → 触发，压 3 对，剩 1 条 counselor

**C. 失败回滚**：
8. 生成器抛错 → counselor 和 visitor 都放回队列头部（顺序不变）

**D. formatRollingSummaryInput**：
9. 输出是「咨询师: xxx\n来访者: yyy」交替格式
10. visitorLines 缺第 i 条时显示「（本轮来访者无回复）」

**E. 门面截断捕获**：
11. histories 从 16 条涨到 18 条 → 截断挤掉前 2 条 → 其中 visitor 的文本被传给 `recordVisitorOverflow`
12. 被挤掉的条目全是 counselor（阻断轮次场景）→ `recordVisitorOverflow` 不被调用

**F. 会话关闭清理**：
13. `forgetSession(tenantId, sessionId)` 后，`trackedSessionCount()` 减 1，再调 `latestSummary` 返回 undefined

### 6.2 回归测试

- WP37 既有用例全部绿（攒批阈值 / 滚动并入 / SHORT_TERM 写入 / 三档失败降级 / 会话与租户隔离 / env 装配）
- 无溢出的会话，规格与 prompt **逐字不变**（无摘要时不带 `sessionSummary` 键）
- 未装配滚动摘要服务时，门面 histories 截断行为与 WP37 **逐字一致**

### 6.3 闸门

```powershell
npx eslint "src/**/*.ts" "test/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit          # → 0 error
npx vitest run                                   # → 全绿（WP37 基线 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core           # → 空（本 WP 不碰内核）
```

---

## 7. 交付格式

按 `team/conventions.md` §二写交付记录：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（特别是：为什么双队列配对而不是合并队列、降级/阻断轮次的 min 取数逻辑、stateOf 怎么重构、为什么会话关闭时不做最后 flush）
3. 闸门数字

完成后把本任务单 + 交付记录从 `pending/` 移到 `completed/phase2/`。

---

## 8. 回写

交付完更新 [`phase2-wp-list-2026-11-03.md`](../../pending/phase2-wp-list-2026-11-03.md) 里 WP55 的状态。

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录：

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §4.3 **双队列**（counselorPending + visitorPending）+ `min` 取数配对 | **单队列「轮次记录」**（两侧绑成一个对象） | 双队列的 min 配对在"某轮没有来访者发言"时**错位一格**，产出「问 A 轮 / 答 B 轮」的**假问答对**（交付记录 §2.1 有逐轮反例）。轮次记录让配对由结构保证 |
| 2 | §4.1 门面在 `setHistory` **截断处**捕获被挤掉的来访者文本 | 改为在**每轮落账处**上报完整轮次 | 截断处拿不到配对信息（缓冲是半轮列表，跨截断边界会把一对问答拆开）；落账处两侧还在手里。副作用：`histories` 缓冲不动 → prompt 逐字不变 |
| 3 | §4.2 端口方法 `recordVisitorOverflow(..., visitorTexts)` | `recordRound(..., counselor, visitor)` | 只给来访者侧 = 把配对责任丢给下游；`visitor` 用 `null` 区分"没说话"与"说了空话" |
| 4 | §4.5 生成器输入 `counselorLines` + `visitorLines` 两个平行数组 | 一个 `rounds` 轮次数组 | 两个平行数组的"同轮"不变量是隐式的，漏 push 一个就静默错位。**输出格式与任务单逐字一致** |
| 5 | §4.4 「`engine.module.ts` 里 `EngineTurnService` 的 deps 注入」 | 走**构造注入**（`@Optional() @Inject(ROLLING_SUMMARY_CLEANUP) rollingSummary?: RollingSummaryCleanupPort`） | `EngineTurnService` 是**类 provider**（Nest 按构造参数元数据注入），没有 useFactory 可改；另抽窄面 `RollingSummaryCleanupPort`（只有 `forgetSession`） |
| 6 | §5「不动内核的 `WorkingWindowOverflowEvent` 结构」 | **照做**（内核一行未动） | 内核只交咨询师原话是对的 —— 它只当**淘汰信号**用；两侧内容由门面上报 |
| 7 | §4.6 攒批阈值口径从「条」改成「轮问答对」 | **照做**（数值不变，`.env.example` 只改注释，无新增 env 键） | 与 §2.1 的轮次口径一致 |
| 8 | 任务单未提 DI token | **新增** `ROLLING_SUMMARY_CLEANUP` symbol token + 装配层 provider + 两条守卫用例 | 窄端口是 **interface**，编译后没有运行时值 —— 不给显式 token，Nest 只会去找 `Object` provider，找不到就**静默注入 undefined**：应用照常启动、测试全绿，但会话关了滚动摘要状态**永远不释放**（正是本单要修的泄漏）。与 `engine.providers.ts` 文件头记的"启动炸弹"同类 |

> 另：本期**没做**的（摘要层次化 / 不做最后一次 flush / 滚动摘要仍进程内 / `spec.recall` 仍不进 prompt 等）已在交付记录 §4 逐条留档。

---

_创建：2026-11-04_
_深度盘查：WP37 交付记录 + 真实代码 grep（WorkingWindowOverflowEvent / RollingSummaryPort / TurnRenderOrchestrator.histories / setHistory / settleTurn / settleBlockedTurn / resolveContext / engine-turn.service.close / engine.module.ts 接线）_
_盘查发现并补入的边界：阻断轮次配对错位 / 渲染降级配对错位 / 会话关闭状态泄漏（WP37 遗留）/ stateOf 重构方案 / 时序对齐精确说明_
