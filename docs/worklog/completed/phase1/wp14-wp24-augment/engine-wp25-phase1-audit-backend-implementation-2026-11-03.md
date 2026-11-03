# WP25 · Phase1 封版审查：全量扫描 + P1 修复（后端交付记录）

> 日期: 2026-11-03 ｜ 任务单: `engine-wp25-phase1-audit-backend-2026-11-03.md`
> 归属: Phase1 封版 / M3 内测前审查
> 状态: **代码已交付并复跑绿（未 commit）**
> **扫描报告**: [`docs/worklog/audits/wp25-phase1-audit-report-2026-11-03.md`](../../wp25-phase1-audit-report-2026-11-03.md)
> 引擎内核: 只改 `src/engine-core/cognition/state-transition.ts` **1 个文件**（+13/−1）—— 维持 WP15 以来"内核破例只动一个文件"的口径

---

## 1. 一句话

M3 内测前做一次**全量审查**：5 条已知尾巴逐条核实 + 7 类全量扫描（文档 vs 代码 / TODO·console.log·any·硬编码密钥 / `/admin/api` 鉴权 / WS sessionId 归属 / 错误信息泄漏 / `.env.example` ↔ `process.env` 一一对应 / engine-core 白名单复核），产出 **8 个 P1（本单全修）+ 39 条 P2（待用户拍板）+ 10 条 P3（进 Phase2 队列）**，并新增 **3 个机器断言套件（32 例）**把本单的关键结论钉成"违反即测试变红"。

**本单不是新功能** —— 一行新业务逻辑都没写，改的全是"已经错了 / 漏了 / 骗人了"的地方。

---

## 2. 改动面（7 个源文件 + 5 个测试文件 + 4 个文档）

| # | 文件 | 改了什么 | 对应 |
|---|---|---|---|
| 1 | `src/voice/voice.service.ts` | 新增 `isSessionOwnedByOtherUser` / `assertSessionOwnership`；`startSession` **顶替前**判归属；`reconnectSession` **补漏前**判归属（不符 → `session_stale/unknown_session`，不暴露会话存在性） | P1-1 |
| 2 | `src/voice/voice.gateway.ts` | 归属校验接到 `verifyAndStart` 的**任何写动作之前**（落库 / 演练登记 / 帧出口接管之前）；帧出口登记从 `handleConnection` **挪到鉴权之后**；`handleDisconnect` 的 `detachSocket` / `sessions.remove` 加 `data.userId` 闸门；`void verifyAndStart()` 补 `.catch()` | P1-1 |
| 3 | `src/voice/voice-session-limit.error.ts` | 新增错误码 `session_owned_by_other_user` | P1-1 |
| 4 | `src/admin-debug/admin-basic-auth.middleware.ts` | 生产**匿名一律 401**（fail-close）；dev 保留放行；同步改文件头注释（原写"prod 同样放行只打 warn"） | P1-2 |
| 5 | `src/app.middleware.ts` | CSP 指令值 `'["self"'` → `'self'`（原写法让**整条 CSP 被浏览器忽略**）并提成导出的常量 `PRODUCTION_CSP_DIRECTIVES`；`SESSION_SECRET` 兜底从公开常量 `'tEsTeD'` 改为「生产随机密钥 + error 日志」 | P1-3 / P1-4 |
| 6 | `src/profile/providers/profile.service.ts` | 头像上传两处 `BizException` 不再把 `err.message` 返前端（fs 绝对路径 / MySQL 表名列名），改固定文案，原文只进日志 | P1-5 |
| 7 | `src/engine-core/cognition/state-transition.ts` | `capObserver` 回调包 `try/catch` —— 抛错不再**炸穿整轮 turn** | P1-6 |
| 8 | `.env.example` | 补 **130** 个代码真读的键；**47** 个代码不读的键降级为注释区（预留键）；`NODE_ENV` 保持注释 | P1-7 |
| 9 | `docs/worklog/completed/.../engine-wp25-phase1-audit-backend-2026-11-03.md` | §1.4 回改方向**写反**已修正 + 补 11 处 checklist | P1-8 |
| 10 | `test/voice/wp25-ws-session-ownership.spec.ts`（**新**） | **10 例**：A 侧内核（顶替前拒 / 补漏前拒 / 自己重开不误伤 / 真值表）+ B 侧接线（拒在写动作前 / 演练登记也查 / 自己的正常开场 / JWT 无效不登记出口 / 未鉴权断开不碰别人会话） | P1-1 |
| 11 | `test/base/wp25-security-hardening.spec.ts`（**新**） | **16 例**：CSP 指令语法合法性（3）+ SESSION_SECRET 不落回公开常量（5）+ `/admin/api` 生产 fail-close（6）+ 头像失败文案脱敏（2） | P1-2~5 |
| 12 | `test/config/wp25-env-example-coverage.spec.ts`（**新**） | **4 例**：`.env.example` ↔ 代码 env 读取点**双向**一一对应 + 派生族登记口径校验 + `NODE_ENV` 必须注释 | P1-7 |
| 13 | `test/voice/wp23-gateway-reconnect.spec.ts` | 补桩：`FakeVoiceService` 加 `isSessionOwnedByOtherUser`（WP23 测的是断连/重连语义，归属由 WP25 专项用例覆盖） | 回归修复 |
| 14 | `test/engine-core/wp15-delta-cap.spec.ts` | 加 2 例：observer 抛错 → 状态迁移照常完成 / 后续轮次不受污染 | P1-6 |

