# Phase2.5 · 96 场级验证批次执行完毕

**批次 `g3ONzlqSGMVJqkFMF9Lwh` · 96/96 场 · 1112 轮 · 门禁 3/3 全过 · intake-v1 8 条中 6 条过 · 审议调用 0 次**

---

## 一、规格单复核：逐条回读源码，**未发现规格单与源码不符**

动手前把规格单每处断言都对着源码验了一遍，全部一致：

| 规格单断言                                              | 源码位置                                                       | 复核结果                                               |
| ------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `POST /admin/api/auto-practice/batch`                   | `auto-practice.controller.ts:132`                              | ✅ `src/app.ts` **无全局前缀**，实际路径即规格所写     |
| body `characterSlugs/counselorModeIds/maxTurns/repeats` | 同上 `BatchBody`                                               | ✅ `maxTurns ?? 15` → 本批显式传 12，未落缺省          |
| `GET /batches/:id` 返回 `batchHealth.valid`/`warning`   | controller `:218` + `practice-batch-health.service.ts:223`     | ✅ 读时算，中途即可判废                                |
| 队列并发缺省 2、区间 1–5                                | `practice-queue.service.ts:56-88`                              | ✅ env 未配 → 缺省 2，不夹取、不重启                   |
| 8 个 slug（`templateId` 唯一真相源）                    | `character-baseline-calibration.ts:189`                        | ✅ 与规格 §2.1 **逐字相同、顺序相同**                  |
| 门禁 0.9 / 0.05 / 100%                                  | `practice-batch-health.service.ts:33-36`                       | ✅ `render_fallback_ratio` 取批次均值，null 不计入分母 |
| intake-v1 8 条判据                                      | `acceptance-thresholds.ts:44`                                  | ✅ 8 条与规格 §5.2 逐条对齐                            |
| 报告 CLI 参数与退出码                                   | `bin/batch-report.ts:36-121`                                   | ✅ 0/1/2/3                                             |
| basic auth 旁路                                         | `admin-basic-auth.middleware.ts:97` + `admin-role.guard.ts:85` | ✅ 凭据正确 → 直接放行，不查 DB 角色                   |

### 复核中发现的 7 个坑（已逐条在执行中处置）

1. **失败场次会被 coverage 判 skipped** —— `projectTraces` 对空 `traces` 记 `no_traces` 跳过 ⇒ 任一场失败 → `skippedSessions>0` → 覆盖不足 96/96。**这是"覆盖 96/96"最脆弱的一环**，本批 0 失败未触发。
2. **`prune()` 按创建时间保留最近 500 份** —— 91+96=187 < 500，本批**不会**淘汰；仍按规格先归档。
3. **批次接口不暴露 `scenarioType`** —— 无法跑 exam 场景（规格 §8.3 已登记），本批走默认场景。
4. **单候选 provider** —— 上游限流即全损降级；本批兜底 0 轮是幸运，不是结构性保障。
5. **规格 §3.1 记"逐字稿 106 个"，实际 91 个** —— 规格自注"以实际计数为准"，以 91 为准并留痕。
6. **DB 落库指纹与 CLI 报告指纹按设计永不相等**（详见第六节）。
7. **`ENGINE_DELIBERATION_ENABLED` 未配** —— 这条规格没写，但会直接掏空出口条件③的取证能力（详见第五节）。

---

## 二、执行：每一步命令与结果

### §4.1 前置

**归档**：`data/debug-sessions/*.json`（91 份）→ `data/archives/debug-sessions-pre96-2026-11-12/`；`BEFORE_COUNT=91 → AFTER_PRIMARY=0  ARCHIVED=91`。沿用仓库既有 `debug-sessions-<label>` 命名；归入子目录还有一层作用——`buildArchiveIndex()` 只扫子目录，散在根目录反而进不了回退索引。

**健康检查**：

