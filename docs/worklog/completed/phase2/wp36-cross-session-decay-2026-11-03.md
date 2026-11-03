# WP36：跨会话间隔自然衰减（resume 时情绪/阻抗/同盟半衰期回落）

> 状态: ✅ 已交付（2026-11-03）→ [`engine-wp36-cross-session-decay-implementation-2026-11-03.md`](engine-wp36-cross-session-decay-implementation-2026-11-03.md)
> 优先级: 🟡 P1（专业能力主线）
> 预估: 中
> 依赖: WP12 resume（已交付 ✅）、WP42 同盟三维（已交付 ✅）
> 红线: **engine-core 预批准例外**（最后一个）

---

## 1. 背景

现在 resume 的逻辑（`in-memory-engine-session.ts:461-471`）是：加载上一场的 BDI 快照，**原样搬过来用**。

问题：用户隔一周再回来，来访的情绪、阻抗、同盟状态跟上一场结束时一模一样——不真实。真实来访隔一周再咨询，情绪会自然平复，阻抗会自然回落，但不会完全归零（关系不会因为一周不见就回到陌生人）。

蓝图 §4.5 P1 级算子："resume 前按间隔对情绪/阻抗/信念差异化半衰期回落，破裂态阻抗反升"。

---

## 2. 任务目标

在 resume 加载快照后、继续会话前，按"距上一场结束的时间间隔"对情绪/阻抗/同盟三维做半衰期衰减。核心信念、底层欲望不衰减（这些是稳定人格特质）。

---

## 3. 具体改动（全部基于真实代码盘查）

### 3.1 衰减纯函数（新增）

**新文件**：`src/engine-core/cognition/session-decay.ts`

参照 `memory/importance-decay.ts:65` 的 `decayImportance()` 范式（半衰期公式 `value * 2^(-ageMs/halfLifeMs)`），写一个 `applySessionDecay()` 纯函数：

```typescript
export interface SessionDecayConfig {
  readonly emotionHalfLifeMs: number;    // 情绪半衰期（种子值：7 天）
  readonly resistanceHalfLifeMs: number; // 阻抗半衰期（种子值：14 天）
  readonly allianceHalfLifeMs: number;   // 同盟半衰期（种子值：30 天）
}

export function applySessionDecay(
  snapshot: BdiSnapshot,
  ageMs: number,
  config?: SessionDecayConfig,
): BdiSnapshot;
```

**衰减规则**（只调这些维度，其他不动）：

| 维度组 | 包含字段 | 半衰期 | 说明 |
|---|---|---|---|
| 情绪 | `emotion.valence`、`emotion.arousal` | 7 天 | 情绪平复最快 |
| 阻抗 | `resistance.verbal`、`resistance.depth`、`resistance.style` | 14 天 | 阻抗回落比情绪慢 |
| 同盟 | `trust`、`safety`、`bond` | 30 天 | 关系记忆最持久 |

**不衰减的维度**：`coreBeliefs`、`temporaryBeliefs`、`memoryBeliefs`、`underlyingDesires`、`situationalDesires`、`transference`（含 positive/negative/dependency 三态）——这些是稳定人格特质或认知结构，不因间隔时间回落。

**注意**：衰减 `emotion.valence` / `emotion.arousal` 后，要用 `resolveEmotionLabel(valence, arousal)`（`domain/emotion.ts:39`）重新算 `emotion.label`，否则标签和数值对不上。

> ⚠️ 半衰期是工程种子值，注释里写清楚"待真实对练校准"。

### 3.2 resume 路径接入衰减

**文件**：`src/engine-core/in-memory/in-memory-engine-session.ts`

现在第 461-471 行的 resume 分支：

```typescript
if (runtime.resumeFromSessionId) {
  const resumed = await this.bdiStates.load(runtime.tenantId, runtime.resumeFromSessionId);
  if (resumed) {
    return {
      tenantId: runtime.tenantId,
      sessionId: runtime.sessionId,
      revision: 0,
      updatedAt: this.now(),
      snapshot: cloneBdiSnapshot(resumed.snapshot),  // ← 现在：原样搬
    };
  }
}
```

改成：加载 `resumed` 后，算 `ageMs = this.now() - resumed.updatedAt`，调 `applySessionDecay(resumed.snapshot, ageMs, this.sessionDecayConfig)`，用衰减后的快照返回。

`resumed.updatedAt` 是 `BdiStateRecord` 的字段（`bdi-state.repository.ts:56`，ms timestamp），直接可用。

### 3.3 构造注入配置

**文件**：`src/engine-core/in-memory/in-memory-engine-session.ts`

构造函数加 `sessionDecayConfig?: SessionDecayConfig` 可选参数（跟 `personalityModulatorConfig`、`allianceConfig` 同款范式）。不传 = 用内核默认种子值。

