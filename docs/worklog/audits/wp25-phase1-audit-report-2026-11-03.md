# WP25 · Phase1 封版扫描报告

> 日期：2026-11-03 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 任务单：`docs/worklog/completed/phase1/wp14-wp24-augment/engine-wp25-phase1-audit-backend-2026-11-03.md`
> 性质：M3 内测前的全量审查 —— 不是写新功能，是系统性扫一遍代码与文档
> 范围：`src/**` 全量 + `test/**` + `admin-dashboard/` + `docs/worklog/**` + `.env.example`
> 手段：机械 grep（AST 级）+ 4 个并行专项子代理（安全 / 文档一致性 / 已知尾巴 / 引擎层）

---

## 0. 一页结论

| 档 | 数量 | 处置 |
|---|---|---|
| **P1**（内测前必修） | **8** | ✅ **本单已全部修完**（含回归测试） |
| **P2**（内测前建议修） | **39** | 📋 **本单只列不改，等用户拍板**（§2） |
| **P3**（Phase2 再说） | **10** | 📦 **已进 backlog Phase2 队列**（§3） |
| 已知尾巴 5 条 | 5 | ✅ **全部核实并归档**（§1） |

**本单改动的文件**（11 个源文件 + 4 个测试文件）：

```
src/app.middleware.ts                      CSP 指令 + SESSION_SECRET 兜底
src/admin-debug/admin-basic-auth.middleware.ts   生产 fail-close
src/profile/providers/profile.service.ts   头像错误文案脱敏
src/voice/voice-session-limit.error.ts     新错误码 session_owned_by_other_user
src/voice/voice.service.ts                 会话归属判定 (顶替前 / 补漏前)
src/voice/voice.gateway.ts                 归属校验接线 + 帧出口登记挪到鉴权后
src/engine-core/cognition/state-transition.ts   capObserver 抛错不再炸穿 turn
test/voice/wp25-ws-session-ownership.spec.ts    新增 (10 例)
test/base/wp25-security-hardening.spec.ts       新增 (16 例)
test/config/wp25-env-example-coverage.spec.ts   新增 (4 例)
test/voice/wp23-gateway-reconnect.spec.ts        补桩 (FakeVoiceService 加归属判定)
test/engine-core/wp15-delta-cap.spec.ts          加 2 例 (observer 抛错)
.env.example                                补 130 个键 + 47 个死键降级
docs/worklog/completed/.../engine-wp25-...md   §1.4 回改方向修正
```

---

## 1. 已知尾巴 5 条 —— 逐条核实结果（验收 #4）

### 1.1 流式 done chunk 缺 finishReason —— 🔶 **真缺口，列 P2**

- **位置**：`src/engine-adapters/wiring/engine-stream-backend.adapter.ts:989-999`、`src/voice/voice.service.ts:1649-1658`
- **结论**：上游**拿得到** `finish_reason`（stop / length / content_filter），但在组装 done chunk 时**丢掉了**。
- **为什么不是 P1**：只影响内测时的可观测性 —— 用户侧表现是"回复突然断了"，但**不影响正确性**（不崩会话、不产生数据不一致）。
- **建议修法**：3 处透传字段，工作量约半小时。**已列 P2-#1**，等拍板。

### 1.2 WP12 半衰期单向生效 —— ✅ **是设计，不是 bug**

- **位置**：`src/engine-core/memory/importance-decay.ts:33/41`、`src/engine-core/cognition/recall-policy.ts:93-95`
- **结论**：内核里有一道**地板**（`recallThreshold` 不得低于 0.1），所以配了 `MEMORY_RECALL_THRESHOLD < 0.1` 不会让内核放行更多记忆 —— 这是**有意的**（内核红线的推论：阈值只能收紧不能放松）。半衰期本身是双向的。
- **影响面**：只影响**召回准入**，不影响衰减计算本身。
- **处置**：✅ **划掉**（不是 bug）。代码注释已写清口径，本单无需改动。

### 1.3 admin SPA mock 页面盘点 —— 🔶 **9 个页面，7 个全 mock（列 P2）**

- **位置**：`admin-dashboard/src/router/index.ts:14-25`（9 个页面）、`admin-dashboard/src/api/client.ts:53-116`
- **盘点结果**：

| 页面 | 数据来源 | 内测需要？ |
|---|---|---|
| 4 个页面（会话列表 / 详情 / 轻提示 / 移情标记） | **真 API** | 内测链路走这些 ✅ |
| 3 个页面 | 全 mock | 内测链路**不走** admin-dashboard |
| 1 个页面 | 半真（API 骨架 + mock 数据） | 视内测是否进后台 |
| 1 个页面 | 全 mock，且**缺 pending 状态标注** | ⚠️ 列 P2-#2 |

- **关键结论**：**内测主链路（对练 → 逐字稿 → 督导报告）不走 admin-dashboard**，所以 mock 页面不是内测阻塞项。
- **处置**：降级为 P2-#2（只给缺 pending 标注那个页面补标注）。

