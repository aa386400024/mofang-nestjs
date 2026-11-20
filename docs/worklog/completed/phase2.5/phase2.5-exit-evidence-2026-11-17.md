# AF-060 · Phase2.5 出口条件取证基线重定与 8 场失败归因（纯验证）

> 状态：✅ 已交付（2026-11-17）
> 任务标识：`AF-060` / `phase2.5-export-evidence` / baseline `66c186f7176ffaac010113eabdaae50566bd7566`
> 任务性质：纯验证；不新跑 LLM 批次、不改业务源码、不写数据库
> 交付结论：**出口 ④ 未通过；当前也不具备给出“质量达标”正式判定的数据基础。**
> 相关入口：[Phase2.5 工作入口](../../pending/phase2.5-README.md) · [WP 登记表](../../pending/phase2.5-wp-list-2026-11-08.md)

---

## 0. 结论（先看这段）

1. **旧 96 场批次 `g3ONzlqSGMVJqkFMF9Lwh` 不能作为当前出口 ④ 证据。**
   当前远程库 `ap_practice_sessions` 中该批次场次计数为 **0**；`ap_practice_batches` 只剩 `uJHgP8uQGeM8Z6HbZY7M5` 一行。旧报告仍存在于 git HEAD，只能作历史引用。

2. **历史 96 场的质量结论不是“待判读”，而是 intake 未全过。**
   历史交付记录明确写：**管道门禁 3/3 全过、intake-v1 6/8 未全过**；`safety Δ=0.012365`（低于 0.015 下限）、`zero_motion=38`。因此它可作“渲染链路可信”证据，不可作“临床状态达标”证据。

3. **当前唯一 8 场批次 `uJHgP8uQGeM8Z6HbZY7M5` intake 全局 FAIL。**
   8 场 / 94 轮，`safety Δ=0.0065` 低于 0.015；`zero_motion=1` 且 `closure=0 / idle=1`。`expert` 4 场 `safety Δ=0.0095` 全档偏弱；`cold` 4 场 `safety Δ=0.0035`，其中 workplace/cold 一场纯 neutral 空转。

4. **WP-K 不能产出正式四态。**
   当前库只有一批，`--batch uJ...` 只输出单批快照；`--batch g3...` 因库内无行，CLI 实际 **exit 0 且只生成空 `index.md`**（与其“数据不可用 exit 2”的契约不符，已登记遗留）。用归档 96 快照与当前 8 场做诊断比较，`evaluateRegression` 返回 **`incomparable`**：acceptance 不同、characterSlug 集合不同、7 个指纹段变化。不存在 improved / neutral / regressed。

5. **出口 ④ 的 80% 准确率仍不可评测。**
   `data/eval-datasets/` 下只有 `synthetic-supervisor-v1`（8 场 / 59 轮）与 `synthetic-train-v1`（5 场 / 40 轮），均 `synthetic: true`；没有真实督导结构化 `dataset.json`。`docs/reference/psych-cases/` 的 Markdown 案例卡不能直接被 `loadEvalDatasetFromDirectory()` 消费。

**正式判定：出口 ④ = 未通过 / 核心指标不可判；不得写成“质量达标”。**

### 0.1 验收返修记录

AF-060 首轮 `run-once` 的机读验收为 `rejected`，原因不是取证内容失败，而是交付记录顶部两个相对链接按 `docs/worklog/completed/phase2.5/` 解析后指向不存在的 `phase2.5-README.md` 与 `phase2.5-wp-list-2026-11-08.md`。AF-061 以独立任务承接，仅把两处链接改为 `../../pending/...` 并重新跑验收：`run-once` 结论 `completed`（V4 断链归零、`autoVerdict=passed`），事件链 249 条；AF-060 的数字、结论与 `rejected` 终态均不改写。

---

## 1. 落地与改动文件

