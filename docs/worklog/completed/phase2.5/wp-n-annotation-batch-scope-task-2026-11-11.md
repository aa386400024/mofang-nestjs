# WP-N · 标注台批次化与按批标注闭环（企业级 · 后端专属规格）

> 状态：✅ 已交付（2026-11-11）· 交付记录：[wp-n-annotation-batch-scope-implementation-2026-11-11.md](wp-n-annotation-batch-scope-implementation-2026-11-11.md)
> 执行方：**MiniMax Code**（后端 only）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：本任务单 §1.2「已核对现状」表（全部为 2026-11-11 真库 / 真代码实查结果，不采信任何历史状态行）
> 任务性质：新功能（**admin 读侧 + 一张既有表的维度扩展**）· 不涉及引擎决策逻辑
> 改动范围：**仅后端** `src/**` `test/**` `bin/**` `scripts/**` `docs/**`。**禁止**动 `admin-dashboard/**`（前端批次下拉归前端流程，本单只交付契约）

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → 2. `docs/README.md` → 3. `docs/team/conventions.md`
   （**§1.1 分层归属 / §1.2 不写前端 / §1.3 命令规范（pnpm，禁裸 npx）/ §三 16 条硬约束**）
2. 阶段入口：`docs/worklog/README.md` → `docs/worklog/pending/phase2.5-README.md` + `phase2.5-wp-list-2026-11-08.md`
3. **必须精读的既有实现**（本单是在它们的延长线上改，不是另起炉灶）：
   - `src/quality/quality-annotation.service.ts`（队列 / 保存 / 双盲 / 一致性）
   - `src/quality/quality-annotation.entity.ts` + `1714900000041-CreateQualityAnnotations.ts`（表结构真相）
   - `src/quality/quality-annotation.seed.ts`（锚点 CSV 幂等导入的既有契约）
   - `src/quality/quality-annotation-auto.ts` + `quality-annotation-consistency.ts`（自动口径与一致率算法，**纯函数，本单不改算法**）
   - `src/auto-practice/practice-batch-health.service.ts`（批次聚合 + `_batches/*.json` 索引范式）
   - `src/admin-debug/debug-session-store.ts`（逐字稿读写路径 + `MAX_DEBUG_SESSIONS` 淘汰口径）
   - `docs/worklog/completed/phase2.5/wp-k-batch-regression-tracking-task-2026-11-11.md`
     （**本单沿用它的设计哲学：单一真相源 / fail-closed / 可归因 / incomparable 而不是硬比**）
4. 本任务单

---

## 1. 背景

### 1.1 问题

标注台现在**只能标一份写死的 30 场锚点清单**：队列来源是服务启动时读 `data/quality/anchor-sample-30.csv`，表里没有批次维度，端点里没有入队入口。

后果有三条，互相咬死：

1. **新跑的批次根本进不了标注台**。`p1d-r3-intake-2026-11-11` 的 16 场在库里、逐字稿也在，但没有任何路径把它们变成"可标的一行"。
2. **标注结论无法按批归因**。一致性报告把所有已标场次扔进同一个分母；一旦混入不同引擎版本的数据，算出来的数既不代表旧引擎也不代表新引擎。
3. **标注是消耗品**。逐字稿会被 `MAX_DEBUG_SESSIONS=500` 淘汰；淘汰后标注记录还在，但台词读不出来、自动对照算不出来，**且界面不报错**。

而经核实，那 30 场锚点本身来自 debug 期（2 个旧批次 20 场 + 3 场 + 7 场单场实时跑），已判定**不具校准价值**——本单不重标它们，只做三件事：标 legacy、隔离出分母、把队列改成"按批派生"。

### 1.2 已核对现状（2026-11-11 真库 / 真代码实查，勿当新问题）

