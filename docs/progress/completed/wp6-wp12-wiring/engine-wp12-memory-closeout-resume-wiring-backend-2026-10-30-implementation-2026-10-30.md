# WP12 · 记忆收尾 + 跨会话 resume 接线 · 后端交付记录

> 任务单: [`engine-wp12-memory-closeout-resume-wiring-backend-2026-10-30.md`](./engine-wp12-memory-closeout-resume-wiring-backend-2026-10-30.md)
> 前置: WP2（内核记忆纯函数）/ WP8-B（引擎版对话后端）/ WP9-A（角色注入）/ WP11（风险探测）
> 仓库: `E:\Work\Project\backend\mofang-nestjs` ｜ 日期: 2026-10-30 ｜ 分支: `integrate`

---

## 0. 一句话结论

**任务单 §1 的五小节全部落地**：Qdrant 补 `setPayload` + `scroll` 并在写侧做冲突消解（打 `supersededBy`，**不物理删除**）；会话结束把本场逐字稿喂给 LLM 产摘要、**晋升为长时记忆**；逐字稿在 close 时**全量定稿**落库（不再只靠进程内 Map 扛重启）；衰减半衰期与召回阈值集中配置化；**🔴 核心的 `resumeFromSessionId` 从握手 query 一路接到 `engine.open()`** —— 学员第二次打开同一个角色，引擎记得上次。

**这一轮真正的设计点有两个，都不是任务单字面写着的**：

1. **长时记忆的归属作用域从「角色」改成「学员 + 角色」**（§6.1）。内核的 `visitorId` 是长时记忆的**跨会话归属键**，写与读必须是同一把键；而这个产品里"来访者"是 **AI 扮演的角色**，角色 key 对所有学员都相同。只用角色 key 当归属键，学员 A 的咨询摘要会被学员 B 召回 —— 那不是"体验更好"，是**把甲学员的私密内容念给乙学员听**。落法是 `学员id:角色key`；**没有学员身份时干脆不写长时记忆**（没有归属就没有隔离）。
2. **摘要生成失败与逐字稿落库失败是两级不同的语义**（§4.2）。逐字稿没存下来 = **数据缺失**，记 **error**；摘要只是**增强**（下次开场能提一句上次聊了什么），它挂了不影响这场会谈已经发生的事实，记 **warn**，且**两者都不抛错** —— 收尾路径常出现在 `finally` / 断连路径上，抛错会把「清理失败」升级成「主流程失败」，反而掩盖真实错因。

**红线全部守住**：`src/engine-core/` 整树零改动（`git diff --stat HEAD -- src/engine-core` **为空**）；不做竞争抑制遗忘精细权重；不做 Chinese-MentalBERT；不做跨设备同步；不做记忆编辑/删除 UI；不做摘要人工审核（工程种子值，**已标注待专业复核**）；不强制前端本期做「继续训练」入口。

**闸门**：`tsc -p tsconfig.build.json --noEmit` **0 错** / eslint **0 error 0 warning** / WP12 新增套件 **35 例全绿** / 全量 `npx jest --silent` **57 套件 907 例中 905 例通过**，唯一失败仍是 `test/counselor/drill-judge.spec.ts` 的 **2 例既有债**（与 WP11 交付记录同两例，非本轮引入）。

---

## 1. §1.1 Qdrant 写侧冲突标记（补 WP2 缺口）

### 1.1 QdrantService 补两个能力

`src/ai-engine/providers/qdrant.service.ts` 新增：

- `setPayload(collection, id, payload)` → `client.setPayload`：**只改 payload 不动向量**。必须有它 —— 重新 upsert 会把向量一起覆盖，"只标记不删除"就做不成了。
- `scroll(collection, filter, limit)` → `client.scroll`：按 filter 滚动取点。用向量相似度反查冲突分组会**漏召回**（语义相近 ≠ 同主题），所以冲突分组必须走 filter。

### 1.2 QdrantMemoryStore 接内核冲突消解

`src/engine-adapters/persistence/qdrant-memory.store.ts`：

