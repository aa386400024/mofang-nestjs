# WP30 · Admin Dashboard 切真 API · 交付记录

> 任务单：[`wp30-admin-dashboard-real-api-2026-11-05.md`](wp30-admin-dashboard-real-api-2026-11-05.md)（已随本记录移入 `completed/phase2/`）
> 交付日期：2026-11-05
> 边界：**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` = 空）· 心理内容**不进日志** · 所有端点走 admin 鉴权 · **不自动 commit/push**

---

## 一、交付摘要

把 admin-dashboard 的 **CharacterDetail**（角色详情）与 **SessionDetail**（会话详情）两个页面从 mock 数据切到真 API：

| 端点 | 作用 | 返回 |
|---|---|---|
| `GET /admin/api/characters/:slug` | 角色详情（引擎角色基线单行） | `slug / codename / attachmentStyle / baseline / resistance / enabled / **auditStatus** / fivePs / expressionStyle / sessionCount` |
| `GET /admin/api/characters/:slug/sessions` | 该角色的最近 20 场会话 | `[{ sessionId, visitorAlias, startedAt, endedAt, durationSec, status, totalTokens }]` |
| `GET /admin/api/sessions/:id/trajectory` | 本场剧本轨迹 | `{ scriptId, scriptName, currentNode, path[], triggered[] }`；本场无剧本 → `null` |
| `GET /admin/api/sessions/:id/memories` | 本场记忆 | `[]`（`training_sessions` 无 memories 列，见 §三 B5） |

前端同步切掉 4 处 mock（`admin-dashboard/src/api/client.ts`）+ 清掉页面上所有 mock 标识（`CharacterDetail.vue` 的"待接入真实 API (mock 数据)"提示、假记忆区块、`SessionDetail.vue` 里写死的 `m001 → 1` 轮次映射表）。

**关键取舍**（详见 §三 偏差表）：

- **轨迹端点今天原本拿不到数据** —— `turn_debug_trace` 的留痕契约里**没有**轨迹字段。补了留痕契约（`TurnTrace.trajectoryTrace`）+ 引擎适配器落值，新会话起有数据；老会话仍为空（不是 bug，是老数据）。
- **前端 `TrajectoryNode` 的 `label` / `type` 内核没有对应物** —— 在**适配层**（`src/admin-debug/trajectory-view.ts`）做单向翻译：类型按**幕序**派、名称按**后缀**派、触发时刻回查逐轮留痕、标题取仓库真静态剧本资产。
- **5Ps 字段名 DB 与前端不同** —— 按临床 5Ps 标准对应映射（vulnerability→predisposing、maintaining→perpetuating），映射表写进代码注释。
- **`auditStatus` 以 DB 真值为准** —— DB 是 `draft / approved / rejected`，任务单写的 `pending` 不存在；页面上的"待接入"提示随之删除。

---

## 二、文件清单

### 新增（2 个）

| 文件 | 行数量级 | 用途 |
|---|---|---|
| `src/admin-debug/trajectory-view.ts` | ~200 | 纯函数：内核 `TrajectoryTrace[]` → 调试面板轨迹视图（幕路径 / 已触发节点 / 类型 / 名称 / 触发时刻 / 剧本标题） |
| `test/admin-debug/wp30-admin-real-api.spec.ts` | ~500 | 17 例单测（4 个端点 + 角色过滤口径 + 404 + 守卫继承 + 映射口径） |

### 修改（后端 3 个）

| 文件 | 改什么 |
|---|---|
| `src/admin-debug/admin-debug.controller.ts` | 加 4 个 GET 端点 + `findCharacterSessions()` 私有方法（角色过滤口径**只有一份**） |
| `src/admin-debug/trace-recorder.service.ts` | `TurnTrace` 加**可选** `trajectoryTrace?: TrajectoryTrace`（内核出参透传，不改形状） |
| `src/engine-adapters/wiring/engine-stream-backend.adapter.ts` | `buildTurnTrace()` 带上 `result.trajectoryTrace`（没有剧本的会话字段整个不出现） |

### 修改（前端 6 个）

| 文件 | 改什么 |
|---|---|
| `admin-dashboard/src/api/client.ts` | `character()` / `characterSessions()` / `trajectory()` / `sessionMemories()` 4 处 mock → 真 fetch；`memories()` mock 保留（`MemoryBrowser.vue` 在用，属任务单 §2.4 的范围外） |
| `admin-dashboard/src/api/types.ts` | `CharacterSession.startedAt` 改 `string \| null`（后端列可空，类型说实话） |
| `admin-dashboard/src/views/CharacterDetail.vue` | 删 mock 标识注释 + 删"待接入真实 API (mock 数据)"提示 + `auditStatus` 直显后端真值 + 删记忆区块（连带清理 `memories` ref / `api.memories()` 调用 / `typeMeta` / `sortedMemories()` / `typeDistribution()` / 3 个未用 import） |
| `admin-dashboard/src/views/SessionDetail.vue` | 删写死的 `memoryTurnMap`（`m001 → 1` … 假 id 表）+ `memoriesForTurn` 死代码；点记忆改为只高亮（不再跳到一个**不相关**的轮次）；记忆行显示真实 `createdAt` |
| `admin-dashboard/src/i18n/locales/zh-CN.ts` | 删 `characterDetail.pendingRealApi` + `characterDetail.memories` 两条文案 |
| `admin-dashboard/src/i18n/locales/en.ts` | 同上 |

### 修改（既有单测 1 个）

| 文件 | 改什么 |
|---|---|
| `test/admin-debug/wp26-admin-role-guard.spec.ts` | 端点清单断言从 4 条扩到 8 条（新增 4 个端点自动继承 class 级 `AdminRoleGuard`） |

---

## 三、关键设计决策（与任务单的偏差表）

> 按 `docs/team/conventions.md` §2.5：先 grep 核实真实函数名 / 调用链 / 文件路径，再找企业级最佳方案，逐条登记。

| # | 任务单原文 | 实际做法 | 理由 |
|---|---|---|---|
| **B1** | §D5「轨迹/剧本节点端点——从 `turnDebugTrace` 里抽」 | **先补留痕契约再抽**：`TurnTrace` 加可选 `trajectoryTrace`，`buildTurnTrace()` 带上 `result.trajectoryTrace` | grep 核实：WP19-R 的 `TurnTrace`（`src/admin-debug/trace-recorder.service.ts`）字段 = `turnIndex / characterSlug / bdiSnapshot / renderSpec / llmUsage / crisis / ts` —— **没有轨迹字段**；`engine-stream-backend.adapter.ts` 的 `buildTurnTrace()` 也是显式挑字段。**留痕里今天没有轨迹数据**，端点写得再准也只能恒返空（= 假接口）。内核 `TurnRenderResult.trajectoryTrace` 本来就透传内核出参，只是没进留痕。**补一个可选字段**（追加不改名、老会话读出来没有这一项 = 老数据）比"端点恒空"诚实。⚠️ **老会话仍无轨迹** —— 需重新开一场对练才看得到 |
| **B2** | §2.2「`trajectory(sessionId)` —— 轨迹/剧本节点」；前端类型 `TrajectoryNode { nodeId, label, type, triggeredAt, description? }` | 新建 `src/admin-debug/trajectory-view.ts` 做**单向翻译**：`label` 按幕 id 后缀派（`_free`/`_event`/`_signal`/`_expand`/`_settle`）、`type` 按**幕序**派（0/1/2/3 → entry/crisis/branch/exit）、`triggeredAt` 回查逐轮留痕（第一次把该幕放进 `visitedNodeIds` 的那一轮）、`scriptName` 取 `ETHICAL_TRAJECTORY_SCRIPT_MAP` 的**真** `title`、`description` 取该幕 `referenceNotes[0]` | 内核 `TrajectoryTrace` 说的是**引擎语义**（哪一幕 / 游标 / 访问过哪些），面板要的是**督导语义**（这场戏走到哪 / 这一幕叫什么 / 什么时候触发）。两者字段几乎不重叠：**内核只有 `nodeId`，没有 label、没有触发时刻**。为什么类型按**幕序**而不按后缀：10 个伦理盲盒里第 2 幕有两个后缀（`_event` 与危机剧本的 `_signal`），按后缀会漏掉一个剧本；幕序天然对应叙事弧（开场→冲突→展开→收束）。认不出的后缀/幕序**退回 nodeId / `branch`，不编** |
| **B3** | §D2「角色详情 —— 角色基线 + 5Ps + 表达风格 + 会话数 + auditStatus」 | 5Ps 按**临床 5Ps 标准对应**映射：DB `presenting/vulnerability/precipitating/maintaining/protective` → 前端 `presenting/predisposing/precipitating/perpetuating/protecting` | `CharacterFivePs`（`character-profile.entity.ts`）的五个字段名与前端 `types.ts` 的 `fivePs` **对不上**。依据临床 5Ps 的通行对应：**易感 = predisposing**、**维持 = perpetuating**。不映射就会出现"后端有、前端读不到"（前端显示空白，运维以为角色没写 5Ps） |
| **B4** | §八 Q2「角色历史会话的『最近 N 场』，N 默认多少？建议 20」 | N = 20（`CHARACTER_SESSION_PAGE_SIZE`）；另设**扫描窗口 500 场**（`CHARACTER_SESSION_SCAN_LIMIT`） | `training_sessions` **没有角色列** —— 角色只存在于 `turn_debug_trace` 的 JSON 里（`characterSlug`），SQL 侧过滤嵌套 JSON 既慢又不可移植 → 口径是"按时间倒序取一段 → 内存逐场读留痕 → 挑出匹配"。内存过滤**必须有上限**（无上限 = 点开一个角色把全表拖进内存）。⚠️ **因此 `sessionCount` 是"扫描窗口内的场次数"，不是全量总数** —— 真要全量总数，得把角色 slug 提成 `training_sessions` 的一列（或加一张角色-会话索引表），属后续单 |
| **B5** | §D6 / §八 Q1「从 `training_sessions.memories` 字段抽；没有就返回空数组」 | **确认没有该列** → 端点立住，**恒返 `[]`** | 逐字核过 `TrainingSession` 实体（`src/counselor/entities/training-session.entity.ts`）：留痕在 `turn_debug_trace`、逐字稿在 `transcript`、技术统计在 `tech_stats` —— **没有 memories 列**。引擎的长时记忆落在 **Qdrant**（`qdrant-memory.store.ts`），按 (学员, 角色) 作用域召回，**没有"按会话列全量"的口径**；`MemoryStore` 端口只有 `remember` / `recall`，`recall` 是**语义召回**（按查询取 top-k），拿它冒充"本场记忆"会给运维一个"看起来有、实际是另一回事"的接口，且把记忆存储接进 `AdminDebugModule` 会**重现 WP58 刚解决的模块循环依赖**。故：端点先立住（前端契约稳定），数据源等记忆落 MySQL 再接 —— 登记为缺口 G1 |
| **B6** | §2.3「`auditStatus` 直接显示后端返回的 `auditStatus`（approved/rejected/**pending**）」 | 以 **DB 真值**为准：`draft` / `approved` / `rejected` | `CharacterAuditStatus`（`character-profile.entity.ts:111`）就是这三个值，DB 里**不存在 `pending`**。前端 `auditStatusClass` 的兜底分支（`default` → warn 色）本就覆盖 `draft` → 视觉无变化。页面上的"待接入真实 API (mock 数据)"提示随之**删除**（那正是 mock 标识，验收 §5.2 要求页面上没有） |
| **B7** | §D7「CharacterDetail 的 memories 区块 —— 先去掉（不补后端）」 | **照做**：区块整个删除 | 原来 `api.memories(props.slug)` 传的是**角色 slug**，而 `memories()` 的语义是按 **visitorId** 查 —— 传 slug 进去语义完全不对。宁可空着，不补一个错误语义的接口 |
| **B8** | §2.4「其他 mock（本 WP 不做，登记 backlog）」 | `memories()` / `psyguard()` / `costTrend()` / `weeklySessions()` / `dashboard()` **全部保留 mock** | `MemoryBrowser.vue` / `PsyGuardMonitor.vue` / `CostBoard.vue` / `Dashboard.vue` 这些页面还没接真 API（`MemoryBrowser.vue` 在用 `api.memories()`），且成本看板归 WP31。本单只切 CharacterDetail + SessionDetail 两页 |

### 3.1 其它实现口径（非偏差，但值得记）

1. **角色过滤口径只有一份**：`GET /characters/:slug`（算 `sessionCount`）与 `GET /characters/:slug/sessions` 共用 `findCharacterSessions()` —— 两份实现迟早会漂（改一处漏一处 = 页面上的"场次"和列表对不上）。
2. **学员隔离沿用既有 `ownerFilter`**：带 admin basic 凭据 → 不过滤（调试器要看全场）；带学员 JWT → 只看 `user_id = 自己`。与既有 `GET /sessions` 同口径。
3. **没有留痕的会话不归属任何角色**：角色只存在于留痕里 → `turn_debug_trace` 为空的会话在角色的会话列表里**看不到**（不是 bug，是"不知道它是谁"）。同理，生产默认关留痕（`ENGINE_DEBUG_TRACE_ENABLED` prod 缺省关）时角色会话列表会偏空。
4. **心理内容不进日志**：本单**没有新增任何日志**；4 个端点全是只读、无副作用。轨迹端点返回的 `referenceNotes` 是**剧本静态资产**（给督导看的结构化要点，不是台词、不是来访者内容）。
5. **前端契约不新造**：后端返回形状对齐前端 `types.ts` 既有类型（`CharacterDetail` / `CharacterSession` / `TrajectoryState` / `MemoryEntry`），只把 `CharacterSession.startedAt` 从 `string` 改成 `string | null`（后端列可空，类型说实话）。

---

## 四、接口契约（给前端 AI）

### 4.1 `GET /admin/api/characters/:slug`

```json
{
  "slug": "vpt_intimate_avoidance_l1",
  "codename": "晚晴",
  "attachmentStyle": "avoidant",
  "baseline": { "trust": 0.28, "resist": 0.42, "valence": -0.45, "arousal": 0.62 },
  "resistance": { "verbal": 0.42, "depth": 0.5, "style": 0.38 },
  "enabled": true,
  "auditStatus": "approved",
  "fivePs": {
    "presenting": "…", "predisposing": "…", "precipitating": "…",
    "perpetuating": "…", "protecting": "…"
  },
  "expressionStyle": { "speechVolumeBaseline": 0.42, "narrativeStyle": "disorganized", "expressionTone": "intellectualizing" },
  "sessionCount": 2
}
```

错误：`404` 角色不存在 / 已软删。

> ⚠️ `sessionCount` 是**扫描窗口（最近 500 场）内**该角色的场次数，**不是全量总数**。

### 4.2 `GET /admin/api/characters/:slug/sessions`

```json
[
  {
    "sessionId": "…", "visitorAlias": "晚晴",
    "startedAt": "2026-11-05T10:00:00.000Z", "endedAt": "2026-11-05T10:30:00.000Z",
    "durationSec": 1800, "status": "completed", "totalTokens": 150
  }
]
```

最多 20 条，按 `startedAt` 倒序。`startedAt` / `endedAt` 可为 `null`。

### 4.3 `GET /admin/api/sessions/:id/trajectory`

```json
{
  "scriptId": "ethical_romantic_confession",
  "scriptName": "来访者在会谈中表达情感依赖（移情边界）",
  "currentNode": "confession_event",
  "path": ["confession_free", "confession_event"],
  "triggered": [
    { "nodeId": "confession_free", "label": "自由开场", "type": "entry", "triggeredAt": "2026-11-05T10:00:00.000Z", "description": "此幕为自由开场：来访按一般主诉叙述…" },
    { "nodeId": "confession_event", "label": "伦理事件", "type": "crisis", "triggeredAt": "2026-11-05T10:05:00.000Z", "description": "此幕来访表达情感依赖…" }
  ]
}
```

本场**没有剧本** → `null`（前端不渲染轨迹面板）。会话不存在 → `404`。

> ⚠️ **只有留痕里带 `trajectoryTrace` 的会话才返得出内容** —— 老会话（留痕落在字段加进来之前）返 `null`。

### 4.4 `GET /admin/api/sessions/:id/memories`

当前恒返 `[]`（`training_sessions` 无 memories 列）。会话不存在 → `404`。

---

## 五、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error** |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| 测试 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **108 文件 / 1834 例全绿**（WP58 基线 107 / 1817 → 本轮 **+1 文件 / +17 例**，既有 1817 例零回归） |
| 内核红线 | `git diff --stat HEAD -- src/engine-core` | **空** |
| 边界断言 | `test/engine-core/boundary.spec.ts` | 11 条全绿（随全量 vitest 一起跑） |
| 前端类型 | `npx vue-tsc --noEmit -p tsconfig.app.json`（`admin-dashboard/`） | **6 处报错，全部是既有问题**，与本单改动无关（见下） |

> 闸门用 `vitest run --exclude '**/e2e/**/*.ts'`（= 仓库 `pnpm test` 口径）。不带 `--exclude` 会把 e2e 拉进来，e2e 要真 DB / Redis，本机跑不了。

### 5.1 前端 vue-tsc 的 6 处既有报错（**不是 WP30 引入**）

| 文件 | 行 | 报错 | 与 WP30 的关系 |
|---|---|---|---|
| `views/DebugChat.vue` | 424 | `Object.keys(...)` 收 `undefined` | 该段代码在 HEAD 里**逐字未改**（`git diff HEAD` 的 hunk 不含此行）→ WP58 前端接线那一版带来的既有问题 |
| `views/DebugChat.vue` | 536 | 模板里 `messages.value`（模板中 `messages` 已被自动解包） | 同上，HEAD 未改 |
| `views/ParamCalibrator.vue` | 397 / 478 | `noUncheckedIndexedAccess` 下的 `possibly undefined` | **WP30 未碰这个文件** |
| `views/SessionDetail.vue` | 100 | `beliefActivation` 的 `Record<string, number>` 推断不兼容 | 该 computed 在 HEAD 里**逐字未改**（WP57 待接的假数据块）→ 既有报错。`git diff HEAD -- admin-dashboard/src/views/SessionDetail.vue` 可证 WP30 只删了 `memoryTurnMap` / `memoriesForTurn` / 换了记忆行显示 |

> **本单改动的 6 个前端文件里，`client.ts` / `types.ts` / `CharacterDetail.vue` / 两个 i18n 文件零报错**。

### 5.2 单测覆盖清单（17 例）

| 组 | 例数 | 内容 |
|---|---|---|
| ① 角色详情 | 4 | 详情字段（含 `auditStatus`）/ 5Ps 映射 / 不存在 404 / 软删 404 |
| ② 角色历史会话 | 5 | 按 slug 过滤 / 无留痕不归属任何角色 / 学员隔离 / `sessionCount` 与列表同源 / 最多 20 条 |
| ③ 剧本轨迹 | 4 | 幕路径 + 类型 + 名称 + 触发时刻 / 无剧本返 `null` / 不存在 404 / 危机剧本 `_signal` 后缀也认 |
| ④ 本场记忆 | 2 | 返 `[]`（不是 404）/ 不存在 404 |
| ⑤ 守卫继承 | 2 | class 级 `AdminRoleGuard` 断言 / 8 个端点全是 GET 且有效 guard 含 `AdminRoleGuard` |

---

## 六、运维须知

### 6.1 无新 env 键

本单**不新增 env**，**不新增表**，**不新增列**（留痕契约的 `trajectoryTrace` 落在已有的 `turn_debug_trace` JSON 列里）。

### 6.2 已知边界

1. **老会话看不到剧本轨迹** —— 留痕落在 `trajectoryTrace` 字段加进来之前 → 返 `null`。需重新开一场对练。
2. **生产默认关留痕**（`ENGINE_DEBUG_TRACE_ENABLED` prod 缺省关）→ 生产的角色会话列表与轨迹面板**会偏空**。这是既有留痕开关的口径，不是本单引入的；要在线上看到角色会话，需开留痕。
3. **`sessionCount` 不是全量总数**（见 §三 B4）。
4. **本场记忆恒空**（见 §三 B5 / §七 G1）。
5. **5Ps 已返回但页面还没渲染** —— 后端给了 `fivePs` 五项真值，前端 `CharacterDetail.vue` 目前**没有 5Ps 卡片**（i18n key `characterDetail.fivePs` 等一直存在但没被用）。本单按任务单范围只做"去 mock + 改 auditStatus + 删记忆区块"，**不加新 UI** → 登记为后续项 R1。

---

## 七、遗留 / 后续建议

| # | 事项 | 归属 |
|---|---|---|
| **G1** | **本场记忆数据源** —— `training_sessions` 无 memories 列，长时记忆在 Qdrant（按作用域召回，无"按会话列全量"口径）。要真出数据，需给记忆落 MySQL 表（含 `source_session_id`）或补一个"按会话列记忆"的仓储端口 | 后续单（内存/存储层） |
| **R1** | `CharacterDetail.vue` 渲染 5Ps 卡片（后端已给真值，i18n key 已存在） | 前端 AI |
| **R2** | `SessionDetail.vue` 的 delta / cap / belief 三块仍是前端 mock（任务单 §四 只要求"确认数据显示正常"，**明确不在本单范围**）；`beliefActivation` 另有 1 处 vue-tsc 既有报错 | 后续单（内核需先对外逐轮明细） |
| **R3** | `sessionCount` 全量口径 —— 把角色 slug 提成 `training_sessions` 的一列，或加角色-会话索引表（顺带让 SQL 侧能直接过滤，省掉内存扫窗口） | 后续单（DB 层） |
| **R4** | 前端 `MemoryBrowser.vue` / `PsyGuardMonitor.vue` / `CostBoard.vue` / `Dashboard.vue` 的 mock（`memories()` / `psyguard()` / `costTrend()` / `weeklySessions()` / `dashboard()`） | WP31 / 后续单 |

---

_本记录由后端 AI 生成，遵循 `docs/team/conventions.md` §二 的交付格式。_
