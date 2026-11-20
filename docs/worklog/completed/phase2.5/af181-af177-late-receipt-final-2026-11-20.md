# AF-181 · AF-177 迟到回执闭环终态承接（单提交证据域）

- 任务：`AF-181`
- 日期：2026-11-20
- 角色：executor
- 结论：**任务闭环完成；出口④质量结论不变，AI 六门 4/6 未通过。**

## 1. 三次承接的根因

| 任务 | 结果 | 根因 |
| --- | --- | --- |
| AF-177 | rejected | 回执晚于租约；`run-once` 先 `release` 再 ingest，最终按 rejected 归档 |
| AF-179 | rejected | 回执 `conditional-pass`，acceptance 仍判 rejected；且 commits 混入 AF-177 提交 |
| AF-180 | rejected | `changedFiles.commits` 声明了 AF-177 `d0617ca` 与 AF-179 `a0447d0`；AF-179 的交付记录不在 AF-180 scope，`checkResidualByCommits` 触发 V7 残留 fail |
| AF-181 | 本单 | 回执只声明本任务提交；AF-177 代码提交只放 `artifactRefs.others`，不参与文件域比对 |

## 2. 承接内容（不重跑）

- 代码：`bin/long-session-acceptance.ts`、`test/auto-practice/af111-long-session-acceptance.spec.ts`，历史提交 `d0617ca`
- 批次：`UkSF5iptOu-UPavffjfRz`，48 场 / 1900 轮 / 44 completed + 4 crisis_ended / `valid=true`
- 结构审计：`data/phase25-exit/af177-structure-audit-v2`，开场 48/48、收束完整 41/48、risk-incomplete 7
- AI 双盲：`data/phase25-exit/af177-ai-double-blind-v2`，overall exact 0.729167、within±1 1.0、κ 0.295711
- 交付记录：`af177-kappa48-2026-11-20.md` 原样保留

## 3. 质量结论（显式 FAIL）

| 门 | 阈值 | 实测 | 判定 |
| --- | --- | --- | --- |
| exact | ≥0.50 | 0.729167 | PASS |
| within±1 | ≥0.875 | 1.000000 | PASS |
| overall 均值 | ≥4.00 | 4.3125 | PASS |
| style 均值 | ≥3.50 | 3.916667 | PASS |
| safety 无 <3 | 无 | **6 场 = 2** | **FAIL** |
| overall κ | ≥0.40 | 0.295711 | **FAIL** |

AI 结果仍是 `ai_proxy_candidate`，`humanSupervision=false`，`clinicalAcceptanceEligible=false`。

## 4. 遗留

- `BL-AF181-01`：7 场 risk-incomplete / 6 场 safety=2，需修风险识别或确定性收束。
- `BL-AF181-02`：κ 0.295711 < 0.40，trust/verbal 维度跨模型分歧大，需复核评分锚点。
- `BL-AF181-03`：出口⑤ 1000+ 场未启动。
- `BL-AF181-04`：`run-once` 的迟到回执终态与 commit 文件域比对需要编排层修复；本次以单提交证据域绕行。

## 5. 闸门

`pnpm typecheck` 0 error、`pnpm lint` 0 error、定向 10 passed、全量 3927 passed / 4 skipped、`src/engine-core` 零 diff。

## 6. commit message

`fix(AF-181): 终态承接 AF-177 迟到回执（单提交证据域）`