- **窄接口 `QdrantMemoryClient` 扩到 4 个方法**（`upsert` / `search` / `setPayload` / `scroll`，均为必需）—— 单测仍能用极小 stub，将来换向量库只影响这一个窄面。
- `remember()` 的写侧顺序是 **先 scroll 再 upsert**：先写后标记会出现「新点已落库、旧点还没标记」的中间态窗口，那个窗口里召回会同时返回新旧两条。
- 冲突分组 filter = `tenantId + visitorId + topicKey`，**刻意不带 sessionId**：冲突要**跨会话**找（同一来访者同一主题，上一场写的也得找出来）。
- 冲突判定走**内核纯函数 `applyConflictResolution`**（时间新 → 重要度高 → id 字典序，三级确定性），**不自写「新的赢」** —— 自己写一遍就是换一套规则，同一份记忆换个存储实现结论就变。
- 存活者是新条目 → `setPayload(旧点, {supersededBy: 新id})`；存活者是旧条目 → 新条目**带着** `supersededBy` 一起落库。
- **不物理删除**旧点（M4 约定）：被取代的记忆是审计线索。
- 冲突扫描**封顶 200 条**（`CONFLICT_SCAN_LIMIT`）。失败方向是安全的：超出部分**不被标记**（旧点仍可召回）= "少标记几条"，而不是"错标 / 误删"。
- 扫描失败 / 标记失败**只记 warn，不阻断写入**。

---

## 2. §1.2 短时摘要 + 会话结束晋升长时

### 2.1 新增两个 B 层文件

| 文件 | 职责 |
|---|---|
| `src/engine-adapters/persistence/session-closeout.service.ts` | 收尾**编排**：逐字稿落库 + 摘要晋升，两级失败语义 |
| `src/engine-adapters/persistence/session-summary.generator.ts` | 摘要**生成**：逐字稿 → LLM → `{summary, topicKey}` |

**为什么收尾逻辑住 B 层而不是内核**：内核 `EngineSessionPort.closeSession` 是**同步、幂等、不做持久化**的契约 —— 把它改成 async = 破坏已发布契约；把仓储写塞进去 = 让同步关闭路径去等 I/O，关闭时延不可控，且失败时"会话关不掉"。内核 `memory/promotion.ts` 的注释里已经把这条写死了：「关闭只释放运行时句柄；落库由**会话结束编排层（B 层）**负责」。

### 2.2 晋升流程

`SessionCloseoutService.promoteSummary()`：构造一条 **SHORT_TERM** 记忆 → 内核纯函数 `promoteShortTermToLongTerm`（tier 改写 / TTL 转永久 / 继承 visitorId / 换新 id 只有那一份）→ `memories.remember(longTerm)`。

**摘要重要度 = `DEFAULT_SESSION_SUMMARY_IMPORTANCE` = 0.9**（**工程种子值，未标定**）。理由：内核 `collectOpeningContext` 召回长时记忆时带 `minImportance: 0.5`，而有效重要度是**衰减后**的值（半衰期 30 天）—— 0.9 衰减到 0.5 需要 ≈23 天，也就是「学员一周后回来还能被想起」。调低 → 摘要很快淡出，resume 时开场想不起来上次聊了什么，那这条记忆就白写了。

### 2.3 摘要提示词口径

`SUMMARY_SYSTEM_PROMPT` 要求 JSON 输出（`{summary, topicKey}`），并显式写明：**只描述来访者表达出来的内容与情绪，不做临床诊断，不给建议，不写具体话术**。`formatTranscript()` 显式标注「咨询师 / 来访者」—— 引擎链路里 `role='user'` 是**咨询师**、`role='assistant'` 是**来访者**（AI 扮演），不标注模型会把两边读反，摘要把咨询师的话当成来访者的事实，那条记忆就从根上错了。

### 2.4 摘要只放记忆、逐字稿归逐字稿表

记忆里**只放摘要，不放原文**；逐字稿仍归 `training_sessions.transcript`。两者不混。

---

