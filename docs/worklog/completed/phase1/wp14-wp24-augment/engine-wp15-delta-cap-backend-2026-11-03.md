# WP15 · 单回合非对称 delta cap + 算子幅度声明 + 边界回归

> 日期：2026-11-03 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 性质：Phase1 M3 内测前护栏——给 BDI 状态迁移加"速率限制"，防多事件叠加一回合跳太多
> 状态：✅ **已交付并复跑绿**（2026-11-03，**未 commit**，改动全在工作区）→ 交付记录: `engine-wp15-delta-cap-backend-implementation-2026-11-03.md`（同目录）
> 口径修正（2026-11-03）：内核 → adapter 的 cap 报告通道改为**观察者回调**（内核模块级单槽、同步触发、**零 logger 依赖**）—— 这是"只动 `state-transition.ts` 一个文件"与"adapter 打日志"两条同时成立的唯一解；代价是内核多一处模块级状态，替代方案（给 `EngineTurnOutput` 加**可选**字段 + `in-memory-engine-session.ts` 透传）要再动 2 个内核文件，详见交付记录 §4.2。
> ⚠️ **两条已知边界**（交付记录 §5 有详述）：① 内核 diff **193 行**（+191 / −2），超过验收 #6 的 "< 80 行" —— 其中约 120 行是中文说明注释，**既有逻辑只改了 2 行**，压行数就得删注释/砍功能，是否接受需拍板；② cap 参数是**工程种子值未标定**，且 cap 只管**单回合总 delta**、不管跨回合累积速度（衰减 / 边际递减 / 饱和 / Prometheus 告警仍留 Phase2）。
> ⚠️ **测试文件放在 `test/engine-core/wp15-delta-cap.spec.ts`**，不按 §1.3 建议放 `src/engine-core/cognition/__tests__/` —— 验收 #6 要求内核只改一个文件，且 `src/` 下的测试文件会被 `tsc -p tsconfig.build.json` 编进 `dist/` 产物、vitest 全局在 `types: ["node"]` 下无类型，详见交付记录 §4.1。
> 🔴 **本单破例改 `src/engine-core/cognition/state-transition.ts` 这一个文件**：用户已松口"底层有问题就是要改"。这不是把基础设施塞进纯层，是给纯层加一条领域不变量（"一回合 BDI 不应该跳太多"），跟现有的 `clamp01` 同类。**不碰端口、不碰 IO、不碰其他 engine-core 文件。**
> 🔗 前置：WP1（状态迁移算子基线）✅。

---

## 0. 为什么有这条

### 0.1 现状

`src/engine-core/cognition/state-transition.ts` 里：
- `DELTA_TABLE`：11 个事件类型 → 9 维度 delta，种子值硬编码。
- `aggregate()`：一回合所有事件 delta × strength 求和。
- `transitionState()`：求和后每个维度单独 `clamp01`/`clampValence`。

clamp 只管"不越 [0,1]"，不管"一回合跳太多"。两个真空：

1. **无单回合幅度上限**：LLM 一回合同时发 empathy(+0.1) + acceptance(+0.08) + affirmation(+0.08)，trust 跳 +0.26；极端情况 5 个正事件 strength=1.0 一起发，trust 跳 +0.4+。心理上不真实——用户说了句话，来访信任就翻倍。
2. **新算子无幅度声明**：DELTA_TABLE 是裸 record，新增事件类型时随手填 `trust: 0.5` 也没人拦。

### 0.2 这不是凑活

单回合 delta cap 就是控制论里的 derivative limit、RL 里的 reward clipping、游戏 AI 里的 max-turn-delta——工业标配。非对称 cap（涨慢跌快）对应心理损失厌恶。

**本期不做**（Phase2，backlog 已划界）：
- 状态衰减（几轮不操作 BDI 慢慢回 baseline）
- 同方向边际递减曲线
- 饱和效应（trust 已 0.95 时小正事件几乎不动）
- Prometheus 溢出告警

这些要等 M3 内测有真实对话日志才能标定参数。

---

## 1. 范围

### 1.1 单回合非对称 delta cap（核心改动）

在 `transitionState()` 里，`aggregate()` 求和之后、应用到快照之前，对每个维度的**总 delta**做一次"单回合 cap"：

- 正 delta（往高了推）超过上向 cap → 砍到上向 cap。
- 负 delta（往低了推）超过下向 cap → 砍到下向 cap。
- 不是 clamp 绝对值（那是最后防线），是砍 delta。

**种子值**（env 可覆写，M3 内测后根据真实对话调）：

