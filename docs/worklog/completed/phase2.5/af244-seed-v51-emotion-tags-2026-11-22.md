# AF-244 · V5.1 合法情绪标记枚举与两轮确认

> AI 影子对照，不是真人督导双标，不声称临床达标。V5.1 只验证格式枚举，不接生产。

## 结论

V5.1（arm I）把 `tag-error-rate` 降到 0，但盲评明显回落，**不采纳为候选**：

- r1 I `3.625`，H `4.0`，E `3.833333`；I 比 H 低 `0.375`，也比 V2 低 `0.208333`。
- r2 I `3.875`，H `4.041667`，E `3.958333`；I 比 H 低 `0.166667`，比 V2 低 `0.083333`。
- 硬门槛两轮全过，合作指数仍低于 E；但“不穿自然度”是前提，V5.1 没守住。

结论：不要在 prompt 里硬枚举 emotion 标签；V5 的 `[emotion:anxious]` 应在**输出投影层**做归一化或剥离，而不是用约束换自然度。

## 结果

| 轮 | arm | 盲评均分 | 自然度 | 关系在场 | 合作指数 | four-rate | tag-error | 硬门槛 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r1 | E | 3.833333 | 3.833333 | 4 | 0.097222 | 0.75 | 0 | 过 |
| r1 | H | 4.000000 | 3.916667 | 4.416667 | 0.034722 | 0.416667 | 0.006944 | 过 |
| r1 | I | 3.625 | 3.666667 | 4.041667 | 0.055556 | 0.458333 | 0 | 过 |
| r2 | E | 3.958333 | 3.875 | 4.083333 | 0.090278 | 0.625 | 0 | 过 |
| r2 | H | 4.041667 | 4 | 4.291667 | 0.0625 | 0.708333 | 0.006944 | 过 |
| r2 | I | 3.875 | 3.916667 | 4.25 | 0.069444 | 0.458333 | 0 | 过 |

两轮均值：I `3.75`，H `4.020833`，E `3.895833`。I 的 `tag-error=0` 是以自然度下降换来的，不符合验收条件“盲评均值不低于 H 对应轮次 0.05 内”。

## 实验设置

- 只新生成 I 臂 12 场×2 轮，24/24 场 0 失败。
- E/H 复用 AF-243 同轮会话与 ratings-cache；每轮 84 场统一评分，I 12 份完整。
- 评分双轨不变：R1 `MiniMax-M3.1-Flash`、R2 `doubao-seed-2-1-lite-260915`。
- 数据在 `data/phase25-exit/af244-seed-v51/r1|r2`，不入库。

## 改动

| 文件 | 改动 |
| --- | --- |
| `bin/visitor-sim-prompts.ts` | 新增 `SEED_V51_TAG_ENUM_CONSTRAINTS`、`buildSeedV51VisitorPrompt`、variant `seed-v51` |
| `bin/visitor-sim-runtime.ts` | 新增 arm I `Seed-Character/seed-v51` |
| `bin/visitor-sim-analysis.ts` | 类型加 `seed-v51` |
| `bin/visitor-sim-shadow.ts` | variant 白名单加 `seed-v51` |
| `test/auto-practice/af232-visitor-shadow.spec.ts` | 新增 V5.1 标签枚举回归 |

## 闸门

- `pnpm exec vitest run test/auto-practice/af232-visitor-shadow.spec.ts`：24/24 通过。
- `pnpm lint`：0 error / 0 warning。
- `pnpm typecheck`：exit 0。
- `pnpm test`：252 文件通过 + 1 skipped；4220 tests 通过 + 4 skipped。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差与限制

- 首轮 `--max-packets 36` 使 I 只有 6 场入选；已用 `--max-packets 84` 补齐，最终 I 12/12，记录只采用补齐后的数据。
- 只跑两轮，样本仍小；但方向已明确：硬约束标签会伤自然度，不需要第三轮。
- V5 的 `[emotion:anxious]` 仍未在投影层解决；建议独立任务做未知 emotion 标签归一化，而不是继续改 prompt。