## 3. §1.3 衰减半衰期 + 召回阈值配置化

`src/engine-adapters/persistence/memory-config.ts`（新增）：

- `MemoryConfig { decayHalfLifeMs, recallThreshold }`；`resolveMemoryConfig(env)` 是**纯函数**（env 由装配层读好传入，工厂不读 env）。
- 默认：半衰期 **30 天** / 阈值 **0.1**（与内核常量同值）；**非法 env 一律回退不抛错**（填错一个 env 不该让整个服务起不来）。
- env：`MEMORY_DECAY_HALF_LIFE_DAYS` / `MEMORY_RECALL_THRESHOLD`（`.env.example` 已加，含口径说明）。

**⚠️ 与内核常量的关系必须如实知道**（见 §6.2）：内核 `evaluateRecallCandidate` 内部硬编码 30 天半衰期 + 0.1 阈值且**不暴露参数**，WP12 红线禁改内核 —— 所以 env 阈值**只能收紧**（配成 < 0.1 不会让内核放行），配成 > 0.1 会在 B 层额外加一道。

---

## 4. §1.4 逐字稿落库口径写死

### 4.1 插槽：`VoiceSessionBridge.replaceTranscript?`（**可选**方法）

`src/voice/voice-session-bridge.ts`：

- 新增 `VoiceSessionTranscriptInput { dbSessionId, userId?, turns }`。
- 桥接口新增**可选**方法 `replaceTranscript?(input)`；`VoiceSessionBridgeRegistry.replaceTranscript()` 三种结局：
  - 有桥实现且写成功 → `true`；
  - **没有桥实现该能力**（老实现 / 测试桩）→ `false`，**不抛**（属常态降级）；
  - 有桥实现但**全部写失败** → **抛错**（数据没存下来，必须让人知道）。
- 为什么是**可选**而不是必需：桥是插槽，实现方可能还没接覆盖写（第三方实现 / 测试桩）。写成必需 → 所有实现方一次性全炸；写成可选 → 没实现的桥照常跑，只是"收尾时不做全量覆盖"，且**降级可见**（注册表返回 false）。

### 4.2 业务侧实现：`VptSessionBridgeService.replaceTranscript`

`src/counselor/providers/vpt-session-bridge.service.ts`：

- **覆盖 = 定稿语义**（不是追加）：追加会让同一段话在库里出现两份，督导分析看到重复对话。
- 角色映射**不能反**：`role='user'`（咨询师）→ `ChatRole.COUNSELOR`，`role='assistant'`（来访者）→ `ChatRole.VISITOR`。报告链路按 counselor/visitor 判定「评估对象是谁」，映射反了整份报告就评错人。
- **两条硬边界**：
  - ① **空快照不写** —— 拿空去覆盖会**抹掉已经落库的逐字稿**（数据丢失），所以空 → 跳过 + warn；
  - ② **状态只进不退** —— `IDLE → LISTENING` 可以，`finished` 绝不被改回 `listening`（状态归 `close` 管，flush 只碰逐字稿）。
- 落库会话不存在 → **抛错**（"不落库就报错"，不静默）。
- 走桥内**同一条串行链**，且用的是**会冒泡**的 `enqueueOpOrThrow`（链不断，但错误抛回调用方）：flush 与 close 共用一条链 → flush 一定排在 close 之前（close 要读库里的逐字稿算素材量，顺序反了会读到截断版）。

### 4.3 引擎侧触发

`EngineStreamBackend.closeSession()` → fire-and-forget 调 `closeout.finalize()`（与仓库既有 `traceRecorder.flush` / `triggerSupervisor` 同款：收尾是 I/O，不能反过来阻塞 `session_ended` 帧）。

**⚠️ 只在会话真的开着时触发**（按句柄判定）：voice 侧的关闭路径会把「当前后端」与「引擎后端」**各关一次**（引擎链路下这两个是同一个对象），第二次调用时句柄已被清掉，若不按句柄判定，第二次就会拿**空逐字稿**去覆盖写库 —— 把刚落库的逐字稿抹掉，而且不留任何痕迹。

