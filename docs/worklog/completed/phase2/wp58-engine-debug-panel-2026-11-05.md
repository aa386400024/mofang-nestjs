# WP58 · 引擎调试面板（/debug-chat 后端接口）

> **状态**：✅ 已交付（2026-11-05）→ [`engine-wp58-engine-debug-panel-implementation-2026-11-05.md`](engine-wp58-engine-debug-panel-implementation-2026-11-05.md)
> **路径**：`docs/worklog/completed/phase2/wp58-engine-debug-panel-2026-11-05.md`
> 优先级: 🟡 P1 专业能力
> 预估: 中
> 依赖: WP31（成本看板，已完成）
> 关联: admin-dashboard /debug-chat 页面（前端已搭好，就差后端接口）

---

## 一、背景

admin-dashboard 的 `/debug-chat` 页面（DebugChat.vue）已经搭好了——8 个 Tab、可拖拽分栏、i18n 全量。但后端接口还没写，前端现在只能调现有的 `GET /admin/api/characters`，创建会话和发对话都是 TODO。

WP58 就是补这两个接口，让调试者能真实跑引擎流程，看每一步内部状态（BDI 快照、delta、审议 trace、prompt 全文等）。

---

## 二、目标

补两个写操作接口，给 DebugChat.vue 用：

1. `POST /admin/api/debug/session` —— 创建调试会话
2. `POST /admin/api/debug/session/:id/turn` —— 发一轮对话，返回完整调试 trace
3. `DELETE /admin/api/debug/session/:id` —— 关闭调试会话（清理内存）

---

## 三、设计决策

### D1 调试会话不落库，纯内存

**为什么不落库**：
- 调试会话是给 admin 临时跑的，不是正式训练场次
- 落库会污染 training_sessions 表（学员的正式场次）
- 调试会话跑完就丢，不需要持久化

**实现**：
- 调试会话存在内存 `Map<debugSessionId, DebugSessionState>` 里
- 进程重启后丢失（调试场景可接受）
- 调 `closeSession` 时从 Map 里删掉

### D2 复用现有 EngineTurnService，不重新造轮子

**为什么复用**：
- 现有的 `EngineTurnService` 已经做了：内核 openSession + 登记归属 + turn + close
- 现有的 `EngineWiringController`（`/engine/debug/open` `/turn` `/close`）已经有一套接口，但挂了 `JwtAuthGuard`（给学员用），而且入参太底层——需要传完整的 `characterProfile` 对象
- 调试接口要做的是：**在 admin-debug module 里包一层**，入参简化（只传 characterSlug），返回值补调试数据（delta / 审议 trace / prompt 全文）

**与现有 EngineWiringController 的区别**：
| | EngineWiringController（现有） | WP58 调试接口（新增） |
|---|---|---|
| 路径 | `/engine/debug/open` `/turn` `/close` | `/admin/api/debug/session` `/session/:id/turn` |
| 鉴权 | `JwtAuthGuard`（学员） | `AdminRoleGuard`（admin） |
| open 入参 | 完整 `characterProfile` 对象 | 只传 `characterSlug`（后端自己解析） |
| 返回值 | `TurnRenderResult`（基础数据） | `TurnRenderResult` + delta + 审议 trace + prompt 全文 |
| 用途 | 学员调试自己的会话 | admin 调试引擎内部状态 |

**调用链**：
```
DebugSessionController
  → CharacterProfileResolver.resolve({ templateId: characterSlug })  // 角色解析
  → EngineTurnService.open()            // 内核 openSession + 登记归属
  → EngineTurnService.turn()            // 跑一轮对话
  → Redis 读审议 trace                   // WP64 写的
  → 组装调试 trace 返回
```

### D3 数据从现有地方抽，不新增采集链路

**不改 TraceRecorder**：
- 现有 TraceRecorder 是给正式训练会话用的（写 training_sessions.turn_debug_trace）
- 调试会话不落库，不需要走 TraceRecorder
- 调试 trace 直接在接口返回值里组装，不写 DB

**BDI 快照**：从 `TurnRenderOrchestrator.turn()` 的输出里拿（含 safety/bond 三维）

**delta**：门面有 `lastSnapshots`（上一轮结束时的快照），本轮结束时的快照也有，两者相减就是 delta

**审议 trace**：从 Redis 读（WP64 写的）
- key 格式：`deliberation_trace:{租户长度}:{租户}:{会话长度}:{会话}:{轮次}`（带长度前缀，撞键防护）
- TTL：30 天

**prompt 全文**：渲染时的 spec 里有（不只前 500 字预览）

### D4 调试会话开关

