# WP-N · 标注台批次化与按批标注闭环 —— 交付记录

> **任务单**：[wp-n-annotation-batch-scope-task-2026-11-11.md](wp-n-annotation-batch-scope-task-2026-11-11.md)（已从 `pending/` 移入 `completed/phase2.5/`）  
> **执行方**：MiniMax Code（后端 only） · **日期**：2026-11-11 · **分支**：`integrate`  
> **API 契约**：[docs/team/quality-annotation-batch-api-contract.md](../../../team/quality-annotation-batch-api-contract.md) · **前端**：[WP-N-FE 交付记录](../wp-n-fe-annotation-batch-ui-implementation-2026-11-11.md)

---

## 一、一句话总结

`quality_annotation` 加 9 列 + 1 索引（手写 DDL、双登记、存量 23 行回填），标注台从「服务启动时读 `data/quality/anchor-sample-30.csv` 的写死队列」改成**按批派生队列**（场次 LEFT JOIN 标注行，未建行 `id: null`），新增批次清单端点、一致性 `scope` 可比性守卫、逐字稿冻结留档（防 `MAX_DEBUG_SESSIONS=500` 淘汰）与轮级最小集三列，**旧 30 行零改动保留**。

## 二、实际实现 vs 本规格（偏差逐条）

| #   | 原方案（任务单）                             | 实际实现                                                                                                                                                                            | 原因                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §6.3 A9 期望 `scope.comparable = false`      | **`comparable = true`**，`incomparableReasons: []`，`warnings: ["SMALL_SAMPLE","ENGINE_VERSION_DIRTY"]`                                                                             | §D4 的判定表把 `comparable=false` **只**绑定 4 个 reasons（`MIXED_ENGINE_VERSION` / `MIXED_PROMPT_VERSION` / `NO_LABELED_SESSION` / `TRANSCRIPT_MISSING_PARTIAL`），并单列「只告警不判不可比：`SMALL_SAMPLE` / `ENGINE_VERSION_DIRTY`」；§6.3 脚注亦写「`comparable` 的判定只看 4 个 reasons；`SMALL_SAMPLE` 是 warning」。该批 engine/prompt 版本各自唯一、`labeled=1≠0`、无已标场次缺逐字稿 ⇒ 4 个 reasons 全不命中 ⇒ `comparable=true`。判定表与脚注一致，§6.3 表格单行的 `comparable=false` 与二者自相矛盾。**按判定表实现，未改判定逻辑去迎合单行期望值** |
| 2   | §D8 要求写「8 个端点」                       | **7 条 HTTP 路由 + 1 个 CLI**                                                                                                                                                       | §D2–D4 枚举的 HTTP 路由只有 7 条（list / detail / PUT / reveal / auto / consistency / batches）；第 8 个理解为 §D5 明确要求交付的 `bin/quality-freeze-batch.ts`。未虚构第 8 条 HTTP 端点，契约文档按「7 路由 + 1 CLI」写                                                                                                                                                                                                                                                                                                                                       |
| 3   | §D3 路由参数名 `:ref`                        | 控制器参数名由 `:id` 改为 `:ref`                                                                                                                                                    | §D3 把四个路由的参数语义扩展为「标注行 id **或** `debug_session_id`」，`:id` 已名不副实。**URL 形状不变**（`/annotations/:ref`），既有契约测试的路由清单断言同步机械改名，其余断言未动                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | §2 原则 5 / §D3「`batchId` 省略 ⇒ 逐字一致」 | 读作**加法**：既有 13 个行字段的取值 / 集合 / 顺序与 `done`/`total` 口径不变；新增字段（`debugSessionId` / `transcriptSource` / `warnings` / `batchId` 等）在**所有**路径上追加返回 | §D3 明写「在现有 `AnnotationRowView` 上**只增字段**」；§D7 向后兼容项写的是「返回集合一致」而非「字节级相同 JSON」。按字节级解读则新增字段无法在无 `batchId` 路径返回，与 D2/D3 自相矛盾                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | §8 回写：§四「独立单」表**新增一行**         | **就地更新**既有「标注台批次维度后端（WP-N）」行（🚧 → ✅）                                                                                                                         | 并行前端任务 WP-N-FE 已先在 §四 建了该行；再加一行会出现同一交付两行重复。已在任务单 §8 清单里注明                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | 简报「旧 30 行保留并**隔离出分母**」         | 全量口径下**分母仍是 30 行**，隔离只发生在**按批口径**                                                                                                                              | §D4 与 §6.3 A10 明确要求不传 `batchId` 时数字与改造前**逐字一致**（`total=30`），§2 原则 5 同。若在全量口径排除 legacy 行，A10 与向后兼容契约同时失效。23 行 legacy 已带 `batch_id`（指向两个无效批），按批取数天然不覆盖它们                                                                                                                                                                                                                                                                                                                                  |
| 7   | §D3 视图字段                                 | `id: string → string                                                                                                                                                                | null`、`updatedAt: string → string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | null` | 派生队列下未落行条目 `id` 必为 null（§D3 明写）；派生行无 `updated_at`。既有路径 `id` 恒非空，既有前端不使用 `updatedAt` |
| 8   | §D7 契约测试形态                             | 既有 `test/quality/quality-annotation-contract.spec.ts` 的 setup 需适配新构造函数签名（新增 `batchService` 依赖）与路由参数改名                                                     | 补 `StubBatchService` 与新断言；**既有断言逻辑一字未改**，仅路由清单的 `:id` → `:ref`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | §D5 冻结读路径                               | 额外支持 `_unassigned` 目录回退（批次归属确定前冻结的历史行仍可读）                                                                                                                 | §D5 已规定 `batch_id` 为 NULL 的历史行落在 `_unassigned/`；回退是让「先冻结、后归属」的行不丢                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

