# WP26 · Phase1 P2 全量修复（企业级标准）

> 日期：2026-11-03 ｜ 仓库：`E:\Work\Project\backend\mofang-nestjs`
> 性质：WP25 扫描出的 34 条 P2 全部修复——不凑合、不留尾巴，企业级方案落地
> 状态：✅ **已交付并复跑绿**（交付记录：[`engine-wp26-phase1-p2-hardening-backend-implementation-2026-11-03.md`](./engine-wp26-phase1-p2-hardening-backend-implementation-2026-11-03.md)）
> 🔴 本单允许改 `src/engine-core/**`（P2-14 注入改造需要），但改完必须保持内核纯函数性（零 process.env、零 NestJS、零 IO）
> 🔗 前置：WP25 扫描报告已出（`docs/progress/wp25-phase1-audit-report-2026-11-03.md`）

---

## 0. 总则

WP25 扫描出的 39 条 P2 里，P2-30/31/32 已在 WP25 回写中处理，P2-37 是真机验证项不是代码修复。本单修剩余 **34 条**。

> **条数对账（交付时复核）**：39 = **34**（本单）+ 4（P2-8 / P2-30 / P2-31 / P2-32，WP25 回写时已处理）+ 1（P2-37，真机验证项）。任务单原写的 34 条**口径正确**，无需补正。
>
> **交付实况**：34 条全部修复；P2-2 / P2-36 的**后端**部分完成（Flutter 前端另派单，后端**三条**传法都支持：`Sec-WebSocket-Protocol` 子协议 / `handshake.auth.token` / `?token=` query 兜底）。

**统一原则**：
- 企业级方案，不是"先这样"。该注入就注入，该加断言就加断言，该修注释就修注释。
- 每修一条，对应 WP25 报告里的那条编号划掉。
- 不重构无关代码，不顺手优化。
- 全量闸门：tsc 0 / eslint 0 / 全量测试绿。

---

## 1. 安全加固（5 条）

### P2-1 WS JWT 查黑名单 + token type
- **位置**：`src/voice/voice.gateway.ts:358-370` `verifyJwt`
- **问题**：WS 握手只验签名，不查 token type、不查黑名单——已登出的 access token 仍能连 WS
- **企业级修法**：复用 `JwtAuthGuard` 的黑名单查询逻辑，握手时校验 `type=access` 且未在黑名单中
- **验收**：构造一个已登出的 token，WS 握手被拒

### P2-2 JWT 改走握手请求之外的通道（后端准备）
- **位置**：`src/voice/voice.gateway.ts` `extractToken`
- **问题**：JWT 走 URL query（`?token=`）→ 落进 nginx access log / Referer / 浏览器历史
- **企业级修法**：后端支持从**两条握手外通道**提取 token —— ① `Sec-WebSocket-Protocol` header（标准做法：客户端把 token 作为子协议值传入，服务端只回 echo `bearer` 标记，**token 不回显**）；② **`handshake.auth.token`**（Socket.IO 标准握手字段，`setAuth({ token })` —— token 走 **CONNECT 包**，不进 URL，**Socket.IO 客户端走这条**）。URL query 保留作为兼容兜底（dev/测试用），生产文档标注"新客户端用握手外通道"
- **前端配合**：Flutter 端改握手代码（另派单）—— Socket.IO 端用 `setAuth({ token })`，原生 ws 端用 `Sec-WebSocket-Protocol: bearer, <jwt>`
- **验收**：后端同时支持三条传法，子协议与 `handshake.auth` 两条新路径都有测试

### P2-3 /metrics 加鉴权
- **位置**：`src/shared/infra/metrics/metrics.controller.ts:29-40`
- **问题**：`/metrics` 默认开启且无鉴权，暴露内部指标
- **企业级修法**：生产默认关闭（`METRICS_ENABLED=false`），开启时加内网 IP 白名单或独立 token
- **验收**：生产默认 404，开启后无 token 401