| 文件                                                                         | 动作 | 用途                                                    |
| ---------------------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| `docs/worklog/pending/af060-phase25-exit-evidence-task-2026-11-17.md`        | 新增 | AF-060 任务单与验收边界                                 |
| `docs/worklog/pending/phase2.5-README.md`                                    | 修改 | 顶部状态行、§3.2 出口表与 3.2.1 取证数字、§3.3 历史边界 |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`                        | 修改 | 顶部状态、最近核对日期、§三 出口条件对照                |
| `docs/worklog/README.md`                                                     | 修改 | Phase2.5 导航与 AF-060 交付入口                         |
| `docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md`       | 新增 | 本交付记录                                              |
| `docs/team/agent-orchestration/transport/receipts/AF-060.json`               | 新增 | 机读回执（gitignored）                                  |
| `docs/worklog/pending/archive/AF-060-receipt-RC-AF-060-1.json`               | 新增 | AF-060 回执 durable 副本（首轮 rejected）               |
| `docs/worklog/pending/af061-phase25-exit-evidence-rework-task-2026-11-17.md` | 新增 | AF-061 断链返修任务单                                   |
| `docs/worklog/pending/archive/AF-061-receipt-RC-AF-061-1.json`               | 新增 | AF-061 回执 durable 副本（completed）                   |

未修改：`src/`、`test/`、`scripts/`、`bin/`、数据库、`.env`、`admin-dashboard/`、`data/batch-reports/` 既有文件与并行产物。

---

## 2. 取证证据

### 2.1 数据库与批次基线

| 项                                            | 实测                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `ap_practice_batches` 行数                    | 1（`uJHgP8uQGeM8Z6HbZY7M5`）                                               |
| 旧批次 `g3ONzlqSGMVJqkFMF9Lwh` 场次           | `ap_practice_sessions` 计数 **0**                                          |
| 当前批次规模                                  | **8 场 / 94 轮 / 4 角色 / 2 模式**                                         |
| `created_at`                                  | `2026-11-17T08:36:28Z`                                                     |
| `engine_version`                              | `v2026.11.16-6cfb46e-59-ga27aba5-dirty`                                    |
| 当前 HEAD describe                            | `v2026.11.16-6cfb46e-67-g66c186f-dirty`（批次落后 8 个提交）               |
| `prompt_version` / `config_fingerprint`       | `6eac9ac361d55741` / `1caeea117101e8d9`                                    |
| `valid` / `llm_call_ratio` / `fallback_ratio` | `1` / `1.0000` / `0.0000`                                                  |
| 场次级 `deliberation_mode`                    | `rule_only` 8/8                                                            |
| 该批 `gate_decisions`                         | 94 行，全部 `rule_only` / `rule_only_skip`                                 |
| 渲染用量                                      | 94 个 `llm_call_turns`，116,033 tokens，0.182277 元，`cost_basis=full` 8/8 |

说明：`llm_call_ratio=1.0` 只证明渲染链路在调用 LLM；`deliberation_mode=rule_only` 与 `gate_decisions` 证明**审议侧 0 调用**。两者不能混为一谈。

### 2.2 WP-K CLI 实测

| 命令                                                                                         | exit  | 产物                             | 结论                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsx bin/batch-report.ts --batch uJHgP8uQGeM8Z6HbZY7M5 --format both --out <TEMP>` | 0     | `uJ...json` / `.md` / `index.md` | 8/8 覆盖、94 轮；与仓库既有 `data/batch-reports/uJ...json` 的 `metrics`、`fingerprint`、`coverage`、`zeroMotionBreakdown`、`lineage` 逐项一致 |
| `pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --format both --out <TEMP>` | **0** | 仅空 `index.md`，无 g3 快照      | **缺陷**：无库内批次时应报数据不可用（契约 exit 2），实际 exit 0；单看退出码会误判“有报告”                                                    |

**四态可得性：** 当前库只有一批，WP-K 的比较循环不执行，正式 CLI 输出中没有 `improved / neutral / regressed / incomparable`。旧 96 批无法从库内重建，因此不能产出正式四态。

**诊断性比较（非正式出口结论）：** 读取 git HEAD 的 96 场历史快照作为 base、当前 8 场快照作为 candidate，调用当前源码 `evaluateRegression`：

```json
{
  "verdict": "incomparable",
  "reasons": ["两批验收判据 (acceptance) 不同", "两批 characterSlug 集合不同"],
  "changedSegments": ["stateTransition", "alliance", "deltaTableConfig", "lexicon", "baselines", "prompts", "acceptance"]
}
```

该结果的语义是“两批不是同一类东西，拒绝硬比”，**不是质量相等、也不是中性**。

