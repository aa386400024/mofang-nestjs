# AF-086 · Phase 2.5 出口条件②真实 exam 双批次取证

- 任务单：`docs/worklog/pending/af086-phase25-exit2-real-exam-double-run-task-2026-11-18.md`
- 任务分支：`task/AF-086-af-086`
- 基线：`772f250f17a2fc7856f1bd094b07646f946d1123`（AF-085 merge SHA）
- 取证日期：2026-11-18
- 范围：`scripts/ops/quality/af086-exam-double-run.ts`、`docs/worklog/pending/phase2.5-README.md`、`docs/worklog/pending/`、`docs/worklog/completed/phase2.5/`、`data/batch-reports/`

## 1. 目标

用真实运行环境回答 Phase 2.5 出口条件②的核心问题：同一 exam 请求连续两次运行，是否稳定进入考核专用路径（`exam` → `rule_only` → 审议 LLM 零调用），并给出可判读的质量结论。

本单不新跑 LLM 之外的额外批次，不改 `.env`，不改 `src/engine-core`，不删除历史数据与队列任务。

## 2. 运行方式

- 本地服务：`node dist/app.js`，PORT `3100`，PID `17860`；进程级 env 显式补 `LLM_DEFAULT_CHAT_PROVIDER=minimax`、`AUTO_PRACTICE_COUNSELOR_MODEL=MiniMax-M3`、`LLM_REQUEST_TIMEOUT_MS=60000`、`LLM_MAX_RETRIES=1`、`AUTO_PRACTICE_WORKER_CONCURRENCY=4`；`.env` 未修改。
- MySQL `117.72.30.78:3306`、Redis `117.72.30.78:6379` 实测可达；真实 BullMQ worker 消费。
- 入口：生产 `POST /admin/api/auto-practice/batch`；两个批次同参数连续创建。
- 参数：`characterSlugs=['vpt_grief_avoidance_l1','vpt_workplace_intellectualization_l1']`、`counselorModeIds=['expert','cold']`、`maxTurns=12`、`repeats=3`、`scenarioType='exam'`；每批 12 场，两批共 24 场。

## 3. 批次与结果

| 批次 | 角色 | 场次 | 轮数 | 结束态 | 指纹 |
|---|---|---|---|---|---|
| `Sh4B_wbjF11IqFTcSqXYw`（基线） | 2 角色 × 2 模式 × 3 次 | 12/12 | 129 | 10 completed + 2 stagnant + 0 failed | `1caeea117101e8d9` |
| `UAKjJfAx5Iso9f4-054OJ`（候选） | 2 角色 × 2 模式 × 3 次 | 12/12 | 128 | 10 completed + 2 stagnant + 0 failed | `1caeea117101e8d9` |

### 3.1 场景与审议门禁

- 24/24 场逐字稿 `scenarioType=exam`。
- 24/24 场 `deliberation_mode=rule_only`。
- 257/257 条 `gate_decisions`：`mode=rule_only`、`decision=skip`、`reason=rule_only_skip`；审议 LLM 调用 0 次。
- 257 次 `llm_call_turns` 全部是咨询师/来访者渲染调用，不是审议调用（原脚本把“LLM 调用为 0”当硬判据，已改为“审议层为零、渲染调用仅记录”）。

### 3.2 指纹一致性

两批 `combined=1caeea117101e8d9`；4/4 组（2 角色 × 2 模式）的 `engineVersion/promptVersion/characterVersion/deliberationMode` 完全一致。

### 3.3 内容层差异

同角色/同模式的规则层策略序列一致 0/4、最终 BDI 一致 0/4。按 WP-B 口径「不追求逐字复现，只保证规则层确定性」，该差异记录为 informational，不作为出口②失败判据；同时它证明“同一 exam 两次运行”并不是逐字复制，不能对外宣称内容完全一致。

## 4. WP-K 正式判读

命令：

```powershell
corepack pnpm exec tsx bin/batch-report.ts --batch Sh4B_wbjF11IqFTcSqXYw --batch UAKjJfAx5Iso9f4-054OJ --baseline Sh4B_wbjF11IqFTcSqXYw --out data/batch-reports --format both --fail-on-regression
```

结果：exit 1。