**env**：`ENGINE_DEBUG_CHAT_ENABLED`
- 显式配了 → 按配的来（true/1 开，false/0 关）
- 没配 → dev 缺省开，prod 缺省关

**为什么要有开关**：
- 生产环境不能随便开调试接口（安全风险）
- dev 环境默认开，方便开发调试

### D5 鉴权与现有 admin 接口一致

**为什么一致**：
- 现有的 admin-debug controller 挂了 `AdminRoleGuard`（非 admin → 403）
- 调试接口是内部能力，必须也是 admin 才能用
- class 级挂 `@UseGuards(AdminRoleGuard)`，和现有 4 个接口同款

---

## 四、接口设计

### 4.1 POST /admin/api/debug/session —— 创建调试会话

**入参**：
```json
{
  "characterSlug": "vpt_intimate_avoidance_l1"  // 角色代号（从 GET /admin/api/characters 拿）
}
```

**出参**：
```json
{
  "debugSessionId": "debug_abc123",           // 调试会话 id
  "characterSlug": "vpt_intimate_avoidance_l1",
  "characterLabel": "亲密回避型 L1",
  "createdAt": "2026-11-05T10:00:00.000Z"
}
```

**逻辑**：
1. 调 `CharacterProfileResolver.resolve({ templateId: characterSlug })` 拿角色基线
2. 角色解析失败 → 400 错误（"角色不存在"）
3. 调 `EngineTurnService.open()` 创建内核会话：
   - `sessionId`：`debug_{nanoid()}`（调试会话专用前缀）
   - `tenantId`：`'debug'`（固定）
   - `visitorId`：`'debug-admin'`（固定）
   - `characterProfile`：解析出来的角色基线
4. 把 `debugSessionId → handleId` 存在内存 Map 里
5. 返回调试会话信息

### 4.2 POST /admin/api/debug/session/:id/turn —— 发一轮对话

**入参**：
```json
{
  "userText": "我今天感觉不太好"  // 咨询师输入
}
```

**出参**：
```json
{
  "turnIndex": 1,
  "reply": "（叹了口气）嗯……怎么了？",  // 来访口语
  "bdiSnapshot": {
    "trust": 0.5,
    "safety": 0.4,
    "bond": 0.1,
    "resistance": 0.3,
    "valence": 0.4,
    "arousal": 0.5
  },
  "delta": {  // 本轮变化量（前后快照差）
    "trust": +0.01,
    "safety": 0,
    "bond": 0,
    "resistance": -0.02,
    "valence": +0.03,
    "arousal": 0
  },
  "intention": {
    "strategy": "explore",
    "emotion": "neutral",
    "resistance": "low"
  },
  "renderSpec": {
    "taskKind": "freeform",
    "promptPreview": "你是一个……（前 500 字，现有格式）",
    "promptFull": "你是一个……（完整 prompt，新增）",
    "maxCompletionTokens": 2048,
    "reasoningEffort": "medium"
  },
  "llmUsage": {
    "promptTokens": 1200,
    "completionTokens": 350,
    "reasoningTokens": 800,
    "ttftMs": 450,
    "finishReason": "stop"
  },
  "deliberationTrace": {  // 审议 trace（从 Redis 读）
    "enabled": true,
    "ruleDelta": { "trust": +0.01, "resistance": -0.02 },
    "llmDelta": { "trust": +0.015, "resistance": -0.018 },
    "deltaDiff": { "trust": 0.005, "resistance": 0.002 },
    "llmIntentionShift": null,
    "lockedStrategy": "explore",
    "llmIntentionAccepted": false,
    "errorCode": null
  },
  "crisis": {
    "detected": false,
    "category": null
  },
  "ts": "2026-11-05T10:01:00.000Z"
}
```

**逻辑**：
1. 从内存 Map 里拿 `debugSessionId → handleId`
2. 找不到 → 404（"调试会话不存在"）
3. 调 `TurnRenderOrchestrator.turn(handleId, { userText })` 跑一轮对话
4. 从 Redis 读这一轮的审议 trace（key = `deliberation_trace:debug:{sessionId}:{turnIndex}`）
5. 组装完整调试 trace 返回

---

## 五、边界

### 5.1 不改 engine-core（红线）

- 所有逻辑都在 `src/admin-debug/` 或 `src/engine-adapters/` 里做
- `git diff --stat HEAD -- src/engine-core` 必须为空

### 5.2 调试会话不落库

- 不写 `training_sessions` 表
- 不写 `turn_debug_trace` 列
- 纯内存 Map 存调试会话状态

### 5.3 不新增采集链路

- BDI 快照：从 `TurnRenderOrchestrator.turn()` 输出里拿（现有）
- delta：从 `lastSnapshots` 算（现有）
- 审议 trace：从 Redis 读（WP64 写的，现有）
- prompt 全文：从渲染 spec 里拿（现有）

