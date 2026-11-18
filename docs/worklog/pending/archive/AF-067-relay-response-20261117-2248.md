# AF-067 · executor 回复（派单时间 2026-11-17 22:48）

> 任务：AF-067 · 回归判定器四态边界回归测试补齐
> 角色：executor（只做实现与回执；提交 / 状态迁移 / 归档由主控执行）
> 仓库：`D:\work\Project\backend\mofang-nestjs`
> 分支：`task/AF-067-regression-evaluator-boundary-tests`
> 基线：`79a5ee2bf7d213bd74f9a92a44e86909176eec87`

## 1. 结论

**completed / reviewVerdict=passed。** 新增 `test/auto-practice/regression-evaluator-boundary.spec.ts`（338 行 / 27 例），定向回归全绿；零生产代码改动；`src/auto-practice/metrics/regression-evaluator.ts` 未动，`git diff --stat HEAD -- src/engine-core` 为空。

## 2. 交付物

| 工件                     | 路径                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 新增回归测试（唯一代码） | `test/auto-practice/regression-evaluator-boundary.spec.ts`                                                              |
| 交付记录                 | `docs/worklog/completed/phase2.5/af067-regression-evaluator-boundary-tests-2026-11-17.md`                               |
| 机读回执                 | `docs/team/agent-orchestration/transport/receipts/AF-067.json`（已过 `validateReceiptHandover`：valid=true, errors=[]） |
| 回复原文                 | `docs/worklog/pending/relay-response-20261117-2248.md`                                                                  |

未改 `src/`、未改既有测试（含 `test/auto-practice/wp-k-regression-evaluator.spec.ts`）、未碰 `data/batch-reports/**`、`admin-dashboard/**`、`web/orchestration/**`。

## 3. 覆盖对照（逐条对应派单要求）

| 派单要求                                | 覆盖情况                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| acceptance 不同 → incomparable          | ✓ 理由精确 `['两批验收判据 (acceptance) 不同']`；`items=[]`；`changedSegments` 含 `acceptance`                                                                                      |
| 任一批覆盖率 < 0.9 → incomparable       | ✓ 基线批 0.8 / 候选批 0.8 各自精确指认；另加 **恰好 0.9 仍可比**、0.89 不可比两侧                                                                                                   |
| counselorModeId 集合不同 → incomparable | ✓ 理由精确，且断言**不误报** characterSlug 原因；另加「集合 size 同、成员不同」仍不可比                                                                                             |
| characterSlug 集合不同 → incomparable   | ✓ 理由精确，且断言**不误报** counselorModeId 原因                                                                                                                                   |
| combined=unknown → incomparable         | ✓ 基线批 / 候选批两条理由分别精确断言；另加「仅 combined 不同 → 7 段 `changedSegments=[]`」                                                                                         |
| regressed 优先于 improved               | ✓ trust↑（improved）+ zero_motion↑（lower_is_better → regressed）→ 整批 `regressed`；两条 item 的 movement 分别断言                                                                 |
| neutral 方向指标不参与好坏判定          | ✓ `event.empathy.rate` / `dim.arousal.delta_avg` / `session.outcome.completed` / `text.disfluency.filler_per_turn` 剧变 → `items=[]`、`verdict=neutral`；并验证不掩盖方向指标的改善 |
| REGRESSION_TOL 边界                     | ✓ **等于容差**（base=0 / candidate=`REGRESSION_TOL`，二进制下精确相等）→ neutral；**略超 1e-6** → movement（正/负、higher/lower 四种方向各一例）                                    |

额外加固（超出派单最小要求，用于锁死「不可比时绝不硬比」）：多条不可比原因并存时按生产顺序**齐出四条、不合并不去重**；候选批缺指标 / 任一侧 `null` / 指标 id 不在字典中 → 一律跳过不产出 improved/regressed。

浮点口径如实说明：`0.51 - 0.5 = 0.010000000000000009 > REGRESSION_TOL`，故「十进制意义上的恰好 0.01」实际判为 movement —— 该事实由**独立用例显式锁定**，不与「等于容差 → neutral」用例混写，避免误以为容差判定有 1e-16 余量。