| 事实                                                                                                                                                                                                                                                                     | 证据位置                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `quality_annotation` **实际 15 列**：`id / debug_session_id(唯一) / character_slug / attachment_style / anchor_order / 5 个人工列 / needs_review / duration_ms / annotator / notes / created_at / updated_at`。**无 batch_id / counselor_mode_id / turn_count / 版本列** | 真库 `SHOW COLUMNS`；entity 同构           |
| 队列**只有一条入口**：`onModuleInit` 读 CSV → `seedQualityAnnotations`                                                                                                                                                                                                   | `quality-annotation.service.ts:54-64`      |
| 端点只有 6 个（list / detail / save / reveal / auto / consistency），**无 POST 入队、无批次维度**                                                                                                                                                                        | `quality-annotation.controller.ts:61-120`  |
| CSV 是**一次性快照**：`valid` 按 turns 降序取前 30，扫单个目录，无批次概念                                                                                                                                                                                               | `visitor-quality-audit.ts:835`             |
| 那 30 场的批次归属：旧批次 A **20** 场 / 旧批次 B **3** 场 / **batch_id 为 NULL 的单场 7** 场                                                                                                                                                                            | 真库 join 实查                             |
| 30 场标注现状：`dominant_label` **30/30 填**（recounting 18 / simple_response 6 / resistance 4 / affective 2）；`first_exploration_turn` **仅 1 场填**；`crisis_peak_level` 全 0；`should_end_turn` **0 场填**；`notes` 3 条                                             | 真库实查                                   |
| 一致性报告的分母是**全量**（`rows.filter(dominantLabel !== null)`），无批次过滤                                                                                                                                                                                          | `quality-annotation.service.ts:190-203`    |
| `detail()` 读不到逐字稿时**静默返回空 messages**；`computeAuto()` 读不到时按 `crisisLevel: 0` 的空口径                                                                                                                                                                   | 同文件 `:108-115` / `:226-234`             |
| 逐字稿上限 `MAX_DEBUG_SESSIONS = 500`，`prune` 按 `createdAt` 保留最新 500 个                                                                                                                                                                                            | `debug-session-store.ts:148, 451-461`      |
| 当前逐字稿目录共 **76** 个文件（离上限还有空间，但 100 场级批次 ×3 就会顶到）                                                                                                                                                                                            | 实测                                       |
| 批次侧数据全齐：`ap_practice_sessions` 有 `batch_id / debug_session_id / character_slug / counselor_mode_id / turn_count / max_turns / engine_version / prompt_version / character_version / status / exit_reason`                                                       | `entities/practice-session.entity.ts`      |
| 批次索引已存在：`data/debug-sessions/_batches/<batchId>.json`，只有 id 与枚举，零台词（16 条）                                                                                                                                                                           | `practice-batch-health.service.ts:409-432` |
| `p1d-r3-intake-2026-11-11`：16 场、`valid=1`、零降级、`llm_call_ratio=1.0`、188 轮、指纹 `64fb2a967e401b5b`、**`engine_version = e3b0680-dirty`**                                                                                                                        | 真库 + 快照实查                            |
| 该批 16 场逐字稿 **16/16 在场**；`ap_practice_turns` **188 行**且 `visitor_semantic_json` 全非空                                                                                                                                                                         | 实测                                       |
| 角色依恋风格唯一来源：`character_profiles.template_id → attachment_style`                                                                                                                                                                                                | `visitor-quality-audit.ts:208`             |
| migration 现存最新 `1714900000046` 未占用；`0040` 有两个文件（历史遗留，本单不碰）                                                                                                                                                                                       | `src/migration/` 实查                      |

### 1.3 这次要解决的判定标准（先写清，避免做成"看起来能用"）

- **看得见**：给定一个批次，标注台能列出该批**全部可标场次**，未标的就是队列。
- **标得住**：标完的行带 `batch_id` 与**当时那批的 engine/prompt 版本**，日后能复算"这条结论对应哪版规则"。
- **读得回**：标注过的场次逐字稿被冻结留档，`500` 淘汰不影响回看与自动对照。
- **不混淆**：一致率**永不跨批、永不跨引擎版本**聚合；不可比时明确说"不可比"，不硬给数。
- **不越权**：不动引擎决策、不动前端实现、不动共享 store 的淘汰策略。

---

## 2. 设计原则（先看这段，再动代码）

