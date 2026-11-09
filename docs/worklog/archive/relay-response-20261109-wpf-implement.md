# WP-F 实现完成回执（2026-11-09）

WP-F 成本看板合并数据源 —— **后端代码已交付，Step 0 + Step 2 两步都落地**。

## 一、这次改了什么

**Step 0（补数据源）—— 自动对练 runner 结算时把 token / 成本落库**

- `ap_practice_sessions` 新增 6 列：`prompt_tokens` / `completion_tokens` / `reasoning_tokens` /
  `total_tokens` / `total_cost_cny`（**元**）/ `cost_basis`（`full` 或 `output_only`）。
- 成本用**同一张定价表**（`LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`）+ **同一个**
  `estimateSessionCost()` 现算，单位就是人民币元 —— **没有美元字段、没有汇率**。
- token 累加挂在循环之外：引擎中途抛异常，**已经花掉的钱也不丢**；failed / running 的场次照样落成本
  （钱花了就是花了）。
- 旧列 `total_cost`（声明「美元」，全仓零写入点、恒 NULL）**不删**，但 DB 注释改成「已废弃」；
  权威字段是 `total_cost_cny`。

**Step 2（合并看板）—— 两个端点合并两张表**

- `GET /admin/api/cost/trend` → 合计（`tokens` / `costCny` / `sessions`）**+ 分来源**
  （`sessionsFormal` / `sessionsAutoPractice` / `costFormal` / `costAutoPractice` /
  `tokensFormal` / `tokensAutoPractice`），按天分桶仍是 Asia/Shanghai，缺数据的天补 0。
- `GET /admin/api/cost/sessions` → 每行带 `source`（`formal` / `auto_practice`），自动对练的行另带
  `characterSlug` / `counselorModeId` / `batchId` / `status`。

## 二、架构形态（按任务单 §5）

```
纯函数层    cost-view.ts                 buildMergedCostTrend() / buildMergedSessionList()  ← 合并口径只有这一份
   ↑
适配层      cost-source.formal.ts        查 training_sessions     → CostSourceSession[]
            cost-source.auto-practice.ts 查 ap_practice_sessions → CostSourceSession[]
   ↑
controller  admin-debug.controller.ts     只做「取两源的行 → 交给纯函数 → 返回」
```

两边归一成**同一个行模型** `CostSourceSession` 再合并 —— 口径（分桶 / 排序 / 计数规则）只有一份实现，
两张表各算一遍迟早漂。**没有拼 SQL / 没有 UNION / 没建 MySQL VIEW**；`cost-view.ts` 里的既有函数
（`aggregateSessionCost` / `buildCostTrend`）**签名一个没动**，`wp31-cost-board.spec.ts` 一个字没改。

## 三、几个关键口径（都已登记进交付记录 §五）

1. **学员请求完全不含自动对练源** —— 不只是「查了再过滤掉」，是**连表都不查**
   （`canSeeAutoPractice()` = 管理员 basic 凭据；单测断言自动对练表查询次数为 0）。
2. **成本照算、sessions 只算跑成的**：自动对练只认 `completed` / `crisis_ended` / `stagnant`；
   `failed` / `canceled` 不计 session，**但成本照算**。两个口径拆成两个字段，不互相污染。
3. **limit 语义**：每源先各取 N，合并后最多 2N 行，**不在合并后二次截断**（否则一次跑 30 场自动对练，
   limit=20 的列表会被单一来源占满）。
4. **历史场次**（`total_cost_cny` 为 null）口径标 `estimated` —— 意思是「**这个数没有口径背书**」，
   不是「这场免费」。
5. **咨询师侧 LLM 成本本期不计** —— `CounselorAgentService.generate()` 不返回 usage，咨询师侧成本当前不可得
   （与任务单 §8 一致）。所以自动对练金额只含来访者侧渲染成本，与正式训练（同样只含引擎侧）可比，
   但**不等于这场对练的真实总花费**。
6. **自动对练成本是「跑时定价快照」，正式训练是「读时按当前 env 重算」** —— 改 `LLM_PRICE_*` 之后，
   两边历史金额的漂移方式不同。这是「成本落库」这个要求自带的代价，已登记；要抹平就得改成
   「看板两源都从 token 按当前 env 重算」，那样落库列退化为审计快照 —— 留给你决定要不要做。
7. **两源 sessions 计数规则不对称**（formal 计窗口内全部场次、AP 只计跑成的），因为 formal 沿用 WP31 既有口径，
   本单不改 formal 的历史行为。

## 四、闸门数字

| 闸门 | 命令 | 结果 |
|---|---|---|
| ESLint | `npx eslint --cache "{src,test,bin}/**/*.ts"` | ✅ 0 error / 0 warning |
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 error |
| 单测（全量） | `npx vitest run --exclude "**/e2e/**/*.ts"` | ✅ 147 文件 passed + 1 skipped（148）/ 2483 例 passed + 4 skipped（2487），exit 0 |
| engine-core 红线 | `git diff --stat HEAD -- src/engine-core` | ✅ 空 |

受保护回归 `test/admin-debug/wp31-cost-board.spec.ts` **未修改任何一行**，随全量一起全绿。
本单新增 12 例（合并口径 8 例 + runner 成本落库 4 例）。

## 五、要你做的事

1. **先跑迁移，再起服务**：`pnpm migration:run`
   （`1714900000037` 加 6 列 + 改旧列注释；**漏跑迁移 = runner 结算写列直接报错**）。
2. **前端补 3 处类型**（`admin-dashboard` 归另一个 AI，本单没碰）：
   `CostTrendPoint` 加 `tokensFormal?` / `tokensAutoPractice?`；`SessionCost.costBasis` 联合类型加上 `'estimated'`；
   建议前端把 `estimated` 显示成「无口径记录」而不是「免费」。
3. **跑一场自动对练验收**：`SELECT id, status, total_tokens, total_cost_cny, cost_basis FROM ap_practice_sessions ORDER BY created_at DESC LIMIT 5;`
   预期 `total_tokens > 0`、`total_cost_cny` 有值、`cost_basis = 'full'`，数量级与同轮正式训练对得上。

## 六、交付物

- 交付记录：`docs/worklog/completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources-implementation-2026-11-09.md`
- 任务单已归档：`docs/worklog/completed/phase2.5/phase2.5-wp-f-cost-board-merge-sources.md`（状态行已指向交付记录）
- WP 登记表已加 WP-F 行：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
- 后端代码：新增 `cost-source.formal.ts` / `cost-source.auto-practice.ts` / 迁移 `1714900000037`；
  改 `cost-view.ts` / `admin-debug.controller.ts` / `admin-debug.module.ts` /
  `practice-session.entity.ts` / `practice-runner.service.ts` / `migration/index.ts` / `bin/ormconfig.ts`
- 新增测试：`test/admin-debug/wp-f-cost-board-merge.spec.ts`、`test/auto-practice/practice-runner-cost.spec.ts`

**commit message 草稿**（未执行）：

```
feat(wp-f): 成本看板合并两个数据源 — 自动对练成本/token 落库 + 两表合并趋势与会话列表
```

没有自动 `git commit` / `git push`。