**没动**：`src/engine-core/**` 其余全部文件（含 `index.ts` barrel）、`src/llm/**`、`src/counselor/**`、`src/knowledge-base/**`、`src/agent/**`、Flutter 端、`admin-dashboard/` 源码（mock 盘点只出清单不改代码）。

---

## 3. P1 逐条：问题 → 修法 → 为什么这么修

### 3.1 P1-1 WS `sessionId` 无归属校验（跨用户接管 + 拉走他人逐字稿）

**问题**：`sessionId` 由客户端在握手 query 里**自选**，服务端此前**从不核对**它属于谁。任何登录用户带着别人的 sessionId 连上来就能：

1. **顶掉**那场会话（TTS dispose + LLM abort）—— 对方的对练当场崩；
2. 走重连分支拿到 `session_catchup` 帧 —— 里面是**对方整场咨询对话原文**。

**修法**（不改协议，服务端收敛）：

```
客户端自选 sessionId（不改协议）
        ↓
gateway verifyAndStart
  ① verifyJwt                    ← 验签
  1.5 归属校验（新）               ← 查 voice 内存会话 + 演练登记 两处并集
  1.6 登记会话级帧出口（新位置）    ← 从 handleConnection 挪到鉴权之后
  ②~⑧ 落库 / 演练登记 / 开场 …    ← 任何写动作都在 1.5 之后
```

- `VoiceService.isSessionOwnedByOtherUser(userId, sessionId)` —— 只在**内存里已存在**这场会话时才判；不存在 = 新会话，谁开都合法。
- `VoiceService.assertSessionOwnership(...)` —— 抛 `VoiceSessionLimitError('session_owned_by_other_user', retryable=false)`。
- `reconnectSession` 归属不符 → 回 `session_stale/unknown_session`：**不给补漏**，且**不暴露会话是否存在**（免得变成存在性探测）。

**三个关键取舍**：

| 取舍 | 选择 | 为什么 |
|---|---|---|
| 归属不符时给什么反馈 | `session_stale/unknown_session` | 说"存在但不是你的"等于给攻击者一个**存在性探测器** |
| 判据查几处 | **两处并集**（voice 内存会话 + 演练登记） | 少查一处就留一个洞：会话已结束、演练登记还在的窗口里，只查 voice 内存会漏判 |
| 新增错误码 vs 复用 | 新增 `session_owned_by_other_user` | WP22 当初写"新增码要前端联调所以不加"，但这条是**安全拒绝**（前端只显示 message、`retryable=false`）；合并进 `session_already_active` 反而误导 —— 那条说的是"你自己已经有一场" |

**附带修**：`void this.verifyAndStart(...)` 补 `.catch()` —— Node ≥15 对未处理的 promise rejection **直接终止进程**。一条客户端连接的失败（DB 抖动 / 第三方抽风）不该把整个服务打挂。

### 3.2 P1-2 `/admin/api/*` 生产 basic auth fail-open

原来「prod 同样放行，只打一条 warn」—— 但 **warn 不拦请求**。匿名可达时 controller 的 `ownerFilter` 因 `req.user` 为空**不过滤** → `GET /admin/api/sessions` 返回**全部学员**的会话列表，`GET /admin/api/sessions/:id` 返回**任意一场**的完整咨询逐字稿。

