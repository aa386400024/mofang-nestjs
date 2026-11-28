---
taskId: AF-616
contextId: phase3-judge-layer
title: Judge Layer P1-A（AF-612 scope 重签发）：双 Judge 同场配对一致率纯度量与 agreement 指标段
type: implementation
status: backlog
riskClass: R1
baselineRef: 67bd90e6aada453f0c1743e57d10de0d8f200899
dependsOn: [AF-611]
priorTasks: [AF-612]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-29T02:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/records/phase3-judge-layer/AF-616/
    - docs/worklog/completed/phase3-judge-layer/af616-p1-judge-agreement-metrics-2026-11-29.md
    - src/engine-adapters/judge/judge.agreement.ts
    - src/engine-adapters/judge/judge.types.ts
    - src/auto-practice/metrics/metric-dictionary.ts
    - src/auto-practice/metrics/batch-metrics.schema.ts
    - test/engine-adapters/judge/judge-agreement.spec.ts
    - test/auto-practice/wp-k-metric-dictionary.spec.ts
  modules:
    - engine-adapters/judge
    - auto-practice/metrics
  interfaces:
    - JudgePairAgreement
    - JudgeAgreementReport
artifacts:
  - name: AF-616 Judge P1-A 一致率度量交付记录
    path: docs/worklog/completed/phase3-judge-layer/af616-p1-judge-agreement-metrics-2026-11-29.md
    kind: report
gates:
  - command: node scripts/orchestration/cli.mjs events verify
    check: 后端事件链、哈希链与索引投影一致
    threshold: PASS
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/records/phase3-judge-layer/AF-616/task-sheet.md
    check: AF-616 任务单契约校验通过；AF-600 / AF-601 / AF-602 历史回执 schema 缺口不计入本单新增失败
    threshold: AF-616 任务单元 PASS
  - command: pnpm lint
    check: Judge 一致率模块、指标字典与快照守卫相关文件 lint 通过，沿用缓存口径
    threshold: PASS
  - command: pnpm typecheck
    check: 配对类型、纯函数、指标字典与快照守卫 TypeScript 编译通过
    threshold: PASS
  - command: pnpm exec vitest run test/engine-adapters/judge test/auto-practice/wp-k-metric-dictionary.spec.ts
    check: Judge 一致率配对、聚合、低样本守卫、快照可选段与字典升版断言全绿
    threshold: 目标规格全绿
  - command: pnpm orchestration:preflight
    check: 暂存文件唯一归属 AF-616，不含状态面生成物、legacy migrate 遗留或冻结期 PsyGuard 改动
    threshold: PASS
successCriteria:
  - 纯函数模块计算双 Judge 同场配对结果：逐维 0/1/2 评级是否一致、三维整体一致集合、两侧整体信心度差值、分歧维度清单；任一侧结果为 null 时该场次不计入配对分母
  - 批次聚合输出配对场次数、逐维一致率、整体一致率与分歧维度分布；样本量低于配置的最小场次门槛时一致率字段记 null，不产出达标或不达标结论；口径保持 neutral 观测纪律，不进入 Regression evaluator 好坏判定
  - 指标字典新增 judge.agreement.* neutral 指标段；字典版本按字典自身规则升到 dict-v5，并在交付记录写明条目与版本变更原因；快照 schema 保持 v1，agreement 作为 judge 段可选子段接入，旧快照或缺省段兼容通过，非法 agreement 段被守卫拒绝
  - 血缘不重复采集：agreement 结果只引用两侧既有 lineage 的 provider、模型、Rubric 版本、Prompt 版本与指纹，本模块不发起任何 Provider 调用
  - 单测覆盖：完全一致、逐维分歧、单侧 null、双侧 null、低样本一致率记 null、信心差与分歧清单、快照可选子段的兼容通过与拒绝路径
  - 交付记录登记新增指标 id、类型与纯函数位置、测试命令与结果，以及第二 Provider 尚未接入的遗留项说明
outOfScope:
  - 不接入第二模型族 Provider，不新增第三方 LLM SDK、评分库或数据库驱动依赖，不实现双 Judge 并发调用编排；第二 Provider 待外部模型 key 到位后另开任务单
  - 不把一致率阈值接入 P2 回归判据，不修改 Regression evaluator 的四态 verdict、五条 incomparable 条件或中性维度纪律
  - 不新建数据库表或 migration，不提供 HTTP 接口、管理端或标注台页面
  - 不做 AI/真人一致性矩阵（AF-614 范围），不实现人工复核队列入队规则（AF-613 范围）
  - 不重构 drills 判定引擎、不改 DrillVerdict 枚举；不触碰冻结期 PsyGuard Python 服务代码、数据与环境；不修改 Flutter 客户端与现有 HTTP 展示契约
constraints:
  - 状态面只能经 NestJS CLI 写入；本单不手工编辑 task-state-index.json、journal.jsonl、快照或 Web 投影
  - 后端脚本优先 pnpm 口径；禁止裸 npx；lint 走 pnpm lint 缓存；测试按需运行，全量回归仅在任务收尾执行一次
  - 提交标题遵循 conventional commit；提交钩子正常运行，不使用 --no-verify、force push、直推 integrate 或删除 required checks
  - 工作区既有 legacy manifest 修改、回执删除件、未跟踪 legacy 记录包、状态投影与 Web data.js 不纳入 AF-616 提交
