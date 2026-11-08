# 代码级对账审计报告（Phase2 · 蓝图 v1.1 + 混合式 BDI 蓝图 v1.0 ⇄ 代码实际）

> **日期**：2026-11-08
> **审计对象**：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，HEAD = `bde6d8f`
> **性质**：**只读审计** —— 全程未修改任何代码，本报告只列差异点，**不写解决方案、不写修复建议**。
> **方法**：一律以 `src/` 实际代码 + `git show <commit>` 回溯「交付当刻」为准，**不以文档自述为准**。
> **目的**：为 **Phase3 混合式 BDI 灰度切换**（规则兜底 + LLM 审议并行）做基础盘点。

> 🆕 **2026-11-08 文档收尾补记（只更正计数口径，不动本报告任何核实结论）**：本报告 §3 与 §5.4 N10 写的「Phase2 实际 **36/42**」中，**分母 42 是误计** —— 登记表 `phase2-wp-list.md` 逐行数是 **43 条 WP**（WP27–WP69 无缺号 / 无重复 / 无幽灵条目；§9 复核命令里的「43 行」已隐含这一点，但统计表的三档枚举**漏了 WP65**）。本报告 G1 段实测的「**43 行、36 个带 ✅**」是准确的，**结论不变**；变的只是**计数口径**：
>
> | 口径 | 本报告原写 | 更正后（2026-11-08 文档收尾） |
> |---|---|---|
> | Phase2 WP 总数 | 42 | **43**（三档枚举补 WP65 = 🔴 P0） |
> | 已完成 | 36（表格实际带 ✅ 数） | **38**（补标 WP60 / WP62 两行的 ✅） |
> | 未完成 | 7（WP27 / WP29 / WP33 / WP39 / WP40 / WP60 / WP62） | **5**（WP27 / WP29 / WP33 / WP39 / WP40 —— 商业化 / 合规，已移 Phase4） |
>
> 母版侧已同步更正：[`phase2-wp-list-2026-11-03.md`](../pending/phase2-wp-list-2026-11-03.md) · [`ai-engine-roadmap-v1.1.md`](../../architecture/ai-engine-roadmap-v1.1.md) §9 · [`phase2-overview-2026-11-03.md`](../pending/phase2-overview-2026-11-03.md)，详见[交付记录](../completed/phase2/phase2-docs-tidy-up-implementation-2026-11-08.md)。**本报告其余全部核实结论（N1–N14 / G1–G3 / R1–R12 / B / P / D 域）一字未改** —— 补记只更正计数口径，不推翻任何证据。

---

## 0. 审计口径

### 0.1 母本定位

任务单 §2.1 指定三层对照，本次实际涉及**四个**母本（第三层「蓝图」是两份文档，Phase3 需求只在其中一份里）：

| 角色 | 实际路径 | 说明 |
|---|---|---|
| **母版**（裁决依据 · 阶段演进） | `docs/architecture/ai-engine-roadmap-v1.1.md` | §7 伦理安全分层 / §9 阶段演进 |
| **Phase3 需求母版** | `docs/architecture/hybrid-bdi-agent-blueprint-v1.0.md` | §2 三层分离 / §3 十三个边界 / §6 演进路线 / §7 红线提醒 |
| 愿景备查 | `docs/reference/ai-simulation-blueprint-v1.1.md` | 冲突以 roadmap 为准 |
| **backlog 母版** | `docs/worklog/pending/phase2-overview-2026-11-03.md` + `phase2-wp-list-2026-11-03.md` | 本次对账的登记表 |
| 交付记录 | `docs/worklog/completed/phase2/`（96 个文件 = 48 任务单 + 48 交付记录） | 每个 WP 的实际交付内容 |

### 0.2 证据口径（可复核的命令）

`git diff --stat HEAD -- src/engine-core` 只看工作区、不看历史 —— commit 掉就永远返回空。**本报告一律用可复核口径**：

```powershell
git show --stat <commit> -- src/engine-core     # 看某次提交对内核的真实改动面
git show --name-only --pretty=format: <commit> # 看某次提交改动的全部文件
```

### 0.3 证据强度标注

| 标注 | 含义 |
|---|---|
| **【实锤】** | 代码行级可复核，结论唯一 |
| **【静态推演】** | 由代码逻辑推导，未跑用例实测 |
| **【无法证实】** | 证据不足，在 §7 单列 |

### 0.4 审计覆盖

- 任务单 §4 重点核实清单 **17 条**（B1–B3 / P1–P4 / D1–D5 / G1–G3 / P3-1–P3-4）—— **逐条核**
- Phase2 全部 **48 个交付记录**（含 9 个独立单）—— 声称 vs 代码抽样对账 + 关键项逐条核
- Phase2 期内 `src/engine-core` 的 **14 个提交** —— 逐个 `git show --stat` 实测改动面
- 边界断言实测 **13 条**（12 条不变量 + 1 条扫描自检），全绿
- 全程只读；审计结束时工作区除本报告与任务单外**未改动任何代码**

### 0.5 与 Phase1 审计报告的差异（本报告的分类口径调整）

Phase1 报告用 `D1…D45` 一条流水号贯穿全文。本次**改为分域编号**，理由：本次同时审计 4 个母本 + 48 份交付记录，流水号会让「蓝图层差异」与「某 WP 的差异」混在同一个序列里，读的人无法从编号看出问题出在哪一层。

| 前缀 | 域 | 数量 |
|---|---|---|
| `B` | 蓝图整体层面（roadmap §7 / §9） | 3 |
| `P` | Phase1 遗留差异点（Phase1 报告 D1/D2/D4/D12） | 4 |
| `D` | Phase2 重点 WP | 5 + 新增 3 |
| `G` | 母版登记表缺口 | 3 |
| `R` | Phase3 准备度（新增域） | 12 |
| `N` | 新发现（文档写多/写少/偏差 + 母版过期） | 14 |

---

## 1. 任务单重点核实清单 · 逐条结论

### 1.1 §4.1 蓝图整体层面

