# AF-499 交付记录 · 状态锚点 CI 可验证性

日期：2026-11-25
任务：AF-499（priorTasks: AF-498）
分支：`task/AF-499-ci-anchor-portability`

## 问题

AF-498 把状态锚点默认在 CI 关闭（`CI=true` / `GITHUB_ACTIONS=true`），但新增的锚点回归用 `ORCH_STATE_ANCHOR=on` 期望强制开启。实现只识别关闭值，CI 分支先返回 `enabled=false`，导致该用例在 GitHub Actions 上必失败、本地因无 CI 环境变量而通过。新增独立 spec 又改变了 `--shard=2/3` 的文件分配，远端 `Unit (shard 2/3)` 连续三次失败且 blob reporter 不输出用例名。

## 修复

1. `stateAnchorEnabled()` 先识别显式开启（`1/on/true/yes/force`），再判断 `off` 与 CI 自动关闭。语义分层：普通 CI 不显式开启仍不碰本机锚点；锚点回归可显式开启验证播种/恢复。
2. AF-498 四条回归并入既有 `scripts/orchestration/__tests__/orchestration.spec.mjs`，删除新增独立 spec，恢复远端分片文件构成。
3. 更新 `state-anchor.mjs` 头部契约注释，说明显式开启优先于 CI 自动关闭。

## 验证

- `CI=true` + `GITHUB_ACTIONS=true` 下 `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`：276 passed，0 failed。
- `pnpm exec vitest run scripts/orchestration/__tests__`：全绿。
- `pnpm lint` / `pnpm typecheck`：0 error。
- `git diff --stat HEAD -- src/engine-core`：空。
- 未改 `.github/workflows/ci.yml`、未改业务代码。

## 遗留

PR #240（AF-498）将被 AF-499 PR 取代：AF-499 分支基于 AF-498 HEAD，携带其全部提交（priorTasks 链），并追加本次 CI 可验证性修复；新 PR 绿后关闭 #240。