---

## 5. §1.5 🔴 跨会话 resume 接线（本单核心）

### 5.1 接线链路（逐层透传，每层只做自己那一件事）

| 层 | 改动 |
|---|---|
| 握手 query | `VoiceHandshakeQuery.resumeFromSessionId?`；`readResumeFromSessionId()` **复用 `sessionId` 的 `sanitizeSessionId`**（同样客户端完全可控、同样进日志与下游查询 → 同一套清洗，两份清洗迟早漂移） |
| WS 层 | `SocketData.resumeFromSessionId?` + `VoiceSessionMeta.resumeFromSessionId?`（gateway 只透传，不判断上一场在不在） |
| voice 服务 | `VoiceService.openBackendSession()` 透传 `resumeFromSessionId` **与 `userId`**（`userId` 是长时记忆归属作用域的原料） |
| 窄接口 | `VoiceTurnBackendOpenOptions.resumeFromSessionId?` + **新增 `userId?`**（都是**可选增量**：必填字段会让旧实现 `VisitorService` 再也塞不进契约，"并存可回退"当场破产） |
| 引擎适配层 | `EngineStreamBackend.openSession()` → `engine.open(buildInput, openOptions)` |

### 5.2 三条关键行为

1. **条件透传**：没传时**键不存在**（不是"值为 undefined"）—— WP10 的零回归断言 `['sessionId','tenantId','visitorId']` 断言的就是**键集合**，键存在即算形状变了。
2. **resume 失败不阻断**：接续抛错 → 记 warn → **不带 resume 重开一次**（"按新会话开"），**不抛错、不断连**。没传 resume 且开场本身失败 → 错误**照常抛出**（不吞真实故障）。
3. **内核已支持，本轮只接线**：`OpenEngineSessionInput.resumeFromSessionId` 早已存在；`InMemoryEngineSession.loadState` 会搬上一场 BDI 快照；`collectOpeningContext` 召回 visitor 范围 LONG_TERM Top5（`minImportance: 0.5`）并挂 `openingContext`；召回异常内核自己吞掉。

**为什么"失败就按新会话开"而不是回落旧链路**：旧链路是另一个引擎（visitor 直出），混进来会让"这次到底用的哪条链路"变得不可知 —— 学员刚点了「继续训练」，结果接到的是一个完全不记得上次的新引擎，那比直接开新会话更让人困惑。

---

## 6. 与任务单的差异（**显式说明**）

### 6.1 长时记忆作用域：从「角色」改成「学员 + 角色」（**超出任务单字面，防跨学员泄漏**）

任务单 §1.2 写的是「摘要作为一条 `LONG_TERM` 记忆写入 Qdrant（scope=visitor，**按 visitorId 归属**）」，字面读起来是沿用现状的 `visitorId` 口径。现状的 `visitorId` 是 **personaId**（角色 key，所有学员相同）。

- **不改就是隐私事故**：学员 A 与学员 B 练同一个角色 → 归属键相同 → A 的咨询摘要会被 B 召回。
- **落法**：`buildMemoryScope(userId, characterKey)` = `学员id:角色key`；角色 key 取 `templateId ?? personaId ?? 'voice_visitor'`（vpt 场 personaId 常常是空的，只有模板 id 能区分「晚晴」和「小满」）。
- **无学员身份时**（理论上不该发生，语音链路有 JWT 鉴权）→ **不写长时记忆**（`studentScoped=false` → 收尾时根本不带 `visitorId` → 收尾服务直接跳过晋升）。
- **影响面**：内核入参 `visitorId` 的**值**变了；`visitorId` **不进 prompt**、不影响 BDI seed → **渲染与决策零变化**，只有 WORKING 记忆的 payload 字段值变了。
- **对外契约不变**：返回的 `persona.id` **仍为 personaId**（WP9-A 既有断言 `expect(persona.id).toBe(VISITOR)` 保持绿）。

### 6.2 §1.3 配置化**只到 B 层**（内核地板仍在）

