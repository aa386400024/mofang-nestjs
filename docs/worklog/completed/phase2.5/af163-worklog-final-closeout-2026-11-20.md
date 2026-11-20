# AF-163 · worklog 历史证据收口与最终形态（交付记录）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-163/task-sheet.md`
- 基线：`3c8a859b855189848fb99056b59fe9135f7bfb1c`
- 日期：2026-11-20
- 角色：orchestrator

## 1. 结论

`docs/worklog` 的历史证据已收口到可审计终态：可恢复的 AF-060 任务单已从 git 历史原样收养；14 个不可恢复任务建立墓碑证据与台账；178 个记录包的交付指针与墓碑状态统一由 manifest 承载；`worklog verify --strict` 已覆盖 completed 任务交付记录存在性与终态墓碑检查；编排文档口径与 inbox/records 生命周期一致。

## 2. 改动范围与关键实现

### 2.1 `scripts/orchestration/worklog.mjs`

- `emptyManifest` 增加 `tombstone: null`，使墓碑状态成为记录包一等字段。
- 新增 `applyTaskArtifacts`：
  - 索引 `deliveryRecord` 指向真实文件时写入 manifest；
  - manifest 已有有效交付指针时保留，避免索引坏指针覆盖规范位置；
  - 无任务单时写入 `tombstone` 证据块（`status: missing`、`reason: task-sheet-not-found-in-git-history`、`recordedAt`、`deliveryRecord`）。
- `ensureTaskRecordBundle` / `ensureBundleManifest`：`contextId` 回退 `legacy`，统一调用 `applyTaskArtifacts`；支持 `recoveredFrom` 记录历史恢复来源。
- `migrateWorklog`：
  - 删除只针对 AF-002 的特殊分支，所有终态缺任务单统一走墓碑；
  - 对索引已指向 `records/` 的任务，复用现有记录包 context 与 manifest 任务单，不再重复创建 `legacy` 包（修复迁移首轮对 AF-161/AF-162 的重复建包缺陷）。
- `verifyWorklog`：
  - 新增 `missingDeliveries`；
  - 交付指针优先取 `manifest.deliveryRecord`，回退索引 `artifacts.deliveryRecord`；
  - completed 任务无交付记录判 error；
  - 终态无任务单且无 `tombstone` 判 error；
  - stats 输出 `tombstones`、`missingDeliveryRecords`、`missingDeliveryRecordIds`。
- `worklogStats` 增加墓碑计数。

### 2.2 记录包数据

- AF-060：从历史提交 `82e4a733992ea7c137ea881bd45498300d16e1fd` 的 `docs/worklog/pending/af060-phase25-exit-evidence-task-2026-11-17.md` 恢复为 `docs/worklog/records/legacy/AF-060/task-sheet.md`，manifest 记录 SHA-256 与 `recoveredFrom`。
- 14 个墓碑：`AF-002`、`AF-039`、`AF-064`、`AF-065`、`AF-066`、`AF-096`、`AF-099`、`AF-106`、`AF-110`、`AF-114`、`AF-115`、`AF-118`、`AF-142`、`AF-160`；统一写 `tombstone` 证据块。
- AF-002 交付指针写入 `docs/worklog/completed/phase2.5/af002-framework-adapter-decoupling-implementation-2026-11-15.md`。
- AF-065 交付指针改指实际合并交付 `docs/worklog/completed/phase2.5/af068-af065-scenario-type-landing-2026-11-17.md`；旧索引路径保留明确标注的转发说明，不伪造交付正文。
- 新增 `docs/worklog/records/TOMBSTONES.md` 墓碑清册（14 项 + AF-060 已恢复说明 + 维护规则）。

### 2.3 文档与 CLI

- `docs/worklog/records/README.md`：补充 `deliveryRecord` 规范位置、`tombstone`、`recoveredFrom`、strict 校验与统计口径。
- `docs/worklog/README.md`：完整性闸门改为 `worklog verify --strict`，链接墓碑清册。
- `docs/team/agent-orchestration/README.md`：`directories.taskSheets` 改为 `inbox/` + `records/`；`replyArchive` 改为 records 内 durable 回执；回执归档口径同步。
- `scripts/orchestration/cli.mjs`：`worklog stats` 输出墓碑数。

