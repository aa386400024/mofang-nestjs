# AF-424 交付记录：历史孤儿记录包纳管（显式继承清单）

- 日期：2026-11-24
- 任务：AF-424（fix / orchestrator，承接 AF-423 重签发）
- 基线：`8bac4cda848eb0046029974748f48f5f6c29239d`（AF-422 合并点）
- 分支：`task/AF-424-legacy-record-packages`
- 结论：`worklog verify --strict` 不再需要 `ORCH_STATE_FREE=1`；孤儿豁免从「全局开关」收敛为「逐条继承账」，清单外孤儿、清单过期条目、清单自身非法全部硬失败。

## 1. 问题

2026-11-23 框架 v2.1 迁移留下 10 个记录包（AF-363/364/365/366/367/368/369/370/372/376）：有 `manifest.json`、任务单，多数有回执与交付记录，但迁移早于 journal 落盘，事件链里没有它们的 `create / completed / archive` 事件，因此不在索引投影内。

`verifyWorklog` 对这类包报 `孤儿记录包`。此前的规避办法是 `ORCH_STATE_FREE=1` / `--state-free`——它同时会跳过**索引投影校验与所有孤儿检查**，等于给未来任何新孤儿开了同一个后门，且这个开关已经常态化出现在提交命令里（属性上属于旁路）。

## 2. 改法

### 2.1 数据面：版本化继承清单

新增 `docs/team/agent-orchestration/legacy-record-packages.json`：

```json
{
  "version": "legacy-record-packages:1.0.0",
  "packages": [{ "taskId": "AF-363", "reason": "…", "evidence": ["…/manifest.json", "…/task-sheet.md", "…/af361-…-2026-11-23.md"] }]
}
```

10 条逐条写清 `reason` 与 `evidence`（manifest、任务单、回执、交付记录的实际路径），可被机器与人同时核对。

### 2.2 逻辑面：`loadLegacyRecordPackages` + verify 三分类

- 新增导出 `loadLegacyRecordPackages({ rootDir })`：文件不存在时返回空账（新仓/临时根静默），存在时校验版本、`packages` 数组、`taskId` 格式与唯一性、`reason` 非空、`evidence` 非空且文件真实存在；任一不满足按普通错误报出。
- `verifyWorklog` 把记录包分成三类：
  - **legacy 孤儿**：不在索引但在清单内 → 计入 `stats.legacyOrphans`，不报错，打印一次（带清单路径）；
  - **真孤儿**：不在索引且不在清单 → 仍报 `孤儿记录包`；
  - **过期清单项**：清单条目已进入索引、或对应记录包已不存在 → 报 `继承清单已过期`，强制移除，防止清单变成永久豁免。
- `stats` 新增 `legacyRecordPackages / legacyOrphans / legacyOrphanIds / staleLegacyIds`，返回值新增 `legacyOrphans / staleLegacy`。
- `ORCH_STATE_FREE` / `--state-free` 保留为临时调试开关（仍连带跳过索引投影校验），但不再是常规路径；CI strict verify 不再依赖它。

### 2.3 文档面

`docs/team/agent-orchestration/README.md` 新增 §5.7.1：清单是单一真相源、三分类语义、维护纪律（先判「补登事件链」还是「确属迁移遗留」，只有后者写清单）。

### 2.4 顺带收口

两份 MiniMax 回交原文（`relay-response-AF414-review-20261124-0415.md` 43KB、`relay-response-BDI-20261124-0230.md` 33KB）此前一直是 untracked，现已纳入版本控制（`docs/worklog/pending/archive/`），避免换机/清理时丢失唯一的评审证据。

## 3. 闸门数字

| 闸门               | 命令                                                                                   | 结果                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 定向单测           | `pnpm exec vitest run scripts/orchestration/__tests__/worklog.spec.mjs`                | 1 文件 / 28 用例全绿（原 22 + 新增 6），236ms                                         |
| 编排单测           | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`          | 1 文件 / 272 用例全绿，1.479s                                                         |
| 真实 strict verify | `node scripts/orchestration/cli.mjs worklog verify --strict`（不带 `ORCH_STATE_FREE`） | 未落交付记录前只剩本单自身一条错误，孤儿错误 0；打印 `继承孤儿=10/10` 与 10 个 taskId |
| lint               | `pnpm lint`                                                                            | 0 error（仅 pnpm node>=26 engine warning）                                            |
| typecheck          | `pnpm typecheck`                                                                       | 0 error                                                                               |
| 全量测试           | `pnpm test`                                                                            | 320 passed / 1 skipped（文件），4838 passed / 4 skipped（用例），29.32s               |
| 内核边界           | `git diff --stat HEAD -- src/engine-core`                                              | 空输出                                                                                |

## 4. 关键设计决策与偏差

1. **不做「补登进事件链」**：事件链是哈希链，补造 10 个历史事件的 `prevHash` 无法与当时的时间点对齐，属于伪造证据；继承清单是诚实的替代方案（保留「有记录包但无事件」这个事实，并把它显式化）。
2. **不用 `legacyPaths` 之类的隐式回退**：清单校验 evidence 文件必须存在，避免清单里的证据指针慢慢腐烂。
3. **过期即失败而非警告**：清单条目一旦进入索引就报错，确保这个机制有退出路径，不会沉淀成第二套永久白名单。
4. **`stateFree` 保留**：不删开关，是因为它仍承担「状态面解耦下索引暂不可判」的语义；但常规提交不再需要它，任务单与 README 都写明降级为调试用。

## 5. 遗留与后续

- 清单当前 10 条，是快照账，不是终态；后续若真要把这 10 个包纳回索引，需要单独一个任务设计「孤儿补登」的合法路径（不能靠伪造事件）。
- 本任务已把「孤儿豁免」的旁路收掉；`docs/team/agent-orchestration/README.md` 需在下一轮治理时同步检查其他文档里残留的 `ORCH_STATE_FREE` 常规用法示例。

## 6. 编号变更（AF-423 → AF-424）

AF-423 任务单的 `scope.files` 漏写 `docs/worklog/completed/phase2.5/`，导致交付记录被 `receipt freeze` 判为越界。按 AF-084「scope 不原地改写」规则，AF-423 已 `task cancel`（原因：scope 缺 `docs/worklog/completed/phase2.5/` → 重签发），实现与交付同一批文件由 AF-424 承接；AF-423 分支未提交任何内容，随之废弃。
