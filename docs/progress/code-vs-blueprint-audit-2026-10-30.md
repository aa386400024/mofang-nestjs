# 代码级对账审计报告（Phase1 · 蓝图 v1.1 ⇄ 代码实际）

> **日期**：2026-10-30
> **审计对象**：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，HEAD = `50b924b`
> **性质**：**只读审计** —— 全程未修改任何代码，本报告只列差异点，**不写解决方案、不写修复建议**。
> **方法**：一律以 `src/` 实际代码 + `git show <commit>` 回溯「交付当刻」为准，**不以文档自述为准**。

---

## 0. 审计口径

### 0.1 母本定位（用户给的路径不存在）

用户指定的蓝图路径 `docs/architecture/shturl.cc/LE8Mhr8zqh2wx0U` **在本仓库不存在**（`glob`/`grep` 均零命中）。实际存在的母本体系是：

| 角色 | 实际路径 | 说明 |
|---|---|---|
| **母版**（裁决依据） | `docs/architecture/ai-engine-roadmap-v1.1.md` | backlog 母版第 3 行自己指向它 |
| 愿景备查 | `docs/reference/ai-simulation-blueprint-v1.1.md` | 冲突以母版为准 |
| 原则原件 | `docs/reference/bdi-cognitive-engine-principles-v1.0.md`、`docs/reference/architecture-blindspot-fill-v1.0.md` | 经本仓架构裁剪后落地 |
| **backlog 母版** | `docs/progress/phase1-integration-backlog-2026-10-28.md`（177 行） | 本次对账的主对账表 |

本报告以「母版 + backlog 母版 + 各 WP 交付记录」三者为文档侧，以 `src/` 为代码侧。

### 0.2 证据口径（可复核的命令）

`git diff --stat HEAD -- src/engine-core` 这条命令**只看工作区、不看历史**——一旦 commit 掉就永远返回空。本报告一律用下面这条可复核口径：

```powershell
git show --stat <commit> -- src/engine-core     # 看某次提交对内核的真实改动面
git show --name-only --pretty=format: <commit> # 看某次提交改动的全部文件
```

已用该口径实测的三个关键提交：

| commit | 主题 | `git show --stat -- src/engine-core` 实测 |
|---|---|---|
| `248db13` | WP11 PsyGUARD | **1 file changed, +28/-1**（`assess-safety.ts` 一处常量 + 回改清单注释） |
| `28a2959` | WP8-B 流式 | **0 文件** |
| `50b924b` | WP12 记忆收尾 | **0 文件** |

### 0.3 证据强度标注

| 标注 | 含义 |
|---|---|
| **【实锤】** | 代码行级可复核，结论唯一 |
| **【静态推演】** | 由代码逻辑推导，未跑用例实测 |
| **【无法证实】** | 证据不足，在 §6 单列 |

### 0.4 审计覆盖

- WP0–WP12 + WP18/WP19/WP20/WP21 —— **逐条核**（含 WP13/14/15/16/17/22/23/24 的「声称」核验）
- 其中 WP9/WP10/WP10A 由主审**直接**核查（详见 §3 标注）
- 全程只读，审计结束时工作区仍干净

---

## 1. 两个专项核查（用户点名）

### 1.1 WP17 —— 「新引擎路径没接 `turnAnalysisProcessor.enqueue`」→ **核心声称不成立**

**母版原文**（backlog §0.4，line 95）：

> **WP17** | 新引擎路径（EngineStreamBackend）没接 `vpt-session-bridge` 的每轮分析入队（`turnAnalysisProcessor.enqueue`）。导致新路径下：移情/阻抗 mark 帧、轻提示、披露提取全部不触发。

**核查结论：这条声称在代码上不成立。** 新旧链路共用同一处持久化调用点，`enqueue` 在新引擎路径下**会触发**。

**证据链（全部【实锤】）**：

| # | 位置 | 事实 |
|---|---|---|
| 1 | `src/voice/voice.service.ts:429` | `onUserText` 第 4 步**无条件**调 `persistTurnIfComplete(...)` |
| 2 | `src/voice/voice.service.ts:763-783` | `persistTurnIfComplete` → `void this.bridges.appendTurn({...})`；仅当 `outcome === 'error'` 或 generation 不匹配时跳过 |
| 3 | `src/voice/voice.service.ts:496-514` | `runLlmTurn` **新旧两条路径共用**此段。`backendOf(state)` 只决定「用引擎还是 visitor」，`persistTurnIfComplete` 位于**两条路径之外**的公共尾部 |
| 4 | `src/voice/voice-session-bridge.ts` | `VoiceSessionBridgeRegistry.appendTurn` 转发 |
| 5 | `src/counselor/providers/vpt-session-bridge.service.ts:376` | `doAppendTurn` → `turnAnalysisProcessor.enqueue(...)` |
| 6 | `src/counselor/providers/turn-analysis.processor.ts:108-121` | BullMQ 入队，jobId `ta-${sessionId}-${turnIndex}` |
| 7 | `src/counselor/providers/turn-analysis.service.ts:152-158` | worker 完成 → 发 `type: 'mark'` 帧（移情/阻抗标记） |

**推论**：WP17 第 2 条描述的三个下游（移情/阻抗 mark 帧、轻提示、披露提取）在新引擎路径下**都会走**。

