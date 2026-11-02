# WP14 · 学员心理风险处置层 —— 后端交付记录

> 日期：2026-11-02 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 任务单：`docs/progress/engine-wp14-student-risk-disposal-backend-2026-11-02.md`
> 性质：**补处置层**（检测层 WP4/WP9-C/WP11 已有，本单一行未动）
> 状态：✅ 已交付（**未 commit**，改动全在工作区）

---

## 0. 一句话

学员自己说出"我想死"时，系统现在**会拦住本轮 AI 回复、给学员弹 12356/120 的全屏弹窗、把这次事件写进 append-only 审计表**；AI 来访角色说"我不想活了"（演练自杀剧本）**绝不弹学员、绝不阻断演练**；PsyGUARD 服务挂掉时**回落本地词典**而不是静默归零。内核 `src/engine-core/**` 一行未动。

---

## 1. 七块交付对照表

| # | 任务单 | 落地位置 | 状态 |
|---|---|---|---|
| 1 | 三档分流（warn→toast / block→阻断+modal / pass·visitor_output→无动作） | `src/engine-adapters/rendering/student-risk-disposal.ts`（纯判定）+ `turn-render-orchestrator.ts`（渲染前 gate） | ✅ |
| 2 | 审计表 `student_risk_events`（append-only） | `src/migration/1714900000026-AddStudentRiskEvents.ts` + `src/counselor/entities/student-risk-event.entity.ts` + `src/counselor/providers/student-risk-audit.service.ts` | ✅ |
| 3 | `crisis_resume` 回写 `user_choice` | `src/voice/voice.types.ts` + `src/voice/voice.service.ts` + `voice-turn-backend.port.ts`（可选方法） | ✅ |
| 4 | D12 兜底：`HttpPsyGuardProbe` 委托 `LocalCrisisProbe` | `src/engine-adapters/wiring/risk/http-psyguard.probe.ts` + `engine.providers.ts` | ✅ |
| 5 | 词典补 7 个职业倦怠 warn 级词 | `src/engine-adapters/wiring/risk/local-crisis.probe.ts` | ✅ |
| 6 | `monitored` 后续收紧（强制远端探测） | `src/engine-adapters/wiring/risk/student-risk-gate.ts` + 编排门面渲染前合并 | ✅ |
| 7 | 报告关联 `crisis_intervention` / `crisis_toast` | `src/counselor/providers/supervision.service.ts`（read-time 合并 annotations） | ✅ |

---

## 2. 关键设计决策（动手前先钉死的）

### 2.1 处置判定必须是纯模块，且要过**三条**边界

`rendering/student-risk-disposal.ts` 是纯函数（零 IO / 零 @nestjs / 零 ORM），判定顺序**不能换**：

1. **side 边界**：`side !== 'counselor_input'` → `none`。
   AI 扮演的来访者说的话是**演练内容** —— 学员练自杀危机干预剧本时，AI 来访本来就要说"我不想活了"。搞反 = 把正常训练一刀切断。
2. **等级边界**：`level === 'pass'` → `none`。
3. **类别边界**：**没有危机类别** → `none`。
   ⚠️ 这一条最容易漏：`counselor_input` 的 block 也可能是**专业越界**（"保证能治好" → `promise_cure`）。若不按类别过滤，一条正常的教学话术就会把学员的话打断 —— 那比不提示更糟。

过了三条才分流：`block` → 阻断，`warn` → toast。

### 2.2 阻断点在**渲染之前**，不在渲染之后

内核 `session.turn()` 内部就完成了 `assessSafety`（`output.safety` 透传），所以编排门面在拿到内核出参、**还没调 `RenderPort.render`** 时就能判定。判成 `block` 时：

- 不调 `RenderPort.render`（聚合路径与流式路径都是）→ 天然没有 `llm_text` / `tts_audio`；
- 不写来访半边工作记忆（本轮来访者一个字都没说，写进去就是造假）；
- 历史只追加"问"不追加"答"（下一轮模型仍能看到学员说了什么）；
- `reply` 为空、`render.usage` 全 0、`fallbackUsed=false`（是**主动阻断**，不是渲染降级）。

