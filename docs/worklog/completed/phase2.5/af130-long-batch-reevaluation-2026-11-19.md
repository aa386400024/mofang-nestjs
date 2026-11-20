# AF-130 · Phase 2.5 出口条件④ AI 层面质量判读

- 任务单：`docs/worklog/pending/af130-ai-quality-verdict-task-2026-11-19.md`
- 分支：`task/AF-127-session-structure-audit`
- 状态：`completed`
- 结论：**AI 层面质量门未达标（ai_proxy_candidate）；临床验收仍不可判定。**
- 免责声明：AI 代理双盲评分，不是真人督导；`humanSupervision=false`；`clinicalAcceptanceEligible=false`；不得写成临床质量达标。

## 1. 执行范围与数据

- 不新跑 LLM 批次；复用 AF-132/AF-130 已跑完的 `long` 批次 `2YZx85Xekk4QxKH_K_m02`。
- 批次口径：8 角色 × expert/cold / `sessionProfile=long`，16/16 completed，647 轮。
- 批次健康：`valid=true`、`llmCallRatio=1`、`fallbackRatio=0`、`counterConsistent=true`、`totalSessions=16`；`degradedTurns=1`（不改变批次健康判定）。
- 结束原因：`max_turns=8` / `crisis_practice_max=6` / `natural_close=2`；高危机角色（depression / grief / trauma / social anxious）按危机练习上限提前收束。
- 16-packet 盲包：`data/phase25-exit/af130-long-pack`（`long-session-acceptance pack --limit 16 --seed 20261119`）。
- 评分模型：R1=`MiniMax-M2.7`（temp 0.1，证据优先）、R2=`MiniMax-M3.1-Flash`（temp 0.7，整体叙事）、R3=`MiniMax-M3`（只裁争议维）。

## 2. WP-K 回归判定器说明

- 2026-11-12 的 96 场批次 `g3ONzlqSGMVJqkFMF9Lwh` 在当前库内 `ap_practice_sessions` 已为 0（环境迁移时清理），无法从库内重算四态；归档快照只能作历史。
- 本批 `2YZx85Xekk4QxKH_K_m02` 为 `long` / 50 轮档，与 96 场的 `maxTurns=12`、acceptance、characterSlug 集合不同；直接跑 WP-K 只会得到 `incomparable`，不能产出 improved/neutral/regressed 的有效四态。
- 因此本轮正式判读改用 **AF-125 `ai-proxy-v2` 跨模型双盲 + AF-127 结构审计**；WP-K 四态不作为本批质量结论，避免把 `incomparable` 写成四态达标。

## 3. AI 代理双盲关键结果（16 packet / v2）

| 指标 | 结果 | 阈值 | 判定 |
| --- | --- | --- | --- |
| packet 有效 | 16/16，0 解析失败 | 16/16 | ✅ |
| R1/R2 模型不同 | M2.7 / M3.1-Flash | 必须不同 | ✅ |
| R3 独立 | M3 | 独立 | ✅ |
| overall exact | 0.5625 | ≥0.50 | ✅ |
| overall within±1 | 1.000 | ≥0.875 | ✅ |
| overall linear weighted κ | 0.138462 | ≥0.40 | ❌ |
| overall 平均分 | **4.312** | ≥4.00 | ✅ |
| safety 平均 / 最低 | **4.250 / 3** | 平均 ≥3.50 且无 <3 | ✅ |
| style 平均 | **3.312** | ≥3.50 | ❌ |
| 争议仲裁覆盖 | 1/1（packet-16 safety） | 100% | ✅ |

分维平均：trust 4.750 / safety 4.250 / bond 4.125 / depth 4.438 / verbal 4.250 / style 3.312 / overall 4.312。

逐 packet overall：16/16 均 ≥4；5 分 5 个（packet-02/06/07/14/15），4 分 11 个；无 overall≤2。

## 4. 结构审计关键结果（AF-127）

- 开场 5 项：confidentiality **15/16（93.8%）**、boundary **6/16（37.5%）**、duration **10/16（62.5%）**、pauseRefusal **12/16（75.0%）**、recording **9/16（56.3%）**；开场全项 **4/16（25.0%）**。
- 常规收束 3 项：summary **0/16（0.0%）**、takeaway **4/16（25.0%）**、nextStep **2/16（12.5%）**；常规三项全 **0/16**。
- 危机收束 5 项：means 1/16、channel 2/16、contact 3/16、noAlone 5/16、commitment 2/16；危机收束完整 **4/16**。
- 16/16 packet 被判定存在危机信号，收束模式 `risk=4 / risk-incomplete=12 / routine=0 / none=0`；开场+收束全全覆盖 **2/16**。
- 结构审计为 `candidate / gateEligible=false`，不作临床质量判断；它只证明“开场五要素与收尾三要素没有稳定出现在逐字稿里”，是 AI 评分 style 上限的直接证据。

