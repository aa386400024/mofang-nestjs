# 记录包任务单墓碑清册

本文件是 `docs/worklog/records/**/manifest.json` 中 `tombstone` 证据块的可读索引，不是任务单的替代品。墓碑表示：该任务已经进入终态，但任务单正文在全部 git 历史与远程分支中均不可恢复；记录包保留空 `taskSheet`，并用 `tombstone` 明确记录缺失事实、原因与可核验的交付证据。

## 判定口径

- 扫描范围：`git rev-list --all --count` = 883 个提交，覆盖全部本地与远端可达分支。
- 任务单判定：按 `taskId` 在提交历史中检索任务单正文与任务单路径；只有正文可原样取得且 `taskId` 匹配，才允许收养为 `task-sheet.md`。
- 交付记录判定：以任务索引的 `deliveryRecord` 指针为线索，实际文件存在才写入 manifest；指针失效时以真实合并交付记录为准，不伪造正文。
- 不可恢复：不将交付记录、回执或索引条目冒充任务单；统一写 `tombstone.status = missing`、`reason = task-sheet-not-found-in-git-history`。

## 清册（14 项）

| 任务 | 终态 | 任务单 | 交付证据 | 说明 |
| --- | --- | --- | --- | --- |
| AF-002 | completed | 缺失（墓碑） | `docs/worklog/completed/phase2.5/af002-framework-adapter-decoupling-implementation-2026-11-15.md` | 历史中只有交付记录出现 `taskId`，无任务单正文。 |
| AF-039 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-064 | canceled | 缺失（墓碑） | 无 | 虽存在本地任务分支，但按 `taskId` 未检索到任务单正文。 |
| AF-065 | completed | 缺失（墓碑） | `docs/worklog/completed/phase2.5/af068-af065-scenario-type-landing-2026-11-17.md` | 原索引交付指针失效；实际交付已合并到 AF-068 落地记录，正文明确覆盖 AF-065。旧路径保留转发说明。 |
| AF-066 | canceled | 缺失（墓碑） | 无 | 虽存在本地任务分支，但按 `taskId` 未检索到任务单正文。 |
| AF-096 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-099 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-106 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-110 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-114 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-115 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-118 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-142 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |
| AF-160 | canceled | 缺失（墓碑） | 无 | 取消任务，未留下任务单正文。 |

## 已恢复任务

AF-060 的任务单已从历史提交 `82e4a733992ea7c137ea881bd45498300d16e1fd` 的 `docs/worklog/pending/af060-phase25-exit-evidence-task-2026-11-17.md` 原样收养到 `docs/worklog/records/legacy/AF-060/task-sheet.md`。manifest 记录 SHA-256，并在 `recoveredFrom` 中保留来源提交与原始路径，因此不再计入墓碑。

## 维护规则

- 新增墓碑必须由 `worklog migrate` 或记录包工具写入 `tombstone` 证据块；不得手工只改索引或只写本表。
- 任务单一旦恢复，必须同时更新 manifest 的 `taskSheet`、`sha256` 与 `recoveredFrom`，并从本表移除。
- `worklog verify --strict` 会阻断“终态任务无任务单且无墓碑”的记录包。
