# WP-D 自动对练 · 修复任务单（2026-11-09）

> **路径**：`docs/worklog/pending/phase2.5-wp-d-auto-practice-2026-11-09-fix-list.md`
> **来源**：全量实跑测试报告 [`2026-11-09-test-report`](../completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-09-test-report.md)
> **状态**：📋 待你决定（本单只记录问题 + 建议修法，**未改任何生产代码**）
> **测试口径**：4 角色 × 7 模式 = 28 场全跑齐；全仓单测 2392 passed / 2 failed；前后端类型闸门均过
> **一句话**：主链路能用，错路全都不合格。做"千场数据集"之前，P0/P1 必须先修。

---

## 一、本单定位

这轮是**测试轮**，不是修复轮。下面每条都写清了"怎么复现、根因在哪一行、建议怎么改、改完怎么验收"，你可以按优先级挑着做，也可以只挑 P0+P1 一条线先做掉。

估计工作量：**P0 + 4 条 P1 ≈ 半天到 1 天**；P2 全部 ≈ 1–2 天；P3 属顺手项。

---

## 二、问题与建议修法

### P0-1 🔴 传不存在角色直接打崩后端进程

**现象**：`POST /admin/api/auto-practice/sessions` 传一个 DB 里不存在的 slug（例如 `vpt_jsonl_behavior-01-alcohol-dependence`），接口照常返回 `practiceSessionId`，随后 **Node 进程直接退出**（`nest start --watch` 打印 `The application exited with code 1.`，watch 再拉起来）。整机后端中断，所有在跑的场次全废。

**证据**：
- 场次留痕：`SxciqjHJeZi_W-LvvFdHO` → `status=failed, exitReason=error, turnCount=0, errorMessage=角色不存在`
- 代码：`auto-practice.controller.ts:88` 是 `void this.runner.run({...})`，**fire-and-forget 且无 `.catch()`**；`practice-runner.service.ts` 在 `engine.open()` 失败时虽然建了 `failed/error` 行并落 `errorMessage`，但最后仍 `throw error`；`debug-session.service.ts:443` 抛 `new BizException(BizCode.InvalidParameter, '角色不存在')`
- 结论：`run()` 的 rejection 没人接 → unhandled rejection → Node 22 致命退出

**建议修法**（按顺序做，前两步就能止血）：
1. controller 改成 `void this.runner.run({...}).catch(err => this.logger.error(...))`（或不 `void`，改成 `await` 并返回 202 语义）；
2. `run()` 里 open 失败的那条路径**不要再 throw**，落库后直接 `return`（调用方不该为"已落库的失败"再炸一次）；
3. 建场前做一次角色存在性校验（`character_profiles` 里查 slug），不存在直接返回 400 + 明确文案，从源头拦住；
4. 补单测：runner open 抛错时"落 failed 行 + 不抛出"。

**验收口径**：
- 传不存在 slug → HTTP 400（或 202 + 场次 failed），**后端进程存活**，`GET /sessions/:id` 能查到 `failed/error/角色不存在`
- 同一进程内连续打 5 次不存在 slug，进程仍在

**工作量**：0.5–1h（含单测）

---

### P1-1 🔴 `POST /batch` 100% 500，前端「批量跑」完全不可用

**现象**：无论 body 怎么传，`POST /admin/api/auto-practice/batch` 一律 500，且**已入队的前几场不回滚**（批次里出现"部分入队、部分没入"的脏状态）。

**证据**：
- 栈：`Error: Custom Id cannot contain :` → `bullmq@5.81.5/dist/cjs/classes/job.js:1075 validateOptions` ← `job.js:1032 addJob` ← `queue.js:200`
- 根因：`practice-queue.service.ts:100` `jobId: \`${data.batchId}:${data.characterSlug}:${data.counselorModeId}:${nanoid(8)}\``，BullMQ 5 不允许 jobId 含 `:`
- 影响面：`AutoPractice.vue` 的「批量跑」弹窗（`startBatch` → `api.autoPractice.enqueueBatch`）全链路不可用；本轮矩阵因此只能退化为单场接口手工跑

