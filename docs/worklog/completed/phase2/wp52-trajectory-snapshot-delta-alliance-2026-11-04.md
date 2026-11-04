# WP52 任务单 — 剧本偏移接入同盟三维（safety / bond）

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp52-trajectory-snapshot-delta-alliance-implementation-2026-11-04.md`](engine-wp52-trajectory-snapshot-delta-alliance-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp52-trajectory-snapshot-delta-alliance-2026-11-04.md`
> **优先级**：🟢 P2
> **引擎内核**：✅ 预批准改 engine-core（剧本契约扩展，与 WP42 / WP3 同文件同范式）
> **前置依赖**：WP3（轨迹剧本）、WP42（同盟三维）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 推理层

---

## 1. 任务概述

### 1.1 一句话目标

WP42 把同盟拆成了 trust/safety/bond 三维，但**剧本（trajectory）的 `SnapshotDelta` 只有 trust**——剧本写"来访敞开心扉谈童年创伤"，只涨 trust 不涨 safety/bond，剧本叙事推不动同盟发展。本期把 safety / bond 接入 `SnapshotDelta`，让剧本也能推动同盟三维变化。

### 1.2 为什么现在做

- WP42 文件头注释自己登记了缺口：`toDeltaVector` 里 safety/bond 固定为 0，"剧本契约 (SnapshotDelta) 本期没有这两项"（`trajectory-applier.ts:133-135`）
- 现在剧本是半残的：写"来访开始信任咨询师"只涨 trust，不涨安全感和纽带——但临床叙事上，"敞开心扉谈童年创伤"这件事，trust 涨的同时 safety 也应该涨
- 内测时会出现：剧本推到"破裂修复"那一幕，trust 回来了，但 safety/bond 还是平的——修复感在状态上看不出来

---

## 2. 现状盘查结论（已 grep 全 engine-core 核实）

### 2.1 现有 SnapshotDelta 结构（`domain/trajectory/script.ts:85-90`）

```ts
export interface SnapshotDelta {
  readonly trust?: number;
  readonly resistance?: Partial<BdiResistance>;
  readonly emotion?: { readonly valence?: number; readonly arousal?: number };
  readonly transference?: Partial<TransferenceState>;
}
```

四个维度都有，**缺 safety / bond**。

### 2.2 toDeltaVector 转换函数（`cognition/trajectory/trajectory-applier.ts:137-152`）

```ts
function toDeltaVector(delta: SnapshotDelta | undefined): DeltaVector | undefined {
  if (!delta) return undefined;
  return {
    trust: delta.trust ?? 0,
    safety: 0,        // ← 固定为 0，缺口在这里
    bond: 0,          // ← 固定为 0，缺口在这里
    verbal: delta.resistance?.verbal ?? 0,
    depth: delta.resistance?.depth ?? 0,
    style: delta.resistance?.style ?? 0,
    valence: delta.emotion?.valence ?? 0,
    arousal: delta.emotion?.arousal ?? 0,
    positive: delta.transference?.positive ?? 0,
    negative: delta.transference?.negative ?? 0,
    dependency: delta.transference?.dependency ?? 0,
  };
}
```

注释明确写了（第 133-135 行）：
> WP42: 同盟三维的 safety / bond 固定为 0 —— 剧本契约 (`SnapshotDelta`) 本期没有这两项, 任务单也没给剧本的同盟三维口径. 与其发明一个没依据的数, 不如让它不动 (事件 delta 仍照常推进这两维).

### 2.3 DeltaVector 维度（11 个）

trust / **safety** / **bond** / verbal / depth / style / valence / arousal / positive / negative / dependency

—— safety 和 bond 已经是 delta 维度了（WP42 加的），转换函数只是**没把 SnapshotDelta 的值接进来**。

### 2.4 管道顺序与 cap 位置（`in-memory-engine-session.ts:385-394`）

```
事件聚合 eventDelta
  + 剧本 trajectory.delta (toDeltaVector 转出来的)
  → addDeltaVectors 合并
  → 统一过一次 cap (cappedTotal)
  → applyDeltaVector 落快照
  → 信念演化
```

