# WP-N · 标注台批次化与按批标注闭环 —— 交付回复

> **回复完成时间**：2026-11-11 13:51 (+08:00) · 仓库 `E:\Work\Project\backend\mofang-nestjs` · 分支 `integrate`
> 本文件为本次回复的原文存档（写给 relay 用），任务单 §9「回复输出约定」的全部内容都在下面。

## 一、已写入交付记录

`docs/worklog/completed/phase2.5/wp-n-annotation-batch-scope-implementation-2026-11-11.md`

配套产物：

- API 契约：`docs/team/quality-annotation-batch-api-contract.md`（7 条 HTTP 路由 + 1 个 CLI，含三种前端必处理态与「不许把 `batchId` 做成默认值」）
- 任务单已从 `pending/` 移到 `completed/phase2.5/`，顶部状态改 ✅ 并链交付记录
- 4 处回写已完成：`phase2.5-wp-list-2026-11-08.md`（§四 WP-N 行 + §状态行）、`phase2.5-README.md`（§状态行 / §3 两行）、`docs/worklog/README.md`（§0 Phase2.5 行 / 进行中行 / 目录树行）

## 二、闸门真实数字

| 闸门        | 命令                                            | exit code | 结果                                                                                                                               |
| ----------- | ----------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **0**     | **0 error**                                                                                                                        |
| Lint        | `pnpm lint`                                     | **0**     | **0 error / 2 warning**（2 条 `import/order` 在 `src/auto-practice/metrics/batch-metrics.service.ts`——本单未碰该文件，属既有告警） |
| 全量测试    | `pnpm test`                                     | **0**     | **181 文件（180 passed + 1 skipped）/ 2945 例（2941 passed + 4 skipped）/ 0 failed**，87.15s                                       |
| 定向测试    | `pnpm exec vitest run test/quality`             | **0**     | **7 文件 / 95 例全绿**（本单净增 2 文件 44 例）                                                                                    |
| migration   | `pnpm migration:run` ×2                         | **0 / 0** | 首次建成 9 列 + 1 索引并回填；二次 `No migrations are pending`（幂等）                                                             |
| engine-core | `git diff --stat HEAD -- src/engine-core`       | **0**     | **空**                                                                                                                             |
| 前端隔离    | `git status --short -- admin-dashboard`         | 0         | **3 个文件 modified，全部来自并行前端任务 WP-N-FE**；本单对 `admin-dashboard/**` 一行未碰                                          |

全量基线对比：2026-11-10 记录基线为「179 文件 / 2863 例全绿」→ 本次 **181 文件 / 2945 例，0 failed**，无回归。

## 三、§6.3 十二条真库验收

