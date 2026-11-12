# Phase2.5 · 96 场级验证批次 · 交付记录

- 日期：2026-11-12（跑批 12:20 ~ 12:58 GMT+8，报告与闸门 12:58 ~ 13:08）
- 批次 id：`g3ONzlqSGMVJqkFMF9Lwh`
- 代码版本：`9f23166`（分支 `integrate`；`engine_version` 96/96 场一致，无 `-dirty`）
- prompt 版本：`ed0430680b4c8837`（96/96 场一致）
- 任务单：[批次规格单](phase2.5-verification-batch-96-spec-2026-11-12.md)
- 验证人：MiniMax Code（结对 AI）

---

## 0. 结论

**管道健康门禁 3/3 全过、覆盖 96/96 且 skipped=0；但 intake-v1 临床判据 8 条中 2 条未达标。本批可作为"渲染链路可信"的证据，不可作为"临床状态达标"的证据。**

| 验收项                              | 阈值               | 实测                                                                    | 判定          |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------- | ------------- |
| `llm_call_ratio`                    | ≥ 0.9              | **1.0**（96/96 场有真实 LLM 调用）                                      | ✅ 通过       |
| `render_fallback_ratio`（批次均值） | < 0.05             | **0.0**（1112 轮兜底 0 轮）                                             | ✅ 通过       |
| `counter_consistency`               | 100%               | **100%**（`degraded_turns` 全场合计 0，`degraded ≤ turn_count` 全满足） | ✅ 通过       |
| 覆盖                                | 96/96，skipped = 0 | **96/96，skipped = 0**（1112 轮）                                       | ✅ 通过       |
| 场次失败                            | 0                  | **0**（91 completed + 5 crisis_ended，0 failed）                        | ✅ 通过       |
| intake-v1 8 条判据                  | 全过               | **6 / 8 通过**（safety Δ、zero_motion 未达标）                          | ⚠️ **未全过** |

未达标两条（均为**临床口径**，非管道故障）：

| 判据                   | 实测     | 要求                                 | 归因                                                            |
| ---------------------- | -------- | ------------------------------------ | --------------------------------------------------------------- |
| `dim.safety.delta_avg` | 0.012365 | ≥ 0.02（tol 0.005 → 实际下限 0.015） | 全 8 角色系统性偏低；`cold` 模式切片仅 0.003479                 |
| `session.zero_motion`  | **38**   | 必须为 0                             | 38 场全程八维零变化，其中 `cold` 模式 31 场、`expert` 模式 7 场 |

**门禁三项未触发停批条件**（`llm_call_ratio` 不低、兜底未超阈），因此按规格 §7 不停批、不补跑；上述两条登记 backlog，见 §9。

---

## 1. 规格单 ↔ 源码复核（动手前逐条回读）

规格单的每一处断言都回读源码核对过，**未发现规格单与源码不符**。逐条结论：

| 规格单断言                                                                                 | 源码位置                                                              | 复核结果                                                                                                                |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 端点 `POST /admin/api/auto-practice/batch`                                                 | `src/auto-practice/auto-practice.controller.ts:132`                   | ✅ 一致。`@Controller('admin/api/auto-practice')` + `@Post('batch')`；`src/app.ts` **无全局前缀**，实际路径即规格单所写 |
| body 字段 `characterSlugs/counselorModeIds/maxTurns/repeats`                               | 同上 `BatchBody`                                                      | ✅ 一致。`maxTurns ?? 15` → 本批显式传 12，未落缺省                                                                     |
| `GET /admin/api/auto-practice/batches/:id` 返回 `batchHealth.valid` / `warning` / 逐场清单 | controller `:218` + `practice-batch-health.service.ts:223`            | ✅ 一致。判定为**读时算**，中途即可见本批是否已废                                                                       |
| 场次清单 `GET /admin/api/auto-practice/sessions?batchId=`                                  | controller `:165`                                                     | ✅ 一致（分页，`pageSize` 上限 100）                                                                                    |
| 队列并发缺省 2、区间 1–5                                                                   | `practice-queue.service.ts:56-88`                                     | ✅ 一致。env 未配 → `resolveAutoPracticeConcurrency(undefined)` = 2，**不触发夹取告警**                                 |
| 8 个角色 slug（`templateId` 为唯一真相源）                                                 | `character-baseline-calibration.ts:189`                               | ✅ 一致。8 个 `templateId` 与规格单 §2.1 **逐字相同、顺序相同**                                                         |
| 门禁三项阈值 0.9 / 0.05 / 100%                                                             | `practice-batch-health.service.ts:33-36,223`                          | ✅ 一致。`render_fallback_ratio` 取**批次均值**（逐场 ratio 的均值，null 不计入分母），与规格单口径一致                 |
| intake-v1 8 条判据                                                                         | `metrics/acceptance-thresholds.ts:44`                                 | ✅ 一致。8 条与规格单 §5.2 逐条对齐；`exploration.rate` 确实**不在**表内                                                |
| 报告 CLI 参数与退出码                                                                      | `bin/batch-report.ts:36-121`                                          | ✅ 一致（0/1/2/3）                                                                                                      |
| basic auth 旁路                                                                            | `admin-basic-auth.middleware.ts:97` + `guards/admin-role.guard.ts:85` | ✅ 一致。凭据正确 → `adminBasicAuth = true` → 守卫直接放行，不查 DB 角色                                                |

