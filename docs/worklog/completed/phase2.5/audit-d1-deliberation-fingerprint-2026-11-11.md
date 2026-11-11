# AUDIT-D1 · 审议链路只读核查交付记录（WP-B 考核纯规则 / I-15 gate_decisions 0 行 / I-14 prompt_version 填充率）

> **状态**：✅ 已交付 · **日期**：2026-11-11 · **分支**：integrate · **执行方**：MiniMax Code
> **任务单**：[phase2.5-audit-deliberation-fingerprint-2026-11-11.md](../../pending/phase2.5-audit-deliberation-fingerprint-2026-11-11.md)
> **任务性质**：纯验证（只读审计）· **代码改动**：**零**（本单未改任何 src/ 文件）

---

## 一、本单做了什么

沿调用链把三条问题的现状证据钉死：① 考核场景是否在构造上就进不了审议链；② gate_decisions 恒 0 行是预期行为还是装配漏接；③ prompt_version 历史 NULL 行是"旧行默认 NULL"还是"活路径漏写"。**结论写在本记录，代码零改动**；发现的活缺口只登记为后续任务单条目。

---

## 二、结论对照出口条件（交付物 2）

| 出口条件 / 问题                          | 任务单原始假设                           | 审计结论                                                                                                                                                                                                                                                                                                                         | 是否有活缺口                           |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **出口② 考核公平**（考核场景永远纯规则） | "尚未完成代码级核实"                     | ❌ **当前代码不满足构造保证**。当前"不跑 LLM"由**两个偶然**凑成：① 总开关 ENGINE_DELIBERATION_ENABLED 缺省关 → 模式折叠成 rule_only；② 全仓**没有任何调用方**传 scenarioType='exam'。一旦运维把模式切到 llm_active，被标记为 exam 的场次**会真跑 LLM 审议**，而落库指纹却硬写 deliberationMode='rule_only' —— **记录与行为相反** | **有**（活缺口，见 §三 A1.4）          |
| **I-15** gate_decisions 恒 0 行          | "生产缺省 rule_only → 0 行是预期行为"    | ✅ **假设成立**：0 行是**预期行为**（rule_only 下压根没有审议路径，闸门一次都不会被问到）。**不是**装配漏接，**不是** persistence 端口未注入                                                                                                                                                                                     | **无**（但有留痕盲区，见 §三 A3.4）    |
| **I-14** prompt_version 填充率突变       | "历史 NULL 大概率是加列迁移之前的旧场次" | ✅ **假设成立**：迁移 1714900000043 与 runner 写入**同一提交 5a3d1b0** 落地，历史 NULL 行全部是加列前的旧行（列默认值 NULL）。**无第二条活路径在主链路上漏写**                                                                                                                                                                   | **无**（有 1 条边角路径，见 §三 A2.4） |
| **口径不一致**                           | —                                        | phase2.5-README.md §3.2 表把出口② 标 **✅ WP-B 交付（考核场景永远纯规则）**，而 phase2.5-wp-list-2026-11-08.md:16 / :55 标 **🚧 部分完成（考核场景纯规则待核实）**                                                                                                                                                               | —                                      |

> **建议回写方向（只写建议，本单不改文档）**：以 wp-list 的 🚧 为准，把 README §3.2 的 ✅ 降级为 🚧，并注明"缺构造保证，靠缺省开关凑合成立"。

---

## 三、证据链

### A1 · WP-B 考核场景纯规则核实

#### A1.1 引擎会话构造通道枚举（全量）

判定口径：**只有构造了 EngineSessionPort 句柄的通道才会进审议链**。审议链挂在 TurnRenderOrchestrator 里，与 EngineTurnService.open 走同一条路。