**修法**：生产匿名**一律 401**（fail-close）；dev 保留放行（本地调试器免登录，老口径不变）。日志提醒改不动的门，必须由代码关上。

### 3.3 P1-3 生产 CSP 指令值写错（整条 CSP 被浏览器忽略）

原写法 `defaultSrc: [`'["self"'`]` —— 方括号是**写错了**的 CSP source list 语法。按 CSP 规范，source list 非法的**整条指令会被浏览器忽略**。于是「生产开了 CSP」这件事**在代码里成立、在浏览器里不成立**（default-src / script-src / style-src / connect-src 全废），而且**不报错、不告警**。

**修法**：改成合法的 `'self'` / `'unsafe-inline'` / `'none'`，并把指令提成**导出的常量** `PRODUCTION_CSP_DIRECTIVES` —— 提成常量是为了让单测能直接断言它的**语法合法性**（否则这种错在代码里躺着就没人发现）。

### 3.4 P1-4 express-session 用公开常量 `'tEsTeD'` 当签名密钥

任何拿到源码的人都能用它**伪造 session cookie**。而 `app.middleware.ts` 自己的注释早就写着「Session secret 生产必须改强随机 (V3 加 startup 校验)」—— 那个校验**一直没加**。

**修法**：生产缺 env 时用 `randomBytes(32)` 生成**本次进程的随机密钥** + 打 **error 级**日志。

**为什么不 fail-fast（拒绝启动）**：直接拒绝启动 = 一次漏配 env 的发版能把线上服务整个打挂；而这套 session 只服务早已弃用的 `/auth/*` passport demo（鉴权全走 JWT），它挂了不影响对练主链路。随机密钥的代价 = 重启后旧 session 失效（本来就没人用）；收益 = 线上不会因配置缺失而起不来，且**永远不落回公开常量**。

### 3.5 P1-5 头像上传失败把底层报错原文返前端

fs 报错原文带**服务器绝对路径**（`ENOENT: ... open 'D:\...\uploads\avatar\x.jpg'`）；MySQL driver 报错原文带**表名/列名/冲突值**（`ER_DUP_ENTRY: Duplicate entry '...' for key 'users.xxx_unique'`）。两者都直接进 `BizException.message` → 回前端。

**修法**：前端拿**固定文案**，原文只进日志。

### 3.6 P1-6 引擎 `capObserver` 抛错炸穿整轮 turn

`transitionState` 同步调用外部注册的全局回调，**没有任何 try/catch**。回调抛异常 → 穿透 `transitionState` → 穿透 `in-memory-engine-session.ts:246` → **整轮 turn 失败**，而此时状态**还没落库**（`bdiStates.save` 在 :260）。

这与内核对其他一切外部注入能力的处理**相反**：`assessSafety` 的 probe 明确「永不抛穿 / 超时抛错一律回落规则」、`collectOpeningContext` 吞异常回落空数组。observer 是内核**唯一**未设防的外部回调。

**修法**：`try { capObserver(report) } catch { /* 观测通道失败不影响状态迁移 */ }`。

### 3.7 P1-7 `.env.example` 缺 130 个 env 键

代码侧读取点约 **200 个** env 键，模板只有 70 个生效行。缺的关键组：`DB_*`（全组）、`ADMIN_BASIC_AUTH_USER/PASS`、`ENGINE_VOICE_ENABLED`、`VOICE_DAILY_TOKEN_BUDGET`、`VOICE_MAX_CONCURRENT_PER_USER`、`SUPERVISION_*`、`SENTRY_*`、`RSA_*_PEM`、`CORS_ORIGINS`、`SESSION_SECRET`、`UPLOAD_*`、`QDRANT_KB_COLLECTION`、WP15 的 18 个 `ENGINE_CAP_*` 等。

**附带发现**：模板里另有 **47 个生效行代码里查无读取点**（`LLM_OPENAI_ENABLED` / `LLM_TIER_*` / `RAG_TOP_K` / `CRISIS_*` / `AI_UNLOCK_*` / `EFFECT_AGGREGATE_*` / `EMERGENCY_RETENTION_DAYS` 等）—— 配了不生效且**不报错**（最费时间的排障陷阱）。

**修法**：

1. 补全 **130** 个代码真读的键（密钥类留空，数值类给代码默认值）；
2. **47** 个死键**降级为注释区**（保留意图，但不再冒充契约）；
3. `NODE_ENV` 保持**注释**（本地照抄模板不能开 production 模式）；
4. 新增**双向机器断言**（验收 #3）：