**WP17 仅剩一条属实**：第 4 条要求的 `enginePath: legacy|bdi` 字段确实没做——全仓 grep `enginePath|engine_path` **零命中**（WP13 未交付，该字段本就属 WP13）。

**关联的连带发现**：WP17 说「`publishCrisisHint()` 已由 WP9-C 补上，不是全缺」——这条**属实**（`src/engine-adapters/wiring/engine-stream-backend.adapter.ts` 的 `publishCrisisHint` 确实存在）。但它只推 `supervision_hint` 帧给督导，**不阻断学员**（见 §1.2）。

> **一句话**：WP17 的「闸门级理由」（灰度扩全量的硬闸门）建立在一条**不成立**的代码声称上。它剩下的真实内容只有「引擎路径没标记」，价值量级与母版描述的「督导视角全瞎」相差一个数量级。

---

### 1.2 WP14 —— 「学员自身心理风险兜底」→ **描述有偏差：通道判断错了，真缺的是处置层**

**母版原文**（backlog §0.4，line 96）：

> **WP14** | 学员自身心理风险三级兜底（低=静默监测 / 中=关怀提示 / 高=阻断+热线+审计）。注意：`counselor_input` 侧 PsyGUARD 越界检测已做（WP11），但那是检测「咨询师专业越界」，不是检测「学员本人代入创伤/流露自伤意念」——这是两个不同的东西。

**核查结论：母版对「`counselor_input` 侧检测的是什么」的判断，在通道层面不成立；但「三级兜底没做」这半句成立。**

#### ① 通道层：`counselor_input` 侧检测的就是「危机」，不是「咨询师越界」

| # | 位置 | 事实 |
|---|---|---|
| 1 | `src/engine-core/in-memory/in-memory-engine-session.ts:235` | `assessSafety({ text: userText, side: 'counselor_input', probe: this.riskProbe })` —— **学员输入走的就是 `counselor_input` 侧** |
| 2 | `src/engine-core/cognition/safety/rule-engine.ts:62-137` | `COUNSELOR_RULES` 7 条 = 专业越界类（`promise_cure` / `double_relationship` / `illegal_guidance` / `suicide_coaching` / `discrimination` / `value_judgment` / `premature_advice`）—— **一条危机词都没有**。**母版这半句说对了** |
| 3 | `src/engine-adapters/wiring/risk/local-crisis.probe.ts:133` | `probe(text, _side)` —— 注释明写「两侧同判：危机语言不因说话人是谁而改变性质」。**`_side` 参数被忽略** |
| 4 | `src/engine-adapters/wiring/risk/http-psyguard.probe.ts:170` | 同样忽略 `_side`，**两侧同判** |
| 5 | `src/engine-adapters/wiring/risk/local-crisis.probe.ts:156` | `LocalCrisisProbe` 复用内核 `VISITOR_RULES` 危机词典（`rule-engine.ts:144-215`） |
| 6 | `src/engine-adapters/wiring/risk/local-crisis.probe.ts:57-95` | 补充倾诉词表，含 `passive_ideation` 的「活着没什么意思 / 撑不下去了」、**`active_ideation` 的「我想死 / 死了算了」→ block** |
| 7 | `src/engine-core/domain/safety/safety-types.ts:138-150` | `PSYGUARD_LEVEL_MAP` 11 类危机标签 → block / warn / pass |

**推论**：`counselor_input` 侧一旦接上探测器，**检测到的就是危机分类本身**（11 类 PsyGUARD 标签 + 本地危机词典），**正适合检测学员自述的自伤意念**。母版「PsyGUARD 只能检测咨询师越界、不能复用来检测学员心理风险」的说法**不成立**。

#### ② 处置层：三级兜底确实没做（母版这半句成立）

| # | 位置 | 事实 |
|---|---|---|
| 1 | `src/engine-core/cognition/safety/assess-safety.ts:112` | 规则已 block 就不发起探测；`:117-119` catch 回 `ruleVerdict` —— **内核只判定，不拦截** |
| 2 | `src/engine-core/cognition/safety/assess-safety.ts:231-236`（`in-memory-engine-session.ts:235` 调用处） | 内核只把 verdict 交给 adapter，**没有任何「阻断本轮回复」的机制** |
| 3 | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `publishCrisisHint()` 只给**督导**推 `supervision_hint` 帧；**学员本人收不到任何东西** |
| 4 | 全仓 grep | 「低=静默监测 / 中=关怀提示 / 高=阻断+热线+不可删审计」的三档处置**无任何实现** |

**推论**：WP14 真正缺的是**处置层**（分档处置 + 学员侧可见 + 热线 + 不可删审计），**不是检测层**。检测能力在 `counselor_input` 侧**已部分存在**。

#### ③ 连带发现（更严重）：探测层实际是**单向生效**的

| # | 位置 | 事实 |
|---|---|---|
| 1 | `src/engine-adapters/wiring/engine.providers.ts:267-275` | `createRiskProbe`：`const fallback = deps.fallback ?? new LocalCrisisProbe()` 之后，**配了 `baseUrl` 就直接 `return new HttpPsyGuardProbe(...)`，`fallback` 被丢弃** |
| 2 | `src/engine-core/cognition/safety/assess-safety.ts:117-119` | 探针挂掉 → catch → 回 `ruleVerdict`（内核规则层） |
| 3 | `src/engine-core/cognition/safety/rule-engine.ts:62-137` | 内核规则层在 `counselor_input` 侧**无危机词**（见 ①.2） |