| # | 蓝图位置 | 蓝图声称 | 任务单猜的实际情况 | **核实结论** | 证据 |
|---|---|---|---|---|---|
| **B1** | roadmap §7 伦理安全分层路线 | 学员自身心理风险三级兜底（低静默监测 / 中关怀提示 / 高阻断实训 + 危机热线 + 人工复核），审计不可删 —— Phase1 已做 | 可能只做了检测层，没做处置层 | ✅ **任务单的猜测不成立 —— 处置层确实做了**。三档动作 `none`/`toast`/`block` + 热线 `12356` + 急救 `120` + append-only 审计表 `student_risk_events`（无 `updated_at`/`deleted_at`）+ 用户选择回写 + 督导侧读取。三条边界（side / 等级 / 类别）收在一个纯函数里 | `src/engine-adapters/rendering/student-risk-disposal.ts:43`、`:62`、`:67`、`:125`；`src/voice/student-risk-audit-slot.ts:96`；`src/counselor/entities/student-risk-event.entity.ts:65`；`src/counselor/providers/student-risk-audit.service.ts:41`【实锤】 |
| **B2** | roadmap §9 | Phase2 当前 **18/36** WP 完成 | 实际已完成 38/42 | ❌ **任务单的「实际 38/42」也不对** —— 登记表实际 **36** 个 ✅（见 G1）。蓝图里的 18/36 是**更早的快照**，两边都过期 | roadmap `:295` vs `phase2-wp-list:110`【实锤】 |
| **B3** | roadmap §9 | Phase2 是 WP27–WP62 | 实际后来加了 WP63–WP68（混合式 BDI PoC 组） | ⚠️ **蓝图文档本身已更新**（§9 表格已含「Phase2.5 混合式 BDI 过渡期 · WP63–WP68」行，2026-11-05 加的）。但 **`phase2-wp-list.md` 的标题仍是「（WP27–WP62）」**，与自己的表格（合计 42 条 WP27–WP69）矛盾 —— 见 N7 | roadmap `:296` vs `phase2-wp-list:1`【实锤】 |

### 1.2 §4.2 Phase1 遗留差异点

| # | Phase1 报告 | 差异点 | 现在的状态 | **核实结论** | 证据 |
|---|---|---|---|---|---|
| **P1** | D1 | WP19 留痕链整条未通（`turn_debug_trace` 恒空） | 声称已修复 | ✅ **已修复，且不止是「改成落 JSON 文件」** —— `trace-recorder.service.ts` 有 `recordTrace` 落库路径（`turn_debug_trace` JSON 列）+ 会话关闭收尾 `flush`；引擎侧 `engine.providers.ts:380` / `engine.module.ts:478` 都补了装配入口（原 D1 的「traceRecorder 是第 6 位 `@Optional()` → 恒 undefined」已修）。WP58 的调试会话另走 JSON 文件，**与正式表分离**（不污染学员场次） | `src/admin-debug/trace-recorder.service.ts:165`、`:210`；`src/engine-adapters/wiring/engine.providers.ts:380`【实锤】 |
| **P2** | D2 | `/admin/api/*` 零鉴权 | 声称已修复（WP26 补了 AdminRoleGuard） | ✅ **已修复，且覆盖面比「补了一个 guard」更广**：`admin-debug.controller.ts` / `admin-insights.controller.ts` / `debug-session.controller.ts` 三个 controller 均 class 级挂 `@UseGuards(AdminRoleGuard)`，另有 `admin-basic-auth.middleware.ts` 兜底 | `src/admin-debug/admin-debug.controller.ts:153`；`src/admin-debug/admin-insights.controller.ts:70`；`src/admin-debug/debug-session.controller.ts:113`；`src/admin-debug/guards/admin-role.guard.ts:68`【实锤】 |
| **P3** | D4 | SPA 全是 mock | 声称已修复（WP30 + 四合一全部切真 API） | ✅ **已修复**。`admin-dashboard/src/api/client.ts` **零 mock 命中**（grep `mock` 无结果）；后端 `/admin/api/*` 端点全部接真数据 | `admin-dashboard/src/api/client.ts`（grep 零命中）；`src/admin-debug/admin-debug.controller.ts`【实锤】 |
| **P4** | D12 | 服务挂/超时静默回落本地规则 → 实际回落内核规则层，学员危机检测能力归零 | 可能已修复 | ✅ **已修复**。`createRiskProbe` 现在**不再丢弃 fallback** —— 配了服务地址就把本地词典**委托**给 HTTP 探测器做兜底（远端失败 → 本地词典判定，源记 `local_dict`），且刻意选「委托」而非「叠加」（不双判、不双倍延迟） | `src/engine-adapters/wiring/engine.providers.ts:534-548`【实锤】 |

### 1.3 §4.3 Phase2 重点 WP

