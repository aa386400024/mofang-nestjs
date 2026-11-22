# AF-059 · 零依赖 squash 门返修与最终闭环

> 任务单：[`pending/af059-dependency-free-squash-gate-task-2026-11-17.md`](../../pending/af059-dependency-free-squash-gate-task-2026-11-17.md)  
> 承接：AF-058 PR #13（closed unmerged，提交原样保留在 stacked 分支）  
> 基线：integrate `04f6f9baa02f6f3f8a503780920e3562a42f511b`

## 1. 根因与修正

AF-058 静态引入 task-intake.mjs，连带要求 yaml；GitHub 轻量 Orchestration Gate 不安装 node_modules，因此 PR #13 在最终 HEAD 上报 ERR_MODULE_NOT_FOUND。本地有依赖未暴露，不能把本地绿当远端绿。

本单移除 task-intake/yaml 静态依赖，只严格解析门所需 taskId/type/agentRole/scope.files：

- 支持块数组、行内数组、单双引号标量；
- taskId 不匹配、scope/files 缺失、空数组、非法形态均 fail closed；
- 完整任务单 schema 仍由登记 CLI 与 Contracts 校验；
- passed durable receipt、scope 检查、归档后追加写拒绝保持不变。

## 2. 本地与隔离证据

| 检查                     | 结果                                                      |
| ------------------------ | --------------------------------------------------------- |
| 编排单测                 | 232 passed / 0 failed；新增块/行内数组与 fail-closed 用例 |
| AF-057 squash 回放       | `04f6f9ba` archived-transition，files=14                  |
| AF-056 squash 回放       | `f3d6009e` archived-transition，files=17                  |
| 无 node_modules 临时克隆 | `noNodeModules=True`；AF-057 真实回放 exit 0              |
| 依赖扫描                 | task-intake / yaml dependencyHits=0                       |
| `pnpm typecheck`         | exit 0，0 errors                                          |
| `pnpm lint`              | exit 0，0 errors / warnings；不含 scripts/*.mjs           |
| Node 语法                | ci-task-gate.mjs exit 0                                   |
| 适配层 validate          | FAIL=0，AF-059、事件链和投影 PASS                         |
| 框架契约包               | 2.0.0 / c507188，14 文件一致                              |

## 3. 交付路径

- AF-059 从 AF-058 归档 HEAD 切 stacked rework 分支，未 cherry-pick、未改写 AF-058 提交；
- PR #13 已关闭且 merged=false；
- AF-059 归档后创建最终 PR，13 项 checks 全绿才 squash；
- 最终 merge SHA 与 AF-059 自身 merge 后 integrate push 门结论以 GitHub API/check-run 补记，不预写。

## 4. 边界

只改服务端轻量解析、单测和编排文档；未给 CI 强加 pnpm install，未改业务 src、数据库、Redis、master/tag/release/deploy。