### 1.1 复核中发现的坑与风险（动手前已识别，并逐条在执行中处置）

| #   | 风险                                                                                      | 实际影响                                            | 处置                                                               |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| R1  | **失败场次会被 coverage 判为 skipped**：`projectTraces` 对空 `traces` 记 `no_traces` 跳过 | 任一场失败 → `skippedSessions > 0` → 覆盖不足 96/96 | 本批 0 失败，未触发。**这是"覆盖 96/96"最脆弱的一环**              |
| R2  | `prune()` 按创建时间保留最近 500 份逐字稿                                                 | 91 + 96 = 187 < 500，本批**不会**发生淘汰           | 仍按规格 §4.1 先归档 91 份（隔离 + 留证）                          |
| R3  | 批次接口不暴露 `scenarioType`，默认 `full_simulation`                                     | 无法跑 exam 场景（规格 §8.3 已登记）                | 本批走默认场景，符合规格                                           |
| R4  | 单候选 provider（无 `ENGINE_RENDER_FALLBACK_PROVIDERS`）                                  | 上游限流即全损降级                                  | 本批兜底 0 轮，未触发；缺口仍登记 backlog                          |
| R5  | **`git diff --stat HEAD -- src/engine-core` 必须在交付时为空**                            | —                                                   | 交付时复核为空 ✅                                                  |
| R6  | 规格单 §3.1 记「逐字稿存量 106 个」，实际 **91 个**                                       | 数字对不上                                          | 规格单自注「发起时以实际计数为准」→ 以实际 91 为准，已在本记录留痕 |
| R7  | **DB 落库指纹与 CLI 报告指纹按设计永不相等**                                              | 见 §4.3                                             | 已在 §4.3 逐段举证，非代码漂移                                     |

---

## 2. 前置（规格 §4.1）

### 2.1 归档存量逐字稿

```
data/debug-sessions/*.json  →  data/archives/debug-sessions-pre96-2026-11-12/
BEFORE_COUNT=91  →  AFTER_PRIMARY=0  ARCHIVED=91
```

沿用仓库既有归档目录命名（`debug-sessions-<label>`），与 `data/archives/` 下 5 个既有批次目录一致。归入子目录（而非散在 `data/archives/` 根）还有一层作用：`BatchMetricsService.buildArchiveIndex()` 只扫子目录，放子目录才能让归档文件进入回退索引。

### 2.2 健康检查

| 项                                | 结果                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3000 端口（Nest）                 | ✅ LISTENING，`GET /health` → 200 `{"status":"ok","database":{"status":"up","responseTime":56},"redis":{"status":"up"}}`                                                                                                                            |
| 5174 端口（admin-dashboard vite） | ✅ LISTENING（PID 11044）                                                                                                                                                                                                                           |
| 3000 进程                         | PID 14700 `node --enable-source-maps dist/app`，启动 12:05:46；`dist/app.js` 构建于 11:55:51                                                                                                                                                        |
| 代码一致性                        | `git status` 当时仅 1 个未跟踪文件（规格单）；`src` 最新 mtime 2026-11-12 02:19:34 **早于** 构建时间 → **跑的就是当前源码**（沿用金丝雀 §2 的"三件事比对"纪律）                                                                                     |
| provider 注册 + 连通性            | 直接探针：`POST https://api.minimax.cn/v1/chat/completions`（模型 `MiniMax-M3.1-Flash`）→ **HTTP 200，1705 ms**；`usage` 回报 `prompt_tokens=203` / `completion_tokens=26`（含 `reasoning_tokens=22`）→ **输入侧用量上报正常，成本口径可升 `full`** |
| `src/engine-core` diff            | 空 ✅                                                                                                                                                                                                                                               |