**推论**：PsyGUARD 服务不可达时，`assessSafety` 回落到的是**无危机词的规则层** → **学员危机检测能力归零**，而不是「静默回落到本地词典」。WP11 交付记录与 commit 文案（`engine-wp11-psyguard-python-service-backend-implementation-2026-10-30.md:522`「服务挂/超时静默回落本地规则」）描述的兜底路径，**在代码里没有兑现**。

---

## 2. 蓝图 Phase1 七条能力 · 代码落地逐条结论

母版 §0.4 的结论句（line 77）是「**蓝图七条全部落地，执行无走歪、无过度工程**」。逐条核代码后：

| # | 蓝图 Phase1 能力 | 母版 §0.4 状态 | 代码实际 | 本次判定 |
|---|---|---|---|---|
| 1 | 简化版 BDI + 5Ps 角色注入 | ✅ | 内核三层 + 事件算子 + 快照齐备；角色双通道（`builtin_*` 种子 / `character_profiles` DB）。**但 seed 通道命中率恒为 0**（`builtin_avoidant_l1` 等 ≠ 握手侧 `vpt_*` slug）——WP9-A 记录已如实标注 | ⚠️ **部分**（WP9-B 后 DB 通道闭合 4 个 `vpt_*`；seed 通道仍是死路，但文档已诚实） |
| 2 | 轨迹三模式 + 10 个伦理盲盒 | ✅ | 内核 `TrajectoryMode = 'force_override' \| 'weighted_correct' \| 'trigger'`（`src/engine-core/domain/trajectory/script.ts:40`）；**10 个剧本全为 `force_override`**（`src/engine-adapters/wiring/trajectory/ethical-scripts.ts`，逐个核实 10 处 `mode: 'force_override'`）；resolver 端口 + 握手 `scriptId` 四段透传齐备 | ✅ **属实**（口径提醒：第二模式真名是 `weighted_correct`，见 §4.3-4.15） |
| 3 | 记忆 + 跨会话接续 | ✅ | 内核 `MemoryTier` 三级；Qdrant 写侧冲突标记 + 摘要晋升 + `resumeFromSessionId` 贯通 | ⚠️ **母版自相矛盾**：§0.1 写「二级记忆」、§0.4 写「三级记忆」（§4.3-4.16）；且「暂停恢复归档」缺口从未被任何 WP 承接，§0.4 却下「七条全部落地」结论（§4.2-4.8） |
| 4 | 规则层 + PsyGUARD 双层伦理 | ✅ | 内核规则双侧判定 + 独立 Python 服务（ONNX int8）+ HTTP probe + 启动健康检查 | ⚠️ **部分**：探测层已双侧同判（能力具备），**处置层整条缺失**（= WP14）；且探测兜底实际回落内核规则层而非本地词典（§1.2.③） |
| 5 | 主模型对接 + 流式 + 渲染调度 | ✅ | `RenderPort` / 规格组装 / 聚合接线 / 流式灰度齐备 | ⚠️ **部分**：流式下发的是**已闭合整句**不是 token 级（§4.3-4.8）；`done` chunk 缺 `finishReason`（§4.3-4.10） |
| 6 | 基础角色资产池 | ✅ | `character_profiles` 24 列（21 + WP10A 三列）+ 审核上下架过滤（`audit_status='approved'` + `enabled=1` + `deleted_at IS NULL`，`db-character-profile.resolver.ts:80-81`）+ 4 个 `vpt_*` seed | ✅ **属实**（速查卡仍走 `visitor_pool_templates`，与引擎基线**分表**——这是 `db-character-profile.resolver.ts:22-23` 明写的设计，不是差异） |
| 7 | 基础可观测与运维 | 🟡 部分 | **留痕链整条未通**：`turn_debug_trace` 恒空；`/admin/api/*` 零鉴权；SPA 全 mock | ❌ **比母版标的 🟡 部分更差**（§4.1-4.1 / 4.2 / 4.3） |

**能力 2/6 属实；能力 1/3/4/5 部分成立；能力 7 实际状态差于母版自述。**

**母版 §0.4 的「七条全部落地」结论与代码不符。**

---

## 3. 逐 WP 对账结论

