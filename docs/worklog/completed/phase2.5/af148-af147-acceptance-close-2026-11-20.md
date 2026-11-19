# AF-148 · AF-147 验收机械门修复与重开交付记录

- **taskId**：AF-148
- **日期**：2026-11-20
- **分支**：`task/AF-148-af147-acceptance-rework`
- **基线**：`15c25dc2e12c5d5455c27abbafe89351c680904e`（AF-147 实现提交）
- **性质**：验收材料修复，不是新增实现。代码相对 AF-147 零改动。

## 1. 结论

AF-147 的实现与质量结论不变：**AI 六项硬门仍为 5/6，overall 跨模型 κ 0.365854 < 0.40，未达标。** 本单只修机读验收的机械门：

- AF-147 任务单 `taskSheet: 含 CR` → 本单任务单为 UTF-8 无 BOM、LF。
- AF-147 交付记录缺六组机读字段标记 → 本记录逐字包含六组标记。
- 不改 0.40 阈值，不把 5/6 写成“AI 层面达标”，不写“临床验收达标”。

## gateResults

| 命令 | exitCode | errors | warnings | 实测 |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | 0 | 0 | 0 | `tsc -b tsconfig.check.json`，01:06 复跑通过 |
| `pnpm lint` | 0 | 0 | 0 | src/test/bin + scripts，0 error / 0 warning |
| `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | 0 | 0 | 0 | 2 files / 28 tests passed（16 + 12） |
| `pnpm test` | 0 | 0 | 0 | AF-147 同一代码 01:01 全量：221 files passed + 1 skipped；3873 tests passed + 4 skipped |
| `pnpm orchestration:preflight` | 0 | 0 | 0 | ORCH-GATE PASS |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 0 | 0 | 事件 644 条；schema、哈希链与索引投影一致 |
| `node scripts/orchestration/cli.mjs validate` | 0 | 0 | 0 | AF-148 任务单 PASS |

## scopeCheck

- **in-scope**。本单只新增 `af148-af147-acceptance-rework-task-2026-11-20.md`、`af148-af147-acceptance-close-2026-11-20.md`，并更新 `phase2.5-README.md` 的验收说明。
- 未修改 `src/auto-practice/metrics/ai-double-blind.ts`、`bin/ai-double-blind.ts`、`test/auto-practice/ai-double-blind.spec.ts`。
- `src/engine-core` 相对 AF-147 零 diff。
- 工作区存在历史 AF-128 的 `src/shared/llm/reasoning-text.ts` 改动，**不属于本单、未提交**。

## contractChecks

| item | result | note |
| --- | --- | --- |
| taskId | pass | AF-148 任务单、索引、回执、交付记录一致 |
| stateWrite | pass | register / promote / run-once 均经 CLI，状态面未手改 |
| indexSchema | pass | task-state-index 由 CLI 写入 |
| eventChain | pass | events verify 通过 |

## backlogItems

| 编号 | 遗留 | 处置 |
| --- | --- | --- |
| OI-AF148-01 | overall κ 0.365854 < 0.40，AI 质量门 5/6 | 后续评分口径/扩簇任务，不在本单改阈值 |
| OI-AF148-02 | 硬上限仍在评分员 prompt | 另单做后处理硬上限 |
| OI-AF148-03 | 96 场为跨版本校准集 | 仅作口径校准，不替代 AF-146 单批 |
| OI-AF148-04 | κ 门缺 CI 下界与 AC1/α | 另单补统计口径 |
| OI-AF148-05 | 结构缺口 5/16 | 另单修风险/收束结构 |

## deviationTable

| 项 | 任务单要求 | 实际 | 处置 | 原因 |
| --- | --- | --- | --- | --- |
| 任务编号 | AF-147 返修 | AF-147 已被机读门 rejected 并归档，不能复活终态 | 新登记 AF-148 承接验收修复，priorTasks 保留 AF-147 | 不改写已归档证据，不手改状态面 |
| 代码范围 | 只修验收材料 | 工作区有 AF-128 历史改动 | AF-148 只提交 docs；AF-128 不纳入 | 避免并行产物混入 |
| 质量结论 | AI 层面尽量达标 | κ 0.365854 < 0.40，5/6 | 如实判未达标 | 不调阈值、不扩样本冒充达标 |
| 全量测试 | 收尾一次 | 全量在 AF-147 同一代码上 01:01 通过；本单仅 docs 改动 | 复用同代码全量结果，复跑 typecheck/lint/定向 | docs 改动不影响测试结果 |

## reviewVerdict

**conditional-pass**：AF-147 实现与闸门证据完整、代码零改动、验收材料机械门已修复；但 AI 质量门仍 5/6，κ 未过 0.40，故不是 AI 层面质量达标，只完成验收闭环。

## 2. 证据

- AF-147 实现提交：`15c25dc2e12c5d5455c27abbafe89351c680904e`
- AF-147 交付记录：`docs/worklog/completed/phase2.5/af147-kappa-track-2026-11-20.md`
- 96 场最佳口径：`data/phase25-exit/af147-kappa-96-out/`
- 96 场盲包：`data/phase25-exit/af147-kappa-96/blind-map.json`
- MiniMax 复核：`docs/worklog/pending/relay-response-AF147-20261120-0015.md`
- 复现口径：R1 MiniMax-M2.7 / R2 MiniMax-M3.1-Flash / R3 MiniMax-M3；同方法同锚点序、温度 0.1、arbitrate-gap=0、并发 6；overall exact 83/96、within±1 96/96、κ 0.365854。