### 2.3 跑批前环境事实（逐项核对）

| env 键                                                         | 实际         | 影响                                                                       |
| -------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `AUTO_PRACTICE_WORKER_CONCURRENCY`                             | **未配**     | 缺省 2，不夹取、不重启 ✅（规格 §2 拍板值）                                |
| `ENGINE_RENDER_FALLBACK_PROVIDERS`                             | **未配**     | 单候选 `minimax`；`ENGINE_RENDER_REQUIRE_FAILOVER` 亦未配 → 只告警不拦启动 |
| `ENGINE_RENDER_PRIMARY_PROVIDER` / `LLM_DEFAULT_CHAT_PROVIDER` | 均 `minimax` | 与规格一致                                                                 |
| `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASS`              | 已配         | basic 凭据旁路可用（**全程未打印、未落文档**）                             |
| `ADMIN_DEBUG_SESSION_DIR`                                      | 未配         | 逐字稿落 `data/debug-sessions` ✅                                          |
| `ENGINE_DELIBERATION_ENABLED`                                  | **未配**     | → 审议总开关关 → 模式折叠为 `rule_only` → **本批审议调用 = 0**，见 §8      |

---

## 3. 入队与跑批（规格 §4.2 / §4.3）

### 3.1 入队

```
POST /admin/api/auto-practice/batch   （basic auth）
{"characterSlugs":[8 个], "counselorModeIds":["expert","cold"], "maxTurns":12, "repeats":6}
→ 201 {"batchId":"g3ONzlqSGMVJqkFMF9Lwh","enqueued":96}
```

入队前逐项核过可解析性（否则会静默少场）：8 个 slug 在 `character_profiles` **全部存在、`enabled=1`、`audit_status=approved`**；`expert` / `cold` 在 `ap_counselor_modes` **均 `enabled=1`**。

### 3.2 跑批事实

| 项          | 值                                                                                  |
| ----------- | ----------------------------------------------------------------------------------- |
| 场次矩阵    | 16 格（8 角色 × 2 模式）× 6 重复 = **96**，实测每格恰好 6 场                        |
| 状态分布    | completed **91** / crisis_ended **5** / failed **0** / stagnant **0**               |
| 退出原因    | `max_turns` 80 / `natural_close` 6 / `crisis_practice_max` 5 / `crisis_escalated` 5 |
| 总轮数      | **1112**（均 11.58 轮，最少 5，最多 12）                                            |
| 单场耗时    | 均 **44.3 s**，最长 238 s（并发 2 → 整批墙钟约 37 min）                             |
| tokens      | **1,343,111**（均 13,991 / 场，1,208 / 轮）                                         |
| 成本        | **2.125480 元**（expert 1.078593 + cold 1.046887；单场 0.007689 ~ 0.025767 元）     |
| 成本口径    | **`cost_basis = full`**（96/96 场；`prompt_tokens` 已穿透）                         |
| 兜底 / 降级 | 渲染兜底 **0** 轮；`degraded_turns` **0**（两侧均 0）                               |
| 版本一致性  | `engine_version=9f23166`、`prompt_version=ed0430680b4c8837`，**96/96 场完全一致**   |

### 3.3 门禁结论（端点读时判定 + 库内固化）

`GET /admin/api/auto-practice/batches/g3ONzlqSGMVJqkFMF9Lwh` 返回：

```json
{
  "total": 96,
  "byStatus": { "completed": 91, "crisis_ended": 5 },
  "metrics": {
    "totalTurns": 1112,
    "renderFallbackTurns": 0,
    "llmCallTurns": 1112,
    "renderFallbackRatio": 0,
    "renderFallbackRatioWeighted": 0,
    "llmCallRatio": 1,
    "degradedTurns": 0,
    "counselorDegradedTurns": 0,
    "visitorDegradedTurns": 0,
    "counterConsistent": true
  },
  "batchHealth": { "valid": true, "flags": [], "llmCallRatio": 1, "fallbackRatio": 0, "counterConsistent": true, "totalSessions": 96 }
}
```

