# AF-085 · Phase 2.5 出口条件②生产入口复核与双跑确定性取证

> 交付日期：2026-11-18
> 任务单：[af085-phase25-exit2-verification-task-2026-11-18.md](../../pending/af085-phase25-exit2-verification-task-2026-11-18.md)
> 基线：`86b9f0816f406d5e9d783dd5ff30bd44d542957a`（= 本单起点 `integrate` HEAD）
> 分支：`task/AF-085-phase25-exit2-verification`

## 1. 结论

出口条件②的**生产入口缺口**已在 AF-068 修复，Phase 2.5 README §3.2 仍保留“`BatchBody` 无 `scenarioType`、生产 HTTP 无法创建 exam 批次”的旧口径，属于文档漂移。

本单复核了 AF-068 的四段链路（HTTP 入口 → 队列 → worker → runner），并新增一条**入口层双跑确定性用例**：同一 `exam` 批次请求连续两次，两次入队 payload 除 `batchId` 外逐字段一致。结合既有 `exam` 恒 `rule_only` 定向用例，出口②的代码口径已可判定为“入口与单测达标”。

**未完成部分（必须保留）**：真实 `exam` 批次双跑尚未执行；本单不把入口层确定性用例写成真实批次结论。README 已按此口径纠正为 `🚧 入口与单测达标 / 真实双跑待取证`。

## 2. 复核证据

### 2.1 AF-068 已落地的四段链路

| 段 | 证据 | 结论 |
| --- | --- | --- |
| HTTP 入口 | `src/auto-practice/auto-practice.controller.ts:52-68` 的 `BatchBody.scenarioType`；`:159-162` 非法值先校验；`:174` 显式场景才写键 | 生产 HTTP 可创建 `exam` 批次；非法值 0 入队 |
| 队列 | `src/auto-practice/practice-queue.service.ts:51` 的 `AutoPracticeJobData.scenarioType`；`processJob()` 原样透传 | job data 保留场景，不二次映射 |
| worker → runner | `practice-queue.service.ts:191` 调 `runner.run({ ..., scenarioType: data.scenarioType })` | `undefined` 由 runner 侧兜 `full_simulation`，缺省语义只留一份 |
| 引擎红线 | `test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts`、`test/engine-adapters/model-event-classifier.spec.ts` | `exam` 恒 `rule_only`，即使全局 `llm_active` / 白名单命中也不放行 |

### 2.2 本单新增用例

文件：`test/auto-practice/batch-scenario-type.spec.ts`

用例：`exam 双跑确定性: 同一请求连续两次 → payload 除 batchId 外逐字段一致`

断言：

- 两次请求均为 201，各入队 2 个 job（`repeats=2`），合计 4 个；
- 第二次的两个 job 与第一次的两个 job 相比，去掉 `batchId` 后 `toEqual`；
- 两次的 `scenarioType` 均为 `exam`。

这条用例锁的是“入口层可复现”：如果将来有人在入口改写、丢字段或按请求生成随机参数，双跑会在入口层就不可比。

## 3. README 回写

`docs/worklog/pending/phase2.5-README.md`：

- 表头日期改为 `2026-11-18`；
- §3.2 出口②由“`BatchBody` 仍只有四个字段 / 生产 HTTP 无法创建 exam 批次”改为“AF-068 已通生产入口 + AF-085 双跑入口确定性 + exam 恒 rule_only 定向用例”；
- 明确保留“真实 exam 批次双跑尚未执行”，判定维持 `🚧`，不把单测层证据升级为出口结论；
- 追加 AF-085 取证任务说明。

## 4. 改动文件清单

| 文件 | 改动 | 性质 |
| --- | --- | --- |
| `test/auto-practice/batch-scenario-type.spec.ts` | 新增 1 个双跑确定性用例（+26 行） | 测试 |
| `docs/worklog/pending/phase2.5-README.md` | 出口②状态与表头日期纠正 | 文档 |
| `docs/worklog/completed/phase2.5/af085-phase25-exit2-verification-2026-11-18.md` | 本交付记录 | 文档 |

**未改**：`src/` 业务代码、`src/engine-core`、`.env`、数据库、Redis、任务队列运行态。

## 5. 闸门（真实数字）

| 闸门 | 命令 | exit | 结果 |
| --- | --- | --- | --- |
| 定向三文件 | `corepack pnpm exec vitest run test/auto-practice/batch-scenario-type.spec.ts test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts test/engine-adapters/model-event-classifier.spec.ts` | 0 | **3 files / 89 tests passed / 0 failed**（2.13s） |
| Lint | `corepack pnpm lint` | 0 | **0 error / 0 warning**（仅 node engine WARN：v22.23.2 vs >=26） |
| 全量单测 | `corepack pnpm test` | 0 | **207 files passed / 1 skipped；3683 tests passed / 8 skipped；21.38s** |
| 类型检查 | `corepack pnpm typecheck` | 0 | **0 error** |
| 状态事件链 | `node scripts/orchestration/cli.mjs events verify` | 0 | **361 条事件**，schema 1.0.0，哈希链与索引投影一致 |
| 契约校验 | `node scripts/orchestration/cli.mjs validate` | 0 | **0 FAIL**（35 项 PASS） |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | 0 | **空**（内核一行未动） |

> 全量单测 3683 例，较 AF-084 的 3682 例恰好 +1，增量只来自本单新增用例，既有用例零回归。

## 6. 偏差与边界

1. **不改生产入口**：AF-068 已把入口链路做完；本单只补双跑确定性测试与文档纠正，不改业务代码。
2. **不跑真实 exam 批次**：本单不连库、不发 LLM，真实双跑仍需另立取证单；README 明确保留该缺口。
3. **不改 `engine-core`**：内核 diff 为空；`exam` 恒 `rule_only` 由既有定向用例证明，不新增内核断言。
4. **不清理并行产物**：工作树内其他任务产物未移动、未还原、未纳入本单声明集。

## 7. 结论

- `finalStatus`: `completed`
- `reviewVerdict`: `passed`
- `verdictRationale`: AF-068 的生产入口链路复核通过；本单新增同一 `exam` 请求连续两次的入口确定性用例，定向 89 例、全量 3683 例、lint、typecheck、validate、events verify 全部通过；README 旧口径已纠正，并诚实保留“真实 exam 批次双跑未执行”的缺口，未越 scope、未改内核与业务代码。