### 5.4 心理内容禁止进日志

- 调试接口的日志只打定位信息（sessionId / turnIndex / 耗时）
- 不打对话原文、不打 BDI 快照细节

---

## 六、文件清单

### 新增文件

| 文件路径 | 用途 |
|---|---|
| `src/admin-debug/debug-session.controller.ts` | 调试会话接口（2 个写操作：创建会话、发一轮对话） |
| `src/admin-debug/debug-session.service.ts` | 调试会话逻辑（角色解析 → openSession → turn → 读审议 trace → 组装返回值） |

### 修改文件

| 文件路径 | 改什么 |
|---|---|
| `src/admin-debug/admin-debug.module.ts` | ① import `EngineModule`（注入 EngineTurnService）② import `CharacterPoolModule`（注入 CHARACTER_PROFILE_RESOLVER）③ 注册新 controller + service |

---

## 七、验收标准

### 7.1 功能验收

- [ ] `POST /admin/api/debug/session` 能创建调试会话，返回 debugSessionId
- [ ] `POST /admin/api/debug/session/:id/turn` 能跑一轮对话，返回完整调试 trace
- [ ] 调试 trace 里有 BDI 快照（含 safety/bond 三维）
- [ ] 调试 trace 里有 delta（前后快照差）
- [ ] 调试 trace 里有审议 trace（从 Redis 读的）
- [ ] 调试 trace 里有 prompt 全文（不只前 500 字）
- [ ] 调试会话不落库（training_sessions 表没新增记录）

### 7.2 闸门验收

```powershell
npx eslint "src/**/*.ts"                    # → 0 error
npx tsc -p tsconfig.build.json --noEmit     # → 0 error
npx vitest run                              # → 全绿
git diff --stat HEAD -- src/engine-core     # → 空
```

---

## 八、测试用例清单

### 8.1 创建调试会话（3 例）

1. ✅ 传合法 characterSlug → 200，返回 debugSessionId
2. ✅ 传不存在的 characterSlug → 400，"角色不存在"
3. ✅ 不传 characterSlug → 400，"角色代号必填"

### 8.2 发一轮对话（5 例）

4. ✅ 合法 debugSessionId + userText → 200，返回完整调试 trace
5. ✅ BDI 快照里有 safety/bond 三维
6. ✅ delta 字段正确（前后快照差）
7. ✅ 审议 trace 从 Redis 读出来了
8. ✅ 传不存在的 debugSessionId → 404

### 8.3 关闭调试会话（2 例）

9. ✅ 合法 debugSessionId → 200，内存 Map 清理干净
10. ✅ 传不存在的 debugSessionId → 404（幂等）

### 8.4 开关与鉴权（3 例）

11. ✅ `ENGINE_DEBUG_CHAT_ENABLED=false` → 接口 403
12. ✅ 非 admin 用户 → 403（AdminRoleGuard 拦）
13. ✅ admin 用户 → 200

### 8.5 边界（3 例）

14. ✅ 调试会话不落库（training_sessions 表没新增）
15. ✅ engine-core 零改动
16. ✅ 心理内容不进日志（只打定位信息）

---

## 九、转述话术（给后端 AI）

> 你好，WP58 开工。
>
> 任务：给 admin-dashboard 的 /debug-chat 页面补后端接口。前端 DebugChat.vue 已经搭好了，就差两个写操作接口。
>
> 先读这份任务单：`docs/worklog/pending/wp58-engine-debug-panel-2026-11-05.md`
>
> 边界红线：
> - engine-core 纯层一行不动（`git diff --stat HEAD -- src/engine-core` 必须为空）
> - 调试会话不落库（纯内存 Map，不写 training_sessions 表）
> - 心理内容禁止进日志（只打定位信息）
>
> 遇到任务单与代码不符时，先 grep 核实，找企业级最佳方案，在交付记录里写明偏差。
>
> 完成后按 `docs/team/conventions.md` §2 的交付格式走：写交付记录 → 移文件 → 回写 backlog → 给 commit message 草稿。

---

## 十、交付后补记（2026-11-05）