`valid = true`、`flags = []`、**响应体不含 `warning` 键**（controller 仅在 invalid 时附加）→ 三项门禁全过。

库内固化行（`ap_practice_batches`）：`valid=1`、`validity_flags=NULL`、`total_sessions=96`、`total_turns=1112`、`llm_call_turns=1112`、`llm_call_ratio=1.0000`、`fallback_ratio=0.0000`、`counter_consistent=1`、`metrics_json` 长度 47,763 字节，`updated_at=2026-11-12T04:57:58Z`（**末场收尾后 5 秒**）。

---

## 4. 报告 CLI（规格 §4.4）

```
pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --out data/batch-reports
→ EXIT_CODE_A=0

pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --batch p1d-r3-intake-2026-11-11 --strict --out data/batch-reports
→ EXIT_CODE_B=0
→ stderr: [p1d-r3-intake-2026-11-11] incomparable: 两批 counselorModeId 集合不同
```

- 产物：`data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json`（快照 v1）+ `.md`（可读报告）。
- `--strict` 未返回 2 → 覆盖率 96/96 ≥ 0.9 通过。
- 跨批对比判 `incomparable`，原因 = **两批咨询师模式集合不同**（本批 expert+cold，基线 p1d-r3 为另一组），**与规格 §4.4 预期一致**；跨版本回归对比需同指纹批次，本批不具备该条件。

### 4.1 快照要点

- 指纹 combined `491558624aeafdb3`；覆盖 `expectedSessions=96 / includedSessions=96 / skippedSessions=0 / skipReasons={} / totalTurns=1112`
- `pipeline.llm_call_ratio=1`、`pipeline.fallback_ratio=0`
- `session.outcome.completed=91`、`crisis_ended=5`、`stagnant=0`、`failed=0`
- `exploration.rate=0.125`（12/96 场）
- `event.positive.rate=0.0989`；`event.neutral.rate=0.8939`

### 4.2 intake-v1 逐条判定（8 条）

| #   | 判据                     | 实测         | 区间                                  | 判定     |
| --- | ------------------------ | ------------ | ------------------------------------- | -------- |
| 1   | `dim.trust.delta_avg`    | 0.084125     | 0.05 ~ 0.20                           | ✅       |
| 2   | `dim.safety.delta_avg`   | **0.012365** | 0.02 ~ 0.06（tol 0.005 → 下限 0.015） | ❌       |
| 3   | `dim.bond.delta_avg`     | 0.008208     | −0.03 ~ 0.03                          | ✅       |
| 4   | `dim.depth.delta_avg`（  | Δ            | ）                                    | 0.010049 | ≤ 0.10 | ✅  |
| 5   | `dim.style.delta_avg`（  | Δ            | ）                                    | 0.000079 | ≤ 0.05 | ✅  |
| 6   | `dim.verbal.delta_avg`（ | Δ            | ）                                    | 0.021464 | ≤ 0.15 | ✅  |
| 7   | `dim.arousal.delta_avg`  | −0.007292    | ≥ −0.05                               | ✅       |
| 8   | `session.zero_motion`    | **38**       | = 0                                   | ❌       |

（`exploration.rate` 属 40 轮档，本档不验 —— 与判据表一致。）

### 4.3 指纹口径澄清（DB 落库值 ≠ CLI 报告值，**非代码漂移**）

| 来源                                                       | 口径         | combined           |
| ---------------------------------------------------------- | ------------ | ------------------ |
| `ap_practice_batches.config_fingerprint`（服务端收尾固化） | dist / `.js` | `cf032d71ea4849b1` |
| CLI 报告 `fingerprint.combined`                            | src / `.ts`  | `491558624aeafdb3` |

逐段举证（复算）：

| 段                 | src/`.ts`            | dist/`.js`           | 跨扩展名是否相同 |
| ------------------ | -------------------- | -------------------- | ---------------- |
| `stateTransition`  | 8ad6d09ba8d0eba2     | 69ccc9b78a23b2c1     | ❌               |
| `alliance`         | 95142a5728aedd02     | b345d48a3a672de6     | ❌               |
| `deltaTableConfig` | 217c98cc2fef08e2     | 99be3719551b6c6b     | ❌               |
| `lexicon`          | 777e61d7361c319b     | 4d42d5321212b6f9     | ❌               |
| `baselines`        | d2ef28471cf901ec     | 4caa0d3a39015d13     | ❌               |
| `prompts`          | eb5e7c84247defe4     | ed0430680b4c8837     | ❌               |
| `acceptance`       | f604fdaca19e87b5     | 7581b8bb637f4e28     | ❌               |
| **combined**       | **491558624aeafdb3** | **cf032d71ea4849b1** | ❌               |