| 维度 | 上向 cap（+） | 下向 cap（−） | 理由 |
|---|---|---|---|
| trust | +0.20 | −0.30 | 损失厌恶：信任建慢破快 |
| valence | +0.20 | −0.30 | 同上 |
| arousal | ±0.20 | ±0.20 | 激活度对称 |
| resistance.verbal | ±0.20 | ±0.20 | 阻抗三维对称 |
| resistance.depth | ±0.20 | ±0.20 | |
| resistance.style | ±0.20 | ±0.20 | |
| transference.positive | ±0.15 | ±0.15 | 移情涨得慢 |
| transference.negative | ±0.15 | ±0.15 | |
| transference.dependency | ±0.15 | ±0.15 | |

实现提示：
```ts
function capTurnDelta(raw: DeltaVector): DeltaVector {
  return {
    trust: capAsym(raw.trust, +0.20, -0.30),
    valence: capAsym(raw.valence, +0.20, -0.30),
    // ...
  };
}
function capAsym(v: number, up: number, down: number): number {
  if (v > up) return up;
  if (v < down) return down;
  return v;
}
```

cap 常量从 env 读（如 `ENGINE_CAP_TRUST_UP=0.20`），默认值硬编码在文件顶部。这样后期调参不用改代码。

### 1.2 DELTA_TABLE 加幅度声明注释

每个事件类型旁边注释一行"本事件 trust delta 范围"，方便后期新增算子时对照：

```ts
empathy: {
  // 正向修复算子：trust +0.10（单事件已达上向 cap 的 50%）
  trust: 0.1,
  // ...
},
boundary_cross: {
  // 重大损害算子：trust -0.15（单事件已达下向 cap 的 50%）
  trust: -0.15,
  // ...
},
```

新增算子时如果 delta 超过单回合 cap 的 80%，在注释里标 `⚠️ 接近 cap`。

### 1.3 边界回归测试

新增一组测试（放 `src/engine-core/cognition/__tests__/state-transition.cap.test.ts`）：

1. **多事件叠加不越 [0,1]**：构造初始 trust=0.9、valence=0.9 的快照，叠 5 个 boundary_cross + judgment（负向事件），断言输出所有维度在 [0,1]。
2. **单回合 cap 真的砍**：构造初始 trust=0.5，叠 3 个 empathy（+0.1×3=+0.3），断言输出 trust ≤ 0.5 + 0.20 = 0.70（被 cap 砍了 0.10）。
3. **下向 cap 不对称**：初始 trust=0.5，叠 3 个 boundary_cross（-0.15×3=-0.45），断言输出 trust ≥ 0.5 - 0.30 = 0.20。
4. **既有用例零回归**：现有 state-transition 测试全绿。

### 1.4 cap 砍断时打 warning 日志

当 delta 被 cap 砍断时（即 `raw !== capped`），在 `transitionState()` 里打一条 warning：
```
[WP15] turn delta capped: trust raw=+0.30 capped=+0.20 events=[empathy,acceptance,affirmation]
```

注意：engine-core 是纯层，不能直接打 logger。把"是否被砍、砍了多少"作为返回值的附属信息带出来（比如 `{ snapshot, capped: { trust: 0.10, ... } }`），由 adapter 层决定打不打日志。不要在纯层里 import logger。

---

## 2. 不做

- ❌ 状态衰减 / 边际递减曲线（Phase2）
- ❌ 饱和效应（Phase2）
- ❌ Prometheus 溢出告警（Phase2）
- ❌ 改 DELTA_TABLE 种子值本身（本期只加 cap，不调参）
- ❌ 改其他 engine-core 文件
- ❌ 改 adapter / voice / gateway 层（除了接收 capped 信息打日志）

---

## 3. 验收

1. `state-transition.ts` 加了 `capTurnDelta()`，9 个维度都有上向/下向 cap。
2. cap 常量可从 env 覆写，默认值在文件顶部。
3. DELTA_TABLE 每个事件有幅度声明注释。
4. 新增 4 条边界回归测试全绿。
5. 现有 1115 例测试零回归。
6. engine-core 改动仅限 `state-transition.ts` 一个文件（diff 行数 < 80）。
7. tsc 0 error / eslint 0 warning。
8. capped 信息通过返回值带出，adapter 层打 warning 日志。

---

## 4. 交付后回写

- 更新 backlog 母版 §WP15 状态行 → ✅ 已交付
- 交付记录放 `docs/worklog/completed/wp14-wp24-augment/engine-wp15-delta-cap-backend-implementation-<date>.md`
