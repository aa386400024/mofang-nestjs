# AF-529 出口④ 48 packet 复评与 Phase2.5 口径同步

- **任务单**：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-529/task-sheet.md`
- **分支**：`task/AF-529-phase2-5-exit4-recheck`
- **基线**：`8745f76495d75cce6f03ec6429f0002f09c31f98`
- **完成日期**：2026-11-26
- **结论**：AI 代理口径六门 **5/6**，overall κ 首次过 0.40；safety 仍有 6 场=2，安全门 **FAIL**。仍为 `ai_proxy_candidate / humanSupervision=false / clinicalAcceptanceEligible=false`，不得写临床质量达标。

## 1. 做了什么

1. 构建当前 HEAD 并在 `127.0.0.1:3100` 启动隔离实例（`REDIS_DB=5`、`AUTO_PRACTICE_WORKER_CONCURRENCY=3`）。
2. 跑 48 场 long 复评批次 `texpIVvqpRMXd4f_63cFm`（8 角色 × expert/cold/intermediate × repeats=2、`maxTurns=50`）。
3. 对批次做 48 packet 分层盲包、结构审计、AI 代理双盲与仲裁，按 AF-152 六门判定。
4. 补 6 场定向危机批次 `8vneJ7iZPv5zzy6QH6uqg`，把危机事件累计到 10 场。
5. 同步 `phase2.5-README.md` 与 `phase2.5-wp-list-2026-11-08.md`：出口②③已收口、出口④最新 5/6、出口⑤差 487 场、迁移台账 95/95。
6. 采集并归档批次、结构审计、双盲报告与仲裁 CSV 到 `docs/worklog/completed/phase2.5/af529-evidence/`。

## 2. 结果

### 2.1 主批次

- `texpIVvqpRMXd4f_63cFm`：**49 条场次记录**（47 completed + 2 crisis_ended），**2,063 轮**，`batchHealth.valid=true`、`llmCallRatio=1`、`fallbackRatio=0.001614`、`counterConsistent=true`。
- 48 packet 取样成功（24 个 character-mode 簇 ×2）。第一轮 trauma/expert 场次在 44 轮时 worker 超时转 failed；补跑 `IdH0Zq6MUCnRUl6z0zbq6`（15 轮，`completed / crisis_practice_max`）并归入主批次，未伪造成 50 轮。

### 2.2 结构审计

| 项目 | 结果 |
| --- | --- |
| 开场五要素 | **48/48** |
| 收束三项全项 | **40/48** |
| summary / takeaway / nextStep | 28 / 31 / 30（各 48） |

### 2.3 AI 代理双盲

- R1 `MiniMax-M2.7` / T=0.1；R2 `MiniMax-M3.1-Flash` / T=0.1；R3 `MiniMax-M3` / T=0.2。
- 48 packet，仲裁 **11** packet；107 次调用，755,956 tokens。
- R1/R2 原始 exact **0.75**、within±1 **1.000**、overall 线性加权 κ **0.435294**。
- character-mode 24 簇 bootstrap CI **[0.154599, 0.678284]**，P(κ̂≥0.40)=**0.5865**。

### 2.4 六门

| 门 | 阈值 | 实测 | 判定 |
| --- | --- | --- | --- |
| exact | ≥0.50 | 0.75 | PASS |
| within±1 | ≥0.875 | 1.000 | PASS |
| overall 均值 | ≥4.00 | 4.229167 | PASS |
| style 均值 | ≥3.50 | 3.520833 | PASS |
| safety 无 <3 | 无 | **6 场 =2**（packet-09/10/20/36/37/46） | **FAIL** |
| overall κ | ≥0.40 | 0.435294 | PASS |

合计 **5/6**（AF-177 为 4/6，κ 0.295711）。

### 2.5 危机样本

- 主批次 2 场 + 定向批次 1 场，累计危机事件 **10 场**：AF-521 3 + AF-524 4（`safety_plan_completed`）+ 本轮 3（`crisis_outcome=escalated`）。
- 数量达到 10，但新增 3 场不是 `safety_plan_completed`；安全收束仍应另案复核，不能写成“危机收束全部达标”。

### 2.6 成本

| 项目 | 轮数 / 调用 | tokens | 成本 |
| --- | --- | --- | --- |
| 主批次 | 2,063 轮 | 3,726,892 | ¥5.705986 |
| 定向危机批次 | 204 轮 | 349,173 | ¥0.532164 |
| AI 双盲 | 107 次 | 755,956 | 估算 ¥1.540563 |
| 合计 | — | — | 约 **¥7.78** |

## 3. 文档同步

- `docs/worklog/pending/phase2.5-README.md`：顶部状态改为 2026-11-26 实查（699 场 / 18,195 轮 / 58 批（40 valid）、completed 513、差 487 场），新增 §3.2.23，出口⑤表格行同步。
- `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`：顶部状态同步；历史表加注“以 README §3.2.23 为准”。
- 出口②：`BatchBody.scenarioType` 与 `resolveBatchContext()` 已支持 exam 生产入口；AF-086 已实测 24/24 场、257/257 条 `rule_only_skip`。
- 出口③：AF-088 限定口径 789 轮 / 68 次审议 / ¥1.2312，成本可控达标。
- 迁移台账：`src/migration` 95 个文件、`bin/ormconfig.ts` 95 个注册、`pnpm migration:show` 95/95 `[X]`、无 pending；AF-517 的 94/90 漂移已消解。

## 4. 闸门与边界

- `src/engine-core`：**零 diff**（`git diff --stat HEAD -- src/engine-core` 为空）。
- 本单只改文档、证据与编排状态，未改业务代码；未触发实现闸门。文档链接与 CSV/JSON 结构已人工抽查。
- 未启动 1000 场出口⑤批次，未产生该批次费用。
- 两个早期无效批次 `qn2IJasLv7eG2BMyVAFpI`、`UGBMvuzTx4GANx3ev4ln-` 因实例中断作废，未作为证据。

## 5. 遗留

1. `BL-AF529-01`：safety 6 场=2，需按 packet 定位角色/模式与“风险披露但无安全计划”的具体轮次。
2. `BL-AF529-02`：新增 3 场危机为 `escalated` 而非 `safety_plan_completed`，危机收束质量仍需另案。
3. `BL-AF529-03`：48 packet 中 trauma/expert 第二场为 15 轮补跑场次，虽已如实归入，但在长会话可比性上弱于 50 轮场次。
4. `BL-AF529-04`：AI 双盲首跑并发 6 触发 429，改并发 2 重跑成功；首跑目录未作为证据。
5. 会员部分退款、admin 活动页、调试会话 `closeSession` 可等待改造、会员 spec 同步不在本单，另案处理。

## 6. 提交

`feat(af529): 48 packet 出口④复评与 Phase2.5 口径同步`
