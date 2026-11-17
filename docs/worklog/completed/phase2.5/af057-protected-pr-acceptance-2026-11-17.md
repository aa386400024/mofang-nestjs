# AF-057 · 受保护 PR 验收门与全流程返修验证

> 任务单：[`pending/af057-protected-pr-acceptance-task-2026-11-17.md`](../../pending/af057-protected-pr-acceptance-task-2026-11-17.md)  
> PR：#12（task/AF-057-protected-pr-acceptance → integrate）  
> 基线：AF-056 merge `f3d6009e80d2c258ab1295fde140dc40e9b99e10`

## 1. 根因与修正

AF-056 的逐提交门能识别无任务/越权提交，但 completed + passed durable 回执只由本地 `pr-release.mjs` 检查。拥有合并权限者可绕开 CLI，直接从 GitHub 页面/API 合并在办任务。

本单把验收条件提升为服务端 required check：

- PR 最终 HEAD 必须含 `archivedTasks[taskId].status=completed`；
- HEAD git tree 中必须存在该任务 durable receipt；
- 回执同时满足 `reviewVerdict=passed`、`scopeCheck=in-scope`、`finalStatus=completed`；
- 缺任一条件，`Orchestration Gate` 输出 `ok=false` 并 exit 1；
- integrate push 不启用 PR 专属验收，squash 归档仍由 `archived-transition` 逐提交校验。

## 2. 提交与真实负向证据

| 提交                                       | 意图                                      | 结果                          |
| ------------------------------------------ | ----------------------------------------- | ----------------------------- |
| `1de7175ea2fec557b9c2571d59ac6df351de7ec0` | AF-057 登记、领单、导航                   | 只在任务分支，pre-commit PASS |
| `dbf5cfdf525bfa6230637ac0a12889f1e29e5128` | 服务端验收门、单测、规范、AF-056 最终证据 | 7 文件全部 scope 覆盖         |
| `48b3dc48b65e2e336ef9a0a141d899b53a07b49b` | 修复 PR 模式跨 step 传递                  | 早期 PR 门按预期失败          |

### 2.1 直推 integrate

在 AF-057 登记提交上执行 `git push origin HEAD:integrate`：

- exit 1，`protected branch hook declined`；
- GitHub 原文：`Changes must be made through a pull request`；
- GitHub 原文：`13 of 13 required status checks are expected`；
- 本地/远端 integrate 均保持 `f3d6009e`，没有写入登记提交。

### 2.2 未归档 PR 必须失败

首次 `dbf5cfd` 远端门返回 success，复核日志发现 `EVENT_NAME` 仅存在于 Resolve step，Validate step 实际走了非 PR 分支。没有把这当作通过；`48b3dc4` 改为经 `GITHUB_ENV` 传递 `ORCH_REQUIRE_ACCEPTED` 与 `ORCH_TASK_REF`。

修正后的 GitHub job `134012257615`（run `44075484312`）：

```text
PASS 1de7175 task=AF-057 reason=pass files=5
PASS dbf5cfd task=AF-057 reason=pass files=7
PASS 48b3dc4 task=AF-057 reason=pass files=1
ACCEPTANCE task=AF-057 pass=false reason=task-not-archived-completed receipts=0
total=3 passed=3 failed=0 ok=false
```

check-run 为 `completed / failure`；PR #12 HEAD 为 `48b3dc4`，`mergeable_state=blocked`。这证明不经过本地 PR 工具也不能提前合并。

## 3. 本地闸门

| 闸门             | 实际结果                                                             |
| ---------------- | -------------------------------------------------------------------- |
| 编排单测         | 227 passed / 0 failed；新增未归档、非 passed、合法 accepted 三态     |
| 本地未归档回放   | `ok=false`，`task-not-archived-completed`，exit 1（预期负向）        |
| `pnpm typecheck` | exit 0，0 errors                                                     |
| `pnpm lint`      | exit 0，0 errors / 0 warnings；范围为 `{src,test,bin}/**/*.ts`       |
| 适配层 validate  | exit 0，FAIL=0，AF-057 任务单与状态链 PASS                           |
| 框架契约包       | 2.0.0 / c507188，14 文件一致                                         |
| 脚本语法         | ci-task-gate / pr-release / branch-protection 均 `node --check` 通过 |
| CI YAML          | 可解析，`orchestration-gate` 存在；PR 模式经 GITHUB_ENV 传递         |

`scripts/*.mjs` 不在 ESLint 覆盖范围；该层证据仅为 Node 语法检查、227 条单测、真实历史回放和 GitHub job，不冒充 ESLint 已覆盖。

## 4. 保护读回

AF-056 合并后 `branch-protection.mjs --apply` 返回 `verification.pass=true`：

- 13 项 required contexts 无缺失、无额外项；
- strict、enforceAdmins、linearHistory、conversationResolution、pullRequestRequired 为 true；
- force push 与 deletion 禁用；required PR 审批数为 0，不增加人工审批。

## 5. 归档后与合并判据

- 归档状态提交后，本地 `--require-accepted` 必须返回 `accepted / ok=true`；
- 同一 PR #12 的 Orchestration Gate 必须由 failure 转 success；
- `pr-release.mjs merge` 必须重新读回 13 项 pass 才允许 squash；
- merge SHA 以 GitHub PR #12/API 和本地 integrate HEAD 为准，不在合并前预写；最终命令输出会同时给出本地/远端分支清理结果。

## 6. 边界与遗留

- 本单只保护 `mofang-nestjs/integrate`；其他仓库、master/tag/release/deploy 不在本轮。
- 数据库、Redis、环境启停不是 GitHub 可阻断的操作系统级动作，仍由任务、scope、回执和事件审计约束。
- admin 理论上可后续修改保护设置；本单提供 apply/readback，不宣称阻止仓主关闭保护。
- 无业务 `src/**`、数据库、Redis、migration、seed 或 LLM 批次改动；并行产物与 web/orchestration/data.js 未纳入。

## 7. 最终合并与 AF-058 返修（补记）

- 归档 HEAD `314376fe92912bcbb8a35b27298ac7df05b5790c` 的 GitHub Orchestration Gate 为 `completed/success`；日志 `ACCEPTANCE pass=true reason=accepted receipts=1`，5 个提交全过。
- `pr-release.mjs merge` 读回 `checks=pass total=13 missing=0 pending=0 failing=0`。
- PR #12 已 squash 合并：`04f6f9baa02f6f3f8a503780920e3562a42f511b`；本地 integrate 同步，任务分支本地/远端均删除。
- AF-057 已验收归档，75 个归档、0 活跃；durable receipt 与 CLI 状态面入库，事件链 231 条一致。
- merge 后 integrate push 回放又发现 squash 全生命周期缺口：parent 无该任务、archived 投影无 scope，旧门先报 no-active-task。该事实不计作 AF-057 的成功证据，转 AF-058 原因级返修；只有 AF-058 自身 merge 后 push 门转绿，才结束服务端闭环。