> **除上表 9 条外，D1–D8 无其它偏差。**

## 三、改动文件清单

### 新建

| 文件                                                              | 用途                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/migration/1714900000047-AddQualityAnnotationBatchColumns.ts` | 手写 DDL：9 列 + `idx_quality_annotation_batch` + 存量 `batch_id` 回填（`MAX(batch_id)` + `GROUP BY`，幂等可重跑，`down` 回滚列与索引） |
| `src/quality/quality-annotation-batch.ts`                         | 批次纯函数层：可标注判定、批内确定性排序、版本去重、可比性评估、`bad_turns` 解析与格式化（零 IO、零框架）                               |
| `src/quality/quality-transcript-freeze.ts`                        | 逐字稿冻结留档：写冻结副本、读时冻结优先、`_unassigned` 回退、`transcriptSource` 判定                                                   |
| `src/quality/quality-annotation-batch.service.ts`                 | 场次 / 批次 / 角色事实读取 + 派生队列装配 + 逐字稿来源判定 + 冻结调度（`QualityAnnotationService` 不再直接依赖 `DebugSessionStore`）    |
| `bin/quality-freeze-batch.ts`                                     | 批次预冻结 CLI：`--batch <id> [--dry-run]`，输出 `{frozen, alreadyFrozen, missing}`，退出码 0 / 1 / 2                                   |
| `docs/team/quality-annotation-batch-api-contract.md`              | 前端契约：7 路由 + CLI 的请求 / 响应 JSON、字段表、三种必处理态、批次下拉取数、明确「不许把 `batchId` 做成默认值」                      |
| `test/quality/quality-annotation-batch.spec.ts`                   | 批次纯函数单测（27 例）                                                                                                                 |
| `test/quality/quality-annotation-batch-contract.spec.ts`          | 批次端点契约单测（17 例）                                                                                                               |

### 修改

| 文件                                               | 用途                                                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/migration/index.ts`                           | 登记 `1714900000047`（双登记之一）                                                                                                                                                                 |
| `bin/ormconfig.ts`                                 | 登记 `1714900000047`（双登记之二，漏登记 = 静默不建列）                                                                                                                                            |
| `src/quality/quality-annotation.entity.ts`         | 同步 9 列 + `@Index('idx_quality_annotation_batch', ['batchId'])`                                                                                                                                  |
| `src/quality/quality-annotation.constants.ts`      | 新增枚举与阈值：可比性原因码 / 告警码 / `TRANSCRIPT_SOURCE` / `CONSISTENCY_MIN_SAMPLE=5` / `BAD_TURNS_MAX=10` / `TURN_NOTE_MAX=2000` / 轮级禁用词表（评分 / 得分 / 等级 / 对错…）                  |
| `src/quality/quality-annotation.service.ts`        | 重写：`list`（全量 / 按批两条路径）、`detail`、`save`（幂等 upsert + 懒冻结）、`reveal`、`auto`、`consistency`（带 `scope`）、`batches`；`:ref` 双解析；轮级列写入与校验（非法 → 400，不静默丢弃） |
| `src/quality/quality-annotation.view.ts`           | 视图类型：`id` / `updatedAt` 可空 + 12 个新增字段；新增批次清单与一致率 scope 视图                                                                                                                 |
| `src/quality/dto/quality-annotation.dto.ts`        | 新增 `firstBadTurn` / `badTurns` / `turnNote`                                                                                                                                                      |
| `src/quality/quality-annotation.controller.ts`     | 重写为 7 条路由；`status` / `batchId` / `includeInvalid` 非法值一律 400                                                                                                                            |
| `src/quality/quality-annotation.module.ts`         | 注入 `PracticeSession` / `PracticeBatch` / `CharacterProfile` 仓储 + `QualityAnnotationBatchService` + `QualityTranscriptFreeze`（工厂注入 `DebugSessionStore`）                                   |
| `test/quality/quality-annotation-contract.spec.ts` | 适配新构造函数与路由参数（见偏差表 #8）                                                                                                                                                            |
| `.gitignore`                                       | **新增** `data/quality/transcripts/`：冻结副本含逐字稿原文（心理内容），沿用 `data/debug-sessions/` 的既有约定「绝不进版本库」                                                                     |

