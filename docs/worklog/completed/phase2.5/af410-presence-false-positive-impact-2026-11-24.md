# AF-412 交付记录：BDI 在场误判的系统级影响审计（全会话投影）

- 日期：2026-11-24
- 基线：`integrate` @ `5ed82d71b659b2e7b3ff08e7614c7c5d06ba4297`
- 分支：`task/AF-412-presence-false-positive-impact`

## 一、结论

AF-409 证明 A′ 会把 117/157 个 neutral 轮改判成 holding，但只看了 cold 单场。全会话投影后，真正的系统级代价不是 `zero_motion` 翻转，而是**同盟指标被整批抬高**：

- 13 场里 11 场至少命中 1 轮 A′ holding；只有 2 场（各 1 个 neutral 轮）完全没被命中。
- 若 117 轮全为误判：整批 safety 合计 +0.4660、bond +0.2320；受影响场均 safety +0.0424、bond +0.0211。
- 即使只有 25% 是误判：整批 safety 仍 +0.1165、bond +0.0580（受影响场均 +0.0106 / +0.0053）。
- `zero_motion` 当前 3 场，投影后 2 场，只翻 1 场（cold 单场）；另外 2 场零变化场次本来就没有中性轮可命中。

结论：A′ 的主要风险是**普遍性同盟虚高**，不是少数场次指标翻转。由于没有人工标注，117 轮里“真在场/误判”的精确率未知；本报告给的是“每 1% 误判对应的系统代价”，不是“已确认误判 117 轮”。

## 二、口径

新增：`scripts/ops/quality/af412-presence-false-positive-impact.mjs`，复用 AF-409 的 `classifyNarrow` 与 AF-408 的 `PRESENCE_DELTAS`，只读 trace，不打印原文。

- 八维：`trust / safety / bond / valence / arousal / resistanceVerbal / resistanceDepth / resistanceStyle`，与 `batch-metrics.compute.ts` 的 `DIMENSION_SNAPSHOT_KEY` 同口径。
- `zero_motion`：首轮与末轮八维逐字相等（含非零但净零的场次）。
- 投影：把 A′ 命中的每轮 `holding_present` delta（safety +0.004 / bond +0.002 / verbal −0.002 / valence +0.004 / arousal −0.002）**一次性加在末轮快照上**，再判零变化；不重跑后续轮，因此是**下界方向的一阶投影**，不是内核重放。
- 误判敏感性：以总增量为基数乘误判比例（0%–100%），不假设精确率。

## 三、实测

### 3.1 批次面

| 指标                      | 数值             |
| ------------------------- | ---------------- |
| 场次                      | 13               |
| 咨询师 neutral 轮         | 157              |
| A′ holding                | 117              |
| A′ cold                   | 1                |
| 受影响场次（≥1 holding）  | 11 / 13          |
| `zero_motion` 当前 → 投影 | 3 → 2（翻 1 场） |
| 总 safety 增量            | +0.4660          |
| 总 bond 增量              | +0.2320          |
| 单场最大 safety 增量      | +0.0560          |
| 受影响场均 safety 增量    | +0.0424          |

### 3.2 误判敏感性

| 误判比例 | 整批 safety | 整批 bond |
| -------- | ----------- | --------- |
| 25%      | +0.1165     | +0.0580   |
| 50%      | +0.2330     | +0.1160   |
| 75%      | +0.3495     | +0.1740   |
| 100%     | +0.4660     | +0.2320   |

### 3.3 逐场（仅数值，无原文）

| 场次                          | neutral 轮 | A′ holding | zero_motion 当前→投影 | 投影后 safety | 投影后 bond |
| ----------------------------- | ---------- | ---------- | --------------------- | ------------- | ----------- |
| `debug_-ja_HBOyvRIAn8zrKBGxP` | 11         | 9          | N→N                   | 0.5210        | 0.5990      |
| `debug_1pYKGYjZhTu4p7wYM1VO3` | 1          | 0          | Y→Y                   | 0.7000        | 0.5000      |
| `debug_5fF7I9GduTiJN0B_mkuZi` | 17         | 14         | N→N                   | 0.4480        | 0.7170      |
| `debug_GJ_HGNcuo9Z9NoxjzMf8V` | 1          | 0          | Y→Y                   | 0.7000        | 0.5000      |
| `debug_ITUgH5VCcuZ5QXw9SBb-T` | 14         | 11         | Y→N                   | 0.2940        | 0.2220      |
| `debug_PNbYXZIn3MQQt-EOlUVvm` | 13         | 11         | N→N                   | 0.4580        | 0.7300      |
| `debug_PqbSdWdJDumFk6LULjVvv` | 18         | 8          | N→N                   | 0.4510        | 0.5400      |
| `debug_aV8cenevSHfgmGB2Zkflf` | 17         | 14         | N→N                   | 0.3360        | 0.2430      |
| `debug_q_VTpzjWZQwWDcAjUuJY0` | 17         | 14         | N→N                   | 0.4480        | 0.7170      |
| `debug_s6HNZ_d_YYBHCLF2PLHNd` | 13         | 11         | N→N                   | 0.3860        | 0.6610      |
| `debug_tOTsMJ9DRx1d9VNMUDBT_` | 6          | 6          | N→N                   | 0.7740        | 0.5320      |
| `debug_xw7uAJodsn6o3ln9FGL_Q` | 10         | 7          | N→N                   | 0.3550        | 0.6490      |
| `debug_zenPFZu7VbSAW4LCC0_rN` | 19         | 12         | N→N                   | 0.3780        | 0.6640      |

## 四、解读

1. **指标面的可见性很低**：`zero_motion` 只翻 1 场，看板几乎无感；但 11 场同盟均值上移 4.2 个百分点（100% 误判时）。只盯 `zero_motion` 会漏掉主要风险。
2. **风险是“普遍小幅”而非“个别大幅”**：单场最大 safety +0.0560，远小于 cold 单场的 +0.0440 同类量级；但 11 场同时发生，批次对比和角色排序会被整体抬升。
3. **精确率仍是空白**：117 轮里没有一个人工标签，无法区分“稳定陪伴”和“普通提问”。因此本报告不能证明“117 轮都是误判”，只能证明“误判每增加 1%，系统多付多少”。
4. **A′ 不是免费开关**：即便按最保守的 25% 误判，批次 safety 也 +0.1165，相当于 29 轮真实 holding 的累积量；这还没有算 `zero_motion` 之外的其他阈值型指标。

## 五、闸门

| 闸门      | 命令                                                                                                 | 结果                          |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------------------- |
| 定向单测  | `pnpm exec vitest run scripts/orchestration/__tests__/af412-presence-false-positive-impact.spec.mjs` | 9/9 通过                      |
| 投影脚本  | `node scripts/ops/quality/af412-presence-false-positive-impact.mjs`                                  | 13 场 / 157 neutral，输出正常 |
| Lint      | `pnpm lint`                                                                                          | 0 error                       |
| Typecheck | `pnpm typecheck`                                                                                     | 0 error                       |
| 全量测试  | `pnpm test`                                                                                          | 见回执                        |

## 六、下一步

1. **不要开 A′ 开关**：现有证据只能支持“误判代价可量化”，不能支持“精确率可接受”。
2. **先做人工标注**：从 117 轮命中与 39 轮未命中各抽 30 轮，标 holding / neutral / cold，算精确率与 cold recall；低于 80% 精确率不应上线。
3. **把本脚本接入批次复盘**：每次新增批次跑一次，观察“命中率 × 同盟增量”是否漂移，而不是只看 `zero_motion`。
