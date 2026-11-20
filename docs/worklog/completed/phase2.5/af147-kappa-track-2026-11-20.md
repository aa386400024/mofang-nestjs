# AF-147 · AI 评分双轨与 96 场 κ 校准交付记录

- **taskId**：AF-147
- **日期**：2026-11-20
- **分支**：`task/AF-147-kappa-track`
- **基线**：`a2e3a7ed7d4ae68c21b2dc4f3ff204c6b43da0b2`
- **性质**：AI 代理评分口径校准，不是临床验收。`ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`。

## 1. 交付结论

**AI 层面质量门仍为 5/6，未达标；唯一失败项仍是 overall 跨模型加权 κ。**

- 96 场既有盲包校准把 overall κ 从 **0.351351** 提升到 **0.365854**，一致率 83/96 = **0.864583**，within±1 96/96 = **1.0000**，但仍 **< 0.40**。
- 0.40 阈值未下调，未用同模型高 κ 替代跨模型门，未把 96 场跨版本校准集冒充 AF-146 单批质量结论。
- 结论应表述为“评分口径/跨模型刻度债未清”，不是“咨询质量不达标”；在真人督导双盲+仲裁到位前，不得写“临床质量达标”。

## 2. 代码改动

| 文件 | 改动 |
| --- | --- |
| `src/auto-practice/metrics/ai-double-blind.ts` | 新增 `AiScoringTrack = 'method-probe' \| 'kappa'`；`RaterPromptInput.track`；`buildRaterPrompt` 在 kappa 赛道让 R1/R2 使用同一证据优先方法、同一锚点顺序、同一硬上限表，只换模型；method-probe 的 R1 证据优先 / R2 整体叙事 + R2 锚点倒序逐字保留；补充逐维 1–5 档位判据；版本升 `ai-proxy-v3`。 |
| `bin/ai-double-blind.ts` | 新增 `--track method-probe\|kappa`、`--arbitrate-gap 0–4`；provenance 写入 `scoringTrack`、`arbitrateGap`；报告头与 dry-run/结束输出标注赛道；默认仍 `method-probe`、`arbitrate-gap=1`。 |
| `test/auto-practice/ai-double-blind.spec.ts` | 16 项：新增 kappa 赛道同方法/同锚点序、method-probe R2 倒序、逐维档位判据断言；版本断言 v3。 |

边界：未改咨询师 prompt、未新跑 LLM 对练批次、未改阈值、未写 `quality_annotation` 人工表。

## 3. 校准结果（全部可复现）

### 3.1 16 场 AF-146 盲包

| 口径 | overall exact | within±1 | overall κ |
| --- | --- | --- | --- |
| method-probe v2（AF-146 基线） | 0.6250 | 1.0000 | 0.351351 |
| kappa v3 首轮 | 0.5625 | 1.0000 | 0.188406 |
| kappa v3 + 逐维档位判据 | 0.5000 | 1.0000 | -0.015873 |

结论：n=16 且分数挤在 4/5，κ 受 prevalence 影响极大；“同方法”不足以消除跨模型刻度差。16 packet 不足以支撑 0.40 硬门（AF-131 B-4；MiniMax 复核独立算出 n=16 的 cluster bootstrap 95% CI 为 [-0.1250, 0.6923]）。

### 3.2 96 场跨批次校准（不新跑对练）

盲包：`data/phase25-exit/af147-kappa-96/blind-map.json`，6 个既有独立批次 ×16 = **96 个唯一 session**（AF-130、AF-136、AF-140、AF-140-FHM、AF-140-final、AF-144）。

**最佳口径**（`af147-kappa-96-out`）：R1=`MiniMax-M2.7`、R2=`MiniMax-M3.1-Flash`、R3=`MiniMax-M3`；同方法、同锚点序、温度 0.1、`arbitrate-gap=0`、并发 6。

| 指标 | 值 |
| --- | --- |
| overall exact | **83/96 = 0.864583** |
| within±1 | **96/96 = 1.0000** |
| overall κ | **0.365854（<0.40）** |
| overall 分布 | 4×81、5×15，无 ≤2 |
| 分维 κ | trust 0.194508；safety 0.659675；bond 0.536842；depth 0.641457；verbal 0.078891；style 0.565779 |

