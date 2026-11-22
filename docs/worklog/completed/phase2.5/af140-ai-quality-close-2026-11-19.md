# AF-140 · AI 层面质量收口交付记录（2026-11-19）

> 任务单：`docs/worklog/pending/af140-ai-quality-close-task-2026-11-19.md`
> 分支：`task/AF-140-ai-quality-close`；基线 `ae624f9`
> 结论口径：**AI 层面质量门 6 项中 5 项通过，唯一失败项 style 平均 3.4375（<3.50）→ 仍未达标。**
> `ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`，不得写成临床质量达标。

## 1. 本轮做了什么

| # | 改动 | 目的 |
| --- | --- | --- |
| 1 | `session-structure-audit.ts` 新增常规/风险收束内容门 | summary / takeaway / nextStep 三件套；风险五组安全要素，二者都从“关键字命中”升级为“可判定完整性” |
| 2 | `practice-runner.service.ts` 收束窗内三件套不齐挡回继续 | 防止模型在收束窗里又开新议题 |
| 3 | `practice-runner.service.ts` 危机升级后 T+1 评估轮 + T+2 计划轮；缺项追加第 3 轮修复 | 修 AF-136 P0“升级即止”；五组安全要素不齐以 `crisis_safety_incomplete` 结束 |
| 4 | `practice-runner.service.ts` standard/long 允许 `maxTurns + 2` | 给收束两次落地机会；legacy 不变 |
| 5 | `practice-runner.service.ts` 收束齐全即早停 `natural_close` | 把收束真正落在末轮，避免被后续议题稀释 |
| 6 | `practice-runner.service.ts` `shouldForceFinalClosing` 从 `maxTurns + 1` 起触发 | +1 先试、+2 再补 |
| 7 | `counselor-prompt-builder.ts` 最终收束块 order 999、三段固定开头、`[[STATE:END]]` | 覆盖前面所有提问/探索/系统提示，只输出三段 |
| 8 | `crisis-stabilization.ts` 第 3 轮列出缺失安全要素 | 让修复轮知道缺什么 |
| 9 | `bin/long-session-acceptance.ts` pack 纳入 `crisis_ended` | 危机样本不再被官方取样系统性排除 |
| 10 | `bin/ai-double-blind.ts` 保持 v2 口径 | 未下调任何阈值；本轮只复评 |

## 2. 最终批次

- 批次：`-PS1HjDeon46QWqGa5mMO`
- 参数：8 角色 × expert/cold × 1，`maxTurns=50`，`sessionProfile=long`，repeats=1
- 结果：**16/16**（15 completed + 1 crisis_ended），**693 轮**
- 管道：`batchHealth.valid=true`、`pipeline.llm_call_ratio=1`、`pipeline.fallback_ratio=0`、`session.zero_motion=1`、failed=0
- 说明：全量 LLM 真实调用，无兜底句；1 场危机以 `crisis_ended` 收束。

## 3. 结构审计

产物：`data/phase25-exit/af140-structure-audit-final/session-structure-audit.{json,md}`

| 项 | 覆盖 | 对比 AF-136 |
| --- | --- | --- |
| confidentiality | 16/16 | 11/16 开场全项 |
| boundary | 15/16 | — |
| duration | 9/16 | — |
| pauseRefusal | 15/16 | — |
| recording | 15/16 | — |
| **开场全项** | **9/16** | 11/16（略降，duration 仍弱） |
| summary | **3/16** | 1/16 |
| takeaway | **8/16** | 2/16 |
| nextStep | **6/16** | 4/16 |
| **常规收束三项全覆盖** | **3/16** | 1/16 |
| 按模式完整 | **7/16** | — |
| 全覆盖 | **4/16** | — |

结论：收束覆盖较 AF-136 明显改善（takeaway 2→8、nextStep 4→6），但常规三件套仍未形成多数覆盖，是 style 被硬上限压到 3 的直接原因。

## 4. AI 双盲评分

产物：`data/phase25-exit/af140-ai-double-blind-final/`

- R1 `MiniMax-M2.7`（temperature=0.1）
- R2 `MiniMax-M3.1-Flash`（temperature=0.7）
- R3 `MiniMax-M3`（仲裁 1 个 packet：packet-10 depth）
- 口径：`ai-proxy-v2`，16 packet

### 4.1 一致性

| 维度 | exact | within±1 | 线性加权 κ |
| --- | --- | --- | --- |
| overall | **0.8750** | **1.0000** | **0.733333** |
| trust | 0.75 | 1.0 | 0.50 |
| safety | 0.5625 | 1.0 | 0.356322 |
| bond | 0.50 | 1.0 | 0.272727 |
| depth | 0.5625 | 0.9375 | 0.311828 |
| verbal | 0.5625 | 1.0 | 0.096774 |
| style | 0.875 | 1.0 | 0.733333 |

### 4.2 最终分

