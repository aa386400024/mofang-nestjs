# WP-C: 触发式审议闸门（Deliberation Gate Service）

> **状态**: ✅ 已交付（2026-11-09）→ [交付记录](phase2.5-wp-c-triggered-deliberation-gate-implementation-2026-11-09.md)
> **优先级**: 🔴 P1
> **依赖**: WP-A（审议输入最小化）✅ / R9（灰度三态模式）✅ / WP-B（版本指纹）✅
> **预估工作量**: 2-3 天
> **红线**: engine-core 零改动

---

## 一、背景与目标

### 现状
- 审议（deliberation）现在是"每轮都跑"——只要 hook 装上了（llm_active 模式），每一轮都调 LLM 审议
- 成本极高：20 轮对话 = 20 次 LLM 调用，90% 的调用是浪费在平静对话上
- 预期效果：每 10-15 轮跑一次审议，成本降 90%，效果不降

### 目标
在 `deliberationRound()` 前面加一个独立闸门服务，决定每一轮要不要跑 LLM 审议。
- **规则算不准的地方才跑审议**（不是"变化大才跑"）
- **影子模式低门槛多收集数据，生效模式高门槛谨慎干预**
- **危机/合规红线永远跳过**
- **服务可独立拆分**（以后拆微服务时整个目录搬出去就行）

---

## 二、设计决策（已拍板，不要改）

### 2.1 参数表

| 参数 | 生效模式 | 影子模式 | 说明 |
|---|---|---|---|
| 同盟三维触发阈值（\|delta\| >） | **0.05** | **0.03** | trust/safety/bond 任一维度变化超过此值 → 触发 |
| 阻抗维度触发阈值（\|delta\| >） | **0.08** | **0.05** | implicit_resistance 等阻抗维度 |
| 冷却轮数 | **4 轮** | **1 轮** | 跑完后 N 轮内不再跑 |
| 每会话最大生效次数 | **6 次** | 不限制 | 生效模式上限，影子不限制 |
| 首轮强制跑 | ✅ | ✅ | turnIndex === 1 时强制建立基线 |
| 关键事件硬触发 | ✅ | ✅ | boundary_violation / judgment / crisis_edge 不管 delta 都跑 |
| 危机轮跳过 | ❌ 永远不跑 | ❌ 永远不跑 | 合规红线 |
| 全局每分钟配额 | **20 次/分钟** | 不限制 | 批量跑批保护 |
| 熔断阈值 | 连续 5 次超时 → 熔断 10 分钟 | 不熔断 | 生效模式才熔断 |

### 2.2 决策流程（从上到下，短路返回）

```
输入：stateBefore, stateAfter, events, safety, turnIndex, sessionId, mode(shadow|effect)
  │
  ├─ ① 硬红线：safety.riskLevel === 'crisis'?
  │    └─ 是 → skip(reason='crisis_skip')
  │
  ├─ ② 首轮：turnIndex === 1?
  │    └─ 是 → run(reason='first_turn_baseline')
  │
  ├─ ③ 关键事件硬触发：events 含 boundary_violation / judgment / crisis_edge?
  │    └─ 是 → run(reason='key_event')
  │
  ├─ ④ 冷却检查：距上次跑 < cooldownTurns 轮?
  │    └─ 是 → skip(reason='cooldown')
  │
  ├─ ⑤ 配额检查：本会话已跑 >= maxPerSession? / 全局每分钟超了?
  │    └─ 是 → skip(reason='quota_exceeded')
  │
  ├─ ⑥ 熔断检查（仅生效模式）：熔断中?
  │    └─ 是 → skip(reason='circuit_open')
  │
  ├─ ⑦ 不确定性评估：
  │    ├─ 事件类型在规则置信清单外? → run(reason='unknown_event_type')
  │    ├─ 同盟三维任一 |delta| > allianceThreshold? → run(reason='alliance_delta_high')
  │    ├─ 阻抗任一 |delta| > resistanceThreshold? → run(reason='resistance_delta_high')
  │    └─ 全平静（所有维度变化 < 0.03）? → skip(reason='calm_turn')
  │
  └─ ⑧ 默认：rule_confident → skip(reason='rule_confident')
```

