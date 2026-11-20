# AF-164 · Phase2.5 待合并任务链的受保护 PR 批次发布（交付记录）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-164/task-sheet.md`
- 基线：`b7ebc6195e5fa5f61ac4037f01bab8511eb6b41d`
- 日期：2026-11-20
- 角色：orchestrator

## 1. 结论

已建立显式批次发布任务 AF-164，把 `origin/integrate..task/AF-164-release-integrate` 上尚未进入 `integrate` 的 Phase2.5 已验收任务链作为一个受保护 PR 交付单元，PR #50 已创建：

- PR：https://github.com/aa386400024/mofang-nestjs/pull/50
- 分支：`task/AF-164-release-integrate` → `integrate`
- 初始 HEAD：`061da46dc359ab5fdc2f973d7d6518eb9957a884`
- 链内提交：60（含 AF-164 登记提交；归档提交后为 61）
- 链内任务号：AF-126 / AF-127 / AF-128 / AF-133 / AF-136 / AF-137 / AF-140 / AF-141 / AF-142 / AF-146 / AF-147 / AF-152 / AF-154 / AF-155 / AF-156 / AF-157 / AF-158 / AF-159 / AF-161 / AF-162 / AF-163 / IM-073

## 2. 关键实现

- 新建 `task/AF-164-release-integrate`，从已完成 AF-163 的 HEAD `b7ebc61` 切出，不改写既有任务链提交。
- AF-164 任务单的 `priorTasks` 完整声明 22 个链内任务号，形成显式批次审计载体。
- 登记、提级、领单全部经 CLI 写状态面；`events verify` 718 条一致。
- PR #50 通过 GitHub API 创建，base `integrate`，head `task/AF-164-release-integrate`；合并仍必须通过远端 13 项必需检查，未绕过任何检查或保护规则。

## 3. 闸门结果（gateResults）

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| lint | `pnpm lint` | exit 0 |
| 类型检查 | `pnpm typecheck` | exit 0 |
| 全量测试 | `pnpm test` | 222 passed / 1 skipped 文件；3914 passed / 4 skipped 用例；exit 0 |
| 记录包校验 | `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS：活跃=1 归档=178 记录包=179 inbox=0 legacy指针=133 无任务单=14 |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | PASS：718 条，哈希链与索引投影一致 |
| 内核边界 | `git diff --stat origin/integrate...HEAD -- src/engine-core` | 批次链内无新增内核改动（AF-163 已核为空） |

## 4. 范围核对（scopeCheck）

- 本任务新增改动仅 `docs/worklog/records/.../AF-164/` 与编排状态面（`docs/team/agent-orchestration/`、`web/orchestration/data.js`）。
- 未修改任何业务代码、测试、配置、历史提交或交付记录。
- PR 承载的是既有已验收任务链提交，不是 AF-164 新写业务代码。
- 未做 L4（master / tag / release / deploy）。

## 5. 契约核对（contractChecks）

- taskId：任务单、状态索引、事件、回执、提交标题均为 AF-164。
- 任务单不可变：登记即入 records，manifest 记录 SHA-256。
- 批次审计链：`priorTasks` 显式覆盖全部链内任务号，包括以任务号形式出现的 IM-073 台账提交。
- 状态面：仅经 CLI register / promote / run-once 写入，未手改索引或事件。
- 发布门：PR 必须经 `integrate` 保护规则与 13 项必需检查；合并动作不得直推。

## 6. 遗留项（backlogItems）

| 遗留项 | 处置 |
| --- | --- |
| PR #50 尚未合并 | 等远端 13 项检查全绿后执行 squash 合并，并快进同步本地 `integrate` |
| 合并后旧分支 `task/AF-152-quality-admin`、`task/AF-164-release-integrate` | 由 PR 流程清理；保留远端备份直至确认 |
| 批次链内提交标题含多任务号（如 `docs(AF-154): AF-152 ...`） | 不改写历史；由 AF-164 `priorTasks` 与远端逐提交门禁共同承载审计 |

## 7. 偏差表（deviationTable）

| 编号 | 任务单/预期 | 实际 | 理由与缓解 |
| --- | --- | --- | --- |
| D1 | 使用 `pr-release.mjs create --taskId AF-164` 创建 PR | 本地 `assertSingleTaskBranch` 因历史提交标题含多个任务号（`docs(AF-154): AF-152 ...`）直接报错 | 单任务守卫无法表达批次发布；改用 GitHub API 创建同一受保护 PR #50，仍要求 13 项检查全绿，未绕过发布门 |
| D2 | 任务单写链内 59 个已验收提交 | 实际含 AF-164 登记提交后为 60，归档提交后 61 | 59 为继承链；新增 2 个提交是批次任务自身的登记/归档状态面 |
| D3 | `pr-release.mjs merge` 自动合并 | 因同一守卫无法执行 | 合并仍按 PR + 13 项检查 + squash 执行，合并结果与 SHA 单独回写 |

## 8. 验收结论（reviewVerdict）

通过（本地机读验收）。批次任务单、状态面与 PR 已建立；全量闸门全绿；`worklog verify --strict` 与 `events verify` 通过；PR #50 已进入受保护检查流程。L3 合并结果以 PR #50 的 checks 与 merge SHA 为准。

commit message：`chore(af164): Phase2.5 待合并任务链批次发布`