| # | WP / 单 | 文档声称 | 任务单猜的实际情况 | **核实结论** | 证据 |
|---|---|---|---|---|---|
| **D1** | WP31 成本看板与告警 | 成本看板展示 token 消耗/用户/会话，**超阈值告警规则接入** | 只做看板，告警不做 | ✅ **任务单正确 —— 告警确实没做**。代码里只有两个读端点（`GET /admin/api/cost/trend` / `GET /admin/api/cost/sessions`），**零告警通道、零阈值判定**。`session-cost.ts` 文件头自己写着「不做告警与看板: 本单只打一条结构化日志」。母版 P0-8 已如实登记 | `src/admin-debug/admin-debug.controller.ts:446`、`:478`；`src/engine-adapters/observability/session-cost.ts:28`【实锤】 |
| **D2** | WP58 引擎调试面板 | 每轮 BDI delta trace、**事件触发链**、prompt 快照、**delta cap 砍幅** | 事件触发链已做，cap 砍幅明细没做 | ⚠️ **任务单的说法需要修正 —— 两项都没做**。① **事件触发链**：`turn_delta_audits` 表有 `event_kinds` + `event_details`（含 matchedTerms），**事件层做了**；但「触发链」（哪个算子 → 哪条规则命中 → 怎么算出 delta）**未做**。② **cap 砍幅明细**：实体文件头**明写**「**不落 cap 砍幅明细**: 砍幅已经有 DeltaCapLogger 打日志, 不重复存」—— 即刻意的设计取舍，不是遗漏。⚠️ **但审议侧另有 `capEntries`**（逐维砍幅明细进 Redis trace），**规则侧与审议侧口径不对称** —— 见 N3 | `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.entity.ts:15`；`src/engine-adapters/deliberation/llm-deliberation.service.ts:752`、`:963`【实锤】 |
| **D3** | WP67 三级降级策略 | 降级 1：LLM 审议超时 → 跳过审议；降级 2：连续失败 → 切回纯规则算子；降级 3：会话打标 degraded | 只做了熔断器那一半 | ✅ **任务单正确 —— 只做了熔断器那一半**，但**三档的现状比「只做一半」更微妙**：降级 1 / 降级 2 在**影子模式下天然成立**（审议结果从不生效，主流程永远走规则算子），所以「没做」在行为上等价于「已生效」；降级 3 已由 2026-11-07 独立单销掉 | `src/engine-adapters/deliberation/llm-deliberation.service.ts:87`、`:532`；`src/counselor/providers/session-degraded.service.ts:109`；`src/counselor/domain/session-degraded.ts:131`【实锤】 |
| **D4** | WP68 意图锁定机制 | 触发事件白名单：咨询师直接提问了这个意图相关的话题 → 提前解锁 | 没做 | ✅ **任务单正确 —— 触发事件白名单没做**。代码只有「锁定 N 轮内忽略 LLM 切换建议 + 规则算子换意图时重新锁定」，**没有**「咨询师直接提问相关话题 → 提前解锁」的触发条件 | `src/engine-adapters/deliberation/llm-deliberation.service.ts:561`、`:594`、`:608`【实锤】 |
| **D5** | 临床合理性校验拦截版 | 观测版只是挑出可疑轮次，拦截版要等督导校准出真临床数字 | 没做 | ✅ **任务单正确 —— 拦截版没做**。当前只有观测版：`applyClinicalSanityCheck` **只产出 `clinicalFlags`，不改 delta**（`checkedDeltas` 原样返回）；且**开关缺省关**（`ENGINE_CLINICAL_SANITY_ENABLED`）。母版 §切灰度观测面 已如实登记 | `src/engine-adapters/deliberation/llm-deliberation.service.ts:1089`、`:1516`、`:1458`【实锤】 |

### 1.4 §4.4 母版登记表缺口

| # | 缺口 | **核实结论** | 证据 |
|---|---|---|---|
| **G1** | 进度数字 38/42 对不对？ | ❌ **不对 —— 登记表实际只有 36 个 ✅**。逐行解析 `phase2-wp-list.md` 的登记表：**43 行 WP 条目，其中 36 个带 ✅**，未完成 7 个：`WP27 / WP29 / WP33 / WP39 / WP40 / **WP60** / **WP62**`。**WP60 / WP62 实际都已交付**（`a49a9e4` / `cb45025` 两个 commit + 两份完整交付记录），只是**登记表那两行漏标 ✅**。而进度行的括号里**又把 WP60 ✅、WP62 ✅ 写上了** —— **同一份文档内部自相矛盾**：表格说没做，进度行说做了 | `phase2-wp-list:77`、`:78`（无 ✅）vs `phase2-wp-list:110`（进度行含 WP60 ✅ WP62 ✅）【实锤】 |
| **G2** | 切灰度前置四道安全网 + 影子模式统计面板 + degraded 打标 + 内核 clamp01 统一 —— 是否都登记在母版正文？ | ✅ **已登记**。母版新增「📈 切灰度决策观测面（2026-11-06 → 2026-11-08 · 独立单，**非编号 WP**，不计入 42 条进度）」小节，列了 cap 校验层 / 过期判定 / cap 配置统一 / 临床合理性观测版 / 影子模式统计面板 / 统计面板时间窗口 / degraded 打标 七项。⚠️ **但内核 clamp01 统一单只记在 WP62 的 P2-8 行里**，**没进这个观测面小节** —— 它不是观测面，是内核一致性收口，位置也算合理，但母版**没有一处「独立单清单」**（见 N6） | `phase2-overview:82-96`、`:111`【实锤】 |
| **G3** | WP31 告警 / WP58 cap 砍幅 / WP68 白名单 / 临床拦截版 —— 未完成项是否都登记在待做清单？ | ✅ **四项全部登记**。P0-8（成本看板告警）、P1-12（调试面板「事件触发链 / cap 砍幅」仍未做）、P2-9（触发事件白名单未做）、切灰度观测面（临床合理性观测版「不拦截不砍幅」）—— **母版口径完整**。⚠️ 但**待做清单（§4 checkbox）里没有「临床合理性拦截版」这一条** —— §4 验收标准全是 Phase2 封版闸门口径，拦截版属 Phase3 项 | `phase2-overview:61`、`:80`、`:91`、`:126`、`:222`【实锤】 |

---

## 2. Phase3 准备度专项审计

> 这是本次审计的**重点域**。Phase3 = 混合式 BDI 灰度切换（规则兜底 + LLM 审议并行）。
> 判据取自 `hybrid-bdi-agent-blueprint-v1.0.md` §2 三层分离 / §3 十三个边界 / §6 演进路线 / §7 红线提醒。

### 2.1 三层分离 · 逐层就绪度

| 层 | 蓝图要求 | 现在的实际 | 判 | 证据 |
|---|---|---|---|---|
| **① 状态骨架层** | 信念/欲望/意图/同盟三维/情绪/记忆；纯数据结构，可序列化、可调试、可复现 | 全部落地：`BdiSnapshot` 含三维阻抗 + 同盟三维（trust/safety/bond）+ 情绪双轴 + 移情 + 信念三层 + 愿望层 + 意图。**可序列化**（Redis 仓库存 JSON）+ **可落库**（`RedisBdiStateRepository`，含 revision 单调校验）+ **可回放**（`resumeFromSessionId` 走 `load()`） | ✅ **够** | `src/engine-adapters/persistence/redis-bdi-state.repository.ts:170`、`:234`、`:319`；`src/engine-core/domain/engine-session.types.ts:211`【实锤】 |
| **② 审议引擎层** | LLM 审议：当前状态 + 本轮对话 → 结构化状态变更建议 | 影子模式跑通：`LLM 审议 → 格式校验 → 逐维 cap → 过期判定 → 临床标记 → trace`，会话级串行队列 + per-session mutex + 快照版本号 | ✅ **够**（但见 §2.2 三条边界缺口） | `src/engine-adapters/deliberation/llm-deliberation.service.ts:1359`【实锤】 |
| **③ 约束校验层** | delta cap / 临床合理性 / 意图锁定 / 可复现控制 | **前 3 项有**（cap 逐维 + 临床标记 + 意图锁定），**可复现控制零实现** | ⚠️ **3/4** | 见 R4【实锤】 |

