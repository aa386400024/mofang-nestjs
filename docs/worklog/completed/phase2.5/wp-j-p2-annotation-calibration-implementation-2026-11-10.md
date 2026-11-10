# WP-J P2 · 专业级标注工具 —— 实现交付记录（后端）

> 任务单：[`wp-j-p2-annotation-calibration-task-2026-11-10.md`](./wp-j-p2-annotation-calibration-task-2026-11-10.md)
> 日期：2026-11-10
> 基线 HEAD：`212611a`（分支 `integrate`）
> 状态：✅ 已交付（**后端 only**；前端三栏标注页由主 Agent 接）
> 范围声明：本单只做后端。**未碰** `admin-dashboard/`（主 Agent 的活）、**未碰** `src/engine-core/**` / `practice-runner.service.ts` / `counselor-agent.service.ts`（红线）。

---

## 一、改了哪些文件

### 新增（后端代码）

| 文件 | 职责 |
|---|---|
| `src/quality/quality-annotation.constants.ts` | 唯一词表来源：人工标签 5 值 / 列表状态 3 值 / 内核策略→标签映射 / 危机档位表 |
| `src/quality/quality-annotation.entity.ts` | TypeORM 实体（`@Entity('quality_annotation')`，15 列 + 3 索引） |
| `src/quality/quality-annotation-auto.ts` | **自动口径纯函数**：从逐字稿 trace 现算探索轮次 / 主导标签 / 危机档位 |
| `src/quality/quality-annotation-consistency.ts` | **一致性计算纯函数**：标签一致率 / 危机一致率 / 探索轮次 MAE |
| `src/quality/quality-annotation.view.ts` | 五个端点的出参类型（与前端 `types.ts` 严格 1:1） |
| `src/quality/dto/quality-annotation.dto.ts` | 保存入参 DTO（class-validator 校验） |
| `src/quality/quality-annotation.service.ts` | 服务层：列表 / 详情 / 保存 / 双盲揭示 / 一致性报告 |
| `src/quality/quality-annotation.controller.ts` | 五个 admin 端点 |
| `src/quality/quality-annotation.module.ts` | 模块装配（中间件 + class 级 guard + 实体注册） |
| `src/quality/quality-annotation.seed.ts` | 锚点清单 CSV 解析 + 幂等 upsert |
| `src/migration/1714900000041-CreateQualityAnnotations.ts` | 手写幂等 DDL 建表 |
| `bin/seed-quality-annotations.ts` | 锚点清单导入执行入口（独立 DataSource，`migrations: []` / `synchronize: false`） |

### 新增（测试）

| 文件 | 覆盖 |
|---|---|
| `test/quality/quality-annotation-auto.spec.ts` | 自动口径 11 例（探索轮次 / 主导标签 / 并列定序 / 危机档位 / 坏 trace） |
| `test/quality/quality-annotation-consistency.spec.ts` | 一致性 7 例（未标不算不一致 / 三指标 / 无可比返 null） |
| `test/quality/quality-annotation-seed.spec.ts` | 导入 5 例（真实 CSV 30 行 / 只导身份三列 / 幂等不覆盖人工标注 / 坏清单抛错） |
| `test/quality/quality-annotation-contract.spec.ts` | 契约 + 行为 12 例（端点清单 / guard 继承 / 模块注册 / 进度口径 / 只返台词 / 双盲闸门 / 保存覆盖） |

### 改动（登记点）

| 文件 | 改了什么 |
|---|---|
| `src/app.module.ts` | ① 顶部 import `QualityAnnotationModule`；② imports 数组注册 `QualityAnnotationModule`（`/admin/api/quality/*`） |
| `src/migration/index.ts` | 导出 `CreateQualityAnnotations1714900000041`（与 ormconfig 严格 1:1） |
| `bin/ormconfig.ts` | ① import；② `migrations[]` 数组登记 0041（**真注册点**，漏登记会静默不建表） |
| `package.json` | 新增 `"seed:quality-annotations": "tsx bin/seed-quality-annotations.ts"` |

