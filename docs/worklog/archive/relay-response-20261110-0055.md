# WP-H 第二波 + 第三波 + 批次可观测性收口 · 交付记录摘要（relay）

- 完成时间：2026-11-10 00:55
- 执行方：MiniMaxCode
- 委托方：主 Agent（豆包）
- 基线 HEAD：`f59c307`（分支 `integrate`）
- 完整交付记录：[`completed/phase2.5/phase2.5-wp-h-wave2-3-implementation-2026-11-10.md`](../completed/phase2.5/phase2.5-wp-h-wave2-3-implementation-2026-11-10.md)
- 执行单：[`pending/wp-h-wave2-3-and-observability-task-2026-11-10.md`](wp-h-wave2-3-and-observability-task-2026-11-10.md)

---

## 一、八项落点一览

| 编号 | 规格 | 落点 | 状态 |
|---|---|---|---|
| 改动 5 | `degraded_turns` 拆双计数器 | 实体加 `counselor_degraded_turns` / `visitor_degraded_turns` + 迁移 `1714900000039`（写入侧归主 Agent） | ✅ 实体列 + 迁移已落地 |
| 改动 6 | 渲染降级率独立指标 | 实体加 `render_fallback_turns` / `llm_call_turns` / `render_fallback_ratio`；`GET /batches/:id` 返回批次级聚合 | ✅ |
| 改动 7 | `prompt_tokens` 归约链 | provider → chunk 契约 → 渲染适配器 → 留痕 trace 全链穿透（按**真实根因**修：provider 把 input 拆分丢了） | ✅ |
| 改动 8 | `engine_version` 自动派生 | `ENGINE_VERSION` 优先 → `git describe --always --dirty` → 无 git 回落 `unknown` | ✅ |
| 改动 9 | 批次有效性门禁 | 新表 `ap_practice_batches`（迁移 `1714900000040`）+ `PracticeBatchHealthService` + 端点 `batchHealth` + 不合格带 `warning` | ✅ |
| 新增 10 | 日志降噪开关 | `DB_QUERY_LOGGING`（缺省 false）→ TypeORM `logging` 级别数组；`error`/`warn`/`migration` 永远保留 | ✅ |
| 新增 11 | WS 空房间短路 | 空房间直接 return（不序列化不 emit），降 debug 且同场次只打一次 | ✅ |
| 新增 12 | 逐字稿批次索引 | `data/debug-sessions/_batches/<key>.json`，只有 id 与枚举，零对话文本 | ✅ |

## 二、【交接】实体列与迁移已落地

- 迁移文件名：`src/migration/1714900000039-AddPracticeSessionRenderMetrics.ts`（另有 `1714900000040-CreateAutoPracticeBatches.ts` 建批次结论表）
- 新列：`counselor_degraded_turns` / `visitor_degraded_turns` / `render_fallback_turns` / `llm_call_turns` / `render_fallback_ratio`
- 列定义：前四列 `INT NOT NULL DEFAULT 0`；`render_fallback_ratio` `DECIMAL(5,4) NULL`
- up/down 已验证：**是**（show → run → revert → run；DB 复原 33 列，逐列核对类型/默认值通过）
- `practice-runner.service.ts` 未改动：**是**（本单全程未触碰该文件与它的 spec）

**写入侧口径（主 Agent 照此写）**：`counselor/visitor_degraded_turns` 每轮最多 +1；旧列 `degraded_turns` 写 `max(counselor, visitor)`；`render_fallback_turns` 在 `providerHint === 'degraded'` 时 +1，与 `llm_call_turns` 互斥；`render_fallback_ratio` 写时计算，**分母为 0 留 NULL**。

## 三、闸门数字（全部实测）

| 项 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **exit 0**，0 error |
| `npx eslint --no-cache`（23 个改动文件） | **0 error / 0 warning** |
| 本单新增单测 | **32 例全绿**（批次可观测性 25 + prompt_tokens 7） |
| 全量 `npx vitest run` | **4 failed / 2621 passed / 19 skipped（2644）** —— 与基线同样这 4 条，失败集合未扩大 |
| 迁移 0039 / 0040 | up / down **双向可执行** |
| `git diff --stat HEAD -- src/engine-core` | **空** |

