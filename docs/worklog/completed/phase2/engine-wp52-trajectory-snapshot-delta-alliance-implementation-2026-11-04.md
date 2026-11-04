# WP52 交付记录 — 剧本偏移接入同盟三维（safety / bond）

> 状态: ✅ 已交付
> 任务单: [`wp52-trajectory-snapshot-delta-alliance-2026-11-04.md`](wp52-trajectory-snapshot-delta-alliance-2026-11-04.md)
> 日期: 2026-11-04
> 红线: ⚠️ **engine-core 已改（预批准例外）** —— `git diff --stat HEAD -- src/engine-core` 含 **2 个文件**（`domain/trajectory/script.ts` + `cognition/trajectory/trajectory-applier.ts`），**无其他文件**

---

## 1. 实际改了哪些文件

### 1.1 内核（`src/engine-core/**`）：2 改（无新增文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/domain/trajectory/script.ts` | ① `SnapshotDelta` 加 `safety?: number` / `bond?: number` 两个**可选**字段（各带口径注释：缺省 = 0 = 这一维本轮不动）；② 文件头加 WP52 段（为什么可选 / 为什么不经过人格调节） |
| `src/engine-core/cognition/trajectory/trajectory-applier.ts` | ① `toDeltaVector` 的 `safety: 0` / `bond: 0` → 从契约取值（`orZero(delta.safety)` / `orZero(delta.bond)`）；② 新增私有 helper `orZero`（把「缺省 = 0」收成一处，顺带把函数复杂度从 21 降到 10 —— 见 §2.2）；③ WP42 那段「固定为 0 / 缺口在这里」的注释改成 WP52「已接入」；④ 文件头加 WP52 段（cap 位置不用改的理由） |

### 1.2 测试：1 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp3-trajectory.spec.ts` | **扩展**：新增 ⑮ 组「剧本偏移接入同盟三维」**9 例**；import 补 `addDeltaVectors` / `aggregateTurnDelta` / `capTurnDelta` / `DeltaVector`；文件头清单补第 15 条 |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/wp52-trajectory-snapshot-delta-alliance-2026-11-04.md` | 状态行改 `✅ 已交付` + 指向交付记录；追加「§9 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | WP52 行 ✅ + 交付记录链接；统计进度 8/35 → 9/35；engine-core 例外表 +WP52 行 |
| `docs/worklog/README.md` | Phase2 已开工列表 +WP52；进度回写 9/35；目录结构说明 +WP52 |

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

### 2.1 本单是少数「任务单与代码**完全对得上**」的单：改动面零意外

任务单 §5.1 列的 3 个文件（2 内核 + 1 测试）**正好就是**实际改动的 3 个文件 —— 没有多出、没有少掉。

这在 Phase2 的 WP 里不常见（WP53 就多出 3 个 env 治理契约逼出来的文件）。原因很实在：**本单只加两个**可选**字段，不碰 env 面、不改接口的必填性**。

grep 核实过两件事，才敢这么断言：

- `SnapshotDelta` 全仓只有 3 处出现（`engine-core/index.ts` 的类型导出、`script.ts` 的定义、`trajectory-applier.ts` 的消费）—— **适配层没有任何地方构造它**（剧本是 adapter 注入的**纯对象**，内核不感知剧本存在哪）；
- 新字段是**可选**的 → 任何构造 `SnapshotDelta` 的地方都**不会编译失败**（与 WP53 的必填字段不同，那次让 WP34 既有测试的 7 个字面量全部编译不过）。

### 2.2 决策：`toDeltaVector` 抽 `orZero` helper —— eslint 的 complexity 上限逼出来的，但顺带把口径收敛了

任务单 §3.2 给的代码草图是逐字段写 `?? 0`。**照抄会红**：eslint 报 `toDeltaVector` 复杂度 **21 > 20**（上限）。

**为什么是 21**：这个函数原本就有 8 个 `?.`（`delta.resistance?.verbal` 等）+ 9 个 `??` + 1 个 `if`，基础复杂度 1 → **19**，刚好压在上限之下；WP52 加了两个 `??`（safety / bond）→ **21**，顶破上限。