### 2.2 逐条边界就绪度

| 蓝图边界 | 级别 | 应对措施 | 现在的实际 | 判 | 证据 |
|---|---|---|---|---|---|
| **边界 1** 状态一致性与时序竞争 | 致命 | 会话级串行队列 / 最近已提交快照 / per-session mutex | ✅ **全部落地**：BullMQ 队列（Worker 并发闸门）+ Redis SETNX per-session mutex + `EngineTurnOutput.revision` → 审议入参 `baseRevision` → 过期判定（锚 R1 = 本轮落库后） | ✅ | `src/engine-adapters/deliberation/llm-deliberation.service.ts:1636`；`src/engine-core/domain/engine-session.types.ts:211`【实锤】 |
| **边界 2** 可解释性断层 | 致命 | reason 字段 / operatorTags / 进 trace | ✅ **落地**：`reason` + `operatorTags`（枚举，非自由文本）+ 三方对比（规则选的 / LLM 建议的 / 锁定后生效的） | ✅ | `src/engine-adapters/deliberation/deliberation-types.ts:264`、`:309`【实锤】 |
| **边界 3** 心理数据合规边界 | 致命 | ① 用户协议写明 ② **审议 prompt 不传完整用户原文，只传结构化事件分类** ③ 高风险对话走本地规则不发 LLM ④ 长期：自托管小模型 | ❌ **①②③ 全部未落地**。② **审议 prompt 直接传了咨询师原话 + 来访者渲染原文**（`buildDeliberationUserPrompt` 六个区块里 `counselorText` / `visitorText` 是原文）；③ 零「高风险走本地规则」分支；① 用户协议侧零命中。审议走 `CounselorLlmJsonClient`（与渲染同一个 MiniMax 第三方端点）→ **心理内容确实出境到第三方** | ❌ **缺口** | `src/engine-adapters/deliberation/deliberation-prompt.ts:176`、`:209`、`:218`；`src/engine-adapters/deliberation/llm-deliberation.service.ts:199`、`:1410`【实锤】 |
| **边界 4** 降级与故障恢复 | 致命 | 三级降级 + 降级状态可观测 + 降级会话不作考核 + **降级时自然衰减仍跑（幅度 50%）** | ⚠️ **前 3 项有**（熔断器 / degraded 打标 + 考核过滤），**「降级时自然衰减幅度调小到 50%」未实现** —— `session-decay` 的半衰期**没有降级态分支** | ⚠️ **部分** | `src/engine-core/cognition/session-decay.ts`；`src/engine-adapters/deliberation/llm-deliberation.service.ts:87`【静态推演】 |
| **边界 5** 软状态 / 硬安全分层 | 致命 | 软状态走 LLM / 硬安全永远走规则 / 校验层再拦一道 | ✅ **落地且扎实 —— 三道防线**：① 类型层 `DELIBERATION_DIMS` 显式列 11 个软状态维度（**刻意不用 `keyof DeltaVector`**，注释写明「硬安全判定不能交给一个可能脑补的 LLM」）；② prompt 层明令「绝对不要输出硬安全维度」；③ 校验层丢弃非法维度（模型硬塞的必被丢） | ✅ | `src/engine-adapters/deliberation/deliberation-types.ts:19`、`:52`；`deliberation-prompt.ts:108`；`llm-deliberation.service.ts:1156`、`:1244`【实锤】 |
| **边界 6** LLM 输出格式漂移 | 严重 | 强制 JSON 模式 / schema 校验过 zod / 重试一次 / 兜底 delta=0 | ⚠️ **部分**：✅ 手写校验器 + 按错误类型分流重试 + 兜底；❌ **无 `response_format: json_object`**（零命中）；❌ **无 zod**（零命中 —— 母版 P1-15 已登记「zod schema 与 response_format 本期未做」） | ⚠️ **部分** | `src/engine-adapters/deliberation/llm-deliberation.service.ts:1166`；grep `zod\|response_format` **零命中**【实锤】 |
| **边界 7** 长对话上下文爆炸 | 严重 | 相关维度传 / 角色设定只传一次 / 记忆 Top3 / **审议频率不是每轮都跑** | ❌ **前 3 项零命中**（无维度筛选 / 无角色基线缓存 / 无 Top3 记忆）；④ **审议就是每轮都跑**（WP64 交付记录自己写「影子模式是**每轮**旁路发一次请求」）→ **成本与延迟无闸门** | ❌ **缺口** | `src/engine-adapters/deliberation/deliberation-prompt.ts:203`（六区块全量）；`engine-wp64-...-implementation-2026-11-05.md:290`【实锤】 |
| **边界 8** 审议漂移检测 | 严重 | 基线偏离告警 / delta 分布监控 / 随机抽检 | ⚠️ **有一半**：delta 分布监控**有**（`deltaDiff` 逐维绝对值 + 统计面板的均值/最大）；**基线偏离告警没有**（角色正常演化区间无定义）；**随机抽检没有**（人工审核流未建）。⚠️ **注意别混淆**：代码里的 `deltaDiff` 是「规则算子 vs LLM 审议」的差值，**不是**蓝图说的「审议把角色带偏」的漂移检测 —— **两个不同的东西** | ⚠️ **部分** | `src/engine-adapters/deliberation/llm-deliberation.service.ts:750`、`:1548`；`src/engine-adapters/deliberation/deliberation-stats.ts:237`【实锤】 |
| **边界 9** 考核公平性与模型版本 | 严重 | 考核场景锁模型版本 + 锁 prompt 版本 / 升级前跑 100 用例对比 / 报告里写清版本 | ❌ **全未落地**：无模型版本锁定、无 prompt 版本锁定、审议输出与 trace 里**都没有模型版本字段**（只有 `model` 用于调用，不记录）。⚠️ 精确口径：全仓 grep `模型版本` 有 **3 处命中，但全在无关域**（`supervisor-llm.config.ts` 的思考深度注释 / `practice-asr.config.ts` 的 ASR 模型版本常量），**审议域零命中** —— 不是「全仓零命中」，是「审议相关零命中」 | ❌ **缺口** | grep `模型版本\|modelVersion\|锁版本\|lockedSeed` 在 `src/engine-adapters/deliberation/` **零命中**；全仓 3 处命中均与审议无关【实锤】 |

