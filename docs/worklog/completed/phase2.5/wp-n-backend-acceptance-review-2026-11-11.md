# WP-N 后端交付 · 回收验收记录（ai-handoff-acceptance）

> **验收对象**：[WP-N 交付记录](wp-n-annotation-batch-scope-implementation-2026-11-11.md)（MiniMax Code，后端 only）
> **验收方**：主 Agent · **日期**：2026-11-11 · **分支**：`integrate`
> **验收清单**：落地核对 / 证据核对 / 范围与隔离 / 契约口径 / 遗留登记（`ai-handoff-acceptance`）
> **关联补丁**：[全局口径派生补丁交付记录](wp-n-legacy-global-derivation-implementation-2026-11-11.md)（验收前已合入工作区，非本单产物）

---

## 一、验收结论：**通过**

主体合格：D1–D8 落地完整、闸门抽跑 + 全量复跑全绿、范围隔离干净、契约字段与实现对齐、遗留项已登记。
条件项 C1（契约文档口径同步）、C2（全量测试复跑）、C3（浏览器三路径在线回归）均已收口。

## 二、五类核对结果

### 1. 落地核对 ✅

| 交付物                                                               | 核对结果                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| migration `1714900000047-AddQualityAnnotationBatchColumns.ts`        | 在位；9 列 + 1 索引；幂等 `INFORMATION_SCHEMA` 守卫；存量只回填 `batch_id`；`down` 回滚完整  |
| migration 双登记                                                     | `src/migration/index.ts:232` export；`bin/ormconfig.ts:280` import + `:473` 数组 —— 两处均在 |
| `quality-annotation-batch.ts`（纯函数层）                            | 在位；仅 import constants，零 IO / 零 `@nestjs` / 零网络                                     |
| `quality-annotation-batch.service.ts`                                | 在位；注入 session / batch / profile 仓储 + `DebugSessionStore` + `QualityTranscriptFreeze`  |
| `quality-transcript-freeze.ts`                                       | 在位；仅 `node:fs` + 本地 import；NULL 批次 → `_unassigned/` 目录                            |
| 冻结 CLI `bin/quality-freeze-batch.ts`                               | 在位；`--batch` / `--dry-run`；退出码 0 / 1 / 2；输出 `{frozen, alreadyFrozen, missing}`     |
| API 契约文档 `docs/team/quality-annotation-batch-api-contract.md`    | 在位，423+ 行，非占位                                                                        |
| 测试 `quality-annotation-batch.spec.ts` / `…-batch-contract.spec.ts` | 在位；纯函数 27 例 + 契约 19 例                                                              |
| 临时脚本                                                             | Glob 全仓无 `.wpn-probe*` 残留                                                               |

### 2. 证据核对 ✅（抽跑复现 + 全量复跑）

| 闸门                                       | 交付记录声称                                                  | 验收复跑                                                                                                                                                                                                       | 结果                                                       |
| ------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 类型 `tsc -p tsconfig.build.json --noEmit` | exit 0 / 0 error                                              | exit 0 / 空输出                                                                                                                                                                                                | ✅ 一致                                                    |
| Lint `pnpm lint`                           | exit 0 / 0 error / 2 warning（既有 `import/order`，未碰文件） | exit 0 / 0 error / **0 warning**（缓存或既有告警后续已消；当前无新增告警）                                                                                                                                     | ✅ 绿灯；warning 数与记录略有出入，不构成缺陷              |
| 定向 `vitest run test/quality`             | 7 文件 / 95 例全绿                                            | **7 文件 / 96 例全绿**（+1 例来自后续补丁新增用例）                                                                                                                                                            | ✅ 一致                                                    |
| 全量 `pnpm test`                           | 181 文件 / 2945 例 / 0 failed / 87.15s                        | **复跑通过**：180 passed + 1 skipped（181 文件）；2942 passed + 4 skipped（2946 例，+1 例为后续补丁新增用例）；**0 failed**；exit 0；Duration 1005.24s（isolate 181 worker，本机逐文件起 worker 偏慢，非失败） | ✅ 一致（0 failed；用例总数较记录 +1，与补丁新增用例一致） |
| engine-core diff                           | 空                                                            | `git diff --stat HEAD -- src/engine-core` 空                                                                                                                                                                   | ✅ 一致                                                    |

### 3. 范围与隔离 ✅

- `src/engine-core/**`：零改动。
- 未改算法文件：`quality-annotation-auto.ts` / `quality-annotation-consistency.ts` / `visitor-quality-audit.ts` 均无 diff。
- 未改 `DebugSessionStore.prune` / `MAX_DEBUG_SESSIONS`；未改 `package.json` / `pnpm-lock.yaml`（无新增依赖）；未删标注数据。
- `admin-dashboard/**` 3 个 modified 文件归并行任务 WP-N-FE（交付记录 §九 已声明，本次核对与 FE 交付记录一致）；本单后端对前端零改动。
- 工作区分组：后端 WP-N 产物 / FE 产物 / 规范文档组 / 后续补丁产物分离，提交时须分组 stage，不混提。