**实际交付**：抽一个私有 helper，把「缺省 = 0」这条规则收到一处：

```ts
function orZero(value: number | undefined): number {
  return value ?? 0;
}
```

转换函数里 11 处 `?? 0` 全变成 `orZero(...)` → 复杂度 **21 → 10**。

**为什么选「抽 helper」而不是 `eslint-disable-next-line complexity`**：

- 抑制 lint 只是把信号掐掉，函数仍然是「11 个字段各写一次缺省规则」；
- 抽 helper 后，「缺省 = 0」这条规则**只被说一次** —— 将来要改（比如改成"缺省 = 沿用当前值"）只改一行，不会出现「改了一处漏了另一处」，这正是仓库的「单一真相源 / 反双胞胎」纪律；
- 顺带把 WP52 新增的两项与旧有九项放在**同一套口径**上，而不是让 safety / bond 成为两个写法。

**行为零变化**：`x ?? 0` 与 `orZero(x)` 逐字等价，既有 41 条用例全部保持。

### 2.3 决策：字段**可选**，但转换后是 `0`（不是 `undefined`）

任务单 §3.1 / §3.2 已明确这个口径，照办。这里补记**为什么两个"可选"不是一回事**：

- **契约层可选**（`SnapshotDelta.safety?`）：剧本数据可以不写这一维；
- **转换层归零**（`toDeltaVector` 输出 `orZero(delta.safety)`）：进入内核 delta 向量后，11 个维度**必须齐整** —— `DeltaVector` 是定长结构，缺一个键就没法相加、没法过 cap。

所以「剧本没写 safety」在契约层是「缺席」，在 delta 层是「0」（这一维本轮不动）。用例把这一层口径钉死：`result.delta?.safety` 断言是 `0` 而不是 `undefined`。

### 2.4 决策：cap 位置**真的不用改** —— 这一点值得单独验一次，不是照抄任务单

任务单 §2.4 断言「cap 位置不用改，safety/bond 自动会被约束」。这个断言本身是对的，但**光靠读代码不够** —— 必须证明「合并后统一过 cap」而不是「各自过 cap」（两者的数值结果不同）。

**反例构造**（用例里直接钉住）：

```
事件 empathy: safety +0.02
剧本:        safety +0.25
合并:       0.27  → cap 上向 0.2 → 0.2   ← 合并过 cap
各自过 cap: 0.2 + 0.02 = 0.22            ← 错误口径
```

落库快照 safety = 基线 0.5 + 0.2 = **0.7**（合并口径）；若是各自过 cap 会是 0.5 + 0.22 = **0.72**。用例同时断言 `toBeCloseTo(0.7)` **且** `not.toBeCloseTo(0.72)` —— 光断言 0.7 的话，错误实现也可能在别的数字上蒙对，双向断言才真正区分两种口径。

### 2.5 决策：剧本偏移**不经过人格调节**（任务单 §4.1，照做）

理由任务单写得很清楚：剧本是**确定性叙事** —— 「这一幕来访敞开心扉」不管来访是什么依恋类型，叙事目标都是同一个偏移量。人格差异体现在**日常对话**的事件 delta 里（WP53 那一层），不体现在剧本的固定偏移里。

与 trust / resistance 的既有口径完全一致（剧本 delta 从来不走人格调节）—— 这次只是把 safety / bond 归到同一个既有口径下，不是新开一条路。

### 2.6 决策：**脏值落点被钉死并留档**（任务单 §4.4 的推论）

任务单 §4.4 说「不加 sanitize 校验，脏值由 clamp 和 cap 兜住」。这句话成立，但**落点值得写清楚**，否则将来 review 时会被当成 bug：

```
剧本 safety: NaN → delta.safety = NaN（?? 只兜 null/undefined，兜不住 NaN）
             → capTurnDelta: NaN 两边比较都 false → 原样返回 NaN
             → applyDeltaVector: clamp01(0.5 + NaN) → clamp01(NaN) = 0
```

落点是 **0**（不是「保持原值」）。这与 trust / resistance / emotion / transference 的**既有口径完全一致** —— 五个维度一起这样，所以单独给 safety 加 sanitize 反而会造成「同一份快照里五个维度脏值落点各不相同」的新分裂。