**建议修法**：
1. `jobId` 换分隔符（如 `-`）或干脆不传 `jobId` 让 BullMQ 自己生成（幂等需求用 `batchId + slug + mode + seq` 的 `-` 拼接，seq 用入队序号）；
2. 入队循环加事务性语义：任一 `add` 失败 → 已入队的 job 全部 `remove()` 并让接口返回明确 500 文案（或整批改为"先校验全部入参再统一入队"）；
3. 补单测：mock queue，断言 `jobId` 不含 `:`、入队 4×7×2 全成功、第 3 次 add 抛错时回滚。

**验收口径**：`POST /batch` body `{characterSlugs:[4], counselorModeIds:[7], repeats:2}` → 200 且 `enqueued=56`，`GET /batches/:id` 能看到 56 场进度；再故意让一次 add 失败，断言没有残留 job。

**工作量**：1–2h（含单测）

---

### P1-2 🔴 `.env.example` 缺 2 个 `AUTO_PRACTICE_*` 键

**现象**：仓库既有 WP25 契约测试报红，缺 `AUTO_PRACTICE_COUNSELOR_MODEL`、`AUTO_PRACTICE_WORKER_CONCURRENCY`。

**证据**：
- `test/config/wp25-env-example-coverage.spec.ts:661` 失败明细就是这两个键
- 读取点：`practice-queue.service.ts:60`（并发）、`counselor-agent.service.ts:102`（模型，走 ConfigService）
- `.env.example` 与 `.env` 里 `AUTO_PRACTICE` 均**零命中** → 线上实际吃的是代码默认值（并发 3、模型跟 `MINIMAX_LLM_MODEL`）

**建议修法**：`.env.example` 补两行并写清默认值与影响（并发默认 3、模型默认随 `MINIMAX_LLM_MODEL`）；若采纳 P1-3 的"批量限并发"，把默认并发同步改小。

**验收口径**：`npx vitest run test/config/wp25-env-example-coverage.spec.ts` 全绿。

**工作量**：10min

---

### P1-3 🔴 上游限流导致整场静默降级，场次仍标 `completed`

**现象**：并发 3 跑矩阵时，上游 MiniMax 触发 Token Plan 速率限制，来访者渲染链**整场退化为 4 句固定兜底台词轮转**、咨询师侧退化为 `FALLBACK_REPLY`，而 `PracticeSession` 仍然写 `completed/max_turns`，**没有任何 `degraded` 字段**——批量跑千场时无法区分"真数据"和"垃圾数据"。

**证据**：
- `WARN [render] 候选 minimax 调用失败, 切下一个候选: [minimax] 429 已达到 Token Plan 速率限制…`
- `WARN [streamRender] 降级兜底: degraded=true reason=候选耗尽或全部处于冷却`
- 第一批 25 场里 **13 场来访兜底 ≥50%**（6 场 12/12 全兜底），`detail2/` 可离线统计
- **反证**：改串行（并发 1 + 间隔 8s）后补跑 17 场，**vFallback 全部 0/12**，单场 18–131s

**根因有两层**：
1. 部署层：单 provider（`ENGINE_RENDER_PRIMARY_PROVIDER=minimax`）+ Token Plan 配额，并发 3 就打满；
2. **模块层（真正的缺陷）**：降级信号只活在内层 `degraded` 变量里，**没有落到场次记录**，也没有"降级超阈值就判 failed"的闸门。

**建议修法**：
1. `PracticeSession` 加 `degradedTurns`（或 `counselorFallbackTurns` / `visitorFallbackTurns`）与 `degraded` 布尔字段（migration + 实体 + runner 写入）；
2. 降级比例超阈值（建议 ≥30%）→ 场次判 `failed`，`exitReason=degraded`，不进有效数据集；
3. 队列默认并发降到 1–2，并对 429 做指数退避重试（`MINIMAX_LLM_MAX_RETRIES` 已有，但"候选耗尽即兜底"太快，建议至少 1 次退避）；
4. 前端列表/导出把 `degraded` 显式展示，避免把垃圾样本当有效数据导出。

**验收口径**：人为把 provider 指向一个坏 key → 场次结束必须是 `failed/degraded`（而非 `completed`）；正常跑时 `degradedTurns=0`。

**工作量**：2–3h（migration + runner + 单测）

---

### P2-1 🟡 `totalCost` 恒 null；`modelVersion` / `seedValue` 从不写入

**现象**：28/28 场 `totalCost=null`，`modelVersion` / `seedValue` 同样恒默认。实体注释说这三个字段"本期只写不读"，但**实际没有任何写入点**（全模块 grep 只有实体声明与注释）。