```
代码读取点 (AST)  ──必须覆盖──▶  .env.example 生效行
   ① process.env.FOO            (点访问)
   ② process.env['FOO']         (静态 bracket)
   ③ config.get('FOO')          (含常量间接: config.get(COUNSELOR_LLM_MODEL_ENV_KEY))
   ④ 派生族: LLM_<PROVIDER>_API_KEY ×5 / ENGINE_CAP_<DIM>_<UP|DOWN> ×18

.env.example 生效行  ──必须被读到──▶  代码读取点
```

**为什么用 AST 而不是正则**：本仓注释密度极高，正则会命中注释里的示例；多行写法会漏；bracket / dot / 计算键三种形态要各写一条规则。AST 是**精确**的 —— 注释根本不存在于 AST 里。

### 3.8 P1-8 任务单 §1.4 回改方向写反

原文：「测试期超时 150ms、token 28 是放宽值，内测前要回改生产值（500ms / 256 token）」。

**事实相反**：正式口径是 **150ms / 28 token**（真机 BERT-large int8 延迟预算反推出来的值，见 WP11 交付记录 `:201`）；测试期为了"只有一个人用、准确率优先于延迟"把它**放宽**成了 **500ms / 256 token**。照原文执行会把生产值改错方向（把 150 改成 500 = 把临时值固化成正式值）。

**修法**：任务单 §1.4 重写为正确方向，并附 **11 处 checklist**（本仓 8 + 兄弟仓 `mofang-psyguard` 3）。其中**本单新发现**的关键点：装配层 `engine.module.ts:131/188/226` **显式**传了 `resolvePsyGuardTimeoutMs(config.get('PSYGUARD_TIMEOUT_MS'))` —— 输出侧走**独立 env 读取**，**不会**跟着内核常量走。旧交付记录写的"全仓只有一个回改点"**不成立**。

---

## 4. 已知尾巴 5 条 —— 归档结论（验收 #4）

| 尾巴 | 结论 | 去向 |
|---|---|---|
| ① 流式 `done` chunk 缺 `finishReason` | 🔶 **真缺口**（上游拿得到，`engine-stream-backend.adapter.ts:989-999` 与 `voice.service.ts:1649-1658` 两处丢掉） | **P2-#1** 待拍板（3 处透传，半小时） |
| ② WP12 半衰期配置单向生效 | ✅ **是设计** —— 内核 `recall-policy.ts:93-95` 有"阈值只能收紧不能放松"的地板（内核红线的推论）；只影响召回准入，不影响衰减计算 | **划掉** |
| ③ admin SPA mock 页面盘点 | 🔶 9 个页面 = 4 真 API + 1 半真 + 4 全 mock；**内测主链路不走 admin-dashboard** | 唯一 actionable = 缺 pending 标注那页 → **P2-#2** |
| ④ WP11 临时值回改 checklist | 🔴 任务单方向写反 + 旧记录漏了 env 路径 | ✅ **已修**（§1.4 重写 + 11 处 checklist）；值本身内测前再改 |
| ⑤ abort → `cancelled` 帧 | ✅ **不是 bug**（barge-in 是正常交互不是错误） | **划掉**（"只写不读"另记 **P3-#4**） |

---

## 5. P2（39 条）与 P3（10 条）

- **P2 清单**：安全 10 条 / 引擎 8 条 / 文档一致性 15 条 / 配置与已知尾巴 6 条 —— 逐条含位置、问题、建议修法、预估工作量，见扫描报告 §2。**本单只列不改，等用户拍板**（任务书 §3.2 明确要求）。
- **P3**：已全部写进 backlog 母版 §Phase2+ 保留推进队列（10 行，编号 `WP25-P3-1` ~ `WP25-P3-10`）。

**建议优先拍板的 3 条**：

| # | 为什么优先 |
|---|---|
| **P2-12** 轨迹 delta 绕过单回合 cap | 它决定 WP15 的不变量到底成不成立 —— **当前"cap = 单回合总幅度上限"的自述是假的**。二选一：① 让 cap 覆盖轨迹叠加（半天）；② 明确写下"cap 只管事件 delta"（半小时） |
| **P2-11** cap 报告不带 sessionId | M3 内测是**多人**场景，运维看到 `[WP15] turn delta capped: ...` **无法定位是哪场会话被砍** |
| **P2-38** 旧 socket 断开会摘掉新 socket 的演练登记 | 帧出口有 socketId 闸门，`detachSocket` / `sessions.remove` **没有** —— 重连竞态下旧 socket 断开会影响新会话 |