### 2.3 Phase3 准备度结论

| # | Phase3 需要 | 结论 | 阻塞项 |
|---|---|---|---|
| **R1** | 状态骨架层 | ✅ **够** | — |
| **R2** | 审议引擎层（PoC 数据 + 可观测性） | ✅ **够** —— 影子模式指标齐全（成功率 / 失败原因 / P95 / token / deltaDiff 分歧 / 过期率 / 砍幅 / 临床 flagged 率），且有时间窗口维度 | ⚠️ 100+ 场真实对话数据**尚未积累**（蓝图 §6 Phase 2.5 出口条件） |
| **R3** | 约束校验层兜底可控性 | ⚠️ **3/4** | **R4 可复现控制** |
| **R4** | **可复现控制**（蓝图 §2.3 + §7 红线 4「考核场景必须能锁版本、锁温度、逐字复现」） | ❌ **完全未落地** —— grep `REPRODUC\|reproducib\|锁定温度\|逐字复现\|锁 seed\|lockedSeed` **全仓零命中**（唯一沾边的是 `supervisor-llm.config.ts` 讲「思考深度随模型版本变」的注释，与考核复现无关）。且上游 M3.1-Flash **本身忽略 temperature**（`minimax.provider.ts:22` 明写）→ **「锁温度」这条路在当前模型上走不通**，需要版本锁定 + prompt 版本锁定才谈得上逐字复现 | ❌ **阻塞** |
| **R5** | 硬安全不进 LLM | ✅ **够**（三道防线） | — |
| **R6** | 心理数据合规（边界 3） | ❌ **不够** —— 心理原文出境第三方，用户协议无对应条款，高风险无本地分流 | ❌ **阻塞**（合规风险，非技术阻塞） |
| **R7** | 考核公平性（边界 9） | ❌ **不够** —— 模型/prompt 版本未锁、版本未记录 | ❌ **阻塞** |
| **R8** | 上下文与成本（边界 7） | ❌ **不够** —— 每轮全量传 + 每轮都审议，无频率闸门 | ❌ **阻塞** |
| **R9** | **灰度切换开关**（蓝图 §6 Phase 3A「两种模式可配置切换，不硬切」） | ❌ **零实现** —— 无灰度开关、无按场景路由。**Phase3 的核心动作本身还没有开关** | ❌ **阻塞** |
| **R10** | 100+ 场真实对话数据 | ❌ **未积累** —— 数据管道齐备，**数据还没跑出来** | ⚠️ |
| **R11** | 降级时自然衰减幅度 50%（边界 4） | ❌ **未实现** —— `session-decay` 无降级态分支 | ⚠️ |
| **R12** | 随机抽检 / 人工审核流（边界 8） | ❌ **未建** —— 督导侧有风险事件读取，但不是「每天抽 1% 会话人工审核」的抽检流 | ❌ **阻塞** |

---

## 3. 蓝图能力逐条结论（Phase1 / Phase2 / Phase2.5）

| 阶段 | 蓝图规划 | 实际落地 | 判 |
|---|---|---|---|
| **Phase1 基础底座期** | WP0–WP26 ✅（roadmap §9 已标「已完成」） | ✅ 已封版（2026-11-03），1252 例测试全绿。Phase1 审计报告的 45 条差异点，任务单点名的 4 条（D1/D2/D4/D12）**全部已修复** | ✅ |
| **Phase2 专业增强期** | roadmap §9 写「WP27–WP62」，「当前 18/36 WP 完成」 | ❌ **文档口径过期**：实际 WP27–WP69 共 42 条，完成 **36** 条（不是 18，也不是 38） | ❌ 见 G1 / B2 |
| **Phase2.5 混合式 BDI 过渡期** | WP63–WP68 PoC 组 + 「积累 100+ 场真实对话数据」 | ⚠️ **6 条 WP 全交付**，但**出口条件（100+ 场真实数据）未达成** —— 数据管道齐了，**数据还没跑出来** | ⚠️ |
| **Phase3A 灰度切换期** | 规则算子不够用的场景切 LLM / 考核继续用规则 / 两种模式可配置切换 / WP68 上线 | ❌ **「两种模式可配置切换」零实现**（无灰度开关、无按场景路由）；R4/R6/R7/R8/R9/R12 六项阻塞未解 | ❌ |

---
## 4. 逐 WP 对账结论（Phase2 48 份交付记录）

### 4.1 抽查结论汇总

