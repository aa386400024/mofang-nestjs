---
taskId: AF-527
contextId: phase2.5-orchestration-closed-loop
title: 验证边界收口：清理旧实例 + 真实双实例队列隔离 smoke
type: verification
status: backlog
baselineRef: 40986c804f35c4520fbee769cac2228ca093898c
dependsOn: []
priorTasks: [AF-526, AF-524]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T11:20:00+08:00
deadline: null
agentRole: executor
riskClass: R2
riskRationale: 需要停止本机旧工作树后端实例，并启动两个真实 BullMQ 进程做同 Redis DB 隔离验证；会影响本机运行态，但不改业务代码、数据库结构或生产配置。
gateProfile: full
objective: 收口 AF-526 留下的两个边界：停掉仍使用写死 bullmq 前缀的旧工作树实例，并用两个独立进程在同一 Redis DB 上验证不同 BULLMQ_PREFIX 不互相抢单。
successCriteria:
  - 盘点本机所有 Af281r / 旧工作树后端进程，确认其仍使用写死 prefix='bullmq'；停止旧后端 watcher 与 app 进程，保留无关前端进程。
  - 停止后复核：无旧的 mofang-nestjs-af281r 后端进程监听 3000，旧 worktree 不再可能启动恢复误标 running。
  - 新增可复现的双实例队列隔离 smoke 脚本：两个独立 Node 进程、同一 Redis DB、不同 BULLMQ_PREFIX，各自消费自己的队列。
  - smoke 断言：A 前缀入队的 job 只被 A 进程消费，B 前缀入队的 job 只被 B 进程消费；两套队列 key 命名空间互不包含；任务完成后清理 smoke 队列。
  - 证据落盘：进程盘点、停止前后 PID/端口、Redis key 计数、consumer 输出与断言结果。
  - 不启动 1000 场出口⑤批次，不产生 LLM 费用。
  - events verify PASS；worklog verify --strict PASS；src/engine-core 零 diff。
outOfScope:
  - 不启动 1000 场出口⑤批次，不发起任何自动对练批次。
  - 不改 .env、不改数据库结构、不改生产部署拓扑。
  - 不改 engine-core、不改业务代码；只新增验证脚本与文档证据。
  - 不碰 admin-dashboard 与 Flutter 代码。
scope:
  files:
    - scripts/validation/
    - docs/worklog/completed/
    - docs/worklog/records/
    - docs/worklog/pending/
    - docs/runbooks/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af527-validation-boundaries-2026-11-26.md
    kind: report
gates:
  - command: node scripts/validation/queue-isolation-smoke.mjs
    check: 双实例队列隔离 smoke 通过
    threshold: exit=0 且 A/B 消费集合无交叉
  - command: pnpm lint
    check: ESLint 零错误
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs worklog verify --strict --state-free
    check: 工作日志完整性
    threshold: PASS
---
