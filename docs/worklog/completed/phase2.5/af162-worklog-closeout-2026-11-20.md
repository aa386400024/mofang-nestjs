# AF-162 交付记录 · AF-161 验收返修与编排入口收口

- 任务：AF-162 `AF-161 验收返修与编排入口收口`
- 基线：`85b6bdbd8dc83d14c9afe26422fdc0b1c983eaad`
- 实现提交：`e2b6235`（`fix(AF-162): 规范任务单行尾并收口编排入口`）
- 状态：completed
- 日期：2026-11-20

## 1. 结论

AF-161 的两条验收失败点已闭环，编排生命周期缺口补齐：

- 记录包内任务单在**登记/刷新时强制规范为 LF**，并同步 manifest SHA-256；`worklog verify --strict` 新增 `任务单含 CR 行尾` 必失败项，CI 与 pre-commit 都会拦。
- AF-161 交付记录补齐六组机读标记，AF-161 任务单与 manifest 哈希已同步。
- `package.json` 暴露 `orchestration:worklog` 与 `orchestration:worklog:verify`（后者固定 `--strict`）。
- `.husky/pre-commit` 在 `orchestration:preflight` 后执行 `worklog verify --strict`。
- `AGENTS.md` 的开工入口、待开工现场与交付步骤全部改为 `inbox` + `records` 口径。

实现过程中发现并修复一个真实缺陷：归档投影会剥离 `contextId`，`readRecordManifest` 原先按 canonical 路径定位会误报「记录包缺 manifest」；现按 `taskId` 在 `records` 下回退定位，归档任务无需回写索引即可校验。

## 2. 闸门结果（gateResults）

| 闸门                                                                                                                           | 结果                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `node scripts/orchestration/cli.mjs worklog verify --strict`                                                                   | `PASS 活跃=1 归档=176 记录包=177 inbox=0 legacy指针=133 无任务单=15` |
| `pnpm exec vitest run scripts/orchestration/__tests__/worklog.spec.mjs scripts/orchestration/__tests__/orchestration.spec.mjs` | 275 passed（worklog 18 + orchestration 257）                         |
| `pnpm lint`                                                                                                                    | exit 0（TS + `scripts/**/*.mjs` 两段 ESLint 全绿）                   |
| `pnpm typecheck`                                                                                                               | exit 0                                                               |
| `pnpm test`                                                                                                                    | 222 files passed / 1 skipped；3910 tests passed / 4 skipped          |
| `node scripts/orchestration/cli.mjs events verify`                                                                             | 709 条事件；schema、哈希链与索引投影一致                             |
| `pnpm orchestration:preflight`                                                                                                 | `PASS task=AF-162 status=submitted files=15 covered=6`               |

## 3. 范围核对（scopeCheck）

实现提交 `e2b6235` 共 15 个文件，全部落在 AF-162 声明的 scope：

- `scripts/orchestration/`：`worklog.mjs`、`__tests__/worklog.spec.mjs`
- `docs/worklog/`：AF-161/AF-162 记录包、AF-132/AF-147 任务单规范化、AF-161 交付记录
- `docs/team/agent-orchestration/`：索引、journal、snapshot 状态面
- `.husky/`、`package.json`、`AGENTS.md`
- `web/orchestration/data.js` 为 CLI 生成的编排状态面豁免物

没有触碰 `src/` 生产业务代码。

## 4. 契约核对（contractChecks）

- 任务单、回执、交付记录与 commit 的 taskId 均为 AF-162，基线为 `85b6bdb`。
- 状态面只经 `task register --status ready`、`run-once`、`worklog verify`、`snapshot` 写入，无手改索引/事件。
- 任务单登记即不可变入 `records/phase2.5-orchestration-closed-loop/AF-162/task-sheet.md`，manifest 记录 SHA-256。
- 回执为 receipt 1.0.0，六组字段齐全并声明 commit 集合。

## 5. 偏差说明（deviationTable）

| 项              | 任务单口径         | 实际                                                        | 原因与处置                                                                          |
| --------------- | ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| AF-161 历史状态 | 返修后复验通过     | AF-161 仍为 `rejected` 并已归档                             | 终态不回写；以 AF-162 作为返修任务重新交付，AF-161 交付记录只补证据标记，不改状态面 |
| CR 范围         | 规范 AF-161 任务单 | 额外发现 AF-132、AF-147 两张历史任务单同样含 CR，一并规范化 | 新校验把 CR 设为全局失败项，不能只修一张；三张均同步 manifest 哈希，未改正文语义    |
| manifest 定位   | 按记录包路径读取   | 归档投影丢失 `contextId` 时误报缺 manifest                  | 新增 `findRecordBundleDir` 按 `taskId` 回退定位；这是校验器自身缺陷，已补单测并修复 |
| AF-161 索引指针 | 规范到 records     | 归档索引仍指旧 inbox 路径                                   | 归档投影不可变；读取侧 `resolveTaskSheet` 经 manifest 回退已覆盖，不改写历史事件    |

### 5.1 遗留项（backlogItems）

- 15 个终态任务仍无任务单：`AF-002`、`AF-039`、`AF-060`、`AF-064`、`AF-065`、`AF-066`、`AF-096`、`AF-099`、`AF-106`、`AF-110`、`AF-114`、`AF-115`、`AF-118`、`AF-142`、`AF-160`。记录包以 `taskSheet: null` 墓碑呈现，`verify` 透明计数。
- 133 个历史索引指针仍指旧 `pending` 路径，由 manifest 回退解析；不回写归档投影。
- 当前分支 `task/AF-152-quality-admin` 尚未 push，远端 CI 与 PR 未触发。

## 6. 复现

```powershell
pnpm orchestration:worklog:verify
pnpm exec vitest run scripts/orchestration/__tests__/worklog.spec.mjs scripts/orchestration/__tests__/orchestration.spec.mjs
pnpm lint
pnpm typecheck
pnpm test
node scripts/orchestration/cli.mjs events verify
pnpm orchestration:preflight
```

## 7. 验收结论（reviewVerdict）

AF-161 验收失败点已全部消除，编排入口与本地/远端门禁形成闭环；实现、单测、全量测试、类型检查、lint、事件链与记录包严格校验全绿。AF-161 历史 `rejected` 保留不改，AF-162 以返修任务完成收口。