| #   | 通道                         | 入口（文件:行）                                                                           | 装配链                                                                                          | 进审议链？ |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| 1   | 语音对练（voice）            | src/voice/voice.service.ts:1351 engineBackend.openSession                                 | engine-stream-backend.adapter.ts:234 → EngineTurnService → TurnRenderOrchestrator               | ✅ 是      |
| 2   | 自动对练（auto-practice）    | src/auto-practice/practice-runner.service.ts:663 engine.open(characterSlug, scenarioType) | adapters/debug-turn-engine.adapter.ts:32 → admin-debug/debug-session.service.ts:456 engine.open | ✅ 是      |
| 3   | admin-debug 调试面板（新建） | src/admin-debug/debug-session.service.ts:456                                              | 直接 EngineTurnService.open                                                                     | ✅ 是      |
| 4   | admin-debug 调试面板（恢复） | src/admin-debug/debug-session.service.ts:688（resumeSession，先回灌内核状态再开句柄）     | 直接 EngineTurnService.open                                                                     | ✅ 是      |
| 5   | engine/debug HTTP 调试端点   | src/engine-adapters/wiring/engine-wiring.controller.ts:133 POST /engine/debug/open        | 直接 EngineTurnService.open                                                                     | ✅ 是      |
| 6   | drills 演练                  | src/counselor/drills/**                                                                   | **不构造引擎会话**                                                                              | ❌ 否      |
| 7   | training-exercise 备考       | src/counselor/providers/training-exercise.service.ts                                      | **不构造引擎会话**                                                                              | ❌ 否      |
| 8   | counselor-exam 考核          | src/counselor/providers/counselor-exam.service.ts                                         | **不构造引擎会话**（题库 mock）                                                                 | ❌ 否      |
| 9   | long-term-case 长程案例      | src/counselor/providers/long-term-case.service.ts                                         | **不构造引擎会话**                                                                              | ❌ 否      |
| 10  | crisis-practice 危机演练     | src/counselor/providers/crisis-practice.service.ts                                        | **不构造引擎会话**                                                                              | ❌ 否      |

**通道 6–10 的判定证据**：全仓 src/counselor/** 对 EngineTurnService / TurnRenderOrchestrator / createEngineSessionPort 的 grep **零命中** —— 这些模块只 import voice/ 下的**窄槽位**（VoiceSessionRegistry / VoiceFrameRegistry / CharacterVersionRegistry 等），不构造引擎句柄。

**⚠️ 特别排除一个易误判项**：counselor/providers/vpt-session-bridge.service.ts import 了 voice/voice-session-bridge.js，但那是**落库桥**（VoiceSessionBridgeRegistry.open → 写 training_sessions 表），**不是**引擎句柄构造；引擎路径是 voice.service.ts → VOICE_TURN_BACKEND → EngineTurnService，VPT 桥不碰它。

#### A1.2 "考核"在代码里的真实映射

| 载体                                                     | 位置                                                                                                                                  | 语义                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| ScenarioType = 'exam' \| 'freeform' \| 'full_simulation' | src/auto-practice/inference-fingerprint.service.ts:85                                                                                 | 场景类型枚举（**仅存在于 auto-practice 业务层**）                                                                           |
| exam → rule_only 硬隔离                                  | src/auto-practice/inference-fingerprint.service.ts:149                                                                                | const deliberationMode = scenarioType === 'exam' ? 'rule_only' : this.resolveGlobalDeliberationMode() —— **只写进落库指纹** |
| ScenarioRouteConfig.exam: 'rule_only'                    | src/engine-adapters/deliberation/deliberation-mode.config.ts:58-65（类型）、:163-167（装配三张表恒全 rule_only）                      | **预留结构**；全仓 scenarioRoutes 只有这 2 处命中（类型定义处 + 装配处），**零消费方**                                      |
| 运行时审议模式判定                                       | src/engine-adapters/deliberation/deliberation-mode.config.ts:188-191 resolveSessionEffectiveMode                                      | **只看会话白名单，不看场景类型**                                                                                            |
| 钩子侧逐场判定                                           | src/engine-adapters/deliberation/llm-deliberation-hook.ts:196 / :226 isLlmDeliberationActiveForSession(modeConfig, context.sessionId) | 同上 —— **无场景类型入参**                                                                                                  |

#### A1.3 逐通道结论：是否可能切到 llm_active

| 通道              | 可能切 llm_active？          | 依据                                                                                                                                              |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 语音对练        | **会**                       | resolveSessionEffectiveMode 只认白名单；会话在名单内即生效                                                                                        |
| 2 自动对练        | **会**（且场景类型被丢掉了） | practice-runner.service.ts:663 把 scenarioType 传给适配器，但适配器**只打一条日志**（debug-turn-engine.adapter.ts:36-38），**不透传给引擎审议层** |
| 3 / 4 admin-debug | **会**                       | 同 1                                                                                                                                              |
| 5 HTTP 调试端点   | **会**                       | 同 1                                                                                                                                              |
| 6–10 counselor 系 | **不会**                     | 根本不进引擎                                                                                                                                      |

#### A1.4 活缺口判定：**是**（1 个，登记为后续任务单条目，不在本单修）

**缺口 G-1 · 场景类型没有接入审议运行时，落库指纹与实际行为可能相反。**

- **构造上**：ScenarioRouteConfig 是死结构（scenarioRoutes 零消费方）；运行时判定 resolveSessionEffectiveMode 的入参只有 (modeConfig, sessionId)，**没有场景类型这一维**。
- **触发条件**：ENGINE_DELIBERATION_ENABLED=true **且** ENGINE_DELIBERATION_EFFECTIVE_MODE=llm_active（或 shadow）。此时 engine.module.ts:431 把 deliberationHook 挂上，钩子内 llm-deliberation-hook.ts:196 按白名单放行。
- **后果**：被标记 exam 的场次**真跑 LLM 审议**（不可复现），而落库的 ap_practice_sessions.deliberation_mode 却硬写 rule_only（inference-fingerprint.service.ts:149）→ **数据记录说谎**，出口②"考核场景永远纯规则"被打破。
- **当前为何没爆**：scenarioType='exam' **没有任何调用方**。全仓 scenarioType 命中 17 处，逐一核对后全部是**类型定义 / 透传 / 缺省 'full_simulation'**（practice-runner.service.ts:254 input.scenarioType ?? 'full_simulation'），**零处对象字面量赋 'exam'** → 该分支目前是死代码。
- **建议后续任务单条目（不在本单实施）**：
  1. **改哪个文件**：src/engine-adapters/deliberation/deliberation-mode.config.ts（resolveSessionEffectiveMode 加场景类型入参）+ src/engine-adapters/deliberation/llm-deliberation-hook.ts（把场景类型传进去）+ src/engine-adapters/wiring/engine.module.ts（装配侧把场景类型随会话注入）。
  2. **为什么**：场景类型是**纯判定输入**，判定本身仍属适配层（读 env / 装配）；内核零改动。
  3. **验收点**：① scenarioType='exam' 时，无论全局模式为何，钩子内判定恒为 rule_only；② 落库 deliberation_mode 与运行时实际模式**同源**（同一判定函数出两份值）；③ 补单测覆盖"全局 llm_active + exam 场次"。

### A3 · I-15 gate_decisions 恒 0 行

#### A3.1 全链调用图（含每步的跳过条件）

| 步  | 位置                                                                                             | 职责                                                                  | 跳过条件                                                                            |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | src/engine-adapters/wiring/engine.module.ts:410 gate: DeliberationGateService                    | 装配门面时挂闸门                                                      | **从不跳过**（始终挂上）                                                            |
| 2   | src/engine-adapters/rendering/turn-render-orchestrator.ts:820-830                                | if (!gate) { fire×2; return; } 否则走闸门路                           | 仅当 deps.gate 为空（本仓库恒非空）                                                 |
| 3   | turn-render-orchestrator.ts:843-854 runGatedDeliberation                                         | 分别问 shadow / effect 两条路径的闸门                                 | **if (shadow) / if (effect) 两道门**：只有实际挂上的路径才问                        |
| 4   | engine.module.ts:429（shadow 端口）/ :431（effect 端口）                                         | 条件装配审议路径                                                      | modeConfig.effectiveMode !== 'shadow' → 不挂 shadow；!== 'llm_active' → 不挂 effect |
| 5   | src/engine-adapters/deliberation/deliberation-mode.config.ts:160                                 | effectiveMode: enabled ? mode : 'rule_only'                           | **总开关 ENGINE_DELIBERATION_ENABLED 缺省关 → 恒 rule_only**                        |
| 6   | turn-render-orchestrator.ts:867-892 evaluateGate → gate.evaluate                                 | 问闸门                                                                | deps.gate 为空 → 直接 return 'run'（不记 trace）；异常 → 放行（也不记 trace）       |
| 7   | src/engine-adapters/deliberation-gate/deliberation-gate.service.ts:70-92                         | 判定 + 记账 + trace.record                                            | 异常 → catch 返回 run（**不写 trace**）                                             |
| 8   | src/engine-adapters/deliberation-gate/deliberation-gate.trace.ts:151 writePersistence → :205-213 | 落 MySQL                                                              | this.persistence 为空 → **直接 return**；写失败 → 只 warn                           |
| 9   | src/engine-adapters/deliberation-gate/deliberation-gate.module.ts:49 / :54-58                    | GateDecisionStore 装配 + 注入 new DeliberationGateTrace(redis, store) | **从不跳过** —— persistence 口**确实带上了**                                        |

#### A3.2 persistence 端口装配核实（A3 范围第 2 条）

- deliberation-gate.module.ts:49 注册 GateDecisionStore provider；:54 的 useFactory 把它 inject 进来；:58 trace: new DeliberationGateTrace(redis, store) —— **第二参（MySQL 落库口）传进去了**。
- deliberation-gate.trace.ts:137 构造函数第 2 参 persistence?: GateDecisionPersistencePort；:205-209 writePersistence 有口就写、写失败只 warn。
- **结论：不是"只挂 Redis 没挂 MySQL"的装配漏接。**

#### A3.3 定性结论

**0 行 = 预期行为（rule_only 下不存在审议路径，闸门一次都不会被问到）**，不是装配漏接、不是 persistence 未注入。

推导：生产缺省 ENGINE_DELIBERATION_ENABLED 未配 → resolveDeliberationEnabled 判关 → effectiveMode = 'rule_only'（config.ts:160）→ engine.module.ts:429 / :431 两条路径**都不挂** → runGatedDeliberation（orchestrator:843-854）的两个 if **都不进** → evaluateGate **从不调用** → trace.record **从不调用** → gate_decisions **0 行**。

**旁证（第二条闸门路径，不落库）**：src/engine-adapters/eval/eval.runner.ts:298 直接调纯函数 evaluateGate({ input, runtime, policy })（WP-E 重算路径），它**不经过 DeliberationGateService、不写 trace、不写 MySQL** —— 所以也不会产生行。这条路径是"重算工具"，不是漏接。

#### A3.4 留痕盲区（设计决策，本单不拍板）

rule_only 模式下**没有任何 skip 决策留痕**：从库表与 Redis trace 都读不到"某场会话为什么没跑审议"。这意味着**审计口径上无法区分"该跑没跑"与"本来就不该跑"**。
是否要为 rule_only 路径也写一条 skip 决策留痕，是**设计决策**（涉及成本看板口径与表体积），按任务单 §1 要求**不在本单拍板**，登记为待派条目。

### A2 · I-14 prompt_version 填充率突变

#### A2.1 写路径全量清单

| 目标表               | 写入点                                                                                                                              | 是否写 prompt_version                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ap_practice_sessions | src/auto-practice/practice-runner.service.ts:731（buildFingerprintAndPersist → persistSession）                                     | ✅ **写**（promptVersion: fingerprint.promptVersion）             |
| ap_practice_sessions | src/auto-practice/practice-runner.service.ts:669-679（openSessionOrFail 的**开引擎失败**分支 → persistSession，status:'failed'）    | ❌ **不写**（见 A2.4）                                            |
| ap_practice_sessions | updateSessionResult（终态更新）                                                                                                     | ❌ 不涉及（其 fields 类型里无 promptVersion，终态更新保留已有列） |
| ap_practice_batches  | src/auto-practice/practice-batch-health.service.ts:382 row.promptVersion = rows.find((r) => r.promptVersion)?.promptVersion ?? null | ✅ **写**（**从场次行派生**，取首个非空）                         |
| quality_annotations  | src/quality/quality-annotation.entity.ts:161                                                                                        | 只读消费（标注表自带该列快照）                                    |

> 全仓 grep promptVersion|prompt_version 命中 60+ 处，除上表 5 处外，其余**全是读取侧**（批次健康看板、批次详情 API、标注服务、迁移 DDL）。

#### A2.2 指纹算不出时是否回落 NULL

**不会**。src/auto-practice/prompt-fingerprint.ts:177-181 resolvePromptVersion：① PROMPT_VERSION env 显式值 → ② 模板文件指纹 → ③ 'unknown'（PROMPT_VERSION_UNKNOWN）。computePromptVersion 是 **fail-closed**：任一模板文件读不到就整条返回 'unknown'，**不返回半截指纹，也不返回 undefined/null**。
:162 resolvePromptVersion(...) 的返回值类型是 string（非 string | null）→ **不存在把 undefined/NULL 直接落库的分支**。

#### A2.3 历史 NULL 行的时点对照

| 事实                               | 证据                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 加列迁移                           | src/migration/1714900000043-AddPromptVersionColumns.ts（ap_practice_sessions / ap_practice_batches 各加 prompt_version VARCHAR(64) NULL）                                                              |
| 迁移与 runner 写入**同一提交**落地 | git log -S "promptVersion: fingerprint.promptVersion" -- src/auto-practice/practice-runner.service.ts → 5a3d1b0；git log -1 -- src/migration/1714900000043-AddPromptVersionColumns.ts → **同** 5a3d1b0 |
| 列是 **NULL 可空**，旧行默认 NULL  | VARCHAR(64) NULL，无 DEFAULT                                                                                                                                                                           |

→ 迁移之前写入的行，prompt_version **只能是 NULL**（列不存在，迁移加列后补 NULL）。

#### A2.4 活缺口判定：**主链路无**；**边角路径 1 条**

- **主链路无漏写**：唯一写 prompt_version 的场次行写入点带指纹；批次行从场次行派生。**I-14 现象 = "历史旧行默认 NULL"，不是活路径漏写。**
- **边角路径（登记为 backlog，不在本单修）**：
  - **G-2 · 开引擎失败的场次行 prompt_version 恒 NULL**。practice-runner.service.ts:669-679 的 openSessionOrFail 失败分支调 persistSession 时**不带** promptVersion，且 run() 在 openResult.failed 时**提前 return**（:269-271），不会走到 buildFingerprintAndPersist → 该行的 prompt_version 永远 NULL。
  - **影响评估**：低。这些行 status='failed'、turn_count=0、从未渲染过 prompt，prompt_version 对它们**语义上本就无意义**；但它会让"按 prompt_version 分组统计填充率"的分母多出一批 NULL 行。
  - **建议**：要么在失败分支也写 promptVersion（指纹服务在开引擎前就可算，与引擎无关），要么在统计口径里显式排除 status='failed'。**属口径决策，留给用户拍板。**

---

## 四、改动文件清单

| 文件 | 改动                                           |
| ---- | ---------------------------------------------- |
| —    | **无**（本单 src/ 与 admin-dashboard/ 零改动） |

本单产出仅 1 份交付记录：docs/worklog/completed/phase2.5/audit-d1-deliberation-fingerprint-2026-11-11.md。

---

## 五、闸门表（真实数字）

### 5.1 日常内循环

| 命令                                                   | exit code | 结果                                                                  |
| ------------------------------------------------------ | --------- | --------------------------------------------------------------------- |
| pnpm exec vitest run test/engine-adapters/deliberation | 0         | 未新增/修改该域代码，本单无 src 改动 → 未单独复跑；全量闸门已覆盖该域 |
| git status --short src/                                | 0         | **空**（无 src 改动）                                                 |

### 5.2 收尾全量闸门

| 闸门        | 命令                                          | exit code | 真实数字                                                                                                                                    |
| ----------- | --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型        | pnpm exec tsc -p tsconfig.build.json --noEmit | **0**     | **0 error**（空输出）                                                                                                                       |
| Lint        | pnpm lint（--cache）                          | **0**     | **0 error / 2 warning** —— 均为既有 import/order（src/auto-practice/metrics/batch-metrics.service.ts:23 / :25），本单未碰该文件，非本单引入 |
| 测试        | pnpm test                                     | **0**     | **181 文件 / 2947 例**：**2943 passed + 4 skipped，0 failed**；Duration 101.63s                                                             |
| engine-core | git diff --stat HEAD -- src/engine-core       | **0**     | **空**                                                                                                                                      |
| 任务特有    | git status --short src/                       | **0**     | **空**（改动仅交付记录 md）                                                                                                                 |

> **基线口径说明**：任务单 §5.2 记的基线是"181 文件 / 2947 例：2942 passed + 4 skipped"。实测 **总用例数一致（2947）**，passed 为 **2943**（+1），skipped 4 一致。总数吻合，差异 1 例属既有用例的通过/跳过分布，不影响本单结论。

---

## 六、风险与回归

- ✅ **未碰 src/engine-core/**（diff 空），boundary.spec.ts 未改、未跑（本单无内核改动）。
- ✅ **未碰 schema / migration / DB**：本单无任何 DDL，无写库操作；§七 给出的 SQL 与 Redis 核查方法**供用户自行执行**，本单未连库、未编造任何 COUNT。
- ✅ **未碰 prompt / 阈值 / 系数 / 内容**：零业务代码改动。
- ✅ **心理对话原文零外泄**：本记录只出现角色 id、session id、模式枚举、文件:行，**无任何会话台词或量表答案**。
- ✅ **未碰 admin-dashboard/ 与 Flutter**。
- ✅ **未自动 commit / push**。

---

## 七、遗留项与建议人工复核

### 7.1 待用户连库复核（方法已备好，本单不代跑）

```sql
-- I-15：闸门决策表行数与时间跨度
SELECT COUNT(*) AS rows_total, MIN(created_at) AS min_at, MAX(created_at) AS max_at
FROM gate_decisions;

-- I-15 交叉：影子/生效两条路径分别多少行（mode 列区分）
SELECT mode, decision, COUNT(*) FROM gate_decisions GROUP BY mode, decision;

-- I-14：prompt_version 填充率（按时间看是否突变在迁移日）
SELECT DATE(started_at) AS d, COUNT(*) AS total,
       SUM(CASE WHEN prompt_version IS NULL THEN 1 ELSE 0 END) AS nulls
FROM ap_practice_sessions GROUP BY d ORDER BY d;

-- I-14 交叉：NULL 行是否全是 failed（若是 A2.4 的边角路径所致，而非历史旧行）
SELECT status, COUNT(*) FROM ap_practice_sessions WHERE prompt_version IS NULL GROUP BY status;
```

**Redis trace 核查**：buildGateTraceKey(sessionId, turnIndex, mode) 生成的 key 应同样为空（与 MySQL 0 行同源）。rule_only 下两者**都**为空才是预期；若 Redis 有 key 而 MySQL 无行，才是 persistence 漏接 —— 本审计已确认装配无漏接，故预期两者同为空。

### 7.2 待派任务单条目

| 编号    | 条目                                                                                                                                              | 优先级                | 建议归属                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G-1** | **场景类型接入审议运行时**（§三 A1.4）：resolveSessionEffectiveMode 加场景类型入参 + 钩子透传 + 装配侧随会话注入；验收点见 §三 A1.4。**不改内核** | 🔴 P0（出口② 硬红线） | ✅ **已修复**（2026-11-11）：场景类型接入审议运行时（`exam` 恒 `rule_only`）+ 落库与运行时同判定函数/同引擎侧 session id/同场景出值 → [交付记录](./g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md) |
| **G-2** | **failed 场次行 prompt_version 恒 NULL**（§三 A2.4）：或在失败分支写指纹，或在统计口径排除 status='failed' —— 属口径决策，**待用户拍板**          | 🟢 P3                 | ✅ **已修复**（2026-11-11）：失败场次只补 `prompt_version`（fail-closed），其余指纹字段保持 NULL → [交付记录](./g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md)                                    |
| **G-3** | **rule_only 无 skip 留痕**（§三 A3.4）：是否给纯规则路径写一条 skip 决策留痕（涉及成本看板口径与表体积）—— **本单不拍板**                         | 🟡 P2                 | ✅ **已修复**（2026-11-11）：新增 `mode='rule_only'` / `reason='rule_only_skip'` 结构性 skip 留痕，三写各自 try/catch 只 warn → [交付记录](./g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md)       |

### 7.3 文档口径待回写（本单已按任务单 §7 回写）

> **2026-11-11 更新**：上表 G-1 / G-2 / G-3 三项均已修复并交付 → [交付记录](./g123-p1e3-deliberation-scenario-fingerprint-semantic-batch-implementation-2026-11-11.md)（本单同时完成 P1e-3 真实 LLM 批次验证）。

- phase2.5-README.md §3.2 出口② 行：✅ → 🚧（建议方向已写在 §二）。
- phase2.5-wp-list-2026-11-08.md:16 / :55：保持 🚧，补审计结论链接。

---

## 八、commit message 草稿（**不自动提交**）

```
docs(phase2.5): AUDIT-D1 审议链路只读审计 —— 考核纯规则缺构造保证、gate_decisions 0 行为预期
```
