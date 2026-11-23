# AF-427 交付记录：行为算子 delta 幅度台账 v1.0

- 日期：2026-11-24
- 任务：AF-427（implementation / orchestrator）
- 基线：`67e54372e171920fad603e667b181cfce59cb9b7`（AF-426 合并点）
- 分支：`task/AF-427-operator-delta-ledger`
- 新增：`scripts/ops/quality/af427-operator-delta-ledger.mjs`、`scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs`、`docs/architecture/behavior-operator-delta-ledger-v1.0.md`

## 1. 做了什么

把内核 `DELTA_TABLE` 的 13 算子 × 11 维系数做成可复算台账，回答 AF-426 遗留的「行为算子幅度未成台账」：

1. **解析而非抄写**：`parseDeltaTable` 从 `src/engine-core/cognition/state-transition.ts` 源码里按块解析系数，跳过注释行，`neutral: ZERO` 展开为全 0。缺算子、缺维度、出现未登记算子一律抛错，不静默补 0。
2. **cap 占用**：`operatorCapUsage` 逐维算 `|系数|/单轮 cap`，给出算子最大占用与所在维度。
3. **语料实测**：`loadOperatorCorpusStats` 扫 13 场 debug 会话，按 `deltaDetail.events` 统计命中轮次、单算子轮与多算子同轮，并用**单算子轮**算实现幅度均值——多算子同轮时 deltaDetail 是合并向量，分开计会把幅度放大（首版统计里 open_probe 因此虚高 143%，修正后 98.1%）。
4. **台账正文**：三张表 + 四条结论 + 五类边界说明，含「5 个算子零语料」这条最关键的覆盖缺口。

## 2. 关键结论

- 无算子单事件触顶，最高 75%（`boundary_cross.style` / `sensitive_touch.arousal`），cap 仍不是瓶颈。
- 阻抗三维（style/depth/verbal）在破坏性算子上占用普遍高于 trust，同轮两个破坏性算子时阻抗最先触顶。
- 13 个算子有 5 个在 205 轮语料里 0 命中：`normalization`、`affirmation`、`boundary_cross`、`holding_present`、`cold_absent`。其系数属「写下来但从未被行为验证」。
- 破坏性算子实测 = 系数 100%，说明原样落地；`empathy` 实测 88%，差额集中在 safety（实测 0.0140 vs 表值 0.060），原因待核实（语料快照早于系数调整 / AllianceConfig 覆写），已在台账里写明「核实前勿对外解释 0.06」。

## 3. 设计取舍

- **不引入第二份系数表**：解析源码是唯一真相源；解析器失败即报错，避免台账与内核各写一份后互相漂移（AF-422 的 cap 镜像靠单测兜住，这里更进一步，连镜像都不写）。
- **单算子轮 / 多算子轮分开统计**：这是本单最有价值的口径修正，直接改变了一个结论（open_probe 143% → 98.1%）。台账保留两列，让口径差异可见而非被平均掉。
- **不写 src**：本单只在 scripts/ + docs/ 内工作，内核零改动（`git diff --stat HEAD -- src/engine-core` 空）。`src/engine-adapters/deliberation/deliberation-types.ts` 第 101 行过期注释仍在 backlog，需 executor 骨架任务处理。

## 4. 闸门数字

| 闸门      | 命令                                                                                        | 结果                                                                                                |
| --------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 定向单测  | `pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs` | 9 passed / 0 failed                                                                                 |
| lint      | `pnpm lint`                                                                                 | 0 error 0 warning（首轮 1 error：.mjs 里用了 `__dirname`，改 `fileURLToPath(new URL(...))` 后清零） |
| typecheck | `pnpm typecheck`                                                                            | 0 error                                                                                             |
| 全量测试  | `pnpm test`                                                                                 | 321 passed / 1 skipped（文件）、4847 passed / 4 skipped（用例）、27.75s                             |
| 内核边界  | `git diff --stat HEAD -- src/engine-core`                                                   | 空输出                                                                                              |

## 5. 遗留

- `empathy.safety` 实测与表值的 88% 偏差待核实（两条候选解释已写进台账，需要一次带版本信息的重放才能定论）。
- 零语料 5 个算子需要专门构造剧本补语料；`boundary_cross` 作为最重的破坏性算子至今 0 命中，属优先级最高的补语料对象。
- `deliberation-types.ts:101` 过期注释仍未修（src 域，交 executor）。
