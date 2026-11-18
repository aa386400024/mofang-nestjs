# AF-088 · Phase 2.5 出口条件③④⑤ 全量收口（证据落盘 + 判定）

- 任务单：`docs/worklog/pending/af088-phase25-exit345-task-2026-11-18.md`
- 任务分支：`task/AF-088-phase25-exit345`
- 基线：`55c171f`（AF-088 任务单登记提交）
- 取证日期：2026-11-18
- 范围：`data/phase25-exit/`、`docs/worklog/completed/phase2.5/`、`docs/worklog/pending/phase2.5-README.md`（§3.2）、`docs/team/agent-orchestration/transport/receipts/AF-088.json`
- 证据 JSON：`data/phase25-exit/af088-exit345-evidence-2026-11-18.json`

## 1. 本轮做了什么 / 没做什么

本轮**只做证据落盘 + 交付记录 + README §3.2 回写**：把已经跑完的真实运行（批次 `fztsntHxa5v6ikXrDsYgv` 与离线评测 `eval-af088-offline.json`）用只读方式复核一遍，落成可审计的证据文件，并给出③④⑤三个出口条件的正式判定。

没做（按用户约束）：不跑新批次、不跑 LLM、不改 `src/`、不改 `.env`、不改数据库、不跑编排 CLI、不 commit/push、不改状态面。

## 2. 取证口径（可复现）

| 层 | 来源 | 访问方式 |
| --- | --- | --- |
| 批次与场次 | MySQL `ap_practice_batches` / `ap_practice_sessions` | 只读 `SELECT` |
| 触发闸门 | MySQL `gate_decisions` | 只读 `SELECT` |
| 审议统计 | Redis `mofang:dev:deliberation_stats:global`（及 `:global:2026-11-18`） | 只读 `HGETALL` |
| 审议明细 | Redis `mofang:dev:deliberation_trace:*` / `deliberation:gate:trace:*` | 只读 `SCAN` + `GET` |
| 督导评测 | `data/eval-reports/synthetic-supervisor-v1/eval-af088-offline.json` | 只读 |
| 定价 / 口径出处 | `src/engine-adapters/observability/session-cost.ts:58-61`、`src/engine-adapters/deliberation/llm-deliberation.service.ts:248`、`src/engine-adapters/deliberation/deliberation-stats.ts:640-652`、`src/engine-adapters/deliberation-gate/deliberation-gate.types.ts:87-99` | 只读 |

> ⚠️ `data/eval-reports/` 被 `.gitignore` 命中 → 评测报告本身不进版本库；其关键数字已**镜像**进证据 JSON，README 与本记录只引用镜像值。

## 3. 出口③ 成本可控 —— 达标（保守上界口径）

### 3.1 批次与场次（真实）

批次 `fztsntHxa5v6ikXrDsYgv`：`total_sessions=4`、`total_turns=92`、`max_turns=50`、`deliberation_mode=shadow`、`llm_call_ratio=1.0000`、`fallback_ratio=0.0000`、`counter_consistent=1`、`valid=1`（`validity_flags=null`）、`prompt_version=6eac9ac361d55741`、指纹 `combined=1caeea117101e8d9`（与 AF-086 两批同指纹）。

