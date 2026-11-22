# AF-338 · 真人度事件类型归因与剖面工具交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 纯函数模块 | `src/shared/realism/realism-event-type-profile.ts` |
| 归因 CLI | `bin/visitor-realism-event-type-profile.ts` |
| 单测 9 例 | `test/shared/realism/realism-event-type-profile.spec.ts` |
| 实测报告 | `docs/worklog/completed/phase2.5/af338-realism-event-type-attribution-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af338-realism-event-type-attribution-2026-11-23.md` |
| 原始剖面（gitignored） | `data/phase25-exit/af338-realism-event-type-attribution/off-profile.json`、`full-minimal-profile.json` |

## 实现要点

1. `realism-event-type-profile.ts`：新增 `EVENT_TYPE_IDS`、`EventTypeSample`、`EventTypeProfile`、`aggregateEventTypeProfiles`、`dominantEventType`。
2. 规则：缺失 / 非有限 / 负数计数按 `0`；`turns<=0` 时 `perTurn` 与 `share` 为 `null` 但计数保留；占比分母是六类事件总数；按 `persona`、`arm` 字典序稳定排序；不修改输入。
3. `bin/visitor-realism-event-type-profile.ts`：`--dir`、`--out`、`--personas`、`--arms`、`--json`；只读 rep JSON，拒绝 `reps != 1` 的聚合文件，避免把均值当总数。
4. 零新增模型调用；只用 AF-336/337 已产出的 rep JSON 计算。

## 实测结果

| 人设 / 分支 | 总事件 | 每轮 | 主类型 | 关键占比 |
| --- | --- | --- | --- | --- |
| anxious / off | 64 | 0.6667 | filler 0.3229 | filler 48.4% + pause 43.8% |
| anxious / full | 194 | 2.0208 | pause 0.6979 | pause 34.5% + repair 34.0% + filler 28.4% |
| anxious / minimal | 56 | 0.5833 | filler 0.3229 | filler 55.4% + pause 42.9% |
| guarded / off | 55 | 0.5729 | pause 0.5208 | pause 90.9% |
| guarded / full | 116 | 1.2083 | pause 1.0000 | pause 82.8% + trailoff 17.2% |
| guarded / minimal | 27 | 0.2813 | pause 0.2708 | pause 96.3% |

结论：焦虑 full 的净增事件里 `repair` 占 50.8%、`pause` 30.0%、`filler` 18.5%；回避 full 的 `pause` 每轮 `1.0`、`trailoff` `0.2083`，`repair` 为 0。minimal 与 off 基本同词表，缺 `repair`，因此结构性不可分。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 296 files passed / 1 skipped；4530 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af338-lint.log`、`af338-typecheck.log`、`af338-test.log`（gitignored）。

## 与任务单的偏差

无功能偏差。`--dir` 读取同一目录下的全部 `*.json`，因此要求目录内只有 rep 文件；本单用 AF-336/337 的 `reps/` 子目录，不混入 `summary.json`。

## 未覆盖 / 遗留

- 剖面基于 8 份 rep / 每格 96 轮，仍是小样本；类型计数是模型输出后由事件分类器识别的，不是人工标注。
- 没有做逐句位置归因（第几轮、句首/句尾），只做类型级频次归因。
- 没有证明某类事件与“真人感”存在因果关系；只是工程频率归因。
- 生产继续 `off`，不调阈值、不启用候选。

## commit message

`feat(af338): 增加真人度事件类型剖面与归因工具`
