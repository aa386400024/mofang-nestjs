# Phase2.5 WP-D 交付记录：自动对练（AI 咨询师 × AI 来访者）

> 状态：✅ 已交付
> 日期：2026-11-08
> 任务单：`pending/phase2.5-wp-d-auto-practice-2026-11-08.md`

---

## 一、做了什么

把 DebugChat 里"人当咨询师、AI 当来访者"翻成"两边都是 AI"：AI 咨询师按 7 种人设之一说话，后面的引擎处理（BDI 决策 / 记忆 / 渲染 / 危机探测）完全复用现有 `DebugSessionService`，不新写对话循环。这样能批量跑 30+ 场，积累数据验证引擎质量。

## 二、改了哪些文件

### 新增（src/auto-practice/）
| 文件 | 职责 |
|---|---|
| `auto-practice.module.ts` | 模块装配（imports / providers / 中间件挂载） |
| `auto-practice.controller.ts` | REST：启动单场 / 批量入队 / 查场次 / 批量进度 / 模式 CRUD |
| `auto-practice.gateway.ts` | WebSocket `/auto-practice`，每轮对话实时推前端 |
| `auto-practice.events.ts` | WS 事件契约（session_start / turn / session_end） |
| `counselor-agent.service.ts` | AI 咨询师：按 mode.systemPrompt 调 LLM 生成咨询师台词 |
| `practice-runner.service.ts` | 核心循环：open→(咨询师生成→引擎跑一轮)×N→close，含结束条件 |
| `practice-queue.service.ts` | BullMQ 队列 + Worker（并发 3，env 可调） |
| `ports/turn-engine.port.ts` | 对话引擎窄端口（runner 不直接依赖 DebugSessionService） |
| `adapters/debug-turn-engine.adapter.ts` | 端口生产实现：包装 DebugSessionService |
| `entities/counselor-mode.entity.ts` | `ap_counselor_modes` 表实体 |
| `entities/practice-session.entity.ts` | `ap_practice_sessions` 表实体 |
| `seeds/counselor-modes.seed.ts` | 7 种人设的 system prompt 初值 |
| `seeds/counselor-modes.seed-runner.ts` | 幂等 upsert 函数 |

### 新增（其他）
| 文件 | 职责 |
|---|---|
| `src/migration/1714900000033-AddAutoPracticeTables.ts` | 手写 DDL 建两张表（幂等） |
| `bin/seed-counselor-modes.ts` | seed 运行入口 |
| `bin/seed-visitors-jsonl.ts` | visitors.jsonl 11 角色导入来访池 |
| `test/auto-practice/practice-runner.spec.ts` | 5 个单测覆盖结束条件 |

### 修改
| 文件 | 改动 |
|---|---|
| `src/admin-debug/admin-debug-chat.module.ts` | 加 `exports: [DebugSessionService]`（一行，让自动对练能复用调试管道；不影响手动调试） |
| `src/shared/infra/redis/redis.constants.ts` | 加 `QUEUE_NAMES.autoPractice` |
| `src/migration/index.ts` | 导出新 migration |
| `bin/ormconfig.ts` | import + migrations[] 登记新 migration |
| `src/app.module.ts` | import + imports[] 登记 AutoPracticeModule |
| `package.json` | 加 `seed:counselor-modes` / `seed:visitors-jsonl` 两个 script |

## 三、关键设计决策

### 1. 不新写对话循环，走端口复用
`PracticeRunnerService` 只依赖 `TURN_ENGINE_PORT`（Symbol 注入），生产实现 `DebugTurnEngineAdapter` 内部调 `DebugSessionService.createSession/runTurn/closeSession`。runner 不知道"会话存内存 Map"还是"落 JSON 文件"——将来 WP-B 做可复现性回放时，换一个端口实现即可，循环逻辑零改动。

### 2. 结束条件（4 条，按优先级）
1. **crisisDetected**：trace.crisis.detected=true → `crisis_ended`，立刻停
2. **来访复读**：连续 3 轮回复几乎一样（trimmed 全等，或长文前缀+长度相似）→ `stagnant`
3. **maxTurns**（默认 15）→ `completed`
4. **抛异常** → `failed`，finally 里仍 close 引擎会话

### 3. 7 种人设落 DB 不写死
`ap_counselor_modes` 表存 system prompt，admin 后台可增删改。seed 幂等 upsert（连跑两次第二次全 unchanged）。7 种：expert / intermediate / novice / chatty / cold / preachy / nonsense。

### 4. 批量走 BullMQ
`POST /batch` 按 characterSlugs × counselorModeIds × repeats 笛卡尔积入队，立即返回 batchId。Worker 并发 3（env `AUTO_PRACTICE_WORKER_CONCURRENCY` 可调），jobId 带 batchId+角色+模式+nanoid 去重。attempts=2，失败指数退避。