复算 dist/`.js` 得 `cf032d71ea4849b1` —— **与库内落库值逐位相同**，即"这批跑在 dist 构建产物上"已被证实；两值不同是 `config-fingerprint.ts` 文件头已写明的设计（"`.ts` 与 `.js` 口径互不可比，统一用 dist"）—— **CLI 从 `src` 跑，违反了该口径**。登记为 backlog（B-2），本批不改代码。

---

## 5. 归因分析：为什么 intake 2 条未达标

### 5.1 按咨询师模式切片（决定性证据）

| 模式     | 场次 | trust Δ         | safety Δ        | bond Δ      | depth Δ      | verbal Δ     | style Δ      | arousal Δ   | zero_motion | exploration |
| -------- | ---- | --------------- | --------------- | ----------- | ------------ | ------------ | ------------ | ----------- | ----------- | ----------- |
| `expert` | 48   | 0.138583 ✅     | 0.021250 ✅     | 0.0135 ✅   | −0.019241 ✅ | −0.038049 ✅ | −0.002225 ✅ | −0.01875 ✅ | **7** ❌    | 0.125       |
| `cold`   | 48   | **0.029667 ❌** | **0.003479 ❌** | 0.002917 ✅ | −0.000857 ✅ | −0.004880 ✅ | 0.002384 ✅  | 0.004167 ✅ | **31** ❌   | 0.125       |

- **`cold`（冷漠型咨询师）切片在 trust / safety / zero_motion 三条上都不达标**；批次级聚合（trust 0.0841 / safety 0.0124）恰好落在"勉强过 trust、差一点 safety"的位置 —— **聚合口径掩盖了两端对照的极端差异**。
- 逐角色切片显示 `safety Δ` 全 8 角色均低于下限（0.0075 ~ 0.0300），只有安然（0.030）与语桐（0.0164）达线 —— **不是某角色的问题，是全局口径问题**。

### 5.2 零变化场次（zero_motion = 38）复算

逐场读逐字稿的 `bdiSnapshot`（**只取八维数值，不读对话原文**）复算：

| 项                         | 结果                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| 零变化场次                 | **38**（`expert` 7 / `cold` 31）                                        |
| 其中"中途动过又回到原值"的 | **0** → 确属**全程真零**，不是浮点/回绕假象                             |
| 逐角色分布                 | 3~7 场 / 角色（8 个角色**都有**）→ 不是单个角色异常                     |
| `exploration.rate` 落点    | 12/96 场发生探索，**全部集中在安然**（安然 12/12 场），其余 7 角色 0 场 |

**判读：** `cold` 模式咨询师不给共情/验证 → 事件层几乎全是 `neutral`（批次 `event.neutral.rate = 0.8939`）→ 内核状态无增量 → 八维全程恒定。这与"冷漠被静默成中性"的失效信号描述一致，但**成因是模式本身（刻意的负向极端），不是检测器失灵**（检测器在另外 7 个角色上都抓到了非零变化）。

**结论：intake-v1 判据是按"称职咨询师首次会谈"标定的，没有为 `cold` 这一负向极端模式准备分档。** 本批的 `cold` 切片理应单独判（或单列一组判据），而不是与 `expert` 聚合后得出"6/8 通过"的中间结论。

---

## 6. 出口条件映射（口径必须标清）

| 出口条件   | 本批产出                                                                                                                                                 | 口径提醒                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ③ 成本可控 | 渲染链路 token 用量 ✅（1,343,111 tokens / 1112 轮 / 2.125480 元，`cost_basis=full`）                                                                    | ⚠️ **审议频次 = 0/1112**（见 §8）→ 本批**不能**为"审议成本 ≤ 1 元 / 50 分钟长会"取证；且 12 轮短会话（≈20~25 min）**不等同** 50 分钟长会成本 |
| ④ 质量达标 | LLM 真实被调用 ✅（96/96）、整场降级 0 ✅、intake 8 条 **6/8** ⚠️                                                                                        | 「审议建议准确率 ≥ 80%」仍走 WP-E 评测链路，**本批不产出该分数**（规格 §6 已声明）                                                           |
| ⑤ 数据积累 | **96 场逐字稿 + 批次指标快照入库留存** ✅（`data/debug-sessions/` 96 份 + `_batches/` 索引 + `ap_practice_batches` 快照行 + `data/batch-reports/` 报告） | 距 1000+ 场目标：96 场（既有可归因批次另有 16 场 p1d-r3）                                                                                    |