> 交付记录：[`engine-wp58-engine-debug-panel-implementation-2026-11-05.md`](engine-wp58-engine-debug-panel-implementation-2026-11-05.md)
> 下表逐条登记**与任务单原文的偏差**（完整版见交付记录 §三）。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| 1 | §六「修改 `admin-debug.module.ts`：① import `EngineModule` ② import `CharacterPoolModule` ③ 注册新 controller + service」 | **新增** `admin-debug-chat.module.ts` 承载新 controller + service；`admin-debug.module.ts` **一行未改** | grep 核实：`engine.module.ts:122` **已经 import `AdminDebugModule`**（为了 `TraceRecorder`）→ 反向 import = **模块循环依赖**，Nest 启动期炸。拆新模块后依赖是单向 DAG；**不用 `forwardRef`**（全仓使用次数 = 0） |
| 2 | §4.2 逻辑第 3 步「调 `TurnRenderOrchestrator.turn(handleId, { userText })`」 | 走 `turnStream(..., { includePromptFull: true })` | 聚合路径 `buildSpecSummary(spec, {})` **传空真值** → `promptPreview` 恒 `''`、无 `finishReason`/`ttftMs`；而 §7.1 要求 prompt 全文。两条路径共用同一套闭环，只差"怎么取文" |
| 3 | §4.1 出参 `debugSessionId` | **同时**给 `sessionId`（前端读它）与 `debugSessionId`（同值别名） | 前端 `DebugChat.vue:95` 读 `data.sessionId` —— 一个真相、两个名字 |
| 4 | §4.2 入参 `userText` | **同时**收 `counselorText`（前端发它）与 `userText` | 前端 `DebugChat.vue:125` 的 body 是 `{ counselorText }` |
| 5 | §4.2 出参是扁平结构 | 返回 `{ turnIndex, reply, trace }`，完整状态在 `trace` 里 | 前端契约是 `data.trace`；为兼容示例再摊一份顶层 = 两份形状 |
| 6 | §4.2 `delta` 6 键扁平 | `delta` = 内核**全量 11 维** `DeltaVector`；另给 `deltaDetail`（前端 8 维投影，`events: []`） | 阻抗是三维，拍平会丢信息；`events` 内核不对外 → 留空不编 |
| 7 | §4.2 `intention` 示例 `{strategy:"explore", emotion:"neutral", resistance:"low"}` | 返回内核 `Intention` 原样 | 内核 `emotion` / `resistance` 都是**对象**，且 `strategy` 无 `"explore"` 这个取值 |
| 8 | §4.2 `renderSpec.taskKind: "freeform"` | 内核 `RenderTaskKind`（`stable`/`chat`/`advanced`） | 内核没有 `"freeform"` 任务档 |
| 9 | §7.1「prompt 全文（不只前 500 字）」；§5.3「从渲染 spec 里拿（现有）」 | 渲染链**新增按需通道**（4 个文件）：`promptFull` 只走内存，**留痕契约仍只取 500 字预览 → 不落库** | 适配器本来只产 500 字预览（WP19-R 刻意不存全文）；"现有 spec 里有全文"不成立 |
| 10 | §8.3「不存在的 debugSessionId → 404（幂等）」 | **404** | "幂等"与"404"自相矛盾；按显式验收条目取 404 |
| 11 | §5.3「delta：从 `lastSnapshots` 算（现有）」 | 调试服务**自己记**上一轮快照 | 门面的 `lastSnapshots` 是 private，外部拿不到；口径与门面一致（第 1 轮 null） |
| 12 | §4.2 第 4 步「从 Redis 读审议 trace」 | 读 Redis + **有界等待**（默认 5s，可 env 调） | 审议是 BullMQ 异步跑的（3–8s），turn 返回时 trace 通常还没写；不等必然读到 null。第 1 轮不等待 |
| 13 | （任务单未提）开关关闭时的行为 | **403**；判定放**服务层** | 这是"能力开没开"的判断，不该只在 controller |
| 14 | §4.1「`visitorId: 'debug-admin'`」 | 额外把 `userId` 也登记为 `'debug-admin'` | 影子审议要求 `userId` 非空，否则**跳过这一轮** → 面板永远看不到审议 trace |
| 15 | §4.1「`sessionId: debug_{nanoid()}`」 | 内核 sessionId 与调试会话 id **同一个值** | 审议 trace 的 Redis key 含会话 id —— 归属登记与 key 必须一致 |

**闸门**：eslint **0 error**（`npx eslint "src/**/*.ts" "test/**/*.ts"` exit 0）/ tsc **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0）/ vitest **107 文件 1817 例全绿**（WP68 基线 106 文件 1790 例 → 本轮 **+1 文件 / +27 例**；闸门用 `vitest run --exclude '**/e2e/**/*.ts'`，e2e 要真 DB/Redis）/ `git diff --stat HEAD -- src/engine-core` = **空**（内核零改动）/ `boundary.spec.ts` 全绿。

> ⚠️ **前端接线未做**（不归本单）：`DebugChat.vue` 的 2 处 TODO 注释要由前端 AI 换成真调用；`resetSession()` 目前也没调 DELETE —— 后端已备好该端点，否则内核会话句柄会一直挂着。