### 5. 可复现性 / 自动评测只留字段
- `ap_practice_sessions.model_version` / `seed_value` 两列本期只写不读（WP-B 用）
- 不做 rubric 断言（WP-E 的事）
- 逐字稿落在现有 debug-session JSON 文件里，场次表只存元数据指针

## 四、闸门数字

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| `npx eslint src/auto-practice test/auto-practice` | **0 error**（仅 import/order warning） |
| `npx vitest run test/auto-practice/practice-runner.spec.ts` | **5/5 passed** |
| `git diff --stat HEAD -- src/engine-core` | **空（engine-core 零改动）** |

## 五、与任务单的偏差及理由

1. **AdminDebugChatModule 加了一行 exports**：任务单说"不干扰现有手动调试"，加 `exports: [DebugSessionService]` 不改任何行为，只是把已存在的 provider 开放给新消费者。手动调试链路完全不受影响。

2. **WebSocket 不做 JWT 握手鉴权**：自动对练是 admin 内部工具，WS 推送的对话内容本来就在 admin 面板可见；写接口（HTTP）仍走 `AdminRoleGuard` + `AdminBasicAuthMiddleware`。将来对公网开放再补握手鉴权。已在 gateway 注释里写明。

3. **visitors.jsonl 导入是 best-effort 映射**：11 个角色按 case_id 前缀粗分 issueDomain、按 risk 映射 difficulty、script 列存整条 JSONL 原文。完整的 7 大块人格剧本拆解（basics/developmentalTimeline/...）留到来访池专项细化——本期目标是先把 11 个角色能被自动对练选到。

4. **咨询师模型用 `LLMTier.ADVANCED`**：env `AUTO_PRACTICE_COUNSELOR_MODEL` 可覆盖，未设则走 router 的 advanced 层默认模型。没新开一个 tier 枚举。

## 六、大炮要做的事

```bash
# 1. 跑 migration 建两张表
npx typeorm migration:run -d bin/ormconfig.ts   # 或 pnpm migration:run

# 2. 播种 7 种咨询师模式
pnpm seed:counselor-modes

# 3. 导入 visitors.jsonl 11 个角色
pnpm seed:visitors-jsonl

# 4. 起服务后试跑一场
curl -X POST http://localhost:3000/admin/api/auto-practice/sessions \
  -H "Content-Type: application/json" \
  -d '{"characterSlug":"<已有角色slug>","counselorModeId":"expert","maxTurns":10}'
```

## 七、commit message 草稿

```
feat(wp-d): AI 咨询师 × AI 来访者自动对练（批量跑 30+ 场验证引擎）
```

---

## 八、补记（2026-11-09）：端到端打通 + 五个真问题

初版只做到"接口能返回、DB 有记录"，前端实际是半成品（点「跑一场」后中栏只有三点 loading、左栏不出现新场次、必须反复点左侧 item 才看到内容）。本轮在真实浏览器 + 真实后端下逐项修掉并实跑验证。

### 8.1 两个根因（症状都是"WS 连上了但永远收不到事件"）

| # | 根因 | 修法 |
|---|---|---|
| A | `practice-runner.service.ts` 构造函数写 `@Optional() private readonly gateway: AutoPracticeGateway \| undefined`。参数类型带 `\| undefined` → TS 把 `design:paramtypes` 退化成 `Object` → Nest 按 `Object` 找不到 provider，**静默注入 undefined**，所以 runner 从不推事件 | 改为 `@Optional() @Inject(AutoPracticeGateway) private readonly gateway?: AutoPracticeGateway`（显式令牌 + 可选标记），并把该陷阱写进代码注释 |
| B | `vite.config.ts` 把 `/auto-practice` 整段（含 `ws:true`）代理给后端，连页面 GET 也被转发，`localhost:5174/auto-practice` 返回后端 JSON | 三处统一改到 `/ws/auto-practice`：vite 代理键、前端 `io({path})`、后端 `@WebSocketGateway({path})` |

### 8.2 前端数据模型重构（解决"必须反复点 item"）

- 以"轮"为唯一真相：`const turns = new Map<number, TurnRecord>()`，`messages / bdiHistory / currentTrace` 全部由 `rebuildFromTurns()` 派生，`mergeTurn()` 按 turnIndex 幂等覆盖。
- `hydrateSnapshot()` / `hydrateFromRest()` 把 debug-session 的扁平 `[{role,text,trace}]` 还原成轮次；**REST 快照与 WS 增量写同一份结构**，互不覆盖。
- `connect` 回调里既 `emit('subscribe')` 又 `hydrateFromRest()`，补断线期间漏掉的轮次。
- `startPractice()` 做**乐观插入**：请求返回即把 `pendingRow`（status running、turnCount 0）unshift 进列表，左栏立刻有条目，`syncSessions()` 拉到真记录后替换。