### 删除

无（未删任何标注数据，未动任何既有标注行的人工列）。

### 运行时产物（非代码，不进版本库）

- `data/quality/transcripts/p1d-r3-intake-2026-11-11/*.json` —— 16 个冻结副本，已被 `.gitignore` 覆盖。
- 真库新增 1 行 `quality_annotation`（A6/A7 验收产生）：`id=b4e595f4-80f0-44f6-ac37-da37f28b25b3`、`debug_session_id=debug_tLyV8twfqNdwbdsApRhB5`、`batch_id=p1d-r3-intake-2026-11-11`、`dominant_label=resistance`、`annotator=wp-n-acceptance-2`（**合成验收标注人**）。

## 四、闸门（真实数字）

| 闸门        | 命令                                            | exit code | 真实结果                                                                                                                                                                               |
| ----------- | ----------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **0**     | 0 error                                                                                                                                                                                |
| Lint        | `pnpm lint`                                     | **0**     | **0 error / 2 warning**（2 条均为 `import/order`，位于 `src/auto-practice/metrics/batch-metrics.service.ts`——**本单未碰该文件**，属既有告警）                                          |
| 全量测试    | `pnpm test`                                     | **0**     | **181 文件（180 passed + 1 skipped）/ 2945 例（2941 passed + 4 skipped）/ 0 failed**，耗时 87.15s                                                                                      |
| 定向测试    | `pnpm exec vitest run test/quality`             | **0**     | **7 文件 / 95 例全绿**（本单新增 2 文件 44 例：纯函数 27 + 契约 17）                                                                                                                   |
| migration   | `pnpm migration:run`（首次 / 二次）             | **0 / 0** | 首次建成 9 列 + 1 索引并回填；二次报 `No migrations are pending`（幂等）                                                                                                               |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | **0**     | **空**（零改动）                                                                                                                                                                       |
| 前端隔离    | `git status --short -- admin-dashboard`         | 0         | **3 个文件 modified**：`src/api/client.ts` / `src/api/types.ts` / `src/views/AnnotationTool.vue` —— 全部来自**并行前端任务 WP-N-FE**，本单对 `admin-dashboard/**` **零改动**（见 §九） |