1. **单一真相源**：批次维度只认 `ap_practice_sessions`（场次事实）+ `ap_practice_batches`（批次结论），**不新增一份"批次清单"表**；标注表只存"人工结论 + 归属标识"。
2. **读不写分离**：`GET` 一律纯读，**不允许"读时建行"**（写副作用埋在 GET 里，重试/并发会造脏数据）。行不存在时返回 `id: null` 的派生视图，首次 `PUT` 才落行。
3. **派生而非拷贝**：队列按批**派生**（`sessions LEFT JOIN annotation`），不把整批复制成标注行。
4. **fail-closed**：逐字稿缺失要**显式**标 `transcriptSource: 'missing'`，不允许静默当成"0 轮"；一致率在数据不足时给 `comparable: false` + 原因码，不给"自信的错数"。
5. **向后兼容**：`batchId` 省略时**行为与本单之前逐字一致**（现有前端页面不改也能跑）。
6. **不静默隐藏**：默认过滤掉无效批次，但必须在 `warnings` 里报出"隐藏了 N 个无效批次"，让人能主动打开看。
7. **可归因**：不一致必须能回答"变的是引擎、prompt，还是批次规格"，而不是只说"不一样"。

---

## 3. 范围

**在范围内：**

1. `quality_annotation` 加 **9 列**（6 个归属/版本列 + 3 个轮级标记列）+ 1 个索引；migration 手写 DDL、**双登记**。
2. 存量 30 行的 `batch_id` **回填**（按 `ap_practice_sessions` 反查；查不到的保持 NULL，**不许编造**）。
3. 新端点 `GET /admin/api/quality/batches`（可标注批次清单 + 各批可标/已标计数）。
4. `GET /admin/api/quality/annotations` 支持 `?batchId=`（按批派生队列）。
5. `GET/PUT` 的 `:ref` 支持 `标注行 id` 或 `debug_session_id`；`PUT` 对未建行做**幂等 upsert**。
6. `GET /admin/api/quality/consistency` 支持 `?batchId=`，并新增 `scope`（可比性守卫）。
7. 逐字稿**冻结留档**（首次保存时冻结；读路径**优先**冻结副本）+ 可选 CLI 预冻结。
8. API 契约文档（`docs/team/quality-annotation-batch-api-contract.md`）。
9. 测试（纯函数 + 契约 + 真库抽查）。

**明确不在范围内（禁止顺手做）：**

- **不改 `admin-dashboard/**`**（一行都不碰）。前端批次下拉由前端流程按本单契约实现。
- **不改 `src/engine-core/**`**（本单与引擎决策无关，`git diff --stat HEAD -- src/engine-core` 必须为空）。
- **不改 `MAX_DEBUG_SESSIONS`**、不改 `DebugSessionStore.prune` 的淘汰策略（那是共享读路径，改了会让 admin 调试页行为变化）。留档靠**冻结副本**，不靠改淘汰。
- **不改** `quality-annotation-auto.ts` / `quality-annotation-consistency.ts` 的**算法**（口径已与 audit 对齐，只加过滤与可比性守卫，不动计算）。
- **不改** `visitor-quality-audit.ts`（audit 脚本仍是"文本质量离线评测"，与标注台不同源）。
- **不删任何标注数据**（旧 30 行保留可追溯，只标归属、只排除分母）。
- **不做** 100 场级批次、不做第二家 provider 配置（那是批次编排，与本单无关）。
- **不做** 独立 `quality_annotation_turn` 轮级表（见 §4 D6 的取舍说明）。
- 不引入新依赖（手写守卫优先）。
- 不自动 `git commit` / `git push`。

---

## 4. 交付物

### D1 · 表结构扩展（migration 手写 DDL）

`src/migration/1714900000047-AddQualityAnnotationBatchColumns.ts`
**双登记**：`src/migration/index.ts` + `bin/ormconfig.ts`（漏一个 = "No migrations are pending" 静默不建列）。

`quality_annotation` 加列：

