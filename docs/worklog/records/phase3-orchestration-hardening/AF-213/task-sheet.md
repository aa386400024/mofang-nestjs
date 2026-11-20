---
taskId: AF-213
contextId: phase3-orchestration-hardening
title: 跨机单写者锁与任务生命周期一致性硬化（远端 CAS / 编号占用 / 归档前置）
type: implementation
status: backlog
baselineRef: 01c3ce8dafbdfe42ed14504729c9f2236dc4cd39
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T09:10:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/security/
    - package.json
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af213-cross-machine-hardening-2026-11-21.md
    kind: report
  - name: 跨机单写者与编号分配口径
    path: docs/team/agent-orchestration/cross-machine-single-writer.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/
    check: 编排护栏定向用例全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量用例 0 failed（收尾一次）
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 机读校验全 PASS
    threshold: FAIL=0
  - command: pnpm orchestration:contracts
    check: 框架契约包哈希与版本一致
    threshold: exit=0
successCriteria:
  - run-once 与 watch 在 GitHub 侧用 ref 原子创建做跨机单写者 CAS；抢不到锁本轮不执行任何状态迁移。
  - 无 GitHub 凭据或网络不可达时降级为仅本机文件锁，并在 status 与运行日志明确打印「跨机无保护」告警，不静默放行。
  - task register 执行任务编号三源占用检查（远端 task/* 分支名、远端 integrate 索引、本地 records 目录），命中即拒绝并给出下一个可用编号；新增 task next-id 子命令。
  - run-once 在 archive-completed 之前校验任务 scope 内实现文件是否已全部提交，未提交则保持 in-flight 并产出 archive-blocked-uncommitted 动作，杜绝「先归档后提交」。
  - 三条护栏各有确定性单测（不依赖网络：注入 fake fetch / 临时目录 / 注入 git 端口）。
---

# AF-213 · 跨机单写者锁与任务生命周期一致性硬化

## 背景（实证）

本机（DESKTOP-6U804B0）与另一台开发机（DESKTOP-E3EVQ9P）在同一个 `integrate` 上并行工作，已经出了三次现场事故：

1. **AF-209 编号撞车**：本机登记 AF-209 做豆包 provider 接入时，远端已合入另一台机器的 AF-209（来访者真人度 R3），只能整批改号为 AF-210。
2. **AF-211 二次撞车**：本机补提交单登记的 AF-211 与另一台机器正在开发的 `task/AF-211-realism-r4` 同号。
3. **归档后无法提交**：AF-210 先跑 run-once 归档成 completed/archived，再执行 `git commit` 被 `orchestration:preflight` 以 `no-active-task` 拒绝，只能靠 AF-212 补提交单补偿。

根因都不是操作失误，而是**机制缺口**：

- `run-lock.mjs` 的锁文件落在 `transport/`（gitignore 目录），跨机不可见。脚本头注释自己写了「两台机器同时跑 run-once 会重复领单、重复验收、互相覆盖状态面」，但没有任何远端仲裁。
- `task register` 只查本地状态索引，不看远端任务分支与远端索引，编号靠人肉避让。
- `run-once` 的归档判定只看回执与交付记录，不看「实现是否已进版本库」，于是允许把未提交的实现判成验收通过并归档。

## 设计

### 1. 跨机单写者（远端 CAS）

GitHub 的 ref 创建是**原子的**：`POST /repos/{owner}/{repo}/git/refs` 对同名 ref 已存在返回 422。用它做分布式锁，不需要额外基础设施：

- 锁 ref：`refs/orchestration/locks/run-once`（不在 `refs/heads/` 下，不污染分支列表）。
- 抢锁：先把 payload（host / pid / token / actor / acquiredAt / baseSha）写成一个 commit（tree 取 base 提交的 tree，parents=[baseSha]），再创建 ref 指向它。创建成功即持锁。
- 释放：读回锁 payload，比对 token 后 `DELETE` ref；token 不符不动手，避免误删他人锁。
- 陈旧：payload.acquiredAt 超过 `staleMs`（默认 45 min，与本地锁同口径）视为崩溃残留，删除后重抢一次，并保留 `stolen` 事实。
- 降级：无 GitHub token / 网络失败 → 返回 `unavailable`，`withRunLock` 回落到本机文件锁，并在状态面与日志明确打印告警。`ORCH_REMOTE_LOCK=required` 时降级即拒绝执行；`ORCH_REMOTE_LOCK=0` 时显式关闭远端锁（仅用于离线调试）。

### 2. 编号占用检查

`task register` 前做三源合并检查：

| 源           | 读法                                                     | 覆盖场景               |
| ------------ | -------------------------------------------------------- | ---------------------- |
| 远端任务分支 | `git ls-remote --heads origin 'task/*'` 解析分支名内编号 | 对方正在开发、尚未合并 |
| 远端索引     | `git show origin/integrate:<task-state-index.json>`      | 对方已合入             |
| 本地工件     | 本地 index + `docs/worklog/records/**/<AF-NNN>/`         | 本机历史               |

命中即拒绝登记，输出冲突来源与下一个可用编号；`task next-id` 直接给出下一个空号。远端不可达时跳过远端源并打印告警，不阻塞离线登记。

### 3. 归档前置：实现必须已提交

`processReceipts` 在 `archive-completed` 之前调用注入的 `checkUncommitted(task)`：

- 返回非空清单（scope 覆盖范围内仍有未提交改动）→ 不归档，任务保持 in-flight，状态面记录 `escalation.waiting = '实现未提交，归档已阻断'`，动作 `archive-blocked-uncommitted` 携带文件清单。
- 返回空 → 照常归档。
- 未注入该函数 → 行为与现状一致（向后兼容，既有单测不受影响）。

## 范围

- 只改编排工具链：`scripts/orchestration/` 下 run-lock / remote-lock / cli / task-intake / scheduler / branch-workflow，`docs/team/agent-orchestration/` 文档与 agent card 资源域，`docs/security/` 安全口径文档，`package.json` 脚本入口。
- 不碰 `src/`、`test/`、`bin/`，不碰 engine-core。
- 不引入新依赖：GitHub 调用复用既有 `github-api.mjs` 与 `ci-status.mjs` 的凭据解析。

## 验收

- 新增单测覆盖：远端锁抢锁/冲突/陈旧自愈/降级、编号三源占用与 next-id、归档前置拦截与放行。
- 定向用例、typecheck、lint、全量测试、validate、contracts 全绿。
- 现场取证：真实跑一次 run-once，锁 ref 在 GitHub 上创建后释放，`git ls-remote` 不再出现该 ref。

commit message：`feat(AF-213): 跨机单写者 CAS 锁、编号占用检查与归档前置硬化`