---

## 三、文件结构（微服务友好）

新建目录：`src/engine-adapters/deliberation-gate/`

```
src/engine-adapters/deliberation-gate/
  ├── deliberation-gate.module.ts        ← NestJS module（注册 service）
  ├── deliberation-gate.service.ts       ← 决策入口（evaluate 方法）
  ├── deliberation-gate.types.ts         ← 类型定义（纯 TS，零依赖）
  ├── deliberation-gate.config.ts        ← 配置读取（env 变量）
  ├── deliberation-gate.evaluator.ts     ← 不确定性评估（纯函数，零 IO）
  ├── deliberation-gate.quotas.ts        ← 配额/冷却/熔断（Redis 操作）
  └── deliberation-gate.trace.ts         ← 决策 trace 写 Redis
```

### 3.1 各文件职责

**deliberation-gate.types.ts**
- `GateMode = 'shadow' | 'effect'`
- `GateDecision = 'run' | 'skip'`
- `GateReason = 'crisis_skip' | 'first_turn_baseline' | 'key_event' | 'cooldown' | 'quota_exceeded' | 'circuit_open' | 'unknown_event_type' | 'alliance_delta_high' | 'resistance_delta_high' | 'calm_turn' | 'rule_confident'`
- `GateInput`：输入参数（sessionId, turnIndex, stateBefore, stateAfter, events, safety, mode）
- `GateOutput`：决策结果（decision, reason, deltaSummary, thresholdUsed）

**deliberation-gate.config.ts**
- 读 env 变量，输出 `GateConfig` 对象
- 缺省值就是上面参数表里的值
- env 变量名：
  - `ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_EFFECT=0.05`
  - `ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_SHADOW=0.03`
  - `ENGINE_DELIBERATION_GATE_RESISTANCE_THRESHOLD_EFFECT=0.08`
  - `ENGINE_DELIBERATION_GATE_RESISTANCE_THRESHOLD_SHADOW=0.05`
  - `ENGINE_DELIBERATION_GATE_COOLDOWN_EFFECT=4`
  - `ENGINE_DELIBERATION_GATE_COOLDOWN_SHADOW=1`
  - `ENGINE_DELIBERATION_GATE_MAX_PER_SESSION_EFFECT=6`
  - `ENGINE_DELIBERATION_GATE_GLOBAL_RPM=20`
  - `ENGINE_DELIBERATION_GATE_CIRCUIT_FAIL_COUNT=5`
  - `ENGINE_DELIBERATION_GATE_CIRCUIT_COOLDOWN_MS=600000`

**deliberation-gate.evaluator.ts（纯函数）**
- 输入：stateBefore, stateAfter, events, config
- 输出：`{ shouldTrigger: boolean, reason: GateReason, deltaSummary: Record<string, number> }`
- 职责：算 delta、判断事件类型是否在置信清单内、判断是否全平静
- 零网络、零 Redis、零 env——纯函数，好测试

**deliberation-gate.quotas.ts（Redis 操作）**
- `checkCooldown(sessionId, mode, currentTurn)`：检查冷却，返回 boolean
- `recordRun(sessionId, mode, turnIndex)`：记录本次跑了
- `checkQuota(sessionId, mode)`：检查会话配额
- `checkGlobalRpm()`：检查全局每分钟配额
- `checkCircuit()`：检查熔断状态
- `recordCircuitFailure()`：记录一次失败
- `resetCircuit()`：熔断恢复
- Redis key 设计：
  - `deliberation:gate:{sessionId}:{mode}:last_turn` → 上次跑的轮次
  - `deliberation:gate:{sessionId}:{mode}:count` → 会话计数
  - `deliberation:gate:global:rpm:{minute}` → 全局每分钟计数
  - `deliberation:gate:circuit:fail_count` → 熔断失败计数
  - `deliberation:gate:circuit:open_until` → 熔断截止时间