红线禁改 `src/engine-core/**`，而内核 `evaluateRecallCandidate` 内部硬编码 30 天半衰期 + 0.1 阈值**且不暴露参数** —— 那道地板**不可绕过**。

- 本单配出来的值在 **B 层口径**上**完全生效**（B 层算有效重要度时用它，门槛判定 + 排序都用它；阈值在访客范围**追加**一道，与内核地板取交集 = 更严）。
- env 阈值**只能收紧**（< 0.1 不生效）。
- 分歧只出现在「很旧」的条目；**默认配置下与现状逐字一致**（30 天 / 0.1 == 内核默认值）。
- 要让 env 完整接管内核那一次判定，**必须改内核** —— 那是另一个 WP 的事。

### 6.3 逐字稿**原本就已经每轮落库**（本单补的是 close 时全量 flush）

现状是**每轮** `appendTurn` 追加进 `training_sessions.transcript`（counselor 侧落库桥）。那份增量在进程中途崩溃时会停在最后一轮 —— 逐字稿**不全**；而 `EngineStreamBackend.transcripts` 是进程内 `Map`，重启即丢。

§1.4 的真实缺口因此不是"加落库"，而是 **close 时的全量定稿（覆盖语义）**：补上增量写入失败的那些轮次，并**明确落库边界**（落不下去要报错留痕，不留「好像存了」的模糊）。

### 6.4 覆盖写的副作用（刻意接受）

引擎副本记的是**完整跑完**的轮次；引擎全挂走兜底句的**降级轮次本就不进逐字稿**（与旧链路「早退不落逐字稿」同口径）。覆盖写会把它从定稿里去掉 —— 这是**刻意**的：兜底句不是来访者的真实表达，留在逐字稿里只会污染督导分析。代价（轮次数变少）由业务侧日志留痕。

---

