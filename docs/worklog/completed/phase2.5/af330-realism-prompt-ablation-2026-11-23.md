# AF-330 · 来访者真人度 prompt 分层消融交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 消融纯模块 | `src/shared/realism/realism-prompt-ablation.ts` |
| 真实消融 CLI | `bin/visitor-realism-prompt-ablation.ts` |
| 单测 | `test/shared/realism/realism-prompt-ablation.spec.ts` |
| 消融实测报告 | `docs/worklog/completed/phase2.5/af330-realism-prompt-ablation-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af330-realism-prompt-ablation-2026-11-23.md` |
| 原始 JSON（gitignored，不入库） | `data/phase25-exit/af330-realism-ablation/report.json`、`smoke.json` |

## 实现要点

1. `realism-prompt-ablation.ts` 固定 5 个分支：`off` / `full` / `quota` / `event` / `context`。除 `off` 外，块的首行标题保留，directive 行逐字来自生产 `buildVisitorRealismPromptBlock`，不重写；`full` 逐字等于生产块。
2. 两个人设：焦虑依恋（复用 AF-329 的 28 岁林晓基础人设，显式 `attachmentStyle='anxious'`，`riskLevel='none'`）与回避依恋（41 岁陈默，`attachmentStyle='avoidant'`，`trust=0.32`）。
3. `bin/visitor-realism-prompt-ablation.ts` 复用生产 `LlmService.streamChat`，provider `doubao`，默认 `doubao-seed-character-260628`，温度 0.6、maxTokens 160、超时 45s；逐人设、逐分支、逐重复跑 6 轮，失败即停并计数。
4. 报告只输出数字与分支 id；不输出完整台词。CLI 支持 `--personas` / `--arms` / `--reps` / `--turns` / `--json` / `--out`；退出码 0 正常、2 有失败、1 环境/参数错误。
5. 单测 13 例覆盖分支集合、人设解析、off/full/quota/event/context 的逐字子集、顺序保持、未知人设抛错与 prompt 组成。

## 真实执行

- 命令：`pnpm exec tsx bin/visitor-realism-prompt-ablation.ts --reps 2 --out data/phase25-exit/af330-realism-ablation/report.json`
- 规模：2 人设 × 5 分支 × 6 轮 × 2 重复 = `120` 次调用，`0` 失败。
- 每人设每分支 12 轮，报告给出六类计数、四项指标、相对同人设 `off` 差值与 `humanization-v1` 状态。

### 结果摘要

| 人设 | 分支 | 事件/轮 | 轮次率 | 密度 | 修正/轮 | 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | off | 0.416667 | 0.416667 | 1.732229 | 0.000000 | n/a |
| anxious | full | 2.250000 | 1.000000 | 6.805556 | 0.833333 | failed ×2 |
| anxious | quota | 1.000000 | 0.750000 | 4.109397 | 0.000000 | failed ×2 |
| anxious | event | 2.000000 | 1.000000 | 8.374672 | 0.166667 | failed ×2 |
| anxious | context | 1.500000 | 0.916667 | 4.170918 | 0.916667 | failed ×2 |
| guarded | off | 0.333333 | 0.333333 | 1.587401 | 0.000000 | n/a |
| guarded | full | 1.333333 | 1.000000 | 7.657080 | 0.000000 | failed ×2 |
| guarded | quota | 0.583333 | 0.583333 | 3.006737 | 0.000000 | failed / passed |
| guarded | event | 1.166667 | 1.000000 | 7.880501 | 0.000000 | failed ×2 |
| guarded | context | 1.000000 | 1.000000 | 6.076105 | 0.000000 | failed ×2 |

## 关键设计判断

- **AF-329 的反向结论作废为 steady 证据。** AF-329 的 `REALISM_AB_CONTEXT` 写了 `riskLevel: 'low'`；`resolveRealismStateBand` 把任何非 `none` 的 riskLevel 判为 `risk`，导致 active 分支配额全 0、事件层缺失。AF-329 测到的是风险轮，不是 steady。本单没有改 AF-329 的归档报告，而是在本单报告中明确修正口径。
- **过量生产的直接原因是话轮形态层。** 焦虑人设 `steady` 下形态为「说出口后改一次口」，是每轮命令式；`context` 分支没有配额仍出现 `repair/轮 0.916667`。回避人设 `guarded` 下形态为「先挡一下、说这个……」，`context` 分支每轮都有一个 pause，密度 `6.076105`。
- **事件层是第二个放大器。** 四类候选虽然写「按需取用」，模型接近逐项使用；焦虑 `event` 密度 `8.374672`，回避 `event` 密度 `7.880501`。
- **配额层单独用最接近目标，但仍超密度上限。** 1-2 处事件在 6 轮短句里已把密度推到 `4.109397` / `3.006737`。
- **不启用 active、不放宽判据。** 当前块在 steady 下会制造刻意磕巴；放宽 `humanization-v1` 会把过量生产判成合格。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/shared/realism/realism-prompt-ablation.spec.ts test/shared/realism/realism-prompt-ab.spec.ts` | 21/21 passed（13 + 8） |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 291 files passed / 1 skipped；4477 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af330-ablation-console.log`、`af330-lint.log`、`af330-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 两个人设、5 分支、2 重复 | 完全执行，120 次调用 | 无偏差 |
| 焦虑人设复用 AF-329 上下文 | 显式补 `attachmentStyle='anxious'` 并把 `riskLevel` 改为 `none` | AF-329 的 `low` 被解析为 risk，无法代表 steady；不修就复现不了 steady 消融 |
| 报告只输出数字 | 报告引用生产 prompt 的指令文本用于归因，不输出模型生成台词 | 引用的是 prompt 规则，不是来访者台词 |

## 未覆盖 / 遗留

- 只做 2 人设 × 2 重复，不足统计显著性；不能外推全部来访者。
- 未改生产 prompt、未新增 env、未接 `RENDER_REALISM_MODE`；下一步需另立任务做单变量 prompt 收紧。
- `humanization-v1` 的密度门槛仍需在长会话上校准；本单不通过改门槛解决过量生产。
- 原始 JSON 含合成台词，保留在 gitignored 取证目录，不得提交。

## commit message

`feat(af330): 增加来访者真人度 prompt 分层消融 A/B`