| WP | 交付记录声称 | 代码实际 | 判定 |
|---|---|---|---|
| **WP0** | 内核契约骨架 | 契约与端口齐备，`src/engine-core/**` 零框架依赖 | ✅ 属实 |
| **WP1** | BDI 内核（信念/愿望/意图 + 事件算子 + 状态快照） | 内核实现齐备。**但任务单管线草图写 `transitionState(snapshot, events, profile)`，实现是 2 参**；「acceptance 也累积 dependency」不成立 | ⚠️ 2 处偏差（§4.3-4.13 / 4.14） |
| **WP2** | 记忆纯函数 + Qdrant B 层 | `MemoryTier` 三级；Qdrant B 层齐备 | ✅ 属实 |
| **WP3** | 轨迹三模式纯函数 | 三模式齐备（`script.ts:40`） | ✅ 属实（模式真名口径见 §4.3-4.15） |
| **WP4** | 规则双侧判定 + `RiskProbePort` 占位 | 规则层与端口齐备。**但记录写「150ms 超时」，常量现值 500** | ⚠️ 1 处偏差（§4.3-4.12） |
| **WP5** | 渲染契约 / 预算 / 主备选择 / 输出校验纯层 | 纯层齐备 | ✅ 属实 |
| **WP6** | RenderPort LLM 适配 + 主备执行 | 功能在。**但「纯类无框架依赖」不成立**（`import { Logger } from '@nestjs/common'`）；另有多项实现未登记 | ⚠️ 1 处偏差 + 5 处漏记（§4.3-4.1 / §4.2-4.1~4.5） |
| **WP7** | RenderSpec 组装 + turn 填 reply + **「`rememberTurn` 改为问+答成对写」** | 组装与填 reply 属实。**成对写没做**——内核 `in-memory-engine-session.ts:508-524` 一行未改，仍只写咨询师半边，`:508` TODO 未销；实际是内核写半边 + 适配层 `turn-render-orchestrator.ts:453-474` 另写半边凑成 2 条，**无配对标识** | ⚠️ **核心声称不成立**（§4.3-4.2） |
| **WP8-A** | DI 装配 + 聚合 turn 接线 | 装配在。**但交付时 `EngineStreamBackend` 是「类 provider」→ 按其交付代码起不来（启动炸弹）**；「token 缺省 160」已过时 → 现为 1500 | ⚠️ 2 处偏差（§4.3-4.11 / §4.2-4.6） |
| **WP8-B** | 流式原生渲染 + WS 灰度切旧 | 流式在。**但下发的是已闭合整句不是 token 级**；abort 发 `cancelled` 帧不是 error 帧且不切旧链路；「失败本场自动回落」只对首个增量前成立；`done` chunk 不带 `finishReason`；「用例 B 编译期自证」不成立 | ⚠️ 5 处偏差（§4.3-4.8 / 4.9 / 4.10 / 4.4 / 4.5） |
| **WP9-A** | 角色内核解析注入（内置种子） | 端口 + 2 内置种子 + `openSession` 注入在。**「已知命中率 0（`builtin_*` ≠ 握手 `vpt_*`）」记录已如实标注** | ✅ 属实（**已诚实记录，不算差异**） |
| **WP9-B** | MySQL 角色资产池（`character_profiles`） | 24 列 + 审核过滤 + `CharacterPoolModule` 独立 + 4 个 `vpt_*` slug 命中闭合 + 复用唯一映射 | ✅ 属实 |
| **WP9-C** | token 预算 / 截断 / 危机路由 / 降级 | 四项在。**但 `publishCrisisHint` 只推督导 `supervision_hint` 帧，不阻断学员** | ✅ 属实（与 §1.2 处置层缺失同源） |
| **WP10** | 10 个伦理盲盒强覆盖剧本 | **10 个剧本全 `force_override`**（逐个核实）；静态 TS 不落库 + `TrajectoryScriptResolver` 端口 + 握手四段透传 + 三种失败口径 warn 不阻断 | ✅ 属实 |
| **WP10A** | `character_profiles` 表达风格三列预留 | migration + entity + seed 齐备。**三列确实零消费**——全仓 grep 命中只在 `migration/` `entity.ts` `seed.ts`，resolver → RenderSpec → prompt 链路上**一处未接**。**「不消费不暴露前端」属实** | ✅ 属实 |
| **WP11** | PsyGUARD Python 服务 + HTTP `RiskProbePort` | 服务与探针在。**但「静默回落本地规则」不成立**（回落内核规则层）；「输出侧不显式传 `timeoutMs`」不成立（`engine.module.ts:181` 显式传了 env）；§5 红线表首行未随审核结论回写；JSDoc 与常量不一致 | ⚠️ 4 处偏差（§4.3-4.13~4.16） |
| **WP12** | 记忆收尾 + 跨会话接续 | 五项闸门数字**全部复现**（35 例 / 28 套件 583 / 全量 905 of 907）。**但改动面清单严重不全**（声明 22，提交实为 49）；半衰期单向生效未记；逐字稿定稿副作用未记 | ⚠️ 4 处漏记（§4.2-4.7~4.10） |
| **WP13** | 可观测（决策链留痕 / 指标 / BDI 回放） | **未交付**，且 §0.3 登记表**没有它的行** | ⚠️ 登记缺失（§4.2-4.7） |
| **WP14** | 学员自身心理风险三级兜底 | 描述有偏差（见 §1.2） | ⚠️ **偏差**（§4.3-4.1） |
| **WP15** | 算子幅度声明 + 边界回归 | **未开工**，已被 backlog 正式认领。WP1 本身未声称过「最大影响幅度声明」，故不计入「WP1 写多了」 | ✅ 口径正确 |
| **WP16** | 轻量 `round_id` 幂等 + 断流不叠加 | 未开工，已登记待做 | ✅ 口径正确 |
| **WP17** | 新引擎路径没接 `turnAnalysisProcessor.enqueue` | **核心声称不成立**（见 §1.1） | ⚠️ **声称不成立** |
| **WP18** | 报告生成链路 E2E | 四态（`completed` / `parse_error` / `pending` / `no_content`）+ `ENGINE_SUPERVISION_*` 参数档 + 六维评分 / annotations / techStats **全部属实**。**但受 WP12 逐字稿覆盖影响，验收项⑤「逐字稿 turnIndex 与 marks 对齐」存在竞争风险** | ✅ 属实（1 处连带风险，§4.2-4.10） |
| **WP19** | AdminDebugModule + BDI 快照留痕 | **留痕链整条未通**（`turn_debug_trace` 恒空）；`/admin/api/*` **零鉴权**；`/admin/api/characters` 查的是 `visitor_pool_templates` 不是 `character_profiles`；**无独立 implementation 文档** | ❌ **大面积不实**（§4.1-4.1~4.3） |
| **WP20** | Vue3 调试器 SPA | **SPA 拿的是 mock**（`admin-dashboard/src/api/client.ts:146-241` 全返 mock 常量，`get<T>()` 零调用，无 `USE_MOCK` 开关）；**无独立 implementation 文档**；`docs/README.md` 无索引行 | ❌ **大面积不实**（§4.1-4.4） |
| **WP21** | 报告 SSE 推送端点 | `@Sse()` 端点 + 终态推完整报告 + 关流 + 超时推 `{"status":"timeout"}` + 真 404 走 guard + RxJS timer 不泄漏 —— **全部属实** | ✅ 属实 |