### 2.3 8 场逐场归因

| debug session                 | 角色       | 模式   | 轮数 | safety 首→末 |         Δ | 事件层                                        |
| ----------------------------- | ---------- | ------ | ---: | ------------ | --------: | --------------------------------------------- |
| `debug_tmGHUksuTp6lt7VA-eGoA` | grief      | expert |   10 | 0.25→0.26    |    +0.010 | 9 neutral / 1 empathy                         |
| `debug_iQdEiybfOsejPIgOgifsC` | intimate   | cold   |   12 | 0.35→0.364   |    +0.014 | 11 neutral / 1 empathy                        |
| `debug_zf3g3RMbU3kIi50y3ybp5` | self_worth | expert |   12 | 0.35→0.354   |    +0.004 | 10 neutral / 1 acceptance / 1 sensitive_touch |
| `debug_J6eFPNjHHYyVPxbZgAVzV` | workplace  | expert |   12 | 0.25→0.26    |    +0.010 | 11 neutral / 1 empathy                        |
| `debug_1392qCzzcGuyOM_laopxB` | workplace  | cold   |   12 | 0.25→0.25    | **0.000** | **12 neutral；零变化**                        |
| `debug_uOrLgLweDx3VlGlpMMAF1` | intimate   | expert |   12 | 0.35→0.364   |    +0.014 | 11 neutral / 1 empathy                        |
| `debug_fciae8D7jPecUVExrHZee` | grief      | cold   |   12 | 0.25→0.26    |    +0.010 | 11 neutral / 1 empathy                        |
| `debug_wKOBrhUHJKnXTKg49lE4r` | self_worth | cold   |   12 | 0.35→0.340   |    −0.010 | 11 neutral / 1 sensitive_touch                |

- `expert` 4 场：0.010 / 0.004 / 0.010 / 0.014，均值 **0.0095**；**四场全部低于 0.015**，不是单场离群，而是 expert 档整体偏弱。
- `cold` 4 场：0.014 / 0.000 / 0.010 / −0.010，均值 **0.0035**。
- 全局事件：`neutral=86/94（91.49%）`、`positive=6/94（6.38%）`、`exploration=0`、`holding_present=0`、`open_probe=0`、`recounting=56.38%`、`resistance=25.53%`。短会话内的正向事件密度不足以支撑 0.015 的安全增益。

### 2.4 zero_motion 归因

`session.zero_motion` 的唯一样本是 `debug_1392qCzzcGuyOM_laopxB`：

- 角色 `vpt_workplace_intellectualization_l1` / 模式 `cold` / 12 轮；
- BDI 八维首末完全不变，`totalMotion=0`；
- 12/12 轮 `intention.strategy=resistance`，`eventTags` 全为 `neutral`；
- `crisis.detected=false`，`degraded=false`；
- `zeroMotionBreakdown = { total: 1, closure: 0, idle: 1 }`。

按 `computeZeroMotionBreakdown()` 的语义：`closure` 需事件层存在非 neutral 事件（合理封闭可豁免）；本场全程纯 neutral，因此正确计入 **idle**，不是合理封闭。这是本批 `session.zero_motion` FAIL 的直接来源。

### 2.5 出口条件矩阵（取证结论）

| 出口       | 证据                                                                                                                                                                                                                                                         | 判定                       | 缺口类型                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------- |
| ① 合规过线 | WP-A 入参零原文 + 三道风险闸门；本批 94 轮无 crisis 触发                                                                                                                                                                                                     | ✅ 代码口径保持            | 运行证据少（本批无高风险轮）                   |
| ② 考核公平 | G-1 保证 `exam` 恒 `rule_only`；`auto-practice.controller.ts` 的 `BatchBody` 无 `scenarioType`，`enqueueBatch()` 只传 `characterSlug/counselorModeId/maxTurns/batchId`；下游 `practice-runner.service.ts` 与 `turn-engine.port.ts` 已支持可选 `scenarioType` | 🚧 部分达标                | 批次入口/队列透传；无生产 HTTP exam 入口       |
| ③ 成本可控 | 8/8 `rule_only`；94 行 `rule_only_skip`；审议 0 调用；`ENGINE_DELIBERATION_ENABLED` 与 `ENGINE_DELIBERATION_EFFECTIVE_MODE` 均未配；渲染 116,033 tokens / 0.182277 元，`cost_basis=full`                                                                     | ❌ 无审议成本证据          | 外部配置 + 需另跑 shadow 小批；50 分钟长会未测 |
| ④ 质量达标 | 旧 96 批库内 0；历史 intake 6/8；当前 8 场 intake FAIL；诊断比较 `incomparable`；无真实督导 `dataset.json`                                                                                                                                                   | ❌ 未通过 / 核心指标不可判 | 数据缺失 + 评测集未转换                        |
| ⑤ 数据积累 | 当前 8 场 / 94 轮；1000+ 目标未达；旧 96 场不在库                                                                                                                                                                                                            | ❌ 未达标                  | 批次规模与环境重置                             |

