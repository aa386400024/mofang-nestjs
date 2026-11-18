# AF-078 squash 多任务 scope 并集交付记录

- 任务单：`docs/worklog/pending/af078-squash-scope-union-task-2026-11-18.md`
- 任务 ID：`AF-078`
- 分支：`task/AF-078-squash-scope-union`（自 `integrate` 的 `2ab76f0` 切出）
- 日期：2026-11-18
- 结论：`passed`

## 1. 背景与根因

PR #24 以 squash 合并后，integrate push 的 Orchestration Gate 报：

```text
FAIL 2ab76f031151 reason=scope-residual subject=feat(orchestration): AF-075 ...
  - 暂存文件越出任务 AF-075 的 scope
```

任务分支 `task/AF-075` 上依次叠加了 AF-075、AF-076、AF-077 三个已完成任务，squash 后成为一个提交。门禁只从标题解析 `AF-075`，只加载 AF-075 的 scope，于是 AF-076 引入的 `ci-task-gate.mjs`、AF-077 引入的 `pr-release.mjs` 全被判越界。

这不是任务单漏写，是框架在「stacked 任务 squash」场景缺少多任务 scope 合并语义。逐个补 scope 只能救一次。

## 2. 修改

- `scripts/orchestration/ci-task-gate.mjs`
  - 新增 `unionSquashScopeFiles`：按文件顺序合并多个任务 scope 并去重，空集合回退主任务 scope。
  - `evaluateCommitAt` 在 squash 全生命周期分支中扫描本次提交实际携带的任务单：
    - 只接纳 `status=completed`、任务单在本次改动中、且该任务自身有可合并 durable 回执的任务；
    - 从任务单恢复各自 scope，取并集后写回标题主任务的校验快照；
    - canceled/rejected、无回执、回执不可合并、任务单不在本次提交内的任务一律不进入并集。
  - 单任务 squash 的并集只有一个成员，行为与现状一致。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 新增并集去重与空集合回退用例。
- `docs/team/agent-orchestration/README.md`
  - 远端门「状态快照」行补充 stacked squash 的并集语义。

未改 `src/` 业务代码；未放宽 completed、可合并回执、任务单存在性这些硬条件。

## 3. gateResults（闸门结果）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| `corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 1 file / **242 tests passed / 0 failed**，609ms |
| `corepack pnpm lint` | 0 | 0 error / 0 warning；scripts 段覆盖生效；仅 node engine WARN（v22.23.2 vs >=26） |
| `node scripts/orchestration/ci-task-gate.mjs --base fbe2470 --head 2ab76f0` | 0 | 原失败提交复跑：`PASS task=AF-075 reason=archived-transition files=33` |
| `node scripts/orchestration/cli.mjs validate` | 0 | 26 项 PASS（状态索引 / 工具契约 / 协议视图 / 交付包 / Agent Card / AF-070–AF-078 回执与运行态任务单 / 事件日志 schema+哈希链 / 索引投影） |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 事件日志 **329 条**；schema + 哈希链 + 索引投影一致 |

## 4. scopeCheck（范围核对）

`in-scope`。改动仅 `scripts/orchestration/ci-task-gate.mjs`、编排单测、适配层 README、任务单与本交付记录。状态面生成物按 V7 豁免。未触碰业务 `src/`、数据库、Redis、LLM 批次。

## 5. contractChecks（契约核对）

- `taskId` 贯穿任务单、交付记录、回执：`AF-078`。
- 状态写只经 CLI：`task register` → `task promote` → `run-once` → 回执摄入 / 归档。
- 并集只接纳 completed + 可合并回执 + 任务单在本次提交内的任务，不能用历史任务扩大 scope。
- 标题主任务仍必须是 completed/archived 且任务单存在；单任务行为不变。
- 未新增框架 tag/release；L4 冻结动作仍未执行。

## 6. backlogItems（遗留登记）

无新增。

## 7. deviationTable（偏差说明）

| 项 | 任务单原方案 | 实际实现 | 原因 |
| --- | --- | --- | --- |
| 并集成员识别 | 按提交标题/正文任务编号 | 按本次提交实际携带的任务单路径 | squash 标题只保留主任务，正文也不含 stacked 任务编号 |
| 并集准入 | 只要求 completed | 追加「该任务自身可合并回执 + 任务单在改动内」 | 防止用历史任务扩大 scope |
| 空集合 | 不处理 | 回退主任务 scope | 保持单任务路径稳定 |

## 8. reviewVerdict（验收结论）

`passed`。

理由：单测 242 项全绿，lint 0 error / 0 warning；原失败提交 `2ab76f0` 本地复跑已 PASS；并集只在已完成、已验收、任务单实际随提交落地的任务之间生效，未降低硬门强度。