### 2.3 `monitored` 强制探测**做不到 probe 层**，只能在装配层做

内核 `RiskProbePort.probe(text, side)` **没有 session id**，而 `createEngineSessionPort` 只造**一个** `InMemoryEngineSession`（探测器进程级共享）。于是"这一场出过高危，后续每轮必须走 PsyGUARD"在 probe 层**无法表达**；要表达就得改内核端口签名 = 动红线。

因此抽了一个装配层端口 `StudentRiskGate`（`rendering/student-risk-disposal.ts` 定义形状，`wiring/risk/student-risk-gate.ts` 提供实现）：

- 监测状态按**内核句柄**记（模块内单例，面板与适配器共用同一个实例）；
- 门面在**渲染前**额外强制问一次**只走远端**的探测器，与内核判定**取更严的一档**；
- 远端失败 → 静默回落内核判定（不让一次网络抖动把对练搞挂）。

强制探测用**独立实例**且**不带本地词典兜底**：本地词典兜底已经在主链路上（D12 治本），再挂一遍就是同一段文本判两遍。

### 2.4 审计的 `source` 靠一条 `AsyncLocalStorage` 通道，不改内核形状

内核 `SafetyVerdict.source` 只有 `rule | probe | rule+probe` 三档，把"远端模型"与"本地词典"混成一档；但审计表必须能分辨 `psyguard` / `local_dict`（服务挂掉时 `local_dict` 占比飙升 = 远端识别能力已降级，这是运维上必须看得见的事）。

改内核形状是红线，所以走 `rendering/probe-source.ts` 的 `AsyncLocalStorage` 通道：作用域只包住 `session.turn()`，探测器在探测那一刻记下自己的来源。顺带解决了并发串场（ALS 是**调用上下文**作用域，不是全局变量）。

### 2.5 审计插槽住在 **voice 层**，不是 counselor、不是 engine-adapters

引擎适配层要写业务数据、业务侧要提供实现，但 `engine → counselor` 是**反向依赖**（仓库既有纪律）。voice 层是**两侧都能依赖**的位置，跟 `VoiceSessionBridgeRegistry`（会话落库插槽）完全同一套范式：voice 侧声明插槽，业务侧在自己的 `onModuleInit` 里注册实现。

### 2.6 危机帧走**窄接口回调直推**，不走帧出口注册表

`VoiceFrameRegistry` 按**落库 id** 索引，而 WS 会话 id 是**客户端给的**。让后端拿客户端可控的 id 去登记出口 = 开一个"把 A 的帧推给 B"的口子（隐私事故）。而落库 id 在"本场没落库"（纯内存降级）时**根本不存在** —— 危机弹窗不能因为数据库降级就推不出去。

两条问题一起解决的办法：在 `VoiceTurnBackendTurnOptions` 上加**可选**的 `publishFrame` 回调（voice 层把自己的 `send` 传进来），后端只管"推给本场"。注册表退化为**兜底**（独立调用后端时用）。

### 2.7 报告标注走 **read-time 合并**，不改落库 report 行

主报告由 agent 侧 `SupervisorService.runReport` 写 —— agent → counselor 是反向依赖，agent 侧查不了 counselor 的审计表；而且主报告与 4 流派反馈是两个队列，写时 patch 有竞态。审计表是 append-only 的**事实源**，报告是**派生视图** —— 派生视图晚一步没关系。

---

## 3. 与任务单的差异（逐条登记）

