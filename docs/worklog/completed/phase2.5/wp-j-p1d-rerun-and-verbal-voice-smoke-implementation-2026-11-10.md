# WP-J P1d-R2 · verbal_voice 动态冒烟 + 16 场正式重跑 · 交付记录

- 日期：2026-11-10（夜间执行）
- 执行：主 Agent 接手（原派 MiniMax Code，其会话在 23:18 前后停滞，未产出交付记录）
- 引擎版本：`d72c68e-dirty`（`d72c68e` + 本轮未提交的装配修复）
- prompt_version：`f1fdb4f90a5e622a`（**本批 16/16 全部落库**，见 §7）
- 任务单：`docs/worklog/pending/wp-j-p1d-rerun-and-verbal-voice-smoke-task-2026-11-10.md`

---

## 1. 一句话结论

**文案确实进了 prompt（8 角色 × 2 模式，除 1 场 LLM 全失败外全部命中），但 P1d 重跑按 §3.5 判 FAIL —— 不是接线问题，而是"固定探索门槛 + 差异化基线"结构性冲突：除 secure 外 7 个角色的 trust/safety 永远够不到探索门槛，探索率被锁死在 0。**

---

## 2. 阶段 A（1 场 verbal_voice 冒烟）

### 2.1 首轮 FAIL → 修复 → 复验 PASS

| 轮次 | 会话 | 状态 | `vv_prefix_hits` | `vv_text_hits` | `anxious_hits` | 判定 |
|---|---|---|---|---|---|---|
| ① 首轮（MiniMax 跑） | `debug_FGdlhVwguOxjM0PbNAOQN` | completed / 4 轮 | **0** | **0** | 16 | FAIL |
| ② 复验（修复后） | `debug__ejw8FTUOV2WRXYErcRwA` | completed / 4 轮 | **8** | **8** | 17 | **PASS** |

（`vv_prefix_hits` = `你说话的味道：` 命中次数；`vv_text_hits` = 语桐文案首句命中次数；`anxious_hits` = 依恋行为块关键词命中次数。只报计数，不含任何 prompt / 台词文本。）

### 2.2 首轮 FAIL 的真因与修复

**真因**：`verbalVoice` 从未登记进开场装配路径。库里有值、渲染层有消费点，但中间的登记环节缺失 → 渲染层 `if (spec.verbalVoice)` 恒为假 → 静默跳过，prompt 里一个字都没有。

链路证据：
- 消费端 `src/engine-adapters/rendering/turn-render-orchestrator.ts` 从 `context.verbalVoice` 取值，上游没登记就永远是 `undefined`。
- 生产开场路径 `src/engine-adapters/wiring/engine-turn.service.ts` 的 `open(input, options)` 里，`attachmentStyle` 有类型声明 + 显式登记，`verbalVoice` **一次都没出现**。
- `src/admin-debug/debug-session.service.ts` 两处 `engine.open(...)`（新建 / 恢复）都登记了 `attachmentStyle`，都没登记 `verbalVoice`，尽管 `resolved.verbalVoice` 就在手上。
- 自动对练走 `PracticeRunnerService` → `TurnEnginePort`（= `DebugSessionService`），与调试面板同一条路径，所以这一处缺失覆盖了两条主路径。

**修复**（3 文件 + 1 新测试，见 §6）：两处 `engine.open` 的 options 补条件展开登记，装配层补类型声明 + 登记，新建 11 例接线测试（含源码扫描断言，防止将来被改回去）。

### 2.3 dist 新旧判据

修复后 `npx tsc -p tsconfig.build.json` → `build_exit=0`，`dist/app.js` mtime `23:34:36`，`dist/engine-adapters/wiring/engine-turn.service.js` 内含 `verbalVoice: options.verbalVoice`（HIT）。

---

## 3. 阶段 B（16 场正式重跑）

- `batch_id`：`verify-route1-p1d-2026-11-10`
- 配置：8 角色 × {cold, expert} × 1 场，`maxTurns=12`
- 结果：**16/16 场落库，0 failed**

