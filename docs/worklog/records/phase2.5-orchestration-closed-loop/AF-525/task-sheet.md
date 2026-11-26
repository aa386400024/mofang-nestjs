---
taskId: AF-525
contextId: phase2.5-orchestration-closed-loop
title: 验证环境隔离加固：BullMQ 命名空间 + 会话租约
type: fix
status: backlog
baselineRef: 9d700bf865db82a782d2be337688c52489f0f48e
dependsOn: []
priorTasks: [AF-524, AF-521]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T10:25:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R2
riskRationale: 改动横跨 BullMQ 队列命名空间与自动对练启动恢复，会影响所有队列消费者与 running 场次的启动清理；属于运行时基础设施面，需要 full gate 与全量测试。
gateProfile: full
objective: 消除共享 Redis / 共享 MySQL 下本地验证实例互相抢占 BullMQ 队列、以及启动恢复误标其他实例 running 会话的两种环境级串扰，为 1000 场出口⑤批次提供可重复、无跨实例干扰的运行底座。
successCriteria:
  - 新增 BullMQ prefix 单一解析入口：显式 BULLMQ_PREFIX 优先；production/test 回落 bullmq；development 默认按 REDIS_DB + 主机名 + 工作树路径哈希生成稳定命名空间，不同工作树/DB 不互相抢单，同一工作树重启后命名空间不变。
  - "全仓 Queue / Worker 构造点统一走同一解析入口，不再散写 prefix: 'bullmq'；现有 production/test 行为保持向后兼容。"
  - 新增自动对练会话租约服务：acquire 使用 SET NX EX，运行期心跳续租，release 仅释放本持有者；租约 TTL 与心跳间隔可集中配置。
  - PracticeRunnerService 在落库 running 行之前先取得租约，在 completed / failed / 异常路径都释放；正常运行中的场次始终有活跃租约。
  - 启动清理只标记没有活跃租约的 running 行；有租约的其他实例场次不得被误标 failed/interrupted；无法注入租约服务时跳过清理并显式告警，不得退回“全表标记”。
  - 单元测试覆盖：prefix 解析（显式 / prod / test / dev 不同工作树 / 同工作树稳定）；租约 acquire / heartbeat / owner-safe release；启动清理跳过活跃租约、只标记孤儿。
  - .env.example 补充 BULLMQ_PREFIX 可选说明，不改 .env。
  - pnpm build / pnpm typecheck / pnpm lint 全绿；目标测试通过；任务收尾 pnpm test 全量全绿。
  - git diff --stat HEAD -- src/engine-core 为空；events verify PASS；交付记录与机读回执六组字段齐全。
outOfScope:
  - 不新增数据库列或 migration；租约只放 Redis，不改变 ap_practice_sessions 表结构。
  - 不启动 1000 场出口⑤批次，不产生新的 LLM 批次费用。
  - 不改 .env、不改生产部署拓扑、不处理 af281r 工作树内文件。
  - 不碰 admin-dashboard 与 Flutter 代码。
  - 不改 engine-core 任何文件。
scope:
  files:
    - src/shared/infra/queue/
    - src/shared/infra/redis/
    - src/auto-practice/
    - src/agent/supervisor/
    - src/counselor/providers/
    - src/engine-adapters/deliberation/
    - src/knowledge-base/providers/
    - test/shared/infra/queue/
    - test/auto-practice/
    - test/engine-adapters/
    - test/counselor/
    - test/knowledge-base/
    - docs/worklog/
    - docs/runbooks/
    - .env.example
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af525-environment-isolation-2026-11-26.md
    kind: report
gates:
  - command: pnpm build
    check: 当前 HEAD 构建通过
    threshold: exit=0
  - command: pnpm typecheck
    check: TypeScript 零错误
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 零错误
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: 0 failed
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: PASS
---

# AF-525 · 验证环境隔离加固：BullMQ 命名空间 + 会话租约

## 1. 背景

AF-524 两轮定向复刻期间出现两次环境串扰：

1. 本地实例直接接共享 Redis `DB0` 时，BullMQ prefix 固定为 `bullmq`，远端 / 其他工作树的 `bullmq:auto-practice` worker 会抢走本地 job，并报“引擎调试面板接口未启用”。
2. `af281r` 工作树重启时，`PracticeRunnerService.onModuleInit` 把所有 `status=running` 的场次一律标成 `failed/interrupted`，把 AF-524 正在跑的场次短暂误标；最终虽跑完并恢复 `completed`，但证明共享 MySQL 的启动恢复没有实例归属保护。

这两项是 1000 场出口⑤批次前的硬阻塞。本单只做环境隔离加固，不跑新批次。

## 2. 方案

### 2.1 BullMQ 命名空间

新增 `resolveBullPrefix()` 单一入口：

- 显式 `BULLMQ_PREFIX` 优先，生产可显式指定稳定命名空间；
- `production` / `test` 未配置时回落 `bullmq`，保持现有队列键向后兼容；
- `development` 未配置时生成 `bullmq:dev:<REDIS_DB>:<host>:<worktreeHash>`，同一工作树重启稳定，不同工作树 / DB 隔离。

全仓 `new Queue` / `new Worker` 的 `prefix` 统一改为该入口结果，禁止继续散写字面量。

### 2.2 会话租约

新增 `PracticeSessionLeaseService`：

- key：`practice:lease:<practiceSessionId>`；
- acquire：`SET NX EX`，值为进程唯一 owner token；
- heartbeat：按 TTL 的 1/3 周期续租，只续自己的 key；
- release：Lua compare-and-delete，只删自己的 key；
- 启动清理：查询 running 行后，只把“无活跃租约”的场次标成 `failed/interrupted`；有租约的场次保留。

`PracticeRunnerService` 在落 running 行之前 acquire，在终态 / 异常路径 release；缺少租约服务时启动清理跳过并告警，绝不退回全表标记。

## 3. 验收

- 单元测试覆盖 prefix 解析、租约生命周期、启动清理的 active / orphan 两条分支；
- build / typecheck / lint / 全量 test 全绿；
- `src/engine-core` 零改动；
- 不新增 migration，不改 `.env`。