### 2.6 出口 ④ 专项：为什么 80% 不能跑

- `loadEvalDatasetFromDirectory()` 只读目录下的 `dataset.json`，结构要求 `sessions[]`，每轮含 `before / after / events / riskLevel / ruleDelta / llmDelta / gateDecision` 等结构化字段。
- 现有两个数据集均为合成：
  - `synthetic-supervisor-v1`：8 场 / 59 轮，`synthetic: true`；
  - `synthetic-train-v1`：5 场 / 40 轮，`synthetic: true`。
- `docs/reference/psych-cases/` 实点 **12 份**非 skeleton Markdown 案例卡（不含 `inventory.md`）；`psych-corpus-README.md` 记 **11 个案例 / 484 轮 / 332 条 SFT**（gold 151 / borderline 59 / bad 9），存在 11 vs 12 的口径漂移，需另核。
- 这些案例卡是逐轮 Markdown 标注，不是 `dataset.json`；`parseSupervisorCases()` 也需要专门的 `EvalSupervisorCaseFile` 结构，不能直接吃 Markdown。因此“真实督导验收集 → 结构化 dataset”的转换尚未完成，80% 准确率没有可执行输入。

---

## 3. 闸门证据

| 闸门      | 命令                                                     | exit | 结果                                                |
| --------- | -------------------------------------------------------- | ---: | --------------------------------------------------- |
| 类型      | `pnpm typecheck`                                         |    0 | 0 error                                             |
| Lint      | `pnpm lint`                                              |    0 | 0 error / 0 warning                                 |
| 内核边界  | `pnpm exec vitest run test/engine-core/boundary.spec.ts` |    0 | 1 file passed / 12 tests passed / 0 failed（1.65s） |
| 状态链    | `node scripts/orchestration/cli.mjs events verify`       |    0 | 242 条；schema + 哈希链 + 索引投影一致              |
| 范围      | `git diff --cached --name-only`                          |    — | 仅 5 个本单文档；并行产物未暂存                     |
| 内核 diff | `git diff --stat HEAD -- src/engine-core`                |    — | 空                                                  |

环境提示：`pnpm` 报 `Unsupported engine: wanted node >=26, current v22.23.2`，与本单无关；闸门仍 exit 0。

---

## 4. 范围与契约

- **scopeCheck**：`in-scope`。本单只改 `docs/worklog/` 与任务单/回执；未改 `src/`、`test/`、`scripts/`、`bin/`、数据库、`.env`、`admin-dashboard/`。
- **parallelArtifactsExcluded**：`admin-dashboard/pnpm-lock.yaml`、`data/batch-reports/**` 的旧文件删除与 `index.md` 修改、`web/orchestration/data.js`、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 均为并行产物，未暂存、未还原。
- **contractChecks**：
  - `taskId=AF-060` 贯穿任务单、交付记录、回执；
  - 状态面只经 CLI 写入；
  - 任务单 schema 已含 `gates[*].threshold`；
  - 交付记录、回执、`archive` durable 副本路径一致。
- **口径真相源**：出口条件以 `phase2.5-README.md` §1 与 WP 登记表为准；批次指标以 `data/batch-reports/uJ...json` 与数据库 `ap_practice_batches` 为准；四态语义以 `src/auto-practice/metrics/regression-evaluator.ts` 为准。本单不另造阈值。

---

## 5. 遗留与建议

### 5.1 必须另立任务（按优先级）

