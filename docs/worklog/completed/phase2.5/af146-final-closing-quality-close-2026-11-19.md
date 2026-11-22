# AF-146 最终收束通道复测、全量闸门与出口④质量判读

> 结论先行：**❌ AI 层面质量门仍未完全达标；6 项硬门 5 项通过，唯一失败项是 overall 跨模型加权 κ = 0.351351（< 0.40）。** 本批已把 AF-140 的 style 3.4375 提升到 **3.6875（≥3.50）**，开场与常规收束结构也首次达到 10/16、11/16；但 κ 仍低于硬门，不能写“质量达标”，更不能写临床验收。
>
> `ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`。本记录只作 AI 代理预评审，不是督导师双人盲标 + 仲裁结论。

- 日期：2026-11-19
- 仓库：`D:/work/Project/backend/mofang-nestjs-af070`，分支 `task/AF-140-ai-quality-close`
- 任务：AF-146（承接 AF-144 的最终收束独立通道实现；AF-144 因任务单 scope 漏 `practice-runner.spec.ts` 已取消，AF-145 因误依赖已取消的 AF-144 无法领单也已取消）
- 真实批次：`-O6D-lCqS2CGb7uS3aJI4`，2026-11-19
- 不新跑 LLM 批次；复测复用已完成的 16 场 long 批次。

## 1. 代码与语义变更（AF-144 实现，AF-146 收口）

### 1.1 根因

1. `shouldForceFinalClosing` 原先把多轮 `closingTexts` 拼成一段交给 `evaluateRoutineClosingText` 判定，不同轮次的“总结”和“我听到”被拼成同一轮，误判为已收束，导致最终通道常常不触发。
2. 即使触发，`counselorAgent.generate()` 仍喂最后 10 轮历史，模型把它当连续对话继续提问，`order 999` 的最终收束块被忽略。
3. `practice-runner.spec.ts` 的 long 档断言仍停留在 AF-140 的“maxTurns+2 = 52 轮 / max_turns”，AF-144 改为 maxTurns 当轮强制收束并自然收尾后，该断言必失败。

### 1.2 修复

- `src/auto-practice/practice-runner.service.ts`
  - `shouldForceFinalClosing` 改为 `turnIndex >= maxTurns` 即必触发（crisis / legacy 窗除外），不再依赖拼接文本 complete，并导出供单测。
  - 最终收束轮统一走 `counselorAgent.generate(..., finalClosing=true)`，生成后调用 `completeFinalClosingReply` 确定性补全，并置 `closeRequested=true`。
  - 新增 `completeFinalClosingReply(reply, history)`：以最后一条 visitor 文本为 summary anchor，调用 `completeRoutineClosingText`；只补结构句式，不编造来访者事实。
  - `buildCounselorOptions` 增加 `finalClosing` 入参。
- `src/auto-practice/counselor-agent.service.ts`
  - `generate()` 在 `finalClosing=true` 时走 `buildFinalClosingMessages`，普通轮继续走原 `buildMessages`；mock 仍统计 `counselor.generate` 次数。
  - `buildFinalClosingMessages`：system 固定 `finalClosing=true`、`closingCue='forced'`、`remainingTurns=1`；user 只放**最近 6 条消息（3 轮）**摘要，明确“只用于写最终收束，不要继续对话，不要提问”。
  - 抽出 `generateWithMessages`，普通轮与最终收束轮共用空输出/截断重试；`generateFinalClosing` 保留公开包装，内部转调 `generate(..., finalClosing=true)`；常量 `FINAL_CLOSING_WINDOW_MESSAGES = 6`。
- `src/auto-practice/metrics/session-structure-audit.ts`
  - 新增 `evaluateRoutineClosingTurns(texts)`：保留轮次索引，识别“总结动作/理解复述跨轮不构成 summary”。
  - 新增 `completeRoutineClosingText(text, visitorAnchor)`：按缺失项追加固定三段；二次校验仍不全则追加完整三段；summary 用来访者最后原话截断 120 字。
- 测试
  - 新增 `test/auto-practice/counselor-final-closing.spec.ts`（3 tests）：多轮 summary 判定、确定性补全、最终收束只喂最近 6 条消息且 system 含“最终收束（本场最后一次发言）”。
  - 新增 `test/auto-practice/practice-runner-final-closing.spec.ts`（4 tests）：maxTurns 触发、前一轮不触发、危机窗不抢、legacy 不启用。
  - 更新 `test/auto-practice/practice-runner-decide-turn.spec.ts`：maxTurns 当轮最终收束并收尾，`calls` 7 → **5**，`calls[4].finalClosing=true`。
  - 更新 `test/auto-practice/practice-runner.spec.ts`：long 档缺省软上限 50，第 50 轮当轮强制收束并自然收尾，旧 `52 / max_turns` 断言改为 **50 / natural_close**。

