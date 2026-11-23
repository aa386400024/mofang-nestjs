# AF-420 交付记录：在场 delta 可调性收口（env 覆写键 + 注释漂移）

- 任务：AF-420（继任 AF-419，AF-419 因 scope 缺 `test/config/` 被取消，见 `af419-presence-delta-env-override-2026-11-24.md`）
- 日期：2026-11-24
- 基线：`c62c2059ffbb3ec0232140d5849898d0219c1cfe`（AF-418 合并后的 integrate）

## 1. 问题

内核 `DELTA_TABLE` 里 `holding_present` / `cold_absent` 自 AF-322 起已有非零工程种子幅度：

- `holding_present`：safety +0.004 / bond +0.002 / verbal -0.002 / valence +0.004 / arousal -0.002
- `cold_absent`：trust -0.004 / safety -0.002 / bond -0.002 / verbal +0.004 / depth +0.002 / style +0.002 / valence -0.004 / negative +0.002

但适配层 `resolveDeltaTableConfig` 只装配了 11 个**行为事件**的 `ENGINE_DELTA_*` 键，两类在场事件没有 env 通道。后果是标定批次想调「稳定陪伴 / 机械敷衍」的幅度只能改代码发版——而这恰恰是最需要按 A′ 精确率反复试参的两个事件。

另外 `model-event-mapping.ts` / `model-event-classifier.ts` 仍留着 D-2 阶段注释「两类在场 kind 的 DELTA_TABLE 种子仍是 ZERO」。AF-322 之后这句话已不成立，属于文档漂移：读注释的人会以为通路是空壳，从而重复造轮子或误判现状。

## 2. 改动

| 文件                                                      | 改动                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/delta-table.config.ts`        | 新增 `ENGINE_DELTA_HOLDING_PRESENT` / `ENGINE_DELTA_COLD_ABSENT` 两个字面量读取，走同一套 `parseEventOverride`（非法 JSON / 非法维度 / 非有限数 → 丢弃 + `onWarn` 告警，空串 / 未设 → 不产生覆写项）；文件头「11 键 / 121 个维度键」口径更新为「13 键 / 143」 |
| `.env.example`                                            | 补两键（留空 = 走内核种子），注释写明种子幅度、20 轮累积量级（≈ safety +0.08）与「工程种子值，非临床标定」                                                                                                                                                    |
| `src/engine-adapters/cognition/model-event-mapping.ts`    | 删除「种子是 ZERO」的过期结论，改为指向 AF-322 种子值 + 两个覆写键                                                                                                                                                                                            |
| `src/engine-adapters/cognition/model-event-classifier.ts` | 同上，明确分类器不硬编码幅度，标定走 env 覆写                                                                                                                                                                                                                 |
| `test/config/wp25-env-example-coverage.spec.ts`           | `DELTA_TABLE_ENV_KEYS` 清单同步到 13 键，模板 ↔ 代码双向断言继续成立                                                                                                                                                                                          |
| `test/engine-adapters/wp60-delta-table-config.spec.ts`    | 用例由 12 增至 15：13 键全生效；两键正常解析且只覆盖写到的维度；非法 JSON / 非法维度 / 非法值丢弃并告警（各 1 条，含键名）；空串 / 空白不产生条目；`aggregateTurnDelta` 聚合层验证「覆写逐维度生效、未覆写维度回种子值」                                      |

## 3. 关键设计决策

1. **逐维度换，不是整行替换。** 内核 `resolveDeltaVector` 的优先级是「deltaTable 覆写 > alliance 覆写 > 基础值」，按维度裁决。因此只写 `{"safety":0.02}` 时，`bond` / `verbal` 仍走 AF-322 种子值——这一点由聚合层用例钉死，避免以后有人把覆写实现成整行覆盖。
2. **不新增任何「在分类器里写幅度」的路径。** 幅度真相源只有内核 `DELTA_TABLE` 一处，env 只做覆写。分类器的注释显式写了这条，防止标定时在两个地方各改一份。
3. **口径守卫留在 `wp25` 而不是新建文件。** 该用例本来就是「模板 ↔ 代码一一对应」的单一守卫，扩清单比加第二个守卫更不容易漂移；代价是 scope 必须包含 `test/config/`，这也是 AF-419 取消重登的原因。

## 4. 与任务单的偏差

无。任务单要求的两键装配、模板补齐、注释修正、13 键同步、聚合层优先级断言全部落地。AF-419 → AF-420 的编号变更仅因 scope 缺件，口径与成功标准原样承接。

## 5. 闸门（实测）

| 闸门      | 命令                                                                                                                      | 结果                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 定向单测  | `pnpm exec vitest run test/engine-adapters/wp60-delta-table-config.spec.ts test/config/wp25-env-example-coverage.spec.ts` | 2 文件 / 27 用例全绿，4.80s                                             |
| lint      | `pnpm lint`                                                                                                               | 0 error                                                                 |
| typecheck | `pnpm typecheck`                                                                                                          | 0 error                                                                 |
| 全量测试  | `pnpm test`                                                                                                               | 318 passed / 1 skipped（文件），4816 passed / 4 skipped（用例），26.04s |
| 内核边界  | `git diff --stat HEAD -- src/engine-core`                                                                                 | 空输出（零改动）                                                        |

## 6. 遗留与后续

- **A′ 真实精确率仍未标定**（AF-415 的 40 行 CSV 需人工标注）。有了这两个 env 键，标注完成后可以直接做「幅度 × 精确率」的敏感性扫描，不需要发版。
- **在场幅度上限未受 cap 约束的风险**：单轮 presence delta 仅 0.002–0.004，远低于 cap（safety 上向 0.20），本批不存在截顶；但若标定把幅度放大到 0.05 以上，需要复跑 AF-418 的逐轮重放看是否出现中间触顶分叉。
- **`cold_absent` 的临床口径**仍是单向负向种子值，未与「来访主动冷淡」区分；属临床标定议题，不在本单。
