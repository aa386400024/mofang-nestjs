# Phase2.5 · intake-v2 判据按咨询师模式分档 + TD-4 指纹口径修复 —— 已交付

**已写入交付记录**：`docs/worklog/completed/phase2.5/phase2.5-intake-v2-mode-stratified-acceptance-implementation-2026-11-12.md`
任务单已归档至 `docs/worklog/completed/phase2.5/phase2.5-intake-v2-mode-stratified-acceptance-2026-11-12.md`（顶部状态行已改 ✅ 并链接交付记录）。

## 一句话结论

判据按 `counselorModeId` 分档（`intake-v1` → `intake-v2`）落地：`expert` 及**所有未单列模式**回落 v1 基线档、`cold` 单设候选阈值档；`session.zero_motion` 在 cold 档按 I-22 拆出「合理封闭 / 纯 neutral 空转」两类语义；CLI 报告**保留全局结论**并追加按 `byMode` 切片判分；catalog 下发分档结构与新版本号；TD-4 同单修复 —— 指纹统一按 `dist/*.js` 口径，CLI 进程与服务端进程**逐段指纹现已完全相同**。

## 一、闸门真实数字

| 闸门        | 命令                                      | exit | 真实数字                                                                                                                     |
| ----------- | ----------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 盘延迟体检  | `pnpm doctor:fs`                          | 0    | walk 32ms / cold 88ms / warm 20ms / per-file 0.10ms → 合格                                                                   |
| 类型        | `pnpm typecheck`                          | 0    | **0 error**                                                                                                                  |
| Lint        | `pnpm lint`                               | 0    | **0 error / 2 warning**（2 条 `import/order` 在我**未改动**的 `batch-metrics.service.ts`，与基线逐一致）                     |
| 测试        | `pnpm test`                               | 0    | **186 文件 passed + 1 skipped（187）**；**3029 passed / 4 skipped（3033 例）**；vitest Duration **86.40s**（墙钟 **88.8s**） |
| 构建        | `pnpm build`                              | 0    | tsc 通过，`dist/` 重建为当前判据内容（供指纹口径取证）                                                                       |
| engine-core | `git diff --stat HEAD -- src/engine-core` | —    | **空**（零改动），`boundary.spec.ts` 未改                                                                                    |

**机器状态**：跑闸门前已停掉全部 5 个长驻进程（`pnpm start:dev` 2032、`nest start --watch` 14988、`pnpm dev` 17196、admin-dashboard `vite` 11044、`dist/app` 18084），跑闸门期间**无 node 长驻进程**；取证会话 PATH 补齐 `D:\Apps\Git\cmd`。
**与基线对照**：基线 3004 passed / 4 skipped（3008 例 / 186 文件）→ 本单 **3029 passed / 4 skipped（3033 例 / 187 文件）**，净增 **+25 例**（新增 spec 的 25 条用例），**无新增 failed、无新增 skipped**。

## 二、96 场复算对照（批次 `g3ONzlqSGMVJqkFMF9Lwh`，96/96 场、1112 轮）

复算命令：`pnpm exec tsx bin/batch-report.ts --batch g3ONzlqSGMVJqkFMF9Lwh --out <临时目录>`（产物写临时目录，**未改写**仓库内按 intake-v1 判读的历史报告）。

| 切片     | 场次 | 轮次 | v1 单表  | v2 分档              | 命中档位              |
| -------- | ---: | ---: | -------- | -------------------- | --------------------- |
| 全局     |   96 | 1112 | 6/8 FAIL | **6/8 FAIL（不变）** | `baseline`（兜底）    |
| `expert` |   48 |  561 | 7/8 FAIL | **7/8 FAIL（不变）** | `baseline`（回落 v1） |
| `cold`   |   48 |  551 | 5/8 FAIL | **8/8 PASS**         | `cold`（候选阈值）    |