| # | 任务单原文 | 实际落地 | 原因 |
|---|---|---|---|
| 1 | `user_id` / `reviewed_by` = **bigint** | **varchar(36)** | 本仓用户主键是 uuid（`users.uid`），`training_sessions.user_id` 也是 varchar(36)。跟着仓库走，否则督导按 id 复核时 join 不起来 |
| 2 | 报告 annotations 加 `{ type:'crisis_intervention', level, turnIndex, category }` | `type` 用既有三值（high→`error` / medium→`warn`），**危机语义放 `category`**（`crisis_intervention` / `crisis_toast`），轮次与类别放 `message` | `SupervisionAnnotation.type` 只有 `good\|warn\|error` 且被 agent 侧 `checkOneAnnotation` 校验器卡着；新增枚举值要同时改内核契约与前端 DTO，属另一个单的事 |
| 3 | 报告由 **WP18 报告 worker** 查审计表 | counselor 侧 `loadReportContext` 读 → `buildReportDto` 合并 | 同上：agent 侧不能反向依赖 counselor；且 worker 队列与主报告有竞态。GET 与 SSE 共用同一份实现，逐字段一致 |
| 4 | 报告标注落 `level` 字段 | 落在 `type` + `message` 里 | `SupervisionReportAnnotationDto` 没有 `level` 列（timestamp/type/category/message/suggestion） |
| 5 | `monitored` 标志"会话结束时写进报告 annotations" | 每条危机事件都作为一条 annotation 进报告，high 那条的 `suggestion` 明写"本场已进入重点监测" | 报告侧拿不到运行时的 monitored 内存态；事件行里的 `monitored_after` 才是事实源 |
| 6 | 阻断时"不发 llm/tts 帧" | **不发内容帧**（`llm_text` / `tts_audio` / `sentence_*` 全部没有）；但 `llm_start` / `llm_done` / `tts_done` 这三个**生命周期帧**仍在 | 判定发生在内核 turn 内部，而 `llm_start` 由 voice 层在**消费流之前**就发了 —— 要压掉它就得把"内核 turn"从流生成器里拆出来（动核心流式路径），收益只有观感、风险是回归。要彻底压掉需改窄接口返回形状（另议） |
| 7 | 阻断轮次的逐字稿 | **不写逐字稿**（来访者一个字没说） | 写一条空的 assistant 记录会让督导看到"AI 回了但没内容"，反而更费解。学员说了什么由审计表 `snippet`（≤200 字）留痕 |
| 8 | 审计表读端点 | **本单不开读端点** | 任务单红线「不做 B 端督导工作台批量看审计（归 WP20）」；且 `/admin/api/*` 的 basic auth 中间件也放行学员 JWT，学员可能读到自己的风险事件，与"不暴露给学员 API"冲突。本表暂为 DB / 督导侧只读 |
| 9 | 词典补 5–8 个词 | 补 **7** 个（全进 `passive_ideation`），**未补任何 block 级词** | 按任务单原则：block 级宁漏勿误 |
| 10 | 阻断后"会话恢复" | 阻断**不暂停也不销毁**会话，学员下一句照常走 | 任务单原话是"会话不销毁、学员可后续恢复"；既然没销毁就无需"恢复"这个动作。`crisis_resume` 只回写 `user_choice`，**不重置 monitored** |

### 3.1 顺手修的一个真 bug（不在任务单里，但会让本单目标落空）

`detectCrisisCategories` 里 **haystack 走 NFKC**（全角标点被折成半角），而词表**没有归一** —— 于是任何含全角标点的词条（如 `'我最近总是失眠，提不起劲'`）**永远匹配不上**。

这是"只归一文本不归一词表"的漏，两边必须走同一套归一。已修：新增 `NORMALIZED_SUPPLEMENTARY_PATTERNS`（模块加载时算一次）。单测里 7 个倦怠词现在全部命中。

---

## 4. 改动面清单