| status | 场数 | 说明 |
|---|---|---|
| completed | 14 | 12 轮跑满（小满/cold 为 natural_close 提前收尾） |
| crisis_ended | 1 | 念安/expert，8 轮，`crisis_escalated` |
| stagnant | 1 | 惊尘/expert，7 轮，`stagnant_heavy_degraded` |

轮次级：183 轮，其中 degraded 11 轮（6.0%）。**degraded 场次 3/16 = 18.8%**（门槛 ≤25% ✅）。

LLM 调用：`llm_call_turns=172`，`render_fallback_turns=11`。

---

## 4. 三方对比表

口径说明：探索 / 停留 / 阻抗 / recounting 等指标统一取逐字稿 `traces[].intention.strategy`（决策层每轮输出的策略枚举），可复算、不依赖人工标注。

| 指标 | v1 基线（36 场） | P1c r2（15 有效） | **P1d 重跑（16 场 / 183 轮）** | 目标 | 判读 |
|---|---|---|---|---|---|
| 探索率 | 11.1% | 6.7% | **13.1%**（24/183） | ≥15% | ❌ 未达标（但高于两个基线） |
| 表层停留 | 88.9% | 100% | **86.9%** | ≤75% | ❌ 未达标 |
| anxious 阻抗率 | 0% | 0% | **0%**（0/72 轮） | 破 0%（≥10%） | ❌ 未破 0 |
| anxious 探索率 | 0% | 0% | **0%**（0/72 轮） | 破 0% | ❌ 未破 0 |
| anxious 文本通道命中 | N/A | N/A | **有**（三角色台词指纹块均命中，anxious 行为块命中 36/36/49） | ≥3 轮命中 | ✅ |
| 角色可分辨度 | 22.2% | 13.3% | **未取到** | ≥30% | 未取到（该指标依赖标签命中率的独立算法，本批只做策略分布，见 §7 局限） |
| 危机单次披露 | 100% | 100% | 1 场危机（念安/expert，8 轮，3 个危机轮） | 持平 | 未取到（"单次"需人工核是否同一披露，本批只报场次与危机轮数） |
| degraded 率 | 36.8% | 25.0% | **18.8%**（3/16 场） | ≤25% | ✅ |
| stagnant 退场 | 5/24 | 0/16 | **1/16** | 保持 0 | ❌ 但有独立原因（见下） |
| recounting 占比 | 53.9% | 80.9% | **57.9%**（106/183） | ≤60% | ✅ |
| resistance 占比 | 25.4% | 9.0% | **18.0%**（33/183） | 不反弹回 25% | ✅ |
| affective_exploration 占比 | 10.7% | 3.4% | **13.1%**（24/183） | ≥8% | ✅ |

补充：全局策略分布 = `recounting 106 (57.9%)` / `resistance 33 (18.0%)` / `affective_exploration 24 (13.1%)` / `simple_response 20 (10.9%)`。

### 4.1 按角色的策略分布（本批最有诊断价值的一段）

| 角色 | 依恋 | trust | safety | 轮数 | 探索 | 阻抗 | recounting |
|---|---|---|---|---|---|---|---|
| 安然 secure | secure | 0.65 | 0.70 | 24 | **24（100%）** | 0 | 0 |
| 晚晴 anxious | anxious | 0.32 | 0.35 | 24 | **0** | 0 | 24 |
| 小满 anxious | anxious | 0.30 | 0.35 | 24 | **0** | 0 | 24 |
| 语桐 anxious | anxious | 0.35 | 0.40 | 24 | **0** | 0 | 20 |
| 沉舟 avoidant | avoidant | 0.18 | 0.20 | 24 | **0** | 20 | 1 |
| 念安 avoidant | avoidant | 0.25 | 0.25 | 20 | **0** | 0 | 7 |
| 亦舟 avoidant | avoidant | 0.22 | 0.25 | 24 | **0** | 13 | 11 |
| 惊尘 disorganized | disorganized | 0.10 | 0.10 | 19 | **0** | 0 | 19 |

