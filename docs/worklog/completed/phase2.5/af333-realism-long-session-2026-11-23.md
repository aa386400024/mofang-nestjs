# AF-333 · 真人度 12 轮长会话基线校准交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 长短轮次纯模块 | `src/shared/realism/realism-long-session.ts` |
| 长会话 CLI 开关 | `bin/visitor-realism-prompt-tightening.ts`（新增 `--turn-set short\|long`） |
| 单测 | `test/shared/realism/realism-long-session.spec.ts` |
| 实测报告 | `docs/worklog/completed/phase2.5/af333-realism-long-session-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af333-realism-long-session-2026-11-23.md` |
| 原始 JSON（gitignored） | `data/phase25-exit/af333-realism-long-session/reps/rep-1..4.json`、`summary.json`、`smoke.json` |

## 实现要点

1. `realism-long-session.ts` 定义 `COUNSELOR_TURN_SETS = ['short','long']`、`LONG_COUNSELOR_TURNS`（12 轮）与 `getCounselorTurns` / `parseCounselorTurnSet`。前 6 轮直接展开 `REALISM_AB_COUNSELOR_TURNS`，保证长会话与短会话前 6 轮逐字一致，可直接对比。
2. `bin/visitor-realism-prompt-tightening.ts` 新增 `--turn-set short|long`，默认 `short`；`long` 默认 12 轮、`short` 默认 6 轮；`--turns` 可在集合长度内截断。`runArm` 改为接收 `counselorTurns` 数组，`runCell` 按 `options.turnSet` 取集合。
3. `Report` / `Options` 增加 `turnSet`，报告落盘与人类可读输出都带 `long 12 轮/分支`，避免长短报告混淆。
4. 复用 AF-331 分支块与 `humanization-v1`，不新增 prompt、不改生产文件、不调阈值。
5. 单测 8 例覆盖长短集合、前 6 轮逐字一致、12 轮唯一、后 6 轮为新增、非空与问号、默认 `short`、显式 `long`、未知值抛错。CLI 额外用 12 次真实调用做 `long` smoke，确认 `turnSet=long` 落盘。

## 真实执行

- `4` 次独立重复，每份：`2 人设 × 3 分支 × 12 轮 = 72` 次调用。
- 合计 `288` 次豆包 Seed Character 调用，`0` 失败；每份 `turns=12`、`turnSet=long`。
- 执行命令：`pnpm exec tsx bin/visitor-realism-prompt-tightening.ts --turn-set long --arms "off,full,minimal" --reps 1 --turns 12 --out data/phase25-exit/af333-realism-long-session/reps/rep-N.json`
- 分析命令：`pnpm exec tsx bin/visitor-realism-baseline-variance.ts --dir data/phase25-exit/af333-realism-long-session/reps --out data/phase25-exit/af333-realism-long-session/summary.json`

### 结果摘要（密度/百字）

| 人设 | 分支 | 均值 | 中位数 | 最小 | 最大 | 窗口内 |
| --- | --- | --- | --- | --- | --- | --- |
| anxious | off | 2.471492 | 2.607085 | 1.718213 | 2.953586 | 1/4 |
| anxious | full | 6.624600 | 6.498835 | 5.940594 | 7.560137 | 0/4 |
| anxious | minimal | 2.834969 | 2.791573 | 1.459854 | 4.296875 | 1/4 |
| guarded | off | 2.395518 | 2.344401 | 0.952381 | 3.940887 | 2/4 |
| guarded | full | 6.744182 | 6.886633 | 6.060606 | 7.142857 | 0/4 |
| guarded | minimal | 2.963276 | 3.008199 | 2.631579 | 3.205128 | 0/4 |

其它指标：

- anxious：off 事件/轮 `0.541667`、轮次率 `0.500000`、修正/轮 `0`；full `1.729167 / 0.895834 / 0.541667`；minimal `0.583333 / 0.500000 / 0`。
- guarded：off `0.458333 / 0.416666 / 0`；full `1.125000 / 1.000000 / 0`；minimal `0.354167 / 0.333333 / 0`。

## 关键设计判断

- **12 轮没有修好 `off` 基线。** 焦虑 off 中位数 `2.607085`，仍高于 `2.50`，`1/4` 在窗口内；回避 off 中位数 `2.344401`，`2/4` 在窗口内。延长分母只把焦虑中位数从 6 轮的 `3.172327` 拉低约 0.57，没有进入稳定窗口。
- **`full` 在 12 轮下仍稳定过量。** 焦虑 `6.624600`、回避 `6.744182`，全部 `0/4`；相对上限 `2.50` 仍是 2.6 倍以上。事件/轮与轮次率没有随轮次翻倍而下降，说明过量来自持续生成倾向。
- **`minimal` 仍不是修复。** 焦虑 minimal 中位数 `2.791573` 高于 off；回避 minimal `3.008199` 高于 off `2.344401` 且 `0/4` 在窗口内。
- **12 轮可作观测窗口、不可单独作 gate。** 长会话让 `full` 的极差收窄，但 `off` 仍未稳定；gate 仍需“多重复 + 中位数 + 按人设基线”。
- **不调 `humanization-v1` 阈值、不切 `RENDER_REALISM_MODE`。** 当前 `2.50` 是工程种子；问题在基线方差与生成倾向，不在阈值。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/shared/realism/realism-long-session.spec.ts test/shared/realism/realism-metric-distribution.spec.ts` | 20/20 passed（8 + 12） |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 294 files passed / 1 skipped；4510 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af333-lint.log`、`af333-typecheck.log`、`af333-test.log`（gitignored）。

## 与任务单的偏差

| 任务单 | 实际 | 理由 |
| --- | --- | --- |
| `--turn-set short\|long`，long 默认 12 轮 | 已实现；smoke 与 4 份报告均落 `turnSet=long` | 无偏差 |
| 4 重复 × 2 人设 × 3 分支 × 12 轮 = 288 | 完全执行，288 调用、0 失败 | 无偏差 |
| 报告与 AF-332 6 轮并列 | 已增加 6 轮 vs 12 轮中位数对比表 | 无偏差 |
| 单测至少 8 例 | 8 例 | 无偏差 |
| 不改生产 prompt / 阈值 | 生产文件、`humanization-v1` 均未改 | `git diff --stat HEAD -- src/engine-core` 为空 |

## 未覆盖 / 遗留

- 4 次重复仍不足统计显著性；只覆盖 2 个合成人设。
- 12 轮结果不足以决定“把评测窗口统一改 12 轮”，也不足以给出 persona-specific baseline；需要更多重复与事件层消融复验。
- `full` 不得启用；`minimal` 仅保留为“去 full 过量”的中间态。
- 原始 JSON 含合成台词与 prompt，保留在 gitignored 取证目录，不得提交。

## commit message

`feat(af333): 增加真人度 12 轮长会话校准`
