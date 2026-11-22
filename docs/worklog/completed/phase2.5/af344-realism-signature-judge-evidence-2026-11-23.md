# AF-344 · 签名判据 v1 交付证据返修

> 本单只补 AF-342 的交付证据与编排闭环，不改任何实现代码。AF-342 的代码与回验已在提交 `7d1d200c` 落盘并通过全量闸门；机读验收 rejected 的原因是证据链缺陷，而非实现失败。

## 1. 范围与事实

| 项 | 内容 |
| --- | --- |
| 任务 | AF-344（`documentation`，返修自 AF-342） |
| 分支 | `task/AF-344-realism-judge-evidence` |
| 实现基线 | `7d1d200c`（AF-342 实现提交，保留在分支历史） |
| 改动范围 | 仅 `docs/worklog/completed/`、`docs/worklog/records/`、编排状态产物 |
| 代码改动 | 无（`src/`、`bin/`、`test/` 零改动） |

## gateResults

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | exit 0，0 error |
| 静态检查 | `pnpm lint` | exit 0，0 error / 0 warning |
| 全量测试 | `pnpm test` | 297 文件通过 / 1 跳过（298）；4554 例通过 / 4 跳过（4558） |
| 定向单测 | `pnpm exec vitest run test/shared/realism/realism-humanization-judge.spec.ts` | 16/16 通过 |
| 纯层边界 | `git diff --stat HEAD -- src/engine-core` | 输出为空 |
| 编排前置 | `pnpm orchestration:preflight` | PASS files=7（提交 `7d1d200c` 时） |

## scopeCheck

- 允许域：`docs/worklog/completed/`、`docs/worklog/records/`。
- 实际改动：AF-342/344 交付记录、记录包、编排索引与事件产物。
- 越界改动：无。`src/shared/realism/realism-humanization-judge.ts`、`bin/visitor-realism-humanization-judge.ts`、`test/shared/realism/realism-humanization-judge.spec.ts` 均未修改。

## contractChecks

| 契约 | 核对 |
| --- | --- |
| `realism-signature-judge-v1` 判据口径 | 与 AF-342 实现一致：签名轴 `repair/turn ≥ 0.05`、`pause/turn ≥ 0.9` 或 `trailoff/turn ≥ 0.15`；密度轴 `> 4.943817`；三态 `off-like / humanized / overloaded` |
| 回验样本 | 7 臂 × 16 = 112，零模型调用，结果见 `data/phase25-exit/af342-realism-signature-judge/report.json` |
| 回验关键数字 | off 误报 `0/16`；full 签名覆盖 `16/16`；焦虑 tightened 8/8 humanized；回避 tightened 8/8 off-like |
| 任务单工件指针 | 指向 `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-344/task-sheet.md`，不再使用 `transport/` |
| 机读回执 | `receipt-AF-344` 引用 `7d1d200c` 与本单文档提交，`changedFiles` 与 git 事实一致 |

## backlogItems

| ID | 事项 | 状态 |
| --- | --- | --- |
| AF-344-B1 | 三个签名阈值样本量偏小，需 off 扩到 32 后重估 | open |
| AF-344-B2 | 焦虑 `repair/turn ≥ 0.05` 偏宽，考虑提高到 0.08–0.10 | open |
| AF-344-B3 | 判据尚未接入流水线，当前为离线 CLI | open |
| AF-344-B4 | 无真人听感验证，仅有工程签名 | open |
| AF-344-B5 | 密度上限是报警线，不是产品验收线 | open |

## deviationTable

| 项 | 任务单预期 | 实际 | 理由 |
| --- | --- | --- | --- |
| 返修方式 | 走 `task reissue` 从 AF-342 派生 | AF-342 归档后 reissue 拒绝（仅支持活跃任务），改为新登记 AF-344 并保留 `priorTasks: [AF-342]` | CLI 行为边界，审计链通过 priorTasks 保留 |
| AF-343 | 曾尝试作为返修单 | 因依赖 AF-342:rejected 无法 promote，已取消 | 依赖门控不接受 rejected 上游，新单不再声明依赖 |
| 交付记录 | 只补标记 | 同时修正 AF-342 记录中 preflight “待执行”为真实 PASS | 保持历史事实一致 |

## reviewVerdict

- 结论：**conditional-pass**。
- 依据：代码与回验已在 `7d1d200c` 完成并通过全量闸门；本单补齐六组机读标记、修正任务单指针、生成可摄入回执。
- 条件：签名判据仅影子可用，不得作为临床有效性证据；上线前需完成 B1–B4。
- 临床边界：无真实咨询师在环，AF-326 跨模型 κ 约 `0.43–0.44`，所有数字均为工程种子。