### 1.4 WP11 临时值回改 checklist —— 🔴 **任务单 §1.4 方向写反了（P1，已修）**

- **任务单原文**：「测试期超时 150ms、token 28 是放宽值，内测前要回改生产值（500ms / 256 token）」。
- **事实**：**方向完全相反**。正式口径是 **150ms / 28 token**（真机 BERT-large int8 延迟预算反推出来的值，见 WP11 交付记录 `:201`）；测试期为了"只有一个人用、准确率优先于延迟"把它**放宽**成了 **500ms / 256 token**。
- **照原文执行的后果**：把生产值改错方向（150 → 500 = 把临时值固化成正式值）。
- **处置**：✅ **已修** —— 任务单 §1.4 已重写为核实后的正确方向，并附 **11 处回改 checklist**（本仓 8 处 + 兄弟仓 `mofang-psyguard` 3 处）。
- **本单新发现的关键点**：装配层 `engine.module.ts:131/188/226` **显式**传了 `resolvePsyGuardTimeoutMs(config.get('PSYGUARD_TIMEOUT_MS'))` —— 输出侧走**独立 env 读取**，**不会**跟着内核常量走。旧交付记录写的"全仓只有一个回改点"**不成立**。

### 1.5 abort → cancelled 帧 —— ✅ **不是 bug，划掉**

- **位置**：`src/voice/voice.service.ts` 的 `state.status = 'cancelled'`（只写不读）
- **结论**：barge-in 是**正常交互**不是错误，客户端收 `cancelled` 是正确语义。
- **处置**：✅ **划掉**。"状态只写不读"这一点单列为 P3-#4（可选补注释），不影响本单。

---

## 2. P2 —— 内测前建议修（**已全部处理**）

> 分四组：安全 / 引擎层 / 文档一致性 / 配置与已知尾巴。每条写清位置、问题、建议修法、预估工作量。
>
> **V2026-11-03 回写（WP26 交付）**：本节 39 条 P2 的处置状态 —
> ✅ = **已修复**（38 条：34 条由 WP26 修，含 P2-2 / P2-36 的**后端**部分；P2-8 / P2-30 / P2-31 / P2-32 由 WP25 回写时已处理）；
> ⏳ = **真机验证项**（1 条：P2-37，Flutter 客户端不在本仓，需内测前在真机确认）。
>
> 逐条交付明细见 [WP26 交付记录](./completed/wp14-wp24-augment/engine-wp26-phase1-p2-hardening-backend-implementation-2026-11-03.md)。

### 2.1 安全侧（10 条）

