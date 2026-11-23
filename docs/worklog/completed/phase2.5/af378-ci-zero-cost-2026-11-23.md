# AF-378 交付记录：私有仓 Actions 额度零成本治理

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-378/task-sheet.md`
- 交付日期：2026-11-23
- 任务类型：implementation（R2）
- 基线：`e4b535c15836e60938b3b599135cb950b592a8aa`
- 分支：`task/AF-378-ci-zero-cost`

## 背景

`mofang-nestjs` 私有化后，GitHub Free 只有 2,000 分钟/月。AF-377 合并后的成功 Run `45153445701` 墙钟 146 秒，但 14 个 job 执行合计 984 秒，按 GitHub 每个 job 向上取整约 25 分钟额度/轮。主要浪费来自三处：

1. draft/WIP push 反复触发全量 CI；
2. Unit 与 Coverage 对同一套测试重复执行两遍；
3. R0 纯文档改动仍跑 lint 与 typecheck。

用户明确不购买云主机、不接自托管 runner，本任务只做零新增成本治理。

## 改动

1. `.github/workflows/ci.yml`
   - `pull_request.types` 增加 `ready_for_review`，让 draft 转 ready 时触发一轮全量。
   - `risk-gate` 与 `orchestration-gate` 增加 draft 条件：draft PR 不执行全量 job。
   - `risk-gate` 新增 `run_lint` output。
   - `lint-and-typecheck` 按 `run_lint` 条件化；R0 输出 `Lint skipped by risk gate` 并保持同名 job success。
   - `unit` 三个分片同时承担覆盖率采集：`run_coverage == 'true'` 时执行带 coverage 的 vitest，并上传 `coverage-blob-<shard>`。
   - 删除独立 `coverage-shards` job，`coverage-gate` 改为依赖 `risk-gate + unit`，用 `always()` 保证 R0/R1 的 skipped 语义仍产出 success，同时不掩盖 unit 失败。
   - 保留既有 `concurrency.cancel-in-progress`，同一 PR 新 push 会取消上一轮。
2. `scripts/orchestration/risk-gate.mjs`
   - `gatePlan` 的 `lint` 从固定 `true` 改为 `risk !== 'R0'`。
   - R0 skipped 列表增加 `Lint + Typecheck`；`Coverage` 只保留 `Coverage Gate`。
   - `--github-output` 输出 `run_lint`。
3. `scripts/orchestration/branch-protection.mjs`
   - required contexts 从 14 项收敛为 11 项，删除三个 `Coverage (shard n/3)`。
   - 保留 `Coverage Gate` 与三个 `Unit (shard n/3)`，与合并后的 CI job 名称对齐。
4. `.husky/pre-push` 与 `package.json`
   - 新增 `verify:local = pnpm lint && pnpm typecheck && pnpm test`。
   - pre-push 执行本地权威闸门，把 lint/typecheck/全量单测前移，阻断可本地发现的失败。
5. 测试
   - `v21-adapters.spec.mjs` 增加 R0 `plan.lint === false` 断言。
   - `orchestration.spec.mjs` 的 required contexts 总数从 14 改为 11，并同步用例标题。

## 关键设计决策

- **不引入第二套覆盖率采集**：Unit 分片本来就是全量测试，只是按 shard 拆开；在同一分片内加 `--coverage` 不增加测试次数，只增加覆盖率插桩开销，省掉三个独立 Coverage job 的 checkout、install、migration 与测试重复执行。
- **required check 不缩水**：删除的是重复的 `Coverage (shard n/3)`，不是 `Coverage Gate`；覆盖率阈值仍在合并后的全量结果上执行。
- **draft 不跑全量，ready 再跑**：draft 阶段只保留人工本地闸门；转为 ready-for-review 时由 `ready_for_review` 事件触发全量，避免 WIP push 消耗额度。
- **R0 跳过 lint 但不跳过 required check**：`lint-and-typecheck` job 仍存在并输出 skipped step，GitHub 记为 success，分支保护不会因 check 缺失而卡住。
- **本地 pre-push 不跑 coverage**：coverage 只在 R2/ready PR 的 CI 上执行；本地全量单测覆盖行为正确性，避免本地每 push 多花约 18 秒插桩时间。
- 未改 engine-core、业务代码、数据库迁移与生产配置；未关闭分支保护，未减少 required check 覆盖。

## 验证

| 闸门              | 命令                                                                                                                                | 结果                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 编排单测          | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs scripts/orchestration/__tests__/v21-adapters.spec.mjs` | 283 passed，0 failed                                                                                |
| Lint              | `pnpm lint`                                                                                                                         | exit 0                                                                                              |
| Typecheck         | `pnpm typecheck`                                                                                                                    | exit 0                                                                                              |
| 全量单测          | `pnpm test`                                                                                                                         | 311 passed / 1 skipped 文件；4749 passed / 4 skipped 用例；26.82s                                   |
| 全量覆盖率        | `pnpm test:coverage`                                                                                                                | 311 passed / 1 skipped 文件；4749 passed / 4 skipped 用例；43.85s；阈值通过                         |
| CI YAML 解析      | `node -e` + `yaml.parse('.github/workflows/ci.yml')`                                                                                | 9 个 job 可解析；`pull_request.types` 含 `ready_for_review`；`coverage-gate.needs=[risk-gate,unit]` |
| required contexts | `branch-protection.mjs` 常量                                                                                                        | 11 项，无 `Coverage (shard n/3)`                                                                    |
| 远端保护 apply    | `node scripts/orchestration/branch-protection.mjs --repo aa386400024/mofang-nestjs --branch integrate --apply`                      | `verification.pass=true`，11 项 contexts 全部读回一致                                               |
| engine-core 边界  | `git diff --stat HEAD -- src/engine-core`                                                                                           | 空                                                                                                  |

## 额度前后估算

| 项目             | 优化前                    | 优化后                                  |
| ---------------- | ------------------------- | --------------------------------------- |
| 全量轮 job 数    | 14                        | 11（Unit 吸收 Coverage 三个分片）       |
| 全量轮额度       | 约 25 分钟                | 约 20 分钟                              |
| WIP push         | 每次都触发全量            | draft 不触发，ready 才触发              |
| R0 文档 PR       | 跑 lint/typecheck/unit 等 | 跳过 lint/typecheck，仅保留必需轻量检查 |
| 2,000 分钟可支撑 | 约 80 轮                  | 约 100 轮                               |

## 偏差与遗留

- 无任务单偏差。
- `concurrency.cancel-in-progress` 是既有配置，本任务只核对并纳入额度口径，不重复实现。
- 远端 `integrate` 分支保护已 apply：`verification.pass=true`，required contexts 为 11 项，无旧 `Coverage (shard n/3)`。
- 私有仓 2,000 分钟额度是 GitHub Free 口径；若后续额度仍不足，下一层方案才是自托管 runner，本任务不引入。
- 历史孤儿记录包 AF-363..AF-372、AF-376 仍按 state-free 口径跳过，不在本任务范围。

## 提交信息

`feat(wpAF-378): 私有仓 Actions 额度零成本治理`

## 回执冻结

- 回执：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-378/receipt-RC-AF-378-1.json`
- receiptId：`RC-AF-378-1`
- 内容哈希：待 `receipt freeze` 后回填。