| #   | 结论                             | 实测要点                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | ✅                               | `pnpm migration:run` exit 0；9 列 + `idx_quality_annotation_batch` 建成；回填 **23 行**（`YiBgpQSxbQh_q663IiVbT` 20 + `gzu9tnrBuXzztNMizliYh` 3），**7 行保持 NULL**（查不到批次，不编造）                                                                                                                                                                    |
| A2  | ✅                               | 二次运行 `No migrations are pending`，exit 0                                                                                                                                                                                                                                                                                                                  |
| A3  | ✅                               | 目标批：`sessions=16 / completedSessions=16 / annotatableSessions=16 / annotatedSessions=0 / transcriptAvailableSessions=16 / valid=true / validityFlags=[] / engineVersion=e3b0680-dirty / promptVersion=f1fdb4f90a5e622a / configFingerprint=64fb2a967e401b5b`；`warnings=["INVALID_BATCHES_HIDDEN:12"]`；默认可见 6 批，`?includeInvalid=1` 返回全部 18 批 |
| A4  | ✅                               | 16 条，`id` 全 `null`，`transcriptSource` 全 `live`，顺序确定                                                                                                                                                                                                                                                                                                 |
| A5  | ✅                               | 30 条，`id` 全非空                                                                                                                                                                                                                                                                                                                                            |
| A6  | ✅                               | 行数 30→31；新行 `batch_id=p1d-r3-intake-2026-11-11 / counselor_mode_id=expert / turn_count=12 / engine_version=e3b0680-dirty / prompt_version=f1fdb4f90a5e622a / character_version=1.0.0`                                                                                                                                                                    |
| A7  | ✅                               | 仍 31 行，`id` 不变，归属列未变，仅人工列变化（幂等 upsert）                                                                                                                                                                                                                                                                                                  |
| A8  | ✅                               | 16 条，该条 `id` 非空，`annotatedSessions=1 / done=1 / total=16`，其余 15 条仍 `null`                                                                                                                                                                                                                                                                         |
| A9  | ⚠️ **期望值有矛盾，按 §D4 实现** | `labeled=1 / total=16 / labelAgreement=0 / crisisAgreement=1 / explorationTurnMae=null`；`scope={sessions:16, engineVersions:["e3b0680-dirty"], promptVersions:["f1fdb4f90a5e622a"], comparable:true, incomparableReasons:[], warnings:["SMALL_SAMPLE","ENGINE_VERSION_DIRTY"]}` —— 详见下方偏差 #1                                                           |
| A10 | ✅                               | `{labeled:30,total:30,labelAgreement:0.5,crisisAgreement:0.8666666666666667,explorationTurnMae:null}`，与改造前**逐字一致**；`scope` 版本列为 `["<unknown>"]`（旧行本就没版本列，不编造）                                                                                                                                                                     |
| A11 | ✅                               | `{"frozen":16,"alreadyFrozen":0,"missing":0}` exit 0，目录 16 个文件；重跑 `{"frozen":0,"alreadyFrozen":16,"missing":0}` exit 0；坏参数 exit 2                                                                                                                                                                                                                |
| A12 | ✅                               | `transcriptSource="frozen"`，`messages=24`（12 轮 × 2 侧），与活文件一致                                                                                                                                                                                                                                                                                      |

冻结留档实测：**16 个文件 / 1,535,128 字节**，首跑 `frozen/alreadyFrozen/missing = 16/0/0`，重跑 `0/16/0`，`missing=0`（该批逐字稿冻结前均未被淘汰）。

## 四、偏差表要点（原方案 / 实际 / 原因）

1. **A9 的 `comparable`（最需要大炮拍板的一条）** —— 原方案：`scope.comparable=false`；实际：**`comparable=true`**，`incomparableReasons=[]`，`warnings=["SMALL_SAMPLE","ENGINE_VERSION_DIRTY"]`；原因：§D4 判定表把 `comparable=false` **只**绑定 4 个 reasons，并把 `SMALL_SAMPLE` / `ENGINE_VERSION_DIRTY` 明确列为「只告警不判不可比」，§6.3 脚注也写「判定只看 4 个 reasons」；该批 engine/prompt 版本各自唯一、`labeled=1≠0`、无已标场次缺逐字稿 ⇒ 4 个 reasons 全不命中。**判定表与脚注一致，§6.3 表格单行与之自相矛盾**——我按判定表实现，**没有改判定逻辑去迎合单行期望值**。
2. **「8 个端点」** —— 实际交付 **7 条 HTTP 路由 + 1 个 CLI**（`bin/quality-freeze-batch.ts`）。§D2–D4 只枚举了 7 条 HTTP 路由，第 8 个按 §D5 理解为 CLI；**未虚构第 8 条端点**。
3. **路由参数 `:id` → `:ref`** —— URL 形状不变，只改参数名以对齐 §D3 术语；既有契约测试的路由清单断言机械改名，其余断言未动。
4. **「`batchId` 省略 ⇒ 逐字一致」按加法解读** —— 既有 13 个行字段的取值/集合/顺序与 `done`/`total` 口径不变；新增字段在**所有**路径上追加返回。依据：§D3「只增字段」+ §D7「返回集合一致」（非字节级相同）。
5. **「旧 30 行隔离出分母」在全量口径未生效** —— 全量口径分母仍是 30，隔离只发生在**按批口径**。原因：§D4 与 §6.3 A10 明确要求不传 `batchId` 时与改造前逐字一致；23 行 legacy 已带 `batch_id`（指向两个无效批，默认不可见），按批取数天然不覆盖它们。**是否给全量口径加 `excludeLegacy` 开关，需大炮拍板。**
6. **WP 登记表 §四「新增一行」→「就地更新既有 WP-N 行」** —— 并行前端任务 WP-N-FE 已先建了该行（🚧），再加一行会重复。
7. **视图字段可空化** —— `id: string → string | null`、`updatedAt: string → string | null`（派生行无落行 id / 无 `updated_at`；既有路径 `id` 恒非空，既有前端不用 `updatedAt`）。
8. **既有契约测试 setup 更新** —— 服务构造函数新增 `batchService` 依赖 + 路由参数改名，补 `StubBatchService` 与新断言，**既有断言逻辑未改**。
9. **冻结读路径额外支持 `_unassigned` 回退** —— 让「先冻结、后归属批次」的历史行仍可读。
10. **超出任务单文件范围的一处改动（请知悉）**：`.gitignore` 新增 `data/quality/transcripts/`。冻结副本是逐字稿原文（心理内容），仓库既有约定（`data/debug-sessions/`）是「绝不进版本库」；不加这条规则，1.5 MB 逐字稿会随 `git add .` 进库，撞隐私红线。**本单其他文件严格照任务单范围。**