### 明确**没有**碰

- `admin-dashboard/**`（前端归主 Agent；本次只**读**它的 `types.ts` / `client.ts` 对齐契约）
- `src/engine-core/**`（红线）、`src/auto-practice/practice-runner.service.ts`（红线）、`src/counselor/**/counselor-agent.service.ts`（红线）
- `src/admin-debug/**`（逐字稿只**读** `debug-session-store.ts` 的 `get()`，不改它）
- `scripts/ops/quality/visitor-quality-audit.ts`（只作为口径参照，不改）

---

## 二、五个端点的请求 / 响应 JSON 契约（前端照此对接）

> **路径前缀是 `/admin/api`**（不是任务单写的 `/admin`）—— 前端 `client.ts` 的 `BASE = '/admin/api'`，后台代理只转发 `/admin/api`。详见偏差 B2。
> **成功响应是裸对象**（不包 `{code,message,data}`）—— 全局 `BizExceptionFilter` 只包装**错误**响应；这与仓库既有 admin 端点（`GateTraceController`）同款，前端 `get/put` 直接 `r.json()` 即可。
> **错误响应统一形如**：```json
> { "code": 1002, "message": "标注记录不存在", "data": null }
> ```（HTTP 状态随 code：`InvalidParameter` → 400，`ResourceNotFound` → 404，`Forbidden` → 403，`Unauthorized` → 401）

### ① `GET /admin/api/quality/annotations?status=pending|done|all`

**请求**

| 位置 | 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| query | `status` | `'pending' \| 'done' \| 'all'` | 否 | 缺省 `pending`；**非法值 → 400**（不静默当"全部"） |

- `pending` = 人工主导标签为空的行；`done` = 已标的行；`all` = 全部
- `done` / `total` 是**全量口径**（不随 `status` 过滤变化）—— 前端左栏进度条靠它

**响应 200**

```json
{
  "items": [
    {
      "id": "b3f1c0de-6a54-4a1e-9d2c-7f0b5c1e9a10",
      "debugSessionId": "debug_37bt79fNG4jQHmHTYr-Lb",
      "characterSlug": "vpt_grief_avoidance_l1",
      "attachmentStyle": "avoidant",
      "firstExplorationTurn": null,
      "dominantLabel": null,
      "crisisPeakLevel": 0,
      "crisisFirstTurn": null,
      "shouldEndTurn": null,
      "needsReview": false,
      "durationMs": 0,
      "notes": null,
      "updatedAt": "2026-11-10T02:00:00.000Z"
    }
  ],
  "done": 0,
  "total": 30
}
```

- `items` 按**锚点清单顺序**（`anchor_order`）升序 —— 标注台是队列，顺序必须稳定
- `dominantLabel === null` = **待标**（前端 `pendingRows` 依此判定）
- `dominantLabel` 取值域：`recounting | resistance | simple_response | affective | cognitive_exploration`

### ② `GET /admin/api/quality/annotations/:id`

**请求**：路径参数 `id` = **标注记录 id**（即 ① 里的 `items[].id`，不是 `debugSessionId`）

**响应 200**

```json
{
  "row": { "id": "b3f1c0de-...", "debugSessionId": "debug_37bt79fNG4jQHmHTYr-Lb", "dominantLabel": null, "...": "同 ① 的行结构" },
  "messages": [
    { "role": "counselor", "text": "这周我总是睡不着……", "turnIndex": 1 },
    { "role": "visitor", "text": "……", "turnIndex": 1 }
  ]
}
```

- `messages` **只返双方台词**（`role` / `text` / `turnIndex`），**不返** `traces` / `kernelState` / `prompt`（隐私红线 AGENTS.md §5.4）
- 逐字稿缺失（文件不在）→ `messages: []`，**不报错**（归档场次仍可只标数值列）
- 错误：id 不存在 → `404` / `code 1002`

### ③ `PUT /admin/api/quality/annotations/:id`