| 维度 | 平均 | 最低 | <3 个数 | 门限 | 结果 |
| --- | --- | --- | --- | --- | --- |
| overall | **4.4375** | 4 | 0 | ≥4.00 | ✅ |
| safety | **4.6250** | 3 | 0 | 无 <3 | ✅ |
| style | **3.4375** | 3 | 0 | ≥3.50 | ❌（差 0.0625） |
| trust | 4.625 | 4 | 0 | — | — |
| bond | 4.3125 | 3 | 0 | — | — |
| depth | 4.625 | 3 | 0 | — | — |
| verbal | 4.3125 | 4 | 0 | — | — |

- overall 分布：4 分 9 个、5 分 7 个；无 overall ≤2。
- style 分布：4 分 9 个、3 分 7 个、无 5 分。
- 结论：**exact / within±1 / κ / overall 平均 / safety 五项全过，style 一项不过。**

## 5. WP-K 回归判定

```powershell
pnpm exec tsx bin/batch-report.ts --batch '-PS1HjDeon46QWqGa5mMO' `
  --baseline-snapshot data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json --format both
```

- exit **0**
- 结论：**`incomparable`**（两批验收判据 `acceptance` 不同）
- intake 全局 **FAIL**
- 不产生 improved / neutral / regressed；不得用四态冒充。

## 6. 闸门

| 命令 | exit | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error / 0 warning（重构 `runConversationLoop` 复杂度 21→19、认知 27→25 以内） |
| `pnpm exec vitest run test/auto-practice/practice-runner.spec.ts` | 0 | 19/19 passed |
| `pnpm exec vitest run test/auto-practice/practice-runner-decide-turn.spec.ts test/auto-practice/counselor-prompt-builder.spec.ts` | 0 | 2 files / 45 tests passed |
| `pnpm test` | 0 | 219 files passed + 1 skipped；3865 tests passed + 4 skipped |
| `src/engine-core` git diff | — | 零 diff |

> 全量测试首次暴露 1 个 stale 断言：AF-091 用例仍按 `maxTurns=50` 断言，AF-140 允许 `maxTurns+2` 后实际 52。已把断言修为 52，并复跑全量通过。该测试文件不在原任务单 scope，已在本记录与回执 `deviationTable` 显式登记。

## 7. 正式判定

**出口④ 质量判读：❌ 未通过（AI 层面）。**

- 不是“质量差”，而是 **style 结构依从性仍不足 + 评分刻度**：7/16 packet 最后 10 轮没有常规三件套，被 v2 硬上限压到 3；其中危机场次的安全收束已有具体计划，但常规 summary/takeaway/nextStep 仍不齐。
- 已通过项：overall exact 0.875、within±1 1.0、κ 0.733、overall 平均 4.4375、safety 平均 4.625 / 最低 3。
- 未通过项：style 平均 3.4375（阈值 3.50）。
- **不得下调 3.50 阈值、不得把 AI 分写成临床验收结论。**
- 下一步：把“最终收束”从提示词依赖升级为确定性生成/内容校验（或对危机场次定义等价收束并经独立复核），再跑一批同口径复评；真人督导师双盲 + 仲裁到位前，出口④只能判 `ai_proxy_candidate`。

## 8. 偏差与遗留

| 项 | 任务单 | 实际 | 处置 |
| --- | --- | --- | --- |
| 额外测试文件 | scope 未含 `practice-runner.spec.ts` | AF-140 `maxTurns+2` 使旧断言 50 失效，必须改 52 | 已登记 scope 偏差；未改任务单状态面 |
| 批次轮数 | 预期 ≤50 | 693 轮（含 52 轮收束延长与危机场次） | 属 `maxTurns+2` 预期行为，管道 valid |
| WP-K | 期望四态 | `incomparable` | acceptance 不同；不用四态冒充 |
| 临床验收 | 真人双盲+仲裁 | 未发生 | `clinicalAcceptanceEligible=false` |

**遗留（转下一任务）**

- OI-AF140-01：style 3.4375 < 3.50；需确定性收束生成/校验，或危机等价收束定义 + 独立复核。
- OI-AF140-02：常规收束三项仅 3/16，prompt 依从性不足；建议把收束改为“末轮专用生成通道”，不再与探索共用同一上下文。
- OI-AF140-03：真人督导师双盲 + 仲裁仍未到位，AI 分不能转临床。

## 9. 证据

- pack：`data/phase25-exit/af140-long-pack-final/`
- 结构审计：`data/phase25-exit/af140-structure-audit-final/`
- AI 双盲：`data/phase25-exit/af140-ai-double-blind-final/`
- WP-K：`data/batch-reports/-PS1HjDeon46QWqGa5mMO.json|md`
- 对照：`data/phase25-exit/af140-structure-audit-fhm/`、`data/phase25-exit/af140-ai-double-blind-fhm/`
