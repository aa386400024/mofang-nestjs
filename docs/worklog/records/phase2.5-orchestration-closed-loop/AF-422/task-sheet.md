---
taskId: AF-422
contextId: phase2.5-orchestration-closed-loop
title: cap 感知的在场增益重放：放大到多少开始被单轮 cap 吃掉
type: investigation
status: backlog
baselineRef: 52b17bb5d2d8f4daa9c63a184358a52977ddeb54
dependsOn: []
priorTasks: [AF-418, AF-421]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-24T05:10:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/ops/quality/
    - scripts/orchestration/__tests__/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af422-presence-cap-aware-replay-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/af422-presence-cap-aware-replay.spec.mjs
    check: cap 边界与内核 DEFAULT_DELTA_CAP_CONFIG 一致 / 余量/封顶/吃掉 三档断言全绿
    threshold: exit=0
  - command: node scripts/ops/quality/af422-presence-cap-aware-replay.mjs --dir data/debug-sessions
    check: 只读跑通，输出不含对话原文
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿，记录真实数字
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 以「cap(真实 delta + scaled presence) − cap(真实 delta)」作为在场增量在 cap 下的**有效贡献**，逐轮累加后叠在 AF-418 的轨迹重放上
  - 输出 0× / 1× / 2× / 4× / 8× 五档的有效 safety / bond 增益、被 cap 吃掉的增益、封顶轮次
  - 1× 档有效增益必须与 AF-418 未接 cap 口径可对比（差额即 cap 损失，损失为 0 时两者逐字相同）
  - 脚本内 cap 边界与内核 DEFAULT_DELTA_CAP_CONFIG 逐维一致（单测断言，漂移即红）
  - 只读 data/debug-sessions，不打印对话原文，不写仓库数据文件
  - lint / typecheck / 定向单测 / 全量测试全绿；engine-core 零 diff
---

## 背景

AF-421 只算了夹取（clamp [0,1]），cap 触发用「真实 delta + presence > 0.20」近似统计，8× 以内触发数为 0。但那只是近似：真实内核是 `capTurnDelta(raw)` 砍单轮 delta，砍掉的部分就是**在场增益被吞掉**，而不是简单地"没触发就等于全额生效"。要把「放大到多少开始被 cap 吃掉」说清楚，得直接算 `cap(real + presence) − cap(real)`。

## 目标

1. 新增只读脚本 `af422-presence-cap-aware-replay.mjs`：按 11 维算 cap 下的有效增量，映射到八维后叠进 AF-418 轨迹重放。
2. 脚本内 cap 边界表由单测对内核 `DEFAULT_DELTA_CAP_CONFIG` 逐维断言（第三份拷贝的风险用断言兜住）。
3. 输出五档的有效增益 / 被吃掉增益 / 封顶轮次，并在交付记录里给出「从哪档开始出现可观测的 cap 损失」。

## 范围隔离

只新增脚本、单测、交付记录、记录包；只读 `data/debug-sessions`；不改内核 delta 表与 cap 配置、不改 env 默认值、不碰分类器与 prompt。