- `[Sh4B_wbjF11IqFTcSqXYw] neutral (changed: none)`
- `[UAKjJfAx5Iso9f4-054OJ] regressed (changed: none)`
- 唯一回归项：`dim.trust.first_avg` 0.245 → 0.235（Δ=-0.010）。十进制恰好等于 `REGRESSION_TOL=0.01`，二进制差值略大于容差；AF-067 已把该浮点边界行为锁定为保守判定，不是本次新引入的缺陷。
- 同批改善项：`dim.trust.delta_avg` 0.09→0.104、`dim.valence.delta_avg` 0.025→0.0525、`session.zero_motion` 5→2。

### 4.1 intake

两批全局均 FAIL。

- `Sh4B`：`dim.safety.delta_avg=0.01375`（<0.015）；`session.zero_motion=5`（cold 6 场 total 4 / closure 0 / idle 4，expert 6 场 total 1 / closure 1 / idle 0）。
- `UAK`：`session.zero_motion=2`（expert 2/0/2）；`cold` 切片 `dim.trust.delta_avg=0.09`（候选阈值上限 0.08）。
- 分档：`cold` 切片 `Sh4B` PASS、`UAK` FAIL；`expert` 两批均 FAIL。

## 5. 正式判定

- **出口②（考核公平）**：规则层达标。24/24 exam、24/24 rule_only、257/257 rule_only_skip、4/4 指纹一致；内容层不一致按 WP-B 口径不作失败判据。
- **出口④（质量达标）**：未通过。正式 WP-K 原始结论为 `regressed`，且两批 intake 全局 FAIL；不能给出“质量达标”结论。
- **4 场预跑**：`sb_3bAy219pm8QALJWhIY` vs `n1K9jbjSNPjbiEYF4aG2E` 亦为 `regressed`（仅 `dim.valence` 两项回归、`trust` improved），已由 12×2 正式样本取代，不作正式判据。

## 6. 偏差与遗留

| 项 | 与任务单偏差 | 处置 |
|---|---|---|
| successCriteria「WP-K 不出现 regressed」 | 未满足；12×2 正式样本仍判 `regressed` | 不伪造 pass；按 WP-K 原始四态如实回写，出口④保持未通过 |
| 每批场次 | 任务单写 4 场；实际正式样本扩为 12 场 | 4 场样本太小，LLM 内容随机性会把单个指标放大为整批回归；扩样后判读更稳，已记录 |
| `.env` | 未改；用进程级 env 补 MiniMax 默认 provider | 服务重启后需重新注入，属运行态约束，不写回仓库 |
| `ap_practice_sessions` 无 `scenario_type` 列 | 无法直接按列筛 exam | 用逐字稿 JSON 的 `scenarioType` + `deliberation_mode` 间接证明；补列另行评估 |
| WP-K 容差边界 | 十进制“恰好 0.01”会因二进制差值略超而判 movement | AF-067 已锁定为保守判定；是否改为 epsilon 容差需产品/质量口径拍板，未在本单改源码 |
| 停滞场次 | 两批各 2 场 `stagnant` | 属真实运行结果，保留；不删除、不改写 |

## 7. 闸门

- 定向：`corepack pnpm exec vitest run test/auto-practice/regression-evaluator-boundary.spec.ts test/auto-practice/wp-k-regression-evaluator.spec.ts` → exit 0，2 files / 39 tests passed。
- `corepack pnpm lint` → exit 0，0 error 0 warning。
- `corepack pnpm typecheck` → exit 0，0 error。
- `corepack pnpm test` → exit 0，207 files passed + 1 skipped，3686 tests passed + 5 skipped。
- `node scripts/orchestration/cli.mjs validate` → exit 0，0 FAIL；`events verify` → exit 0，366 条事件一致。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空。

## 8. 产物

- `scripts/ops/quality/af086-exam-double-run.ts`
- `data/batch-reports/af086-exam-double-run-2026-11-18.json`
- `data/batch-reports/Sh4B_wbjF11IqFTcSqXYw.json` / `.md`
- `data/batch-reports/UAKjJfAx5Iso9f4-054OJ.json` / `.md`
- `data/batch-reports/sb_3bAy219pm8QALJWhIY.json` / `.md`
- `data/batch-reports/n1K9jbjSNPjbiEYF4aG2E.json` / `.md`
- `docs/worklog/pending/phase2.5-README.md` §3.2 / §3.2.2
