---
taskId: AF-153
contextId: phase2.5-orchestration-closed-loop
title: AF-152 验收重签发与质量/admin 收口
type: fix
status: backlog
baselineRef: f5e08a8b572f08286430cab80971509a9d81dcd5
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T02:05:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
priorTasks: [AF-152, AF-151, AF-150, AF-149, AF-148, AF-147, AF-146, AF-131]
scope:
  files:
    - admin-dashboard/src/
    - admin-dashboard/README.md
    - admin-dashboard/pnpm-lock.yaml
    - src/admin-debug/
    - src/auto-practice/metrics/ai-double-blind.ts
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - test/admin-debug/wp26-admin-role-guard.spec.ts
    - data/phase25-exit/af152-cal96-out/
    - data/phase25-exit/af152-cal96-pack/
    - data/phase25-exit/af152-cal96-precaps/
    - data/phase25-exit/af152-af144-out/
    - data/phase25-exit/af152-af144-pack/
    - data/phase25-exit/af152-af144-precaps/
    - docs/worklog/pending/relay-response-AF152-20261120-0149.md
    - docs/worklog/pending/af153-quality-admin-close-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af153-quality-admin-close-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af153-quality-admin-close-2026-11-20.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 类型检查零错误
    threshold: exit=0
  - command: pnpm lint
    check: lint 零错误
    threshold: exit=0
  - command: pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts test/engine-core/boundary.spec.ts
    check: 评分口径与 engine-core 边界全绿
    threshold: exit=0
  - command: pnpm --dir admin-dashboard build
    check: admin-dashboard 生产构建通过
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
successCriteria:
  - 复用 AF-152 已落地实现，不再新写业务代码；只修验收材料与 scope 契约
  - admin 调试会话创建 / 列表 / 详情 / 发轮 / 恢复 / 关闭 / 重命名 / 删除全部走真实接口
  - 会话详情 delta / 事件标签 / 降级 / 审议 trace 直接使用后端字段，不再前端造数
  - ParamCalibrator 明确标注为模拟沙盘，并读取真实生效配置作为只读参考
  - 评分侧硬上限改后处理，补 cluster bootstrap 95% CI / AC1 / Krippendorff α，不调 0.40 阈值
  - 评分侧不把 4/6 或未达标写成临床验收达标；AI 结论保持 ai_proxy_candidate
  - code diff 不碰 src/engine-core；所有闸门数字必须真实执行并写入交付记录
  - 回执与交付记录必须让 AF-152 已提交文件全部落在 AF-153 scope 内，且不设人工复核阻塞项
---

## 背景

AF-152 已把评分后处理与 admin 实数据化全部落地并提交，但因任务快照 scope 只覆盖最初的 8 个路径，回执声明的路由清单测试、六组复算数据、回执文件与 README/锁文件越出 scope；同时 `conditional-pass` 带了 `manualReviewList`，被机读门判 rejected（reason=`归档前闭合终态`）。本单只做受审计的 scope 重签发与验收收口：

- 不新写业务代码，复用 `500d633 / 70f8028 / 526ebb8 / 2cfa96a / e4ffb6d` 全部实现。
- scope 显式包含 AF-152 实际提交的全部文件。
- 回执 `conditional-pass` 仅保留已登记 backlog，不设人工复核阻塞项。
- 质量结论不变：AI 质量门 4/6，safety 封顶后不通过、overall κ 0.365854 <0.40；不得写成临床达标。

## 边界

- 不调 0.40 / 3.50 / safety≥3 任一阈值。
- 不改 `src/engine-core`。
- 不改 AF-152 已归档的 rejected 记录与证据。
- 不把 admin 页面未做真实后端人工冒烟写成“已完成”。