## 7. 闸门实测结果

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npm run lint`（`eslint --cache "src/**/*.ts"`） | **exit 0 / 0 error 0 warning** |
| `git diff --stat HEAD -- src/engine-core` | **为空**（内核整树零改动） |
| `npx jest test/engine-adapters/wp12-memory-closeout.spec.ts` | **35 / 35 全绿** |
| `npx jest test/engine-adapters test/engine-core test/voice` | **28 套件 583 例全绿**（engine-core 零回归） |
| `npx jest --silent`（全量） | **57 套件 907 例中 905 例通过**；唯一失败 = `test/counselor/drill-judge.spec.ts` **2 例既有债**（与 WP11 交付记录同两例，非本轮引入） |

**新增测试覆盖任务单 §3.9 的四种场景 + 配套边界**：

| 场景 | 用例 |
|---|---|
| ① resume 成功 | `engine.open` 收到 `resumeFromSessionId` |
| ② resume 不存在 | 不抛错；`open` 被调两次，第二次**不带** resume；会话照常开起来 |
| ③ 摘要失败 | `summaryPromoted=false` 但**不阻断**，逐字稿照样落库，记忆仓储里查不到新条目 |
| ④ 冲突标记 | 新条目更晚 → 旧点 `setPayload({supersededBy: 新id})`；旧条目更晚 → 新条目带 `supersededBy` 落库 |
| 零回归 | 不传 resume → 入参里**没有** `resumeFromSessionId` 这个**键**；空串 resume 同理 |
| 作用域 | `visitorId = 学员id:角色key`；`persona.id` 仍为 personaId |
| 逐字稿定稿 | 覆盖写拿到引擎副本全量 + 角色映射正确；空快照不覆盖；会话不存在抛错 |
| 配置化 | 默认 / env 覆盖 / 非法值回退 |
| 摘要解析 | 标准 JSON / 代码块围栏 / 非 JSON 退化 / 空输出 / 提示词角色标注 / 模型名 env 优先 |

**既有护栏测试的两处改动**：

1. `test/engine-adapters/wp8-wiring.spec.ts` 的「配了向量库 → Qdrant 版」用例里那个 Qdrant 桩只有 `upsert` / `search`，窄面扩到 4 个方法后它在**类型**上就挂 —— 整个套件（34 例）**不执行**。已补 `setPayload` / `scroll`。
2. `test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts` 的「工厂的 inject 显式带上角色解析端口」原本用**固定 600 字符窗口**截取 `inject` 段 —— WP12 给 provider 块加了一个依赖（收尾服务）后，窗口取不全，护栏变成「看起来在跑、其实没看见」。已改为**按括号匹配**取 `inject` 数组（护栏意图不变，且下一次接线不会再悄悄失效）。

---

## 8. 改动面清单

### 8.1 新增（4）

| 文件 | 作用 |
|---|---|
| `src/engine-adapters/persistence/memory-config.ts` | 衰减半衰期 / 召回阈值集中配置（纯函数，非法值回退） |
| `src/engine-adapters/persistence/session-closeout.service.ts` | 会话收尾编排（逐字稿定稿 + 摘要晋升，两级失败语义） |
| `src/engine-adapters/persistence/session-summary.generator.ts` | LLM 摘要生成（JSON 输出 + 容错解析 + 模型名解析） |
| `test/engine-adapters/wp12-memory-closeout.spec.ts` | WP12 新增套件（35 例） |

### 8.2 修改（16 个代码/配置/测试文件 + 2 个文档）

| 文件 | 改了什么 |
|---|---|
| `src/ai-engine/providers/qdrant.service.ts` | `setPayload` + `scroll` |
| `src/engine-adapters/persistence/qdrant-memory.store.ts` | 窄接口扩到 4 方法；写侧冲突消解（scroll → 内核 `applyConflictResolution` → `setPayload` 标 `supersededBy`）；召回接入配置化有效重要度 |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | **resume 接线 + 兜底**；**记忆作用域改造**；close 触发收尾（按句柄判定，防二次覆盖）；`openSession` 拆方法降复杂度 |
| `src/engine-adapters/wiring/engine.providers.ts` | `createSessionCloseout` / `createBridgeTranscriptSink` 工厂；`createEngineStreamBackend` 传第 5 位参数；记忆仓储接受 `config` |
| `src/engine-adapters/wiring/engine.module.ts` | 装配收尾服务（记忆仓储 + LLM 摘要器 + 落库口）；记忆仓储接 env 配置；后端工厂注入收尾服务 |
| `src/voice/voice-handshake.ts` | 握手 query `resumeFromSessionId` + 清洗（复用 `sanitizeSessionId`） |
| `src/voice/voice.types.ts` | `VoiceSessionMeta.resumeFromSessionId?` |
| `src/voice/voice.gateway.ts` | `SocketData.resumeFromSessionId?` + 两处透传 |
| `src/voice/voice.service.ts` | 透传 `resumeFromSessionId` + `userId` |
| `src/voice/voice-turn-backend.port.ts` | `resumeFromSessionId?` + `userId?`（均可选增量） |
| `src/voice/voice-session-bridge.ts` | `VoiceSessionTranscriptInput` + 可选 `replaceTranscript?` + 注册表方法 |
| `src/counselor/providers/vpt-session-bridge.service.ts` | 实现 `replaceTranscript`（覆盖写 + 空快照不写 + 状态只进不退 + 抛错语义）+ `enqueueOpOrThrow` |
| `.env.example` | `MEMORY_DECAY_HALF_LIFE_DAYS` / `MEMORY_RECALL_THRESHOLD` / `MEMORY_SUMMARY_MODEL`（含口径说明） |
| `test/engine-adapters/qdrant-memory-store.spec.ts` | `StubQdrant` 补 `setPayload` / `scroll`（窄接口已改必需方法） |
| `test/engine-adapters/wp8-wiring.spec.ts` | 装配工厂用例里的 Qdrant 桩补 `setPayload` / `scroll`（同上；不改的话该套件在**类型**上就挂，整套 34 例不执行） |
| `test/engine-adapters/wp9b-engine-stream-backend-wiring.spec.ts` | 护栏取窗口方式改括号匹配（见 §7） |

**文档（2）**：`docs/progress/engine-wp12-...-2026-10-30.md`（任务单：状态改「已交付」+ 追加交付摘要并交叉链接本记录）/ `docs/README.md`（`progress/` 索引表新增一行，任务单与交付记录**成对出现**）。

### 8.3 红线核对

| 红线 | 核对 |
|---|---|
| 不改 `src/engine-core/**` | ✅ `git diff --stat HEAD -- src/engine-core` **为空** |
| 不做竞争抑制遗忘精细权重 | ✅ 未做 |
| 不做 Chinese-MentalBERT | ✅ 未做 |
| 不做跨设备同步 | ✅ 未做 |
| 不做记忆编辑/删除 UI | ✅ 未做（且被取代的记忆**不物理删除**，只标 `supersededBy`） |
| 不做摘要人工审核 | ✅ 未做人工审核环节；摘要重要度 0.9 已标注**工程种子值、待专业复核** |
| 不强制前端本期做「继续训练」入口 | ✅ 后端链路先通，前端本期不接（`resumeFromSessionId` 缺省 = 新会话） |

---

## 9. commit 文案

```text
feat(engine): WP12 Qdrant 写侧冲突标记 + 短时摘要晋升长时 + openSession 传 resumeFromSessionId 打通跨会话记忆接续
```

---

## 10. 用户验收 + 已知边界

### 10.1 怎么验（curl / Postman 即可，前端本期不用改）

1. **新会话**（不传 `resumeFromSessionId`）→ 行为与现状**逐字一致**（入参里连这个键都没有）。
2. **同角色第二次开场**：第一次握手后拿 `sessionId`，第二次握手带上 `resumeFromSessionId=<上次的 sessionId>` → 内核搬上一场 BDI 快照 + 按 visitorId 召回长时记忆 → 开场首论带 `openingContext`（「上次我们聊到了……」）。
3. **resume 一个不存在的 sessionId** → **不报错**，按新会话开，日志有 `[openSession] 接续上一场失败, 按新会话开` 的 **warn**。
4. **会话结束** → 逐字稿落库（`training_sessions.transcript` 被**全量定稿**）+ 摘要晋升长时记忆（配了 `QDRANT_URL` 时 Qdrant 可查到）。
5. **Qdrant 写新记忆时** → 同 `visitorId` + 同 `topicKey` 的旧点 payload 上出现 `supersededBy`。
6. **摘要生成失败**（把 `MEMORY_SUMMARY_MODEL` 配成一个不存在的模型名）→ `closeSession` 正常完成，只是没晋升，日志有 **warn**。

### 10.2 已知边界

- **摘要重要度 0.9 / 半衰期 30 天 / 阈值 0.1 都是工程种子值，未标定** —— 后期靠真实训练数据校准，**不是临床结论**。
- **§1.3 配置化只到 B 层**（内核地板仍在，阈值只能收紧）—— 见 §6.2。
- **长时记忆作用域已改成「学员 + 角色」**（超出任务单字面，防跨学员泄漏）—— 见 §6.1。
- **摘要模型名 env 优先、否则走 router 的 RAG 分层默认模型** —— 各家厂商的模型名只有 router 知道，装配层不硬编码第二份真相。
- **前端「继续训练」入口本期不做**（任务单 §1.5.6 明确不强制）—— 后端链路已通，前端接上 `resumeFromSessionId` 即可。
- **`SessionCloseoutService` 是 fire-and-forget** —— 收尾 I/O 不阻塞 `session_ended` 帧；失败只留日志，不影响前端拿到结束帧。
- **摘要走 LLM，有成本与时延** —— 收尾是 fire-and-forget，不阻塞会话结束；但会占用一次模型调用额度。
- **服务器镜像尚未重建**：`mofang-nestjs-api` 仍是 2026-08-26 构建（WP11 决策 #1：攒到 WP12 一起发）—— **本单未触发重新构建**，需要时另行发布。
- **不自动 commit / push**：改动都在工作区，提交与否由用户决定。