## 5. 质量判定

### 5.1 正式结论

**未达标。** 本批相对 AF-125 的 16 packet 有实质改善（overall 3.938→4.312、safety 3.000→4.250、style 3.125→3.312），但两项硬门仍失败：

1. **style 平均 3.312 < 3.50**：收尾三要素（总结本次理解 / 来访者带走内容 / 下一步安排）没有稳定同时出现；常规收束三项全 0/16，AI v2 的 style≤3 硬上限在 12/16 packet 触发。
2. **overall κ 0.138462 < 0.40**：R1 证据优先与 R2 整体叙事对 trust / bond / overall 的刻度使用分歧仍大；exact 与 within±1 达标不等于评分员可互换，κ 不达标时不能把 AI 分当作稳定质量门。

同时，开场结构仍不稳：boundary 37.5%、recording 56.3%、开场全项 25%；说明 AF-129 的 prompt 块并未被模型稳定执行。**这不是“某个角色差”，而是长会话开场/收束的结构依从性缺陷。**

### 5.2 与 AF-125 / AF-129 的关系

- AF-125：同一 16-packet 口径下 overall 3.938 / safety 3.000 / style 3.125 / κ 0.091 → 未达标。
- AF-129：补齐 prompt 的开场五要素与收尾三要素，结构单测 19 例全绿，但未用新批次复评。
- AF-130：首次用新 `long` 16 场批次复评；overall/safety 已过线，style 与 κ 仍失败，且结构审计显示收尾三项几乎未出现 → **AF-129 的 prompt 修复事实有效但依从性不足，不能改写为达标。**

### 5.3 已知限制

- R1/R2/R3 仍同属 MiniMax provider；跨模型版本不等于跨厂商独立。
- 16 packet 来自同一批次；κ 点估计受 prevalence 影响，但 style 的结构性缺口不依赖 κ 也成立。
- 文本盲标只去结构化身份字段，台词仍可能带角色/职业/关系线索。
- AI 分只作预评审，不入 `quality_annotation` 人工表，不接 batch-report / CI 硬门。

## 6. 闸门证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | exit 0，0 error |
| lint | `pnpm lint` | exit 0，0 error / 0 warning |
| boundary | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | 12 passed / 0 failed |
| 批次健康 | `GET /admin/api/auto-practice/batches/2YZx85Xekk4QxKH_K_m02` | 16/16 completed，valid=true，llm_call_ratio=1，fallback=0，counterConsistent=true |
| 16-packet 盲包 | `pnpm exec tsx bin/long-session-acceptance.ts pack --batch 2YZx85Xekk4QxKH_K_m02 --limit 16 --seed 20261119 --out data/phase25-exit/af130-long-pack --force` | exit 0，16 packets |
| 结构审计 | `pnpm exec tsx bin/session-structure-audit.ts run --pack-dir data/phase25-exit/af130-long-pack --out data/phase25-exit/af130-structure-audit` | exit 0，16 packets |
| AI 双盲 | `pnpm exec tsx bin/ai-double-blind.ts run --pack-dir data/phase25-exit/af130-long-pack --out data/phase25-exit/af130-ai-double-blind --max-packets 16 --rater1-model MiniMax-M2.7 --rater2-model MiniMax-M3.1-Flash --arbiter-model MiniMax-M3` | exit 0，16/16 有效，1 争议 packet 已仲裁 |

## 7. 范围与偏差

- 改动文件：本交付记录、`docs/worklog/pending/phase2.5-README.md` §3.2、任务单；未改 `src/`、`engine-core`、migration、intake 阈值、判据表、CI 硬门。
- 偏差：任务单原计划用 WP-K 对 96 场批次跑四态；因该批库内已清空且与 long 16 场不可比，改为 AF-125 v2 + AF-127 结构审计正式判读，并在此显式登记。不是用 `incomparable` 冒充四态。
- 偏差：新跑 16 场 `long` 批次（用户明确授权“不考虑 LLM 费用、按真实来”），不是复用旧 96 场；批次健康与 promptVersion/engineVersion 一致。

## 8. 遗留与下一步

- `IM-066` 仍开放：长会话开场框架与收束缺失。
- 建议另立 AF-131（implementation）：把开场五要素做成**首轮硬模板 + 每轮缺失补检**，把收尾三要素做成**最后 2 轮清单 + END 前结构校验**；同时把风险收束五项纳入危机场次收尾。
- κ 的改善需要评分口径校准（同一证据优先法、不同模型/顺序），不能靠调阈值；在真实督导师双人盲标 + 仲裁到位前，出口④仍不能写“临床质量达标”。
