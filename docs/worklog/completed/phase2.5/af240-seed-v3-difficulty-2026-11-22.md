# AF-240 · Seed Character 来访者 prompt V3 难度分档与三轮对照

- 任务：`AF-240`（`phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-240-af-240`
- 日期：2026-11-22

## 结论

V3 没有优于 V2。F 三轮硬门槛 3/3 全过，但盲评均分与 V2 基本打平、略低，`four-rate` 2/3 失败，L1 回避率只小幅下降，L3 短句率明显下降。**来访者主候选仍保留 seed-v2（arm E），V3 不转正、不接生产。**

V3 的价值是把“按难度调节合作预算”验证了一遍：L3 短句堆叠确实可降，但代价是评分分布更集中在 4 分，软门槛 `four-rate` 更差。说明当前瓶颈不是“预算不够细”，而是 Seed Character 本身在不同难度下的表达差异不足。

## 三轮数字

| 轮 | arm | 合作指数 | 盲评均分 | L1 回避率 | L3 短答率 | 首 token P95 | 硬门槛 | 软门槛未过 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r1 | C | 0.243056 | 3.958333 | 0.25 | 0.520833 | 782ms | 过 | kappa、abs-delta、coop |
| r1 | E | 0.097222 | 3.875 | 0.395833 | 0.5625 | 876ms | 过 | kappa、abs-delta |
| r1 | F | 0.076389 | 3.772727 | 0.395833 | 0.604167 | 896ms | 过 | kappa、abs-delta、four-rate |
| r2 | C | 0.222222 | 4.041667 | 0.270833 | 0.5625 | 887ms | **未过**（plot/tag） | kappa、abs-delta、coop |
| r2 | E | 0.090278 | 3.916667 | 0.4375 | 0.729167 | 900ms | 过 | kappa、abs-delta |
| r2 | F | 0.048611 | 3.916667 | 0.333333 | 0.520833 | 752ms | 过 | kappa、abs-delta |
| r3 | C | 0.180556 | 3.958333 | 0.270833 | 0.645833 | 777ms | 过 | kappa、abs-delta、four-rate、coop |
| r3 | E | 0.111111 | 3.863636 | 0.4375 | 0.666667 | 673ms | 过 | kappa、abs-delta、coop |
| r3 | F | 0.083333 | 3.916667 | 0.416667 | 0.333333 | 736ms | 过 | kappa、abs-delta、four-rate |

- 合作指数三轮均值：C `0.215278`、E `0.099537`、F `0.069444`。F 更“不配合”，但没有换来更高临床评分。
- 盲评均分三轮均值：C `3.986111`、E `3.885000`、F `3.868687`。E 与 F 差 `0.016`，在 12 场/轮的噪声内，不足以判优。
- L1 回避率均值：E `0.423611`、F `0.381944`，下降 `0.041667`，方向对但幅度小。
- L3 短答率均值：E `0.652778`、F `0.486111`，下降 `0.166667`，是 V3 最明确的正向变化。
- four-rate：E `0.541667 / 0.666667 / 0.681818` 三轮均过；F `0.772727 / 0.666667 / 0.75`，两轮失败。

## V3 文案

在 V2 之后追加一段难度预算，保持 V2 的不提问、不顺从、不主动推进、不自我总结：

- 直接回答预算：L1 每 2 轮最多 1 轮；L2 每 3 轮；L3 每 4 轮。
- 具体细节预算：L1 每 3 轮最多 1 个 ≤30 字细节；L2 每 4 轮；L3 每 5 轮；给完下一轮收回。
- 短句节流：连续短句/沉默 L1 不超过 1 轮，L2/L3 不超过 2 轮；超过后下一轮给 10–30 字带信息量的句子。
- 防御形式在“含糊—短句—转移—一次具体回忆”之间切换，但不变得配合或治疗性。

## 改动

| 文件 | 改动 |
| --- | --- |
| `bin/visitor-sim-prompts.ts` | 新增 `SEED_V3_BUDGETS`、`buildSeedV3Constraints`、`buildSeedV3VisitorPrompt`；variant 增 `seed-v3` |
| `bin/visitor-sim-runtime.ts` | 新增 arm F `Seed-Character/seed-v3` |
| `bin/visitor-sim-analysis.ts` | `SimPromptVariant` 增 `seed-v3` |
| `bin/visitor-sim-shadow.ts` | 读取会话元数据时识别 `seed-v3` |
| `test/auto-practice/af232-visitor-shadow.spec.ts` | 新增 V3 分档预算回归；19/19 通过 |

## 实验设置

- 只新生成 F：r1/r2/r3 各 12 场、144 轮，36/36 场 0 失败。
- A/C/E 复用 AF-237/AF-238 同 persona×难度、同咨询师脚本的历史会话；复制到 `data/phase25-exit/af240-seed-v3/r1|r2|r3` 后统一评分。
- 评分仍为 R1 `MiniMax-M3.1-Flash` + R2 `doubao-seed-2-1-lite-260915`，concurrency 2。
- 每轮 48 场，r1 47 份、r2 48 份、r3 47 份评分，失败的 2 份为 R2 解析失败，不影响硬门槛。

## 闸门

- `pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts`：19/19 通过。
- `pnpm lint`：0 error / 0 warning。
- `pnpm typecheck`：exit 0。
- `pnpm test`：252 文件通过 + 1 skipped；4215 tests 通过 + 4 skipped。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差

- 任务单验收写“盲评均分不低于 E”，实测 F 略低 `0.016`，按未达标记录。
- 任务单写“L1 回避率下降”，实测下降 `0.041667`，幅度小于预期；按部分达成记录。
- V3 保留代码与 arm F，但不设为默认候选；后续若要继续调，应换方向而不是继续加预算。

## 限制

- 12 场/轮、AI 双评，不是真人督导双标；不能据此判断临床达标。
- `four-rate < 0.7` 是评分离散度代理指标，F 更集中在 4 分是否属于真实缺陷仍需讨论；本轮不改门槛。
- 不接生产，不改 provider 路由与 feature flag。