**这张表是结构性证据**：探索决策要求 `trust ≥ 0.65 且 safety ≥ 0.70`（逐字稿 rationale 里的门槛数字），而除安然外 7 个角色的标定值最高只有 0.35 / 0.40 —— **物理上不可达**。所以：
- 探索率 100% 集中在安然一个人身上；
- 7 个角色被永久锁在 recounting 或 resistance；
- anxious 三角色 trust 0.30~0.35，永远不会产生阻抗也不是探索（它们落在 recounting），所以"anxious 0%/0%"是必然结果，与接线无关。

这也同时解释了 P1d 遗留的 L1（主导标签命中率 47.2%）与 L4（讨好维度恒 0%）—— 同源。

---

## 5. PASS / FAIL 判读（按任务单 §3.5 逐条对照）

**PASS 条件**：
- ❌ anxious 三角色至少 1 个破 0% 阻抗或 0% 探索 —— 三个全 0，且是门槛不可达导致（非接线）
- ✅ anxious 文本通道至少有命中 —— 三角色台词指纹块 + 依恋块均命中
- ❌ 探索率 ≥15% —— 13.1%
- ✅ recounting ≤60% —— 57.9%
- ✅ degraded ≤25% —— 18.8%

**结论：FAIL（3 条达标 / 2 条未达标，且未达标项是同一根因）。**

按 §3.5 的 FAIL 分支定义——"anxious 还是 0%/0% → 接线还是没通，回去查"——本批的实测已经推翻了这条归因：接线通了（8 角色命中率 15/16 场，剩 1 场是 LLM 全失败），0%/0% 来自探索门槛与基线数值的冲突。**这是一条需要拍板的方向性结论，不是可以自己改代码收掉的 bug。**

---

## 6. 改动文件清单

本单原设计是"纯验证单，不改业务代码"。实际执行中阶段 A 首轮 FAIL 并定位到装配漏登记，经用户授权接手修复，故 `src/` 有改动：

| 文件 | 改动 | 状态 |
|---|---|---|
| `src/engine-adapters/wiring/engine-turn.service.ts` | options 类型加 `verbalVoice`；`registry.register` 加条件展开登记 | 未提交 |
| `src/admin-debug/debug-session.service.ts` | 新建 / 恢复两处 `engine.open` 各加条件展开登记 | 未提交 |
| `test/engine-adapters/wp-j-p2-verbal-voice-wiring.spec.ts` | 新建 11 例（渲染 2 / 零回归 1 / 透传 2 / 装配 2 / 端到端 1 / 源码扫描 3） | 未提交 |
| `src/engine-core/**` | **零改动** | — |

- `npx vitest run` 两个 spec：**2 files / 21 tests passed, exit 0**
- `npx eslint --fix` 三个文件：`eslint_exit=0`，零输出
- `npx tsc -p tsconfig.build.json --noEmit`：`tsc_exit=0`
- `npx tsc -p tsconfig.build.json`：`build_exit=0`

临时脚本（`bin/tmp-enqueue-verify-smoke.ts`、`bin/tmp-poll-batch.ts`、`bin/tmp-count-vv.ts`、`bin/tmp-check-vv-db.ts`）由 MiniMax 创建、本轮复用，**收尾时已全部删除**；`.tmp-verify-3100.out` / `.tmp-verify-3100.err` 同批删除。仓库根目录仅剩 `.tmp-annotations.json`（来源未确认，未动）。

---

## 7. 风险与遗留

