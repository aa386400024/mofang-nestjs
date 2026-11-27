# AF-571 · 记录包一致性与 strict worklog 收口 — 交付记录

- **任务单**：`docs/worklog/records/phase2.5-audit-remediation/AF-571/task-sheet.md`
- **分支**：`task/AF-571-record-consistency`
- **基线**：`a4ca790df11c05c43ec3e8375b577e807c64a889`
- **日期**：2026-11-27
- **性质**：记录包/继承账修订，R0，light gate

## 一、问题与结论

AF-570 已合并，但原回执 `receipt-RC-AF-570-1.json` 的 `changedFiles.commits` 仍写着重写前的 `e003bf5f`；该提交已不在 `integrate` 上。回执不可原地改写，直接改会破坏内容哈希与审计链。

同时，不带 `--state-free` 的 `worklog verify --strict` 仍报 7 个既有孤儿记录包：AF-512/513/514/515/516/482/497。它们有 manifest、任务单、部分回执或交付记录，但缺 journal 事件。

本任务做两件事：

1. 为 AF-570 增加 `commit-rewrite-map.json`，把三个原始提交到重写提交、补录提交和 merge SHA 的映射固定下来；原回执保持只读。
2. 把 7 个历史包逐条登记进 `legacy-record-packages.json`，每条都有 reason 与存在的 evidence 文件；不补写 journal，不用 `--state-free` 全局跳过。

## 二、改动文件

| 文件 | 改动 |
| --- | --- |
| `docs/worklog/records/phase2.5-audit-remediation/AF-570/commit-rewrite-map.json` | 新增：原始/重写提交映射、AF-568 补录提交、PR #285、merge SHA |
| `docs/worklog/records/phase2.5-audit-remediation/AF-570/manifest.json` | `status` 由 `ready` 改为终态 `completed`，`updatedAt` 更新，新增 `rewriteMap` 指针 |
| `docs/team/agent-orchestration/legacy-record-packages.json` | 新增 AF-512/513/514/515/516/482/497 七条继承记录及 evidence |
| `docs/worklog/completed/phase2.5/af571-record-package-consistency-2026-11-27.md` | 本交付记录 |

## 三、AF-570 提交重写映射

| 角色 | 原始提交 | 重写后提交 |
| --- | --- | --- |
| implementation | `e003bf5fe3aec7c9e4ffb5220a0daf8686f9e27f` | `ed566647f2d2e946ad24adf32d99b950999728ad` |
| receipt-freeze | `c4649e5056758932168ec81b37225774fd1135bf` | `a5d4df951a67923b88721f64823bfa957ea51168` |
| state-plane | `347c66e2fee07ee82e71e48548828e74dd937920` | `5ec754be189402d8e44542b21f335909889dbd0e` |
| AF-568 记录包补录 | — | `e14d68c0e349ad8b0123ae59b7f15360d213d1d8` |

最终 merge SHA：`a4ca790df11c05c43ec3e8375b577e807c64a889`。

原回执的 commit 指针是**交付时刻的历史事实**，不改；映射件是追溯补充。两者一起看，才能既保哈希不变，又能追到 integrate 上的最终提交。

## 四、7 个继承包的分类

| 包 | manifest 状态 | 证据 | 结论 |
| --- | --- | --- | --- |
| AF-512 | rejected | manifest、任务单、回执、交付记录 | 会员 v2 早期包，保留 rejected 事实 |
| AF-513 | completed | manifest、任务单、回执、同一交付记录 | AF-512 返修/验收包 |
| AF-514 | backlog | manifest、任务单 | 未执行即被 AF-516 取代，保留立项证据 |
| AF-515 | backlog | manifest、任务单 | 同上 |
| AF-516 | completed | manifest、任务单、回执、交付记录 | 会员非支付闭环收口包 |
| AF-482 | submitted | manifest、任务单、回执、交付记录 | 语料测试债修复包，状态停留 submitted |
| AF-497 | submitted | manifest、任务单、两份回执、交付记录 | 缓存观测最终收口包，状态停留 submitted |

继承账只豁免这 17 个有证据的历史包，清单外的新孤儿仍会 FAIL。

## 五、闸门结果

| 闸门 | 结果 |
| --- | --- |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | exit 0，`PASS (strict)`；活跃=1 归档=507 记录包=527 继承孤儿=17/17 |
| `node scripts/orchestration/cli.mjs events verify` | exit 0，事件 2370 条，哈希链与索引投影一致 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 六、偏差与边界

1. **`worklog verify --strict` 的最终 PASS 证据以本记录落盘后的复跑为准**，不把中途“交付记录缺文件”当作通过。
2. **未补写 journal**：7 个包是历史迁移期缺事件，补写会制造伪事件；按仓库既有 `legacy-record-packages.json` 机制登记。
3. **未改 AF-570 原回执、任务单、交付记录**：原回执哈希 `12f1ac88...` 保持不变。
4. **全局 `cli validate` 仍有既有失败**：AF-534/535/557 的 `deletionChecks[0]` 不是对象，属本轮之前就存在的 schema 漂移，不在本单范围；本单任务单本身 `PASS`。

## 七、回写清单

- AF-570 记录包：新增 `commit-rewrite-map.json`，manifest 指向映射。
- 继承账：7 条历史包登记，`updatedAt` 改为 2026-11-27。
- 无新增改进台账条目；全局 validate 的 3 个旧回执 schema 漂移登记为遗留。

## 八、机读字段

| 字段 | 内容 |
| --- | --- |
| `gateResults` | `worklog verify --strict` exit 0（继承孤儿 17/17）；`events verify` exit 0（2370 条）；`git diff --stat HEAD -- src/engine-core` 空 |
| `scopeCheck` | `in-scope`：仅 AF-570 记录包、AF-571 任务包、`legacy-record-packages.json` 与交付记录 |
| `contractChecks` | taskId 一致；状态写入只经 CLI；未改 journal；任务单 schema PASS |
| `backlogItems` | 全局 `cli validate` 的 AF-534/535/557 `deletionChecks[0]` schema 漂移，属既有问题，另案 |
| `deviationTable` | 1 条：AF-570 原回执 commit 指针不原地改，改用 `commit-rewrite-map.json` 追溯 |
| `reviewVerdict` | `passed` |

## 九、commit message

```text
docs(af571): 收口 AF-570 提交映射与 7 个历史孤儿记录包
```