| 列名                | 类型               | 语义                                                                                |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `batch_id`          | `varchar(64)` NULL | 归属批次；NULL = 无法归属的历史单场（**不编造**）                                   |
| `counselor_mode_id` | `varchar(32)` NULL | 该场咨询师模式（批次内切片用）                                                      |
| `turn_count`        | `int` NULL         | 该场轮数（**派生时的快照值**，防后续表变更影响判读）                                |
| `engine_version`    | `varchar(64)` NULL | 该场 `git describe --dirty`（版本锁：结论对应哪版引擎）                             |
| `prompt_version`    | `varchar(64)` NULL | 该场 prompt 模板指纹（16 位 hex，或 `unknown`）                                     |
| `character_version` | `varchar(32)` NULL | 该场角色版本（与 WP-B 版本锁定对齐）                                                |
| `first_bad_turn`    | `int` NULL         | **轮级最小集**：从第几轮开始"不对"（离题 / 崩 / 共情缺失），NULL = 未标或整场无问题 |
| `bad_turns`         | `varchar(64)` NULL | **轮级最小集**：明确有问题的轮次清单，逗号分隔、最多 10 个、去重升序（校验后落库）  |
| `turn_note`         | `text` NULL        | 轮级说明（事实描述，**禁止写评分/等级**）                                           |

索引：`idx_quality_annotation_batch (batch_id)`。既有唯一索引 `debug_session_id` **保留不动**（一场一行）。

**存量回填（同一 migration 内，一条 UPDATE）**：

```sql
UPDATE quality_annotation qa
JOIN (SELECT debug_session_id, MAX(batch_id) AS batch_id FROM ap_practice_sessions
      WHERE batch_id IS NOT NULL GROUP BY debug_session_id) s
  ON s.debug_session_id = qa.debug_session_id
SET qa.batch_id = s.batch_id
WHERE qa.batch_id IS NULL;
```

- `character_slug` 已有，不回填；`counselor_mode_id / turn_count / 版本列` 历史行**允许保持 NULL**（"当时没记"是事实，不补假值）。
- migration 必须**可重复执行**（第二次跑 `migration:run` 报 "No migrations are pending"，不报错）。

### D2 · 可标注批次清单端点

`GET /admin/api/quality/batches`

```ts
// 响应（统一包与 WP-K 对齐）
{
  data: Array<{
    batchId: string;                 // 真批次 id（非合成值）
    createdAt: string | null;        // 批次首场 started_at 的最小值
    sessions: number;                // 该批场次数
    completedSessions: number;       // status = 'completed'
    annotatableSessions: number;     // 可进队列的场次（§下方判定）
    annotatedSessions: number;       // 已有人工标签（dominant_label 非 NULL）
    transcriptAvailableSessions: number; // 逐字稿仍在（冻结或活文件任一可取）
    valid: boolean | null;           // ap_practice_batches.valid；无批次行 → null
    validityFlags: string[];         // 拆开存储的逗号串；无 → []
    engineVersion: string | null;
    promptVersion: string | null;
    configFingerprint: string | null;
  }>;
  meta: { generatedAt: string; total: number };
  warnings: string[];                // 见下
}
```

**可标注判定（必须写成一个纯函数并在测试里钉死）**：

```
annotatable = status === 'completed'
           AND turn_count > 0
           AND debug_session_id 非空
           AND 逐字稿可获取（冻结副本 或 活文件）
```

**过滤与警告（不许静默）**：

- 默认**隐藏** `valid !== true` 的批次（含无批次行的旧批次），返回 `warnings: ['INVALID_BATCHES_HIDDEN:<n>']`；
- `?includeInvalid=1` 时全部返回，并在每条上给 `valid` / `validityFlags` 原值；
- 排序：`createdAt DESC`，`batchId ASC` 兜底（确定性）。

### D3 · 按批派生队列（list / detail / save）

**`GET /admin/api/quality/annotations?status=pending|done|all&batchId=<id>`**

- `batchId` **省略** → 与改造前**逐字一致**：只返回 DB 里已存在的行，`id` 恒非空。
- `batchId` **给定** → 返回该批**全部可标注场次**，`LEFT JOIN quality_annotation`；未建行的条目 `id: null`。
- 返回条目（在现有 `AnnotationRowView` 上**只增字段**，不改旧字段语义）：

```ts
{
  id: string | null; // null = 尚未落行（首次保存才建）
  debugSessionId: string; // 新增到视图（派生标识）
  characterSlug: string;
  attachmentStyle: string; // 由 character_profiles 反查，取不到 → 'unknown'
  counselorModeId: string | null;
  turnCount: number | null;
  // …既有 10 个字段原样保留…
  transcriptSource: 'frozen' | 'live' | 'missing';
}
```