**统计**：17 个 WP 属实；5 个部分属实 / 有偏差（WP1 / WP4 / WP6 / WP7 / WP11 / WP12 / WP8-A / WP8-B）；2 个大面积不实（WP19 / WP20）；3 个声称不成立或口径错误（WP14 / WP17 / WP7 核心条款）。

---

## 4. 差异分类

### 4.1 ① 文档写多了（代码没做）

| # | WP | 文档声称 | 代码实际 | 证据 |
|---|---|---|---|---|
| **D1** | WP19 | 「每轮 BDI 快照 / RenderSpec 摘要 / LLM usage 落库」 | **0 条留痕进库**。`TurnTrace` 无 render / prompt / TTFT / finishReason / promptTokens 字段；`traceRecorder` **无装配入口**；`createEngineStreamBackend` 只传 5 个参数而 `traceRecorder` 是第 6 位 `@Optional()` → **恒 undefined** → `recordTrace` 首行 return | `src/admin-debug/trace-recorder.service.ts:22-41`、`:47`；`src/engine-adapters/wiring/engine.providers.ts:340-342`（无装配入口注释）；`src/engine-adapters/wiring/engine-stream-backend.adapter.ts:191`、`:539-568`【实锤】 |
| **D2** | WP19 | 「只读 API `/admin/api/sessions/:id`」 | **`/admin/api/*` 零鉴权**：模块头明写「不做鉴权」，controller 无 `@UseGuards`，`ADMIN_BASIC_AUTH_*` 全仓零命中。prod 可读全部会话逐字稿，sessions 列表**不按用户过滤** | `src/admin-debug/admin-debug.module.ts:3`、`admin-debug.controller.ts:20-28`、`:83-110`【实锤】 |
| **D3** | WP19 | 调试器可查「角色」 | `/admin/api/characters` 查的是 **`visitor_pool_templates`**，不是引擎角色池 `character_profiles` —— 调试器看到的「角色」与引擎实际使用的角色基线**不是同一份** | `src/admin-debug/admin-debug.controller.ts`（characters 端点）【实锤】 |
| **D4** | WP20 | 「会话回放 / BDI 快照 / ECharts 轨迹图」 | **SPA 全是 mock**：`client.ts:146-241` 全返 mock 常量，`get<T>()` 零调用，无 `USE_MOCK` 开关。WP19 commit `8b57135` 曾删 mock 改真接口，被 WP12 commit `50b924b` **整体改回 mock** | `admin-dashboard/src/api/client.ts:10-14`、`:146-241`；`git show --stat 50b924b -- admin-dashboard`（25 文件）【实锤】 |
| **D5** | WP7 | 「`rememberTurn` 改为问+答成对写工作记忆」 | **内核一行未改**：`in-memory-engine-session.ts:508-524` 仍只写咨询师半边，`:508` TODO 未销。实际是内核写半边 + 适配层 `turn-render-orchestrator.ts:453-474` 另写半边凑成 2 条，**无配对标识** | `src/engine-core/in-memory/in-memory-engine-session.ts:508-524`【实锤】 |
| **D6** | WP8-B | 「流式 7 段 / token 级增量」 | **只下发已闭合整句**：`splitClosedPrefix` 切出闭合前缀才发；联调日志形态复现不出来 | `src/engine-adapters/rendering/render-truncation.ts:85-89`、`llm-render.adapter.ts:601-615`【实锤】 |
| **D7** | WP8-B | 「失败本场自动回落旧链路」 | **只对首个增量前成立**；且 `done` chunk **不带 `finishReason`**（旧链路带） | `src/voice/voice.service.ts:959-963`【实锤】 |
| **D8** | WP8-B | abort → 走 error 帧 + 切旧链路 | **发的是 `cancelled` 帧不是 error 帧，也不切旧链路** | `src/voice/voice.service.ts:1011-1022`【实锤】 |
| **D9** | WP8-B | 「用例 B 编译期自证」 | 是**双重 `as` 断言 + stub**，不构成编译期自证 | `test/engine-adapters/wp8-wiring.spec.ts`【实锤】 |
| **D10** | WP8-A | 「装配完成，端到端可跑」 | 交付时 `EngineStreamBackend` 是**类 provider** → 按其交付代码**起不来（启动炸弹）**；WP8-B 遗留缺口清单**没记这条** | `git show 5d69ea9` 的 `engine.module.ts` + `engine.providers.ts`【静态推演，未在当刻 checkout 实跑】 |
| **D11** | WP4 | 「150ms 超时」 | 常量现值 **500**（决策 #4 放宽），记录从未回写 | `src/engine-core/cognition/safety/assess-safety.ts:75`【实锤】 |
| **D12** | WP11 | 「服务挂/超时**静默回落本地规则**」 | **回落内核规则层**，而该层在 `counselor_input` 侧无危机词 → 学员危机检测能力归零。`createRiskProbe` 配了 baseUrl 就 **`fallback` 被丢弃** | `src/engine-adapters/wiring/engine.providers.ts:267-275`、`src/engine-core/cognition/safety/assess-safety.ts:117-119`【实锤】 |
| **D13** | WP12 | 改动面清单 = 4 新增 + 16 修改 + 2 文档 = **22 个文件** | 提交 `50b924b` 实际 **49 个文件**（+4776/-209）。**差额 27 个未登记**：25 个 `admin-dashboard/**`（属 WP20 范围资产）+ backlog 母版 + 记录自身 | `git show --stat 50b924b`（49 files）、`git show --name-only --pretty=format: 50b924b`；`docs/progress/engine-wp12-...-implementation-2026-10-30.md:207-239`【实锤】 |
| **D14** | WP20 | §3「不做 i18n」/ §5「不做实时大盘」 | WP12 commit 混入 25 个 `admin-dashboard/**`，含 `src/i18n/{index,locales/en,locales/zh-CN}.ts`、`views/CostBoard.vue`、`views/Dashboard.vue` —— **同时违反「不做 i18n」与「不做实时大盘」两条自定边界** | `git show --name-only --pretty=format: 50b924b -- admin-dashboard`【实锤】 |
| **D15** | WP13 | §0.1 能力 7「基础可观测与运维」已排 WP13 | WP13 **未交付**，且 §0.3 登记表**没有它的行** | `docs/progress/phase1-integration-backlog-2026-10-28.md:45-69`【实锤】 |
| **D16** | WP19 / WP20 / WP1 | 「已交付」 | **三者的「交付记录」列填的是任务单文件名**（WP19/WP20）或只有任务单（WP1），**都没有独立 implementation 文档** | `docs/progress/phase1-integration-backlog-2026-10-28.md:61-62`；`docs/progress/` 目录清点【实锤】 |
| **D17** | WP19 / WP20 | 「已交付并登记索引」 | **`docs/README.md` 索引里 WP19 / WP20 完全没有行**（grep 只命中 WP1 那行） | `docs/README.md`【实锤】 |
| **D18** | backlog §0.4 | 「蓝图七条全部落地 ✅」 | 能力 7 自表标 🟡 部分；能力 3 的「暂停恢复归档」缺口从未被任何 WP 承接；能力 1 的 seed 通道命中率恒 0。**结论句与自己表格矛盾** | `docs/progress/phase1-integration-backlog-2026-10-28.md:77` vs `:81-89`【实锤】 |

