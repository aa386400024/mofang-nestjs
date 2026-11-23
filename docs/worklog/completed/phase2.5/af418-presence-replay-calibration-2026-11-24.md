# AF-418 交付记录：BDI 在场投影同源校准

- 任务：AF-418
- 基线：`34220dcca35d03897750a82abb22a326cf4e490c`
- 分支：`task/AF-418-presence-replay-calibration`
- 日期：2026-11-24

## 一、问题

AF-412 的在场误判影响是「末轮快照 + Σdelta」单次加法；真实内核是逐轮 `transitionState`，每轮都过 clamp / cap / 人格调节。MiniMax Code 评审指出两条风险：

1. `scripts/ops/quality/af408-presence-calibration.mjs` 的 `PRESENCE_DELTAS` 是内核 delta 表的第三份手抄拷贝，内核调系数后脚本会静默漂移；
2. 末轮单次加法与逐轮重放不同源，数字不能直接当内核结论。

## 二、改动清单

### 2.1 新增 `scripts/ops/quality/af418-presence-replay-calibration.mjs`（只读）

- `pickTracked` / `diffTracked`：取八维快照、还原相邻轮真实位移。
- `addClamped` / `applyPresenceDelta`：11 维 presence delta 映射到八维，逐轮叠加；**valence 夹 [-1,1]，其余夹 [0,1]**（修正了首版把 valence 当 [0,1] 导致重放漂移 11 场的问题）。
- `flatProjection`：严格按 AF-412 口径——Σdelta 一次加到末轮快照再夹取。
- `replaySession`：真实相邻快照差 + 当轮 presence delta，逐轮夹取；无标签时必须逐字还原末轮快照（`baseEqual`）。
- `summarizeReplaySession` / `summarizeReplay`：输出末态、总增量、单场差、饱和场次、zero_motion 翻转、基线漂移场次。
- `loadReplayRows`：只读 `data/debug-sessions`，只保留数值与 A′ 标签，不输出原文。
- CLI `--dir`；只在直接执行时跑主流程，被测试导入不触发 IO。

### 2.2 新增 `scripts/orchestration/__tests__/af418-presence-replay-calibration.spec.mjs`（7 例）

1. `PRESENCE_DELTAS` 与内核 `aggregateTurnDelta` 对 `holding_present` / `cold_absent` 输出逐字段一致，键集合一致；
2. presence delta 正确映射到八维，阻抗三分量分别落位；
3. 无标签重放逐字还原末轮快照（含 valence 负值）；
4. 合成饱和场景：末轮单次加法与逐轮重放出现 0.002 差值，证明检测器有效；
5. 批次汇总正确统计饱和场次与最大单场差；
6. `addClamped` 对 valence 用 [-1,1]，其余用 [0,1]；
7. 无饱和时末轮加法与逐轮重放数值一致。

## 三、实测结果（13 场 / 157 neutral）

```text
场次 13 | neutral 轮 157 | A′ holding 117 | cold 1
重放基线漂移场次 0（应为 0）
zero_motion: 末轮加法 2 场 → 逐轮重放 2 场；饱和场次 0
总增量 safety: 末轮加法 +0.4660 vs 重放 +0.4660；总增量 bond: +0.2320 vs +0.2320
末态和 safety: 6.2490 vs 6.2490；bond: 7.2740 vs 7.2740
最大单场差：safety 0.000000 | bond 0.000000
```

**结论边界**：

- 本批数据上，AF-412 的 +0.4660 / +0.2320 与逐轮重放**逐位相同**（饱和场次 0）——说明 AF-412 的数字在本数据集上成立，不是拍脑袋。
- 但这只是**本时点数据集**的等价，不是「两种口径永远同源」的证明。合成饱和用例已经证明：一旦中间轮触顶再回落，末轮单次加法会少算/多算。
- 重放仍是**静态反事实**：它把 presence delta 叠加在真实轨迹上，不重算「若真是 holding，来访后续回应是否改变」。真实临床影响需要在线对练或人工标注。
- 重放只覆盖 clamp 级同源，**不含 cap 与人格调节**；presence delta 幅度小于 cap 阈值，本批无影响，但不能把「本批无影响」当成「永远无影响」。

## 四、闸门与实测数字

| 闸门     | 命令                                                                                              | 结果                                                                    |
| -------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 定向单测 | `pnpm exec vitest run scripts/orchestration/__tests__/af418-presence-replay-calibration.spec.mjs` | 1 文件 / 7 用例全绿，370ms                                              |
| 只读脚本 | `node scripts/ops/quality/af418-presence-replay-calibration.mjs --dir data/debug-sessions`        | exit 0；13 场 / 157 轮；无原文                                          |
| Lint     | `pnpm lint`                                                                                       | 0 error；仅 pnpm `node>=26` engine warning                              |
| 类型     | `pnpm typecheck`                                                                                  | 0 error                                                                 |
| 全量测试 | `pnpm test`                                                                                       | 318 passed / 1 skipped（文件），4813 passed / 4 skipped（用例），26.15s |
| 内核边界 | `git diff --stat HEAD -- src/engine-core`                                                         | 空                                                                      |

## 五、偏差与遗留

### 偏差

- 首版 `addClamped` 误把 valence 当 [0,1]，导致 11 场重放基线漂移；改为按维度夹取后 `baseDriftSessions=0`。该问题在提交前发现，未进入代码。
- `flatProjection` 首版逐标签叠加并每步夹取，与 AF-412 的「Σ 后一次夹取」不等价；改为累计后一次夹取，才复现 +0.4660 / +0.2320。

### 遗留

- **静态反事实不等于在线效果**：若 presence 标签改变来访回应，后续事件与轨迹都会变；本工具只能做离线上界估算。
- **未接 cap / 人格调节**：`transitionState` 的完整选项需要角色人格与同盟配置；本脚本只做 clamp 级重放。后续如要完全同源，需从 trace 读取人格配置并走 `transitionStateDetailed`。
- **数据时点性**：13 场、157 轮是当前 `data/debug-sessions` 快照；换批次需重跑，不能复用本记录数字。
- A′ 真实精确率仍需人工标注 AF-415 的 40 行 CSV。