### 新增（7 个文件）

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/rendering/student-risk-disposal.ts` | **纯判定模块**：side/等级/类别三条边界、处置决定、帧载荷、snippet 截断、闸门端口形状 |
| `src/engine-adapters/rendering/probe-source.ts` | 探测来源通道（ALS）：让审计表能分辨 `psyguard` / `local_dict`，不改内核 `SafetyVerdict` 形状 |
| `src/engine-adapters/wiring/risk/student-risk-gate.ts` | 处置闸门实现：监测状态（按句柄）+ 强制远端探测 |
| `src/voice/student-risk-audit-slot.ts` | 审计插槽（voice → business 方向）+ @Global 注册表 |
| `src/counselor/entities/student-risk-event.entity.ts` | 审计表 entity（13 列，无 updated_at / deleted_at） |
| `src/counselor/providers/student-risk-audit.service.ts` | 审计落库实现（只 INSERT；唯一 UPDATE 是 `user_choice`） |
| `src/migration/1714900000026-AddStudentRiskEvents.ts` | 手写 DDL 迁移（幂等：`CREATE TABLE IF NOT EXISTS` + 索引守卫） |
| `test/engine-adapters/wp14-student-risk-disposal.spec.ts` | 新增单测（24 例） |

### 修改（14 个文件）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/rendering/turn-render-orchestrator.ts` | `session.turn()` 包进探测来源通道；渲染前 gate；`TurnRenderResult.disposal` |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | 推危机帧 / 写审计 / 置位与清 monitored / 阻断轮不写逐字稿 / `markUserChoice` |
| `src/engine-adapters/wiring/engine.providers.ts` | `createRiskProbe` 不再丢 fallback（D12）；`createStudentRiskGate` 工厂；门面与后端新增可选依赖 |
| `src/engine-adapters/wiring/engine.module.ts` | 装配闸门（模块内单例）、注入门面与后端、注入审计插槽（optional） |
| `src/engine-adapters/wiring/risk/http-psyguard.probe.ts` | `fallback` 可选；失败时**委托**兜底探测器（不再直接抛给内核回落规则层） |
| `src/engine-adapters/wiring/risk/local-crisis.probe.ts` | 补 7 个倦怠词；**词表归一**修全角标点漏判；记探测来源 |
| `src/voice/voice.types.ts` | `crisis_toast` / `crisis_modal` 下行帧；`crisis_resume` 上行帧 |
| `src/voice/voice-turn-backend.port.ts` | 可选 `markUserChoice`；可选 `publishFrame` |
| `src/voice/voice.service.ts` | `crisis_resume` 分支 → 回写选择；把 `send` 作为 `publishFrame` 透传给后端 |
| `src/voice/voice.gateway.ts` | 只补了一行注释（**刻意不**用客户端可控的 WS 会话 id 登记帧出口，见 §2.6） |
| `src/voice/voice-session.module.ts` | 注册 + 导出 `StudentRiskAuditRegistry`（@Global） |
| `src/counselor/counselor.module.ts` | 注册 `StudentRiskEvent` entity + `StudentRiskAuditService` provider |
| `src/counselor/providers/supervision.service.ts` | 读审计事件 → read-time 合并 crisis annotations |
| `src/migration/index.ts` + `bin/ormconfig.ts` | **两处**都注册新迁移（漏一处 → "No migrations are pending" 漏建表） |

### 既有测试的改动（3 个文件，都是"窗口/措辞"级别）

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `test/engine-adapters/wp10-trajectory-injection.spec.ts` | 装配块切片从"固定 1600 字符"改成"按 provider 块边界" | 固定窗口被本单新增的装配行挤掉了；按块边界切更抗后续改动 |
| `test/engine-adapters/wp11-psyguard-probe.spec.ts` | 用例名与注释改成"委托 ≠ 叠加" | D12 把"丢弃 fallback"改成"委托 fallback"，口径仍是"同一时刻只有一个探测器在判" |
| `test/admin-debug/wp19r-trace-wiring.spec.ts` | **不是本单改的** | 工作区里遗留的 WP19-R 未提交改动（import 顺序 + lint 修复），本单开始前就存在 |

---