## 4. 闸门真实数字（2026-11-17 现场复跑，机器 `DESKTOP-E3EVQ9P` / node v26.13.1）

| 闸门                 | 命令                                                                            | 结果                                                      |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 定向回归（任务闸门） | `pnpm exec vitest run test/auto-practice/regression-evaluator-boundary.spec.ts` | exit 0；1 file / **27 tests passed / 0 failed**；333ms    |
| 目录回归（加固）     | `pnpm exec vitest run test/auto-practice/`                                      | exit 0；20 files / **333 tests passed / 0 failed**；2.31s |
| 类型检查（任务闸门） | `pnpm typecheck`                                                                | exit 0；**0 error**                                       |
| 类型检查（含 test/） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`         | exit 0；**0 error**（实际覆盖新增 spec 文件）             |
| Lint                 | `pnpm lint`                                                                     | exit 0；**0 error / 0 warning**                           |
| 内核边界             | `git diff --stat HEAD -- src/engine-core`                                       | **空**                                                    |

⚠️ 口径提醒：`pnpm typecheck` 走 `tsconfig.check.json` → `tsconfig.build.json`，其 `exclude` 含 `**/*.spec.ts` 与 `test/**/*`，**不覆盖新增的 spec 文件**。故额外跑了根 tsc（`include` 含 `test/**/*`）确认新增文件本身 0 error，两条均已写入回执 `gateResults`。

## 5. 范围与隔离

- 只新增 1 个测试文件 + 交付记录 + 回执 + 本回复，共 4 个文件，全部落在任务单 scope（`test/auto-practice/`、`docs/worklog/pending/`、`docs/worklog/completed/phase2.5/`）内。
- 未运行任何 `node scripts/orchestration/cli.mjs` 子命令（未 promote / resume / run-once / archive / channel confirm）；未 `git commit` / `push` / `checkout` / `reset`；未领单、未改状态索引、未改事件链。
- 工作树内存在并行产物（`data/batch-reports/**` 增删、`admin-dashboard/pnpm-lock.yaml`、`web/orchestration/data.js`、编排状态面文件、AF-064 / AF-066 任务单、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 等），**一律未计入本单交付集**（回执 `changedFiles` 只列本单 3 个文件，`parallelArtifactsExcluded=true`）。
- 未跑 LLM 批次、未动数据库 / Redis / `.env`。

## 6. 偏差（3 条，均已在交付记录 §7 与回执 `deviationTable` 如实登记）

1. **类型闸门不覆盖 spec**：保留 `pnpm typecheck` 并补跑根 tsc，避免用不含该文件的闸门冒充验证。
2. **任务单归档与状态迁移留给主控**：`conventions.md` §六要求任务单随交付记录一同移入 `completed/phase2.5/`，但本单状态由主控持有且 executor 被禁止跑归档类命令，故任务单原文保持不动。
3. **机读回执落 transport 收件箱**：`transport/` 在 `.gitignore` 内，durable 副本由编排摄取流程复制到 `docs/worklog/pending/archive/`，executor 不越权写 archive（避免双份与指纹不一致）。

## 7. 遗留（1 条）

- **BL-AF067-01（low，既有债）**：类型闸门对 `test/**/*.spec.ts` 长期无覆盖。本单已补跑根 tsc 兜住，但工程缺口需另立任务单改 `tsconfig.check.json` 的 include/exclude，不在本单范围内改。

## 8. 请主控接手

1. 提交本单 4 个文件（建议 commit message：`test(AF-067): 补齐回归判定器四态边界回归测试`）。
2. `run-once` 摄入回执（transport 收件箱 → `docs/worklog/pending/archive/` durable 副本）。
3. 把任务单移入 `docs/worklog/completed/phase2.5/`，并更新状态索引 / 事件链（`finalStatus=completed`、`reviewVerdict=passed`）。