---

## 7. 副作用与处置（跑批期间发生的 3 件事，逐条交代）

### 7.1 报告 CLI 覆盖了历史基线 p1d-r3 的报告文件 —— 已恢复

跨批对比那一轮（`--batch 新批 --batch p1d-r3`）会让 CLI **重写** p1d-r3 的 `.json` / `.md` / `index.md`。实测差异：`computedAt` 更新，且指纹 `alliance`（2e6d2e0ee852d5a5 → 95142a5728aedd02）与 `prompts`（b4dffe74c09150f2 → eb5e7c84247defe4）随 11-11 的 WP-L / prompt 改动前移；**而 p1d-r3 的指标部分逐字未变**（16/16、exploration 0.125、depth −0.023357）。

**处置：** p1d-r3 的 `.json` / `.md` / `index.md` **已 `git checkout` 恢复到 HEAD**。理由：基线文件的作用是记录"p1d-r3 当初**跑在什么配置下**"（指纹 `0591af6a068e5e7e`，规格单 §0 明确引用该值），被今天的代码重算后基线即失去意义。新批次自己的两份产物保留为新增文件。

### 7.2 服务在末场收尾后 64 秒自动重启 —— 对本批零影响

12:58:57（末场 12:57:53 收尾之后）3000 端口进程由 PID 14700 变为 PID 8488（`nest start --watch` 监听到文件变化后重编译重启）。**重启发生在全部 96 场落库之后**，且：

- 末场收尾 12:57:53 → 批次快照落库 12:57:58 → 重启 12:58:57，**顺序无交叉**；
- 重启时库里无 `running` 孤儿场次（96/96 已终态），故 `PracticeRunnerService.onModuleInit` 的"孤儿清理"未改动任何本批场次；
- 批次快照 `metrics_json`（47,763 字节）已在重启前落库，落库值与 CLI 复算一致。

**归因：** `nest start --watch` 的监听范围覆盖仓库根；本次为跑批临时写在仓库根的探针脚本（`.tmp-*.mjs/.ts`）触发了重编译。**已在本批结束前全部删除**（见 §8.3）。

### 7.3 工作树存在并行 AI 的改动 —— 不触碰、不代提交

跑批期间工作树出现了**非本批**的文档迁移改动（Phase2.5 A 类任务单 4 份从 `pending/` 移到 `completed/phase2.5/`、1 份进 `pending/archive/`、`phase2.5-README.md` 与 `phase2.5-wp-list-2026-11-08.md` 改写）。本批**不触碰、不回滚、不代提交**，§9 的 README 回写只做定点追加。

---

## 8. 闸门数字（全部实跑，命令 / exit code / 计数）

