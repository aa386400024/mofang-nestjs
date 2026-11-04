# WP59 任务单 — 记忆召回策略配置端口统一

> **状态**：✅ 已交付（2026-11-04）→ 交付记录：[`engine-wp59-recall-policy-config-port-implementation-2026-11-04.md`](engine-wp59-recall-policy-config-port-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp59-recall-policy-config-port-2026-11-04.md`
> **优先级**：🟢 P2
> **引擎内核**：✅ **预批准改 engine-core**（给 `evaluateRecallCandidate` 加可选参数，纯函数扩展，向后兼容）—— **实改 2 个文件，与 §5.1 清单一致，一字不多**
> **前置依赖**：WP2（三级记忆系统）、WP12（记忆配置 B 层）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §③ 记忆系统层

---

## 1. 任务概述

### 1.1 一句话目标

WP2 已交付完整的召回判定纯函数 `evaluateRecallCandidate`，但**半衰期和阈值两个工程种子值硬编码在内核里**，Qdrant 版只能在 B 层"双层判定"（内核卡一道 + B 层再卡一道），内存版连配置端口都没有。本期给 `evaluateRecallCandidate` 加**可选**配置参数，让内存版和 Qdrant 版共用一套配置，消除双层判定的复杂度。

### 1.2 为什么现在做

- 现在内测时调参要改代码 —— 半衰期 30 天 / 阈值 0.1 是工程种子值，不是临床结论
- Qdrant 版的"双层判定"很复杂 —— 先跑内核硬编码卡一道，再在 B 层用配置卡一道，取交集 = 更严，但不是"统一配置"
- 内存版没有配置端口 —— 开发期和生产环境行为不一致（开发期用内存版测出来的召回结果，生产环境换 Qdrant 版可能不一样）
- 这是 WP2 + WP12 的补完项，做完之后召回策略才真正端到端可配置

---

## 2. 现状盘查结论（已 grep 全 engine-core + engine-adapters 核实）

### 2.1 `evaluateRecallCandidate` 现状

```ts
// engine-core/memory/recall-policy.ts:64
export function evaluateRecallCandidate(
  entry: MemoryEntry,
  expiresAt: number | null,
  query: MemoryRecallQuery,
  now: number,
): RecallEvaluation {
  // ... 租户隔离 / 范围归属 / 过期 / 被取代 / 分层过滤 ...

  // 7/8. 有效重要度.
  const effective = query.scope === 'visitor' ? effectiveImportance(entry, now) : entry.importance;
  if (query.scope === 'visitor' && effective < RECALL_MIN_EFFECTIVE_IMPORTANCE) return REJECTED;
  if (query.minImportance !== undefined && effective < query.minImportance) return REJECTED;

  return { accepted: true, effectiveImportance: effective };
}
```

**问题**：
- `effectiveImportance(entry, now)` 用的是硬编码的 `DEFAULT_DECAY_HALF_LIFE_MS = 30 天`
- `RECALL_MIN_EFFECTIVE_IMPORTANCE = 0.1` 也是硬编码的
- 不接受配置参数

### 2.2 `effectiveImportance` 现状

```ts
// engine-core/memory/importance-decay.ts:83
export function effectiveImportance(entry: MemoryEntry, now: number, halfLifeMs: number = DEFAULT_DECAY_HALF_LIFE_MS): number {
  return decayImportance(entry.importance, now - entry.occurredAt, halfLifeMs);
}
```

**问题**：已经接受 `halfLifeMs` 参数了，但 `evaluateRecallCandidate` 调用它时没传。

### 2.3 内存版调用现状

```ts
// engine-core/in-memory/in-memory-memory.store.ts:97
const evaluation = evaluateRecallCandidate(stored.entry, stored.expiresAt, query, now);
```

**问题**：传 4 个参数，用默认值。没有配置端口。

### 2.4 Qdrant 版调用现状（双层判定）

```ts
// engine-adapters/persistence/qdrant-memory.store.ts:287-294
const evaluation = evaluateRecallCandidate(decoded.entry, decoded.expiresAt, query, now);
if (!evaluation.accepted) continue;

// WP12: 配置化的有效重要度 (半衰期来自 env).
const configuredEffective = effectiveImportance(decoded.entry, now, this.config.decayHalfLifeMs);
if (configuredEffective < this.config.recallThreshold) continue;
```

**问题**：
1. 先跑内核的 `evaluateRecallCandidate`（用硬编码常量卡一道）
2. 然后再在 B 层用配置值追加一道门槛
3. 这是"取交集" = 更严，但不是"统一配置"

### 2.5 Qdrant 版配置现状

```ts
// engine-adapters/persistence/memory-config.ts:48-53
export interface MemoryConfig {
  readonly decayHalfLifeMs: number;
  readonly recallThreshold: number;
}
```

**问题**：配置在 B 层，不在内核。Qdrant 版能用，内存版用不上。

### 2.6 boundary.spec.ts 白名单现状

- `evaluateRecallCandidate` 在 `recall-policy.ts`，已经在白名单里（`memory/` 目录整体在）
- `effectiveImportance` 在 `importance-decay.ts`，已经在白名单里
- 本期只是给纯函数加可选参数，不新增文件，不需要碰白名单

---

## 3. 本期做什么

### 3.1 `evaluateRecallCandidate` 加可选配置参数

```ts
// engine-core/memory/recall-policy.ts:64
export interface RecallPolicyOptions {
  /**
   * 重要度衰减半衰期 (ms).
   * 省略 = 用内核默认值 (30 天).
   */
  readonly halfLifeMs?: number;
  /**
   * 访客范围召回的最小有效重要度 [0,1].
   * 省略 = 用内核默认值 (0.1).
   */
  readonly minEffectiveImportance?: number;
}

export function evaluateRecallCandidate(
  entry: MemoryEntry,
  expiresAt: number | null,
  query: MemoryRecallQuery,
  now: number,
  options: RecallPolicyOptions = {},
): RecallEvaluation {
  // ... 租户隔离 / 范围归属 / 过期 / 被取代 / 分层过滤 不变 ...

  // 7/8. 有效重要度.
  const halfLifeMs = options.halfLifeMs ?? DEFAULT_DECAY_HALF_LIFE_MS;
  const minEffectiveImportance = options.minEffectiveImportance ?? RECALL_MIN_EFFECTIVE_IMPORTANCE;

  const effective = query.scope === 'visitor' ? effectiveImportance(entry, now, halfLifeMs) : entry.importance;
  if (query.scope === 'visitor' && effective < minEffectiveImportance) return REJECTED;
  if (query.minImportance !== undefined && effective < query.minImportance) return REJECTED;

  return { accepted: true, effectiveImportance: effective };
}
```

**口径说明**：
- `options` 是可选的，不传 = 用默认值 = 行为与现在逐字一致（零回归）
- `halfLifeMs` 和 `minEffectiveImportance` 也是可选的，不传 = 用内核默认值
- 这是纯函数扩展，调用方一行不用改（不传 options = 旧行为）

### 3.2 内存版加配置端口

```ts
// engine-core/in-memory/in-memory-memory.store.ts:45
export interface InMemoryMemoryStoreOptions {
  // ... 既有 defaultTtlMs / now 不变 ...

  /**
   * 召回策略配置 (可选).
   * 省略 = 用内核默认值.
   */
  readonly recallPolicy?: RecallPolicyOptions;
}
```

调用处：
```ts
// engine-core/in-memory/in-memory-memory.store.ts:97
const evaluation = evaluateRecallCandidate(stored.entry, stored.expiresAt, query, now, this.options.recallPolicy);
```

### 3.3 Qdrant 版消除双层判定

```ts
// engine-adapters/persistence/qdrant-memory.store.ts:287
const evaluation = evaluateRecallCandidate(decoded.entry, decoded.expiresAt, query, now, {
  halfLifeMs: this.config.decayHalfLifeMs,
  minEffectiveImportance: this.config.recallThreshold,
});
if (!evaluation.accepted) continue;

// 删掉双层判定的第二道门槛 —— 内核已经用配置值卡过了
```

**好处**：
- 消除"双层判定"的复杂度
- 内核和 B 层用同一套配置
- 行为更直观：配置值直接生效，不是"取交集"

---

## 4. 边界问题补充

### 4.1 ⚠️ 为什么改内核？

**因为 `evaluateRecallCandidate` 是召回判定的唯一真相源。**

- 现在 Qdrant 版在 B 层再写一遍判定逻辑（双层判定），这是反模式 —— 两份判定迟早漂移
- 把配置参数加到内核纯函数里，调用方传配置值，一份判定，一处真相
- 这是纯函数扩展，不破坏纯层（无状态、无 IO、无随机）

### 4.2 ⚠️ 为什么是可选参数？

**零回归。**

- 不传 options = 用默认值 = 行为与现在逐字一致
- 调用方一行不用改（现有代码不传 options，行为不变）
- 这是"扩展点预留"，不是"强制改造"

### 4.3 ⚠️ 内存版和 Qdrant 版行为会一致吗？

**会。**

- 之前：内存版用硬编码常量，Qdrant 版用"双层判定"（硬编码 + 配置）
- 之后：内存版和 Qdrant 版都传配置值，用同一套判定逻辑
- 开发期测出来的召回结果，生产环境换 Qdrant 版也一样

### 4.4 ⚠️ 配置值会覆盖内核地板吗？

**不会。**

- 配置值是"覆盖默认值"，不是"绕过地板"
- 内核默认值仍然是 `DEFAULT_DECAY_HALF_LIFE_MS` / `RECALL_MIN_EFFECTIVE_IMPORTANCE`
- 不传 = 用默认值；传了 = 用配置值
- 这是"端口注入"模式，与 `DeltaCapConfig` 同款

### 4.5 ⚠️ Qdrant 版的双层判定为什么是反模式？

**因为两份判定迟早漂移。**

- 现在：内核用硬编码卡一道，B 层再用配置卡一道
- 如果内核改了判定规则（比如加了新的过滤条件），B 层不知道，双层判定就不一致了
- 统一到内核纯函数里，一份判定，一处真相

---

## 5. 边界约束

### 5.1 内核改动（2 个文件）

1. `src/engine-core/memory/recall-policy.ts` —— `evaluateRecallCandidate` 加 `RecallPolicyOptions` 可选参数
2. `src/engine-core/in-memory/in-memory-memory.store.ts` —— `InMemoryMemoryStoreOptions` 加 `recallPolicy?` 配置端口

### 5.2 适配层改动（1 个文件）

1. `src/engine-adapters/persistence/qdrant-memory.store.ts` —— 消除双层判定，直接传配置值给内核

### 5.3 不碰的地方

- ❌ 不改 `MemoryRecallQuery` 端口（查询参数不变）
- ❌ 不改 `MemoryHit` / `MemoryEntry` 结构（数据形状不变）
- ❌ 不改 `conflict-resolution.ts`（冲突消解逻辑不变）
- ❌ 不改 `.env` / 配置文件（配置端口已经有了，只是接线到内核）
- ❌ 不改 `MemoryStore` 端口接口（方法签名不变）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] `evaluateRecallCandidate` 不传 options 时，行为与现在逐字一致（零回归）
- [ ] `evaluateRecallCandidate` 传 `halfLifeMs` 时，用配置值算有效重要度
- [ ] `evaluateRecallCandidate` 传 `minEffectiveImportance` 时，用配置值卡阈值
- [ ] 内存版 `InMemoryMemoryStore` 可以通过 `recallPolicy` 配置召回策略
- [ ] Qdrant 版消除了双层判定，直接传配置值给内核

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只改 2 个文件（`recall-policy.ts` / `in-memory-memory.store.ts`），纯函数扩展

### 6.3 测试用例要求

扩展文件：
- `test/engine-core/wp2-memory.spec.ts` —— 内核纯函数测试
- `test/engine-adapters/wp12-memory-closeout.spec.ts` —— Qdrant 版配置测试

至少补充：
1. `evaluateRecallCandidate` 不传 options = 用默认值（零回归）
2. `evaluateRecallCandidate` 传 `halfLifeMs` = 用配置值算有效重要度
3. `evaluateRecallCandidate` 传 `minEffectiveImportance` = 用配置值卡阈值
4. 内存版 `recallPolicy` 配置生效
5. Qdrant 版消除双层判定后，行为与配置值一致（不是"取交集"）

---

## 7. 本期没做的（明确留给后续）

1. **召回结果的多样性保证** —— 现在召回可能返回 5 条都是同一主题的记忆，需要多样性保证。那是后面的事
2. **召回时的去重/聚类** —— 现在是写入时做冲突消解，召回时不做。那是后面的事
3. **Admin Dashboard 展示召回配置** —— 那是前端的事，本期只做后端
4. **召回策略的临床校准** —— 本期是工程种子值，内测后按真实对练校准

---

## 8. 转述给后端的话术

> WP59：记忆召回策略配置端口统一。
>
> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 任务单在 `docs/worklog/pending/wp59-recall-policy-config-port-2026-11-04.md`。
>
> **预批准改 engine-core**，但只是纯函数扩展（加可选参数，向后兼容）：
> - `recall-policy.ts` —— `evaluateRecallCandidate` 加 `RecallPolicyOptions` 可选参数
> - `in-memory-memory.store.ts` —— `InMemoryMemoryStoreOptions` 加 `recallPolicy?` 配置端口
>
> 适配层改 1 个文件：
> - `qdrant-memory.store.ts` —— 消除双层判定，直接传配置值给内核
>
> 关键口径：
> - 可选参数，不传 = 用默认值 = 行为与现在逐字一致（零回归）
> - 消除 Qdrant 版的"双层判定"复杂度（内核卡一道 + B 层再卡一道 = 取交集）
> - 内存版和 Qdrant 版行为统一（开发期测出来的召回结果，生产环境换 Qdrant 版也一样）
> - 配置值是"覆盖默认值"，不是"绕过地板"（端口注入模式，与 `DeltaCapConfig` 同款）
>
> 任务单里所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 交付按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 9. 交付后补记（2026-11-04）

> 交付记录：[`engine-wp59-recall-policy-config-port-implementation-2026-11-04.md`](engine-wp59-recall-policy-config-port-implementation-2026-11-04.md)
> 下面这张表登记**与任务单原文的偏差**，每条都有理由。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §5.2「适配层改动（1 个文件）：`qdrant-memory.store.ts`」 | 改了 **4 个 B 层文件**（`qdrant-memory.store.ts` / `memory-config.ts` / `engine.providers.ts` / `engine.module.ts`，最后一个仅注释） | ① `memory-config.ts` 顶部"内核地板不可绕过 / 阈值只能收紧"在本单后**变成假话**，必须同步；② `engine.providers.ts` 不接 → 内存版 `recallPolicy` 端口在生产上是死代码，§4.3 问的"两版行为会一致吗"答案就是**不会**（纯内存部署此前完全忽略 env 配置）；③ `engine.module.ts` 的同一句注释也要同步。详见交付记录 §2.1 |
| 2 | §3.1 草图把两个 `??` 内联进 `evaluateRecallCandidate` | 抽成 `resolveRecallPolicy(options)` helper | 该函数实测圈复杂度 **19**，eslint 上限 20 —— 内联两个 `??` 是 **21**，直接越线。抽 helper 后本体仍是 19，功能与草图等价 |
| 3 | §6.2「`git diff --stat HEAD -- src/engine-core` → 只改 2 个文件」 | **恰好 2 个文件** ✓ | 但代价是内核端口类型 `RecallPolicyOptions` **不进 barrel**：适配层深路径 import 内核内部模块会被边界断言 ⑪ 拦下，加 barrel 导出要改 `index.ts` + 边界断言 ⑥ 的白名单 = **第三个内核文件**，超预批准范围。B 层改用结构化类型，编译期仍受校验。详见交付记录 §2.3 |
| 4 | §3.3「删掉双层判定的第二道门槛」 | 照做，但**顺带把排序口径也收口**（排序用的有效重要度改为直接取内核算出的同一个值，不再 B 层复算） | 复算 = 两份公式迟早漂移（`memory-config.ts` 顶部注释里明写的教训）。数值完全相同，不是行为变化 |
| 5 | 任务单未提"装配层接线" | 装配层 `createEngineMemoryStore` 把同一份配置喂给内存版 | §5.3 原话"配置端口已经有了，只是接线到内核"指的就是这一步。不接 = 端口在生产上没人用 = 本单白做 |
| 6 | 任务单未提"回落仓" | Qdrant 版内置回落仓也喂同一份策略 | 否则"向量库抖一下 → 召回结果换一套"——最难查的那种漂移。详见交付记录 §2.6 |
| 7 | §2 盘点说"Qdrant 版双层判定 = 取交集 = 更严" | 补充数学结论：新接受集合 **⊇** 旧接受集合，**只会变宽不会变严** | 旧条件 = `eff_默认 ≥ 0.1 ∧ eff_配置 ≥ 阈值`，新条件 = `eff_配置 ≥ 阈值`（旧的后件）→ 恒成立。默认配置下两者完全相同（零回归）。详见交付记录 §2.4 |
| 8 | §6.3 用例清单（5 条） | **全部实现**，另加 **5 例**（映射函数 1 例 + 装配/回落仓口径相关断言散在上述 5 例里） | 用例总数：wp2 spec 39 → 44，wp12 spec 35 → 40，全量 1526 → **1536** |
| 9 | 未提测试基础设施缺口 | `StubQdrant.search` 从"恒返回空数组"改成可注入检索点 | 之前**Qdrant 版的召回路径从没被任何测试走通过**，判定只能靠读代码确认。详见交付记录 §2.8 |

**闸门**：eslint 0 error / tsc 0 error / vitest **97 文件 1536 例全绿** / `git diff --stat HEAD -- src/engine-core` = **2 个文件** / `boundary.spec.ts` 11 条不变量全绿。

---

_创建：2026-11-04_
_深度通知：`evaluateRecallCandidate` / `effectiveImportance` / `InMemoryMemoryStoreOptions` / `MemoryConfig` / Qdrant 双层判定 / boundary.spec.ts 白名单，全部 grep 核实_