### 4. 契约与口径 ✅（一处文档漂移，见条件 C1）

- 7 条路由与契约文档 §1.1 一致：`GET annotations` / `GET batches` / `GET :ref` / `PUT :ref` / `GET :ref/reveal` / `GET :ref/auto` / `GET consistency`。
- 行视图 22 字段（含批次 6 列、轮级 3 列、`transcriptSource`、`warnings`）与 `view.ts`、前端 `types.ts` `AnnotationRow` 逐项对齐；`id: string | null` 可空性一致。
- 原因码 / 告警码 / 来源枚举与 `constants.ts` 一致：`MIXED_ENGINE_VERSION / MIXED_PROMPT_VERSION / NO_LABELED_SESSION / TRANSCRIPT_MISSING_PARTIAL`；`SMALL_SAMPLE / ENGINE_VERSION_DIRTY`；`frozen / live / missing`；`INVALID_BATCHES_HIDDEN:<n>`。
- 可比性判定 `evaluateComparability`：`comparable = reasons.length === 0`，`SMALL_SAMPLE / ENGINE_VERSION_DIRTY` 只进 warnings —— 与 §D4 一致（A9 `comparable=true` 的偏差成立，非缺陷）。
- 轮级三列：DTO 形状 + 服务层禁用词表（评分 / 得分 / 分数 / 等级 / 评级 / 总分 / 对错 / 正确率）命中抛 400；三列不参与 `done` 判定 —— 零压红线落实。
- ⚠️ **文档漂移**：契约文档 §2.2 表格（约 :133–140）与文末口径说明（约 :435）仍写「不传 batchId = 只返 DB 已存在行、`id` 恒非空」；该旧口径已被后续补丁（全局派生）取代。运行时不受影响（前端已通用处理 `id=null`），但文档需同步。

### 5. 遗留登记 ✅

交付记录 §八 5 项遗留均在册：① dirty 基线需 clean tree 重跑；② 冻结目录备份策略（部署层）；③ legacy 30 行是否从全量一致性分母剔除（待拍板）；④ `scripts/` tsconfig 欠账（沿用 WP-M 结论）；⑤ 前后端在线联调回归 —— ✅ 已完成（2026-11-11 用户现场三路径走查，未发现问题）。前端 51 条既有类型债登记于 FE 交付记录 §遗留 #4 与 wp-list WP-N-FE 行。索引回写：wp-list WP-N 行、`worklog/README.md` §0 / 进行中 / 目录树、`phase2.5-README.md` 状态行 / §3 两行 —— 均已核对在位。

## 三、条件项（均已收口）

| #   | 条件                                                                                              | 性质                     | 建议处理                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | 契约文档 §2.2 与文末口径同步为「不传 batchId = 全局派生：已落库行 + 未标注可标注场次，`id` 可空」 | 文档漂移（后续补丁引入） | ✅ **已同步**（2026-11-11）：§1.1 标签、§2.2 口径表、§五 说明、一致性分母措辞均已更新；不改代码                                                                        |
| C2  | 全量 `pnpm test` 基线复跑确认 0 failed                                                            | 证据未独立复现           | ✅ **已复跑**（2026-11-11）：180 passed + 1 skipped / 2942 passed + 4 skipped / 0 failed / exit 0；日志内嵌 db down / redis down / llm down 均为负路径夹具，非真实失败 |
| C3  | 浏览器三路径在线回归（不传批次 / 切批次 / missing 与不可比横幅）                                  | FE 遗留 #5 同款          | ✅ **已回归**（2026-11-11，用户现场验证）：三路径在线走查未发现问题                                                                                                    |

## 四、不构成打回理由的记录偏差

- A9 `comparable=true`（任务单表格期望 false）：实现按 §D4 判定表 + §6.3 脚注，reasons 全空 → true；交付记录 §二 偏差表 #1 已说明，验收复核判定逻辑无误。
- 记录 §四 lint 2 warning 与本次复跑 0 warning：缓存或既有告警后续消除；当前 lint 无 error、无新增 warning。
- A5「不传批次 30 条 / id 全非空」：已被后续补丁的全局派生口径取代；补丁交付记录 §二 #2 已显式登记该偏差。

## 五、commit 分组建议（沿用交付记录 §十，未提交）

```
feat(wp-n): 标注台按批派生队列 + 逐字稿冻结留档 + 一致率可比性守卫
```

分组：① 后端 `src/quality/**` + `src/migration/**` + `bin/**`；② 测试 `test/quality/**`；③ 文档 `docs/**`；`admin-dashboard/**` 归 WP-N-FE 单独提交。