| 闸门             | 命令                                                   | exit code | 结果                                                                                                           |
| ---------------- | ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| ESLint           | `pnpm exec eslint --cache "{src,test,bin}/**/*.ts"`    | **0**     | **0 error / 2 warning**（均为既有债：`src/auto-practice/metrics/batch-metrics.service.ts:23,25` import/order） |
| TypeScript       | `pnpm exec tsc -p tsconfig.build.json --noEmit`        | **0**     | **0 error**                                                                                                    |
| 测试             | `pnpm test`（`vitest run --exclude '**/e2e/**/*.ts'`） | **0**     | **186 文件**：185 passed / 1 skipped；**3008 例**：**3004 passed / 4 skipped**；耗时 111.50 s                  |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core`              | —         | **空** ✅                                                                                                      |

> ESLint 的 2 条 warning 与 11-11 各 WP 交付记录里记录的"lint 0 错 2 warning（既有债）"同源同条，本批未新增任何 warning。
> 测试基线对照：11-11 的 WP-N / G123 记录为"186 文件 3008 例全绿（基线 185/2991）"—— 本批 3004 passed + 4 skipped = 3008，**与既有基线一致**。

### 8.1 审议闸门调用（本批 = 0 次，重要口径）

`gate_decisions` 表本批命中 **1112 行**（= 每轮一行，96 个会话全覆盖），全部为：

```
mode = rule_only   decision = skip   reason = rule_only_skip
threshold_used = {}   delta_summary = {}   elapsed_ms = 0
```

**根因：** `ENGINE_DELIBERATION_ENABLED` 未配 → 装配时总开关把生效模式折叠为 `rule_only`（`deliberation-mode.config.ts:174-182`，"总开关关着 = 一次 LLM 都不发"）→ 审议路径**整批未被触发**。

**后果（必须标清）：**

- 本批 2.125480 元是**纯"咨询师台词 + 来访者渲染"成本**，其中**审议成本 = 0**；
- 规格 §6 期望取证的两项里，「触发式闸门审议调用频次」在本批**结构性不可得**（`threshold_used` 与 `delta_summary` 也为空 → 闸门阈值本身未被真正执行）；
- 因此本批**只能**为出口条件 ③ 提供"渲染链路 token 用量"一半证据；「审议成本 ≤ 1 元 / 50 分钟长会」需另跑（见 §9 B-1）。

### 8.2 与规格单的偏差（逐条）

| #   | 规格预期                           | 实际                                                            | 理由 / 处置                                                                         |
| --- | ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D1  | §3.1 逐字稿存量 106 份             | **91 份**                                                       | 规格单自注以实际计数为准；以 91 为准                                                |
| D2  | §6「触发式闸门审议调用频次」可取证 | **0 次**（审议总开关未开）                                      | 规格未授权改 env；改 env 会改变运行语义与成本，**本批不改** → 登记 B-1              |
| D3  | §4.4 跨批对比可能 `incomparable`   | **确为 `incomparable`**，原因 = 两批 counselorModeId 集合不同   | 与预期一致                                                                          |
| D4  | §4.1 归档到 `data/archives/`       | 落到 `data/archives/debug-sessions-pre96-2026-11-12/`（子目录） | 沿用仓库既有命名；且 `buildArchiveIndex()` 只扫子目录，散在根目录反而进不了回退索引 |

### 8.3 临时文件清理

跑批期间在仓库根临时创建的 7 个探针/轮询脚本（`.tmp-batch-ops.mjs` / `.tmp-batch-poller.mjs` / `.tmp-dbstat.mjs` / `.tmp-fpcheck.mjs` / `.tmp-provider-probe.ts` / `.tmp-waitdone.mjs` / `.tmp-zeromotion.mjs`）与 `data/batch-reports/.poll-*.json` **已全部删除**。凭据全程只从 `.env` 读入进程内存，**未打印、未落盘、未写入本文档**。

---

## 9. 登记 backlog 的缺陷（本批不改代码）

| #       | 缺陷                                                                                      | 影响                                                                          | 建议                                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-1** | **审议总开关 `ENGINE_DELIBERATION_ENABLED` 未配 → 整批 0 次审议调用**                     | 出口条件 ③（审议成本 ≤ 1 元 / 50 分钟）**无证据**；触发式闸门阈值未被真正执行 | 下一批次配 `ENGINE_DELIBERATION_ENABLED=true` + `ENGINE_DELIBERATION_EFFECTIVE_MODE=shadow` 重跑一小批（8~16 场）专门取证审议频次与单场审议成本；单 provider 下先评估限流风险 |
| **B-2** | **CLI 报告指纹走 `src/.ts`、服务端落库指纹走 `dist/.js`，两者按设计永不相等**             | 任何"DB 快照 vs CLI 报告"的指纹比对必然报"全段变化"，跨来源指纹不可用         | `bin/batch-report.ts` 改为按 `dist/` 计算（与 `config-fingerprint.ts` 文件头"统一用 dist"的自述一致），或显式把口径写进指纹字段                                               |
| **B-3** | **`cold` 负向极端模式未在 intake-v1 判据里分档**                                          | 批次级聚合掩盖 `cold` 切片 trust/safety 双低，判据结论失真                    | intake-v1 增补"按 `counselorModeId` 分档判定"或增补 `cold` 专用判据（并升版本号，保留 intake-v1 作历史口径）                                                                  |
| **B-4** | **`session.zero_motion` 在 `cold` 模式下 31/48 场触发**，语义未定义                       | 该判据原意是"检测失效"，但在"咨询师刻意冷漠"下与"检测器坏了"无法区分          | 判据增补"按模式分档"或增补"零变化但事件层非 neutral 的豁免"；否则该条对 `cold` 模式恒失败                                                                                     |
| **B-5** | **`dim.safety.delta_avg` 全 8 角色系统性低于下限**（0.0075~0.0300，判据下限 0.015）       | 全局性偏低，疑似 WP-L 的 `DELTA_TABLE` 同盟正交改造后 safety 增量被压小       | 核对 WP-L 改造后 `safety` 的 delta 量级；要么调判据，要么调表；**需先看 30 场锚点标注结论**（标注台已批次化，可用本批 96 场派生）                                             |
| **B-6** | **`exploration.rate` 12/96 且全部集中在安然**（其余 7 角色 0 场）                         | 探索与角色基线强相关，intake 档虽不验，但 40 轮档与后续批次会受影响           | 与 P1d 已记根因（探索需 `min(trust,safety) ≥ 0.6` 且 `depth < 0.35`）合并跟进                                                                                                 |
| **B-7** | **第二家 chat provider key 仍未配**（规格 §3.3 已登记，仍未补）                           | 单候选熔断 = 全损降级；本批兜底 0 轮是幸运而非结构性保障                      | 跑下一批之前补齐 deepseek/doubao/qwen 之一 + `ENGINE_RENDER_FALLBACK_PROVIDERS`                                                                                               |
| **B-8** | 批次接口不暴露 `scenarioType`（规格 §8.3 已登记）                                         | exam 场景无生产 HTTP 入口                                                     | 沿用既有登记                                                                                                                                                                  |
| **B-9** | **`package.json` 的 `smoke:ai` 指向的 `scripts/smoke-ai.cjs` 不存在**（跑健康检查时发现） | 该 smoke 脚本不可用                                                           | 工具链技术债清单里补一条                                                                                                                                                      |

---

## 10. 红线核对

| 红线                                                                              | 核对                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-core` 全程不动                                                        | ✅ `git diff --stat HEAD -- src/engine-core` **空**                                                                                         |
| 不自动 `git commit` / `git push`                                                  | ✅ **未执行任何 commit / push**；仅给 commit message 草稿                                                                                   |
| 不碰 `admin-dashboard/` 与 Flutter                                                | ✅ 未触碰                                                                                                                                   |
| 后端脚本走 pnpm（禁裸 npx）                                                       | ✅ 全部 `pnpm exec` / `pnpm test`                                                                                                           |
| 心理对话原文 / 量表答案 / 心理画像 / 自伤输入不进普通日志 / crash report / 本文档 | ✅ 本记录只含计数、布尔与八维数值；零运动归因复算**只读 `bdiSnapshot` 数值**，未读取、未引用任何 `messages` 文本；basic auth 凭据全程未落盘 |
| 零压红线                                                                          | ✅ 本批无分数 / 无评级产出                                                                                                                  |
| 不自动删批次 / 不补跑脏数据                                                       | ✅ 门禁未触发停批条件，未补跑任何场次；失败场次 0                                                                                           |