4 条失败（**主 Agent 引入的既有问题，本单未修未 skip 未改断言**）：`debug-session-persistence`（`MAX_DEBUG_SESSIONS`）、`wp26-admin-role-guard`、`wp30-admin-real-api`、`wp31-cost-board`（后三条为 characters 路由重名导致的 guard 断言）。

## 四、关键偏差（详见完整记录 §二）

- **A1 改动 7 的真实根因**：任务单说"链路没带"，实际是 provider 的 `applyChunkUsage` 把 `input_tokens` 合进 `tokenCount` 就丢了 —— 上游一直报着输入侧用量。修复落在 provider / chunk 契约层，不是改 `?? 0`。
- **A2 "落 null" 只做到链路层**：`prompt_tokens` 列是 WP-F 迁移建的 `INT NOT NULL` 列，且写入代码在 runner（主 Agent 域），落库层做不到；等价信号是 `cost_basis='output_only'`。
- **A3 批次状态落独立表**：`ap_practice_batches`（一批一行：`valid` / `validity_flags` / 三个比率）。
- **A4 门禁是读时算的**：不等"跑完"，跑到一半已不合格就立刻标出来。
- **A5 慢查询阈值是新增的**：本仓此前没有 `maxQueryExecutionTime`，本单按任务单口径显式配上 1000ms 并保证 `warn` 永远保留。
- **A6 兜底率给两个口径**：批次均值（门禁用）+ 加权值（合计兜底轮 / 合计轮数）。
- **A7 单场索引用 `scope` 区分**：`batchId: null` + `scope: 'single'`。

## 五、改动文件清单

**新增 7**：迁移 0039 / 0040、`practice-batch.entity.ts`、`practice-batch-health.service.ts`、`db-logging.ts`、两个新 spec。

**修改 20**：`practice-session.entity.ts`、`auto-practice.controller.ts`、`auto-practice.gateway.ts`、`auto-practice.module.ts`、`practice-queue.service.ts`、`inference-fingerprint.service.ts`、`config/envs/development.ts`、`config/envs/production.ts`、`chat-provider.interface.ts`、`openai-compatible-chat.provider.ts`、`llm-render.adapter.ts`、`streaming-render.port.ts`、`debug-session.service.ts`、`migration/index.ts`、`bin/ormconfig.ts`、`typings/global.d.ts`、`.env.example`、README、WP-H 任务单、本记录。

**未触碰**：`practice-runner.service.ts`、其 spec、`auto-practice.events.ts`、`counselor-agent.service.ts`、`dialogue-quality.spec.ts`、渲染层 prompt 文案、`scripts/ops/canary/`、`src/engine-core/**`。

## 六、需要主 Agent 接着做

1. 在 `practice-runner.service.ts` 落五个计数器（列与迁移已就绪，见 §二），并把 `_heavy_degraded` 判定改成两侧各自 `/ turnCount >= 0.5`。
2. 发起 100 场级批次（跑批归主 Agent）：先看 `GET /admin/api/auto-practice/batches/:id` 的 `batchHealth.valid`，不合格会直接带 `warning`。
3. 复核成本口径：改动 7 修好后 `prompt_tokens` 应落非 0、`cost_basis` 应升到 `full`；若仍为 0，说明上游流式没回 usage，需另查上游返回。
4. **部署必须先 `pnpm migration:run` 再起服务**（新增 5 列 + 1 张表）。

## 七、commit message 草稿（不自动提交）

```
fix(phase2.5): 指标可信度与版本追溯 (WP-H 第二/三波)

- degraded_turns 拆双计数器 + 回填 0 (历史不可反推)
- 新增 render_fallback_turns / llm_call_turns / render_fallback_ratio
- prompt_tokens 归约链补齐 (此前全库恒为 0; 真根因在 provider/chunk 契约层丢拆分)
- engine_version 改 git describe --always --dirty 派生
- 新增批次有效性门禁 (ap_practice_batches + batchHealth + warning), 不合格批次标记 INVALID 不进分析
- 跑批期关 TypeORM query 日志 (DB_QUERY_LOGGING, 缺省 false)
- WS 空房间短路 + 逐字稿批次索引 (不含对话文本)
```
