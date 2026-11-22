# AF-338 · 真人度事件类型归因与剖面工具实测报告（2026-11-23）

## 结论先行

1. **焦虑 full 的过密主要来自 `repair` 与 `filler`，不是 `pause`。** 8 次 × 12 轮 = 96 轮里，full 共 `194` 个事件：`pause 67`（每轮 `0.6979`）、`repair 66`（每轮 `0.6875`）、`filler 55`（每轮 `0.5729`），三类合计占 `96.9%`。off 只有 `64` 个事件，且 `repair` 为 `0`。
2. **回避 full 的过密几乎全部来自 `pause` 与 `trailoff`。** 96 轮共 `116` 个事件：`pause 96`（每轮 `1.0000`，占 `82.8%`）、`trailoff 20`（每轮 `0.2083`，占 `17.2%`）；`filler`、`repair` 均为 `0`。
3. **minimal 不是 full 的“轻量版”，是 off 词表的子集。** 焦虑 minimal 与 off 的 `filler` 都是 `31` 次；`pause` 只从 off 的 `28` 降到 `24`；`repair` 仍为 `0`。回避 minimal `pause 26`（每轮 `0.27`），接近 off 的 `50`（每轮 `0.52`）。
4. **所以“减层”减掉的是 repair 与部分 filler，但 full 的焦虑过密正是 repair 撑起来的；减到 minimal 后 repair 归零，密度自然回落到 off 侧。** 但 minimal 也失去了 repair 这个真人度信号，gate 无法把它与 off 区分。
5. **回避路径不同：** full 用“每轮都 pause”把密度拉到 `1.0` 事件/轮；minimal/off 只保留低密度 pause。回避的真人度增量主要来自 pause 频率，而不是类型多样性。
6. **生产继续 `off`；`repair` 需单独设上限，不能只靠总密度阈值。**

## 数据口径

- 输入：AF-336 的 8 份 off rep（`af336.../reps/rep-1..8.json`）与 AF-337 的 8 份 full+minimal rep（`af337.../reps/rep-1..8.json`），每份 `reps=1`。
- 每格：2 人设 × 1 分支 × 8 重复 × 12 轮 = `96` 轮。
- 工具：`bin/visitor-realism-event-type-profile.ts`，纯函数 `aggregateEventTypeProfiles` 折算每轮频次与占比；零模型调用。
- 原始剖面：`data/phase25-exit/af338-realism-event-type-attribution/off-profile.json`、`full-minimal-profile.json`（gitignored）。

## 六类事件剖面

### 焦虑

| 分支 | 总事件 | 每轮 | filler/turn | pause/turn | repetition/turn | repair/turn | trailoff/turn | elongation/turn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off | 64 | 0.6667 | 0.3229（48.4%） | 0.2917（43.8%） | 0.0104（1.6%） | 0 | 0.0417（6.3%） | 0 |
| full | 194 | 2.0208 | 0.5729（28.4%） | 0.6979（34.5%） | 0 | 0.6875（34.0%） | 0.0625（3.1%） | 0 |
| minimal | 56 | 0.5833 | 0.3229（55.4%） | 0.2500（42.9%） | 0 | 0 | 0.0104（1.8%） | 0 |

### 回避

| 分支 | 总事件 | 每轮 | filler/turn | pause/turn | repetition/turn | repair/turn | trailoff/turn | elongation/turn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| off | 55 | 0.5729 | 0.0417（7.3%） | 0.5208（90.9%） | 0 | 0 | 0.0104（1.8%） | 0 |
| full | 116 | 1.2083 | 0 | 1.0000（82.8%） | 0 | 0 | 0.2083（17.2%） | 0 |
| minimal | 27 | 0.2813 | 0.0104（3.7%） | 0.2708（96.3%） | 0 | 0 | 0 | 0 |

## 归因

### 焦虑：`repair` 是主放大器，`filler` 是次放大器

AF-334 说事件层是最大放大器；本单把事件层拆到类型：焦虑 full 比 off 多 `130` 个事件，其中 `repair` 贡献 `66`（50.8%）、`pause` 贡献 `39`（30.0%）、`filler` 贡献 `24`（18.5%），三类合计占净增量的 `99.2%`。`repair` 在 off 与 minimal 中都是 `0`，一旦打开就直接把每轮事件从 `0.67` 推到 `2.02`。

这意味着**只看总密度会把“repair 过多”混进“事件过多”**。焦虑的真人度信号与过密信号共用 `repair` 和 `filler` 两个通道，靠总密度阈值无法只保留前者。

### 回避：`pause` 的“每轮必有”是放大器

回避 full 的 `pause` 每轮 `1.0`，等于每轮至少一个停顿；off 只有 `0.52`。`trailoff` 从 `0.01` 升到 `0.21`。两者合计 `100%` 事件，`repair` 全程为 `0`。回避的真人度增量是**停顿频率**，不是 repair。

### minimal 与 off 几乎同词表

焦虑 minimal 的 `filler` 与 off 完全相同（`31`），`pause` 只少 `4` 次；回避 minimal 的 `pause` 是 off 的一半。两者都没有 `repair`。这说明 minimal 的减层把 full 的“增量信号”整段删掉了，只剩 off 的低频 pause/filler，所以不可分是结构性的，不是样本量不够。

## 决策

- **生产保持 `off`；不调总密度阈值。**
- **`repair_per_turn` 已由 `humanization-v1` 单独约束（≤0.10）**；本单证明这条约束是必要的：焦虑 full 的 `repair` 每轮 `0.6875`，是上限的 `6.9` 倍。
- **下一轮候选设计应分型处理：**
  1. 焦虑：先压 `repair` 与 `filler` 的频率，再谈 `pause`；
  2. 回避：先压 `pause` 的“每轮必有”，保留少量 `trailoff`；
  3. 不再用“统一减层”同时处理两个人设，否则会把真人度信号一起删掉。
- **gate 仍只能当 full 报警，不能当 active 认证。**