---

## 11. 产物清单

| 文件                                                      | 说明                                               |
| --------------------------------------------------------- | -------------------------------------------------- |
| `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json`           | 批次快照 v1（96 场血缘 + 指标 + 分组切片）         |
| `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.md`             | 可读报告（intake 逐条 + 指标表）                   |
| `data/batch-reports/index.md`                             | 批次时间轴（已追加本批行，保留 p1d-r3 原行）       |
| `data/debug-sessions/*.json`                              | 96 份逐字稿（每轮 `traces` 含八维快照）            |
| `data/debug-sessions/_batches/g3ONzlqSGMVJqkFMF9Lwh.json` | 逐字稿批次索引（仅 id + 枚举，零对话原文）         |
| `data/archives/debug-sessions-pre96-2026-11-12/`          | 跑批前归档的 91 份存量逐字稿                       |
| `ap_practice_batches` 行                                  | 批次门禁结论 + 指标快照（`metrics_json` 47,763 B） |
| `ap_practice_sessions` 行 × 96                            | 场次元数据 + token + 成本 + 降级计数               |
| `gate_decisions` 行 × 1112                                | 审议闸门留痕（全部 `rule_only/skip`）              |

---

## 12. commit message 草稿

```
docs(phase2.5): 96 场级验证批次取证（门禁 3/3 过，intake 6/8，审议 0 次）
```