## 5. 闸门实测数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| eslint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | ✅ **0 error / 0 warning** |
| tsc | `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error** |
| 新增套件 | `npx vitest run test/engine-adapters/wp14-student-risk-disposal.spec.ts` | ✅ **24 / 24 全绿** |
| 全量套件 | `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **62 文件 / 978 例全通过**（含新增 24 例） |
| 内核零改动 | `git diff --stat HEAD -- src/engine-core` | ✅ **空**（0 文件） |
| 建表 | `pnpm migration:run` | ✅ `AddStudentRiskEvents1714900000026` 执行成功（执行前 `migration:show` 确认**只有本单这一条**待执行） |
| 表结构 | `SHOW CREATE TABLE student_risk_events` | ✅ 13 列 + 2 索引，**无 `updated_at`、无 `deleted_at`** |

> 新增套件覆盖任务单 §3 第 10 条要求的 5 个场景：
> high 阻断不渲染 / medium 不阻断推 toast / visitor_output 不推学员 / PsyGUARD 挂掉回落本地词典 / monitored=true 后续强制探测；
> 另加三条边界（side / 类别 / 零回归）与流式路径同构性。

---

## 6. 已知边界与后续

1. **职业倦怠词在 PsyGUARD 正常时不生效**（只在本服务挂掉 / 未配时兜底）。
   WP11 既有决策是"两者不叠加"（一个 session 只用一个探测端口），本单**不推翻**它 —— 改成叠加会让"远端偶发误报"变成"永远按高危走"，且双倍延迟。若要让倦怠词在远端正常时也生效，需要另开一单讨论"探测并联"的口径。
2. **`llm_start` / `llm_done` / `tts_done` 在阻断轮仍在**（生命周期帧，不是内容帧）—— 见 §3 差异 #6。
3. **审计表暂无读端点**（归 WP20）；报告侧已经能看到危机事件（read-time 合并）。
4. **阻断轮不写逐字稿**（学员原话只在审计表 `snippet` 里，≤200 字）。
5. **风险事件的 `reviewed_by` 恒为 null** —— 复核流程（谁来标已复核）属 WP20。
6. **`crisis_resume` 的三个按钮值**（`phone` / `continue` / `dismissed`）前端要自己实现：前端点"拨打"时自行 `tel:12356`，再发 `crisis_resume`。
7. **监测状态是进程内内存态**（按内核句柄）：多实例部署时，学员的下一轮可能落到另一个实例上，那边不知道本场已置位 —— 真要跨实例需要把 monitored 落到 DB 或 Redis（另议）。

---

## 7. 提交建议（本单**未**自动 commit）

```
feat(engine): WP14 学员心理风险处置层——counselor_input 侧 warn 推 crisis_toast / block 阻断推 crisis_modal 并落 student_risk_events 审计表，PsyGUARD 挂掉回落 LocalCrisisProbe，补职业倦怠 warn 级词典
```

> ⚠️ 工作区里还有一处**不属于本单**的未提交改动：`test/admin-debug/wp19r-trace-wiring.spec.ts`（WP19-R 遗留）。commit 时请分开，避免混进本单。

---

## 8. 回写去向（已同步）

按仓库惯例（多数 WP 任务单末尾都有「交付回写」段），本单已回写两处：

| 文件 | 改了什么 |
|---|---|
| `engine-wp14-student-risk-disposal-backend-2026-11-02.md`（任务单） | 头部状态改为「✅ 代码已交付并复跑绿（未 commit）」+ 交付记录链接；末尾追加 **§6 交付回写**（闸门实测 / §1 逐条对照 / 10 条偏差 / 顺手修的缺陷 / 已知边界） |
| `phase1-integration-backlog-2026-10-28.md`（集成 backlog） | 头部状态行把 WP14 从"剩余"移进"已交付"；§Phase1 增补 · WP14 段落加 ✅ 已交付 + 任务单/交付记录链接 + 落地摘要；§0 硬底线表下方加一条 **2026-11-02 日期化更正**（该表是 2026-10-30 审计快照，不重写快照行，只加指条，与 WP19-R 同款处理） |

