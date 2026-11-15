# 回执 / 交付记录模板（mofang 适配层 · 路径约定与命令示例）

> 七组字段骨架、字段定义与交付前自查清单以框架仓 `templates/receipt.template.md` 与 `docs/receipt-contract.md` 为准，本文件不复制字段定义。
> 任务单契约：`docs/team/wp-task-template.md`；验收五类核对：`acceptance-checklist.md`。

---

## 1. 项目路径约定

| 工件     | 落点                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 交付记录 | `docs/worklog/completed/<phase>/<taskId>-<slug>-implementation-YYYY-MM-DD.md` |
| 回执原文 | `docs/worklog/pending/archive/relay-response-YYYYMMDD-HHMM.md`                |
| 工件指针 | 任务单、交付记录、回执原文及其他规格 / 报告路径；状态索引只存指针，不复制正文 |

## 2. 任务标识 frontmatter（项目取值示例）

```yaml
---
taskId: TD-21
contextId: phase2.5-c2-ports
type: implementation # 框架枚举：implementation / review / investigation / documentation / fix / verification
baselineRef: 2b03756
dependsOn: [TD-20]
policyRefs: [conventions.md#1.1, conventions.md#1.3]
finalStatus: completed # completed / failed / rejected
reviewVerdict: passed # passed / conditional-pass / rejected
---
```

> `taskId` 必须与任务单 frontmatter、状态索引、commit message 一致；`contextId` 用于同主题多任务归组，返修新任务沿用同一 `contextId`。
> 历史任务用过的类型名映射：`repository-port` / `feature` → `implementation`；`docs` → `documentation`；`fix`、`verification` 保持不变。

## 3. 证据组 · 项目闸门命令示例

下表为本项目 `gates` 取值示例；实际命令、阈值与适用范围以任务单 §5 与 `conventions.md` §1.3 为准。

| 闸门              | 命令                                                                    | 退出码 | 错误 | 警告 | 用例 / 文件数                      | 备注（机器状态、墙钟）                     |
| ----------------- | ----------------------------------------------------------------------- | ------ | ---- | ---- | ---------------------------------- | ------------------------------------------ |
| 类型（根 tsc）    | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0      | 0    | —    | —                                  | —                                          |
| 类型（build tsc） | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0      | 0    | —    | —                                  | —                                          |
| Lint              | `pnpm lint`                                                             | 0      | 0    | N    | —                                  | 记 warning 数                              |
| 定向测试          | `pnpm exec vitest run test/counselor/`                                  | 0      | —    | —    | 19 文件 / 287 例                   | —                                          |
| 全量测试          | `pnpm test`                                                             | 0      | —    | —    | 200 文件 / 3377 passed + 4 skipped | 墙钟与机器状态（是否有常驻进程、盘读延迟） |
| 边界              | `git diff --stat HEAD -- src/engine-core`                               | 0      | —    | —    | 空                                 | 内核零改动或例外批准                       |

**reproNotes**：关键路径如何复现；失败项定性（确定性缺陷 / 偶发 flake）；既有债基线与本任务新增改动分开记录。数字必须能由命令重新跑出，不留「待用户执行」。

## 4. 其余六组字段（框架骨架 · 本项目填法注意）

字段名与填写要求按框架模板 §1（落地）、§3（范围）、§4（契约）、§5（遗留）、§6（偏差）、§7（结论）；本项目注意：

- **范围组**：`scopeCheck`（改动是否全部落在任务单切片）、`parallelArtifactsExcluded`（并行产物是否排除）、`noOutscopeRefactor`（是否无相邻重构）。
- **契约组**：`contractChecks`（契约逐条比对）、`schemaVersion`（本任务遵循的框架 schema 版本，当前 1.0.0）、`fieldAlignment`（共享字段对齐；真相源唯一，消费端不复算口径）。
- **遗留组**：`backlogItems`（编号 / 影响面 / 排期）、`openQuestions`、`manualReviewList`。
- **偏差组**：任务单写法 / 代码现实 / 实际处理 / 理由四列；先 grep 核实真实链路，不默默改、不降级质量；无偏差填「无」。

## 5. 交付前回写清单（项目操作）

- [ ] 七组字段全部填写，无「待用户执行」占位；
- [ ] `taskId / contextId / baselineRef` 与任务单、状态索引一致；
- [ ] 工件指针路径真实存在；
- [ ] 闸门数字与现场可复现结果一致；
- [ ] 遗留项已登记 backlog，未在本任务清理；
- [ ] 任务单与交付记录成对归档到 `completed/<phase>/`；
- [ ] 状态索引已更新（状态迁移追加 `history`）；
- [ ] commit message 草稿关联 `taskId`（不自动 commit / push）。
