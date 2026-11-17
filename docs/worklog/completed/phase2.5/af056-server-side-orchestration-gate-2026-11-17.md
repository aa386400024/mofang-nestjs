# AF-056 · 服务端编排门与 integrate 分支保护闭环

> 状态：实现与 PR 远端门已验证；合并后保护读回与独立任务实弹由 AF-057 续记。
> 任务单：`docs/worklog/pending/af056-server-side-orchestration-gate-task-2026-11-17.md`
> PR：`https://github.com/aa386400024/mofang-nestjs/pull/11`

## 1. 交付范围

本单只修改编排适配层、CI、发布工具和治理文档，没有改业务 `src/**`、数据库、Redis、前端锁文件、批次报告或 L4 master/tag/release/deploy。

- 登记提交：`eb98967b39960cbc8784d7b49f4a6cb7fe3c3d2b`（含 AF-055 交付记录与 durable 回执入库）。
- 实现提交：`b391d1cb3da27c67eb1ca1d5d12d7214e8084799`，11 个文件，真实 Husky 通过。
- 任务分支：`task/AF-056-af-056`。
- 新增：`ci-task-gate.mjs`、`github-api.mjs`、`branch-protection.mjs`、`pr-release.mjs`。
- 修改：`ci.yml`、编排单测、`package.json`、AGENTS、适配层 README、发布设计、orchestrator Agent Card。

并行文件 `admin-dashboard/pnpm-lock.yaml`、`data/batch-reports/**`、未跟踪架构稿与业务 `src/**` 均未进入本单提交。

## 2. 框架流程修正

旧 L3 是「先直推 integrate 登记提交 → 本地 squash 产生新 SHA → 直推 integrate」。若直接启用 required checks，新 SHA 没有远端检查结论，正常流程也会被阻断。

目标态改为：

1. 登记、实现、验收状态都进入任务分支；
2. PR 对每个提交执行服务端编排门；
3. completed + passed durable 回执 + PR HEAD 一致 + 13 项检查全绿后，API squash 合并；
4. 本地 fast-forward 同步 integrate，树一致后清理本地/远端任务分支。

required PR 的审批人数为 0：只禁止直推旁路，不把已授权的 L3 变成人工审批。L4 仍需用户批准。

## 3. 服务端硬门

### 3.1 逐提交判定

`ci-task-gate.mjs` 对 `base..head` 每个提交读取当前提交与父提交的任务索引，复用 `evaluateTaskEntry`：

- 普通任务提交：唯一 taskId + 可写状态 + scope.files + 提交树内任务单；
- 纯状态面：`state-plane-only`；
- 归档 squash：`archived-transition`，父提交在办、当前 completed/archived；
- 多任务编号、merge commit、缺任务单、 canceled/rejected 借用、越界文件均失败。

CI 触发范围限定为 PR→integrate、push integrate、显式 task/integrate dispatch；master/release 的 L4 不被隐式改变。

### 3.2 保护与 PR 工具

`branch-protection.mjs` 声明并读回核验：13 项 context、strict、required PR（0 审批）、线性历史、enforce admins、禁止 force push/deletion。

`pr-release.mjs` 不依赖本机 gh，复用 Git credential / token 调 REST：

- `create`：推送并创建/复用 PR；
- `status`：检查 13 项是否全部存在、完成和通过；
- `merge`：未完成验收、无 passed durable 回执、HEAD 不一致、pending/unknown 均拒绝。

## 4. 实测证据

### 4.1 本地闸门

| 检查                                                                          | 结果                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 224 passed / 0 failed                                            |
| `pnpm typecheck`                                                              | exit 0，0 error                                                  |
| `pnpm lint`                                                                   | exit 0，0 error / 0 warning（既有范围 `{src,test,bin}/**/*.ts`） |
| 新增 MJS `node --check`                                                       | 4 个新脚本均 exit 0                                              |
| `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate`                        | 全 PASS，事件链与索引投影一致                                    |
| `pnpm orchestration:contracts`                                                | 框架 2.0.0 / c507188，14 文件哈希一致                            |
| `.github/workflows/ci.yml` YAML 解析                                          | 9 个 job，`orchestration-gate` 存在                              |

`scripts/*.mjs` 仍不在 ESLint 项目覆盖内；本单用 Node 语法检查、224 条单测与真实 git 回放补足，不声称 ESLint 覆盖脚本层。

### 4.2 真实历史正反回放

AF-053 / AF-055 的登记、实现、状态面和归档共 8 个真实提交均通过：

- integrate 祖先链：登记 / squash 共 4 个提交；
- 已删除任务分支的 git 对象：实现 / 纯状态面共 4 个提交。

这验证了为什么必须在 PR 源分支阶段逐提交检查：squash 后，原实现提交不再位于 integrate 祖先链。

负向样本 `a27aba504b48b245f59a8f6ef1791310b68f94a9`（无编排任务的旧文档提交）返回 `no-active-task`，exit 1。

AF-056 实现提交自身回放：`b391d1cb3da2 task=AF-056 reason=pass files=11`。

### 4.3 GitHub 实弹

- PR #11 创建成功，HEAD 为 `b391d1cb3da27c67eb1ca1d5d12d7214e8084799`。
- GitHub check-runs 读回：`Orchestration Gate status=completed conclusion=success`。
- 同 HEAD 的 Contracts、Lint + Typecheck、Security Audit 均为 `completed / success`。
- 在任务尚未 completed/archived 时执行 `pr-release.mjs merge --apply`，返回「任务 AF-056 尚未 completed/archived」，exit 1；未发起合并。

最终归档 HEAD 的 13 项检查由 `pr-release.mjs merge` 再次强制核验；最终 merge SHA、保护 apply/读回和下一任务全流程证据由 AF-057 追加，不在本记录提前宣称完成。

## 5. 偏差与边界

- AF-056 自身登记发生在保护启用前，沿用最后一次过渡直推；AF-057 起登记也必须在任务分支。
- 保护配置在本单合入后 apply，避免 required `Orchestration Gate` 在 base workflow 尚不存在时形成自锁。
- GitHub 可硬阻断未授权提交/合并；数据库、Redis、环境启停仍由任务、scope、回执与审计约束，不宣称操作系统级沙箱。
- admin 可通过后续 API 改保护设置，因此需要读回核验和变更审计；当前声明不配置个人/团队 bypass。
- 本单只覆盖 `mofang-nestjs`，未声称其他仓库已接入。

## 6. 交接

AF-057 负责：

1. 记录 AF-056 最终 PR merge SHA 与分支清理结果；
2. apply + 读回 integrate 保护；
3. 实弹证明无任务提交和直接 push 被远端拒绝；
4. 以「登记在任务分支 → PR → 验收归档 → squash」完成自身交付。