### 3.4 适配层接线

**新文件**：`src/engine-adapters/wiring/session-decay.config.ts`

`resolveSessionDecayConfig(config)` —— 3 个 `ENGINE_DECAY_*` 键逐个字面量读，非法值回退内核种子值（照 `alliance-config.ts` 范式）。

**文件**：`src/engine-adapters/wiring/engine.providers.ts`
`EngineSessionTuningDeps` 加 `sessionDecayConfig?`，透传给内核会话。

**文件**：`src/engine-adapters/wiring/engine.module.ts`
`ENGINE_SESSION_PORT` 的 useFactory 注入 `sessionDecayConfig: resolveSessionDecayConfig(config)`。

### 3.5 配置文件

**文件**：`.env.example`
新增 3 个 `ENGINE_DECAY_EMOTION_HALF_LIFE_MS` / `ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS` / `ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS`（**留空** = 继承内核种子值）。

**文件**：`typings/global.d.ts`
显式声明 3 个 `ProcessEnv` 键。

### 3.6 barrel 导出

**文件**：`src/engine-core/index.ts`
追加 `SessionDecayConfig`、`DEFAULT_SESSION_DECAY_CONFIG`、`applySessionDecay` 三个公开符号。

---

## 4. 红线检查

- ✅ **预批准改 engine-core**（已在 WP 清单登记为例外）
- ✅ 改完必须通过 `boundary.spec.ts` 的 11 条断言（零 NestJS / 零网络 / 零 prompt / 零 process.env）
- ✅ 配置走注入（`SessionDecayConfig` 端口），不硬编码到内核
- ❌ 不碰前端代码
- ❌ 不碰 admin-dashboard

---

## 5. 验收标准

1. **单元测试**：
   - ageMs = 0 时，快照原样返回（无衰减）
   - ageMs = 7 天时，valence/arousal 恰好减半
   - ageMs = 14 天时，resistance 三维恰好减半
   - ageMs = 30 天时，trust/safety/bond 恰好减半
   - coreBeliefs/desires/transference 逐字不变
2. **回归测试**：WP1 / WP12 / WP34 / WP42 既有用例全部绿（无 resume 时行为不变）
3. **边界测试**：ageMs 为负数（时钟偏移）时按 0 处理，不衰减
4. **闸门**：eslint 0 error / tsc 0 错 / vitest 全绿

---

## 6. 交付闸门

```powershell
npx eslint "src/**/*.ts"                    # → 0 error
npx tsc -p tsconfig.build.json --noEmit     # → 0 error
npx vitest run                              # → 全绿（既有 1320 例 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core     # → 列出改了哪些文件（预批准例外，不是空）
```

---

## 7. 交付格式

按 `team/conventions.md` §2 写交付记录：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（半衰期为什么这么定、为什么不衰减信念/欲望）
3. 闸门数字

完成后把本任务单 + 交付记录从 `pending/` 移到 `completed/phase2/`。

---

## 8. 回写

交付完更新 [`phase2-wp-list-2026-11-03.md`](phase2-wp-list-2026-11-03.md) 里 WP36 的状态。

---

## 9. 交付后补记（2026-11-03）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录：

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §3.6 只说 barrel 追加 3 个符号 | **另改** `test/engine-core/boundary.spec.ts` 断言⑥ 白名单 + 断言⑦ 目录清单 | 断言⑥ 是**双向白名单**，不更新就红（照 WP42 先例） |
| 2 | 未提 env 守卫 | **另加** `wp25-env-example-coverage.spec.ts` 断言③e | 适配层"逐个字面量读"的前提就是它守着（照 ③b/③c/③d 先例） |
| 3 | 未说非法半衰期怎么办 | **回退内核种子值**（适配层 + 内核侧双层兜底），不抛错 | 抛错会让 resume 那一整场对练开不起来；口径照 WP42 `resolveAllianceThresholds` |
| 4 | §3.1 衰减表 / §5 验收标准：情绪 7 天 / 阻抗 14 天 / 同盟 30 天，**信念不衰减**，无"破裂态"规则 | **照任务单逐字实现**（信念/欲望/移情不衰减，无破裂态分支） | WP 清单 WP36 行与蓝图 §4.5 写的"信念差异化回落 + **破裂态阻抗反升**"与本任务单冲突；"破裂态"缺阈值定义（临床数字），且与 §5"阻抗恰好减半"的无条件验收冲突 → 不发明临床数字，本期不做并留档（交付记录 §2.4 / §4） |

> 另：衰减落点（`loadState()` 接续分支）行号实际为 461–472（任务单写 461–471，差 1 行，实质一致）；衰减是**跨场边界的一次性事件**，不是每轮持续衰减（交付记录 §2.5）。

---

_创建：2026-11-03_