> 全量基线对比：2026-11-10 记录的基线为「179 文件 / 2863 例全绿」；本次 **181 文件 / 2945 例**，其中本单净增 2 个 spec 文件、44 例新用例，其余增量来自并行任务的用例增补。**0 failed**，无回归。

## 五、§6.3 十二条真库验收逐条输出

> 只贴计数与枚举，不贴任何台词。

**A1 `pnpm migration:run`（真库）** → exit 0。9 列 + `idx_quality_annotation_batch` 建成；回填 **23 行有 `batch_id`**（`YiBgpQSxbQh_q663IiVbT` 20 行 + `gzu9tnrBuXzztNMizliYh` 3 行），**7 行保持 NULL**（查不到批次，按 D1「不许编造」留空）。

> 过程记录：首次执行因 `engine_version` 列 COMMENT 的 DDL 少一个右引号报 `ER_PARSE_ERROR`，当时已提交 3 列；补正后重跑，幂等逻辑跳过已建列，第二次 `migration:run` 报 `No migrations are pending`。最终结构完整，无残留半成品。

**A2 再跑一次 `pnpm migration:run`** → `No migrations are pending`，exit 0（幂等 ✅）。

**A3 `GET /admin/api/quality/batches`** → 目标批条目：

```json
{
  "batchId": "p1d-r3-intake-2026-11-11",
  "sessions": 16,
  "completedSessions": 16,
  "annotatableSessions": 16,
  "annotatedSessions": 0,
  "transcriptAvailableSessions": 16,
  "valid": true,
  "validityFlags": [],
  "engineVersion": "e3b0680-dirty",
  "promptVersion": "f1fdb4f90a5e622a",
  "configFingerprint": "64fb2a967e401b5b"
}
```

`warnings: ["INVALID_BATCHES_HIDDEN:12"]`（真库共 18 个批次：6 个 `valid=true` 默认可见、12 个被隐藏）；`?includeInvalid=1` 返回全部 18 条并给出各自 `valid` / `validityFlags` 原值。✅

**A4 `GET /quality/annotations?status=all&batchId=p1d-r3-intake-2026-11-11`** → **16 条**，`id` **全为 null**，`transcriptSource` 全为 `live`（冻结前），顺序确定（`character_slug → counselor_mode_id → started_at → practice_session_id`），两次请求顺序一致。✅

**A5 `GET /quality/annotations?status=all`（不传 batchId）** → **30 条**，`id` **全非空**（向后兼容证据）。✅

**A6 `PUT /quality/annotations/<debugSessionId>`（对 A4 任一条）** → 表行数 **30 → 31**，新行归属列与真库一致：

```json
{
  "batch_id": "p1d-r3-intake-2026-11-11",
  "counselor_mode_id": "expert",
  "turn_count": 12,
  "engine_version": "e3b0680-dirty",
  "prompt_version": "f1fdb4f90a5e622a",
  "character_version": "1.0.0",
  "dominant_label": "resistance",
  "anchor_order": 1
}
```

✅

**A7 同一场再 `PUT` 一次** → 仍 **31 行**，`id` 不变（`b4e595f4-80f0-44f6-ac37-da37f28b25b3`）；归属列 `turn_count=12` / `engine_version=e3b0680-dirty` / `prompt_version=f1fdb4f90a5e622a` **未变**，仅人工列 `dominant_label` 变化（幂等 upsert）。✅

**A8 重跑 A4 的 GET** → 仍 **16 条**，其中该条 `id` **非空**，批次计数 `annotatedSessions = 1`、`done = 1`、`total = 16`，其余 15 条 `id` 仍为 null。✅

**A9 `GET /quality/consistency?batchId=p1d-r3-intake-2026-11-11`** →

