# AF-450 交付记录 · 台账按 kernelRef 与合成标记分组统计

- 任务：AF-450（orchestrator，`priorTasks: [AF-449, AF-427, AF-435]`）
- 分支：`task/AF-450-ledger-kernelref`（自 `integrate` = `15044d68ee650fb9a0ee11764c22b260082b33e0`）
- 日期：2026-11-24

## 1. 问题

AF-449 落库 6 场 `synthetic: true` 的剧本语料后，`af427-operator-delta-ledger.mjs` 按文件名前缀全量读语料，导致：

- 表三把「剧本喂出来的 100.0% 实测/系数比」混进真实用户语料口径，读者无法判断真实幅度；
- 表三标题写死「13 场 debug 会话」，与实际会话数脱节；
- 会话上的 `kernelRef`（AF-442 起写入的内核 delta 表指纹）没有任何统计消费，语料版本漂移不可见（原承接单 AF-438 挂在永不满足的 `dependsOn: [AF-437]`）。

## 2. 改了什么

`scripts/ops/quality/af427-operator-delta-ledger.mjs`：

1. `loadOperatorCorpusStats` 增 `scope`（`real` / `synthetic` / `all`，默认 `all` 保持向后兼容），非法值显式抛错；返回体补 `scope` / `realSessions` / `syntheticSessions` / `totalFiles`。
2. 新增 `loadCorpusStatsByKernelRef`：按 `kernelRef` 分桶统计会话数 / 轮次 / 其中合成会话数；缺指纹或空白串归 `none`，不造空键、不猜测填充。
3. `buildLedger` 同时给出真实口径、合成口径与 kernelRef 分布三份数据（`corpus` / `syntheticCorpus` / `kernelRefDistribution`），并标 `updatedBy: 'AF-450'`。
4. 渲染侧：表三改真实口径且标题动态写会话数，新增「表三附 · 合成语料覆盖」与「表四 · 语料 kernelRef 分布」两段，各带口径与禁止用法说明。

`scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs`（新增，6 例）：scope 过滤、非法 scope 抛错、分组不改变幅度口径、kernelRef 分桶、空白指纹归 none、端到端渲染断言。

`docs/architecture/behavior-operator-delta-ledger-v1.0.md`：补第七节「语料分组口径（AF-450 起）」，明确四张表的适用与禁止用法，并把新单测加进复算命令。

## 3. 关键设计决策

1. **判定看字段不看文件名**。`synthetic: true` 是唯一判据，文件名前缀只是约定；否则改个文件名就能污染真实口径。
2. **表三语义不变、口径收窄**。真实口径运行后 empathy 34 / 31 / 3、0.2553、88.0%，与 AF-427 文档原数字逐项一致 —— 证明口径拆分没有偷偷改历史结论。
3. **合成语料不删除、不降级**。它仍是「幅度是否生效 / 是否被 cap 吞掉」的唯一现成语料，只是从真实口径里移出来单列，并明写不得作为临床或用户行为证据。
4. **`none` 桶如实暴露**。现存 19 场会话全部无 `kernelRef`（AF-442 之前的历史语料 + AF-449 生成时未写指纹），表四就该显示 `none`，不做补齐。

## 4. 闸门与证据

| 闸门         | 命令                                                                                                                                                                                                   | 结果                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单测         | `pnpm exec vitest run scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs`                                         | 2 files / 15 tests passed（新增 6 + 既有 9，既有台账结论零回归）                                                                                                                |
| 台账实跑     | `node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions`                                                                                                                   | 表三（13 场真实）：empathy 34/31/3、0.2553、88.0%；表三附（6 场合成）：normalization 11、affirmation 12、boundary_cross 8 均 100.0%；表四：`none` 19 场 / 239 轮（含 6 场合成） |
| Lint（定向） | `pnpm exec eslint --config scripts/orchestration/eslint-scripts.config.mjs "scripts/ops/quality/af427-operator-delta-ledger.mjs" "scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs"` | 0 error / 0 warning（无输出）                                                                                                                                                   |
| 类型         | `pnpm typecheck`                                                                                                                                                                                       | 0 error（脚本为 .mjs 不进 tsc，仍跑一次确认无连带影响）                                                                                                                         |
| 红线         | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                              | 空                                                                                                                                                                              |

## 5. 偏差

- 任务单只要求「分组统计」，实现额外补了渲染层的口径说明与「禁止用法」两行 —— 只给数字不给口径，下一位读者仍会把两表混看。
- 末尾多写了一条 6 例单测的端到端断言（表三/表三附/表四标题与会话数一致性），超出「分组单测」的最小范围，但这类数字一旦漂移只能靠断言兜住。

## 6. 遗留

1. **AF-450-B1**：合成语料生成器 `af448-scripted-corpus.ts` 未写 `kernelRef`，所以表四里合成会话落在 `none` 桶。需要给生成器加内核指纹并重跑，才能让合成语料也带版本标签（另开任务，本单 scope 不含该脚本）。
2. **AF-450-B2**：真实语料 13 场全部无 `kernelRef`（早于 AF-442）。历史语料无法回填版本，表四的 `none` 桶会成为长期事实；若要按版本比对幅度漂移，只能等新语料按新版内核落盘。
3. **AF-450-B3**：`pnpm lint` 两条既有 warning（`src/admin-debug/tts/debug-tts.service.ts:13-14` import/order）仍在，非本单引入。
