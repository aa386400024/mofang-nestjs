# 后端 AI 开工自检（先读这个文件，再开工）

> 你是 `mofang-nestjs`（NestJS）仓库的后端 AI。
> 这个文件是你的入口：**先读完，再决定做什么活、遵守什么红线、交付什么格式。**

---

## 0. 你在哪（项目一句话）

心塑 App 的后端引擎：咨询师用 Flutter 客户端跟 AI 心理咨询来访做语音对练。
- 内核纯层在 `src/engine-core/`（BDI 决策、记忆、轨迹、伦理、渲染契约）—— **纯函数、零网络、零 prompt、零 @nestjs/**
- 适配/装配层在 `src/engine-adapters/`（把纯层接成真实可用的对练：LLM 调用、WS 流式、DB 角色池、PsyGUARD 探测）
- 业务层在 `src/voice/` `src/counselor/` 等（WS 会话、语音网关、报告）

---

## 1. 当前有什么活（自己扫目录）

**第一步：`ls pending/` 看里面有几个 .md 文件。**

- 有文件 = 每个文件就是一个完整任务，从文件名排第一的开始做
- 没有文件 = 没有新活，不要自己找事做，等用户派新任务单

每个任务单文件里写了完整的：目标、改动点、验收标准、不做什么。**读全文再开工。**

---

## 2. 绝对红线（违反一次 = 会话终止）

### 2.1 engine-core 纯层一行不动

```bash
git diff --stat HEAD -- src/engine-core
```
交付时这个命令输出必须为空。

- ❌ 不改 `src/engine-core/**` 下任何文件
- ❌ 不在 engine-core 里加 @nestjs/、网络调用、prompt、模型名
- ✅ 所有新逻辑放 `src/engine-adapters/` 或业务层

### 2.2 不写前端代码

- ❌ 不碰 `admin-dashboard/`（Vue3 SPA，前端另一个 AI 管）
- ❌ 不碰 Flutter 客户端代码

### 2.3 不跑前端命令

- ❌ 不跑 flutter / dart / pub 命令
- ✅ 只跑后端的：`npx eslint` `npx tsc` `npx jest`

---

## 3. 交付格式（每个任务做完必须做的事）

### 3.1 写交付记录

在同目录写一个 `*-implementation-YYYY-MM-DD.md`，内容包括：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（跟任务单有出入的地方，说明为什么）
3. 闸门数字：
   - `npx eslint "src/**/*.ts"` → 0 error
   - `npx tsc -p tsconfig.build.json --noEmit` → 0 error
   - `npx jest` → 全绿
   - `git diff --stat HEAD -- src/engine-core` → 空

### 3.2 移文件 + 改任务单顶部状态行

交付后：
- 任务单 + 交付记录，从 `pending/` 移到 `completed/` 对应子目录
- 如果是新类别，在 `completed/` 下建子目录
- **移动前顺手把任务单第 4 行的 `> 状态: 📋 待开工` 改成 ✅**，指向同目录的交付记录文件名。格式参考 WP22：
  ```
  > 状态: ✅ 已交付并复跑绿 → 交付记录: `engine-wpXX-...-implementation-YYYY-MM-DD.md`（同目录）
  ```
  别让任务单本体还挂着"待开工"——光靠文件路径在 completed/ 里不够直观，点开文件一眼要能看到它已经交付了。

### 3.3 一句话 commit

交付时给一句 commit 信息，格式：
```
feat(wpXX): 一句话说清做了什么
```

### 3.4 回写 backlog 母版

交付完顺手把 [`phase1-integration-backlog-2026-10-28.md`](./phase1-integration-backlog-2026-10-28.md) 里本 WP 的状态更新一下，三处都要改：

1. **§0.3 交付进度登记表**：把本 WP 那一行的状态从 `📋 待开工` / `🚧 在途` 改成 `✅ 已交付（日期）`，任务单列填上交付记录文件名。
2. **正文小节标题**：在本 WP 的 `### WPXX · ...` 标题下方加一段 `> ✅ 已交付（日期）` 横幅，跟 WP14/WP24 那种格式一致，贴交付记录链接 + 一两句话落地摘要。
3. **§0.4 其他待做项表**（如果本 WP 在那张表里有行）：把行划掉或标 ✅，别让待办清单里还挂着已交付的东西。

改完不需要单独 commit，跟着交付那笔一起提。

---

## 4. 已交付速查（避免重复做）