| 交付记录 | 声称 | 核实 | 判 |
|---|---|---|---|
| WP28 | PsyGUARD 超时 500→150、token 256→28 | ⚠️ **未改回** —— 内核常量仍是 `DEFAULT_PROBE_TIMEOUT_MS = 500`。母版与交付记录均标注「M3 内测前改回」，即**刻意未做**，非漏做 | ✅ 口径一致 |
| WP30 / 四合一 | Admin Dashboard 全页面切真 API | ✅ 后端端点全真；前端 client.ts 零 mock | ✅ |
| WP31 | 成本看板切真 API | ✅ 端点在；⚠️ 告警未做（见 D1） | ✅ 母版已登记 |
| WP32 | BDI 状态持久化（内存 → Redis） | ✅ `RedisBdiStateRepository` + revision 单调校验 + `ENGINE_BDI_STATE_BACKEND` 分流 | ✅ |
| WP34 / WP53 | 人格调节算子（含 safety/bond） | ✅ 内核 `personality-modulator.ts` 六列系数 | ✅ |
| WP36 / WP54 | 跨会话衰减 + 破裂态阻抗下限 | ✅ `session-decay.ts` + `ruptureResistanceFloor` | ✅ |
| WP37 / WP55 / WP61 | 滚动摘要 + 两侧纪要 + 层次化 | ✅ 三层摘要结构落地 | ✅ |
| WP41 | 表达风格渲染接入 | ✅ 内核 `render-types.ts` + DB 三列接通 | ✅ |
| WP42 / WP50 / WP51 / WP52 | 同盟三维（模型/渲染/种子/剧本） | ✅ 四处全落地 | ✅ |
| WP45 | P3 技术债 8 条 | ✅ 大部分落地；⚠️ 「边际递减」未做（母版已登记） | ✅ 口径一致 |
| WP46 | Sentry 通道脱敏 | ✅ 独立脱敏中间件 + `beforeSend` 递归脱敏 | ✅ |
| WP48 / WP69 | env 守卫盲区 + 扩面 + consent 路径修复 | ✅ 16 个盲区键清完 + 正对照断言 | ✅ |
| WP56 / WP59 | 记忆召回进渲染 + 召回策略端口 | ✅ 判定只有一份 | ✅ |
| WP57 | 信念层深度扩展 | ✅ 内核 6 文件 | ✅ |
| WP58（面板） | 调试面板三接口 | ✅ 后端就绪；⚠️ 事件触发链 / cap 砍幅未做（见 D2） | ✅ 母版已登记 |
| WP58（审计） | 事件 + delta 审计观测 | ✅ `turn_delta_audits` 表 + env 开关缺省关 | ✅ |
| WP60 | delta 规则表配置化 | ✅ 11 键 env + 逐维度优先级 + 机器守卫 | ✅ |
| WP62 | 内核端口类型 barrel 收口 | ✅ 3 符号 + 断言⑥ 白名单 + 适配层 3 处副本全删 | ✅ |
| WP63 | 审议输出 Schema + 可解释性 | ✅ 维度/标签枚举 + 双模式 prompt | ✅ |
| WP64 | LLM 审议 PoC（影子模式） | ✅ 影子模式跑通；⚠️ 边界 3 / 边界 7 未落地（见 R6 / R8） | ⚠️ |
| WP65（队列） | 队列化 | ✅ BullMQ + Worker 并发闸门 | ✅ |
| WP65（mutex） | per-session mutex + 快照版本号 | ✅ Redis SETNX + `revision` | ✅ |
| WP66 | 格式校验与重试 | ⚠️ 手写校验器 + 分流重试有；❌ zod / response_format 无（母版已登记） | ✅ 母版已登记 |
| WP67 | 熔断器 | ✅ 三态 + 半开 + `circuit_open` trace | ✅ |
| WP68 | 意图锁定（基础版） | ✅ 旁路模拟 + 两字段锁状态；⚠️ 触发白名单未做（见 D4） | ✅ 母版已登记 |
| 独立单 ×9 | cap 校验 / 过期判定 / cap 配置统一 / 临床标记 / 统计面板 / 时间窗口 / degraded 打标 / clamp01 统一 | ✅ 全部落地 | ✅ |

### 4.2 Phase2 期内内核改动面（14 个提交，逐个 `git show --stat` 实测）

| commit | 主题 | 内核改动面 | 是否授权 |
|---|---|---|---|
| `226e973` | WP37 滚动摘要 | **5 文件 +134/-4** | ✅ 任务单授权 |
| `e213f92` | WP57 信念层扩展 | **6 文件 +295/-8** | ✅ 任务单授权 |
| `45769cf` | WP53 人格调节扩展 | 1 文件 +87/-11 | ✅ |
| `c081406` | WP52 剧本偏移 | 2 文件 +79/-14 | ✅ |
| `572f7bd` | WP54 破裂态下限 | 1 文件 +124/-4 | ✅ |
| `e547a48` | WP50 渲染层 | 1 文件 +32/-0 | ✅ |
| `fb391ac` | WP51 角色种子 | 2 文件 +53/-5 | ✅ |
| `c95fa9f` | WP59 召回端口 | 2 文件 +85/-7 | ✅ |
| `b38add9` | WP41 表达风格 | 2 文件 +86/-1 | ✅ |
| `6a68fc9` | WP38 semver + 事件标签 | 2 文件 +31/-0 | ✅ |
| `62a2f79` | WP58 审计 | 1 文件（仅 barrel 导出 `RuleBasedClassifier`） | ✅ 任务单明确授权 |
| `02aaaed` | WP65 mutex + revision | 2 文件 +23/-0 | ✅ 预批准例外（纯加只读字段） |
| `a49a9e4` | WP60 delta 表 | 3 文件（端口 + 接线） | ✅ 任务单 §5.3 授权 |
| `cb45025` | WP62 barrel 收口 | 1 文件 +7/-1（仅 index.ts） | ✅ 任务单 §5.2 授权 |
| `bde6d8f` | 内核 clamp01 统一 | 1 文件 +16/-7（仅 importance-decay.ts） | ✅ 任务单 §5.2 授权 |

> **结论：Phase2 期内 14 个内核提交全部有任务单或预批准授权，无越权改动。** README 里逐条声称的「内核零改动」**语境正确**（指**该单**），不构成事实差异点 —— 但见 N8（措辞易误读）。

---

## 5. 差异分类

### 5.1 ① 文档写多了（代码实际没做）

| # | 域 | 文档声称 | 代码实际 | 证据 |
|---|---|---|---|---|
| **N1** | D1 | WP31「成本看板**与告警**」标题含「告警」，登记表列「超阈值告警规则接入」 | **只有看板**：无告警通道、无阈值判定 | `admin-debug.controller.ts:446`、`:478`【实锤】 |
| **N2** | D2 | WP58 声称「delta cap 砍幅」 | **规则侧不落砍幅明细**（实体文件头明确「不落，砍幅已有 DeltaCapLogger 打日志」）。⚠️ 审议侧有 `capEntries` → **两侧不对称** | `turn-delta-audit.entity.ts:15` vs `llm-deliberation.service.ts:752`【实锤】 |

### 5.2 ② 文档写少了（代码做了没记）