| 场次 | 角色 / 模式 | 状态 | 轮数 | 退出原因 | 渲染 token | 渲染成本（元） | 审议 run 次数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2Y2qTViCXAv0EAsvgZ09f` | grief / cold | completed | 24 | crisis_practice_max | 36,871 | 0.078413 | 11 |
| `98T8GFKtafFoyffpM4wZO` | grief / preachy | crisis_ended | 20 | crisis_escalated | 33,985 | 0.078509 | 9 |
| `iNiEuHCvGa5D9PZmSUiUr` | grief / nonsense | stagnant | 11 | stagnant | 16,538 | 0.038856 | 5 |
| `S8UcQEk-eO7oLCY4tM-Wi` | grief / chatty | completed | 37 | crisis_practice_max | 73,178 | 0.184473 | 18 |
| **合计** | 1 角色 × 4 模式 | 2 completed + 1 crisis_ended + 1 stagnant | **92** | — | **160,572** | **0.380251** | **43** |

> 渲染侧成本（`cost_basis=full`）与**审议成本**分开记账；出口③ 只考核审议成本。

### 3.2 审议调用与耗时

- **统计层**（Redis 计数器）：`total_turns` 由 **3 → 48**，本批增量 **45** 次审议轮次；全局累计 48 次中 `success_turns=45`、`failure_turns=3`（`error_fetch_error=3`），累计成功率 **93.75%**；本批增量可核 trace **43** 条 = 41 成功 / 2 失败（与增量 45 差 2 已登记 OI-02）；`total_duration_ms=508318` → `avg_duration=10589.958ms（10.59s）`、`max_duration=90842ms`；`p50=5000ms`、`p95=30000ms`（**桶上界估计**：命中 `latency_b12 = [30s, ∞)`，返回上界 30000ms，方向保守 → 真实 p95 ≥ 30s）；`stale_turns=8`（`stale_rate=8/45=17.78%`）；`avg_delta_diff_abs=0.0000753`、`max_delta_diff_abs=0.000385`；`avg_retry_count=0`。
- **明细层**（逐条回读 Redis trace，限本批 4 个 debugSessionId）：**43** 条，`ok=41` / `fail=2`（均为 `fetch_error`），`avg=10472ms`、`p95=37157ms`、`max=90842ms`，**带 tokenUsage 的 trace=0**。
- **闸门层**（`gate_decisions` 本批 88 行，`mode` 全 `shadow`）：`decision=run` **43**、`decision=skip` **45**；run 理由 `unknown_event_type=37` / `alliance_delta_high=5` / `key_event=1`；skip 理由 `cooldown=38` / `crisis_skip=7`。run 43 与明细层 43 条 trace 一一对应 → 触发闸门真实生效（近一半轮次被冷却 / 危机闸拦下）。
- **验收修正（主控）**：原稿把「本批增量 45 次」与「全局累计 48 次中 45 成功 / 3 失败」混写；已拆分为两个口径，成本仍按本批增量 45 次计，不影响 ③ 的达标结论。增量 45 与可核 trace 43 的 2 轮差保留为 OI-02。

### 3.3 成本折算（保守上界）

定价表取仓库唯一一张：`DEFAULT_SESSION_COST_PRICING`（`session-cost.ts:58-61`）输入 **0.0015 元/千 token**、输出 **0.0045 元/千 token**（MiniMax Token Plan 口径，工程默认值，非厂商合同报价）。

- 单次审议成本上界 = `3k × 0.0015 + 2048 × 0.0045` = `0.0045 + 0.009216` = **0.013716 元**
  - 输入 3k 是**保守假设**（审议入参按 WP-A 只传结构化数据，3k 明显高于实际体量；审议 token 统计恒为 0，取不到实测值）；
  - 输出 2048 = `DELIBERATION_MAX_COMPLETION_TOKENS`（`llm-deliberation.service.ts:248`），是生成长度上限，输出侧上界。
- **单场 50 轮上界**（统计口径 45 次 / 92 轮 → 0.489130 次/轮 → 24.456522 次/场）= **0.335446 元**
  - 更低的一致口径（逐条 trace 43 次 / 92 轮 → 23.369565 次/场）= **0.320536 元** → 两个口径同向。
- **最坏情形**（每轮都触发审议，50 次全 run）= 50 × 0.013716 = **0.6858 元**

**判定：保守上界 0.335446 元/场 ≤ 1 元，最坏情形 0.6858 元 ≤ 1 元 → 出口③ 达标。**

### 3.4 出口③ 的诚实边界

本单结论是「**按保守假设达标**」，不是「按实测 token 达标」——审议链未开 `stream_options.include_usage`，`total_prompt_tokens` / `total_completion_tokens` 恒为 0，无法用实测 token 直接核算（遗留 OI-01）。若真实输入 token 远超 3k，需按新口径重算上界。

## 4. 出口④ 质量达标 —— 未通过 / 不可判定

评测报告 `data/eval-reports/synthetic-supervisor-v1/eval-af088-offline.json`（`reportId=eval-20261118-160749-503c3018`，2026-11-18T08:07:49Z）：

- 配置：`model=MiniMax-M3`、`promptVersion=af088`、`datasetVersion=synthetic-supervisor-v1`、`mode=offline`、`runs=3`、`split=validation`、`groundTruthKind=supervisor`、**`synthetic=true`**。
- 数据质量：总 8 场，**有效 4 / 丢弃 4**（`too_short=1`、`has_error=1`、`bdi_anomaly=1`、`missing_gate_trace=1`），`turnsWithMissingGateTrace=8`。
- 触发质量：`precision=0.615385`、`recall=0.666667`、**`f1=0.64`**（tp 24 / fp 15 / fn 12 / tn 45，support 96）。
- 建议质量：`macroAverage=0.833379`（六维方向准确率宏平均：trust 0.854545 / safety 1 / bond 0.9 / verbal 0.717949 / depth 0.777778 / style 0.75），`amplitudeMAE=0.005855`（对比轮次 27）。
- 与基线对比：方向准确率 **0.762302 → 0.833379（+0.071077）**；`amplitudeMAE` 0.005006 → 0.005855（+0.000849）。
- 成本：30,729 tokens / 0.184374 元。
- 报告自带告警：**「数据集为合成数据: 指标只验证链路可用, 不能作为验收结论」**。

**判定：未通过 / 不可判定。** 理由：0.833 > 0.8，但分子分母全部来自**合成集**（4/8 有效样本），仓库内无真实督导标注数据集；按任务单红线，不得用合成分数冒充 80% 验收。可确认的只有**评测链路本身可用**（0.762 → 0.833 的对比可复算）。

## 5. 出口⑤ 数据积累 —— 未达标

- 库内累计（2026-11-18 16:45 只读复核）：**62 场 / 592 轮**（`SELECT COUNT(*), SUM(turn_count) FROM ap_practice_sessions`）。
- 距 1000+ 场差 **938 场**；按本批 92 轮 / 4 场 ≈ 23 轮/场估算，缺口约 2.2 万轮（量级参考，不作承诺）。
- **1000 场批次未启动**（本轮不跑新批次）→ ⑤ 无达成路径，只能如实记未达标。

分批次明细（12 个批次，见证据 JSON `exit5.byBatch`）：`uJHgP8…` 8 场 / 94 轮；`0ZTYa6…`、`WAyxuG…` 各 4 场（渲染兜底 26 / 27 轮、degraded 52 / 54，**无 llm_call_turns**）；AF-086 的 `Sh4B…` 12 场 / 129 轮、`UAK…` 12 场 / 128 轮；本批 `fztsnt…` 4 场 / 92 轮。

## 6. 正式判定

| 出口 | 判定 | 关键数字 |
| --- | --- | --- |
| ① 合规过线 | ✅ 代码口径保持（AF-085 / AF-086 已收口，本单无新增运行证据） | — |
| ② 考核公平 | ✅ 规则层达标（AF-086：24/24 exam、24/24 rule_only、257/257 rule_only_skip、4/4 指纹一致） | — |
| **③ 成本可控** | **✅ 达标（保守上界）** | 单场 50 轮上界 **0.335446 元**；最坏 50 次全触发 **0.6858 元**；≤ 1 元 |
| **④ 质量达标** | **❌ 未通过 / 不可判定** | trigger F1 **0.64**；建议宏平均 **0.833**（0.762→0.833）；**4/8** 有效样本；`synthetic=true` |
| **⑤ 数据积累** | **❌ 未达标** | **62 场 / 592 轮**，距 1000+ 场差 **938 场**；1000 场批次未启动 |

## 7. 偏差与遗留

| 项 | 与任务单偏差 | 处置 |
| --- | --- | --- |
| 出口⑤ 的 1000 场批次投递与轮询 | 任务单要求投递 1000 场 12 轮批次并轮询到完成；本轮不跑新批次，批次未启动 | 如实判未达标（62 场 / 592 轮，差 938 场），缺口登记 OI-05，**不预支已达标** |
| 出口④ 的真实督导标注 | 仓库内无真实督导标注数据集 | 按任务单红线判「未通过 / 不可判定」，只落盘链路可用性证据（OI-04） |
| 出口③ 的 token 取证 | 审议 token 统计恒为 0（未开 `stream_options.include_usage`），取不到真实 token | 改用保守假设（输入 3k / 输出 2048）并显式标注为假设；**只写保守上界**，不用乐观值（OI-01） |
| 统计增量 vs 可核 trace | 统计 delta 45，本批可核 trace 43（与 43 条 `decision=run` 一一对应），差 2 轮，原因未定位 | 如实记为遗留 OI-02，不臆断（两种口径都不影响成本结论方向） |
| 触发理由分布 | 43 次 run 中 37 次理由为 `unknown_event_type`（规则算不准的 LLM 专属标签），与「只有状态变化大才跑」存在口径落差 | 登记 OI-03，待产品 / 临床口径复核 |
| 编排闭环 | 任务单要求全程走 CLI 至归档 / PR / squash | 本轮不跑 CLI、不 commit、不改状态面；回执写入 `transport/receipts/AF-088.json` 交编排摄取，**归档 / PR / squash 留给编排步骤** |
| 任务单与交付记录同移 `completed/` | conventions.md §六 要求任务单与交付记录同移；本轮未移任务单 | 保持任务单在 `pending/`，由编排归档步骤统一搬运，避免与编排器抢写同一目录 |
| `engine_version=unknown` | 本批与 AF-086 两批同因 | 记 OI-06，不影响判定 |

遗留清单 OI-01 ~ OI-06 见证据 JSON `openItems`（OI-01 token 统计、OI-02 计数口径不自洽、OI-03 触发理由分布、OI-04 真实督导标注缺失、OI-05 1000 场批次未启动、OI-06 engine_version unknown）。

## 8. 闸门

- `tsc -p tsconfig.build.json --noEmit`（build 类型检查）→ exit 0，**0 error**。
- `pnpm lint`（eslint `{src,test,bin}/**/*.ts` + `scripts/**/*.{mjs,cjs}`）→ exit 0，**0 error 0 warning**。
- `vitest run test/engine-core/boundary.spec.ts` → exit 0，**1 文件 / 12 例全绿**。
- `pnpm test`（全量）→ exit 0，**207 文件 passed + 1 skipped（208）**、**3687 例 passed + 4 skipped（3691）**，耗时 27.20s。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空（本单未改任何 `src/` 文件）。

## 9. 产物

- `data/phase25-exit/af088-exit345-evidence-2026-11-18.json`（证据 JSON，镜像全部关键数字）
- `docs/worklog/completed/phase2.5/af088-phase25-exit345-evidence-2026-11-18.md`（本交付记录）
- `docs/worklog/pending/phase2.5-README.md` §3.2 表格 ③④⑤ 行 + §3.2.3
- `docs/team/agent-orchestration/transport/receipts/AF-088.json`（机读回执，编排收件箱）
- `docs/worklog/pending/relay-response-AF088-20261118-1630.md`（本轮回复全文）

## 10. 复现步骤（只读复核）

```powershell
# ① 批次与场次（只读）
node -e "const m=require('mysql2/promise');require('dotenv').config();(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [a]=await c.query('SELECT COUNT(*) s, SUM(turn_count) t FROM ap_practice_sessions');console.log(a);const [b]=await c.query('SELECT batch_id,total_sessions,total_turns,llm_call_ratio,fallback_ratio,valid FROM ap_practice_batches WHERE batch_id=?',['fztsntHxa5v6ikXrDsYgv']);console.log(b);await c.end();})()"