```json
{
  "labeled": 1,
  "total": 16,
  "labelAgreement": 0,
  "crisisAgreement": 1,
  "explorationTurnMae": null,
  "scope": {
    "batchId": "p1d-r3-intake-2026-11-11",
    "sessions": 16,
    "engineVersions": ["e3b0680-dirty"],
    "promptVersions": ["f1fdb4f90a5e622a"],
    "comparable": true,
    "incomparableReasons": [],
    "warnings": ["SMALL_SAMPLE", "ENGINE_VERSION_DIRTY"]
  }
}
```

⚠️ **`comparable` 与 §6.3 表格期望的 `false` 不同 ⇒ 见偏差表 #1**（判定表 §D4 + §6.3 脚注均规定 `comparable` 只看 4 个 reasons；`SMALL_SAMPLE` 属告警）。4 个 reasons 全部不命中：`engine_version` 唯一、`prompt_version` 唯一、`labeled=1≠0`、无已标场次缺逐字稿。`labelAgreement` 有值（0），`scope.warnings` 如实报出小样本与脏基线。**判读按 §D4，不改判定逻辑迎合单行期望。**

**A10 `GET /quality/consistency`（不传 batchId）** →

```json
{ "labeled": 30, "total": 30, "labelAgreement": 0.5, "crisisAgreement": 0.8666666666666667, "explorationTurnMae": null }
```

与改造前**逐字一致**（`A10_IDENTICAL = true`）；`scope` 为 `{ sessions: 30, engineVersions: ["<unknown>"], promptVersions: ["<unknown>"], comparable: true, incomparableReasons: [], warnings: [] }`（旧行版本列本就为 NULL，用 `<unknown>` 显式表达，未编造版本）。✅

**A11 `pnpm exec tsx bin/quality-freeze-batch.ts --batch p1d-r3-intake-2026-11-11`** → `{"frozen":16,"alreadyFrozen":0,"missing":0}`，exit 0；`data/quality/transcripts/p1d-r3-intake-2026-11-11/` 下 **16 个文件**。重跑 → `{"frozen":0,"alreadyFrozen":16,"missing":0}`，exit 0。坏参数 `--batch ../bad` → exit **2**。✅

**A12 冻结后 `GET /quality/annotations/<已标那条的 ref>`** → `transcriptSource = "frozen"`，`messages` **24 条**（12 轮 × 2 侧），与活文件一致。✅

### 验收小结

| #       | 结论                          | 说明                                                         |
| ------- | ----------------------------- | ------------------------------------------------------------ |
| A1–A8   | ✅ 通过                       | 与期望一致                                                   |
| A9      | ⚠️ **数值通过、期望值有矛盾** | 判定按 §D4 + §6.3 脚注实现，`comparable=true`；偏差见 §二 #1 |
| A10–A12 | ✅ 通过                       | 与期望一致                                                   |

## 六、冻结留档实测

| 项                                             | 实测值                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 目录                                           | `data/quality/transcripts/p1d-r3-intake-2026-11-11/`                                                  |
| 文件数                                         | **16**                                                                                                |
| 总字节                                         | **1,535,128**                                                                                         |
| `frozen` / `alreadyFrozen` / `missing`（首跑） | **16 / 0 / 0**                                                                                        |
| `frozen` / `alreadyFrozen` / `missing`（重跑） | **0 / 16 / 0**                                                                                        |
| 缺失场次（`missing`）                          | **0** —— 该批 16 场逐字稿在冻结前均未被淘汰                                                           |
| 落库来源                                       | 首次保存时懒冻结（`PUT` 成功后写冻结副本，失败只 `warnings: ["FREEZE_FAILED"]`，不阻断保存）          |
| 读路径                                         | 冻结副本优先 → 活 store 次之 → 都没有则 `transcriptSource: "missing"`（fail-closed，不返回假 `0` 轮） |

## 七、风险与回归

**存量 30 行：零改动。** 迁移只 `UPDATE ... SET batch_id` 一列（23 行），其余列未触碰。复核（真库实查）：总行数 **31 = 30 legacy + 1 新建**；legacy 30 行 `dominant_label` 非空 **30/30**、`anchor_order` 非空 **30/30**、`first_exploration_turn` 非空 **1**、`notes` 非空 **3** —— 与任务单 §1.2 实查基线**逐项一致**。

