# AF-331 · 来访者真人度 prompt 减层与候选收紧交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 减层与收紧模块 | `src/shared/realism/realism-prompt-tightening.ts` |
| 真实对比 CLI | `bin/visitor-realism-prompt-tightening.ts` |
| 单测 | `test/shared/realism/realism-prompt-tightening.spec.ts` |
| 实测报告 | `docs/worklog/completed/phase2.5/af331-realism-prompt-tightening-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af331-realism-prompt-tightening-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af331-realism-tightening/report.json`、`smoke.json` |

## 实现要点

1. `realism-prompt-tightening.ts` 固定 7 分支：`off` / `full` / `no-shape` / `no-event` / `no-quota` / `minimal` / `tightened`。
2. `no-shape` / `no-event` / `no-quota` / `minimal` 从生产块逐字删除指定行；`tightened` 只替换形态、配额、事件三行，其余行逐字保留。
3. `tightened` 语义：形态从每轮执行改为“整场最多两次、本轮最多一次”；配额改为“单轮通常 0、最多 1 处”；事件层去掉四类候选与节奏条件，改为“自然出现最多一处”。
4. CLI 复用生产 `LlmService.streamChat` 与 AF-330 的二人设；默认 `doubao-seed-character-260628`、温度 0.6、maxTokens 160、超时 45s、6 轮/分支、2 重复。
5. 报告只输出数字，不输出模型台词；原始 JSON 含合成台词，留 gitignored 取证目录。

## 真实执行

- 命令：`pnpm exec tsx bin/visitor-realism-prompt-tightening.ts --reps 2 --out data/phase25-exit/af331-realism-tightening/report.json`
- 规模：2 人设 × 7 分支 × 6 轮 × 2 重复 = `168` 次调用，`0` 失败。

### 结果摘要

| 人设 | 分支 | 事件/轮 | 轮次率 | 密度 | 修正/轮 | 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | off | 0.750000 | 0.500000 | 3.250856 | 0.000000 | n/a |
| anxious | full | 2.166666 | 1.000000 | 7.625786 | 0.750000 | failed ×2 |
| anxious | no-shape | 1.666667 | 0.916667 | 7.915154 | 0.166667 | failed ×2 |
| anxious | no-event | 1.500000 | 0.833333 | 4.762038 | 0.500000 | failed ×2 |
| anxious | no-quota | 1.666667 | 0.916667 | 7.432283 | 0.333333 | failed ×2 |
| anxious | minimal | 0.750000 | 0.583333 | 3.211870 | 0.000000 | passed / failed |
| anxious | tightened | 0.666667 | 0.500000 | 2.952407 | 0.166667 | failed ×2 |
| guarded | off | 0.666667 | 0.666667 | 3.216676 | 0.000000 | n/a |
| guarded | full | 1.416667 | 1.000000 | 8.050009 | 0.000000 | failed ×2 |
| guarded | no-shape | 0.666667 | 0.583333 | 6.810966 | 0.000000 | failed ×2 |
| guarded | no-event | 1.000000 | 1.000000 | 6.000600 | 0.000000 | failed ×2 |
| guarded | no-quota | 1.166667 | 1.000000 | 6.686207 | 0.000000 | failed ×2 |
| guarded | minimal | 0.333333 | 0.333333 | 2.684685 | 0.000000 | failed ×2 |
| guarded | tightened | 0.500000 | 0.416666 | 4.104616 | 0.000000 | failed ×2 |

## 关键设计判断

- **事件层是最大放大器。** 只删事件层，焦虑密度降 `2.863748`、回避降 `2.049409`；形态与配额仍在，但密度仍高于 `2.50`。
- **形态层作用不对称。** 删形态层让回避降 `1.239043`，但焦虑升 `0.289368`；不能把形态层当作两人设的共同根因。
- **配额层不是主要贡献。** 删配额只让焦虑降 `0.193503`、回避降 `1.363802`；模型更多跟随候选清单和形态，而不是数值上限。
- **minimal 最接近 off，但仍不合格。** 焦虑 `3.211870`（一次 pass 一次 fail）、回避 `2.684685`（failed ×2）；它证明“删掉形态与事件层能回到基线附近”，不证明已有可部署候选。
- **tightened 不达标。** 焦虑 `2.952407`、回避 `4.104616`，均 failed ×2；“整场最多两次”的自然语言约束没有被稳定执行。
- **off 基线本身会抖动。** 本单 off 密度 `3.250856` / `3.216676`，AF-330 同人设是 `1.732229` / `1.587401`；6 轮短会话的密度方差很大，`humanization-v1` 不能直接当稳定门槛。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/shared/realism/realism-prompt-tightening.spec.ts test/shared/realism/realism-prompt-ablation.spec.ts` | 26/26 passed（13 + 13） |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 292 files passed / 1 skipped；4490 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af331-tightening-console.log`、`af331-lint.log`、`af331-typecheck.log`、`af331-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| 7 分支、2 人设、2 重复 | 完全执行，168 次调用 | 无偏差 |
| tightened 只替换指定三行 | 已实现并由单测锁定 | 无偏差 |
| 报告如实写方向与方差 | 报告单列 off 基线抖动与 tightened 失败 | 不因候选未达标而调 prompt 或放宽判据 |
| 不修改生产 prompt | 生产文件零改动 | `git diff --stat HEAD -- src/engine-core` 为空，`visitor-realism-profile.ts` 未改 |

## 未覆盖 / 遗留

- 只做 2 人设 × 2 重复 × 6 轮，不足统计显著性；off 自身已超密度上限，说明样本量/轮次不足。
- 未把 `minimal` 放进生产；未新增 env、未接 `RENDER_REALISM_MODE`。
- `humanization-v1` 密度门槛需要按 ≥12 轮或配对中位数校准；否则会把 off 本身判 failed。
- `tightened` 的“整场最多两次”需要可验证的计数机制，单靠 prompt 自然语言不可靠。
- 原始 JSON 含合成台词，保留在 gitignored 取证目录，不得提交。

## commit message

`feat(af331): 增加来访者真人度 prompt 减层与收紧对比`