1. **WP-K CLI 缺失批次应失败（高）**：`bin/batch-report.ts` 在 `--batch <id>` 无库内行时 `exit 0` 并写空 `index.md`，会制造 false-green；应改为 `exit 2` 或显式“0 匹配即失败”。建议 `type: fix`，补负向用例。
2. **出口 ② 批次入口透传 `scenarioType`（高）**：`BatchBody` 增加可选 `scenarioType`，`enqueueBatch()` 传入 queue，补生产 HTTP + `exam` 两次跑一致性端到端证据。
3. **真实督导案例卡 → WP-E `dataset.json` 转换（高）**：先核对 11 vs 12 份案例卡口径，再写离线转换器与 schema 校验；没有这一步，出口 ④ 的 80% 永远无法正式评测。
4. **审议成本小批取证（中）**：配置 `ENGINE_DELIBERATION_ENABLED=true` + `ENGINE_DELIBERATION_EFFECTIVE_MODE=shadow`，用当前 8 场或小批跑触发频次 / 单场审议成本；50 分钟长会需单独样本。
5. **新一轮可比批次（中）**：当前 8 场 batch 落后 HEAD 8 个提交、4 角色 × 2 模式 × 1 次；需要固定 HEAD、8 角色 × 2 模式 × 6 次（96 场）或经批准的新口径，且 baseline/candidate 同时存在才能产四态。

### 5.2 已知口径问题

- `psych-corpus-README.md` 记 11 个案例，目录实点 12 份非 skeleton 卡；不影响“真实结构化 dataset 不存在”的结论，但需在转换任务中先对齐。
- 旧 96 场历史报告仍在 git HEAD；工作树删除是环境重置并行状态，本单未还原、未提交。
- 当前 8 场 `engine_version` 为 `...-59-ga27aba5-dirty`，当前 HEAD 为 `...-67-g66c186f-dirty`；即使不看规模，它也不是当前代码的干净验证批次。

---

## 6. 偏差表

| 原计划                                   | 实际                                               | 原因                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 先用 `bin/dev-up.ps1` 起本地 MySQL/Redis | 未执行                                             | 脚本真实行为是检查远程 MySQL/Redis、交互式询问 migration、再 `npm run start:dev`；本地 3306/6379 未监听，直接使用已可达远程库做只读取证 |
| 对 96 场跑 WP-K 四态                     | 只跑单批 + 诊断 `incomparable`                     | 旧批库内 0 场，无 baseline；不伪造四态                                                                                                  |
| 以 96 场作为出口 ④ 判据                  | 降级为历史引用                                     | 数据已清空；历史记录本身 intake 6/8 未全过                                                                                              |
| 只回写 §3.2                              | 同时回写顶部状态、§3.3 边界、wp-list、worklog 导航 | 这些位置仍写“96 场待判读”，不改会与 §3.2 冲突                                                                                           |
| 闸门跑定向 tsc/lint/boundary             | 已执行                                             | 与任务单一致；未跑全量测试                                                                                                              |

---

## 7. 机读回执字段（验收机读标记）

- `gateResults`: 见 §3 与回执；typecheck / lint / boundary / events verify / preflight 全 exit 0。
- `scopeCheck`: `in-scope`；只改 `docs/worklog/`，无源码、数据、环境改动。
- `contractChecks`: taskId / state-write / index-schema / event-chain 四项通过；任务单 gates 阈值齐全。
- `backlogItems`: WP-K 缺批 false-green、出口② scenarioType 透传、真实案例卡转 dataset、审议成本小批、可比批次五项。
- `deviationTable`: 见 §6 五项偏差。
- `reviewVerdict`: `passed`；理由见 §8。

## 8. 结论

- `finalStatus`: `completed`
- `reviewVerdict`: `passed`
- `verdictRationale`: 取证链完整、数字双源可复算、旧批不可用与 8 场 FAIL 均已定位；四态不可得已以 `incomparable` 证据化，没有伪造质量结论。WP-K 缺失批次 false-green 已登记为高优先级遗留，另立任务修复。

> 正式对外口径：**Phase2.5 出口 ④ 未通过；质量达标结论暂不可给。** 下一步不是“再判读旧 96 场”，而是先修 WP-K 负向门、补真实评测集、再跑可比批次。