### 8.3 自然收尾（替代 30 轮硬结束）

- 咨询师每轮回复最后一行**必须**写状态标记：`[[STATE:END]]` / `[[STATE:MORE]]`（`CLOSE_DISCIPLINE` 拼在 system 末尾，判断标准偏向"该收就收"）。
- `closeRequested = raw.includes('[[STATE:END]]')`，两个标记都从正文剔除，不进对话文本。
- runner：`MIN_TURNS_BEFORE_CLOSE = 5`，满足则 `status=completed / exitReason=natural_close`，`maxTurns` 退化为上限保护。
- **踩坑**：`maxCompletionTokens` 必须从 300 提到 **500** —— 标记在回复最后一行，上限太小会把标记一起截掉，上层永远收不到结束信号。
- **踩坑**：初版用"可选标记 `[[END]]`"（只在想收尾时输出），实测两场都跑满 30 轮——模型默认认为对话还在继续，可选标记几乎不会输出。改成强制二选一才生效。

### 8.4 心跳与断链（专业方案，不以轮询为主通道）

- 服务端 gateway：`pingInterval: 25000` / `pingTimeout: 60000`，房间为空时打 `warn`（推不出去能被看见）。
- 客户端：`reconnection: true`、`reconnectionDelay: 1000`、`reconnectionDelayMax: 5000`、`reconnectionAttempts: Infinity`；监听 `connect / reconnect_attempt / connect_error / disconnect`，`wsStatus` 四态（绿=实时 / 黄脉冲=重连中 / 灰=离线）驱动指示灯。
- **实测**：`WebSocket transport close` → `reconnect_attempt #1..#13`（1s→5s 退避）→ `reconnect ok after 13 attempts`（约 1 分 15 秒，后端重启编译耗时占大部分）→ 新 socket id → **自动重新 `subscribed {roomSize:1}`**。
- **注意**：统计房间人数不能用 `this.server.in(room).sockets.size`（Socket.IO v4 的 `BroadcastOperator` 没有 `.sockets`，会 TS2339），必须走 `this.server.sockets.adapter.rooms.get(room)?.size`。
- 轮询（1500ms `syncSessions()`）保留，但只做**元信息同步**（左栏其它非选中场次的轮次/状态），WS 断开时才补拉消息快照。

### 8.5 另外三个真问题

1. **孤儿 running 场次**：进程重启带走循环但 DB 仍是 `running` → 前端显示一个永远不动也永不结束的幽灵场次。修：`PracticeRunnerService implements OnModuleInit`，启动时把 `status=running` 的批量置为 `failed / interrupted / 进程重启中断`。
2. **轮次不进 DB**：未选中场次一直显示 0 轮。修：主循环每轮 `sessionRepo.update(id, { turnCount })`。
3. **咨询师输出混入 markdown**（`**词**` 直接显示在对话气泡）。修：输出纪律补"不要用 markdown 符号，这是当面说话"。

### 8.6 实测记录（Chrome + 真实后端，admin/123456）

| 验收点 | 证据 |
|---|---|
| ① WS 实时抵达 | 点「跑一场」后中栏从"正在生成第一轮对话…"逐轮自动涨到 27 轮，全程未点任何左栏 item |
| ② 左栏实时 | 请求返回即出现 `running / 0 轮` 行，轮次随跑随涨，结束变 `completed 27 轮` |
| ③ 导出完整 | `auto-practice-DiTnh6R7IEA_SZV0elP0Z.json`：`characterSlug` / `counselorModeId` / `bdiHistory(27条)` 全部非空 |
| ④ 自然收尾 | `DiTnh6R7IEA_SZV0elP0Z \| completed \| turns=27 \| natural_close`；收尾话术完整（"今天先到这里…下次可以从这种被允许留下的体验继续"），来访者回应后结束 |
| ⑤ 心跳/断链 | 见 8.4 实测日志；`test/auto-practice/practice-runner.spec.ts` 7 tests 全过（新增 2 例 natural_close 用例） |

导出样本：`auto-practice-DiTnh6R7IEA_SZV0elP0Z.json`（27 轮 natural_close）、`auto-practice-f2pFyd3kxx_K1vMpeXp7q.json`（15 轮 max_turns）。

**已知未验证项**：`novice`（新手）模式下自然收尾尚未实跑——该 mode 的 system prompt 更倾向持续追问，可能仍跑满 `maxTurns`（属 `max_turns` 而非 bug）；若要新手模式也稳定自然收尾，需在 mode prompt 里补收尾引导。

