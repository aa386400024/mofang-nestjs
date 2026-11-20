# AF-221 子项 01 交付记录 · 跨机单写者锁与任务生命周期一致性硬化

- 任务：AF-221（批次子项 01，`phase3-orchestration-hardening`，orchestrator）
- 基线：`f32b62b`（`origin/integrate`，另一台机器 AF-213 合入后）
- 角色：orchestrator（资源域：`scripts/` + `docs/team/agent-orchestration/` + `docs/security/` + `package.json`）
- 交付日期：2026-11-21

## 1. 问题与根因

三次现场事故（AF-209 / AF-211 撞号、AF-210 归档后无法提交）全部是机制缺口，不是操作失误：

| 缺口           | 现场表现                                                                          | 根因                                               |
| -------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| 跨机单写者缺失 | 两台机器可同时跑 `run-once`，重复领单、重复验收、状态面后写者覆盖                 | 本地锁文件在 `transport/`（gitignore），跨机不可见 |
| 编号无仲裁     | AF-209 与远端已合入的 AF-209 同号；AF-211 与对方在开发分支同号                    | `task register` 只查本地索引                       |
| 归档无前置     | AF-210 归档成 completed 后 `git commit` 被 `no-active-task` 拒绝，只能补开 AF-212 | 归档判定不看实现是否已进版本库                     |

## 2. 改动文件

新增：

- `scripts/orchestration/remote-lock.mjs` — 远端 CAS 锁（`createGitRemoteLock` / `describeRemoteRunLock`）
- `scripts/orchestration/task-id-occupancy.mjs` — 编号三源占用与 `nextTaskId`
- `scripts/orchestration/__tests__/remote-lock.spec.mjs`（6 例）
- `scripts/orchestration/__tests__/task-id-occupancy.spec.mjs`（5 例）
- `scripts/orchestration/__tests__/archive-guard.spec.mjs`（4 例）
- `docs/team/agent-orchestration/cross-machine-single-writer.md` — 跨机协议、降级表、运维口径

修改：

- `scripts/orchestration/run-lock.mjs` — `acquireRunLock` 支持注入 token；新增 `acquireClusterRunLock`（本机锁 → 远端锁）
- `scripts/orchestration/cli.mjs` — `withRunLock` 接入远端锁与降级/拒绝逻辑；`status` 增加远端锁一行；`run-once` / `watch` 注入 `checkUncommitted`；新增 `task next-id`
- `scripts/orchestration/task-intake.mjs` — 登记前执行编号三源占用断言
- `scripts/orchestration/scheduler.mjs` — 新增 `archiveUncommittedFiles`；`processReceipts` 归档前拦截未提交实现
- `scripts/orchestration/branch-workflow.mjs` — `createGitPort` 新增 `uncommittedWithin`
- `docs/team/agent-orchestration/agent-cards/orchestrator.json` — 资源域补 `.prettierignore`（为 AF-218 的格式化隔离铺路）

## 3. 关键设计决策（与任务单的偏差）

| 项              | 任务单写法                                      | 实际实现                                            | 理由                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 锁 ref 位置     | `refs/orchestration/locks/run-once`（非 heads） | `refs/heads/orchestration-lock`                     | 实测非 heads ref 在当前环境的 `git fetch` 报 `couldn't find remote ref`，而释放依赖读 payload；用 heads 下的短命分支换取可靠读取，代价只是运行期分支列表短暂多一个 ref（CI 只在 master/integrate 事件触发，不受影响） |
| 锁提交形态      | tree 取 base、`parents=[baseSha]`               | root commit（无 parent）                            | 避免把锁 commit 挂进真实历史；`commit-tree` 推送与读回均正常，且不依赖 base 对象是否在本地                                                                                                                            |
| 锁 payload 读取 | `git fetch origin <ref>` + `FETCH_HEAD`         | 三路：本地 `cat-file` → 映射缓存 ref → 按 sha fetch | 单一 fetch 读法在地现场会偶发读不到，退化成「读不到 = 判 corrupt = 不释放」；三路从零网络到有网络依次兜底                                                                                                             |
| GitHub API      | 复用 `github-api.mjs` 凭据                      | 直接 `git push` / `--delete`                        | 同步 CLI 不适合接 async 客户端；git 命令复用既有 SSH 推送凭据，且 ref 创建本身就是原子 CAS                                                                                                                            |

## 4. 闸门数字（真实执行）

| 闸门                                                    | 结果                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/` | 9 files / 317 tests passed，exit=0                                      |
| `pnpm typecheck`                                        | exit=0，0 error                                                         |
| `pnpm lint`                                             | exit=0，0 error                                                         |
| `pnpm test`（收尾一次）                                 | 237 files passed + 1 skipped，4065 passed + 7 skipped，exit=0（99.21s） |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`  | 全 PASS（含 AF-209/210/212/213 任务单、事件链哈希、索引投影一致）       |
| `pnpm orchestration:contracts`                          | PASS（框架 2.0.0 / v2.0.0 / c507188，14 文件哈希一致）                  |
| `git diff --stat HEAD -- src/engine-core`               | 空                                                                      |

## 5. 现场取证（真实 GitHub 远端）

1. **抢占拒绝**：手工推入 fresh payload（host=DESKTOP-E3EVQ9P）后跑 `run-once`，输出 `[lock] 另一轮（run-once）正在运行，本轮跳过：pid=… host=DESKTOP-E3EVQ9P`，远端 ref sha 未变，本轮未做任何状态迁移。
2. **陈旧自愈**：推入 90 分钟前的 stale payload（host=ghost）后跑 `run-once`，输出 `[lock] 已清理远端陈旧锁：host=ghost 自 …`，随后正常执行并在结束后删除 ref。
3. **释放**：正常轮次结束后 `git ls-remote origin refs/heads/orchestration-lock` 输出空（RELEASED），锁不残留。

## 6. 已知边界

- 释放是「读—比对—删」，存在极小理论竞态（读后对方抢到、本方删掉）；后果是两个同时跑一轮，需要服务端条件删除才能彻底闭环，超出本仓能力。
- 编号检查看不到「对方本地已登记但未推送」的单子，规则仍是登记后立即推送。
- 未跟踪文件不计入归档前置（口径：`git diff --name-only HEAD -- <scope.files>`，含暂存）。

## 7. 后续（不在本单）

- AF-218：`.prettierignore` 排除 `docs/worklog/records/**`（消除 lint-staged 改写回执导致 manifest 哈希失配）、`env-doctor` 密钥体检、`docs/security/secret-handoff.md`。
- AF-219：`.env.example` 补 `LLM_DOUBAO_API_KEY` / `ENGINE_RENDER_FALLBACK_PROVIDERS` 注释。

commit message：`feat(AF-217): 跨机单写者 CAS 锁、编号占用检查与归档前置硬化`