---

## 6. 闸门（复跑绿）

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 错** |
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | ✅ **0 错 0 warning** |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **77 文件 / 1165 例全绿**（WP15 后基线 74 文件 / 1133 例 → 本单净增 **3 文件 / 32 例**） |
| `git diff --stat HEAD -- src/engine-core` | ✅ **只 1 个文件**（`state-transition.ts`，+13/−1） |

新增用例分布：`test/voice/wp25-ws-session-ownership.spec.ts` 10 例 + `test/base/wp25-security-hardening.spec.ts` 16 例 + `test/config/wp25-env-example-coverage.spec.ts` 4 例 + `test/engine-core/wp15-delta-cap.spec.ts` 加 2 例 = **32 例**。

---

## 7. 与任务单的偏差（3 条，都有理由）

### 7.1 修了任务单 §1.4 本身（回改方向写反）

任务书把「WP11 临时值回改」写成"开发期间不动，内测前执行"，但**方向写反了**。本单核实后**修正了任务单**，并给出 11 处 checklist。理由：任务单是本单的**输入**，输入错了就该改输入 —— 否则照单执行会把生产值改错方向，比不改更糟。**值本身本单没动**（仍按任务书"现在不改"），只改清单与方向。

### 7.2 引擎内核改了 1 个文件（任务单未限定，但守住了 WP15 以来的口径）

任务单的"不做"清单里没有禁改内核，但 WP15 以来"内核破例只动一个文件"是既定口径。本单只改了 `state-transition.ts`（加 try/catch，+13/−1），**没碰** `index.ts` barrel —— 所以 WP15 那些走深路径 import 的符号（P2-16）仍然走深路径，本单只**列**不动。

### 7.3 `.env.example` 里 47 个死键**降级为注释**而不是删掉

删掉最干净，但会让 `docs/architecture/v6.0-ai-engine.md:211-215` 这类文档引用的键**消失**（那本来就是文档漂移，见 P2-33）。降级为注释区 = 保留意图 + 不再冒充契约 + 机器断言仍能守住"生效行 ↔ 代码读取点"。要真正启用其中任何一个，需**先在代码里接上读取点**，再挪回生效区。

---

## 8. 未核实 / 不在本仓的项（如实标注）

| 项 | 为什么没核实 | 内测前要做什么 |
|---|---|---|
| 生产机（117.72.30.78）实际 `.env` 取值 | 不在本仓 | 上机逐项核对本单涉及的键（尤其 `ADMIN_BASIC_AUTH_*` / `SESSION_SECRET` / `CORS_ORIGINS`） |
| `mofang-psyguard` 容器**实际** `PSYG_MAX_LENGTH` | 兄弟仓 + 生产机容器 | 内测前实地确认，别只改仓库默认值 |
| Flutter 客户端是否**总带唯一** `?sessionId=` | 客户端不在本仓 | 真机验证（P2-36 / P2-37） |
| `admin-dashboard` 构建产物与 mock 页面的实际使用率 | 需要跑起来看 | 内测前确认内测链路是否进后台 |
| `mofang-psyguard` 的 ONNX 横评结论 | 兄弟仓 | 复核 150ms 预算在真机上仍成立 |

---

## 9. 交付记录回写位置（验收 #5）

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/audits/wp25-phase1-audit-report-2026-11-03.md`（**新**） | 扫描报告（P1/P2/P3 分级 + 已确认无问题项 + 未核实项） |
| `docs/worklog/completed/.../engine-wp25-phase1-audit-backend-2026-11-03.md` | 任务单 §1.4 修正 + 状态行（本文件） |
| `docs/worklog/completed/phase1-backlog-archived-2026-11-03.md` | ① 顶部状态行 ② §0.3 交付表加 WP25 行 ③ §0.4 优先级表把 WP25 划掉 + WP11 回改口径澄清 ④ **新增「已知尾巴归档」表**（验收 #4）⑤ §WP15 小节补 WP25 审查发现（轨迹绕过 cap 等）⑥ §Phase2+ 队列加 10 行 P3 |
| `docs/worklog/README.md` | §4 已交付速查表加 WP25 条目 |

---

## 10. 复现方式

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
