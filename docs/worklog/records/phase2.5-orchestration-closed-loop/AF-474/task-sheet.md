---
taskId: AF-474
contextId: phase2.5-orchestration-closed-loop
title: 修复远端锁与任务取号 commit 整树推送
type: fix
status: backlog
baselineRef: 9445fb32403671a9eb89a815e91cf522d8cf29ba
dependsOn: []
priorTasks: [AF-471]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T22:56:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-474/
  modules:
    - orchestration-cli
  interfaces:
    - remote-lock
    - task-id-reservation
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af474-remote-lock-empty-tree-implementation-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/remote-lock.spec.mjs scripts/orchestration/__tests__/task-id-reservation.spec.mjs
    check: 远端锁与取号单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 0 error
successCriteria:
  - remote-lock.mjs 的抢锁 commit 改为空 tree root commit，push 只带锁 commit 对象，不再带 HEAD 整棵树。
  - task-id-reservation.mjs 的占号 commit 同步改用空 tree；两处 payload 仍写在 commit message。
  - 锁 ref 名、占号 ref 前缀、45 分钟陈旧阈值、payload 字段均不变。
  - 单测 fake git 覆盖 mktree，并断言 commit 使用空 tree、未调用 rev-parse HEAD^{tree}。
  - 不修改 lock 语义、不引入旁路开关、不改 .gitignore。
---

## 1. 背景

AF-471 在 `run-once` 抢远端单写者锁时，子进程 `git push origin <sha>:refs/heads/orchestration-lock` 长时间挂起。定位到 `remote-lock.mjs` 与 `task-id-reservation.mjs` 都用 `git rev-parse HEAD^{tree}` 取当前 HEAD 的整棵树，再用 `git commit-tree <tree>` 建 root commit。锁/占号只需要 commit message 里的 payload，tree 内容没有语义；指向 HEAD 整树会让 push 把整个仓库对象一起打包，repo 越大越慢，最终表现为挂起。

## 2. 目标

把两处 CAS commit 的 tree 改成空 tree，保留无父 root commit 与 message payload，确保远端 ref 抢占语义不变，push 体积从“整棵树”降到“一个空树 commit”。

## 3. 实现口径

- `defaultRunGit` 支持 `opts.input`，stdio 在需要 stdin 时用 pipe。
- 用 `git mktree` 空 stdin 生成空 tree，不硬编码 SHA（兼容 SHA-256 仓库）。
- `commit-tree <empty-tree> -m <payload>` 保持原参数顺序。
- 测试 fake 增加 `mktree` 分支；commit 记录 tree，断言为空树；断言未出现 `rev-parse HEAD^{tree}`。
- 不改 `REMOTE_LOCK_REF`、`RESERVATION_REF_PREFIX`、`DEFAULT_REMOTE_STALE_MS`、payload 字段。

## 4. 非目标

- 不改锁的陈旧判定、释放比对、冲突回读逻辑。
- 不改 `run-once` 调用方，不新增 `ORCH_REMOTE_LOCK` 类旁路。
- 不处理语域评测改动（另登 AF-475）。

## 5. 交付

- 代码与单测；
- `docs/worklog/completed/phase2.5/af474-remote-lock-empty-tree-implementation-2026-11-24.md`；
- 机读回执。