### 内核纯层（completed/wp0-wp5-core/）
WP0 边界骨架 / WP1 BDI认知引擎 / WP2 分层记忆 / WP3 轨迹控制 / WP4 伦理安全 / WP5 渲染调度契约

### 引擎装配（completed/wp6-wp12-wiring/）
- WP6 LLM RenderPort 主备执行（MiniMax）
- WP7 RenderSpec 组装 + turn 填 reply
- WP8-A DI 装配聚合 turn / WP8-B 流式原生 + WS 灰度切旧
- WP9-A 角色种子注入 / WP9-B MySQL 角色资产池 / WP9-C 语音 token 预算+安全边界
- WP10 10个伦理盲盒剧本 / WP10A 表达风格字段预留
- WP11 PsyGUARD-RoBERTa Python 服务（独立仓库 mofang-psyguard/）
- WP12 记忆收尾 + 跨会话 resume 接线

### 增补项（completed/wp14-wp24-augment/）
- WP14 学员心理风险处置层（三档分流+12356热线+审计表）+ 优化项（block 不发 llm_start）
- WP18 会话结束→复盘报告 E2E
- WP19 AdminDebugModule + BDI 留痕（WP19-R 已修复留痕链）
- WP20 Vue3 调试器 SPA（⚠️ 全是 mock 数据，前端待切真 API）
- WP21 报告 SSE 推送端点
- WP24 单场成本日志
- WP22 语音对练限流与并发上限（单用户并发=1 + 全局日 token 预算，两道闸门拦在开会话入口）
- WP16 turn 内存态幂等（同 round_id 重发不重跑 BDI；断流重发回 `turn_incomplete`，前端 round_id+1 走新一轮）
- WP23 WS 断连重连追平（断线**不杀会话**、不挂判死定时器；重连握手带 `lastSeenTurnIndex=N` → 服务端把 N 之后已提交轮次塞进 `session_catchup` 一次性补回；进程重启走 WP12 重建 + 从持久化补漏；断连期间压根不调 TTS provider；2 小时 idle 兜底）
- WP15 单回合非对称 delta cap（trust/valence 涨最多 +0.20、跌最多 −0.30 损失厌恶；arousal+阻抗三维 ±0.20；移情三维 ±0.15；**砍 delta 不是 clamp 绝对值**；**cap 参数走注入**（WP26 P2-14 改造：adapter 读 `ENGINE_CAP_*` env 组装成 `DeltaCapConfig` 端口注入内核，内核零 env 读取）；DELTA_TABLE 每个事件加幅度声明；adapter 侧打 `[WP15] turn delta capped: ... session=... handle=...` warning，内核零 logger 依赖；**cap 管的是本轮总 delta（事件 + 剧本）**）

### 封版审查（根目录）
- **WP25 Phase1 封版审查**（2026-11-03）—— 扫描报告 [`wp25-phase1-audit-report-2026-11-03.md`](./wp25-phase1-audit-report-2026-11-03.md)｜任务单 `completed/wp14-wp24-augment/engine-wp25-phase1-audit-backend-2026-11-03.md`
  - **8 个 P1 本单全修**：WS `sessionId` 归属校验（跨用户接管 + 拉走他人逐字稿）、`/admin/api` 生产 basic auth fail-close、生产 CSP 指令值（`'["self"'` → `'self'`）、express-session 公开常量密钥、头像失败文案脱敏、引擎 capObserver 抛错炸穿 turn、`.env.example` 补 130 键 + 47 个死键降级、任务单 §1.4 回改方向写反
  - **39 条 P2 待用户拍板**（安全 10 / 引擎 8 / 文档 15 / 配置与已知尾巴 6）
  - **10 条 P3 已进 Phase2 队列**（母版 §Phase2+ 队列）
  - **3 个新的机器断言套件**：`test/voice/wp25-ws-session-ownership.spec.ts`（WS 归属 10 例）、`test/base/wp25-security-hardening.spec.ts`（CSP / session 密钥 / basic auth / 头像文案 16 例）、`test/config/wp25-env-example-coverage.spec.ts`（`.env.example` ↔ `process.env` 双向一一对应 4 例）
  - **WP26 已把其中 34 条 P2 全修**（见下条）