## 3. 闸门结果（gateResults）

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| lint | `pnpm lint` | exit 0，0 error |
| 类型检查 | `pnpm typecheck` | exit 0，0 error |
| 全量测试 | `pnpm test` | 222 passed / 1 skipped 文件；3914 passed / 4 skipped 用例；exit 0 |
| 定向测试 | `pnpm exec vitest run scripts/orchestration/__tests__/worklog.spec.mjs scripts/orchestration/__tests__/orchestration.spec.mjs` | 279 passed |
| 记录包校验 | `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS：活跃=1 归档=177 记录包=178 inbox=0 legacy指针=133 无任务单=14 |
| 记录包统计 | `node scripts/orchestration/cli.mjs worklog stats` | 活跃=1 归档=177 记录包=178 墓碑=14 pending=21 inbox=0 记录体积=1731.7KB |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | PASS：713 条，哈希链与索引投影一致 |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | 空输出 |

## 4. 范围核对（scopeCheck）

- 全部改动落在任务单声明的 `scripts/orchestration/`、`docs/worklog/`、`docs/team/agent-orchestration/`。
- 未改 `src/` 生产业务代码；未改 `admin-dashboard/`；未跑前端命令。
- 未改写 archived 索引旧指针，未新增事件类型，未搬迁 `pending/` 母版与 relay 历史参考。
- 记录包 manifest 的批量更新时间戳 diff 属于迁移数据面，非代码逻辑改动。

## 5. 契约核对（contractChecks）

- 任务单登记后不可变：AF-163 任务单在 `records/` 内，未原地改写。
- manifest 是工件事实源：任务单 SHA-256、交付指针、墓碑证据均落在 manifest；索引只作投影。
- 墓碑不冒充任务单：14 个终态缺任务单均无 `task-sheet` 正文，统一 `tombstone`。
- 交付指针只写真实存在的文件；`verify --strict` 对 completed 任务逐条校验。
- 编排 README 的目录映射与 CLI 实际落点一致；`relay-supervisor` 对 `pending/` 的监听属于 relay 回交路径，未改。

## 6. 遗留项（backlogItems）

| 遗留项 | 处置 |
| --- | --- |
| 133 个 archived 索引仍指旧 `docs/worklog/pending/` | 保持原样；读取侧 `resolveTaskSheet` 走 manifest 回退，避免伪造归档事件 |
| `pending/` 21 个历史参考（母版 / backlog / relay） | 按 `pending/README.md` 保留，不搬迁，避免打断不可变证据链 |
| 14 个任务单在全部 git 历史不可恢复 | 以 `tombstone` + `TOMBSTONES.md` 台账固化，不再重试伪造 |
| AF-060 任务单背景写恢复提交为 `8ed0a10` | 实际可取得的路径最早提交为 `82e4a73`，以 manifest `recoveredFrom` 为准 |

## 7. 偏差表（deviationTable）

| 编号 | 任务单/预期 | 实际 | 理由与缓解 |
| --- | --- | --- | --- |
| D1 | 任务单背景称 AF-060 任务单在 `8ed0a10` 可达 | 全历史检索到该路径最早提交为 `82e4a73`，并从中原样收养 | 以可复现的 `git show 82e4a73:path` 为准；manifest 记录来源提交，交付记录同步说明 |
| D2 | 迁移一次即可补齐 manifest | 首轮迁移对 AF-161/AF-162 因 archived 投影缺 `contextId` 重复创建 `legacy` 包 | 修正 `migrateWorklog` 复用现有 bundle context；删除误建包并补回归测试，二次迁移幂等 |
| D3 | 任务单未列 `TOMBSTONES.md` | 新增统一墓碑清册 | 14 个墓碑需要可读台账，否则只有机读 manifest，不满足企业级审计可读性 |

## 8. 验收结论（reviewVerdict）

通过。证据：全量闸门 exit 0；`worklog verify --strict` PASS 且已覆盖 completed 交付记录存在性；AF-060 任务单哈希与恢复来源可复现；14 个墓碑有 manifest 证据与统一台账；AF-065 交付指针指向真实合并记录；编排文档口径与 records 生命周期一致。

commit message：`fix(af163): 收口 worklog 历史证据与墓碑台账`