# ② 审议统计（只读）
node -e "const R=require('ioredis');require('dotenv').config();(async()=>{const r=new R({host:process.env.REDIS_HOST,port:+process.env.REDIS_PORT,password:process.env.REDIS_PASSWORD,db:+process.env.REDIS_DB});console.log(await r.hgetall((process.env.REDIS_KEY_PREFIX||'')+'deliberation_stats:global'));await r.quit();})()"

# ③ 闸门层决策分布（只读）
node -e "const m=require('mysql2/promise');require('dotenv').config();(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [g]=await c.query('SELECT mode,decision,reason,COUNT(*) c FROM gate_decisions WHERE session_id IN (?) GROUP BY mode,decision,reason',[['debug_X0f_QMDA7Iowbe7YkJn0_','debug_j1OiKNW04kkb7luVTD3XM','debug_1PLAcFKs6bvWHDdvIAQwR','debug_4_tbdvoZBY-jtZcvkjCn5']]);console.log(g);await c.end();})()"
```

成本复算（评审可手算）：

```
单次上界 = 3 × 0.0015 + 2.048 × 0.0045              = 0.013716 元
单场上界 = (45 / 92) × 50 × 0.013716                = 0.335446 元 ≤ 1 元
最坏情形 = 50 × 0.013716                            = 0.685800 元 ≤ 1 元
```
