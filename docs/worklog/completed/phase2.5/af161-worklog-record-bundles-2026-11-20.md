# AF-161 交付记录 · worklog 记录包化

- 任务：AF-161 `worklog 记录包化：inbox/records 生命周期与历史迁移`
- 基线：`4059a39`
- 状态：completed
- 日期：2026-11-20

## 1. 结论

`docs/worklog` 从「pending 混放草稿、任务单、回执、参考文档」改为三段生命周期：

| 目录                               | 职责                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| `docs/worklog/inbox/`              | 只放未登记任务单草稿；登记成功即移走                               |
| `docs/worklog/records/<ctx>/<id>/` | 一任务一个不可变记录包：manifest + 任务单 + 回执副本               |
| `docs/worklog/pending/`            | 只保留 Phase2/2.5 母版、WP 清单、backlog、relay 等历史参考（只读） |

任务单登记后不可变，状态只在索引与事件链；历史迁移不改写已归档索引指针，读取侧统一由
`resolveTaskSheet` 经 manifest 回退并校验 SHA-256。迁移与校验全部经 CLI，无手工 `mv`、无手改索引。

## 2. 实现

### 2.1 新增记录包核心

`scripts/orchestration/worklog.mjs`

- `ensureTaskRecordBundle`：登记即入包，写 `manifest.json` 与任务单 SHA-256；拒绝 taskId 不匹配与非任务单文件，目标已存在且内容不同时拒绝覆盖。
- `copyReceiptToBundle`：回执入包；同 receiptId 同内容幂等，内容不同加摘要后缀留痕。
- `resolveTaskSheet`：索引指针 → manifest → canonical 三级解析。
- `resolveWorklogArtifact`：旧 `pending/af*.md` 工件按 basename 回退记录包 `legacy/`，避免看板死链。
- `verifyWorklog`：重复 taskId、缺 manifest、manifest 非法、taskId 不匹配、任务单/回执哈希、孤儿包、非终态缺任务单、终态在 inbox。
- `migrateWorklog`：任务单/回执迁移、旧 archive 任务单收养、pending 残留清尾、墓碑、幂等重跑。

### 2.2 消费方切换

| 文件                        | 改动                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `task-intake.mjs`           | 登记前查重复 taskId；任务单移入记录包后 `artifacts.taskSheet` 直接写规范路径 |
| `receipts.mjs`              | 回执默认写记录包；transport/inbox/pending 任务单搬入记录包并回写指针         |
| `scheduler.mjs`             | 归档补 manifest；快照解析旧指针与 legacy 工件，墓碑不再渲染死链              |
| `task-entry-gate.mjs`       | `docs/worklog/records/` 纳入状态面；任务单存在性改走 resolver                |
| `ci-task-gate.mjs`          | durable 回执 dual-read legacy + records；任务单存在性支持 manifest 回退      |
| `pr-release.mjs`            | `hasPassedDurableReceipt` dual-read legacy + records                         |
| `cli.mjs`                   | 新增 `worklog migrate/verify/stats`；archive 前以 resolver 固化规范指针      |
| `state-store.mjs`           | 新增 `worklogInbox` / `worklogRecords`，旧 `receiptArchiveDir` 保留兼容      |
| `.github/workflows/ci.yml`  | Orchestration Gate 增加 `worklog verify --strict`                            |
| `docs/worklog/README.md` 等 | 生命周期、inbox/records/pending README、编排 README 5.7 章节同步             |

### 2.3 迁移结果

```text
任务总数            176（活跃 1 + 归档 175）
记录包              176
任务单入包          161（含旧 archive 收养 DR-001）
回执入包            94
pending 残留清尾    5（移入各自记录包 legacy/）
终态墓碑            15（历史任务单确实不存在，不伪造）
pending 剩余        21 个文件 = 16 参考母版 + 4 relay + README
inbox 剩余          1 个 README，0 草稿
```

迁移报告：`docs/worklog/records/migration-report-2026-11-20.json`。

### 2.4 不可变与兼容