**deliberation-gate.trace.ts**
- `recordTrace(sessionId, turnIndex, decision, reason, deltaSummary, thresholdUsed, elapsedMs)`
- Redis key：`deliberation:gate:trace:{sessionId}:{turnIndex}:{mode}`
- TTL：7 天（以后 admin 面板看历史）

**deliberation-gate.service.ts**
- `evaluate(input: GateInput): Promise<GateOutput>`
- 串起所有步骤：①硬红线 → ②首轮 → ③关键事件 → ④冷却 → ⑤配额 → ⑥熔断 → ⑦evaluator → ⑧默认
- 每次决策后调 trace.recordTrace

---

## 四、对接点

### 4.1 turn-render-orchestrator.ts 的 deliberationRound()

现有代码在 `src/engine-adapters/rendering/turn-render-orchestrator.ts` 的 `deliberationRound()` 方法（约 711 行开始）。

**改法**：在现有影子/生效调用前面，先过闸门：

```typescript
private deliberationRound(...) {
  // ... 现有代码（baseSnapshot 等）不变 ...
  
  // WP-C: 先过闸门
  const shadowDecision = await this.gateService.evaluate({
    sessionId: context.sessionId,
    turnIndex: output.turnIndex,
    stateBefore: baseSnapshot,
    stateAfter: output.snapshot,
    events: output.events,
    safety: output.safety,
    mode: 'shadow',
  });
  
  const effectDecision = await this.gateService.evaluate({
    sessionId: context.sessionId,
    turnIndex: output.turnIndex,
    stateBefore: baseSnapshot,
    stateAfter: output.snapshot,
    events: output.events,
    safety: output.safety,
    mode: 'effect',
  });
  
  // 影子：原 shadow 调用外面包一层 if (shadowDecision.decision === 'run')
  if (shadow && shadowDecision.decision === 'run') {
    // 原有 shadow.runShadowMode(...) 调用
  }
  
  // 生效：原 effect 调用外面包一层 if (effectDecision.decision === 'run')
  if (effect && effectDecision.decision === 'run') {
    // 原有 effect 调用
  }
}
```

### 4.2 engine.module.ts 注册

在 `src/engine-adapters/wiring/engine.module.ts` 里 import DeliberationGateModule，注入到 TurnRenderOrchestrator 的 deps。

### 4.3 engine.providers.ts

TurnRenderOrchestrator 的 deps 加一个 `gateService` 字段。

---

## 五、验收标准

### 5.1 闸门单元测试
- `test/engine-adapters/deliberation-gate/evaluator.spec.ts`
  - 危机轮 → skip
  - 首轮 → run
  - 关键事件 → run
  - 同盟 delta > 阈值 → run
  - 阻抗 delta > 阈值 → run
  - 全平静 → skip
  - 常规 empathic → skip
- `test/engine-adapters/deliberation-gate/quotas.spec.ts`
  - 冷却生效
  - 会话计数上限生效
  - 全局 RPM 生效
  - 熔断触发/恢复

### 5.2 集成验证
- `npx tsc -p tsconfig.build.json --noEmit` → 0 错误
- `npx eslint` → 0 error
- `npx vitest run test/engine-adapters/deliberation-gate/` → 全绿
- `git diff --stat HEAD -- src/engine-core` → **空**（红线）
- 跑一场 auto-practice 批量验证，确认 Redis 里有 trace 数据

---

## 六、红线（不要碰）

1. ❌ **不改 `src/engine-core/**` 下任何文件**——所有逻辑在 `engine-adapters/deliberation-gate/`
2. ❌ **不写死阈值**——全走 env 配置，缺省值在 config.ts
3. ❌ **不依赖进程内存做状态**——冷却/计数/熔断全走 Redis，以后拆服务不用改
4. ❌ **不改对话原文流向**——闸门只看结构化数据（快照/事件/safety），不碰对话原文
5. ❌ **不自动 git commit/push**——写完给 commit message 草稿

---

## 七、commit message 草稿

```
feat(wp-c): 触发式审议闸门——不确定性驱动+影子/生效双轨+配额熔断保护
```
