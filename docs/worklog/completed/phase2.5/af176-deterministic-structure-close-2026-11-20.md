# AF-176 · Phase2.5 出口④ 开场与危机收束确定性结构收口

> 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-176/task-sheet.md`
> 分支：`task/AF-176-deterministic-structure`
> 基线：`297ff0a91da94a3aaf39239e1cc9a56fe1e85d7c`（integrate HEAD）
> 状态：completed（AI 代理口径；`humanSupervision=false`）

## 1. 结论

出口④的结构短板从“靠模型自愿写”改为“runner 确定性兜底”，并把结构审计的两个误判根因一起修掉：

- 开场五要素（保密/边界/时长/暂停拒答/录音知情）：AF-146 全项 10/16 → 本单复验 **16/16**。
- 常规收束三件套：early close 不再绕过内容门；提前 END 但缺 summary/takeaway/nextStep 时挡回，跑满上限后由最终收束补齐。
- 危机收束五组：不再要求“强度升级”才补；任何 crisisClosing 轮都确定性补齐风险五组。
- 审计误判：确定性开场里的“保密…只有出现自伤…”不再被当成整场危机；风险五组齐全本身可作为 risk 模式的强证据，不再被记成 none。

本单不产生 PASS/FAIL 结论，也不写“临床质量达标”。所有 AI 评分仍是 `ai_proxy_candidate`，需真人督导双盲 + 仲裁才能升级为临床门。

## 2. 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/auto-practice/practice-runner.service.ts` | 新增 `applyDeterministicStructure`；首轮补开场五要素；最终收束轮沿用 AF-144；crisisClosing 轮补风险五组；常规内容门扩展到所有非 legacy 的 natural close；`recordClosingTexts` 纳入主动 END 的正文 |
| `src/auto-practice/metrics/session-structure-audit.ts` | 新增 `evaluateOpeningText` / `completeOpeningText` / `completeRiskClosingText`；审计守卫识别确定性开场句式；风险五组齐全优先判 risk |
| `test/auto-practice/session-structure-audit.spec.ts` | 新增开场补齐、风险补齐、开场保密例外不误判、风险五组优先判 risk 等用例 |
| `test/auto-practice/practice-runner-decide-turn.spec.ts` | 新增首轮开场、legacy 逐字不变、危机计划轮补风险、非升级危机补风险、early close 内容门等用例 |
| `test/auto-practice/practice-runner.spec.ts` | long 档最小轮次用例补“三件套齐才 natural_close”断言 |

`src/engine-core/**` 零 diff。

## 3. 关键设计决策

1. **结构兜底放 runner，不改 prompt 依赖**。模型仍可自由表达；缺结构时由纯函数追加固定句式，不伪造来访者事实。
2. **legacy 逐字不变**。开场补齐、常规内容门全程化都通过 `profile.name !== 'legacy'` 显式开关；legacy 的 5 轮最小收尾行为保留。
3. **危机关闭优先于常规收束**。危机窗激活时不走常规三件套门，避免把安全收束误判成缺 summary。
4. **审计口径修正而不是放宽门槛**。开场保密例外是边界说明，不应触发整场危机；风险五组齐全本身就是 crisis closing 的强证据。
5. **“80% 准确率”不在本单伪造**。无真人督导 ground truth 时，出口④只能拆成 AI 代理门与临床门；本单只负责结构可达性与审计真实性。

## 4. 实跑证据

### 4.1 复验批次

- batchId：`2spQXsuCsdi9kiHODEM99`
- 组成：8 角色 × `cold` / `expert` × 1 repeat，`long`，`maxTurns=50`，`full_simulation`
- 结果：**16/16 completed**，650 轮，`batchHealth.valid=true`，`llmCallRatio=1`，`failed=0`
- 报告：`data/batch-reports/2spQXsuCsdi9kiHODEM99.json|md`

### 4.2 结构审计

- pack：`data/phase25-exit/af176-long-pack-v2`（16 packet）
- 审计：`data/phase25-exit/af176-structure-audit-v2/session-structure-audit.json|md`
- 开场：confidentiality / boundary / duration / pauseRefusal / recording 均 **16/16**
- 收束：summary 10/16、takeaway 12/16、nextStep 12/16；按模式完整 **13/16**
- 收束模式：risk=7 / routine=6 / risk-incomplete=3 / none=0
- 与 AF-146 对比：开场全项 10/16 → 16/16；none 从 1 场降到 0 场

### 4.3 质量闸门

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error / 0 warning |
| `pnpm build` | exit 0 |
| `pnpm test` | 222 passed / 1 skipped files；3925 passed / 4 skipped tests；23.44s |
| `git diff --stat HEAD -- src/engine-core` | 空 |

定向测试：`practice-runner-decide-turn.spec.ts` 26 例、`session-structure-audit.spec.ts` 33 例、`practice-runner.spec.ts` 与 `session-profile.spec.ts` 全绿。

## 5. 偏差与说明

| 项 | 任务单口径 | 实际 | 理由 |
| --- | --- | --- | --- |
| 复验批次 | 期望 16 场 long | 实际 16/16，2 场早期自然收束低于 50 轮 | 模型主动 END 被内容门管理；未拆分为多次批次 |
| `batch intake` | 未要求 | batch-report 的 BDI intake 判定为 FAIL | 该门是来访者轨迹 intake 指标，不是出口④ AI 质量六门；不伪造通过 |
| 结构全项 | 原目标“收束全项”未写死 16/16 | 13/16 | 3 场真实危机在风险收束完整后结束，常规 summary 不适用；不把风险场硬套 routine 口径 |
| 临床结论 | 用户明确不做真人督导 | 仅 AI 代理 | `humanSupervision=false` / `clinicalAcceptanceEligible=false` |

## 6. 遗留

- 出口④ overall κ 仍 <0.40：AF-147 96 场 0.365854，本单未改变评分模型。需独立任务扩大角色-模式簇并复核。
- 出口⑤ 1000+ 场数据：当前仅 285 场 / 176 completed，需独立数据任务。
- `stream_options.include_usage` 未开，出口③ token 仍是保守上界而非实测。

## 7. 提交

`feat(af176): 开场与危机收束确定性结构收口`