- 已归档任务的 `artifacts.taskSheet` 不回写：事件投影对 archived 条目不再接受更新，新增事件类型又受框架固定枚举约束。
- 迁移只移动证据文件 + 写 manifest，不改变状态面；逻辑指针由 `resolveTaskSheet` 保证可解析。
- 新任务从 `created` 事件起就指向记录包，天然无旧指针。
- 历史任务单与回执正文不改写，避免破坏哈希与审计链。
- `pending/archive/` 仍保留 relay 回交记录等非任务回执；新回执不再写该目录。

## 3. 闸门结果（gateResults）

| 闸门                                                           | 结果                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm orchestration:worklog verify --strict`                   | `PASS 活跃=1 归档=175 记录包=176 inbox=0 legacy指针=133 无任务单=15` |
| `pnpm exec vitest run worklog.spec.mjs orchestration.spec.mjs` | 273 passed（worklog 16 + orchestration 257）                         |
| `pnpm lint`                                                    | exit 0（TS + `scripts/**/*.mjs` 两段 ESLint 全绿）                   |
| `pnpm typecheck`                                               | exit 0                                                               |
| `pnpm test`                                                    | 222 files passed / 1 skipped；3908 tests passed / 4 skipped          |
| `events verify`                                                | 705 条事件；schema、哈希链与索引投影一致                             |
| `orchestration:preflight`                                      | PASS（无暂存越界）                                                   |

## 4. 范围核对（scopeCheck）

- commit `85b6bdb` 内 460 个文件全部落在 `scripts/orchestration/`、`docs/worklog/`、`docs/team/agent-orchestration/`、`.github/workflows/` 与编排状态面。
- `package.json`、`.husky/pre-commit`、`AGENTS.md` 未纳入该提交，改由 AF-162 在显式 scope 内收口。

## 5. 契约核对（contractChecks）

- 任务单、交付记录、回执与 commit 的 taskId 均为 AF-161。
- 状态写入只经 `task register`、`run-once`、`worklog migrate/verify` 与 snapshot，无手改索引。
- 回执为 receipt 1.0.0，六组字段齐全并声明 commit 集合。

## 6. 偏差说明（deviationTable）

1. **任务单数量与原计划不同**：原估 121 张 pending 任务单，实际迁移 160 张，因为索引中还有 `TD-5`~`TD-21`、`AF-001`~`AF-023` 一批早期任务单指针落在 `completed/phase2.5/`，内容确为任务单正文；另有 5 张 pending 残留副本移入记录包 `legacy/`。DR-001 从 `pending/archive` 收养后，任务单总数 161。
2. **133 个 legacy 指针**：已归档任务的索引仍指旧 pending 路径，读取侧 manifest 回退已覆盖；不批量改写索引是因为 archived 投影不可变。
3. **历史文档链接**：历史任务单/交付记录内的 `pending/af*.md` 引用未批量改写，属不可变证据；活文档、看板数据与 CLI 消费方已切换到 records。看板 `web/orchestration/data.js` 已重生成，旧任务单引用为 0。
4. **AGENTS.md 与本地钩子**：`AGENTS.md` 的旧“待开工看 pending”口径、`package.json` 的 `orchestration:worklog*` 别名、`.husky/pre-commit` 的 `worklog verify` 均不在 AF-161 scope 内，拆到后续 AF-162 收口；本次远端 CI 已强制 `worklog verify --strict`，记录包完整性不依赖本地钩子。

### 6.1 遗留项（backlogItems）

- 15 个终态任务无任务单：`AF-002`、`AF-039`、`AF-060`、`AF-064`、`AF-065`、`AF-066`、`AF-096`、`AF-099`、`AF-106`、`AF-110`、`AF-114`、`AF-115`、`AF-118`、`AF-142`、`AF-160`。写 `taskSheet: null` 墓碑并计入 `无任务单=15`，不补造内容。

## 7. 复现

```powershell
pnpm orchestration:worklog verify --strict
pnpm exec vitest run scripts/orchestration/__tests__/worklog.spec.mjs scripts/orchestration/__tests__/orchestration.spec.mjs
pnpm lint
pnpm typecheck
pnpm test
node scripts/orchestration/cli.mjs events verify
pnpm orchestration:worklog stats --json
```

## 8. 验收结论（reviewVerdict）

实现与全部闸门通过；首轮机读验收因任务单 CRLF 与本文缺少六组字段标记判 `rejected`，由 AF-162 规范行尾、补齐标记后复验通过。AF-161 历史状态不回写。
