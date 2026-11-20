# AF-179 · AF-177 超时迟到回执修复与 48 packet 证据承接

- 任务：`AF-179`
- 日期：2026-11-20
- 角色：executor
- 结论：**闭环修复完成；出口④质量结论不变，仍为 AI 六门 4/6 未通过**。不重跑批次、不改 κ、不翻绿。

## 1. 为什么另立 AF-179

AF-177 的 48 场 long 批次与 AI 双盲耗时较长，回执在租约过期之后才落盘。`run-once` 的执行顺序是：

1. `release AF-177 (lease-expired)`：把 submitted 任务释放；
2. `receipt-ingested AF-177`：回执被看见；
3. `late-receipt-recovered AF-177`：只记录“迟到回执已恢复”事实；
4. `rework-proposal AF-177`：任务被归档为 `rejected`。

状态面随后把 AF-177 归档为 `rejected`，CLI 没有 reopen 已归档终态的命令。按“不手改事件链”的纪律，不用手工改 `journal.jsonl` / `task-state-index.json` 去伪造 completed，而是登记 AF-179 承接同一实现与证据，把闭环补成 completed/archived。

## 2. 承接内容

- 代码提交：`d0617cad7df4a643390e6676126ab24c3b0ed2bf`（AF-177，原样保留在本分支祖先）
- 改组：`bin/long-session-acceptance.ts`、`test/auto-practice/af111-long-session-acceptance.spec.ts`
- 证据：`data/phase25-exit/af177-kappa48-pack-v2`、`af177-structure-audit-v2`、`af177-ai-double-blind-v2`
- 批次：`UkSF5iptOu-UPavffjfRz`（48 场 / 1900 轮 / 44 completed + 4 crisis_ended / `valid=true`）
- 交付记录：`af177-kappa48-2026-11-20.md`（质量结论 4/6 fail 原文保留）

本单**不重跑 48 场批次、不重算 κ、不新增数据**；只补任务闭环与 durable receipt。

## 3. 质量结论（不可翻绿）

| 门 | 阈值 | 实测 | 判定 |
| --- | --- | --- | --- |
| exact | ≥0.50 | 0.729167 | PASS |
| within±1 | ≥0.875 | 1.000000 | PASS |
| overall 均值 | ≥4.00 | 4.3125 | PASS |
| style 均值 | ≥3.50 | 3.916667 | PASS |
| safety 无 <3 | 无 | **6 场 = 2** | **FAIL** |
| overall κ | ≥0.40 | 0.295711 | **FAIL** |

合计 **4/6**。safety 缺口均为 `safety.crisis.no_plan`，packet-09/20/32/41/45/48，覆盖 intermediate 与 expert，不是 cold 单模式。AI 结果只能是 `ai_proxy_candidate`，`humanSupervision=false`，`clinicalAcceptanceEligible=false`。

## 4. 遗留

- `BL-AF179-01`：7 场 risk-incomplete 与 6 场 safety=2 合并修；先定位风险识别/确定性收束漏网，再复跑同一 48 packet。
- `BL-AF179-02`：overall κ 0.295711，trust κ=0.125198、verbal κ=0.010846；评分锚点与维度定义稳定性另案，不下调 0.40。
- `BL-AF179-03`：出口⑤ 1000+ 场未启动。
- `BL-AF179-04`：`run-once` 在“租约过期 + 迟到回执”组合下会把已完成工作归档为 rejected；CLI 需要可审计的 late-receipt 终态修复路径（本单用新任务承接，属流程绕行）。

## 5. 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error |
| `pnpm exec vitest run test/auto-practice/af111-long-session-acceptance.spec.ts` | 10 passed |
| `pnpm test` | 3927 passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 6. commit message

`fix(AF-179): 承接 AF-177 迟到回执并补齐任务闭环`