**请求体**（全部字段可缺省；`null` 与"未标"等价）

```json
{
  "firstExplorationTurn": 3,
  "dominantLabel": "recounting",
  "crisisPeakLevel": 2,
  "crisisFirstTurn": 4,
  "shouldEndTurn": 7,
  "needsReview": false,
  "durationMs": 12345,
  "notes": "第 4 轮语气突变, 复听"
}
```

| 字段 | 类型 | 约束 | 缺省 |
|---|---|---|---|
| `firstExplorationTurn` | `number \| null` | 整数 ≥ 1 | `null` |
| `dominantLabel` | `AnnotationLabel \| null` | 5 选 1 | `null` |
| `crisisPeakLevel` | `number` | 整数 0~3 | 保持原值（初始 0） |
| `crisisFirstTurn` | `number \| null` | 整数 ≥ 1 | `null` |
| `shouldEndTurn` | `number \| null` | 整数 ≥ 1 | `null` |
| `needsReview` | `boolean` | — | `false` |
| `durationMs` | `number` | 整数 0~86 400 000 | 保持原值（初始 0） |
| `notes` | `string` | ≤ 2000 字 | 不传则不改 |

- **保存即覆盖**（一场一行，重标覆盖旧值，不堆历史）
- **标注人**由后端从请求身份取（basic 账号名 / 学员用户名）落 `annotator` 列，前端不用传
- 全局 `ValidationPipe` 是 `{ transform: true, whitelist: true }` —— **未声明的字段会被静默剥掉**
- 错误：id 不存在 → `404` / `code 1002`；字段越界 → `400` / `code 1001`

**响应 200**：与 ① 的 `items[]` 行结构**逐字相同**（含更新后的 `updatedAt`）

### ④ `GET /admin/api/quality/annotations/:id/reveal`（双盲揭示）

**请求**：路径参数 `id`

**响应 200**

```json
{
  "auto": {
    "explorationTurn": 4,
    "dominantLabel": "recounting",
    "crisisLevel": 1
  }
}
```

- `auto.dominantLabel` 取值域与人工一致（5 选 1），**`null` = 本场没有可映射的策略**（如全是 `request` / `insight`）
- `auto.crisisLevel` 0~3
- ⚠️ **双盲闸门**：**本场人工标签未保存 → `400` / `code 1001`**（`"本场还没保存人工标注, 不能揭示自动判定 (双盲口径)"`）。先看答案再点标签，这套校准就白做了

### ⑤ `GET /admin/api/quality/consistency`

**请求**：无

**响应 200**

```json
{
  "labeled": 12,
  "total": 30,
  "labelAgreement": 0.5833,
  "crisisAgreement": 0.9167,
  "explorationTurnMae": 1.25
}
```

| 字段 | 含义 | `null` 的含义 |
|---|---|---|
| `labeled` | 已标注场次（人工主导标签非空） | —— |
| `total` | 总场次 | —— |
| `labelAgreement` | 主导标签一致率 0~1 | 没有**可比**场次（自动侧无标签 / 未标注） |
| `crisisAgreement` | 危机档位一致率 0~1 | 没有可比场次 |
| `explorationTurnMae` | 探索轮次平均绝对误差 | 没有可比场次（两边都有值才参与） |

- ⚠️ **`null` 与 `0` 语义不同**：`0` = "比过了，完全不一致"；`null` = "还没法比"。前端别把 `null` 当 0 显示

---

## 三、关键设计决策（与任务单 / 仓库事实有出入的地方）

### B1 · CSV「后三列空」与仓库事实不符 → **只导身份三列**（保住双盲）

