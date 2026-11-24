---
taskId: AF-472
contextId: phase2.5-visitor-register-eval
title: 修复语域成本评测的双进程偏差与远端锁整树提交
type: fix
status: backlog
baselineRef: 9445fb32403671a9eb89a815e91cf522d8cf29ba
dependsOn: []
priorTasks: [AF-466, AF-471]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T22:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - scripts/orchestration/
    - scripts/eval/visitor-register-stability/
    - src/admin-debug/
    - test/admin-debug/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-472/
  modules:
    - visitor-register-eval
    - orchestration-cli
  interfaces:
    - debug-session-create
    - remote-lock
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af472-register-cost-measurement-and-lock-fix-implementation-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/remote-lock.spec.mjs scripts/orchestration/__tests__/task-id-reservation.spec.mjs
    check: 远端锁与取号空树提交单测全绿
    threshold: 0 failed
  - command: pnpm exec vitest run test/admin-debug/wp58-debug-session.spec.ts
    check: 调试会话 per-session 语域开关单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: lint 通过
    threshold: 0 error
  - command: pnpm typecheck
    check: 类型检查通过
    threshold: 0 error
successCriteria:
  - 远端锁与任务取号的抢锁 commit 改用空 tree，push 只携带锁 commit 对象，不再携带 HEAD 整棵树；锁 ref 名、陈旧阈值和 payload 字段保持不变。
  - 调试会话创建接口支持 per-session `registerMode=off|active`，同一后端进程可同时承载 base 与 active，不再用两个进程代表两种模式。
  - run-sessions.mjs 增加 --paired：同一端口、同一进程内为 base/active 建两场会话，逐轮交替执行并逐轮落盘，消除“整场串行 + 双进程”带来的测量偏差。
  - 保留原双端口跑法作为兼容路径，不改变已归档 AF-465/AF-466 的产物口径。
  - 给出重跑命令与解释；未实际重跑前不得宣称 `cost` 门已通过。
  - 不修改 `src/engine-core`，不放宽 15% 成本门，不改 `noHarm` 阈值，不修改生产 prompt 内容。
---

## 1. 背景

AF-471 归因确认：AF-466 的 active p95 中位 `+32.06%` 不能由 prompt 中位 `+12.85%` 单独解释；TTFT 只 `+6.3%`，post-TTFT `+43.7%`，且随轮次累积。报告同时给出两个强混杂项：单次运行 p95 自身方差大（比值 CV 14.1%，跨 run base p95 可摆动 >60%），以及 AF-466 由 3010/3011 两个进程分别承载 base/active、每角色整场串行。

在这两个混杂项未排除前直接改生产 prompt（压缩语域块、拆缓存前缀、牺牲历史预算）都缺乏因果依据，可能用产品回归换一个统计噪声。因此本任务先修“测量工具”，让后续重跑能回答真实开销；产品侧 prompt 改动留到有单进程逐轮配对数据之后。

同时修复编排侧已实证的远端锁缺陷：`remote-lock.mjs` 与 `task-id-reservation.mjs` 都用 `HEAD^{tree}` 建 root commit，push 锁 ref 时会把整棵工作树对象一起打包（AF-471 实测 push 挂起）。锁 payload 只在 commit message 里，commit 树内容没有语义，应改为空 tree。

## 2. 目标

1. 远端单写者锁与任务取号的 commit 改为空 tree，保留 root commit 与 message payload 语义，确保 push 不再携带工作树对象。
2. 调试会话创建支持 per-session `registerMode`，同一进程内可开 base（不注入语域）与 active（注入语域）两场会话。
3. 评测 harness 增加 `--paired` 单进程逐轮交替模式，base/active 同轮次紧邻执行，减少时间漂移与双进程差异。
4. 保留旧双端口模式，补充可复现的重跑命令和“未重跑不宣称过门”的口径。

## 3. 实现口径

- 锁：
  - 用 `git mktree`（空 stdin）生成空 tree；`defaultRunGit` 支持传入 stdin。
  - `commit-tree <empty-tree> -m <payload>` 保持无父 root commit。
  - `refs/heads/orchestration-lock`、`refs/heads/orchestration-task-ids/<ID>`、45 分钟陈旧阈值、payload 字段全部不变。
  - 更新两处 fake runGit，增加“commit 使用空 tree、未调用 `rev-parse HEAD^{tree}`”断言。
- 调试会话：
  - `CreateDebugSessionBody` 增加可选 `registerMode: 'off' | 'active'`；缺省保持现有行为（按角色资产注入）。
  - `off` 时 open options 不传 `speechRegister` / `speechRegisterAudit`；`active` 时传。
  - 只在调试接口暴露，不改生产对练入口。
- 评测：
  - `run-sessions.mjs` 增加 `--paired` 与 `--port`（缺省 3010）。
  - `--paired`：同一端口开两场会话，逐轮按 `base, active` / `active, base` 交替（按 turn 奇偶翻转顺序），每轮后同时落盘两份 partial JSON。
  - 非 paired 路径保持原样。
  - 报告与 README 写明：paired 结果才是后续成本门判定口径；旧跑法只作历史对照。

## 4. 非目标

- 不修改 `src/engine-core`。
- 不压缩语域块、不拆缓存前缀、不调整历史预算、不改生产 prompt 文案。
- 不放宽 `cost` 门（仍 ≤15%），不改 `noHarm` 的 `abstractTermRate` 阈值。
- 不新增模型调用、不重跑 AF-466 全量 10 角色；重跑作为后续验证，需先起 3010 后端。
- 不做人评、不改变 AF-466/AF-471 已归档结论。

## 5. 交付

- 代码与单测；
- `docs/worklog/completed/phase2.5/af472-register-cost-measurement-and-lock-fix-implementation-2026-11-24.md`：改动清单、闸门数字、重跑命令、限制与后续；
- 机读回执；
- 在交付记录中明确：本轮修的是测量口径与锁传输，不宣称成本门已通过。