- 全局未达标仍是两条：`dim.safety.delta_avg` 0.012365（下限 0.02）、`session.zero_motion` 38。
- `expert` 只差 `session.zero_motion` = 7。
- `cold` 在 v1 单表下 trust 0.029667、safety 0.003479、zero_motion 31 三条不过；v2 cold 档全部通过（zero_motion 判据 `max_ratio` = **31/48 = 0.645833 ≤ 0.70 + 0.01 容差**）。

## 三、I-22 两类语义（zero_motion）

- **判定规则（逐场）**：① 零变化 = 八个追踪维度首末快照全等；② 事件层存在**非 neutral** 事件 → `closure`（合理封闭，按任务单口径**豁免**，不计入失效）；③ 只有 neutral / 无事件标签 → `idle`（纯 neutral 空转，**计入失效**）。**基线档不受影响**，仍用 v1 原语义（原始计数必须为 0），保证 v1 口径一个数值都没改。
- **数据来源**：逐字稿合规投影的 `traces[].eventTags`（**只有事件标签**，不含对话原文 / 量表答案 / 心理画像）；计算层逐场判定 → 新增可选字段 `MetricsSlice.zeroMotionBreakdown`（`total/closure/idle`，快照 `schemaVersion` 仍 v1）。
- **实测豁免场次**：全局 **38/0/38**、`expert` **7/0/7**、`cold` **31/0/31**。即本批 38 场零变化场次与「事件层全 neutral」的场次集合**完全重合**，按任务单字面口径**豁免命中 0 场** —— cold 能判 PASS 靠的是它自己的候选阈值，**不是**豁免。

## 四、cold 档候选阈值（**待主控复核**，代码内每条 rationale 已标注）

| 判据          | cold 候选值                | 实测           | 依据                                                                                  |
| ------------- | -------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `trust`       | [0.01, 0.08]               | 0.029667       | 冷漠输入下信任建立显著慢（expert 0.1386）；下限 0.01 保住「完全无响应即不合格」的底线 |
| `safety`      | [0.00, 0.03]               | 0.003479       | 试探性安全几乎不涨属合理反应；上限 0.03 防「无节制依赖」滑向另一端                    |
| `bond`        | [−0.03, 0.03]              | 0.002917       | 沿用 v1：纽带 3–5 次会谈后才成形，首次会谈本就不该动                                  |
| `depth`       |                            | Δ              | ≤ 0.05                                                                                | −0.000857 | 深度防御基本稳；比基线更紧，捕捉「冷漠输入反而把深度防御撬开 / 塌陷」 |
| `style`       |                            | Δ              | ≤ 0.05                                                                                | 0.002384  | 沿用 v1：人格级防御属于稳定特质                                       |
| `verbal`      |                            | Δ              | ≤ 0.05                                                                                | −0.004880 | 冷漠输入下话量阻抗几乎不动；比基线更紧，捕捉「被压垮 / 泄洪」         |
| `arousal`     | ≥ −0.05                    | 0.004167       | 沿用 v1：结束时唤醒仍可能高于基线                                                     |
| `zero_motion` | 纯 neutral 空转占比 ≤ 0.70 | 31/48 = 0.6458 | I-22 语义；该档不要求为 0，但空转率过高说明「冷漠被静默成中性」的失效面过大           |

> cold 档 `provisional = true`，**未写成硬门槛**；未新增任何指标 id（判据 id 集合与 v1 完全一致），指标字典零改动。

## 五、TD-4 指纹口径修复与两侧一致性证据

- **修复方式**：新增共享解析器 `resolveFingerprintSource()`（`prompt-fingerprint.ts`）—— 包根下存在构建产物时一律读 `<root>/dist/**/*.js`；`computePromptVersion()`（`prompts` 段的数据源）与 `computeConfigFingerprint()` 其余 6 段全部走该口径。**没有在 CLI 里另写哈希**（修复落在指纹模块 / 调用链）。fail-closed 保留：读不到 → 该段 `unknown` → combined `unknown`。
- **两侧一致证据**（同机同时同构建产物）：CLI（`pnpm exec tsx` → src 上下文）与服务端（`node` → dist 上下文）**7 段逐段相同**，`stateTransition 69ccc9b78a23b2c1` / `alliance b345d48a3a672de6` / `deltaTableConfig 99be3719551b6c6b` / `lexicon 4d42d5321212b6f9` / `baselines 4caa0d3a39015d13` / `prompts ed0430680b4c8837` / `acceptance 4474dd5be381d905`，**combined 同为 `ce51839d02ea4020`**。
- **与旧值差异**：修复前 src 口径 `491558624aeafdb3` / dist 口径 `cf032d71ea4849b1`（= 库内落库值）；新值与库内旧值不同是**判据文件内容变更**（acceptance 段）导致的**预期**差异，跨批判 `incomparable` 正是这一设计。