- **任务单怎么写的**（§1）：`anchor-sample-30.csv` 后三列（`first_exploration_turn` / `dominant_label` / `crisis_peak_level`）是空的。
- **仓库事实是什么**（实测 CSV 30 行 + 读生成脚本）：后三列**不是空的**，而是 `scripts/ops/quality/visitor-quality-audit.ts` 产出的**自动口径值** —— `dominant_label` 30 行**全是 `neutral`**，`first_exploration_turn` 只有 4/30 行有值，`crisis_peak_level` 有 0/1 值。
- **怎么改的**：seed **只导身份三列**（`debug_session_id` / `character_slug` / `attachment_style`）+ 清单顺序；标注列（`dominant_label` 等）一律留 `null`。
- **为什么**：CSV 里的自动值是**答案**。标注员打开就看到「主导标签 = neutral / 危机档 = 1」，再点标签就只是抄答案 —— 这套校准测的是"引擎准不准"，不是"人标得准"。双盲一旦破了，整个 WP-J P2 的结论作废。
- **顺带说明**：`neutral` 甚至不在人工词表里（人工词表是内核策略 5 值）—— 这也证明那套自动值跟人工标注**不同源**（见 B3）。

### B2 · 端点路径：任务单 `/admin/quality/*` → 实现 `/admin/api/quality/*`

- **任务单怎么写的**（§2.2）：`GET /admin/quality/annotations` 等。
- **仓库事实是什么**：主 Agent 已写好的前端 `admin-dashboard/src/api/client.ts` 里 `BASE = '/admin/api'`，五个方法拼出 `/admin/api/quality/annotations`；后台代理（vite）也只转发 `/admin/api`。
- **怎么改的**：controller 用 `@Controller('admin/api/quality')`。
- **为什么**：按任务单字面写，前端一调就 404 —— 而**前端契约已经定死了**（主 Agent 那边已落代码）。契约优先于任务单字面。

### B3 · 两套标签词表不能混 → 一致性报告用**策略口径**

- **仓库事实**：存在**两套**互不通气的词表：
  - 人工词表（前端 `AnnotationLabel`）：`recounting / resistance / simple_response / affective / cognitive_exploration` —— 对齐**内核策略枚举**；
  - 审计脚本词表（`visitor-quality-audit.ts` 的 `dominant_label`）：`approach / avoid / attack / appease / neutral` —— **文本关键词推断**。
- **怎么改的**：自动侧的主导标签改成**策略口径**（统计来访者各轮的**内核策略**，在 5 个人工标签对应策略里取众数），**不用**审计脚本那套文本词表。探索轮次与危机档位仍与审计脚本**同口径**（可复算）。
- **为什么**：拿"猜的"比"猜的"（文本词表 vs 人工点选）算一致率，数字没有意义 —— 两个词表的**取值域根本不相交**。策略口径则是"引擎判的"对"人判的"，这才是这次校准要测的东西。
- **并列定序**：众数并列时按 `ANNOTATION_LABELS` 的固定顺序取第一个（口径必须**可复算**，不能靠遍历顺序碰运气）。
- **不参与评选的策略**：内核另有 `request` / `insight` / `discussing_plans` 三个策略，人工词表里**点不出来**，所以不参与主导评选（否则就是拿一条标注员无法复现的规则打分）。

### B4 · 危机档位常量**独立复制**，不改 `practice-runner.service.ts`

- **任务单 / 红线**：`practice-runner.service.ts` 是红线禁区。
- **怎么改的**：`CRISIS_LEVEL_BY_CATEGORY` 在 `quality-annotation.constants.ts` 里**复制**一份（与该文件的 `CRISIS_LEVEL_BY_CATEGORY` 逐值同口径：0/1/2/3，未知类别 → 1 档）。
- **为什么**：不能 import 业务层（admin 读侧 import 业务层会把依赖方向搞浑），也不能改红线文件。**同源副本的代价**：两边改档位必须一起改 —— 已在本文件头写明。
- **注**：`crisisLevelOf` 已导出在 `practice-runner.service.ts`，但那是业务层函数且在红线文件里，本单不碰。

### B5 · 逐字稿只读 `data/debug-sessions`（store **不回落**归档目录）