**证据**：`entities/practice-session.entity.ts:114/122/127`；`counselor-agent.service.ts:48` 注释声称"落 PracticeSession.model_version"但从未落库；逐字稿 `trace.llmUsage` 里已有 `promptTokens/completionTokens`（说明数据采到了，只是没汇总到场次）。

**建议修法**：runner 结算时把 `counselorReply.model` 写 `modelVersion`，`seedValue` 写本次随机种子（若有的化），`totalCost` 按 provider 单价 × tokens 累计（至少先落 tokens 总数，成本函数后补）。

**验收口径**：任一场次 `GET /sessions/:id` 返回 `totalCost` 非 null、`modelVersion` 等于实际模型名。

**工作量**：2h

---

### P2-2 🟡 咨询师回复被 500 token 硬截断，状态标记一起丢

**现象**：`preachy` 模式 5 条回复断在半句，其中一条断在 `[[STATE:M`（标记只剩一个字符）。截断 → 状态标记丢失 → runner 永远收不到"该收尾"信号。

**证据**：`counselor-agent.service.ts:122` `maxCompletionTokens: 500`（注释已自认会截断）；实测断点：52 / 183 / 211 字；§5.4 报告给出三条原文片段。

**建议修法**：
1. 读 `response` 的 `finishReason`，若是 `length`：① 追加一轮"请把上句写完"补全；② 或直接丢弃本轮重试（最多 1 次）；
2. 预算按模式分档（`preachy` 这类长段落模式给 800–1000，`expert` 等短句模式保持 500）；
3. 兜底：截断且未解析到标记时，按"继续"处理并在场次记 `truncatedTurns`。

**验收口径**：`preachy` 跑 12 轮，`truncatedTurns=0`；人为把上限调到 200，断言出现 `length` 分支且不产生半句脏文本。

**工作量**：1–2h

---

### P2-3 🟡 11 个 jsonl 角色灌错表，自动对练根本用不到

**现象**：`bin/seed-visitors-jsonl.ts` 把 `visitors.jsonl` 的 11 个角色写进 **`visitor_pool_templates`**（速查卡表），而自动对练的角色 resolver 读 **`character_profiles`**（引擎角色池）。结果：只有 4 个 `vpt_*_l1` 可用，"所有角色"实际退化，且传 jsonl slug 会触发 P0-1 崩进程。

**证据**：`seed-visitors-jsonl.ts:99` `getRepository(VisitorPoolTemplate)`；`admin-debug.controller.ts:96/230` `getRepository(CharacterProfileEntity)`，`GET /admin/api/characters` 只返回 4 条。

**建议修法**（**需要你先拍板口径**，见 §四决策点 1）：
- 方案 A：seed 同时写 `character_profiles`（补齐 `coreBeliefs` / `forbiddenBehaviors` / `risk=none` 等基线字段），自动对练就能用上 11 个角色；
- 方案 B：明确"自动对练只用 4 个 1 级角色"，把 jsonl 导入从 WP-D 口径里摘掉，文档同步修正。

**验收口径**：`GET /admin/api/characters` 返回 11+4 个（方案 A）或文档明确写"仅 4 个"（方案 B）；两种方案下传不存在的 slug 都必须是 400 而非崩进程（依赖 P0-1）。

**工作量**：方案 A 3–4h（含迁移与基线字段补全）/ 方案 B 0.5h（纯文档）

---

### P2-4 🟡 注释与实现漂移

`practice-runner.service.ts:12` 仍写"输出 `[[END]]` 标记"，实际是 `[[STATE:END]]`（`counselor-agent.service.ts:66`）+ `MIN_TURNS_BEFORE_CLOSE=5`。**建议**：改注释，并在注释里补"标记可能被截断"的告警（与 P2-2 呼应）。**工作量**：5min。

---

### P2-5 🟡 模式人设漂移

| 模式 | 实测 | 建议 |
|---|---|---|
| `preachy` | 6/12 轮"你要明白"，均 157 字、峰值 224 字，来访者几乎没有回应空间 | systemPrompt 加"单轮 ≤80 字、禁止连续三段说理"的硬约束；或把"说教"定义为"给结论但不给空间"，靠打断来访体现，而不是靠长度 |
| `nonsense` | 晚晴场（202 字均长）确为语无伦次；小满场（58 字）看不出 | 固定"跑题/失序"的具体行为（跳话题、答非所问、自相矛盾），并在 systemPrompt 里给 2–3 个示例句式 |
| `cold` | 小满场是标准结构化问诊，仅末尾给建议 | 明确"冷"的表现层：少共情、不复述情绪、直接问事实；现在更多是"话少"而非"态度冷" |