1. **并发实际值 = 3，不是任务单要求的 1**。3000 端口是 `nest start --watch` 常驻服务（PID 32860 / 27392，11:59:43 启动），其 worker 在 `onModuleInit` 里无条件 `new Worker`，`.env` 未设 `AUTO_PRACTICE_WORKER_CONCURRENCY` → 用默认 2；3100 侧设 1。**两个实例抢同一 Redis 队列，实际并发 3**。全程未杀 3000（遵守红线）。
2. **1 场 LLM 全失败**：惊尘/expert `llm_call_turns=0`、`render_fallback_turns=7`、`tokens=0`，被判 stagnant 退场。这是 LLM 侧连续失败（疑似限流/额度），不是停滞判定误报。**所以 stagnant 1/16 不能算"标签回来了"，它是 LLM 故障的副产物。**
3. **prompt_version 本批全落库**（16/16 = `f1fdb4f90a5e622a`），与之前 1135/1136 条 NULL 形成对照 —— 值得单独确认是哪个改动带来的（本轮没碰这块代码）。
4. **`gate_decisions` 仍然 0 行**，本批也没写入。P1c/P1d 的"合规编码侧"证据依旧缺动态数据。
5. **角色可分辨度 / 危机单次披露未取到**：前者依赖标签命中率算法（不是策略分布），后者需要人工核"是否同一披露"，本批都没做，按任务单要求如实标注。
6. **pre-existing 遗留未动**：L2 `counterConsistent` 用合计列（协议变更需拍板）、L4 讨好维度 0%、L5 `render_fallback_ratio` 派生列。

---

## 8. 建议下一步

**不建议直接开 P4 100 场。** 按 §3.5 是 FAIL，且 FAIL 的根因不在接线。

优先级建议：
1. **拍板探索门槛与基线的匹配关系**（最高优先）。三条路选一条：
   - (a) 门槛按角色基线缩放（如 `trust ≥ 基线 trust + 0.2`），最贴合"差异化"设计意图；
   - (b) 把 8 角色基线的 trust/safety 整体抬到能过门槛的量级（会削弱"差异化"，且改变已验收的标定表）；
   - (c) 承认只有 secure 能探索、其余角色是"长程阻抗"设计，改验收指标而不是改代码。
2. **在拍板前，anxious 0%/0% 不要再当作"接线坏了"去查** —— 本次已用 8 角色 × 2 模式、183 轮、命中计数四种方式交叉证明接线是通的。
3. `prompt_version` 为何本批突然全落库，值得单独查一次（可能是一个已修好的旧缺口，也可能只是这条路径刚好覆盖）。
4. 惊尘/expert 那场 LLM 全失败，建议单独重跑 1 场确认是瞬时限流还是该角色配置问题。
5. P4 100 场前置仍是三条：第二家 chat provider 的 key、探索门槛拍板、`gate_decisions` 有写入。

---

## 附：归档与现场

- 逐字稿归档：`data/archives/debug-sessions-verify-route1-p1d-2026-11-10/`（16/16 份，**移动**而非拷贝）
- 批次元数据：`data/debug-sessions/_batches/verify-route1-p1d-2026-11-10.json`、`...-smoke-2026-11-10-r2.json`（阶段 A）
- 3100 实例已关（HTTP 探活 `unreachable`，进程 9484 已终止；3000 仍 `status=404` 正常在跑）
- `data/debug-sessions/` 份数：跑前 59 → **收尾后 59**（16 份已移入归档目录）

## 附 2：§8 回写清单核对

| 项 | 结果 |
|---|---|
| 交付记录写到固定路径 | ✅ |
| 任务单移入 `completed/phase2.5/` 并改状态行 | ✅ |
| `phase2.5-wp-list` 两行回写 | ✅（verbal_voice 补动态验收 / P1d 改"已执行 FAIL + 根因"） |
| `phase2.5-README` §3 表格两行回写 | ✅ |
| `git diff --stat HEAD -- src/engine-core` 为空 | ✅ 空 |
| `src` / `test` 无既有文件改动 | ❌ **有 2 个 src 文件改动 + 1 个新测试**（阶段 A 接线修复，用户授权，见 §6） |
| 3100 已关 | ✅ |
| `data/debug-sessions` 份数恢复 | ✅ 59 |
| 临时脚本 / 临时目录已删 | ✅ |
| 一行 commit message 草稿（不自己 commit） | ✅ 已给（见对话） |