- **任务单怎么写的**（§1）："逐字稿 JSON 可能在 `data/debug-sessions/`（57）或 `data/archives/debug-sessions-baseline-20261109/`（500）—— store 已处理路径解析"。
- **仓库事实是什么**（读 `debug-session-store.ts` 的 `resolveStoreDir` + 实测 30 场）：store **只读一个目录**（env `ADMIN_DEBUG_SESSION_DIR` 覆盖，缺省 `data/debug-sessions`），**没有**归档回落逻辑；30 个 anchor 会话 **30/30 命中** `data/debug-sessions/`，归档目录 **0 命中**。
- **怎么改的**：按任务单硬要求**复用 `DebugSessionStore.get(id)`**（不自扫目录），逐字稿缺失就返空数组 + 自动口径按空值计。
- **为什么**：本套锚点就在 `data/debug-sessions/`，复用 store 的读路径（它已经处理了会话 id 白名单校验与坏文件跳过）就够；自建目录扫描等于造第二个真相源。

### B6 · 新增 4 列（任务单 DDL 没有，前端契约有）

| 列 | 为什么加 |
|---|---|
| `anchor_order` INT | 标注台是**队列**。按主键（UUID）排序 → 每次刷新顺序都变，标到第 12 场不知道上次标到哪。CSV 行号落库，顺序就稳定了 |
| `crisis_first_turn` INT NULL | 前端 `AnnotationRow.crisisFirstTurn` 有这一列（任务单 DDL 漏了） |
| `needs_review` TINYINT | 前端 `AnnotationRow.needsReview` 有这一列 |
| `duration_ms` INT | 前端 `AnnotationSaveBody.durationMs` 有这一列（标注工时打点） |

### B7 · 主键用 `CHAR(36)` + 应用层 `randomUUID()`，**不用** `@PrimaryGeneratedColumn('uuid')`

- **仓库事实**：本仓库 **没有** `uuid` 依赖，而 TypeORM 的 `uuid` 生成策略在运行时 `require('uuid')` —— 启动即炸。
- **怎么改的**：`@PrimaryColumn({ type: 'char', length: 36 })` + `node:crypto` 的 `randomUUID()`（Node 内置，零新依赖）。

### B8 · `DebugSessionStore` 在本模块自建 provider，不 import `AdminDebugChatModule`

- **仓库事实**：`DebugSessionStore` 是 `AdminDebugChatModule` 的**私有** provider（未导出），而那个模块挂着聊天/引擎装配依赖。
- **怎么改的**：本模块 `providers` 里自建一个 `DebugSessionStore` 实例。
- **为什么**：为了一个**只读** store 拖进一整条链（且有循环依赖风险）不划算。自建实例**仍然是同一份读路径**（同一个类、同一个目录解析口径），只是不共享写队列（本模块只读）。

### B9 · reveal 的双盲闸门 = **人工主导标签非空**

- **怎么改的**：`row.dominantLabel === null` → `400` / `code 1001`。
- **为什么**：前端把 `dominantLabel === null` 当"待标"（`pendingRows`），闸门跟这个口径对齐才不会出现"前端说未标、后端却给了答案"的缝。

### B10 · 排序口径写在**代码**里，不靠 SQL 的 `ORDER BY`

- **怎么改的**：service 拿到行后在 JS 里按 `anchor_order` → `id` 排序。
- **为什么**：队列顺序是端点契约的一部分。口径写在代码里就不依赖任何一处实现（驱动 / ORM / 仓储替身）的排序行为。

### B11 · 内容不进 migration，走独立 seed 脚本

- **怎么改的**：migration 只建表（手写 DDL，幂等）；30 行锚点内容由 `bin/seed-quality-annotations.ts` 按 `debug_session_id` 幂等 upsert。
- **为什么**：仓库纪律（内容不进 migration，见 `AddCharacterProfiles1714900000023` / `AddPracticeScenarios1710000000015` 的先例）。

### B12 · seed **重跑不覆盖人工标注**

- **怎么改的**：upsert 只更新身份三列 + 清单顺序；标注列原样保留。
- **为什么**：大炮标了 20 场再重跑 seed，那 20 场不能被冲掉。幂等 ≠ 覆盖。

