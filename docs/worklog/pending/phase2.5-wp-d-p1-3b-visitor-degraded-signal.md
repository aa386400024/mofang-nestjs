# 📋 WP-D P1-3b：来访者侧降级信号透传

> 状态：待开工
> 来源：WP-D 测试报告 P1-3 后续 + MiniMax Code 六大漏判 #1
> 前置：P1-3 咨询师侧 degraded_turns 已修并 push

## 背景

P1-3 修了**咨询师侧**降级：counselor-agent 回兜底句时 `degraded=true`，runner 累计 `degradedTurns`，≥50% 时 exitReason 加 `_heavy_degraded`。

但**来访者侧**降级信号断了：当 LLM 生成来访者台词失败/429/超时，`turn-render-orchestrator` 走 `degradedRender()` 返回 `providerHint='degraded'`，`engine-stream-backend.adapter.ts:825` 已经算了 `degraded: result.render.providerHint === 'degraded'`，但这个标记**没有透传到 `DebugTurnTrace`**。

结果：runner 只统计咨询师侧降级，来访者侧全是兜底句时完全无感知，场次照样标 completed。

## 根因

1. `DebugTurnTrace` 接口（`debug-session.service.ts:237-306`）没有 `degraded` 字段
2. 构造 trace 时（`debug-session.service.ts:548-562`）没读 `result.render.providerHint`
3. runner（`practice-runner.service.ts:208-210`）拿到 `result.trace` 但里面没有降级标记

## 改动方案

### 1. `DebugTurnTrace` 加字段

`src/admin-debug/debug-session.service.ts` 接口加：

```ts
/** 本轮来访者侧是否走了渲染降级 (LLM 失败/超时回兜底句). */
readonly degraded: boolean;
```

### 2. 构造 trace 时填充

`debug-session.service.ts:548` trace 对象加：

```ts
degraded: result.render.providerHint === 'degraded',
```

（`result.render.fallbackUsed` 在 line 537 已经在用，说明 `result.render` 可访问。）

### 3. runner 统计来访者侧降级

`practice-runner.service.ts` 主循环里，`engine.turn()` 返回后：

```ts
const result = await this.engine.turn(debugSessionId, counselorReply.text);
turnCount = result.turnIndex;
// 来访者侧降级：trace.degraded = true 说明这轮来访者是兜底句
if (result.trace.degraded) {
  degradedTurns += 1;
}
```

注意：现在 `degradedTurns` 同时统计咨询师侧（`counselorReply.degraded`）和来访者侧（`result.trace.degraded`）。一轮里两边都降级会 +2，这是合理的——两边都兜底的轮次更该被标记。

### 4. 单测

`test/auto-practice/practice-runner.spec.ts` 补一个 case：mock `trace.degraded=true`，验证 degradedTurns 累计正确。

## 闸门

- `npx tsc --noEmit` 0 错误
- `npx vitest run test/auto-practice/` 全绿
- engine-core 零改动（`git diff --stat HEAD -- src/engine-core` 为空）

## commit message

```
fix(wp-d): P1-3b 来访者侧降级信号透传——DebugTurnTrace加degraded字段, runner统计双侧降级
```