## 六、契约变化（`GET /admin/api/auto-practice/metrics/catalog`）

- **新增**：`data.acceptanceVersionHistory`（`['intake-v2','intake-v1']`）、`data.tiers[]`（`{ id, label, counselorModeIds, provisional, note, expectations }`）、`meta.tierCount`；`data.acceptanceVersion` 由 `intake-v1` → **`intake-v2`**。
- **保持不变**：`data.expectations` **仍是基线档**（与常量逐条同源引用，旧前端镜像不炸）、`data.metrics`、`meta.expectationCount`；投影里**不含任何判定逻辑 / 判定结果**（有单测断言 payload 不出现 `passed` / `actual`）。
- **前端**：本单**未改 `admin-dashboard/` 任何代码**。`admin-dashboard/src/components/metricCatalog.ts` 的本地兜底镜像仍是 v1 单表，页面现在展示的是基线档口径 —— 需前端 AI 后续对齐（差异已在交付记录 §8 列明）。

## 七、§7 回写清单（10 项全做，无遗留）

- [x] 交付记录写到 §6 固定路径
- [x] 任务单从 `pending/` 移到 `completed/phase2.5/`，状态行改 ✅ 并链接交付记录
- [x] 回写 wp-list §4 独立单表（本任务行 + 交付记录链接）
- [x] 回写 phase2.5-README §3 当前任务表（+ §4 遗留项 ②）
- [x] 判据口径文档标 intake-v2 并新增分档口径（§3 v1 原表**作为历史口径保留**，新增 §3.2 分档 / §3.3 zero_motion 两类语义）
- [x] known-issues：I-21、I-22 状态更新（表格行 + 详情段「处置结果」）
- [x] tech-debt：TD-4 标记 ✅ 已修复并写明修复方式与证据
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对（见下方提醒）
- [x] 给出一行 commit message 草稿（**未 commit / 未 push**）

## 八、需要你拍板的两件事（本单未替你决定）

1. **cold 候选阈值是否转正**：目前是标注「待主控复核」的候选值，转正前不应当硬门槛用。
2. **I-22 豁免 / 计入的映射方向**：本单**按任务单字面**实现（事件层有非 neutral → 豁免；纯 neutral 空转 → 计入）。但从含义上，「检测器失效」更像**有非 neutral 输入却状态毫无变化**（输入有动作、状态却不动），而「合理封闭」更像**输入全程 neutral、来访者本就无从变化**。若方向应相反，本批的分子会变成 0（38 场全部豁免），cold 档 0.70 阈值即成形式门槛 —— 两种方向的实测数已在交付记录 §5.4 / §5.3 全部给出，可直接换算。

## 九、提交

```
feat(auto-practice): intake-v2 判据按咨询师模式分档 + 零变化 I-22 语义 + 指纹统一 dist 口径
```

> **按约束未自动 commit / push。** 另提醒：交付时工作区另有 **admin-dashboard/ 3 个文件的改动**（`src/i18n/locales/en.ts`、`src/i18n/locales/zh-CN.ts`、`src/views/ArchitectureDiagram.vue`）—— **非本单改动，是并行前端进程产物**，提交时按 §7 分组 stage，不要与本单文件混提。

未做（按约束排除）：I-23 safety 量级归因、审议开关取证（B-1）、I-11 / I-16、Flutter、admin-dashboard 代码、任何新批次。