**`batchId` 省略路径：行为不变。** list 返回 30 条、`id` 全非空、`done`/`total` 口径不变；consistency 数字与改造前逐字一致（A10）。新增字段是**加法**，旧字段语义未改。

**GET 绝不建行。** list / detail / consistency 全部纯读；契约测试用「请求前后行数相等」断言钉死。

**幂等 upsert。** 唯一键仍是 `debug_session_id`；重复 PUT 不产生第二行（A7）。

**零压红线。** 轮级三列只允许事实描述；`turn_note` 落库前过禁用词表（评分 / 得分 / 分数 / 等级 / 评级 / 总分 / 对错 / 正确率），命中即 400，**不静默丢弃**；三列**不参与** `done` 判定（`done` 仍只认 `dominant_label`，避免进度条口径漂移）。

**隐私。** 逐字稿正文、`notes`、`turn_note` 不进日志，只打 id / 计数 / 错误名；冻结副本目录已加入 `.gitignore`（见 §三），不随仓库分发。

**性能。** 按批队列一次 `sessions LEFT JOIN annotation` 取回，批内排序在代码内完成（不依赖 SQL 排序的稳定性），未引入 N+1。

**遗留风险：** `engine_version = e3b0680-dirty` ⇒ 本批基线来自**脏工作区**，正式基线需 clean tree 重跑（见 §八）。

## 八、遗留项

1. **`engine_version` 带 `-dirty`**：说明 `p1d-r3-intake-2026-11-11` 的基线来自脏工作区。已在 `scope.warnings` 显式标 `ENGINE_VERSION_DIRTY`，但**正式标定基线需 clean tree 重跑一批**。
2. **冻结副本的存储与备份**：`data/quality/transcripts/` 现为本地磁盘 + `.gitignore` 排除。多机部署时需把该目录纳入共享存储或备份策略（当前无实现，属部署层议题）。
3. **全量口径未隔离 legacy 30 行**：见偏差表 #6。按批口径天然隔离（23 行 legacy 指向两个无效批，默认不可见），全量口径仍为 30 —— 这是向后兼容契约的代价，需大炮拍板是否在后续单里给全量口径加 `excludeLegacy` 开关。
4. **`scripts/` 目录同款欠账**：`scripts/**` 仍未进任何 tsconfig（WP-M 的 M-4 结论是「维持现状、已知并接受」），本单沿用该结论，未新增脚本类型检查面。
5. **前后端联调**：契约文档已交付，前端 WP-N-FE 已交付，但两者尚未做一次在线联调回归（前端类型是否与后端视图逐字段对齐待验）。

## 九、确认：未碰 engine-core / admin-dashboard

- `git diff --stat HEAD -- src/engine-core` → **空**。本单零 engine-core 改动，未改 `boundary.spec.ts`，未加 `@nestjs/` / 网络调用 / prompt / 模型名 / `process.env` / `globalThis` 到任何纯层文件。
- `git status --short -- admin-dashboard` → 3 个文件 modified（`src/api/client.ts` / `src/api/types.ts` / `src/views/AnnotationTool.vue`），**全部来自并行前端任务 WP-N-FE**；本单对 `admin-dashboard/**` **一行未碰**，也未跑 `vue-tsc` / `vite build`。提交时须按 §三 分组，**不混并行产物**。
- 未改 `MAX_DEBUG_SESSIONS`、未改 `DebugSessionStore.prune`；未改 `quality-annotation-auto.ts` / `quality-annotation-consistency.ts` 的算法（只加过滤与守卫）；未改 `visitor-quality-audit.ts`；未新增依赖；未删任何标注数据；**未自动 commit / push**。

## 十、commit message 草稿（未提交）

```
feat(wp-n): 标注台按批派生队列 + 逐字稿冻结留档 + 一致率可比性守卫
```

---

_记录生成：2026-11-11 · MiniMax Code（后端 only）_
