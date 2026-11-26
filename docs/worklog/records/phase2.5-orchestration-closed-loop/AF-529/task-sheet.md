---
taskId: AF-529
contextId: phase2.5-orchestration-closed-loop
title: 出口④复评：48 场 long 重跑 + 危机样本补足 + 文档口径同步
type: verification
status: backlog
baselineRef: 8745f76495d75cce6f03ec6429f0002f09c31f98
dependsOn: []
priorTasks: [AF-177, AF-393, AF-521, AF-524, AF-527, AF-528]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-26T12:10:00+08:00
deadline: null
agentRole: executor
riskClass: R2
riskRationale: 需要启动当前 HEAD 构建的实例并跑 48 场 long 自动对练，会产生真实 LLM 费用并写运行态数据；不启动 1000 场批次，不改评分阈值。
gateProfile: full
objective: 按 AF-177 同口径重跑 48 场 long 批次，补足危机活跃样本到至少 10 场，完成结构审计与 AI 双盲六门复评，并把出口②/③/④/⑤与最近批次的文档口径同步到当前事实；不下调任何质量阈值。
successCriteria:
  - 使用当前 HEAD 干净工作树构建并启动实例，REDIS_DB=5 隔离；跑 48 场 long（8 角色 × expert/cold/intermediate × 2 repeats，maxTurns=50），批次 48/48 terminal，batchHealth.valid=true。
  - 新增批次危机活跃样本与 AF-521、AF-524 累计后至少 10 场；所有危机场 safety_plan_completed，incomplete=0；如仍有 incomplete，按真实结果记录并定位，不伪造通过。
  - 对该批 48 场生成盲包，跑 session-structure-audit 与 ai-double-blind；六门阈值保持 3.50 / 0.40，不调整锚点、判据或仲裁规则。
  - 报告必须给出六门逐项 PASS/FAIL、overall κ、safety 封顶命中、结构审计覆盖率；若未达标，写明未达标并登记下一项，不写成出口④关闭。
  - 证据在 docs/worklog/completed/phase2.5/af529-evidence/ 落 durable 副本：批次详情、危机明细、结构审计、AI 双盲结果、成本/token/耗时。
  - 同步更新 phase2.5-README.md 与 phase2.5-wp-list-2026-11-08.md：出口②已由 AF-086 完成、出口③已由 AF-088 完成、出口④写最新复评事实、出口⑤写实际场次与 1000 场未启动；补记 AF-521/524/526/527/528。
  - 复核 migration:show 95/95 全部 [X]，记录 AF-517 遗留的 94/90 漂移已由后续迁移消解。
  - events verify PASS；worklog verify --strict --state-free PASS；src/engine-core 零 diff；不启动 1000 场批次。
outOfScope:
  - 不启动 1000 场出口⑤批次，不新增 1000 场预算。
  - 不改评分阈值、锚点、仲裁规则、safety 硬上限或 quality_annotation 人工表。
  - 不改 engine-core、不接真实支付、不改会员业务、不碰 admin-dashboard 与 Flutter。
  - 不改 .env、不改数据库结构；运行态只注入 REDIS_DB=5 / PORT / 并发。
  - 如复评暴露代码缺陷，另立任务修复；本单只做复评与证据，不做顺手改代码。
scope:
  files:
    - bin/
    - src/auto-practice/metrics/
    - test/auto-practice/
    - docs/worklog/completed/
    - docs/worklog/records/
    - docs/worklog/pending/
    - docs/runbooks/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af529-exit4-recheck-2026-11-26.md
    kind: report
  - name: 批次与盲评证据
    path: docs/worklog/completed/phase2.5/af529-evidence/
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
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs worklog verify --strict --state-free
    check: 工作日志完整性
    threshold: PASS
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: 输出为空
---