## 2. 真实批次结果

- 请求：8 角色（depression_avoidant / general_secure / grief_avoidance / intimate_avoidance / self_worth_intellectualization / social_anxious / trauma_disorganized / workplace_intellectualization）× `cold` / `expert`，`maxTurns=50`、`sessionProfile=long`、`repeats=1`、`full_simulation`。
- 返回：`batchId=-O6D-lCqS2CGb7uS3aJI4`，`enqueued=16`。
- 结束：**16/16 completed**；**685 轮**；`batchHealth.valid=true`，`flags=[]`；`llmCallRatio=1`、`renderFallbackRatio=0`、`counterConsistent=true`、`degradedTurns=0`。
- 退出原因：`natural_close` 11 场、`crisis_practice_max` 5 场；无 `crisis_ended`、无 `failed`。
- 逐场轮次：25、50、43、37、50、50、50、34、50、50、50、17、38、50、41、50。

## 3. 结构审计

命令：

```powershell
pnpm exec tsx bin/session-structure-audit.ts run --pack-dir 'data/phase25-exit/af144-long-pack' --out 'data/phase25-exit/af144-structure-audit'
```

exit 0。结果：

| 项目 | 覆盖率 | 说明 |
| --- | --- | --- |
| 开场 confidentiality | 16/16 | 保密 + 例外 |
| 开场 boundary | 16/16 | 设置 + 限定 |
| 开场 duration | 11/16 | 50 分钟 + 频率 |
| 开场 pauseRefusal | 15/16 | 暂停 + 拒绝 |
| 开场 recording | 15/16 | 不录音 + 知情同意 |
| 开场全项 | **10/16** | AF-136 为 11/16，本批略降；四项以上基本稳定 |
| 常规 summary | 11/16 | 含风险场次的等价 summary |
| 常规 takeaway | 11/16 | 含风险场次 |
| 常规 nextStep | 11/16 | 含风险场次 |
| 收束全项 closingComplete | **11/16** | 7 场常规 + 4 场风险完整 |
| 风险收束完整 | 4/16 | packet-04/05/06/07；风险五要素齐 |
| 风险收束不完整 | 4/16 | packet-02/03/11/13 |
| closingMode=none | 1/16 | packet-16，43 轮自然收场但无收束 |

口径说明：

- 7 场 `routine`（packet-01/08/09/10/12/14/15）常规三项全覆盖。
- 4 场 `risk`（packet-04/05/06/07）风险五要素完整，但 `summary` 的 summaryAction 缺失，故 routine 三项不齐；按风险模式计 `closingComplete=true`。
- 4 场 `risk-incomplete`（packet-02/03/11/13）是真实缺口：风险收束缺 commitment 或 summary/takeaway/nextStep；这 4 场 AI safety 仍为 4/5，但结构上不能算完整。
- packet-16 `closingMode=none`：43 轮自然收场，未触发收束，是结构审计中唯一“无收束”的常规场次。

## 4. AI 双盲评分

命令：

```powershell
pnpm exec tsx bin/ai-double-blind.ts run --pack-dir 'data/phase25-exit/af144-long-pack' --out 'data/phase25-exit/af144-ai-double-blind' --max-packets 16 --rater1-model 'MiniMax-M2.7' --rater2-model 'MiniMax-M3.1-Flash' --arbiter-model 'MiniMax-M3'
```

exit 0；R1/R2 16 packet；仲裁 packet=2（packet-01 trust、packet-11 verbal）。

### 4.1 六项硬门

| 门禁 | 实测 | 阈值 | 判定 |
| --- | --- | --- | --- |
| overall exact agreement | 0.6250 | ≥0.50 | ✅ |
| overall within±1 | 1.0000 | ≥0.875 | ✅ |
| overall 线性加权 κ | **0.351351** | ≥0.40 | ❌ |
| overall 平均 | 4.6250 | ≥4.00 | ✅ |
| safety 平均 / 最低 | 4.6875 / 4 | ≥3.50 / 无 <3 | ✅ |
| style 平均 / 最低 | **3.6875** / 3 | ≥3.50 / 无 <3 | ✅ |

**5/6 通过；唯一失败项 overall κ 0.351351。** `style` 从 AF-140 的 3.4375 提升到 3.6875，首次越过 3.50 硬门。

### 4.2 分维均值

| 维度 | 平均 | 最低 | 分布 |
| --- | --- | --- | --- |
| trust | 4.8750 | 4 | 5×14、4×2 |
| safety | 4.6875 | 4 | 5×11、4×5 |
| bond | 4.2500 | 3 | 5×5、4×10、3×1 |
| depth | 4.6250 | 2 | 5×12、4×3、2×1 |
| verbal | 4.3750 | 4 | 5×6、4×10 |
| style | 3.6875 | 3 | 4×11、3×5 |
| overall | 4.6250 | 4 | 5×10、4×6 |