**用例把这条钉住**（`剧本写了脏值 (NaN) → 不把 NaN 写进快照`），并注明：将来若要改成「脏值回退不变」，必须五个维度一起改，不能只改 safety 一个。

### 2.7 结案：WP42 交付记录 §2.6 登记的「已知后果」到此闭合

WP42 交付记录 §2.6 明写：

> **已知后果（写在这里，别在 review 时当成 bug）**：一个只写 `delta: { trust: 0.3 }` 的剧本幕会抬 trust 但不抬 safety，于是 `min(trust, safety)` 仍可能卡在探索门槛外。剧本要推进同盟三维，**需要后续 WP 给 `SnapshotDelta` 补两项并过同一把 cap**。

那个「后续 WP」就是本单。WP42 的交付记录是历史留档，**不回改**（改了就不是当时的记录了），在此结案。

---

## 3. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | **95 个测试文件 / 1467 例全绿**（WP53 基线 95 文件 / 1458 例 + 本轮新增 **9 例**，**零回归**：1458 + 9 = 1467 ✓） |
| `npx vitest run test/engine-core/wp3-trajectory.spec.ts` | **50 例全绿**（原 41 例 + 本轮新增 **9 例**） |
| `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿**（边界断言全过：零 @nestjs / 零网络 / 零 env / 零 prompt） |
| `git diff --stat HEAD -- src/engine-core` | **2 个文件**（`domain/trajectory/script.ts` + `cognition/trajectory/trajectory-applier.ts`）—— **正是任务单 §6.2 要求的范围，无其他** |

**回归确认**：

- 剧本 delta **不写** safety / bond → 这两维**逐字不动**（转换层给 0，合并后不产生任何位移）；
- 与**无剧本**路径逐字一致（用例直接对比两条路径的快照）；
- 等待轮（`enterNewAct = false`）→ **不叠** safety / bond delta（与 trust 口径一致）；
- 剧本 delta 的 safety / bond 与事件 delta 的 safety / bond **合并后统一过 cap**（0.7，不是各自过 cap 的 0.72）；
- 脏值（NaN）**不写进快照**（clamp 落 0，与 trust 同口径）；
- WP3 既有 **41 例**内核用例**全部保留**（只加组，未改任何既有断言）；
- `boundary.spec.ts` 白名单**无需新增条目**（`SnapshotDelta` / `domain/trajectory/script.ts` / `cognition/trajectory/trajectory-applier.ts` 三个条目**早已在列**，行号 331 / 454 / 468 与任务单 §2.6 记的**完全一致**）—— 接口内部加字段不需要新增白名单条目。

---

## 4. 本期**没做**的（明确留给后续，别当漏做）

1. **剧本 delta 的人格调节扩展**（任务单 §4.1）—— 剧本是确定性叙事，人格差异体现在日常对话的事件 delta 里。
2. **现有剧本补 safety / bond 的具体数值**（任务单 §4.3）—— 那是**剧本作者**的事，不是引擎的事。⚠️ 注意：本期只把**接口**打通，**现有剧本一条都没改** —— 所以生产上剧本推动同盟的效果**暂时不变**（还是只有 trust 在动）。要看到实际效果，得等剧本作者补值。
3. **剧本 delta 的 sanitize 校验**（任务单 §4.4）—— 脏值由 clamp 与 cap 兜住，与 trust 口径一致（落点见 §2.5）。
4. **剧本 `target` 里加 safety / bond 基线**（任务单 §7 第 4 条）—— 那是 `TrajectoryNodeTarget` 的事，本期只补 delta。

---

_创建：2026-11-04_
_深度通知：任务单 §2.1（现有接口）/ §2.2（toDeltaVector）/ §2.4（管道顺序与 cap 位置）/ §2.5（addDeltaVectors）/ §2.6（boundary 白名单行号）/ §6.1（验收清单）逐条核实 + 真实代码 grep（SnapshotDelta 全仓构造点 / EVENT_LEXICON 命中词 / clamp01 的 NaN 落点 / 管道合并与 cap 顺序）_