- `done` / `total` 语义：**给了 batchId 时**按该批口径计；**不给时**保持全量口径（现有前端进度条不变）。
- 批内确定性顺序（代码里排，不靠 SQL，理由同现有 `sortByAnchorOrder` 注释）：`character_slug ASC → counselor_mode_id ASC → started_at ASC → practice_session_id ASC`；派生行的 `anchor_order` 写"批内序号"（1 起），历史行保持原 CSV 行号。

**`:ref` 解析（detail / save / reveal / auto 四个端点统一）**：

```
ref = 标注行 id（char(36) UUID）  或  debug_session_id
解析顺序：先按 id 命中 → 再按 debug_session_id 命中
```

- `GET /annotations/:ref` —— **纯读**。行不存在时按 `ap_practice_sessions` 反查拼派生视图（`id: null`），`debugSessionId` 在 `ap_practice_sessions` 里命中多行时取 `created_at` 最新的一行并 `warnings` 提示。
- `PUT /annotations/:ref` —— 行不存在时**幂等 upsert**：先从 `ap_practice_sessions` 取 `batch_id / counselor_mode_id / turn_count / engine_version / prompt_version / character_version` 落新行（同时补 `character_slug`、`attachment_style`、`anchor_order`），再写人工列。**唯一键仍是 `debug_session_id`**，重复 PUT 不产生第二行。
- `GET /annotations/:ref/reveal` / `/auto`：双盲纪律**不变**（`reveal` 仍要求先保存人工标签）。

### D4 · 一致性报告按批 + 可比性守卫

`GET /admin/api/quality/consistency?batchId=<id>`

```ts
{
  labeled: number; total: number;              // 口径：给了 batchId → 该批；不给 → 全量（兼容）
  labelAgreement: number | null;
  crisisAgreement: number | null;
  explorationTurnMae: number | null;
  scope: {
    batchId: string | null;
    sessions: number;
    engineVersions: string[];                  // 去重；含 null 时用 '<unknown>'
    promptVersions: string[];
    comparable: boolean;
    incomparableReasons: string[];             // 枚举码，见下
    warnings: string[];                        // 枚举码
  };
}
```

**不可比判定（任一成立 → `comparable: false`，并且数字**仍然返回**但必须能被前端横幅遮住）**：

| 原因码                       | 条件                                                 |
| ---------------------------- | ---------------------------------------------------- |
| `MIXED_ENGINE_VERSION`       | 该批 `engine_version` 去重 > 1                       |
| `MIXED_PROMPT_VERSION`       | 该批 `prompt_version` 去重 > 1                       |
| `NO_LABELED_SESSION`         | 该批 `labeled = 0`                                   |
| `TRANSCRIPT_MISSING_PARTIAL` | 该批存在 `transcriptSource === 'missing'` 的已标场次 |

**只告警不判不可比**：`SMALL_SAMPLE`（`labeled < 5`）、`ENGINE_VERSION_DIRTY`（`engine_version` 含 `-dirty`，说明基线来自脏工作区）。

> 设计依据：WP-K 的教训是"没有 incomparable 的工具会给出自信的错结论"。这里同理——跨引擎版本的标签一致率没有解释力。

### D5 · 逐字稿冻结留档（防 `500` 淘汰）

**冻结位置**：`data/quality/transcripts/<batchId>/<debugSessionId>.json`
（`batch_id` 为 NULL 的历史行 → `data/quality/transcripts/_unassigned/<debugSessionId>.json`）

**冻结时机**：

- **懒冻结**：`PUT` 保存成功后，若冻结副本不存在 → 从活 store 读一次原文**逐字节**写入冻结位置。写失败只 `warn`（`warnings: ['FREEZE_FAILED']`），**不阻断保存**。
- **预冻结 CLI**（可选但本单要求交付）：`bin/quality-freeze-batch.ts --batch <id> [--dry-run]`
  逐场冻结；输出 `{frozen, alreadyFrozen, missing}` 三个计数；`missing` 说明逐字稿在冻结前就已淘汰。