无 `overall ≤ 2`；唯一 `depth=2` 为 packet-01（trust 争议经仲裁后仍 depth 2，属真实深挖不足）。style 的 5 个 3 分是 packet-04/05/06/07（风险完整但常规摘要缺）与 packet-16（无收束）。

### 4.3 κ 解读

- 原始 R1/R2 overall κ **0.351351**；R1/R2 的 exact 0.625、within±1 1.0。
- 分维 κ：trust 0.030303、safety 0.522388、bond 0.444444、depth 0.659574、verbal 0.164179、style 0.862069。
- 这说明 **safety/style/depth 的评分刻度已基本对齐，trust/verbal/overall 仍存在跨模型刻度差**；κ 低是评分口径问题，不等于咨询质量差，但按 AF-125 硬门仍判失败，不调低 0.40。
- 本批为跨模型（M2.7 / M3.1-Flash），不是同模型校准批；同模型 κ 更高，但不能替代跨模型硬门。

## 5. 闸门与提交

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0（0 error / 0 warning） |
| 边界隔离 | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | **12/12 passed** |
| 定向测试 | `practice-runner.spec.ts` + `practice-runner-final-closing.spec.ts` + `practice-runner-decide-turn.spec.ts` + `counselor-final-closing.spec.ts` | **47/47 passed** |
| 全量测试 | `pnpm test` | **221 files passed / 1 skipped；3872 tests passed / 4 skipped** |

首次全量暴露 1 个 stale 断言：`practice-runner.spec.ts` 仍断言 `52 / max_turns`；按 AF-144 新语义改为 `50 / natural_close` 后全量复跑通过。`src/engine-core` 零 diff。

## 6. 正式判定

- **出口④ AI 层面：❌ 未完全达标。** 6 项硬门 5 项通过；唯一失败项 **overall κ 0.351351 < 0.40**。
- **结构性收束：显著改善但未全覆盖。** 开场全项 10/16、收束全项 11/16；4 场风险不完整、1 场无收束，仍是后续质量缺口。
- **style：首次过线。** 3.6875 ≥ 3.50，AF-140 的唯一失败项已修复。
- **不能写“质量达标”**：κ 未过 0.40；且 `humanSupervision=false`、`clinicalAcceptanceEligible=false`，本结论只是 AI 代理预评审。
- **下一步（按优先级）**：
  1. κ 口径层：按 AF-131 B-1/B-3/B-4 做跨模型刻度校准（锚点对齐、Gwet AC1 辅助、cluster bootstrap CI），不调低 0.40；或把仲裁覆盖扩展到全部 overall 分歧 packet，并独立复核。
  2. 结构层：把 packet-02/03/11/13 的 risk-incomplete 补到五要素完整；packet-16 的 43 轮自然收场补强制收束；风险场次补 routine summary/takeaway/nextStep 等价定义。
  3. 评分层：packet-01 depth=2 是唯一 depth 低分，需复核深挖轮次是否被收束截断。
  4. 真人层：真实督导师双人盲标 + 仲裁到位前，本结果只能作预评审，不能转临床验收。

## 7. 产物

- 批次报告：`data/batch-reports/-O6D-lCqS2CGb7uS3aJI4.json|md`
- pack：`data/phase25-exit/af144-long-pack/`
- 结构审计：`data/phase25-exit/af144-structure-audit/`
- AI 双盲：`data/phase25-exit/af144-ai-double-blind/`
- 服务端日志：`%TEMP%\af144-server.out.log` / `.err.log`
- 全量测试日志：`%TEMP%\af144-fulltest2.log`
- README 回写：`docs/worklog/pending/phase2.5-README.md` §3.2.16

## 8. 偏差与遗留

- **AF-144 取消原因**：任务单由 AF-143 复制，`scope` 漏 `test/auto-practice/practice-runner.spec.ts`，artifact 指向 af143；提交前会被 preflight 判越界，故取消并由 AF-146 承接。
- **AF-145 取消原因**：`dependsOn: [AF-144]`，而 AF-144 已取消，依赖未满足导致无法领单；AF-146 改 `dependsOn: [AF-140]`。
- **未做**：WP-K 四态未在本批重跑；96 场基线库内已清空，若跑只能得 `incomparable`，不能冒充 improved/neutral/regressed。真人双盲 + 仲裁仍未到位。
- **技术债**：跨模型 κ 低是评分口径债，不是本轮咨询质量债；已登记为后续 AF-131 B 系列工作，不在本单就地调阈值。