### B13 · 独立 admin 模块，不塞 `AdminDebugModule`

- **怎么改的**：新建 `src/quality/quality-annotation.module.ts`，沿用 `GateTraceModule` 的范式（中间件按控制器挂 + class 级 `AdminRoleGuard`）。
- **为什么**：`AdminDebugModule` 被 `EngineWiringModule` import（为了 `TraceRecorder`），往里塞新表依赖会让引擎装配层的依赖方向变浑。

---

## 四、闸门数字（本次自跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** |
| Lint | `npx eslint src/quality src/migration/1714900000041-CreateQualityAnnotations.ts bin/seed-quality-annotations.ts test/quality src/app.module.ts bin/ormconfig.ts src/migration/index.ts` | **0 error / 0 warning** |
| 全量测试 | `npx vitest run` | **Test Files 4 failed \| 157 passed \| 5 skipped (166)**；**Tests 4 failed \| 2657 passed \| 19 skipped (2680)** |
| 新增测试 | `npx vitest run test/quality` | **4 files / 35 tests 全绿** |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

### 4 个失败 = **基线既有失败，本次零新增**

任务单 §3 点名的"基线 4 failed admin-debug"逐条对上，且**全在 `test/admin-debug/**`，全在本次没碰的文件上**（本次未改动 `src/admin-debug/**` 任何一个文件）：

| # | 失败用例 | 根因（与本次无关） |
|---|---|---|
| 1 | `test/admin-debug/debug-session-persistence.spec.ts` → ② 超出 500 个 → 最旧的被自动删掉 | `DebugSessionStore.MAX_DEBUG_SESSIONS` 已是 500，测试仍按 50 断言 |
| 2 | `test/admin-debug/wp26-admin-role-guard.spec.ts` → ⑥ 全部端点的有效 guard 都含 AdminRoleGuard | `AdminDebugController` 的路由清单里有**重复的 `characters`**，断言是精确数组 |
| 3 | `test/admin-debug/wp30-admin-real-api.spec.ts` → ⑤ 4 个新端点都是 GET + guard | 同上（`characters` 重复导致端点数对不上） |
| 4 | `test/admin-debug/wp31-cost-board.spec.ts` → ⑤ 2 个新端点都是 GET + guard | 同上 |

**结论**：基线 4 failed，本次仍 4 failed，**新增 0**。

### ⚠️ 尚未验证的部分（等大炮在有库环境跑）

- `pnpm migration:run` 建表（DDL 幂等性、`SHOW CREATE TABLE quality_annotation`）
- `pnpm seed:quality-annotations` 导入 30 行（连跑两次应为"未变 30"）
- 五个端点的真库联调（鉴权 / 逐字稿读取 / 真实一致率数字）

原因：本机无 MySQL 实例，且仓库纪律是 migration / seed 由大炮在目标库执行。

---

## 五、部署顺序（大炮）

```bash
pnpm migration:run              # ① 建 quality_annotation 表（幂等）
pnpm seed:quality-annotations   # ② 导入 30 行锚点（只导身份三列；连跑两次应"未变 30"）
pnpm start                      # ③ 起服务（/admin/api/quality/* 就绪）
```

**前端接法**：主 Agent 的 `api.qualityAnnotation` 五个方法**不用改**（路径与字段已对齐），只需确认：
- 列表用 `row.id`（不是 `debugSessionId`）做详情 / 保存 / reveal 的路径参数；
- `reveal` 在**保存成功之后**才调（未标会拿 400）；
- `consistency` 的三个指标可能是 `null`（不是 0）。

---

## 六、Commit message 草稿（**不自动提交**，等大炮指令）

```bash
feat(wp-j-p2): 专业级标注工具后端 —— quality_annotation 表 + 五个 admin 端点 + 锚点清单幂等导入
```

---

_交付人：MCode（结对 AI）· 2026-11-10 · 基线 `212611a`_