**关键**：剧本 delta 和事件 delta 是**合并后统一过 cap**的，不是各自过 cap。这意味着：
- 如果 SnapshotDelta 加了 safety/bond，转换后自动会和事件 delta 的 safety/bond 合并
- 合并后统一过 cap，和 trust / resistance 的处理完全一致
- **cap 位置不用改**——已经在正确的位置了

### 2.5 addDeltaVectors 已支持 safety / bond（`state-transition.ts:501-515`）

```ts
export function addDeltaVectors(a: DeltaVector, b: DeltaVector): DeltaVector {
  return {
    trust: a.trust + b.trust,
    safety: a.safety + b.safety,   // ← 已有
    bond: a.bond + b.bond,          // ← 已有
    ...
  };
}
```

—— 合并函数已经支持，不用改。

### 2.6 boundary.spec.ts 白名单现状

- `SnapshotDelta` 已在白名单（第 331 行）
- `domain/trajectory/script.ts` 已在白名单（第 454 行）
- `cognition/trajectory/trajectory-applier.ts` 已在白名单（第 468 行）

**接口内部加可选字段不需要新增白名单条目**——白名单管的是"这个符号能不能出现在内核里"，不管接口有几个字段。

### 2.7 现有测试

- `test/engine-core/wp3-trajectory.spec.ts` —— 现有测试文件

---

## 3. 本期做什么

### 3.1 扩展 SnapshotDelta 接口（`domain/trajectory/script.ts`）

加两个**可选**字段：

```ts
export interface SnapshotDelta {
  readonly trust?: number;
  readonly safety?: number;    // 新增：剧本推动的安全感增量
  readonly bond?: number;      // 新增：剧本推动的纽带感增量
  readonly resistance?: Partial<BdiResistance>;
  readonly emotion?: { readonly valence?: number; readonly arousal?: number };
  readonly transference?: Partial<TransferenceState>;
}
```

**为什么是可选不是必填**：
- 剧本是数据，很多剧本可能只写 trust，不写 safety/bond
- 必填会破坏向后兼容——现有所有剧本都要改
- 和 trust / resistance / emotion / transference 一样，都是可选字段，缺省 = 0

### 3.2 toDeltaVector 接上（`cognition/trajectory/trajectory-applier.ts`）

把固定的 0 改成从 SnapshotDelta 取值：

```ts
function toDeltaVector(delta: SnapshotDelta | undefined): DeltaVector | undefined {
  if (!delta) return undefined;
  return {
    trust: delta.trust ?? 0,
    safety: delta.safety ?? 0,   // ← 接上
    bond: delta.bond ?? 0,       // ← 接上
    verbal: delta.resistance?.verbal ?? 0,
    ...
  };
}
```

### 3.3 更新注释

把 `toDeltaVector` 上面的注释从"WP42: safety/bond 固定为 0"改成"WP52: safety/bond 已接入"，登记缺口已补。

---

## 4. 边界问题补充

### 4.1 ⚠️ 剧本 delta 要不要经过人格调节？

**本期不做**。剧本 delta 是**直接给的偏移量**，不经过人格调节——和 trust / resistance 的处理完全一致。

理由：剧本是确定性叙事，人格调节是角色差异。剧本写"这一幕来访敞开心扉"，不管是什么依恋类型，这一幕的叙事目标都是"trust + 0.1 / safety + 0.05"——人格差异体现在**日常对话**里，不体现在剧本的固定偏移里。

### 4.2 ⚠️ 剧本 delta 的 safety / bond 要不要也过 cap？

**已经过了**。管道是：事件 delta + 剧本 delta → 合并 → 统一过 cap → 落快照。safety / bond 是 DeltaVector 的维度，自动会被 cap 约束。不用单独处理。

### 4.3 ⚠️ 现有剧本要不要补 safety / bond 的值？

**本期不做**。本期只扩展**接口**和**转换函数**，现有剧本的内容（具体某一幕 safety/bond 给多少）留给后续——那是剧本作者的事，不是引擎的事。

### 4.4 ⚠️ 要不要加 sanitize 校验？

**不用**。剧本 delta 的值是 adapter 注入的，内核不做校验——和 trust / resistance / emotion / transference 的处理完全一致。脏值由 clamp 和 cap 兜住。