**稳定性复跑**：

| 口径 | overall κ | 结论 |
| --- | --- | --- |
| 温度 0 | 0.341176 | 不是采样噪声，温度 0 更低 |
| 收紧 trust/verbal 为可计数规则 | -0.018868 | 规则放大两模型解释差异，按证据回退，不采用 |
| M3 vs M3.1-Flash | 未产出 | M3 在 cal-01 输出 `<think>`，整批 fail-closed；未重试、不补数据 |

> 96 场跨版本校准集的 style 均值 3.2708、overall 均值 4.1562，包含 AF-130/136 等旧收束版本，**不能替代 AF-146 单批质量结论**。AF-146 单批仍为 exact 0.6250、within±1 1.0000、overall 平均 4.6250、safety 4.6875/最低 4、style 3.6875/最低 3。

## 4. MiniMax 独立复核

- 文件：`docs/worklog/pending/relay-response-AF147-20261120-0015.md`（40,453 bytes）。
- 协议层验证：kappa 赛道 R1/R2 的 `user` prompt 逐字节相同；system 归一身份 token 后相同；method-probe R1/R2 `user` 不同、R2 锚点倒序保留。实现干净。
- 关键判断：AF-146 的 6 处 overall 分歧全是 ±1、方向 4:2，方法差不是 κ 低的主因；真正压制 κ 的是 **prevalence 崩塌 + 硬上限钉档**。16 packet 只有 8 个独立簇，n=16 上 P(κ≥0.40)=37.1%。
- 命名建议：kappa 赛道应称“**跨模型同协议可复现性**”，不构成真人督导可互换性证据。
- 建议：P0 硬上限搬出 prompt + 锚点档位判据 + 固定刻度校准批；P1 扩到 ≥16 簇/≥32 packet，稳妥 ≥24 簇/48 packet；P2 点估计 + cluster bootstrap 95% CI 下界双条件，并列 AC1/Krippendorff α 诊断，0.40 出处写进任务单。
- 本单未采纳的复核建议已列入第 6 节遗留，不在本单偷改阈值或扩 scope。

## 5. 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | 见第 7 节实测 |
| Lint | `pnpm lint` | 见第 7 节实测 |
| 定向单测 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` | 见第 7 节实测 |
| 全量 | `pnpm test` | 任务收尾一次，见第 7 节 |
| 边界 | `src/engine-core` git diff | 零 diff |

## 6. 遗留 / 后续任务

| 编号 | 遗留 | 处置 |
| --- | --- | --- |
| OI-AF147-01 | 硬上限仍在评分员 prompt，style/safety 被钉档，prevalence 崩塌 | 另单做后处理硬上限（AF-131 B-2），本单不改 |
| OI-AF147-02 | 96 场跨批次校准仍 <0.40，需 ≥24 独立角色簇/48 packet 且覆盖 ≥3 profile | 另单扩簇，不用重复 session 凑 n |
| OI-AF147-03 | κ 门缺 cluster bootstrap 95% CI 下界与 AC1/α 诊断 | 另单补统计口径，0.40 阈值不动 |
| OI-AF147-04 | 结构缺口 5/16（4 场 risk-incomplete + 1 场 none）未修 | 另单修结构，不在评分口径单里混改 |
| OI-AF147-05 | MiniMax 复核指出的 temperature 声明、promptSha256、parse retry 对称性、身份提示 | 登记技术债，后续统一修 |

## 7. 实测记录

- `pnpm typecheck`：**PASS**（`tsc -b tsconfig.check.json`，exit 0）。
- `pnpm lint`：**PASS**（`eslint --cache`，src/test/bin + scripts，0 error 0 warning，exit 0）。
- 定向：`pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts` → **2 files / 28 tests passed**（16 + 12）。
- 全量：`pnpm test` → **221 files passed / 1 skipped，3873 tests passed / 4 skipped**，exit 0，耗时 25.99s。
- `src/engine-core`：`git diff --name-only` 为 **0 行，零 diff**。

> 注：全量测试期间有一处历史 AF-128 的 `src/shared/llm/reasoning-text.ts` 工作区改动参与运行并通过；该改动不属于 AF-147，未纳入本单提交范围。