- 退出码：`0` 全部成功 ｜ `1` 有 missing ｜ `2` 参数错误。

**读路径（关键，决定标注能不能回看）**：

```
冻结副本存在 → 优先读冻结（'frozen'）
否则读活 store（'live'）
两者都没有 → 不再返回空 messages，改为 transcriptSource: 'missing' + warnings
```

- **不变更** `DebugSessionStore` 任何行为；冻结副本是**新增的独立读取源**，只由 `quality` 模块使用。
- 冻结副本**只存原始逐字稿**，不改内容、不裁剪；`0` 台词进日志。

### D6 · 轮级最小集（三个字段，不建表）

**取舍说明（写进交付记录）**：独立 `quality_annotation_turn` 表（逐轮标注）**本单不做**——当前连"整场满意"都还没有，逐轮精细标注投产出比不成立；先把"哪一轮开始崩"能记下来，就够给下一轮修判定提供定位。

- `first_bad_turn`：`null | 1..turn_count`；
- `bad_turns`：逗号分隔正整数，`≤10` 个、去重、升序、每个 `≤ turn_count`；非法 → `400`，**不静默丢弃**；
- `turn_note`：自由文本，`≤ 2000` 字（与 `notes` 同上限），**禁止**任何评分/等级语义（零压红线：自由练习无分数/无评级）。

这三列**参与** `done` 判定吗？**不参与**。`done` 仍只认 `dominant_label`（保持现有合同不变，避免进度条逻辑漂移）。交付记录里写明这一点。

### D7 · 测试

| 类别             | 必须覆盖                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 纯函数（批次）   | 可标注判定：各条件单独不满足时 `annotatable=false`；混合数据 → 计数正确；确定性排序两次相同                               |
| 纯函数（可比性） | 4 个 `incomparableReasons` 各造一组数据命中；`SMALL_SAMPLE` / `ENGINE_VERSION_DIRTY` 只进 warnings 不进 reasons           |
| 契约             | 6 + 2 个端点的路由清单存在、class 级 `AdminRoleGuard` 继承；`ref` 双解析（id / debugSessionId）；`batchId` 非法值 → `400` |
| upsert 幂等      | 同一 `debugSessionId` 连 PUT 两次 → 仍一行；第二次只改人工列，不改归属列                                                  |
| 读不写           | `GET /annotations/:ref` 未建行时**不产生 DB 行**（用计数断言前后相等）                                                    |
| 冻结读优先       | 临时目录造"冻结副本 + 活文件内容不同" → 断言读到冻结副本；两者都无 → `transcriptSource='missing'`                         |
| 向后兼容         | `batchId` 省略时返回集合与改造前一致（以现有 30 行为基准做快照断言）                                                      |
| 合规             | 一条断言：所有响应 JSON 里**不存在**逐字稿正文（用最大字符串长度 ≤ 200 这类结构性断言，防台词泄漏进契约）                 |

测试形态：纯函数单元测试 + 控制器契约测试（不起 Nest 容器则用既有 admin 契约测试范式）；**不做**需要真 LLM 的集成测试。

### D8 · API 契约文档（给前端流程）

`docs/team/quality-annotation-batch-api-contract.md`

必须写清：

1. 8 个端点的请求/响应 JSON（含可空性、单位、枚举值）；
2. **前端必须处理的三种态**：`id: null`（未落行）/ `transcriptSource: 'missing'`（逐字稿已淘汰）/ `scope.comparable: false`（不可比横幅）；
3. 批次下拉的取数方式（`GET /quality/batches`，默认不含无效批 + `INVALID_BATCHES_HIDDEN` 提示）；
4. **明确写：前端不需要也不许把 `batchId` 做成默认值**——不传 = 看历史全量，传 = 看某批，两种口径不能混。
5. 只写契约，**不写前端代码**。

---

## 5. 红线（违反即返工）