| 项                           | 结果                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3000（Nest）                 | ✅ LISTENING，`GET /health` → 200 `{"status":"ok","database":{"status":"up"},"redis":{"status":"up"}}`                                                                        |
| 5174（admin-dashboard vite） | ✅ LISTENING                                                                                                                                                                  |
| 3000 进程                    | PID 14700 `node --enable-source-maps dist/app`，启动 12:05:46；`dist/app.js` 构建于 11:55:51                                                                                  |
| 代码一致性                   | `src` 最新 mtime 2026-11-12 02:19:34 **早于**构建时间 → **跑的就是当前源码**（沿用金丝雀 §2 的"三件事比对"纪律）                                                              |
| provider 探针                | `POST https://api.minimax.cn/v1/chat/completions`（`MiniMax-M3.1-Flash`）→ **HTTP 200 / 1705 ms**，`usage` 回报 `prompt_tokens=203` → **输入侧用量正常，成本口径可升 `full`** |
| `src/engine-core` diff       | 空 ✅                                                                                                                                                                         |

### §4.2 入队

```
POST /admin/api/auto-practice/batch（basic auth）
{"characterSlugs":[8 个], "counselorModeIds":["expert","cold"], "maxTurns":12, "repeats":6}
→ 201 {"batchId":"g3ONzlqSGMVJqkFMF9Lwh","enqueued":96}
```

入队前逐项核过可解析性（否则会静默少场）：8 个 slug 在 `character_profiles` **全部存在、enabled=1、audit_status=approved**；`expert`/`cold` 在 `ap_counselor_modes` **均 enabled=1**。

### §4.3 跑批与门禁

| 项         | 值                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 场次矩阵   | 16 格（8 角色 × 2 模式）× 6 重复 = **96**，实测每格恰好 6 场                                                  |
| 状态       | completed **91** / crisis_ended **5** / failed **0** / stagnant **0**                                         |
| 退出原因   | `max_turns` 80 / `natural_close` 6 / `crisis_practice_max` 5 / `crisis_escalated` 5                           |
| 轮数       | **1112**（均 11.58 轮，5~12）                                                                                 |
| 耗时       | 均 **44.3 s**/场，最长 238 s（并发 2，整批墙钟约 37 min：12:20 → 12:57:53）                                   |
| tokens     | **1,343,111**（13,991/场，1,208/轮）                                                                          |
| 成本       | **2.125480 元**（expert 1.078593 + cold 1.046887；单场 0.007689~0.025767 元），**`cost_basis=full`（96/96）** |
| 兜底/降级  | 渲染兜底 **0** 轮；`degraded_turns` **0**（两侧均 0）                                                         |
| 版本一致性 | `engine_version=9f23166`、`prompt_version=ed0430680b4c8837`，**96/96 场完全一致**                             |

端点判定与库内固化一致：

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

`valid=true`、`flags=[]`、**响应体不含 `warning` 键**。库内 `ap_practice_batches` 行：`valid=1`、`validity_flags=NULL`、`metrics_json` 47,763 B、`updated_at=2026-11-12T04:57:58Z`（末场收尾后 5 秒）。

### §4.4 报告 CLI

```
pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --out data/batch-reports
→ EXIT_CODE_A=0

pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --batch p1d-r3-intake-2026-11-11 --strict --out data/batch-reports
→ EXIT_CODE_B=0
→ stderr: [p1d-r3-intake-2026-11-11] incomparable: 两批 counselorModeId 集合不同
```

`--strict` 未返回 2 ⇒ 覆盖率 96/96 ≥ 0.9 通过。跨批判 `incomparable`，原因 = **两批咨询师模式集合不同**，与规格 §4.4 预期一致。

---

## 三、验收结论

| 验收项                          | 阈值             | 实测                             | 判定          |
| ------------------------------- | ---------------- | -------------------------------- | ------------- |
| `llm_call_ratio`                | ≥ 0.9            | **1.0**（96/96 有真实 LLM 调用） | ✅            |
| `render_fallback_ratio`（均值） | < 0.05           | **0.0**（1112 轮兜底 0 轮）      | ✅            |
| `counter_consistency`           | 100%             | **100%**                         | ✅            |
| 覆盖                            | 96/96、skipped=0 | **96/96、skipped=0**             | ✅            |
| 场次失败                        | 0                | **0**                            | ✅            |
| intake-v1 8 条                  | 全过             | **6 / 8**                        | ⚠️ **未全过** |