### P2-4 admin 加角色校验
- **位置**：`src/admin-debug/` 整个命名空间
- **问题**：只有 basic auth / 学员 JWT，没有角色校验——任何学员凭自己 token 都能进调试器
- **企业级修法**：加 `AdminRoleGuard`，查 `users.admin_role` 字段（不存在则 migration 加列，默认 `'user'`）。非 admin 角色 403
- **验收**：普通学员 token 访问 /admin/api/* 返回 403

### P2-5 握手写动作全部推到校验之后
- **位置**：`src/voice/voice.gateway.ts` 握手流程
- **问题**：握手里有写状态的动作早于部分校验
- **企业级修法**：所有写动作（落库、演练登记、帧出口接管）推到 JWT 校验 + sessionId 归属校验之后
- **验收**：归属校验失败时，零状态写入（内存 map 不新增条目、TTS 不初始化）

---

## 2. 引擎正确性（8 条）

### P2-6 裸 Error 改 SESSION_NOT_FOUND
- **位置**：`src/engine-adapters/wiring/engine-stream-backend.adapter.ts:596`
- **问题**："会话未开启"抛裸 Error，落全局兜底 500（应 404）
- **修法**：改抛 `EngineCoreError(EngineErrorCode.SESSION_NOT_FOUND)`
- **工作量**：5 分钟

### P2-7 mapKernelError default 分支携带 details
- **位置**：`src/engine-adapters/wiring/engine-wiring.controller.ts:203-204`
- **问题**：default 分支丢了 `error.message` 与 `error.details`
- **修法**：default 分支剔除敏感字段后携带 details，至少打进 logger
- **工作量**：5 分钟

### P2-9 / P2-10 修正过时注释（150 vs 500）
- **位置**：`src/engine-core/cognition/safety/assess-safety.ts:87`、`src/engine-adapters/wiring/risk/http-psyguard.probe.ts:41/45/50/148`、`psyguard-health.checker.ts:67`
- **问题**：注释写"150ms"，实际当前是 500ms（测试期放宽）
- **修法**：统一改成"当前 500ms（测试期放宽），内测前回改 150ms"
- **工作量**：15 分钟

### P2-11 cap 报告带 sessionId
- **位置**：`src/engine-core/cognition/state-transition.ts` + `delta-cap.logger.ts`
- **问题**：cap warning 不带 sessionId，多人内测时找不到是哪场被砍
- **企业级修法**：配合 P2-14 的注入改造，cap context（sessionId/handleId）通过注入传入，报告里带上
- **工作量**：含在 P2-14 里

### P2-12 轨迹 delta 也走 cap
- **位置**：`src/engine-core/cognition/trajectory/trajectory-applier.ts:201-219`
- **问题**：`applyTrajectoryStep` 在 cap 之后再叠加 delta，只 clamp 不 cap，单回合能到 2 倍 cap
- **企业级修法**：把 `capTurnDelta` 复用到轨迹叠加之后——cap 管的是"一回合总 delta"，不管 delta 来自事件还是剧本。最终输出前做最后一次 cap
- **注意**：剧本作者显式意图在 DELTA_TABLE/剧本注释里声明，但 cap 是硬上限不绕过
- **验收**：构造 crisis_signal 剧本（valence -0.3）+ 一个 judgment 事件（valence -0.12），断言单回合 |Δvalence| ≤ 0.30（不是 0.42）

### P2-13 env 键显式声明
- **位置**：`src/engine-core/cognition/state-transition.ts:258` + `typings/global.d.ts`
- **问题**：18 个 `ENGINE_CAP_*` 键未在 `NodeJS.ProcessEnv` 声明，用 bracket 访问绕过 env 治理
- **企业级修法**：如果 P2-14 走注入改造，这个问题自然消失（内核不再读 process.env）。adapter 侧读 env 时按仓库惯例显式声明
- **工作量**：含在 P2-14 里

### P2-14 ⭐ 内核 env 读取改注入（本单核心改造）
- **位置**：`src/engine-core/cognition/state-transition.ts`
- **问题**：WP15 在纯层里直接读 `process.env`，破坏"纯函数可复现"内核红线。同 seed 同序列在不同 cap 配置下落到不同状态
- **企业级修法**：
  1. 定义 `DeltaCapConfig` 接口（9 维度 × 上/下向 = 18 个数值），作为内核端口
  2. `transitionState` 改为接收可选 `capConfig?: DeltaCapConfig` 参数（或通过已有的 engine-session 注入链传入）
  3. adapter 层（`engine.module.ts` 或 wiring）读 env，组装 `DeltaCapConfig`，注入到引擎会话
  4. 内核零 `process.env` 访问——配合 P2-17 加机器断言
  5. 默认值仍在源码里（作为 `DEFAULT_CAP_CONFIG` 常量导出），env 只做覆写
- **验收**：
  - 内核 grep `process.env` 零命中
  - `boundary.spec.ts` 新增第 10 条断言：内核树零 `process.env` 访问
  - 同 seed + 同 capConfig 同序列逐字同输出
  - 现有 WP15 测试全绿（测试里直接传 capConfig，不依赖 env）

### P2-15 修正文件头注释
- **位置**：`src/engine-core/cognition/state-transition.ts:3`
- **问题**：文件头写"纯函数, 无状态, 无随机, 可复现"，P2-14 改造后重新成立
- **修法**：改回"纯函数，无状态，可复现"（注入改造后这条重新成立）
- **工作量**：随 P2-14

### P2-16 WP15 公开面补进 barrel
- **位置**：`src/engine-core/index.ts` + `boundary.spec.ts`
- **问题**：WP15 新增的 6 个符号不进 barrel，adapter 走深路径 import，boundary 白名单守卫不到
- **企业级修法**：把 `capTurnDelta` / `transitionStateDetailed` / `DeltaCapConfig` 等公开符号补进 `index.ts`，更新 `boundary.spec.ts` 的 expectedPublic 清单
- **额外断言**：加一条"禁止 adapter 深路径 import engine-core 非 in-memory/ 内部模块"
- **工作量**：30 分钟

### P2-17 boundary 断言加 process.env 检查
- **位置**：`test/engine-core/boundary.spec.ts`
- **问题**：9 条断言只查 import，不查 `process.env` 全局访问——WP15 引入 env 读取时全绿
- **企业级修法**：加第 10 条断言：内核树零 `process.env` / 零 `globalThis` 访问。P2-14 改注入后此断言零白名单直接成立
- **工作量**：随 P2-14

### P2-18 补 STORAGE_FAILURE 错误码
- **位置**：`src/engine-core/domain/engine-errors.ts:27-40`
- **问题**：缺"仓储/依赖失败"错误码；`UNSUPPORTED` 是死码
- **企业级修法**：加 `STORAGE_FAILURE = 'ENGINE_STORAGE_FAILURE'`，端口 `@throws` 写明；`UNSUPPORTED` 标注 Phase2
- **工作量**：30 分钟

---

## 3. 文档修正（15 条）

### P2-19/20/21 批量修死链
- **位置**：`phase1-integration-backlog-2026-10-28.md`（15 条）、`docs/README.md`（52 条）、`completed/**`（40+ 条）
- **问题**：文件移进子目录后相对链接没跟着改
- **企业级修法**：逐条核对重指向，用 `find` + `grep` 找出所有断链，批量修
- **工作量**：5h

### P2-22 WP20 交付记录修正
- **位置**：WP20 交付记录
- **问题**：写"全 mock"，实际已切 4 个真 API 页面
- **修法**：改写
- **工作量**：10 分钟

### P2-23 WP22 交付记录修正
- **位置**：WP22 交付记录
- **问题**：写"409/自动关旧场"，实际是不自动关 + 独立错误码
- **修法**：改写
- **工作量**：10 分钟

### P2-24 WP11 交付记录修正
- **位置**：WP11 交付记录 §5
- **问题**：红线表写"不改 engine-core，diff 为空"，实际改了 1 个文件
- **修法**：改写
- **工作量**：10 分钟

### P2-25 WP22 补登记前端文件
- **位置**：WP22 交付记录
- **问题**：git show --stat 显示改了 16 个前端文件未登记
- **修法**：补登记
- **工作量**：10 分钟

### P2-26 WP24 补时序说明
- **位置**：WP24 交付记录
- **问题**：前提被 WP19-R 推翻
- **修法**：补一句时序说明
- **工作量**：10 分钟

### P2-27 code-vs-blueprint-audit 加快照提示
- **位置**：`code-vs-blueprint-audit-2026-10-30.md`
- **问题**：缺"这是快照不代表现状"提示
- **修法**：抬头加一句
- **工作量**：5 分钟

### P2-28 backlog §0.3 补 WP12/WP16 行
- **位置**：`phase1-integration-backlog-2026-10-28.md` §0.3
- **问题**：交付表缺 WP12/WP16 两行
- **修法**：补行
- **工作量**：10 分钟

### P2-29 统一 150/500 口径
- **位置**：三处互相矛盾的文档/注释
- **修法**：统一成"当前 500ms（测试期放宽），内测前回改 150ms"
- **工作量**：20 分钟

### P2-33 架构文档标注预留 env
- **位置**：`docs/architecture/v6.0-ai-engine.md:211-215`
- **问题**：列的 env 代码里不读
- **修法**：标注"预留，未接线"
- **工作量**：20 分钟

---

## 4. 配置与尾巴（6 条）

### P2-34 finishReason 透传
- **位置**：`engine-stream-backend.adapter.ts:989-999`、`voice.service.ts:1649-1658`
- **问题**：上游拿得到 finish_reason 但 done chunk 丢了
- **企业级修法**：3 处透传 `finishReason` 字段到 done 帧
- **工作量**：半小时

### P2-35 admin mock 页面补 pending 标注
- **位置**：`admin-dashboard/src/` `/characters/:slug` 页面
- **问题**：mock 数据缺 pending 状态标注
- **修法**：补标注
- **工作量**：10 分钟

### P2-36 ⭐ sessionId 改服务端生成
- **位置**：`src/voice/voice-handshake.ts:204/261-265`
- **问题**：sessionId 缺省 `'default'`，不带 `?sessionId=` 的客户端共用同一个 key
- **企业级修法**：
  1. 服务端握手时，如果客户端没传 sessionId 或传了 `'default'`，服务端生成 nanoid
  2. ready 帧下发 `{ dbSessionId, serverSessionId }`
  3. 客户端后续重连用服务端下发的 sessionId
  4. 已有客户端传了合法 sessionId 的情况不变（兼容 WP23 重连）
- **前端配合**：Flutter 端读 ready 帧的 serverSessionId，后续握手带上（另派单）
- **验收**：不带 sessionId 的客户端不会共用 key

### P2-38 旧 socket 断开加 socketId 闸门
- **位置**：`src/voice/voice.gateway.ts` `handleDisconnect`
- **问题**：`detachSocket` + `sessions.remove` 没有 socketId 闸门，重连竞态下旧 socket 断开会摘新 socket 的登记
- **企业级修法**：加上与帧出口同样的 socketId 比对——只有当前登记的 socketId 匹配才摘
- **工作量**：20 分钟

### P2-39 生产 5xx 也打本地日志
- **位置**：`src/common/filters/biz-exception.filter.ts:62-71`
- **问题**：生产 5xx 本地日志不打，只能靠 Sentry
- **企业级修法**：生产也打 error 日志（脱敏后，不返给前端）
- **工作量**：10 分钟

---

## 5. 不做

- ❌ P3 的 10 条（已进 backlog Phase2 队列）
- ❌ P2-37（真机验证项，不是代码修复）
- ❌ 重构无关代码
- ❌ 改 DELTA_TABLE 种子值

---

## 6. 验收

1. ✅ 34 条 P2 全部修复，WP25 报告里对应条目划掉（38 条标 ✅；P2-37 标 ⏳ 真机验证项）
2. ✅ `grep -r "process.env" src/engine-core/` 零命中（P2-14 改造后；由 `boundary.spec.ts` 断言⑩ 机器守住）
3. ✅ `boundary.spec.ts` **11** 条断言全绿（10 条 + 本单另加的「禁 adapter 深路径 import」第 11 条）
4. ✅ `.env.example` 与代码 env 读取点一一对应（WP25 已建机器断言；本单把 `ENGINE_CAP_*` 族从「派生登记」改为「字面量断言」）
5. ✅ WS 会话归属校验 + 黑名单校验有回归测试（`test/voice/wp26-voice-gateway-hardening.spec.ts` 34 例，含 P2-2 的 `handshake.auth` 通道）
6. ✅ tsc 0 / eslint 0 / 全量测试绿（84 文件 / 1264 例）
7. ✅ 文档死链全部修复（114 → 0）
8. ✅ 交付记录回写 backlog 母版