| # | 位置 | 问题 | 建议修法 | 工作量 |
|---|---|---|---|---|
| P2-1 ✅ | `src/voice/voice.gateway.ts:358-370` `verifyJwt` | WS 握手只验签名，**不查 token type、不查黑名单** —— 已登出的 access token 仍能连 WS | 复用 `JwtAuthGuard` 的黑名单查询；或至少校验 `type` 字段 | 2h |
| P2-2 ✅ | `src/voice/voice.gateway.ts` `extractToken` | JWT 走 **URL query**（`?token=`）→ token 会落进 nginx access log / Referer / 浏览器历史 | 改用握手头（`Authorization`）或 `Sec-WebSocket-Protocol`；query 只作兼容兜底。**（WP26 实做：三级 = `Sec-WebSocket-Protocol` 子协议 → `handshake.auth.token`（Socket.IO 标准握手字段，Flutter 端走这条）→ `?token=` 兜底）** | 半天（需前端配合） |
| P2-3 ✅ | `src/shared/infra/metrics/metrics.controller.ts:29-40` + `config/envs/default.ts:105-107` | `/metrics` **默认开启且无鉴权** → 暴露内部指标（QPS / 延迟 / 错误率） | 生产默认关闭，或加内网 IP 白名单 / 独立 token | 1h |
| P2-4 ✅ | `src/admin-debug/` 整个命名空间 | 只有 basic auth / 学员 JWT，**没有角色校验** —— 任何学员凭自己的 token 都能进调试器（虽然只能看自己的会话，但不该有） | 加 `AdminRoleGuard`（查 `users.admin_role`） | 半天 |
| P2-5 ✅ | `src/voice/voice.gateway.ts` 握手流程 | 握手里有**写状态的动作**早于部分校验 | 把写动作全部推到校验之后（本单已推了归属校验，还有别的写动作待复核） | 1h |
| P2-6 ✅ | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts:596` | 「会话未开启」抛**裸 `Error`**，绕过内核 `SESSION_NOT_FOUND` 码 → 落到全局兜底 **500**（语义应是 404） | 改抛 `EngineCoreError(EngineErrorCode.SESSION_NOT_FOUND)` | 5 分钟 |
| P2-7 ✅ | `src/engine-adapters/wiring/engine-wiring.controller.ts:203-204` | `mapKernelError` 的 `default` 分支返回固定串 `'引擎内部错误'`，**丢掉了 `error.message` 与 `error.details`**（details 本来就是给 adapter 判"是否回传/写日志"用的） | default 分支携带 details（剔除敏感字段），或至少打进 logger | 5 分钟 |
| P2-8 ✅ | `.env.example` 预留区 47 个键 | 这些键**代码里查无读取点** —— 配了不生效，且不报错（最费时间的排障陷阱） | 本单已**降级为注释区**（不再冒充契约）；要启用需先在代码接上读取点 | 已做一半 |
| P2-9 ✅ | `src/engine-core/cognition/safety/assess-safety.ts:87` | JSDoc 写「种子值 `DEFAULT_PROBE_TIMEOUT_MS=150`」，而常量 `:75` 是 **500** —— **同一文件内自相矛盾** | 改成「当前 500（测试期放宽），内测前回改 150」 | 5 分钟 |
| P2-10 ✅ | `src/engine-adapters/wiring/risk/http-psyguard.probe.ts:41/45/50/148`、`psyguard-health.checker.ts:67` | 注释里写「内核探测超时 = 150ms」，**当前实际是 500ms** —— 骗人 | 同 P2-9 | 10 分钟 |

### 2.2 引擎层（8 条）

> 以下均**不崩会话、不产生数据不一致**，按任务书口径归 P2。其中 **P2-11 / P2-12 建议优先拍板**，因为它们决定 WP15 的不变量到底成不成立。

| # | 位置 | 问题 | 建议修法 | 工作量 |
|---|---|---|---|---|
| P2-11 ✅ | `src/engine-core/cognition/state-transition.ts:307-312`、`src/engine-adapters/wiring/delta-cap.logger.ts:55-57` | cap 报告**不带任何会话标识**（sessionId / handleId）→ M3 多人内测时，运维看到 `[WP15] turn delta capped: trust raw=+0.30 ...` **无法定位是哪场会话被砍** | 给 `transitionState` 加可选 `context?: { sessionId; handleId }` 并透传进报告，adapter 日志加 `session=` 前缀 | 半小时 |
| P2-12 ✅ | `src/engine-core/cognition/trajectory/trajectory-applier.ts:201-219` | **轨迹 delta 完全绕过单回合 cap**：turn 顺序是 `transitionState`（已 cap）→ `applyTrajectoryStep` → `applyDelta`，后者把 `node.delta` **再次叠加**且**只 clamp 不 cap**。例：`crisis_signal` 的 `valence=-0.3` 恰等于下向 cap，叠加后单回合 valence 可达约 **-0.6**（2 倍 cap） | **二选一，需拍板**：① 把 `capTurnDelta` 复用到轨迹叠加之后，并让报告覆盖叠加量（半天）；② 明确写下「cap 只管**事件 delta**，轨迹 delta 是剧本作者显式意图，不受 cap 约束」，并让报告口径可读（半小时） | 选①半天 / 选②半小时 |
| P2-13 ✅ | `src/engine-core/cognition/state-transition.ts:258` + `typings/global.d.ts` | 18 个 `ENGINE_CAP_*` 键**未声明到 `NodeJS.ProcessEnv`**，且用**计算键 + bracket 访问**绕过仓库 env 治理约定（`global.d.ts:117/132/175` 三次重申「显式声明，不用 bracket 绕过」）。**计算键 + bracket 访问不会触发 TS4111** —— 编译器也拦不住，属**静默偏离** | 补 18 行显式声明 + 改点访问；或把 18 个键名集中成内核导出的 `CAP_ENV_KEYS` 常量表并登记该派生族 | 半小时 |
| P2-14 ✅ | `src/engine-core/domain/ports/render-port.ts:9`、`src/engine-core/domain/engine-session.types.ts:43` vs `state-transition.ts:19-21` | 内核曾把「**没有配置层**」当作边界优势来论证，WP15 在核心里引入了**第一处 env 读取** —— 与自述直接冲突。更实质的后果是**可复现性**：`seed` 被定义为「可复现性的入口」，而 env 参与决策后，同 seed 同序列在不同 cap 配置下会落到不同状态，**回放/对拍失去意义** | 优先走**注入**（内核已有 `now` / `idFactory` / `classifier` / `riskProbe` 四个注入先例），adapter 读 env 后传入；若坚持读 env，必须同步修订这两处自述 | 改注入=半天 / 改自述=半小时 |
| P2-15 ✅ | `src/engine-core/cognition/state-transition.ts:3` | 文件头第 3 行「边界: 纯函数, 无状态, 无随机, 可复现」现在**三项都不成立**（① `transitionState` 会调外部回调；② `let capObserver` 是模块级可变状态；③ env 参与决策） | 改写成「边界: 确定性状态迁移；**例外**: cap 参数读进程 env、cap 报告走观察者回调」 | 5 分钟 |
| P2-16 ✅ | `src/engine-adapters/wiring/delta-cap.logger.ts:27` + `src/engine-core/index.ts:2-3` | WP15 新增的 6 个对外符号**不进 barrel**，adapter 走深路径 `../../engine-core/cognition/state-transition.js`。后果：`boundary.spec.ts` 断言⑥ 的**双向白名单是唯一守卫公开面的机器断言**，而它只看 `index.ts` → 这批符号**完全在守卫视野之外**（将来内核改文件名/目录，adapter 直接断，**没有任何断言会红**） | 把 WP15 公开面补进 `index.ts` + 同步更新 `boundary.spec.ts` 的 `expectedPublic`；并给 `boundary.spec.ts` 补一条断言：**禁止 `src/engine-adapters/**` 深路径 import `engine-core/` 的非 `in-memory/` 内部模块**（当前全仓仅 1 处越界） | 半小时 |
| P2-17 ✅ | `test/engine-core/boundary.spec.ts:160-170` | 9 条断言全部基于 AST 抽取**模块说明符**，只覆盖 import。`process.env` 是全局对象访问 —— **WP15 引入内核第一处 env 读取时，9 条断言全绿**。也就是说"内核不读 env"这条内核最核心的不变量在机器层面**裸奔** | 加第 10 条断言：内核树**零 `process.env` / 零 `globalThis` 访问**（或白名单化）。若采纳 P2-14 的"改注入"，该断言可零白名单直接成立 | 半小时 |
| P2-18 ✅ | `src/engine-core/domain/engine-errors.ts:27-40` | 6 个错误码里**缺「仓储/依赖失败」一类**；`UNSUPPORTED` 是**死码**（全仓零抛出点）。内核刻意不 catch 仓储异常（"状态冲突必须冒泡给 adapter"），但端口契约里没为它预留错误码 —— `adapters/README.md:79` 已规划 `typeorm-bdi-state.repository.ts`，届时 MySQL 写失败会以裸错误穿透 | 增补 `STORAGE_FAILURE = 'ENGINE_STORAGE_FAILURE'` 一类码，并在端口 `@throws` 里写明；`UNSUPPORTED` 要么删要么注明「Phase2 启用」 | 半小时 |

### 2.3 文档一致性（15 条）

| # | 位置 | 问题 | 建议修法 | 工作量 |
|---|---|---|---|---|
| P2-19 ✅ | `docs/worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md` | **15 条链接失效**（指向已移动 / 未创建的文件） | 逐条核对重指向 | 1h |
| P2-20 ✅ | `docs/README.md` | **52 条链接失效** | 同上 | 2h |
| P2-21 ✅ | `docs/worklog/completed/**` | **40+ 条相对链接失效**（文件移进子目录后没跟着改） | 同上 | 2h |
| P2-22 ✅ | WP20 交付记录 | 写「全 mock」，**与代码相反**（实际已切 4 个真 API 页面） | 改写 | 10 分钟 |
| P2-23 ✅ | WP22 交付记录 | 写「409 / 自动关旧场」，**与实现相反**（实际是不自动关 + 独立错误码） | 改写 | 10 分钟 |
| P2-24 ✅ | WP11 交付记录 | 自相矛盾（§5 红线表首行仍写「不改 `src/engine-core/**`，diff 为空」，而实际改了 1 个文件） | 改写 | 10 分钟 |
| P2-25 ✅ | WP22 提交 `git show --stat` | 改了 **16 个前端文件**未在交付记录里登记 | 补登记 | 10 分钟 |
| P2-26 ✅ | WP24 交付记录 | 前提被 WP19-R 推翻（记录里写的「trace 已生效」在 WP19-R 之前不成立） | 补一句时序说明 | 10 分钟 |
| P2-27 ✅ | `docs/worklog/audits/code-vs-blueprint-audit-2026-10-30.md` | 缺「这是**快照**，不代表现状」的提示 —— 读的人会当成当前结论 | 加一句抬头提示 | 5 分钟 |
| P2-28 ✅ | `docs/worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md` §0.3 交付表 | **缺 WP12 / WP16 两行** | 补行 | 10 分钟 |
| P2-29 ✅ | 本单 §1.4 / `assess-safety.ts` / `http-psyguard.probe.ts` | 三处对「150 还是 500」的口径互相矛盾（详见 P2-9 / P2-10 / 本条） | 统一成「当前 500（测试期放宽），内测前回改 150」 | 20 分钟 |
| P2-30 ✅ | `docs/worklog/README.md` §4 已交付速查表 | 缺 WP25 条目 | 本单回写（已做） | — |
| P2-31 ✅ | `docs/worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md` 顶部状态行 | 状态行未反映 WP25 审查结论 | 本单回写（已做） | — |
| P2-32 ✅ | `docs/worklog/completed/phase1/phase1-backlog-archived-2026-11-03.md` §WP15 小节 | 未记录 P2-12（轨迹绕过 cap）这条**影响 WP15 不变量成立性**的发现 | 本单回写（已做） | — |
| P2-33 ✅ | `docs/architecture/v6.0-ai-engine.md:211-215` | 文档列的 `LLM_TIER_<TIER>_PROVIDER` / `RAG_TOP_K` / `RAG_SCORE_THRESHOLD` 等 env **代码里不读**（本单已把它们降级为 `.env.example` 注释区的预留键） | 文档同步标注「预留，未接线」 | 20 分钟 |

### 2.4 配置与已知尾巴（6 条）

| # | 位置 | 问题 | 建议修法 | 工作量 |
|---|---|---|---|---|
| P2-34 ✅ | `src/engine-adapters/wiring/engine-stream-backend.adapter.ts:989-999`、`src/voice/voice.service.ts:1649-1658` | **finishReason 透传缺失**（见 §1.1） | 3 处透传 | 半小时 |
| P2-35 ✅ | `admin-dashboard` 的 `/characters/:slug` 页面 | mock 数据**缺 pending 状态标注**（其余 7 个 mock 页面内测不走） | 补标注 | 10 分钟 |
| P2-36 ✅ | `src/voice/voice-handshake.ts:204/261-265` | `sessionId` 缺省为 `'default'` → 不带 `?sessionId=` 的客户端**共用同一个 key**（今天表现为"静默互相顶替"）。本单**没改**（改成显式拒绝不构成正确性回归） | 改「服务端生成唯一 id + ready 帧下发」，需前端配合 | 1 天 |
| P2-37 ⏳ | `src/voice/voice-handshake.ts` | 客户端是否**总带唯一** `?sessionId=` —— 本单**未核实**（Flutter 客户端不在本仓） | 内测前在真机确认；或服务端强制要求 | — |
| P2-38 ✅ | `src/voice/voice.gateway.ts` `handleDisconnect` | 旧 socket 断开时 `this.voice.detachSocket(sessionId)` + `this.sessions.remove(sessionId)` **没有 socketId 闸门** —— 重连竞态下，旧 socket 断开会把**新 socket 的**演练登记一起摘掉（帧出口有闸门，这两处没有） | 加上与帧出口同样的 socketId 比对 | 20 分钟 |
| P2-39 ✅ | `src/common/filters/biz-exception.filter.ts:62-71` | 生产 5xx **本地日志也不打** —— 线上出问题只能靠 Sentry，无本地兜底 | 生产也打 error 日志（脱敏后） | 10 分钟 |

---

## 3. P3 —— Phase2 再说（**已进 backlog Phase2 队列**）

| # | 位置 | 问题 |
|---|---|---|
| P3-1 | `src/ai-engine/providers/qdrant.service.ts:79` `:142` | `client: any` 过期债（SDK 早已装，类型是现成的） |
| P3-2 | `src/common/providers/util.service.ts:4` | `TemplateParameter = any[]` |
| P3-3 | `src/config/envs/default.ts:208` | `VOICE_SESSION_IDLE_TIMEOUT_MS` 是**死配置**（读得到，但无人消费 `voice.sessionIdleTimeoutMs`） |
| P3-4 | `src/voice/voice.service.ts` | `state.status = 'cancelled'` **只写不读** |
| P3-5 | 引擎 | 状态**衰减 / 边际递减 / 饱和**三个机制未实现 |
| P3-6 | 引擎 | **Prometheus 告警**未接（只有指标采集，没有告警规则） |
| P3-7 | `src/engine-core/cognition/state-transition.ts:397-406` | `transitionStateDetailed` **零生产调用方**，且内部重复计算两遍 aggregate + cap |
| P3-8 | `src/engine-adapters/persistence/qdrant-memory.store.ts:55` `:210` | 实现内部默认 `new InMemoryMemoryStore()` —— 「选实现」做在了实现里（装配层其实总是显式传 fallback） |
| P3-9 | `test/engine-core/boundary.spec.ts:339-386` | 断言⑦ 是**单向清单**（只查缺失，不查多余）—— 新增内核文件不会被拦 |
| P3-10 | `src/engine-core/cognition/state-transition.ts:257-265` `:287-294` | `readCap` **每轮读 18 次 `process.env`**（Node 里每次访问都要过特殊对象代理） |

---

## 4. P1 —— 内测前必修（**本单已全部修完**）

### P1-1 🔴 WS `sessionId` 无归属校验 → **跨用户接管 + 拉走他人逐字稿**

- **位置**：`src/voice/voice.gateway.ts`、`src/voice/voice.service.ts`
- **问题**：`sessionId` 由客户端在握手 query 里**自选**，服务端此前**从不核对**它属于谁。任何登录用户带着别人的 sessionId 连上来就能：
  1. **顶掉**那场会话（TTS dispose + LLM abort）—— 对方的对练当场崩；
  2. 走重连分支拿到 `session_catchup` 帧 —— 里面是**对方整场咨询对话原文**。
- **修法**（不改协议，服务端收敛）：
  - 新增 `VoiceService.isSessionOwnedByOtherUser(userId, sessionId)` 与 `assertSessionOwnership(...)`；
  - `startSession` **顶替前**判归属（原来这里是"同名就替换"）；
  - `reconnectSession` **补漏前**判归属 → 归属不符一律回 `session_stale/unknown_session`（**不暴露会话是否存在**，免得变成存在性探测）；
  - gateway 在 `verifyAndStart` 的**任何写动作之前**（落库 / 演练登记 / 帧出口接管之前）判归属，命中即发 `session_owned_by_other_user` error 帧 + 断开；
  - 归属判据查**两处注册表的并集**（voice 内存会话 + 演练登记）—— 少查一处就留一个洞（会话已结束、登记还在的窗口）；
  - 新增错误码 `session_owned_by_other_user`（不合并进 `session_already_active` —— 那条说的是"你自己已经有一场"）。
- **回归测试**：`test/voice/wp25-ws-session-ownership.spec.ts`（**10 例**，A 侧内核 5 例 + B 侧接线 5 例）。
- **附带修**：`void this.verifyAndStart(...)` 补 `.catch()` —— Node ≥15 对未处理的 promise rejection **直接终止进程**，一条客户端连接的失败不该打挂整个服务。

### P1-2 🔴 `/admin/api/*` 生产 basic auth **fail-open** → 匿名可拉全场逐字稿

- **位置**：`src/admin-debug/admin-basic-auth.middleware.ts:133`
- **问题**：原来「prod 同样放行，只打一条 warn」—— 但 **warn 不拦请求**。匿名可达时 controller 的 `ownerFilter` 因 `req.user` 为空**不过滤** → `GET /admin/api/sessions` 返回**全部学员**的会话列表，`GET /admin/api/sessions/:id` 返回**任意一场**的完整咨询逐字稿。
- **修法**：生产**匿名一律 401**（fail-close）；dev 保留放行（本地调试器免登录，老口径不变）。
- **回归测试**：`test/base/wp25-security-hardening.spec.ts` ③ 组（6 例）。

### P1-3 🔴 生产 CSP 指令值写错 → **整条 CSP 被浏览器忽略**

- **位置**：`src/app.middleware.ts`（原 `defaultSrc: [`'["self"'`]` 等 10 处）
- **问题**：方括号是**写错了**的 CSP source list 语法。按 CSP 规范，source list 非法的**整条指令会被浏览器忽略** —— 于是「生产开了 CSP」这件事**在代码里成立，在浏览器里不成立**（default-src / script-src / style-src / connect-src 全废）。而且它**不报错、不告警**。
- **修法**：改成合法的 `'self'` / `'unsafe-inline'` / `'none'`；并把指令提成**导出的常量** `PRODUCTION_CSP_DIRECTIVES`，让单测能直接断言它的语法合法性。
- **回归测试**：`test/base/wp25-security-hardening.spec.ts` ① 组（3 例）。

### P1-4 🔴 express-session 用**公开常量** `'tEsTeD'` 当签名密钥

- **位置**：`src/app.middleware.ts`（原 `secret: process.env.SESSION_SECRET ?? 'tEsTeD'`）
- **问题**：任何拿到源码的人都能用它**伪造 session cookie**。而本文件自己的注释早就写着「Session secret 生产必须改强随机 (V3 加 startup 校验)」—— 那个校验**一直没加**。
- **修法**：生产缺 env 时用 `randomBytes(32)` 生成**本次进程的随机密钥** + 打 **error 级**日志；**不 fail-fast**（一次漏配 env 的发版能把线上服务整个打挂，而这套 session 只服务已弃用的 `/auth/*` passport demo，鉴权全走 JWT）。
- **回归测试**：`test/base/wp25-security-hardening.spec.ts` ② 组（5 例）。

### P1-5 🔴 头像上传失败把底层报错原文返前端

- **位置**：`src/profile/providers/profile.service.ts:161-164`、`:187-189`
- **问题**：fs 报错原文带**服务器绝对路径**（`ENOENT: ... open 'D:\...\uploads\avatar\x.jpg'`）；MySQL driver 报错原文带**表名/列名/冲突值**（`ER_DUP_ENTRY: Duplicate entry '...' for key 'users.xxx_unique'`）。两者都直接进 `BizException.message` → 回前端。
- **修法**：前端拿**固定文案**；原文只进日志。
- **回归测试**：`test/base/wp25-security-hardening.spec.ts` ④ 组（2 例）。

### P1-6 🔴 引擎 capObserver 回调抛错 → **炸穿整轮 turn**

- **位置**：`src/engine-core/cognition/state-transition.ts:363`
- **问题**：`transitionState` 同步调用外部注册的全局回调，**没有任何 try/catch**。回调抛异常 → 穿透 `transitionState` → 穿透 `in-memory-engine-session.ts:246` → **整轮 turn 失败**，而此时状态**还没落库**（`bdiStates.save` 在 :260）。这与内核对其他一切外部注入能力的处理相反：`assessSafety` 的 probe 明确「永不抛穿 / 超时抛错一律回落规则」、`collectOpeningContext` 吞异常回落空数组。observer 是内核**唯一**未设防的外部回调。
- **修法**：`try { capObserver(report) } catch { /* 观测通道失败不影响状态迁移 */ }`。
- **回归测试**：`test/engine-core/wp15-delta-cap.spec.ts` 加 2 例。

### P1-7 🔴 `.env.example` 缺 130 个 env 键 → 部署时配不上

- **位置**：`.env.example`
- **问题**：代码侧读取点约 **200 个** env 键，模板只有 70 个生效行。缺的关键组：`DB_*`（全组）、`ADMIN_BASIC_AUTH_USER/PASS`、`ENGINE_VOICE_ENABLED`、`VOICE_DAILY_TOKEN_BUDGET`、`VOICE_MAX_CONCURRENT_PER_USER`、`SUPERVISION_*`、`SENTRY_*`、`RSA_*_PEM`、`CORS_ORIGINS`、`SESSION_SECRET`、`UPLOAD_*`、`QDRANT_KB_COLLECTION`、WP15 的 18 个 `ENGINE_CAP_*` 等。运维照抄模板**根本不知道这些键存在**。
- **附带发现**：模板里另有 **47 个生效行代码里查无读取点**（`LLM_OPENAI_ENABLED` / `LLM_TIER_*` / `RAG_TOP_K` / `CRISIS_*` / `AI_UNLOCK_*` / `EFFECT_AGGREGATE_*` / `EMERGENCY_RETENTION_DAYS` 等）—— 配了不生效且**不报错**。
- **修法**：
  - 补全 **130 个**代码真读的键（密钥类留空，数值类给代码默认值）；
  - 把 **47 个**死键**降级为注释区**（保留意图，但不再冒充契约）；
  - `NODE_ENV` 保持**注释**（本地照抄模板不能开 production 模式）；
  - 新增**双向机器断言** `test/config/wp25-env-example-coverage.spec.ts`（4 例）：代码读的键 ↔ 模板生效行，一一对应；派生族（`LLM_<PROVIDER>_API_KEY` 5 个 + `ENGINE_CAP_<DIM>_<DIRECTION>` 18 个）显式登记并校验登记口径与源码推导口径一致。
- **验收对应**：任务单 §5 验收 #3 ✅

### P1-8 🔴 WP25 任务单 §1.4 回改方向**写反** → 照着执行会把生产值改错

- **位置**：`docs/worklog/completed/phase1/wp14-wp24-augment/engine-wp25-phase1-audit-backend-2026-11-03.md` §1.4
- **问题**：见 §1.4（已详述）。
- **修法**：重写为正确方向 + 11 处 checklist（本仓 8 + 兄弟仓 3），并补上「输出侧走独立 env 读取」这个旧记录漏掉的回改点。

---

## 5. 已确认**无问题**的项（附依据）

> 这一节同样重要：它把"扫过了"和"确认干净"区分开，避免下一个人重复扫。

### 5.1 机械扫描

| 项 | 结论 |
|---|---|
| `TODO` / `FIXME` / `HACK` / `XXX` | 全仓仅 **2 处**：`src/engine-adapters/wiring/trajectory/ethical-scripts.ts:60`（待专业复核，**不是** TODO 债）、`visitor-full-persona.entity.ts:98`（文案里的 XXX） |
| `console.log` / `debugger` | 仅 **2 处**：`turn-render-orchestrator.ts:930`（有 `NODE_ENV!=='production'` 守卫）、`:953`（刻意的手写 warn） |
| 硬编码密钥 / 内网 IP / 端口 | **零命中**（`117.72.30.78` 只出现在文档里，不在代码里） |
| `any` 类型 | 共 26 处 / 16 文件。**engine-core 与 engine-adapters 内核侧零真 `any`**（只有解释「为什么不用 any」的注释）。真 `any` 仅 **3 处**：`qdrant.service.ts:79/142`、`common/providers/util.service.ts:4`、`life-map/providers/drift-bottle.repository.ts:122`（→ P3-1 / P3-2） |
| `throw new Error(` | 约 70 处，集中在业务层；**引擎内核零裸抛**（见 5.2） |

### 5.2 引擎内核专项（`src/engine-core/**` 41 个 `.ts`）

| 项 | 结论 |
|---|---|
| 断言① 零 `@nestjs/*` | ✅ 18 处命中**全在注释里**，AST 级 import 说明符 = 相对路径 + `nanoid`/`node:crypto`/`node:timers` |
| 断言② 零 typeorm | ✅ 21 处命中全是「零 typeorm」这类**边界声明注释本身** |
| 断言③ 零逃出目录 import | ✅ 26 条相对 import 全指向内核内目录 |
| 断言④ 外部依赖白名单 | ✅ 非相对 import 全集 = `{nanoid}` + `node:*`，恰好在白名单内；`require(` 零命中 |
| 断言⑤ 零 NestJS 装饰器 | ✅ 2 处命中是注释里「刻意不带装饰器」 |
| 断言⑥ barrel 双向白名单 | ✅ 机器复算 `index.ts` 实际导出 **108** == 白名单 **108**，漏导出 0 / 多导出 0 |
| 断言⑦ 目录结构 | ✅ 实际 **42** == 清单 **42**（机制弱点见 P3-9） |
| 断言⑧ 根目录无散落文件 | ✅ |
| 断言⑨ B 层实现在包外 | ✅ |
| 内核零裸 `throw new Error(` | ✅ 零命中；`new Error(` 仅 2 处且**不逃逸**（`assess-safety.ts:177/186` 是超时信号，被 `assessSafety` 的 try/catch 捕获回落规则）—— 归类成 `EngineCoreError` 反而**误导**（它代表"降级"不是"失败"） |
| 内核抛错全部有码 | ✅ 24 处 `throw new EngineCoreError(...)` 全部带 `EngineErrorCode` |
| 端口未被绕过 | ✅ 7 个实现类全部显式 `implements`；内核对外部能力一律依赖端口（`bdiStates` / `memories` / `classifier` / `riskProbe`） |
| 装配层做选择而非实现层 | ✅（除 P3-8 一处） |
| 召回判定两版同源 | ✅ 内存版与 Qdrant 版都调同一 `evaluateRecallCandidate` |
| env 测试清理 | ✅ `wp15-delta-cap.spec.ts` 在 `afterEach` 删 env 键 + 注销 observer，无跨用例污染 |

### 5.3 安全面

| 项 | 结论 |
|---|---|
| 生产不返 stack | ✅ `biz-exception.filter.ts` 生产不返堆栈 |
| `/admin/api/*` 无漏网端点 | ✅ 全部端点都挂了 `AdminBasicAuthMiddleware` |
| 落库侧归属校验齐全 | ✅ 会话列表 / 详情按 `req.user` 过滤 |
| helmet 已启用 | ✅ 生产开 CSP / HSTS / COEP |
| 生产 CORS 非 `*` | ✅ 生产缺省 `''`（只允许同源） |
| WS JWT 密钥来源 | ✅ 走 `config.getOrThrow('jwtSecret')`，不是硬编码 |

### 5.4 文档一致性面

| 项 | 结论 |
|---|---|
| WP19-R 的 basic auth 覆盖 | ✅ `/admin/api/*` 全部端点都挂了中间件，无漏网 |
| WP11 临时值在代码里有对应注释 | ✅ `assess-safety.ts:48-74` 有大段说明（**注释方向是对的**，是任务单写反了） |
| WP23 边界 A/B 在代码里有对应注释 | ✅ `voice.gateway.ts` / `voice.service.ts` 都有 |

---

## 6. 未核实 / 不在本仓的项（如实标注）

| 项 | 为什么没核实 | 内测前要做什么 |
|---|---|---|
| 生产机（117.72.30.78）实际 `.env` 取值 | 不在本仓 | 上机逐项核对本报告涉及的键（尤其 `ADMIN_BASIC_AUTH_*` / `SESSION_SECRET` / `CORS_ORIGINS`） |
| `mofang-psyguard` 容器**实际** `PSYG_MAX_LENGTH` | 兄弟仓 + 生产机容器 | 内测前实地确认，别只改仓库默认值 |
| Flutter 客户端是否**总带唯一** `?sessionId=` | 客户端不在本仓 | 真机验证；或服务端强制要求（见 P2-36 / P2-37） |
| `admin-dashboard` 构建产物与 mock 页面的实际使用率 | 需要跑起来看 | 内测前确认内测链路是否进后台 |
| `mofang-psyguard` 的 ONNX 模型横评结论（`scripts/exp_window_caps.py`） | 兄弟仓 | 复核 150ms 预算在真机上仍成立 |

---

## 7. 本单的闸门

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 错 |
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | ✅ 0 错 |
| `npx vitest run`（全量，排除 e2e） | ✅ 见交付记录 |

---

## 8. 复现方式

```bash
cd E:\Work\Project\backend\mofang-nestjs

# 本单新增的三组回归
npx vitest run test/voice/wp25-ws-session-ownership.spec.ts   # WS 会话归属 (10 例)
npx vitest run test/base/wp25-security-hardening.spec.ts        # CSP / session 密钥 / basic auth / 头像文案 (16 例)
npx vitest run test/config/wp25-env-example-coverage.spec.ts    # .env.example 一一对应 (4 例)

# 全量闸门
npx tsc -p tsconfig.build.json --noEmit
npx eslint "src/**/*.ts" "test/**/*.ts"
npx vitest run --exclude '**/e2e/**/*.ts'
```