---

# AF-616 · Judge Layer P1-A（AF-612 scope 重签发）：双 Judge 同场配对一致率纯度量与 agreement 指标段

## 0. 重签发原因

AF-612 的成功标准要求字典版本升到 `dict-v5`，但既有 `test/auto-practice/wp-k-metric-dictionary.spec.ts` 硬编码 `dict-v4`，该文件不在 AF-612 `scope.files` 内，会导致 `orchestration:preflight` 判 scope 越界。因 AF-612 已进入 `submitted` 状态，仓库 CLI 明确禁止对已进入实现的任务原地改 scope，故按审计口径重签发本任务，`priorTasks` 保留 AF-612 链路。

本任务承接原 AF-612 全部业务目标与验收标准，不改变实现范围；仅将上述既有字典测试加入 scope，并把 validate 闸门指向已落盘的任务单路径。

## 1. 背景

AF-611 已交付 Judge P0：ReviewJudgePort、首个现有厂商 Provider、Rubric 版本化、Shadow 落库骨架与可选快照 Judge 段。AF-611 outOfScope 明确排除 P1 双 Judge、跨模型族一致率统计、人工复核队列与 AI/真人一致性矩阵。

本单承接 P1 的一致率度量基础：在不接入第二 Provider、不发起新 LLM 调用的前提下，先把「两场 Judge 结果配对 → 逐维/整体一致率 → 批次聚合 → 快照可选段与指标字典」的纯函数链路与测试骨架落地。第二模型族 Provider 接入依赖外部模型 key，属后续独立切片。

设计依据：docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md §7 P1、§8 同源偏置与小样本风险护栏。

## 2. 改动清单

| 编号 | 仓库 / 位置 | 文件或模块 | 动作 |
| --- | --- | --- | --- |
| A1-1 | mofang-nestjs | src/engine-adapters/judge/judge.agreement.ts | 新增配对结果类型、逐维与整体一致判定、批次聚合纯函数 |
| A1-2 | mofang-nestjs | src/engine-adapters/judge/judge.types.ts | 补充 agreement 相关只读类型，不改变 P0 既有结果形状 |
| A1-3 | mofang-nestjs | src/auto-practice/metrics/metric-dictionary.ts | 新增 judge.agreement.* neutral 指标段，字典版本升到 dict-v5 |
| A1-4 | mofang-nestjs | src/auto-practice/metrics/batch-metrics.schema.ts | judge 段内 agreement 可选子段守卫；旧快照兼容、非法段拒绝 |
| A1-5 | mofang-nestjs | test/engine-adapters/judge/judge-agreement.spec.ts | 配对一致/分歧/单侧 null/低样本/快照守卫单测 |
| A1-6 | mofang-nestjs | test/auto-practice/wp-k-metric-dictionary.spec.ts | 既有字典版本断言同步 dict-v5（本次新增授权） |
| A1-7 | mofang-nestjs | docs/worklog/records/phase3-judge-layer/AF-616/ 与完成态交付记录 | 任务记录包、回执副本、验收清单、scope 隔离与 backlog 遗留 |

## 3. 产品与工程边界

### 3.1 必须保留

- 一致率只描述两场机器代理评审的对齐程度，不解释为分数、及格线、排名或临床诊断。
- 样本不足时一致率记 null，维持 Shadow 观测属性；Judge 信号不得改变批次通过、回归或不可比判定。
- 所有评审输入与记录沿用 P0 脱敏纪律：不落原始对话，危机/自伤轮次只保留本地规则结论与引用。

### 3.2 明确不做

- 不新增第二厂商 Provider 配置、枚举或适配实现；不并发编排两次 Judge 调用。
- 不在本单设定任何进入 P2 判据的阈值表；门槛与最小样本量的业务拍板另走决策项。
- 不提供真人评审录入、人审队列或矩阵报表页面。

## 4. 闸门口径

1. events verify：事件链、哈希链与任务索引投影一致。
2. 任务单 validate：AF-616 schema 与字段契约通过；历史 AF-600 / AF-601 / AF-602 回执缺口作为既有债，不计入本单新增失败。
3. pnpm lint：新模块、指标字典、快照守卫与测试文件通过 lint 缓存检查。
4. pnpm typecheck：配对类型、纯函数、字典与守卫编译通过。
5. 目标 Vitest 规格：配对、聚合、低样本守卫、可选子段守卫与 dict-v5 断言全绿。
6. orchestration:preflight：暂存范围只覆盖 AF-616 scope；状态面生成物、legacy migrate 遗留与 PsyGuard 改动不得混入。

## 5. 回执回收要点

执行方回执需写明：agreement 纯函数与类型文件、新增指标 id、快照可选子段字段、低样本守卫口径、测试命令与结果、未接入第二 Provider 的遗留项。小豆回收时只核对回执工件路径、字段完整性、scope 引用、依赖与台账状态；测试、lint、typecheck 等业务闸门结论以执行方回执与原始日志为准。