**intake-v1 未达标的 2 条**（均为临床口径，非管道故障）：

| 判据                   | 实测     | 要求                                 |
| ---------------------- | -------- | ------------------------------------ |
| `dim.safety.delta_avg` | 0.012365 | ≥ 0.015（区间下限 0.02 − tol 0.005） |
| `session.zero_motion`  | **38**   | = 0                                  |

**归因（决定性证据，按模式切片）**：

| 模式              | trust Δ         | safety Δ        | zero_motion |
| ----------------- | --------------- | --------------- | ----------- |
| `expert`（48 场） | 0.138583 ✅     | 0.021250 ✅     | **7** ❌    |
| `cold`（48 场）   | **0.029667 ❌** | **0.003479 ❌** | **31** ❌   |

逐场复算逐字稿八维数值（**只读数值，不读对话原文**）：38 场零变化中，**"中途动过又回到原值"的 = 0** ⇒ 确属**全程真零**，不是浮点假象；8 个角色**每个都有**（3~7 场），不是单角色异常。`exploration.rate` 12/96 且**全部集中在安然**。

**判读：`cold`（冷漠型咨询师）这一负向极端模式在 trust/safety/zero_motion 三条上都不达标，批次级聚合（trust 0.0841 / safety 0.0124）恰好落在"勉强过 trust、差一点 safety"的位置——聚合口径掩盖了两端对照的极端差异。intake-v1 是按"称职咨询师首次会谈"标定的，没有为 `cold` 准备分档。**

---

## 四、出口条件口径（必须标清，勿误读）

| 出口条件   | 本批产出                                                                | 口径提醒                                                                            |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ③ 成本可控 | 渲染链路 token ✅（1,343,111 tokens / 2.125480 元 / `cost_basis=full`） | ⚠️ **审议侧无证据**（见下）；且 12 轮短会话 ≈ 20~25 min，**不等同** 50 分钟长会成本 |
| ④ 质量达标 | LLM 真被调用 ✅、整场降级 0 ✅、intake 8 条 **6/8** ⚠️                  | 「审议建议准确率 ≥ 80%」仍走 WP-E 链路，**本批不产出该分数**                        |
| ⑤ 数据积累 | **96 份逐字稿 + 批次指标快照入库** ✅（另：跑批前 91 份存量已归档留存） | 距 1000+ 场目标：96 场                                                              |

### ⚠️ 审议调用 = 0 / 1112（本次最关键的取证缺口）

`gate_decisions` 本批命中 1112 行（每轮一行），全部是 `mode=rule_only / decision=skip / reason=rule_only_skip / threshold_used={} / delta_summary={} / elapsed_ms=0`。

**根因**：`ENGINE_DELIBERATION_ENABLED` 未配 → 装配时总开关把生效模式折叠为 `rule_only`（`deliberation-mode.config.ts:174-182`："总开关关着 = 一次 LLM 都不发"）。

**后果**：本批 2.125480 元是**纯"咨询师台词 + 来访者渲染"成本**，审议成本 = 0；且 `threshold_used`/`delta_summary` 为空 ⇒ **触发式闸门的阈值本身也没被真正执行过**。规格 §6 期望取证的"触发式闸门审议调用频次"本批**结构性不可得**。规格未授权改 env（改 env 会改变运行语义与成本），**本批不改** ⇒ 登记 B-1，下批单独取证。

---

## 五、跑批期间发生的 3 件事（副作用与处置）

