# WP42：咨询同盟三维（trust / safety / bond 独立建模）

> 状态: ✅ 已交付（2026-11-03）→ [`engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md`](engine-wp42-counseling-alliance-three-dimensions-implementation-2026-11-03.md)
> 优先级: 🟡 P1（专业能力主线）
> 预估: 中
> 依赖: WP34 人格调节算子（已交付 ✅）

---

## 1. 背景

现在 BDI 快照里只有一个 `trust: number`（`src/engine-core/domain/bdi-snapshot.ts:69`），把"信任"、"安全感"、"纽带感"混在一起。

临床里这是三个不同的东西：
- **Trust（信任）**：来访者相信咨询师是专业的、不会评判自己
- **Safety（安全感）**：来访者在这个关系里感到安全，可以敞开心扉
- **Bond（纽带感）**：来访者跟咨询师有情感连接，不是冷冰冰的问诊

现在的问题：一个来访者可能 trust 很高（相信咨询师专业），但 safety 很低（不敢说真实想法）——但系统分不清，一律按 trust 高处理，直接进探索模式，效果不对。

---

## 2. 任务目标

把单一 `trust` 拆成三个独立维度：`trust` / `safety` / `bond`，加基础 delta 规则和 intention-planner 三维决策。

---

## 3. 具体改动（全部基于真实代码盘查）

### 3.1 BdiSnapshot 加字段

**文件**：`src/engine-core/domain/bdi-snapshot.ts`

在 `trust: number`（第 69 行）下面加两个字段：
```typescript
readonly safety: number;   // 安全感 0~1
readonly bond: number;     // 纽带感 0~1
```

**构造点同步改**（代码里真实存在的两个函数）：
- `createEmptyBdiSnapshot()`（第 79 行）→ 内部调 `buildInitialSnapshot()`，要加 `safety: 0.5, bond: 0` 的初始值
- `cloneBdiSnapshot()`（第 89 行）→ 展开对象时加 `safety: snapshot.safety, bond: snapshot.bond`

### 3.2 DeltaVector 加字段

**文件**：`src/engine-core/cognition/state-transition.ts`

`DeltaVector` interface（第 90 行）加：
```typescript
readonly safety: number;
readonly bond: number;
```

`ZERO` 常量（第 102 行）加 `safety: 0, bond: 0`。

### 3.3 DELTA_TABLE 加基础规则

**文件**：`src/engine-core/cognition/state-transition.ts`

`DELTA_TABLE`（第 123 行）是 `Readonly<Record<CounselorEventKind, DeltaVector>>`。**真实的 11 种事件类型**（`session-event.ts:13-24`）：

| 事件 kind | 现有 trust delta | 新增 safety delta | 新增 bond delta | 说明 |
|---|---|---|---|---|
| empathy | +0.10 | +0.02 | +0.01 | 共情既涨信任也涨安全感，纽带涨得慢 |
| acceptance | +0.08 | +0.02 | +0.01 | 接纳同理 |
| normalization | +0.07 | +0.01 | +0.01 | 正常化弱修复 |
| open_probe | +0.05 | +0.01 | 0 | 开放探问涨安全感，不涨纽带 |
| affirmation | +0.08 | +0.01 | +0.01 | 肯定涨纽带 |
| judgment | -0.12 | -0.03 | -0.02 | 评判打击安全感，纽带也受损 |
| preaching | -0.10 | -0.02 | -0.01 | 说教弱化版评判 |
| minimizing | -0.10 | -0.02 | -0.02 | 淡化让来访感到不被理解 |
| boundary_cross | -0.15 | -0.05 | -0.04 | 边界侵犯是最严重的同盟破裂 |
| sensitive_touch | 0 | -0.01 | 0 | 触碰敏感议题，安全感略降但不是破坏性的 |
| neutral | 0 | 0 | 0 | 零 delta |

> ⚠️ 系数是工程种子值，注释里写清楚"待真实对练校准"。

### 3.4 intention-planner 用三维做决策

**文件**：`src/engine-core/cognition/intention-planner.ts`

现在第 31-39 行用 `snapshot.trust` 做"抗拒 vs 探索"的决策。改成：
- **探索模式的门槛**：`min(trust, safety) >= OPEN_TRUST` —— 信任和安全感都够，才敢探索
- **抗拒模式的触发**：`trust < 0.4 || safety < 0.3` —— 任一维度低就抗拒

理由：来访可能 trust 高（相信你专业）但 safety 低（不敢说），这时不该进探索模式。

### 3.5 personality-modulator 暂不扩展

**文件**：`src/engine-core/cognition/personality-modulator.ts`

本期**不改**人格调节算子——依恋系数只调 trust，safety/bond 不调。理由：任务单没给依恋对安全感/纽带的影响系数，不发明临床数字。端口和契约就位，内测有反馈再补。

### 3.6 CAP_DIMS 加新维度

**文件**：`src/engine-core/cognition/state-transition.ts`

`CAP_DIMS`（第 84 行，真实名字是 `CAP_DIMS` 不是 `CAP_DIMENSIONS`）：
```typescript
const CAP_DIMS = ['trust', 'valence', 'arousal', 'verbal', 'depth', 'style', 'positive', 'negative', 'dependency'] as const;
```

加 `'safety'` 和 `'bond'`，默认 cap 值跟 trust 一样（±0.20 / ±0.30 不对称）。

`.env.example` 里对应加 `ENGINE_CAP_SAFETY_UP/DOWN`、`ENGINE_CAP_BOND_UP/DOWN`（留空，继承内核默认值）。

---

## 4. 红线检查

- ✅ **预批准改 engine-core**（已在 WP 清单登记为例外）
- ✅ 改完必须通过 `boundary.spec.ts` 的 11 条断言（零 NestJS / 零网络 / 零 prompt / 零 process.env）
- ✅ 新字段走注入（`AllianceConfig` 端口），不硬编码到内核
- ❌ 不碰前端代码
- ❌ 不碰 admin-dashboard

---

## 5. 验收标准

1. **单元测试**：同一 empathy 事件，safety 和 bond 各自独立变化，互不干扰
2. **回归测试**：WP1 / WP34 既有用例全部绿（新字段默认值 = 现有 trust 行为不破坏）
3. **边界测试**：safety 很低但 trust 很高时，intention-planner 不进探索模式
4. **闸门**：eslint 0 error / tsc 0 错 / vitest 全绿

---

## 6. 交付闸门

```powershell
npx eslint "src/**/*.ts"                    # → 0 error
npx tsc -p tsconfig.build.json --noEmit     # → 0 error
npx vitest run                              # → 全绿（既有 1321 例 + 新增用例零回归）
git diff --stat HEAD -- src/engine-core     # → 列出改了哪些文件（预批准例外，不是空）
```

---

## 7. 交付格式

按 `team/conventions.md` §2 写交付记录：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（为什么 safety/bond 这么接、intention-planner 怎么用三维）
3. 闸门数字

完成后把本任务单 + 交付记录从 `pending/` 移到 `completed/phase2/`。

---

## 8. 回写

交付完更新 [`phase2-wp-list-2026-11-03.md`](phase2-wp-list-2026-11-03.md) 里 WP42 的状态。

---

_创建：2026-11-03_