- **分层**：本单无纯决策计算，全部改动在 `src/quality/**`（admin 读侧）+ migration。`src/engine-core/**` **零改动**，`boundary.spec.ts` 不许改。
- **前端隔离**：`admin-dashboard/**` 一行都不碰；不跑 `vue-tsc` / `vite build`。
- **隐私**：逐字稿正文、`notes` / `turn_note` 内容**禁止**进日志、console、crash report；日志只打 `debugSessionId` / 计数 / 错误名。
- **零压红线**：轮级标记只允许事实描述；**任何**评分、等级、对错判定字段都不许加进本表。
- **不删数据**：旧 30 行保留；`quality_annotation` 不做软删、不做物理清理。
- **fail-closed**：逐字稿缺失 / 版本缺失 → 显式 `missing` / `null` / `unknown`，**不许**填 0 或空串冒充"正常"。
- **向后兼容**：`batchId` 省略路径的行为不许变（含 `done` / `total` 口径）。
- migration 双登记；`0040` 重号历史遗留**不碰**。
- 不自动 commit / push。

---

## 6. 闸门（填真实数字，禁止留空）

### 6.0 命令规范（强制）

- **一律 pnpm，禁止裸 npx**：`pnpm lint`（带缓存）/ `pnpm exec tsc -p tsconfig.build.json --noEmit` / `pnpm exec vitest run <file>` / `pnpm test`。
- Windows 上 stdout 常被吞：**先重定向到日志文件再读**，不要凭控制台输出判断成功。

### 6.1 日常内循环

- 单测：`pnpm exec vitest run test/quality`
- 定向：`pnpm test:changed`
- Lint：`pnpm lint`

### 6.2 收尾全量闸门（本单只跑一次）

| 闸门        | 命令                                            | 要求                         |
| ----------- | ----------------------------------------------- | ---------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | 0 error                      |
| Lint        | `pnpm lint`                                     | 0 error（记 warning 数）     |
| 测试        | `pnpm test`                                     | 全绿（记用例总数与基线对比） |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | **空**                       |
| 前端隔离    | `git status --short -- admin-dashboard`         | **空**                       |

### 6.3 真库 / 真实数据验收（必须逐条给输出）

| #   | 验收动作                                                               | 期望结果                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `pnpm migration:run`（真库）                                           | 9 列 + 1 索引建成；老行 `batch_id` 按 §D1 回填（20+3 有值、7 保持 NULL）；不报错                                                                                                            |
| A2  | 再跑一次 `pnpm migration:run`                                          | "No migrations are pending"（幂等）                                                                                                                                                         |
| A3  | `GET /quality/batches`                                                 | 含 `p1d-r3-intake-2026-11-11`：`sessions=16 / annotatableSessions=16 / annotatedSessions=0 / valid=true / engineVersion=e3b0680-dirty`；`warnings` 含 `INVALID_BATCHES_HIDDEN:<n>` 且 n ≥ 1 |
| A4  | `GET /quality/annotations?status=all&batchId=p1d-r3-intake-2026-11-11` | 返回 **16** 条，`id` 全为 `null`，`transcriptSource` 全为 `live` 或 `frozen`，顺序确定                                                                                                      |
| A5  | `GET /quality/annotations?status=all`（不传 batchId）                  | 返回 **30** 条，`id` 全非空（向后兼容证据）                                                                                                                                                 |
| A6  | 对 A4 里任一条 `PUT /quality/annotations/<debugSessionId>` 存一次      | 新建 1 行：`batch_id` 非空、`turn_count` / `engine_version` / `prompt_version` 与真库一致                                                                                                   |
| A7  | 同一场再 `PUT` 一次                                                    | 仍 1 行，`id` 不变；只改人工列                                                                                                                                                              |
| A8  | `GET /quality/annotations?status=all&batchId=p1d-r3-intake-2026-11-11` | 该条 `id` 非空、`annotatedSessions` 变 1（其余 15 条仍 null）                                                                                                                               |
| A9  | `GET /quality/consistency?batchId=p1d-r3-intake-2026-11-11`            | `scope.comparable=false` 且 reasons 含 `SMALL_SAMPLE` 只进 warnings；`labelAgreement` 有值                                                                                                  |
| A10 | `GET /quality/consistency`（不传 batchId）                             | 数字与改造前逐字一致（30 场口径）                                                                                                                                                           |
| A11 | `bin/quality-freeze-batch.ts --batch p1d-r3-intake-2026-11-11`         | `{frozen:16, alreadyFrozen:0, missing:0}`；`data/quality/transcripts/p1d-r3-.../` 下 16 个文件                                                                                              |
| A12 | 冻结后再 `GET /annotations/<已标那条的 ref>`                           | `transcriptSource='frozen'`，`messages` 条数与活文件一致                                                                                                                                    |