| # | 域 | 代码里做了但文档没记 | 证据 |
|---|---|---|---|
| **N3** | D2 | **审议侧逐维 cap 砍幅明细已落地**（`capEntries`：dimension / raw / capped），进 Redis trace + 统计面板（`cap_<dim>` 计数器）。WP58 记录与母版都只提「规则侧不落」，**没记审议侧已有** | `llm-deliberation.service.ts:926`、`:951`、`:963`、`:1549`；`deliberation-stats.ts:244`【实锤】 |
| **N4** | B1 | 学员风险处置层的**用户选择回写**（`phone`/`continue`/`dismissed`）+ 督导侧读取（`listBySession` / `listPendingChoiceBySession`）已落地，roadmap §7 与母版只说「三级兜底」 | `student-risk-audit.service.ts:99`、`:122`、`:135`；`supervision.service.ts:1062`【实锤】 |
| **N5** | R2 | 影子模式的 **`stale`（过期判定）+ `currentRevision`** 已进 trace，且**保守兜底**（load 失败 → `stale: false`，宁可误判没过期不误杀）—— 蓝图边界 1 的「最近已提交快照」要求已满足，母版只记了「过期判定与丢弃」一句 | `engine-deliberation-stale-check-implementation-2026-11-07.md`【实锤】 |
| **N6** | G2 | 母版**没有「独立单清单」** —— 9 个切灰度前置独立单散落在 §切灰度观测面小节 + WP62 行 + P2-8 行，**没有一处索引**。新增独立单时容易漏登记 | `phase2-overview:82-96`、`:111`【实锤】 |
| **N7** | B3 | `phase2-wp-list.md` 的**标题**仍是「（WP27–WP62）」，而表格合计是 WP27–WP69、进度行也写到 WP69 —— **文档标题与自身内容矛盾** | `phase2-wp-list:1` vs `:108`、`:110`【实锤】 |
| **N8** | §4.2 | README 里 14 处「内核零改动」**都是「该单零改动」的语境**，但读者容易读成「Phase2 内核没动过」。⚠️ 实际 Phase2 期内内核有 **14 个提交**、累计 **10+ 文件级别的真实改动** —— 措辞与事实之间存在**可误读空间**（非事实错误） | `docs/worklog/README.md:41-63`；`git log --since=2026-11-03 -- src/engine-core`【实锤】 |

### 5.3 ③ 描述有偏差（做了但和说的不是一回事）

| # | 域 | 文档说的 | 代码做的 | 证据 |
|---|---|---|---|---|
| **N9** | D2 | 「事件触发链已做」 | **事件层做了**（`event_kinds` + `event_details` 含 matchedTerms），但「触发链」（算子 → 规则命中 → 怎么算出 delta）**未做** —— 二者是不同东西 | `turn-delta-audit.entity.ts:57`、`:64`【实锤】 |

### 5.4 ④ 母版 / 蓝图自身的过期与自相矛盾（本类为本次新增）

| # | 域 | 问题 | 证据 |
|---|---|---|---|
| **N10** | B2 | **roadmap §9 的「Phase2 当前 18/36 WP 完成」严重过期** —— 实际 36/42。这行在**母版**（裁决依据）里，过期比任务单过期更严重 | `roadmap:295`【实锤】 |
| **N11** | G1 | **`phase2-wp-list.md` 同一份文档内部矛盾**：表格里 WP60 / WP62 行**无 ✅**，进度行却写「WP60 ✅、WP62 ✅」 | `phase2-wp-list:77`、`:78` vs `:110`【实锤】 |
| **N12** | G1 | **进度数字 38 与登记表实际 36 不符**（38 = 36 + 漏标 ✅ 的 WP60/WP62） | 同上【实锤】 |
| **N13** | D2 | **母版 P1-12 的措辞**：「事件触发链 / cap 砍幅」仍未做 —— 但**事件层（event_kinds + matchedTerms）其实做了**，只有「链」没做。措辞把已做的一块也归入未做 | `phase2-overview:80`、`:222`【实锤】 |
| **N14** | 边界 3 | 蓝图边界 3 应对②写「审议 prompt **不传完整用户原文**，只传结构化事件分类」 —— **实际传了原文**（咨询师原话 + 来访者渲染原文）。蓝图与实现的差距属**蓝图侧过时**（蓝图是 2026-11-05 的设计意图，代码是同期的 PoC 实现），但**灰度切换前必须正视** | `hybrid-bdi-agent-blueprint-v1.0.md` 边界 3 vs `deliberation-prompt.ts:209`、`:218`【实锤】 |

---

## 6. Phase3 准备度 · 阻塞项汇总（不写方案，只列事实）

| # | 阻塞项 | 蓝图依据 | 事实 | 证据强度 |
|---|---|---|---|---|
| **R4** | **可复现控制** | §2.3「考核模式下锁温度锁 seed，保证逐字可复现」+ §7 红线 4 | **全仓零实现**（`REPRODUC`/`锁定温度`/`逐字复现`/`lockedSeed` 全零命中）。且上游 M3.1-Flash 忽略 `temperature` →「锁温度」在当前模型上不可行 | 【实锤】 |
| **R6** | **心理数据合规（边界 3）** | §3.1 致命级边界 3 | 心理原文随审议 prompt 出境第三方；用户协议无对应条款；高风险无本地分流 | 【实锤】 |
| **R7** | **考核公平性（边界 9）** | §3.2 严重级边界 9 | 模型版本 / prompt 版本均未锁、**未记录**（审议 trace 里无版本字段；全仓 `模型版本` 3 处命中全在无关域） | 【实锤】 |
| **R8** | **上下文与成本（边界 7）** | §3.2 严重级边界 7 | 审议 prompt 六区块全量；**每轮都跑**；无频率闸门 | 【实锤】 |
| **R9** | **灰度切换开关** | §6 Phase 3A「两种模式可配置切换，不硬切」 | 无灰度开关、无按场景路由 —— **Phase3 的核心动作本身还没有开关** | 【实锤】 |
| **R12** | **随机抽检 / 人工审核流** | §3.2 边界 8 | 无「每天抽 1% 会话人工审核」的机制（督导侧有风险事件读取，但不是抽检流） | 【实锤】 |
| **R10** | 100+ 场真实对话数据 | §6 Phase 2.5 出口条件 | 数据管道齐备，**数据未积累** | 【静态推演】 |
| **R11** | 降级时自然衰减幅度 50% | §3.1 边界 4 | `session-decay` 无降级态分支，半衰期不随降级状态调整 | 【静态推演】 |

