# AF-598 · 记录包生成器跨平台哈希与未合并分支提示加固

> 交付日期：2026-11-28
> 执行方：自做
> 分支：task/AF-598-worklog-record-hardening
> 基线：39790d73d41d024af49d8ffab250bd6a4c0a709f（integrate，PR #307 squash 后）
> 唯一事实源：AF-597 PR #307 的 Orchestration Gate 失败证据

## 1. 问题

AF-597 的 PR 门失败暴露两类记录包欠账：

- AF-593/594/595 的 `task-sheet.md + manifest.json` 只存在于各自未合并任务分支，记录包没有进入 `integrate`；
- AF-596 manifest 保存的是 CRLF 任务单哈希 `f1a04e…`，仓库实际提交的是 LF blob `32c04910…`，Linux CI 因此判哈希不匹配。

根因不是业务代码，而是记录包生成器把“原始文本哈希”当作任务单身份，Windows 工作树的 CRLF/BOM 会直接改变 manifest 口径。

## 2. 改动

### 2.1 任务单哈希统一规范口径

`scripts/orchestration/worklog.mjs` 新增并导出 `sha256TaskSheet(file)`：

1. 读取 UTF-8 文本；
2. `normalizeLf()` 去除 BOM，并把 CRLF / 孤立 CR 统一为 LF；
3. 对规范化文本计算 SHA-256。

登记、迁移、verify 与任务单去重比较全部切到该口径；回执仍保留原始文件哈希，二者不混用。

### 2.2 登记与迁移自动规范化

- `ensureTaskRecordBundle()` 在写 manifest 前调用 `normalizeTaskSheetLineEndings()`，复用 `text-normalize.mjs` 的 `normalizeTextFile()`，一次性去 BOM + CRLF。
- `ensureBundleManifest()` 在迁移路径同样先规范化任务单，再写 manifest，堵住旧任务单入包时继续产出 CRLF 哈希。
- 任务单重复源与目标比较改用规范哈希，避免同内容因 BOM/换行不同被误判为“内容不同”。

### 2.3 verify 可行动提示

- 缺 manifest：优先用本地 git 定位任务单所在分支，错误信息点名“记录包只存在于未合并分支：task/…”；CI 浅检出或非 git 环境回退到通用提示，不阻塞。
- 哈希不匹配：提示“若仅 CRLF/BOM 差异，先 `docs normalize --path … --apply`，再 `worklog migrate --apply` 重算”。
- manifest 哈希正确但任务单仍是 CRLF/BOM：提示具体文件路径与 `docs normalize --path … --apply` 命令。
- `acceptance-runner.mjs` V5 的 BOM / CR 拒收信息补上同样的修复命令，避免只报“含 CR”让人猜。

## 3. 验证

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__` | 23 files / 465 passed / 0 failed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error |
| `pnpm test` | 369 passed + 1 skipped（370 files）；5216 passed / 0 failed / 4 skipped；323.35s |
| `node scripts/orchestration/cli.mjs worklog verify --strict --state-free` | PASS；活跃 1 / 归档 534 / 记录包 554 / 继承孤儿 17 |
| `git diff --stat HEAD -- src/engine-core` | 空；engine-core 零 diff |

新增定向测试 `scripts/orchestration/__tests__/af598-worklog-record-hardening.spec.mjs` 共 7 例：

- LF / CRLF / BOM+CRLF 同内容同哈希；
- 登记后任务单无 BOM + LF，manifest 使用规范哈希；
- 迁移旧 pending 的 BOM+CRLF 任务单后写规范哈希；
- 缺 manifest 提示未合并且点名具体分支；
- 哈希不匹配提示 `worklog migrate --apply`；
- manifest 哈希正确但文件 CRLF 时提示 `docs normalize`。

## 4. 影响与边界

- 既有 manifest 若保存的是 CRLF 原始哈希，`verify` 会继续报哈希不匹配并给出迁移命令；这是预期诊断，不是自动改写历史证据。
- 本地 git 分支提示依赖 refs 可见；CI 浅检出可能只给通用提示，但不会因此误判通过。
- 不改状态机、事件链、PR 合并门语义；不新增依赖；`src/engine-core` 零 diff。
- 未合并任务分支的记录包恢复仍由人决策，本任务只负责在 PR 门之前把缺口说清楚。

## 5. 提交

本任务分支按单提交交付：`fix(af598): canonicalize worklog task-sheet hashes`，提交信息带 `Task: AF-598` trailer。回执不声明自引用 commit hash，改用 `changedFiles` 交付文件集作为验收声明；最终提交 SHA 以 PR HEAD 为准。