> A9 的期望值要**照实填**：`comparable` 的判定只看 4 个 reasons；`SMALL_SAMPLE` 是 warning。若你实现后 `comparable=true`，说明判定写错了，回头改代码而不是改期望。

### 6.4 前端产物闸门

**不适用**（本单不碰 `admin-dashboard`）。若发现 lint-staged 误扫前端目录，按模板 §2 隔离规则处理，**不为迁就后端规则改写前端文件**。

---

## 7. 交付记录

`docs/worklog/completed/phase2.5/wp-n-annotation-batch-scope-implementation-YYYY-MM-DD.md`

必须含：

1. 一句话总结；
2. **实际实现 vs 本规格**：偏差逐条列（原方案 / 实际方案 / 为什么）；**没有偏差就写"无偏差"**，不许省略本节；
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例数、全量基线对比）；
5. **§6.3 十二条验收的逐条输出**（含 A3、A4、A9 的实际 JSON 片段——**只贴计数与枚举，不贴台词**）；
6. 冻结留档实测：文件数、字节数、`frozen/alreadyFrozen/missing` 计数；
7. 风险与回归：现有 30 行有无被影响（前后快照对比）、`batchId` 省略路径是否逐字一致；
8. 遗留项（如：`engine_version` 带 `-dirty` 说明基线来自脏工作区，正式基线需 clean tree 重跑）；
9. 确认未碰 `engine-core` / `admin-dashboard`。

---

## 8. 【交付回写清单】做完逐项勾选，不许跳

- [x] 交付记录写到 §7 路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 `✅` 并链交付记录
- [x] 回写 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四「独立单」表（WP-N 行已有，本单**就地更新为 ✅ + 交付记录/契约链接**，不重复新增行；见交付记录偏差表）
- [x] 回写 `docs/worklog/pending/phase2.5-README.md` §3「当前有什么活」
- [x] 回写 `docs/worklog/README.md` §0 Phase2.5 那一行（把"30 场锚点标定"口径改为"已判定 debug 期数据不可用，改按批标注"）
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] `git status --short -- admin-dashboard` 为空 —— ⚠️ **实测非空**（3 个文件：`src/api/client.ts` / `src/api/types.ts` / `src/views/AnnotationTool.vue`），来自**并行前端任务 WP-N-FE**；本单未碰 `admin-dashboard/**` 一行，详见交付记录 §二 偏差表与 §九确认
- [x] 提交分组核对：本单文件（后端 / migration / 文档）各自成组，不混并行产物
- [x] 给一行 commit message 草稿：`feat(wp-n): 标注台按批派生队列 + 逐字稿冻结留档 + 一致率可比性守卫`（**不自己提交**）

---

## 9. 回复输出约定

1. 「已写入交付记录」+ 路径（不重复贴全文）；
2. 闸门真实数字（tsc / lint / vitest / boundary / engine-core diff）；
3. §6.3 十二条验收的**通过 / 未通过**清单（未通过要写原因）；
4. 偏差表要点（尤其是若你判断本规格某条在代码里做不到，直接说，不要静默降级）；
5. 不贴 diff 全文、不贴任何台词。

---

## 10. 给执行者的三个提醒（踩过的坑）

1. **`GET` 里不要建行**。你很可能想"读的时候顺手把派生行插进去省事"——那会让并发 list 造出重复行、让审计找不到"这条是哪来的"。`PUT` 才写。
2. **`batchId` 省略路径就是兼容契约**。改这条等于让现有标注页静默变样，属于回归。
3. **冻结副本是唯一安全的留档手段**。改 `MAX_DEBUG_SESSIONS` 看着更"优雅"，但那是共享读路径，会连带改掉 admin 调试页的淘汰行为——本单明令禁止。
