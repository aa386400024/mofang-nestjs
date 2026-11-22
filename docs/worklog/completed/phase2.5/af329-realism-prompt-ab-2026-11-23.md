# AF-329 · 来访者文字真人度 active/off prompt A/B smoke 交付记录（2026-11-23）

## 交付内容

| 产物 | 路径 |
| --- | --- |
| 纯辅助模块 | `src/shared/realism/realism-prompt-ab.ts` |
| 真实 A/B CLI | `bin/visitor-realism-prompt-ab.ts` |
| 单测 | `test/shared/realism/realism-prompt-ab.spec.ts` |
| A/B 实测报告 | `docs/worklog/completed/phase2.5/af329-realism-prompt-ab-report-2026-11-23.md` |
| 本交付记录 | `docs/worklog/completed/phase2.5/af329-realism-prompt-ab-2026-11-23.md` |
| 原始 JSON（gitignored，不入库） | `data/phase25-exit/af329-realism-ab/report.json`、`report-run2.json`、`report-run3.json` |

## 实现要点

1. `realism-prompt-ab.ts` 固定合成来访者林晓（28 岁，失眠 + 会议前心慌，1-2 句口语）、6 条合成咨询师轮次、`steady` 档上下文；`buildRealismAbSystemPrompt('off'|'active')` 保证 off 等于 `REALISM_AB_BASE_SYSTEM`，active 等于基础人设 + 生产 `buildVisitorRealismPromptBlock`。
2. `bin/visitor-realism-prompt-ab.ts` 复用生产 `LlmService.streamChat`，provider `doubao`，默认模型 `doubao-seed-character-260628`，温度 `0.6`、`maxTokens=160`、`timeout=45s`；逐轮追加咨询师消息，收来访者回复并剥离情绪标签。
3. 分支结果统一走 `analyzeDisfluency` / `aggregateDisfluency` / `buildHumanizationMetrics`；audit 视图只测量，active 视图另算 `humanization-v1` 假设性判定；`buildDelta` 输出四项 active-off 差值。
4. CLI 只打印模型、温度、轮次、调用数、失败数、六类计数、四项指标与差值；不打印完整台词。`--json` / `--out` 可落原始结构。
5. 失败处理：单轮失败即停该分支并累加 `failedTurns`；CLI 退出码 `0` 正常、`2` 有失败、`1` 环境或参数错误。
6. 单测 8 例覆盖 prompt 分支、6 轮常量、情绪标签剥离、消息长度序列、失败即停、分支汇总与差值对称。原断言「测试文本应 pass」改为「active 假设性判定 applicable」，避免把测试台词的高事件率误写成判据通过。

## 真实执行

- 命令：`pnpm exec tsx bin/visitor-realism-prompt-ab.ts --out data/phase25-exit/af329-realism-ab/report.json`，另跑 `report-run2.json`、`report-run3.json` 作为独立重复。
- 每次 12 次调用（off/active 各 6 轮），3 次共 `36` 次，`0` 失败；单次首 token 约 0.32–0.64s，单次总耗时约 0.56–0.93s。
- prompt 差异：active 比 off 多 `526` 字；active 含真人度块，off 不含。

### 结果汇总

| 指标（3 次均值） | off | active | active-off |
| --- | --- | --- | --- |
| 事件/轮 | 0.611111 | 0.444444 | -0.166667 |
| 带事件轮次率 | 0.444444 | 0.333333 | -0.111111 |
| 百字密度 | 2.528643 | 2.532253 | +0.003610 |
| 修正/轮 | 0.000000 | 0.000000 | 0.000000 |
| `humanization-v1` 判据 | 2/3 pass | 0/3 pass | — |

三次 active-off 事件/轮差值：`-0.500000`、`+0.166667`、`-0.166667`；方向不一致。第一次 active 六类事件全部归零。

## 关键设计判断

- **不把反向结果包装成改进。** active 既没有稳定提高事件率，也没有稳定落入判据窗口；报告如实记录为「当前 prompt 块不能证明有效」。
- **不在本单回头调 prompt。** 用 6 轮单一人设的同一批数据调 prompt 会过拟合；后续若要继续，必须拆单变量变体并扩大配对样本。
- **生产默认保持 off。** 本单不切换 `RENDER_REALISM_MODE`，不触碰渲染链路。
- **原始 JSON 不入库。** JSON 含合成台词原文，按边界只保留在 gitignored 取证目录；仓库内报告只保留数字。

## 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/shared/realism/realism-prompt-ab.spec.ts` | 8/8 passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 290 files passed / 1 skipped；4464 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

日志：`docs/team/agent-orchestration/transport/af329-targeted.log`、`af329-typecheck.log`、`af329-lint.log`、`af329-test.log`（均 gitignored）。

## 未覆盖 / 遗留

- 未验证 10+ 轮长对话、多人设、多场景；当前只回答 6 轮单一人设。
- 未做 prompt 单变量归因；不知道是配额行、语域行还是事件层在抑制 filler/pause。
- 未把 `humanization-v1` 门槛校准到稳定样本；AF-328 的 B3 仍开放。
- 未修 `typings/global.d.ts` 缺 AF-322 三个 env 键、管理台 `totalCost` 技术债（均不属本单）。
- `data/phase25-exit/af229-lite-dev-12/`、`af280-engine-render-v5/`、`af295-v2-screen6/`、`af295-v2-smoke2/`、`af328-humanization/`、`af329-realism-ab/` 仍为 untracked 取证目录，不得提交。

## commit message

`feat(af329): 增加来访者真人度 active/off prompt A/B smoke`