---

## 5. 边界约束

### 5.1 engine-core 预批准例外（2 个文件 + 1 个测试）

1. `src/engine-core/domain/trajectory/script.ts` —— SnapshotDelta 接口加两个可选字段
2. `src/engine-core/cognition/trajectory/trajectory-applier.ts` —— toDeltaVector 接上 + 更新注释
3. `test/engine-core/wp3-trajectory.spec.ts` —— 扩展测试用例

必须通过 `boundary.spec.ts` 的断言：零 @nestjs / 零网络 / 零 env / 零 prompt。

> 注：`boundary.spec.ts` 白名单已有 `SnapshotDelta` / `domain/trajectory/script.ts` / `cognition/trajectory/trajectory-applier.ts` 三个条目，接口内部加字段不需要新增白名单条目。

### 5.2 不碰的地方

- ❌ 不改 `DeltaVector` 接口（safety / bond 已是现有维度）
- ❌ 不改 `addDeltaVectors`（已支持 safety / bond）
- ❌ 不改 `applyDeltaVector`（已支持 safety / bond）
- ❌ 不改 cap 位置（已经在合并后统一过 cap）
- ❌ 不改 `in-memory-engine-session.ts`（管道顺序不变）
- ❌ 不做剧本 delta 的人格调节扩展（留后续）
- ❌ 不改现有剧本的内容（只扩展接口，不补具体数值）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 剧本幕的 delta 里写了 safety: 0.05 → 进入该幕那一轮，快照的 safety 真的涨了 0.05
- [ ] 剧本幕的 delta 里写了 bond: 0.03 → 进入该幕那一轮，快照的 bond 真的涨了 0.03
- [ ] 剧本 delta 的 safety/bond 和事件 delta 的 safety/bond **合并后统一过 cap**（不是各自过 cap）
- [ ] 缺省配置（剧本 delta 不写 safety/bond）→ 行为和之前完全一致（零回归）
- [ ] 等待轮（enterNewAct = false）→ 不叠 safety/bond delta（和 trust 口径一致）

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只有 2 个文件（script.ts + trajectory-applier.ts）

### 6.3 内核测试用例要求

扩展文件：`test/engine-core/wp3-trajectory.spec.ts`

至少补充：
1. 剧本 delta 写了 safety → 进入该幕后 safety 真的涨了
2. 剧本 delta 写了 bond → 进入该幕后 bond 真的涨了
3. 剧本 delta 的 safety 和事件 delta 的 safety 合并后统一过 cap（加起来超过单回合 cap，被砍到 cap 值）
4. 缺省（剧本 delta 不写 safety/bond）→ 行为和之前一致，零回归

---

## 7. 本期没做的（明确留给后续）

1. **剧本 delta 的人格调节扩展** —— 剧本是确定性叙事，人格差异体现在日常对话里，不体现在剧本偏移里
2. **现有剧本补 safety/bond 的具体数值** —— 那是剧本作者的事，不是引擎的事
3. **剧本 delta 的 sanitize 校验** —— 脏值由 clamp 和 cap 兜住，和 trust 口径一致
4. **剧本的 target 里加 safety/bond 基线** —— 那是 TrajectoryNodeTarget 的事，本期只补 delta

---

## 8. 转述给后端的话术

> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 这个 WP 预批准改 engine-core，只改 2 个内核文件：
> - `domain/trajectory/script.ts`（SnapshotDelta 加两个可选字段）
> - `cognition/trajectory/trajectory-applier.ts`（toDeltaVector 接上）
>
> 任务单里写的所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 这两个字段是**可选**的，不是必填——和 trust / resistance 一样，缺省 = 0。
>
> cap 位置不用改——已经在合并后统一过 cap，safety/bond 自动会被约束。
>
> 如果真的有必要改 engine-core 的其他地方，先和我确认，不要自己拍板。
>
> 交付时按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