### P2 全量修复（根目录）
- **WP26 Phase1 P2 全量修复**（2026-11-03）—— 交付记录 [`completed/wp14-wp24-augment/engine-wp26-phase1-p2-hardening-backend-implementation-2026-11-03.md`](./completed/wp14-wp24-augment/engine-wp26-phase1-p2-hardening-backend-implementation-2026-11-03.md)｜任务单 `completed/wp14-wp24-augment/engine-wp26-phase1-p2-hardening-backend-2026-11-03.md`
  - **安全 5 条**：WS 握手查 JWT **黑名单 + token type**、JWT 改走**握手请求之外的通道**（**Socket.IO 客户端走 `setAuth({token})` → 服务端读 `handshake.auth.token`**；原生 ws 走 `Sec-WebSocket-Protocol: bearer, <jwt>`；`?token=` query 保留兜底 —— 前端另派单）、`/metrics` **默认关 + token 鉴权**（fail-close）、`/admin/api/*` 加 **`AdminRoleGuard`**（查 DB 真值 `users.admin_role`）、握手写动作全部推到校验之后
  - **引擎 12 条**：⭐ 内核 `process.env` 改**注入**（`DeltaCapConfig` 端口，observer 一并改注入、删模块级单槽）→ 内核**零 env / 零 globalThis**；⭐ **轨迹 delta 也走 cap**（本轮总 delta = 事件 + 剧本，统一过一次 cap）；cap 报告带 sessionId；补 `STORAGE_FAILURE` 码；WP15 符号补 barrel；`boundary.spec.ts` 加「零 env」+「禁 adapter 深路径 import」两条断言
  - **文档 15 条**：**114 条死链归零** + WP20/WP22/WP11 三份交付记录**事实修正** + backlog 补 WP12/WP16 行
  - **配置 6 条**：`finishReason` **三处透传**、sessionId **服务端生成**（ready 帧下发 `serverSessionId`）、旧 socket 断开加 socketId 闸门、生产 5xx 也打本地日志（脱敏）
  - **闸门**：tsc 0 / eslint 0 / **全量 84 文件 1264 例全绿**（基线 77/1165）；内核边界断言 **11 条**全绿
  - **边界**：P2-2 / P2-36 的 **Flutter 前端另派单**（后端**三兼容**：子协议 / `handshake.auth` / query 三条传法都认）；P2-37 仍待真机核实；P3 的 10 条进 Phase2 队列

### 认证密码（completed/auth-and-password/）
- POST /auth/reset-password（忘记密码重置，不需要 JWT，凭验证码改密+撤销所有 session）
- POST /user/set-password（已登录首次设置密码，不要旧密码）
- POST /user/change-password（已登录改密，要旧密码）

---

## 5. 目录结构

```
docs/progress/
├── README.md          ← 你现在读的这个文件
├── pending/           ← 待开工任务单（当前活都在这）
├── completed/        ← 已交付全部归档（按阶段分）
│   ├── wp0-wp5-core/
│   ├── wp6-wp12-wiring/
│   ├── wp14-wp24-augment/
│   ├── auth-and-password/
│   └── early-misc/
└── archive/           ← 老文档，基本不用翻
```

---

## 6. 参考资料（按需查，不要一上来全读）

**不要开工前把这些全读了——context 会爆。** 遇到口径歧义、拿不准边界时，再翻对应文档。

| 文档 | 什么时候读 |
|---|---|
| `docs/architecture/ai-engine-roadmap-v1.1.md` | 任务单里没写清楚"为什么这么做"、或者你拿不准某个设计决策的上游依据时 |
| `docs/reference/ai-simulation-blueprint-v1.1.md` | 蓝图原始愿景，roadmap 冲突时以 roadmap 为准 |
| `docs/reference/bdi-cognitive-engine-principles-v1.0.md` | 改 BDI 算子/记忆/轨迹相关逻辑时，确认设计原则 |
| `docs/reference/architecture-blindspot-fill-v1.0.md` | 改伦理/安全/兜底相关逻辑时，确认盲区补全口径 |
| `docs/architecture/microservices-evolution-plan.md` | 写新功能前看一眼 §2 的 5 条边界规则——现在不拆微服务，但代码要保持将来好拆 |

**原则：README + 当前任务单 = 99% 够用。** 上面这些是"字典"，遇到生字才翻。

---

## 7. 开工前自检清单

```
□ 我读完了 pending/ 里的任务单全文
□ 我确认 engine-core 一行不动
□ 我知道交付记录要写什么格式
□ 我知道交付后要移文件
```
全勾了再动手。