1. **报告 CLI 覆盖了历史基线 p1d-r3 的报告文件 —— 已恢复。** 跨批对比那一轮会重写 p1d-r3 的 `.json`/`.md`/`index.md`；实测差异只有 `computedAt` 与指纹前移（`alliance`、`prompts` 两段因 11-11 的 WP-L / prompt 改动变了），**p1d-r3 的指标部分逐字未变**。基线文件的作用是记录"p1d-r3 当初跑在什么配置下"（指纹 `0591af6a068e5e7e`，规格单明确引用该值），被今天的代码重算后即失去意义 ⇒ 已 `git checkout` 恢复到 HEAD，新批次自己的两份产物保留为新增文件。
2. **服务在末场收尾后 64 秒自动重启 —— 对本批零影响。** 12:58:57 3000 端口进程由 PID 14700 变为 PID 8488（`nest start --watch` 监听到文件变化后重编译）。但顺序是"末场收尾 12:57:53 → 快照落库 12:57:58 → 重启 12:58:57"，**无交叉**；重启时库里无 `running` 孤儿场次（96/96 已终态），孤儿清理未改动任何本批场次。归因：本批临时写在仓库根的探针脚本触发了 watch 重编译 —— **已全部删除**。
3. **工作树存在并行 AI 的改动 —— 不触碰、不代提交。** 跑批期间出现了非本批的文档迁移（Phase2.5 A 类任务单 4 份 `pending/`→`completed/phase2.5/`、1 份进 `pending/archive/`、README 与 wp-list 改写）。本批不触碰、不回滚、不代提交；README 回写只做定点追加。

### 附：指纹口径澄清（DB 落库值 ≠ CLI 报告值，**非代码漂移**）

| 来源                                                       | 口径       | combined           |
| ---------------------------------------------------------- | ---------- | ------------------ |
| `ap_practice_batches.config_fingerprint`（服务端收尾固化） | dist/`.js` | `cf032d71ea4849b1` |
| CLI 报告 `fingerprint.combined`                            | src/`.ts`  | `491558624aeafdb3` |

逐段复算：dist/`.js` 口径得 `cf032d71ea4849b1` —— **与库内落库值逐位相同**，即"这批跑在 dist 构建产物上"已被证实。两值不同是 `config-fingerprint.ts` 文件头已写明的设计（"`.ts` 与 `.js` 口径互不可比，统一用 dist"），而 **CLI 从 `src` 跑，违反了该口径** ⇒ 登记 B-2，本批不改代码。

---

## 六、闸门数字（全部实跑）

