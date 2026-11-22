# AF-180 · AF-177 超时迟到回执闭环修复（终态承接）

- 任务：`AF-180`
- 日期：2026-11-20
- 角色：executor
- 结论：**任务闭环完成；出口④质量结论不变，AI 六门 4/6 未通过。**

## 1. 事件链事实

AF-177 的 48 场 long 批次与 AI 双盲耗时超过任务租约，回执迟到。`run-once` 依次产生：

- `release AF-177 (lease-expired)`
- `receipt-ingested AF-177`
- `late-receipt-recovered AF-177`
- `rework-proposal AF-177` → 归档 `rejected`

AF-179 第一次承接时回执写 `conditional-pass`，仍被自动归档为 `rejected`。AF-180 是终态承接：**任务交付本身 `passed`，出口④ 质量结论在正文显式 `FAIL`**，两个判定分开，避免把“质量门未过”误当成“任务闭环未完成”。

## 2. 承接内容（不重跑）

- 代码：`bin/long-session-acceptance.ts`、`test/auto-practice/af111-long-session-acceptance.spec.ts`，提交 `d0617cad7df4a643390e6676126ab24c3b0ed2bf`
- 批次：`UkSF5iptOu-UPavffjfRz`，48 场 / 1900 轮 / 44 completed + 4 crisis_ended / `valid=true`
- 结构审计：`data/phase25-exit/af177-structure-audit-v2`，开场 48/48、收束完整 41/48、risk-incomplete 7
- AI 双盲：`data/phase25-exit/af177-ai-double-blind-v2`，overall exact 0.729167、within±1 1.0、κ 0.295711
- 交付记录：`af177-kappa48-2026-11-20.md` 原样保留

## 3. 质量结论（显式 FAIL，不得翻绿）

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

- `BL-AF180-01`：7 场 risk-incomplete / 6 场 safety=2，需修风险识别或确定性收束。
- `BL-AF180-02`：κ 0.295711，trust/verbal 维度跨模型分歧大，需复核评分锚点。
- `BL-AF180-03`：出口⑤ 1000+ 场未启动。
- `BL-AF180-04`：`run-once` 在“租约过期 + 迟到回执”下会连环 rejected；需编排层修复，禁止手工改事件链。

## 5. 闸门

`pnpm typecheck` 0 error、`pnpm lint` 0 error、定向 10 passed、全量 3927 passed / 4 skipped、`src/engine-core` 零 diff。

## 6. commit message

`fix(AF-180): 终态承接 AF-177 迟到回执闭环`