其余 D1–D8 无偏差。

## 五、风险与回归

- **存量 30 行零改动**：迁移只 `UPDATE ... SET batch_id` 一列（23 行）；复核真库：总行数 31 = 30 legacy + 1 新建；legacy 30 行 `dominant_label` 非空 30/30、`anchor_order` 非空 30/30、`first_exploration_turn` 非空 1、`notes` 非空 3 —— 与 §1.2 基线逐项一致。
- **`batchId` 省略路径行为不变**：list 30 条且 `id` 全非空；consistency 与改造前逐字一致（A10）。
- **GET 绝不建行**（契约测试用前后行数相等断言钉死）；**幂等 upsert**；**零压红线**（轮级三列只做事实描述，禁用词表命中即 400，不静默丢弃，且**不参与** `done` 判定）；**隐私**（逐字稿正文与 `notes`/`turn_note` 不进日志）。
- 未改 `MAX_DEBUG_SESSIONS` / `DebugSessionStore.prune`；未改 `quality-annotation-auto.ts` / `quality-annotation-consistency.ts` 算法；未改 `visitor-quality-audit.ts`；未新增依赖；未删任何标注数据；**未自动 commit / push**。

## 六、遗留项

1. `engine_version = e3b0680-dirty` ⇒ 该批基线来自**脏工作区**，正式标定基线需 clean tree 重跑（已在 `scope.warnings` 显式标 `ENGINE_VERSION_DIRTY`）。
2. 冻结副本目前落本地磁盘并被 `.gitignore` 排除；多机部署需纳入共享存储 / 备份策略（部署层议题，未实现）。
3. 全量口径是否隔离 legacy 30 行，需大炮拍板（见偏差 #5）。
4. 前后端按契约做一次在线联调回归（前端类型是否逐字段对齐）。
5. `scripts/**` 仍不在任何 tsconfig（沿用 WP-M 的 M-4「维持现状、已知并接受」结论）。

## 七、commit message 草稿（未提交，等大炮指令）

```
feat(wp-n): 标注台按批派生队列 + 逐字稿冻结留档 + 一致率可比性守卫
```

提交分组建议（不混并行产物）：① 后端 `src/quality/**` + `src/migration/**` + `bin/**` ② 测试 `test/quality/**` ③ 文档 `docs/**`；**`admin-dashboard/**` 的 3 个文件属并行前端任务 WP-N-FE，单独提交。**

---

_本回复不含任何 diff 全文与逐字稿台词。_