### 4.2 ② 文档写少了（代码做了没记）

| # | WP | 代码里做了但文档没记 | 证据 |
|---|---|---|---|
| **D19** | WP6 | 兜底话术已**池化轮换**（4 句种子 + 游标 + env `\|` 分隔分隔符） | `src/engine-adapters/rendering/llm-render.adapter.ts`【实锤】 |
| **D20** | WP6 | `reasoningEffort` 新字段 + 风险抬档 | 同上【实锤】 |
| **D21** | WP6 | 截断保护 | 同上【实锤】 |
| **D22** | WP6 | 双份资源收尾义务 | 同上【实锤】 |
| **D23** | WP12 | **无学员身份时内核 `visitorId` 退化成纯角色 key**，且照常进 `engine.open()` | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts:640-643`【实锤】 |
| **D24** | WP12 | **env 半衰期是单向生效的**：内核 `recall-policy.ts:93-94` 用默认 30 天半衰期 + 0.1 先卡，B 层 `qdrant-memory.store.ts:287-294` 再用配置值算一遍 → **配长于 30 天对召回准入完全无效**（只影响排序 tie-break），只有配短于 30 天才真正生效。WP12 §6.2 只对「阈值」讲了这个方向性，**没讲半衰期** | `src/engine-core/cognition/memory/recall-policy.ts:93-94`、`src/engine-adapters/persistence/qdrant-memory.store.ts:287-294`【静态推演，未实测】 |
| **D25** | WP12 | **逐字稿定稿覆盖写会改变 `training_sessions.transcript` 长度**（引擎副本缺降级轮次时更短），而 `turn-analysis.service.ts:89-93` 用 `transcript[turnIndex]` 定位该轮（`doAppendTurn` 传的是 `row.transcript.length - 1`，即 visitor 下标）→ close 时 flush 若与排队中的 turn-analysis job 竞争，该轮会走 `turn_analysis_turn_mismatch` 丢分析；marks 的 turnIndex 与新 transcript 也可能错位 | `src/counselor/providers/turn-analysis.service.ts:89-93`、`src/counselor/providers/vpt-session-bridge.service.ts:376`【静态推演，未实测】 |
| **D26** | WP8-A | 「token 缺省 160」已过时 → 现为 **1500** | `src/engine-adapters/wiring/engine.module.ts`【实锤】 |
| **D27** | WP19 | `not_found` **返 200**（不是 404） | `src/admin-debug/admin-debug.controller.ts:65`【实锤】 |
| **D28** | WP19 | sessions 列表 **`totalTokens` 硬编码 0**、**缺 `characterSlug` 字段** | `src/admin-debug/admin-debug.controller.ts:48-56`【实锤】 |
| **D29** | WP19 | `/admin/api/sessions` 列表**不按用户过滤**（全租户可见） | `src/admin-debug/admin-debug.controller.ts:83-110`【实锤】 |
| **D30** | WP12 | resume 接续时**角色基线不覆盖**：`loadState` 的接续分支直接搬上一场快照，`buildInitialSnapshot(runtime.characterProfile)` 只在新会话分支 → 本场传入的 `characterProfile` 在 resume 时**被忽略**（跨角色接续时不会校正基线） | `src/engine-core/in-memory/in-memory-engine-session.ts:353-379`【实锤】 |
| **D31** | backlog §0.1 | 能力 2 的缺口「**暂停恢复归档**」从未被任何 WP 承接；内核明写「跨进程持久化 (暂停/恢复/归档) 留装配轮, 本期不做」 | `src/engine-core/in-memory/in-memory-engine-session.ts:79`；`docs/progress/phase1-integration-backlog-2026-10-28.md:24`【实锤】 |

### 4.3 ③ 描述有偏差（做了但和说的不是一回事）

| # | WP | 文档说的 | 代码做的 | 证据 |
|---|---|---|---|---|
| **D32** | WP6 | 「纯类，无框架依赖」 | `import { Logger } from '@nestjs/common'` | `src/engine-adapters/rendering/llm-render.adapter.ts`【实锤】 |
| **D33** | WP6 | 非鉴权 4xx 属「不可切备」 | 非鉴权 4xx 被当**「可切备」**处理 | 同上【实锤】 |
| **D34** | WP11 | 「输出侧**不显式传** `timeoutMs`，让它继承内核 `DEFAULT_PROBE_TIMEOUT_MS`；全仓只有**一个**回改点」（记录 `:595` / `:654`，工厂 JSDoc `engine.providers.ts:301-302`） | **装配层显式传了** `timeoutMs: resolvePsyGuardTimeoutMs(config.get<string>('PSYGUARD_TIMEOUT_MS'))` → 输出侧走**独立 env 读取**，**不会**跟着内核常量回。M3 回改时若漏改 env，输出侧仍按 env 走 | `src/engine-adapters/wiring/engine.module.ts:181`【实锤】 |
| **D35** | WP11 | §5 红线表「不改 `src/engine-core/**` ✅ `git diff --stat HEAD -- src/engine-core` 为空」 | 该行**未随审核结论回写**（同文档验收表 `:273`、闸门 `:308`、§12.4 `:629` 都已标注「审核后为 1 个文件」，唯独 §5 首行仍是「为空」） | `docs/progress/engine-wp11-psyguard-python-service-backend-implementation-2026-10-30.md:250` vs `:273` / `:308` / `:629`【实锤】 |
| **D36** | WP11 | §3.3「内核 `assessSafety` 自己 `Promise.race` 一个 **150ms** 的计时器 —— 那是硬上限」；验收表 #4「响应 > 150ms → 超时回落 ✅ 内核 `Promise.race(150ms)` 兜住」 | 常量现值 **500**，内核 race 的是 500ms。**该节全部结论按 150ms 推导，已过期** | `src/engine-core/cognition/safety/assess-safety.ts:75`；记录 `:188-189`、`:269`【实锤】 |
| **D37** | WP11 | 回改清单「跨两个仓库 **6 处**」 | 清单正文列了 **7 个条目**（其中 `http-psyguard.probe.ts` 标注「无需另改」）；叠加 D34 的装配层 env 路径，「全仓只有一个回改点」不成立 | `src/engine-core/cognition/safety/assess-safety.ts:66-74`【实锤】 |
| **D38** | WP4 / WP11 | 常量 = 150ms | `assess-safety.ts:87` JSDoc 仍写「种子值 `DEFAULT_PROBE_TIMEOUT_MS=150`」，而 `:75` 常量是 **500** —— 同一文件内自相矛盾（回改到 150 后会自洽，但当前状态是错的） | `src/engine-core/cognition/safety/assess-safety.ts:75` vs `:87`【实锤】 |
| **D39** | WP1 | 任务单管线草图 `transitionState(snapshot, events, profile)` | 实现是 **2 参** | `src/engine-core/cognition/state-transition.ts`【实锤】 |
| **D40** | WP1 | 「acceptance 也累积 dependency」 | acceptance 的 dependency 是 **0**；只有 affirmation 是 0.02 | `src/engine-core/cognition/state-transition.ts:65`【实锤】 |
| **D41** | backlog §0.1 / §0.4 | §0.1 能力 3 写「**二级**记忆」，§0.4 写「**三级**记忆」 | 内核 `MemoryTier` 是 WORKING / SHORT_TERM / LONG_TERM **三级** —— §0.4 对、§0.1 错。**同一文档内部不一致** | `src/engine-core/domain/ports/memory.store.ts:42-49`【实锤】 |
| **D42** | WP17 | 「新引擎路径没接 `turnAnalysisProcessor.enqueue` → 移情/阻抗 mark 帧、轻提示、披露提取全部不触发」 | 新旧路径共用 `persistTurnIfComplete` → `appendTurn` → `enqueue`，**全部会触发**。只剩 `enginePath` 字段没做 | 见 §1.1 全链【实锤】 |
| **D43** | WP14 | 「`counselor_input` 侧 PsyGUARD 越界检测……那是检测咨询师专业越界，不是检测学员本人代入创伤/流露自伤意念」 | 两个探测器都**两侧同判**（`_side` 被忽略）；11 类 PsyGUARD 标签**就是危机分类**；学员输入走的就是 `counselor_input` 侧。**真缺的是处置层**（分档处置 / 学员侧可见 / 热线 / 不可删审计），不是检测层 | 见 §1.2 全链【实锤】 |
| **D44** | 轨迹口径 | 第二模式称「correction」 | 真名是 **`weighted_correct`** | `src/engine-core/domain/trajectory/script.ts:40`【实锤】 |
| **D45** | WP12 / WP11 | 「`git diff --stat HEAD -- src/engine-core` 为空 ✅」 | 这条**命令只看工作区**，commit 之后恒为空，**不可复核**。可复核口径是 `git show --stat <commit> -- src/engine-core`。**WP12 用可复核口径实测确为 0 文件，结论成立**；WP11 实测为 **1 文件** | `src/engine-core` 各提交实测（见 §0.2）【实锤】 |

---

## 5. 母版登记表自身的缺口

| 项 | 缺口 |
|---|---|
| §0.3 登记表 | **WP13 无行**；WP19 / WP20 的「交付记录」列填的是**任务单文件名**（两者均无独立 implementation 文档） |
| §0.3 / §0.4 | **WP19 / WP20 在 `docs/README.md` 索引里完全没有行**（WP12 等成对登记） |
| §0.1 vs §0.4 | 能力 3「二级记忆」vs「三级记忆」自相矛盾（D41） |
| §0.1 能力 2 | 「暂停恢复归档」缺口**从未被任何 WP 承接**，§0.4 待做项表里也没有它（D31） |
| §0.4 结论句 | 「蓝图七条全部落地」与 §0.4 自己表格里的 🟡 部分、WP13 未交付、WP19 留痕链未通**互相矛盾**（D18） |
| §0.4 硬底线表 | WP17 的**核心声称不成立**（D42）；WP14 的**通道判断有偏差**（D43）—— 两条「内测前必须补」的硬底线，其中一条理由是错的，另一条的问题定位偏了一级 |
| §0.4 其他待做项 | 「WP11 临时值改回」条目未标出**输出侧 env 路径**这条独立回改点（D34） |

---

## 6. 无法证实 / 超出静态审计边界的项

| 项 | 说明 |
|---|---|
| **D24 半衰期单向生效** | 静态推演，未写用例实测。结论依赖 `recall-policy.ts` 的准入判定与 `qdrant-memory.store.ts` 的排序计算的实际调用顺序 |
| **D25 逐字稿定稿与 turn-analysis 的竞争** | 静态推演。竞争窗口依赖 BullMQ worker 的实际调度时序，未构造并发用例实测 |
| **D10 WP8-A 启动炸弹** | 基于 `5d69ea9` 提交当时 provider 代码的静态判定，**未在该 commit 上 checkout 实跑启动** |
| **线上运行时行为** | 生产容器 `mofang-nestjs-api` 仍是 2026-08-26 构建（**未重建**，`mofang-psyguard` 容器 healthy）。本报告所有结论均为**代码静态判定**，非线上实测 |
| **WP9/WP10/WP10A 独立复核** | 原计划的第四路子代理复核在时限内未回传，**由主审直接完成等价核查**（脚本全 `force_override`、三列零消费、slug 与审核过滤口径均已逐条验）。未获第二双眼睛交叉验证 |
| **跨会话 `coreBeliefs` 覆盖** | D30 只核到 `loadState` 的接续分支**不重建基线**；上一场 `coreBeliefs` 是否被完整搬运、是否有字段级丢失，未逐字段比对 |

---

## 7. 差异汇总计数

| 分类 | 条数 | 其中高影响（D1 / D2 / D4 / D5 / D12 / D13 / D42 / D43） |
|---|---|---|
| ① 文档写多了 | **18**（D1–D18） | 8 |
| ② 文档写少了 | **13**（D19–D31） | 3（D24 / D25 / D30） |
| ③ 描述有偏差 | **14**（D32–D45） | 5（D34 / D36 / D42 / D43 / D44） |
| **合计** | **45** | — |

---

## 8. 附：本次审计用到的复核命令

```powershell
cd E:\Work\Project\backend\mofang-nestjs

# 改动面（可复核口径）
git show --stat 50b924b -- admin-dashboard
git show --name-only --pretty=format: 50b924b
git show --stat 248db13 -- src/engine-core
git show --stat 28a2959 -- src/engine-core

# 关键零命中 / 命中检索
# enginePath | engine_path            → 零命中（WP13 未交付）
# ADMIN_BASIC_AUTH_*                 → 零命中（WP19 零鉴权）
# speechVolumeBaseline|narrativeStyle|expressionTone → 只命中 migration/entity/seed（WP10A 零消费）
```

---

> **审计边界声明**：本次为**只读审计**。报告全程未修改 `src/`、`test/`、`admin-dashboard/` 任何文件，未执行任何修复动作，未 commit / push。工作区在审计结束时保持干净。