| 闸门             | 命令                                                | exit code | 结果                                                                                                       |
| ---------------- | --------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| ESLint           | `pnpm exec eslint --cache "{src,test,bin}/**/*.ts"` | **0**     | **0 error / 2 warning**（既有债：`src/auto-practice/metrics/batch-metrics.service.ts:23,25` import/order） |
| TypeScript       | `pnpm exec tsc -p tsconfig.build.json --noEmit`     | **0**     | **0 error**                                                                                                |
| 测试             | `pnpm test`                                         | **0**     | **186 文件**（185 passed / 1 skipped）；**3008 例**（**3004 passed / 4 skipped**）；111.50 s               |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core`           | —         | **空** ✅                                                                                                  |

两条 warning 与 11-11 各 WP 交付记录里的"lint 0 错 2 warning（既有债）"同源同条，本批**未新增任何 warning**；测试数与既有基线（186 文件 3008 例）一致。

---

## 七、登记 backlog 的 9 条（本批不改业务代码）

| #       | 缺陷                                                                        | 影响                                                                                                                                             |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B-1** | 审议总开关未配 → 整批 0 次审议调用                                          | 出口条件③**无证据**；闸门阈值未被真正执行 → 需配 `ENGINE_DELIBERATION_ENABLED=true` + `ENGINE_DELIBERATION_EFFECTIVE_MODE=shadow` 另跑一小批取证 |
| **B-2** | CLI 指纹走 src/`.ts`、落库指纹走 dist/`.js`，**按设计永不相等**             | 任何"DB 快照 vs CLI 报告"的指纹比对必然报"全段变化"                                                                                              |
| **B-3** | intake-v1 未按 `counselorModeId` 分档                                       | `cold` 负向极端把批次级聚合拖成 6/8，判据结论失真                                                                                                |
| **B-4** | `session.zero_motion` 在 `cold` 下 31/48 恒失败                             | "检测失效"与"咨询师刻意冷漠"在现有判据下无法区分                                                                                                 |
| **B-5** | `dim.safety.delta_avg` 全 8 角色系统性偏低（0.0075~0.0300，判据下限 0.015） | 疑似 WP-L 同盟正交改造后 safety 增量被压小；需先看 30 场锚点标注结论（标注台已批次化，可用本批 96 场派生）                                       |
| **B-6** | `exploration.rate` 12/96 且全部集中在安然                                   | 探索与角色基线强相关，40 轮档与后续批次会受影响                                                                                                  |
| **B-7** | 第二家 chat provider key 仍未配                                             | 单候选熔断 = 全损降级（本批兜底 0 轮是幸运）                                                                                                     |
| **B-8** | 批次接口不暴露 `scenarioType`（规格 §8.3 已登记）                           | exam 场景无生产 HTTP 入口                                                                                                                        |
| **B-9** | `package.json` 的 `smoke:ai` 指向的 `scripts/smoke-ai.cjs` **不存在**       | 该 smoke 脚本不可用（跑健康检查时发现）                                                                                                          |

---

## 八、交付物

| 文件                                                                                          | 说明                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `docs/worklog/completed/phase2.5/phase2.5-verification-batch-96-implementation-2026-11-12.md` | **交付记录**（27 KB）：复核、前置、入队、门禁、报告、归因、副作用、闸门数字、backlog |
| `docs/worklog/completed/phase2.5/phase2.5-verification-batch-96-spec-2026-11-12.md`           | 规格单（已从 `pending/` 归档，顶部状态行改为 ✅ 并指向交付记录）                     |
| `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` / `.md`                                       | 批次快照 v1（96 场血缘 + 指标 + 分组切片）/ 可读报告                                 |
| `data/batch-reports/index.md`                                                                 | 批次时间轴（已追加本批行，保留 p1d-r3 原行）                                         |
| `data/debug-sessions/*.json`（96 份）+ `_batches/g3ONzlqSGMVJqkFMF9Lwh.json`                  | 逐字稿 + 批次索引（仅 id 与枚举，零对话原文）                                        |
| `data/archives/debug-sessions-pre96-2026-11-12/`（91 份）                                     | 跑批前归档的存量逐字稿                                                               |
| `ap_practice_batches` / `ap_practice_sessions` / `gate_decisions`                             | 批次门禁结论 + 指标快照 / 场次元数据 / 1112 行审议留痕                               |
| `docs/worklog/pending/phase2.5-README.md`                                                     | 回写：§3"100 场级验证批次"行、§3.2 出口条件 ③⑤、§3.3 第 5~6 步                       |

**红线核对**：`src/engine-core` **零 diff** ✅；未执行任何 `git commit`/`git push` ✅；未碰 `admin-dashboard/` 与 Flutter ✅；全部走 `pnpm exec`（无裸 npx）✅；心理原文/量表答案/画像/自伤输入零入日志与本文档 ✅（零运动归因**只读八维数值**）；basic auth 凭据全程只从 `.env` 读入内存，**未打印、未落盘** ✅；7 个临时探针脚本 + 轮询产物**已全部删除** ✅。

---

## 九、commit message 草稿

```
docs(phase2.5): 96 场级验证批次取证（门禁 3/3 过，intake 6/8，审议 0 次）
```

---

**一句话总结**：本批**证明了渲染链路可信**（96/96 真调 LLM、兜底 0 轮、降级 0 轮、覆盖 96/96 skipped=0），**没有证明临床状态达标**（intake-v1 6/8，缺口集中在 `cold` 负向极端模式），**也没有为出口条件③的审议成本提供任何证据**（审议总开关未开，1112 轮全部 skip）—— 下一步最该做的是 B-1：单独跑一小批把审议打开取证。

已写入文件。
