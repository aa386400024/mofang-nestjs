# AF-297 · 渲染轮次结局恰好一次（异常逃逸兜底）交付记录

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-297/task-sheet.md`
- 分支：`task/AF-297-render-round-exactly-once`
- 基线：`16f8707204dbf25fc733d30254c4237325696336`（AF-296 合并后的 integrate）
- 状态提交：`0e51f7c9`（登记 + 领单）
- 实现提交：本提交（哈希见机读回执 `changedFiles.commits[1]`）
- 日期：2026-11-22

## 1. 改了什么

**`src/engine-adapters/rendering/llm-render.adapter.ts`**

- 新增 `RoundOutcomeSink`：每次 `render()` / `streamRender()` 调用独立创建，自带 `settled` 标记，`report()` 只放行第一个结局。一次调用最多上报一次 `onRoundOutcome`。
- `render()` 拆成外层兜底 + `renderInner()`：
  - 外层 `try/catch` 捕获 `buildMessages`、`resolveVisitorRealismRuntime`、候选循环、返回对象构造等任何逃逸异常；
  - 捕获后返回兜底话术（不 reject），并以同一个 sink 记一次 `rounds{degrade}`；
  - 成功结局改为**返回对象构造完成后**才上报，避免“已报 success、构造又抛错”造成结局与真实返回不一致。
- `streamRender()` 同样拆成外层兜底 + `streamRenderInner()`，异常时记一次 `rounds{degrade}` 并返回 `degraded=true` 的兜底结果。
- `streamViaAggregate()` 改为调用 `renderInner(spec, rounds)`，复用外层 sink。此前它调用公共 `render()`，会独立再建一个 sink，一次流式调用被记两轮。
- `degrade()` / `degradeOutcome()` 增加 `rounds` 参数：先看 `settled` 再决定是否上报 `onDegraded`，轮次结局与降级计数都只记第一次。
- 异常逃逸日志只打 `error.name`，不打 message，避免上游/构造缝 message 夹带 prompt 或对话原文进普通日志。

**`test/engine-adapters/af292-render-round-outcome.spec.ts`**

新增 4 条用例（原 5 条保留）：

1. 聚合路径 `buildMessages` 抛错：Promise 不 reject、返回兜底、`rounds` 恰为 `['degrade']`。
2. 流式路径 `buildMessages` 抛错：不 reject、`degraded=true`、`rounds` 恰为 `['degrade']`。
3. 无流式出口的聚合回退形态成功：`streamRender` 只记 `['success']`，证明嵌套调用不重复。
4. 聚合回退形态构造消息抛错：只记 `['degrade']`，内外层不重复。

## 2. 关键设计决策

- **为什么 sink 要按调用创建，而不是类级**：并发轮次共享类级标记会互相吞掉结局；按调用创建才满足“每次调用恰好一次”。
- **为什么成功上报要后移**：先上报再构造返回对象，若 `projectOutput` 等抛错，指标会记 success、用户却拿到兜底；后移后异常统一落到 degrade。
- **为什么兜底仍走 `degrade` 原语**：兜底话术、`onDegraded`、日志口径与既有降级路径保持一致，避免出现第二种兜底实现。
- **为什么日志只留错误类型**：AF-292 之后的隐私红线要求心理内容不进普通日志；异常 message 不可控，类型名足以定位阶段。

## 3. 闸门数字

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm exec vitest run test/engine-adapters/af292-render-round-outcome.spec.ts` | 9 passed / 0 failed（760ms） | `data/af297-target.log` |
| `pnpm typecheck` | exit 0 | `data/af297-typecheck.log` |
| `pnpm lint`（全量） | exit 0 | `data/af297-lint-full.log` |
| `pnpm test`（全量） | 279 passed / 1 skipped files；4362 passed / 4 skipped tests；0 failed（23.50s） | `data/af297-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | 交付前核对 |

## 4. 偏差与边界

- 无任务单偏差。
- 未改 metrics 名称/标签/告警阈值/看板，未碰 `engine-core`、`admin-dashboard`、Flutter。
- 异常兜底原因统一归到 `RenderFailureCause='other'`，因此 `toRoundOutcome` 映射为 `degrade`；若后续要区分“渲染内部异常”，需单列 cause，属于新口径，不在本单扩。

## 5. 遗留 backlog

- `visitor-render-exception-cause-split`：异常逃逸目前只能归为 `other`，若要按阶段（消息构造 / 运行时解析 / 返回投影）区分，需要新增 cause 与告警维度。
- AF-296 已登记的三条口径/恒等式/鉴权阈值 backlog 不重复登记。

## 6. commit message

`fix(AF-297): 渲染轮次结局恰好一次并兜底异常逃逸`
