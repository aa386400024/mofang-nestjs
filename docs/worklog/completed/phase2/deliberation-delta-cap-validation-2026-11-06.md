# 约束校验层 · 审议输出逐维 delta cap

> **状态**：✅ 已交付（2026-11-06）→ [`engine-deliberation-delta-cap-validation-implementation-2026-11-06.md`](engine-deliberation-delta-cap-validation-implementation-2026-11-06.md)
> **路径**：`docs/worklog/completed/phase2/deliberation-delta-cap-validation-2026-11-06.md`
> **优先级**：🔴 P0（切灰度前置安全网）
> **引擎内核**：✅ **零改动**（直接 import 内核现有 `capTurnDelta` + `DEFAULT_DELTA_CAP_CONFIG`，不自己写一套）
> **前置依赖**：WP63（Schema 设计）/ WP64（影子模式 PoC）/ WP65 后半段（mutex + 快照版本号）
> **北极星**：[`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 约束校验层

## 一、为什么做这个（问题与目标）

### 现状背景

影子模式下审议结果不写 BDI 快照，只写 trace。但**切灰度（审议结果开始生效）之前必须补约束校验层**——否则 LLM 输出个离谱的 delta（比如 trust 一下加 0.5），直接落快照就把状态搞崩了。

**现有校验的缺口：**

1. **格式校验是粗口径统一 0.2**——`DELIBERATION_MAX_ABS_DELTA = 0.2`，一刀切。但内核 `DEFAULT_DELTA_CAP_CONFIG` 里移情三维（positive / negative / dependency）是 ±0.15，比 0.2 更严。切灰度后如果 LLM 输出了移情维度 delta=0.18，按统一 0.2 是合法的，但按内核 cap 是越界的。

2. **没有"被砍的记录"**——现在超了直接丢，不记录砍了多少。切灰度后出问题没法观测。

### 目标

切灰度前置安全网：审议输出在格式校验通过后，再过一道逐维 cap 砍幅，与规则算子同一口径。被砍的 delta 不丢，砍到边界，砍幅记录进 trace。

---

## 二、开工前核实清单（6 条，开工前逐条确认）

> ⚠️ 这 6 条是大炮扫完代码后整理的，后端开工前必须自己再 grep 一遍核实，不能只凭这份清单。

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | 内核 `capTurnDelta` / `DEFAULT_DELTA_CAP_CONFIG` / `DeltaCapConfig` 都在 barrel 导出了 | ✅ 已确认（`src/engine-core/index.ts:160, 176, 180`） |
| 2 | 现有格式校验里有统一 0.2 粗口径上限（`DELIBERATION_MAX_ABS_DELTA`） | ✅ 已确认（`llm-deliberation.service.ts` 的 `validateDeltaEntry`） |
| 3 | 审议 delta 是稀疏的（只含有变化的维度） | ✅ 已确认（`deliberationDelta: Partial<Record<DeliberationDim, number>>`） |
| 4 | 规则算子 delta 是全量的（11 维全有） | ✅ 已确认（`ruleDelta: DeltaVector`） |
| 5 | trace 里没有 capEntries 字段 | ✅ 已确认（`DeliberationTraceRecord` 接口里没有） |
| 6 | `capAsym` 是严格大于 / 严格小于（等于边界不砍） | ✅ 已确认（`state-transition.ts:472` 的 `if (value > up) return up; if (value < down) return down;`） |

---

## 三、技术方案

### 核心思路

**两道校验，各司其职：**

1. **格式校验（现有）**——防离谱：维度白名单 + 统一 0.2 粗口径 + 标签合法 + reason 非空。保留不动。
2. **业务校验（新增）**——按标准砍：格式校验通过后，再过一道逐维 delta cap，与规则算子同一口径。被砍的记录进 trace。

**为什么不替换现有 0.2 校验：**
- 格式校验是"防离谱"（NaN / Infinity / 超大数字）
- 业务校验是"按标准砍"（与规则算子同一口径）
- 两道不重复：一个是底线，一个是标准

### 适配稀疏 delta

`capTurnDelta` 接受全量 DeltaVector（11 维全有），但审议输出是稀疏的。

**解法：**
1. 把稀疏的审议 delta **补成全量**（没提到的维度补 0）
2. 调 `capTurnDelta` 砍幅
3. 砍完后再**提取非零维度**（`!== 0`），放回稀疏结构

---

## 四、写入侧（详细设计）

### 4.1 新增函数：`applyDeliberationDeltaCap`

**位置**：`src/engine-adapters/deliberation/llm-deliberation.service.ts`

**职责**：对校验通过的审议 delta，逐维过 cap 砍幅，返回砍后的稀疏 delta + 砍幅明细。

**接口**：
```typescript
/**
 * 审议输出的逐维 delta cap 砍幅 (约束校验层).
 *
 * 与规则算子同一口径 (复用内核 capTurnDelta), 切灰度前的安全网.
 * 影子模式下只是观测: trace 里记砍幅, 不影响主流程.
 */
export function applyDeliberationDeltaCap(
  deltas: readonly DeliberationDeltaEntry[],
): {
  /** 砍后的稀疏 delta 列表 (维度 + delta + 标签 + 理由不变, 只改 delta 数值). */
  cappedDeltas: readonly DeliberationDeltaEntry[];
  /** 被砍的维度明细 (raw !== capped 才进). */
  capEntries: readonly DeliberationCapEntry[];
}
```

### 4.2 新增类型：`DeliberationCapEntry`

**位置**：同文件

```typescript
/** 单维被砍的明细 (约束校验层). */
export interface DeliberationCapEntry {
  /** 维度名 (trust / safety / ...). */
  readonly dimension: DeliberationDim;
  /** 砍之前的原始 delta. */
  readonly raw: number;
  /** 砍之后实际生效的 delta. */
  readonly capped: number;
}
```

### 4.3 调用点：`validateDeliberationOutput` 之后

**位置**：`executeShadowMode` 里，`validateDeliberationOutput` 返回后。

**流程**：
1. 现有：`validateDeliberationOutput(raw)` → 返回 `ValidatedDeliberation`（格式校验通过的）
2. **新增**：`applyDeliberationDeltaCap(validated.output.deltas)` → 返回 `{ cappedDeltas, capEntries }`
3. 用 `cappedDeltas` 替换原来的 `deltas`（后续 trace 记录用砍后的）
4. `capEntries` 塞进 trace

### 4.4 trace 加字段：`capEntries`

**位置**：`DeliberationTraceRecord` 接口

**改动**：
```typescript
export interface DeliberationTraceRecord {
  // ... 现有字段 ...

  /**
   * 约束校验层: 逐维 delta cap 砍幅明细 (约束校验层).
   *
   * 只记被砍的维度 (raw !== capped). 没被砍的维度不出现.
   * 影子模式下只是观测, 切灰度后砍后的 delta 才是实际生效的.
   */
  readonly capEntries: readonly DeliberationCapEntry[];
}
```

**注意**：
- `deliberationDelta` 字段存**砍后**的稀疏 delta（不是 raw 的）
- `deltaDiff` 的计算口径：两边都过 cap 后再比（审议 capped - 规则 capped），才是公平对比
- `capEntries` 只记被砍的维度，没被砍的不进

### 4.5 capConfig 用缺省值

**口径**：直接用 `DEFAULT_DELTA_CAP_CONFIG`（内核种子值），不做 env 覆写。

**理由**：
- 影子模式下只是观测，切灰度时再与规则算子统一注入同一份 config
- 现在加 env 覆写 = 提前做了个没人用的开关

---

## 五、读取侧（详细设计）

本期**不新增 admin 查询接口**——capEntries 直接出现在 Redis trace 的 JSON 里，现有的 debug 面板查 trace 的接口已经能看到。

---

## 六、开关与配置

### 6.1 现有开关复用

- `ENGINE_DELIBERATION_ENABLED`——审议总开关，关着就啥都不跑（包括 cap 砍幅）
- 不需要新增 env 开关——cap 是审议的内部机制，审议开了就该有 cap

---

## 七、隐私与安全

1. **capEntries 里只有数字**——维度名 + raw + capped，不是心理内容
2. **日志只出定位信息**——砍幅是正常观测，不打对话原文
3. **租户隔离**——trace 本来就带租户，不会串号

---

## 八、反双胞胎（刻意不做的事）

1. **不做"临床合理性"校验**——本期只做逐维 delta cap（与规则算子同一口径）。"临床合理性"是更大的话题，切灰度后真出问题了再补。
2. **不做 env 覆写 capConfig**——先用缺省值，切灰度时再与规则算子统一注入。
3. **不做审议结果写回快照**——那是切灰度的事，本期只是把校验层建好。
4. **不做 admin 前端面板**——trace 里已经有了，debug 面板能查。
5. **不改内核**——直接 import 内核的 `capTurnDelta` + `DEFAULT_DELTA_CAP_CONFIG`，不自己写一套。
6. **不替换现有 0.2 格式校验**——两道各司其职：格式校验防离谱，业务校验按标准砍。

---

## 九、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动（直接 import 内核现有函数，不改内核代码） |
| 5 | cap 口径 | 移情三维 delta=0.18 → 砍到 0.15；trust delta=0.25 → 砍到 0.2 |
| 6 | 边界 | delta 正好等于边界（比如 0.2 = up 0.2）→ 不砍 |
| 7 | 稀疏适配 | 稀疏 delta 补全后砍幅，再提取非零维度，不丢不增 |
| 8 | trace 记录 | 砍后的 delta 进 deliberationDelta，砍幅明细进 capEntries |

---

## 十、交付物清单

1. **新增函数**：`applyDeliberationDeltaCap` + `DeliberationCapEntry` 类型（`llm-deliberation.service.ts`）
2. **调用点**：`validateDeliberationOutput` 之后加一步 cap 砍幅
3. **trace 加字段**：`DeliberationTraceRecord` 加 `capEntries`
4. **deltaDiff 口径调整**：两边都过 cap 后再比
5. **单测**：`test/engine-adapters/wp-deliberation-delta-cap.spec.ts`

---

## 十一、commit message 草稿

```
feat(deliberation): 约束校验层 - 审议输出逐维 delta cap

格式校验通过后再加一道逐维 cap 砍幅, 与规则算子同一口径.
被砍的 delta 不丢, 砍到边界, 砍幅明细进 trace.
切灰度前置安全网, 影子模式下只是观测.
```

---

## 十三、交付后补记（2026-11-06）

> 交付记录：[`engine-deliberation-delta-cap-validation-implementation-2026-11-06.md`](engine-deliberation-delta-cap-validation-implementation-2026-11-06.md)
> 下表逐条登记**与任务单原文的偏差**，每条都能自圆其说。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §九 闸门 5「移情三维 delta=0.18 → 砍到 0.15；**trust delta=0.25 → 砍到 0.2**」 | 移情三维照办；**trust=0.25 这条走完整管道时不可达** —— 格式校验的统一 0.2 粗口径（`validateDeltaEntry`：`Math.abs(delta) > 0.2` → reject）会先把它拒掉（进 `rejectedEntries`），压根到不了 cap | 推论更要紧：格式校验的 ±0.2 与内核 cap 的**上向 0.2 完全重合** → cap 层在**除移情三维外的所有维度上都不会产生任何效果**（0.2 不 > 0.2）。**这与 §一 自己的判断一致**（§一 说"移情三维 ±0.15 比 0.2 更严"）—— §一 对，闸门 5 的 trust 例子错。落法：用例 ①-2 直接调 cap **纯函数**验 trust 0.25 → 0.2，用例 ①-1 / ⑤-1 验走管道真正会触发的移情 0.18 → 0.15，用例 ⑥-1 把"0.25 到不了 cap"钉死。**另**：内核 cap 的**下向**边界（-0.30 / -0.20）被格式校验的 ±0.2 完全遮住 —— 切灰度若想让审议给出更狠的信任跌幅，得先放宽格式校验的下向口径。详见交付记录 §2.1 |
| 2 | §四.3 调用点：「位置：`executeShadowMode` 里，`validateDeliberationOutput` 返回后」 | 放在 **`buildSuccessRecord` 内部**（同一数据流，但更靠里一层） | 结构性地保证"**进 trace 的 delta 一定过了约束校验层**"。放调用点的话，将来有人从别处调 `buildSuccessRecord` 忘了砍 → trace 混进没砍过的 delta，而影子期**看不出任何差别**（结果不生效），切灰度就是状态错乱。`applyDeliberationDeltaCap` 是**导出的纯函数**，切灰度落快照那条链直接复用，签名已预留 config 参数位。详见交付记录 §2.2 |
| 3 | §三 适配稀疏 delta：「1. 补成全量（没提到的补 0）2. 调 `capTurnDelta` 砍幅 3. 砍完后再**提取非零维度**，放回稀疏结构」 | 用**逐条探针**：每条 entry 造一个"只有该维度带值、其余全 0"的向量喂给内核 `capTurnDelta`，读回该维度的值 | 整向量往返有三个问题：① **丢 entry 的标签与理由**（`entries` 是人工复核主字段，而 map 只有数值 —— 与 §4.1 "标签 + 理由不变"矛盾）；② **改掉稀疏 map 的既有语义**（"提取非零"会把模型明确提到但 delta=0 的维度抹掉 → PoC "模型提到了多少维"的统计漂移）；③ **模型可能对同一维度给多条建议**（格式校验不拦重复维度），整向量往返只能拿到"最后一个值"的砍幅，前面几条会被算成别的值。探针法成立前提（已核实）：`capTurnDelta` **逐维独立**处理，别的维是 0 不干扰。代价 N 次调用（N ≤ 11），可忽略。**判定只有一份** —— 复用内核函数，不自己写 clamp。详见交付记录 §2.3 |
| 4 | §4.5「直接用 `DEFAULT_DELTA_CAP_CONFIG`（内核种子值），不做 env 覆写」 | **照办**，但记下一条**临时分歧** | 仓库**已有** env 驱动的 cap 装配器 `src/engine-adapters/wiring/delta-cap.config.ts` 的 `resolveDeltaCapConfig(config)`（22 个 `ENGINE_CAP_*` 键，WP26 P2-14 做的）—— **规则算子用的是它**（可 env 覆写），**审议层用的是种子值**。生产若调了 `ENGINE_CAP_*`，两侧边界就不一致。影子期无害（只观测）；切灰度前必须统一（好消息：接线零成本）。详见交付记录 §2.4 |
| 5 | §4.4「`deltaDiff` 的计算口径：两边都过 cap 后再比（审议 capped - 规则 capped）」 | **规则侧不需要任何额外代码** —— 它本来就是砍过的 | 审议入参的 `ruleDelta` 来自门面的 `computeRuleDelta(baseSnapshot, output.snapshot)` = 落库后快照 − 落库前快照的逐维差；而内核在落库**之前**已对本轮总 delta 过了一次 `capTurnDelta`（WP15 §1.1）→ 落库后的快照反映的就是砍过的状态。所以本单只砍审议侧（`deliberationDelta` / `entries` / `deltaDiff` 三处改用砍后的值）。**这不是偏差，是核实结论**。详见交付记录 §2.5 |
| 6 | §二 核实清单第 6 条「`state-transition.ts:472`」 | 行号对得上（`capAsym` 确实在 472），但**目录少一层**：实际在 `src/engine-core/cognition/state-transition.ts`，任务单写的是 `src/engine-core/domain/cognition/state-transition.ts` | 核实结论本身成立（`if (value > up) return up; if (value < down) return down;` = **严格大于 / 严格小于**，等于边界不砍 → 闸门 6 照办）。只是路径写错一层，已在本单所有文档里用真实路径 |
| 7 | §四.1 函数签名（返回 `{ cappedDeltas, capEntries }`） | **照办**，只把两个字段标了 `readonly`（与本文件既有接口风格一致） | —— 一致，无偏差 |
| 8 | §十 交付物 4「deltaDiff 口径调整：两边都过 cap 后再比」 | **无需改代码**（见第 5 条） | 规则侧天然是砍过的 |
| 9 | §五 读取侧「不新增 admin 查询接口」 | **照办**；另外核实 admin 侧是 `JSON.parse(raw) as DeliberationTraceRecord` **透传**（无字段枚举）→ 加 `capEntries` 字段对 admin 接口**形状零影响** | —— 一致，无偏差 |

**闸门**：eslint **0 problem**（`npx eslint "{src,test,bin}/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **125 文件 2136 例全绿**（基线 124 文件 / 2114 例 → 本单 **+1 文件 / +22 例**，既有 2114 例零回归）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿 / **不新增 env 开关**（复用 `ENGINE_DELIBERATION_ENABLED`）/ 现有 0.2 格式校验**一行未动**。
