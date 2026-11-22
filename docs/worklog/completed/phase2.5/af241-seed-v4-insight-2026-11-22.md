# AF-241 · Seed Character V4 洞察收敛与抽象标签审计

- 任务：`AF-241`（`phase2.5-orchestration-closed-loop`）
- 分支：`task/AF-241-af-241`
- 日期：2026-11-22

## 结论

V4 仍不优于 V2。G 首轮盲评 `3.958333` 高于 E `3.833333`，但两轮复跑没有复现：r2 `3.875`（`plot-zero` 硬失败）、r3 `3.772727`。三轮均值 G `3.868687`、E `3.888889`，G 低 `0.020202`；硬门槛 G 2/3，E 3/3。**来访者主候选仍为 seed-v2（arm E）；V4 不转正。**

这轮也确认：单轮 12 场的“提升”不可信。V4 的洞察收敛只降低了抽象词总次数（G 8 次 vs E 12 次），但没有稳定提升临床可读性，反而在 r2 触发 `plot-zero`。

## 三轮数字

| 轮 | arm | 盲评均分 | 合作指数 | L1 回避率 | L3 短答率 | four-rate | P95 | 硬门槛 | 软门槛未过 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r1 | E | 3.833333 | 0.097222 | 0.395833 | 0.5625 | 0.75 | 876ms | 过 | kappa、abs-delta、four-rate |
| r1 | G | 3.958333 | 0.097222 | 0.458333 | 0.5625 | 0.791667 | 797ms | 过 | kappa、abs-delta、four-rate |
| r2 | E | 3.958333 | 0.090278 | 0.4375 | 0.729167 | 0.625 | 900ms | 过 | kappa、abs-delta |
| r2 | G | 3.875 | 0.104167 | 0.375 | 0.5 | 0.791667 | 878ms | **未过**（plot-zero） | kappa、abs-delta、four-rate |
| r3 | E | 3.875 | 0.111111 | 0.4375 | 0.666667 | 0.708333 | 673ms | 过 | kappa、abs-delta、four-rate、coop |
| r3 | G | 3.772727 | 0.055556 | 0.458333 | 0.604167 | 0.681818 | 816ms | 过 | kappa、abs-delta |

均值：

- 盲评：E `3.888889`、G `3.868687`。
- 合作指数：E `0.099537`、G `0.083333`。
- L1 回避率：E `0.423611`、G `0.430556`。
- L3 短答率：E `0.652778`、G `0.555556`。

## V4 文案

只加“洞察收敛”，不再调难度预算：

- 全场最多一次抽象心理词（“不配得感”“回避”“依恋”“防御”等），说出后必须立刻收回、自嘲或转移。
- 抽象词第二次出现即视为本轮无效。
- 禁止完整因果链与“我意识到/原来我/其实我是因为”。
- 不把咨询师假设接成自我总结；可以只说“可能吧，我也说不清”，然后停。
- 不设计“开场防御—中间领悟—结尾松动”的治疗性弧线。
- 具体细节只给一个、不超过 30 字，不解释意义。

## 抽象标签审计

`auditInsightLabels` 新增在 `bin/visitor-sim-analysis.ts`，统计固定词表。三轮 36 场/臂：

| arm | 有标签场次 | 总次数 | 主要词 |
| --- | ---: | ---: | --- |
| A | 18 | 21 | 其实我 12、原来我 3、不配得感 3、相信自己 3 |
| C | 7 | 11 | 不配得感 5、相信自己 5、其实我 1 |
| E | 7 | 12 | 不配得感 6、相信自己 5、其实我 1 |
| F | 8 | 10 | 相信自己 4、其实我 4、不配得感 2 |
| G | 8 | 8 | 其实我 4、不配得感 2、相信自己 2 |

G 次数最少，但“有标签场次”与 E/F 持平；`其实我` 从 E 的 1 次增到 4 次，说明 V4 只是换了表达，没有消除洞察式措辞。审计是离线统计，不参与评分。

## 改动

| 文件 | 改动 |
| --- | --- |
| `bin/visitor-sim-prompts.ts` | 新增 `SEED_V4_VISITOR_CONSTRAINTS`、`buildSeedV4VisitorPrompt`；variant 增 `seed-v4` |
| `bin/visitor-sim-runtime.ts` | 新增 arm G `Seed-Character/seed-v4` |
| `bin/visitor-sim-analysis.ts` | `SimPromptVariant` 增 `seed-v4`；新增 `INSIGHT_LABEL_PATTERNS`、`auditInsightLabels` |
| `bin/visitor-sim-shadow.ts` | 读取会话元数据时识别 `seed-v4` |
| `test/auto-practice/af232-visitor-shadow.spec.ts` | 新增 V4 prompt 与标签审计回归；21/21 通过 |

## 实验设置

- 只新生成 G：r1/r2/r3 各 12 场、144 轮，36/36 场 0 失败。
- A/C/E/F 复用 AF-240 同 persona×难度、同脚本会话；复制到 `data/phase25-exit/af241-seed-v4/r1|r2|r3` 后统一评分。
- 每轮 60 场；r1 60 份、r2 59 份、r3 59 份评分；失败 2 份为 R2 解析失败。

## 闸门

- `pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts`：21/21 通过。
- `pnpm lint`：0 error / 0 warning。
- `pnpm typecheck`：exit 0。
- `pnpm test`：252 文件通过 + 1 skipped；4217 tests 通过 + 4 skipped。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差

- 任务单写“若 G 不低于 E 再补 2 轮”，实测 r1 高于 E，于是补跑；补跑后未维持，按不进入候选处理。这个门槛本身应改成“先跑 2 轮再决定”，单轮不作为晋级依据。
- 抽象标签审计只做词表统计，不能判断语境是否合理；“不配得感？”后接自嘲仍会被计数。

## 限制

- 12 场/轮、AI 双评，不是真人督导；不能据此判断临床达标。
- `plot-zero` 在 G r2 出现 1 次，说明 V4 的“收回/转移”仍可能被模型写成剧情化表达。
- V4 代码保留为实验臂，不接生产、不改 provider 路由。
