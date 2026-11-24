# AF-448 交付记录 · 零语料算子剧本补语料

- 任务：AF-448（orchestrator，`priorTasks: [AF-447, AF-427]`）
- 分支：`task/AF-448-scripted-corpus`（自 `integrate` = `df537e60cbc150fedfd84bfc3554c496f923419b`）
- 日期：2026-11-24

## 1. 做了什么

新增 `scripts/ops/quality/af448-scripted-corpus.ts`：用**人工剧本 + 生产同款规则分类器 + 内核 delta 聚合**补出 `normalization` / `affirmation` / `boundary_cross` 三类零语料算子的可复现语料。

- 6 个剧本场景、34 个咨询师轮，每轮台词都刻意包含词表长词（不用裸词），避免否定抑制与遮盖消歧把命中吃掉。
- 每轮走 `RuleBasedClassifier({ semantics: 'v2' })`（与生产同一实现），事件与 delta 由 `aggregateTurnDelta` 真实计算，不伪造引擎输出。
- 落盘 `data/debug-sessions/debug_scripted_af448_<n>.json`（该目录 gitignored，不入库）。
- 会话固定带 `synthetic: true` / `generationMethod: 'rule-track-scripted-replay'` / `scriptedScenario` / `scriptedSummary` / 隐私 `note`，供台帐与后续分桶区分真实语料与合成语料。
- 控制台只输出计数，不打印逐字稿原文（隐私红线）。

## 2. 关键设计决策

1. **只补规则轨可判定的三类**。`holding_present` / `cold_absent` 是模型轨跨轮事件，`rule-based-classifier.ts` 头注明确规则轨不产出这两个标签；用规则剧本伪造它们等于造假证据，因此本批不做，留 backlog 走真跑 LLM 的评测批次。
2. **复用生产分类器而不是自写正则**。剧本是"输入"，判定必须走生产同款实现，否则补出来的语料无法验证生产链路。
3. **合成标记先于分桶**。`af427-operator-delta-ledger.mjs` 目前不做 `synthetic` 过滤（kernelRef / 合成分桶是另一单 AF-438 承接），所以标记必须落在会话本体里，避免后续分桶无处可依。
4. **脚本放 `scripts/ops/quality/`**，与 `af322-classifier-shadow-audit.ts`、`af427-operator-delta-ledger.mjs` 同域，用 `pnpm exec tsx` 跑，不引入裸 `npx`。

## 3. 闸门与证据

| 闸门     | 命令                                                                                 | 结果                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 干跑     | `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --dry-run`               | exit=0，场景=6 / 咨询师轮=34，`{"acceptance":3,"affirmation":12,"normalization":11,"boundary_cross":8,"neutral":2}`，三类零语料算子全部命中，未写盘                |
| 落盘     | `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --apply`                 | 6 个文件写入 `data/debug-sessions/`（4328–5379 字节），`git status` 对这些文件无输出（gitignored 确认）                                                            |
| 台帐复核 | `node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions` | 表三：`normalization` 11 轮（单算子 10 / 多算子 1，实测/系数比 100.0%）、`affirmation` 12 轮（11/1，100.0%）、`boundary_cross` 8 轮（8/0，100.0%）；三类此前均为 0 |
| 类型     | `pnpm typecheck`                                                                     | 0 error                                                                                                                                                            |
| 红线     | `git diff --stat HEAD -- src/engine-core`                                            | 空                                                                                                                                                                 |

## 4. 偏差与说明

- 原任务单为 AF-447，因登记时 `baselineRef` 留空导致 `task promote` 判「基线不明确」拒绝提级；按编排纪律不得原地改任务单，走 `task reissue --from AF-447 --sheet ... --apply --archive-old` 重签为 AF-448（scope 与目标不变，`priorTasks` 指向 AF-447），AF-447 转为 canceled 并归档。AF-447 的占位交付记录 `af447-scripted-corpus-2026-11-24.md` 记录该重签事实，只作为归档补齐件，不含实现内容。
- 剧本台词是按词表设计的**合成输入**，不是真实来访语料；任何结论只能用于验证「算子幅度是否生效 / 是否被 cap 吞掉」，不得作为临床或用户行为证据。

## 5. 遗留

1. `holding_present` / `cold_absent` 两类跨轮模型轨事件仍零语料，需真跑 LLM 的评测批次才能补（本轮不伪造）。
2. `af427-operator-delta-ledger.mjs` 尚未按 `kernelRef` / `synthetic` 分桶统计，合成语料会与真实语料混在同一张表三；承接单为 AF-438（原 `dependsOn: [AF-437]` 已永不满足，需重签发后再做）。
3. `pnpm lint` 存在 2 条**既有** warning（`src/admin-debug/tts/debug-tts.service.ts:13-14` import/order），非本单引入，未顺手改（跨域且需单独任务单）。
