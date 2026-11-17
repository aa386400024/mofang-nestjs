# AF-058 · squash 全生命周期归档门修复

> 任务单：[`pending/af058-squash-lifecycle-gate-task-2026-11-17.md`](../../pending/af058-squash-lifecycle-gate-task-2026-11-17.md)  
> PR：#13（task/AF-058-squash-lifecycle-gate → integrate）  
> 基线：AF-057 merge `04f6f9baa02f6f3f8a503780920e3562a42f511b`

## 1. 实弹发现的根因

AF-057 PR 与 13 项检查全绿并合并后，对 merge 后的 integrate push 做同门回放，旧实现返回 `no-active-task`。这不是放宽门校验的理由，而是两个 merge-only 状态差异：

1. squash 把登记、实现、回执、归档压成一个提交，parent 完全没有该任务；旧 archived-transition 只识别 parent active。
2. `archivedTasks` 投影只保留 taskId/status/artifacts，不含 scope；普通归档提交能从 parent active 任务取 scope，squash 没有父任务可取。

## 2. 修正

- parent 无该任务、current archived/completed、当前树存在 passed + in-scope + completed durable receipt 时，识别为 squash 全生命周期；
- 从当前提交的任务单 frontmatter 重建完整任务 scope，再复用原 archived-transition 与 scope 检查；
- 缺回执仍 `no-active-task`；parent 已归档后的追加写即使有回执也拒绝；
- 普通归档提交、PR 最终 HEAD 验收、分支保护与 13 项 required checks 不变。

## 3. 回归证据

### 3.1 单测

230 passed / 0 failed。新增三态：

- 合法 squash 全生命周期 → `archived-transition`；
- parent 无任务但缺 passed 回执 → 拒绝；
- parent 已归档后的追加写 → 拒绝。

### 3.2 真实 merge SHA 回放

```text
AF-057: base=f3d6009e head=04f6f9ba
PASS 04f6f9ba task=AF-057 reason=archived-transition files=14
ok=true

AF-056: base=eb98967b head=f3d6009e
PASS f3d6009e task=AF-056 reason=archived-transition files=17
ok=true
```

两个回放都使用真实 git tree 中的任务单与 durable receipt，不是手工构造的替代证据。

### 3.3 收尾闸门

| 闸门                            | 结果                                            |
| ------------------------------- | ----------------------------------------------- |
| 编排单测                        | 230 passed / 0 failed                           |
| `pnpm typecheck`                | exit 0，0 errors                                |
| `pnpm lint`                     | exit 0，0 errors / warnings；不含 scripts/*.mjs |
| `node --check ci-task-gate.mjs` | exit 0                                          |
| 适配层 validate                 | exit 0，FAIL=0，AF-058 与状态链 PASS            |
| 框架契约包                      | 2.0.0 / c507188，14 文件一致                    |

## 4. 最终远端判据

- AF-058 归档后 PR #13 的最终 HEAD 必须 `ACCEPTANCE pass=true`；
- `pr-release.mjs merge` 只在 13 项 checks 全 pass 后 squash；
- AF-058 自身 squash 后的 integrate push 必须再次通过新 Orchestration Gate，验证“修复对修复自身也成立”；
- merge SHA 不在合并前预写，以 PR #13/API 与本地 integrate HEAD 为准。

## 5. 边界

只改服务端判定、单测和编排文档；未改业务 src、数据库、Redis、master/tag/release/deploy。`scripts/*.mjs` 仍不在 ESLint 项目内，静态证据为 Node 语法检查、单测、真实回放与 GitHub job。