_创建：2026-11-04_
_深度通知：`SnapshotDelta` 接口 / `toDeltaVector` 转换函数 / DeltaVector 维度 / 管道顺序与 cap 位置 / `addDeltaVectors` / boundary.spec.ts 白名单，全部 grep 核实_

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §5.1 改 3 个文件（2 内核 + 1 测试） | **完全一致**（零意外） | 本单只加两个**可选**字段，不碰 env 面、不改接口的必填性 → grep 核实 `SnapshotDelta` 全仓只有 3 处出现（index.ts 类型导出 / script.ts 定义 / trajectory-applier.ts 消费），**适配层没有任何地方构造它** → 存量剧本与既有测试**一行不用改**。这在 Phase2 的 WP 里不常见（WP53 就多出 3 个被 env 治理契约逼出来的文件） |
| 2 | §3.1 / §3.2 字段可选 + 转换层归零 | **一致** | 补记两层「可选」不是一回事：**契约层**缺席（剧本可以不写）→ **delta 层**必须是 0（`DeltaVector` 是定长结构，缺键就没法相加、没法过 cap）。用例把这条口径钉死：`delta.safety` 断言是 `0` 而不是 `undefined` |
| 3 | §2.4「cap 位置不用改」 | **一致**，但**单独验了一次** | 光读代码不够 —— 必须证明是「**合并后统一过 cap**」而非「各自过 cap」（两者数值不同）。反例：事件 +0.02 + 剧本 +0.25 → 合并 0.27 → cap 0.2 → 快照 0.7；各自过 cap 会是 0.72。用例**双向断言**（`toBeCloseTo(0.7)` 且 `not.toBeCloseTo(0.72)`），光断言 0.7 区分不了两种口径 |
| 4 | §4.4 不做 sanitize 校验 | **一致**，但把**脏值落点**钉死并留档 | NaN → `??` 兜不住 → cap 两边比较都 false → 原样返回 → `clamp01(NaN) = 0` → 落点是 **0**（不是「保持原值」）。这与 trust / resistance / emotion / transference 的既有口径**完全一致**（五个维度一起这样）；单独给 safety 加 sanitize 反而会造成「同一份快照里五个维度脏值落点各不相同」的新分裂。用例注明：将来若改成「脏值回退不变」，必须五个维度一起改 |
| 5 | §6.3 测试用例要求 4 条 | **扩到 9 条** | 补：等待轮不叠（§6.1 验收里有、§6.3 清单里漏了）/ 会话层合并过 cap / 会话层零回归（与无剧本路径逐字一致）/ 会话层 bond 过 cap / 脏值 clamp 口径 |
| 6 | §2.6 boundary 白名单行号 331 / 454 / 468 | **完全一致**（逐行核实） | 白名单早已有这三个条目 → 接口内部加字段不需要新增 → `boundary.spec.ts` **12 例零改动**通过 |
| 7 | 任务单未提 | **结案** WP42 交付记录 §2.6 的「已知后果」 | 那条明写「需要后续 WP 给 `SnapshotDelta` 补两项并过同一把 cap」—— 本单就是那个后续 WP。WP42 交付记录是**历史留档，不回改**，在此结案 |
| 8 | §3.2 代码草图逐字段写 `?? 0` | 抽私有 helper `orZero(value)`，11 处统一走它 | 照抄草图会红：eslint 报 `toDeltaVector` 复杂度 **21 > 20**（上限）—— 该函数原有 8 个 `?.` + 9 个 `??` + 1 个 `if` 已是 19，WP52 加两个 `??` 顶破上限。**选「抽 helper」而不是 `eslint-disable` 抑制**：抑制只是掐掉信号，函数仍是「11 个字段各写一次缺省规则」；抽 helper 后「缺省 = 0」只被说一次，将来要改只改一行（单一真相源）。**行为零变化**，`x ?? 0` 与 `orZero(x)` 逐字等价 |

> 本期**没做**的（剧本 delta 的人格调节扩展 / 现有剧本补 safety/bond 具体数值 / 剧本 delta 的 sanitize 校验 / 剧本 `target` 加 safety/bond 基线）已在交付记录 §4 逐条留档。
>
> ⚠️ 提醒：本期只把**接口**打通，**现有剧本一条都没改** → 生产上剧本推动同盟的效果**暂时不变**（还是只有 trust 在动）。要看到实际效果，得等剧本作者补值。