> ✅ **2026-11-08 状态补注（不改动本审计结论）**：**R9 已交付** —— 审议从「旁路观察」升级为「可配置生效」（内核加**纯类型**审议钩子端口 + 三态模式开关 + 会话白名单；缺省仍 = 纯规则，零回归）。交付记录：[`../completed/phase2/phase2-r9-grayscale-switch-implementation-2026-11-08.md`](../completed/phase2/phase2-r9-grayscale-switch-implementation-2026-11-08.md)｜任务单：[`../completed/phase2/phase2-r9-grayscale-switch-closeout-2026-11-08.md`](../completed/phase2/phase2-r9-grayscale-switch-closeout-2026-11-08.md)。
> ⚠️ 本审计 §2 / §3 表格里「R9 ❌ 阻塞」「6 项阻塞未解」是**审计当天的快照**，不改写历史；R9 的当前状态以[母版 §2.3 第 10 行](../pending/phase2-overview-2026-11-03.md) + 上述交付记录为准。**剩余 5 项阻塞（R4 / R6 / R7 / R8 / R12）仍未解。**

---

## 7. 无法证实 / 超出静态审计边界的项

| 项 | 说明 |
|---|---|
| **审议输出质量** | 蓝图要求「积累 100+ 场真实对话验证 LLM 审议质量」。**本报告无法评估审议质量** —— 需要真实数据 + 督导判断，静态审计做不到。影子模式指标（成功率 / deltaDiff 分歧率）只能说明「跑通了」，不能说明「判得对」 |
| **临床合理性阈值** | `CLINICAL_SANITY_THRESHOLDS` 是工程种子值、非临床标定。**本报告不评价阈值合理性** —— 需督导校准 |
| **边界 4「降级时自然衰减仍跑」** | 结论基于 `session-decay.ts` 无降级态分支的静态判定，**未构造降级态实测**。同时「幅度 50%」的具体实现路径（衰减幅度 vs 半衰期）**蓝图未定义**，本报告只记录「未实现」，不推断应有口径 |
| **规则侧 cap 砍幅是否够用** | 砍幅只进 `DeltaCapLogger` 的 warning 日志，**不落库**。日志可能被轮转冲掉 → 事后无法复盘某轮砍了多少。⚠️ 这一点**未实测**（需查日志轮转策略） |
| **线上运行时行为** | 生产容器是否重建、线上 env 实际取值、Redis / Qdrant 实际数据状态 —— **全部未核实**。本报告所有结论均为**代码静态判定**，非线上实测 |
| **前端类型错误** | README 提到前端有 **5 处 vue-tsc 类型报错**未清（`sessionId`/`messages` 当普通变量、`beliefActivation` 空值、`RenderSpecSummary` 缺 `promptFull`）—— **本单不跑前端命令**（仓库纪律），该状态未复核 |
| **`student_risk_events` 实际落库** | 处置层代码齐全，但**是否有真实学员触发过、有没有被督导读过**，静态审计无法判断 |
| **第二双眼睛** | 本次审计**未获子代理交叉复核** —— 全部结论由主审直接完成 |

---

## 8. 差异汇总计数

| 分类 | 条数 | 明细 |
|---|---|---|
| 蓝图整体层面（B） | **3** | B1 / B2 / B3 |
| Phase1 遗留（P） | **4** | P1 / P2 / P3 / P4 —— **4/4 全部已修复** |
| Phase2 重点 WP（D） | **8** | D1–D5 + N2 / N9 / N13 |
| 母版登记表缺口（G） | **3** | G1 / G2 / G3 |
| Phase3 准备度（R） | **12** | R1–R12（其中 R4 / R6 / R7 / R8 / R9 / R12 为**阻塞项**） |
| ① 文档写多了 | **2** | N1 / N2 |
| ② 文档写少了 | **6** | N3 / N4 / N5 / N6 / N7 / N8 |
| ③ 描述有偏差 | **1** | N9 |
| ④ 母版/蓝图自身过期与矛盾 | **5** | N10 / N11 / N12 / N13 / N14 |
| **合计** | **44** | — |

**按「是否阻塞 Phase3 灰度切换」重新分组**：

| 类别 | 条数 | 明细 |
|---|---|---|
| 🔴 **阻塞项** | **6** | R4 可复现控制 / R6 数据合规 / R7 考核公平性 / R8 上下文与成本 / R9 灰度开关 / R12 抽检流 |
| 🟡 **P1 重要** | **5** | G1 进度数字 / N10 roadmap 过期 / N11 母版自相矛盾 / D1 成本告警 / D4 触发白名单 |
| 🟢 **P2 文档层** | **10** | N2 / N3 / N4 / N5 / N6 / N7 / N8 / N9 / N13 / N14 |
| ⚪ **已修复（留档）** | **4** | P1 / P2 / P3 / P4 |
| 🔵 **Phase3 出口条件** | **2** | R10 数据积累 / R11 降级衰减 |

---

## 9. 附：本次审计用到的复核命令

```powershell
cd E:\Work\Project\backend\mofang-nestjs

# 内核改动面（可复核口径）
git log --oneline --since="2026-11-03" -- src/engine-core
git show --stat 02aaaed -- src/engine-core    # WP65 mutex + revision
git show --stat 62a2f79 -- src/engine-core    # WP58 barrel 导出
git show --stat bde6d8f -- src/engine-core    # clamp01 统一

# 关键零命中 / 命中检索
# REPRODUC|reproducib|锁定温度|逐字复现|lockedSeed  → 全仓零命中（R4 可复现控制; 唯一沾边是 supervisor 的无关注释）
# zod|z.object|response_format                     → deliberation 目录零命中（边界 6）
# everyN|interval|审议频率|skipTurn                → deliberation 目录零命中（边界 7）
# 模型版本|modelVersion|锁版本|lockedSeed          → 全仓 3 处命中, 全在无关域（审议域零命中, R7）
# TODO|FIXME                                     → engine-core / counselor 零命中

# WP 清单登记表解析（G1）
# 逐行匹配 ^\|\s*\*\*WP(\d+)\*\*\s*(✅)?\s*\|  → 43 行, 36 个 ✅
```

---

> **审计边界声明**：本次为**只读审计**。报告全程未修改 `src/`、`test/`、`admin-dashboard/` 任何文件，未执行任何修复动作，未 commit / push。审计期间工作区仅有本次新增的审计报告与任务单状态更新。