**验收口径**：每种模式跑 3 场，人工读稿按"是否体现该模式"打分 ≥2/3 一致。

**工作量**：prompt 调优 2–3h（含复跑）

---

### P3 级别（顺手项，可并到上面任意一单里）

| 编号 | 问题 | 建议 | 工作量 |
|---|---|---|---|
| P3-1 | `debug-session-persistence.spec.ts` 全量跑 flaky（单跑 26 passed/3.58s） | 把 `waitFor` 的 10s 放宽到 20s，或该 spec 标记 `test.concurrent: false` 隔离跑 | 15min |
| P3-2 | 模块只有 1 个 spec（`practice-runner.spec.ts` 7 例），counselor-agent / queue / controller / gateway 零单测 | 至少补 P0-1、P1-1 两条回归单测；gateway 补一条"房间为空不抛错" | 2h |
| P3-3 | 调试会话持久化走文件存储（DB 91 张表无 debug 表、`training_sessions` 0 行，但列表返回 22 条） | 要么补 MySQL 落库，要么在文档/接口注释里写清"文件存储 + 路径"，避免后续排查再踩 | 2h 或纯文档 |
| P3-4 | 危机探测边界样本（"日子挺空"判 `passive_ideation`）；`crisis_ended` 直接终止、无安全收尾轮 | 建带标注的危机回归集（真阳性 + 边界阴性各若干），再调阈值；危机场次补 1 轮"安全收尾/转介"话术 | 半天 |

---

## 三、建议排期（三选一，明天你定）

| 方案 | 内容 | 周期 | 适合什么情况 |
|---|---|---|---|
| **A（推荐）· 先止血** | P0-1 + P1-1 + P1-2 + P1-3 + P3-2 的对应回归单测 | 1 天 | 下一步要开始批量产数据，必须先把"崩进程/批量 500/静默降级"清掉 |
| **B · 数据质量优先** | A 之后再做 P2-2（截断）+ P2-5（人设）+ P2-1（成本） | 3 天 | 目标是让 28 场数据能直接用于 WP-E 评测 |
| **C · 只清 P0** | 只做 P0-1（半小时），其余挂到下个迭代 | 0.5 天 | 手头有其他更高优先级的事 |

无论选哪个，**P2-3（11 个角色补不补）需要你先拍板口径**，因为它决定"所有角色"到底指几个。

---

## 四、需要你拍板的 5 个决策点

1. **11 个 jsonl 角色**：补进 `character_profiles`（方案 A）还是明确只用 4 个（方案 B）？
2. **批量并发默认值**：降到 1（最安全、最慢）还是 2（折中，仍需 429 退避）？
3. **MiniMax 配额**：升级 Token Plan / 切按量付费 / 加 provider 降级链（三者成本与稳定性差异大，属运维决策）。
4. **降级判定阈值**：`degradedTurns` 占比 ≥30% 判 `failed`，这个数你认不认？（认了就能让批量数据"坏样本不进库"）
5. **`totalCost` / `modelVersion` / `seedValue`** 是否纳入本阶段（WP-B 的"版本锁定"本来就要这三个字段，可以顺路做掉）。

---

## 五、边界（本单不做的事）

- 不改 `engine-core`（危机探测阈值、BDI 演化都在内核里，调参属内核变更，需单独立项）。
- 不重跑 28 场矩阵（改完代码后按 §六的验收口径跑定向回归即可）。
- 不动数据库存量数据（除 P2-3 方案 A 的新增 seed，且需你确认）。

---

## 六、改完怎么验收（一句话版）

```
① 传不存在 slug 5 次 → 进程活着
② POST /batch 4×7×2 → 200 + enqueued=56
③ vitest run test/config/wp25-env-example-coverage.spec.ts → 全绿
④ 把 provider 指向坏 key 跑一场 → failed/degraded（不是 completed）
⑤ preachy 跑 12 轮 → truncatedTurns=0
⑥ 串行跑 4 角色 × 2 模式 → vFallback 全 0/12
```
