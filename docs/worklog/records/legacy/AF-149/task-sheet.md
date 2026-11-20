---
taskId: AF-149
contextId: phase2.5-orchestration-closed-loop
title: 评分口径收口与 admin 调试引擎实数据化
type: implementation
status: backlog
baselineRef: f5e08a8b572f08286430cab80971509a9d81dcd5
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-20T01:30:00+08:00
deadline: 2026-11-20T08:00:00+08:00
agentRole: executor
priorTasks: [AF-148, AF-147, AF-146, AF-131]
scope:
  files:
    - admin-dashboard/src/
    - src/admin-debug/
    - src/auto-practice/metrics/ai-double-blind.ts
    - bin/ai-double-blind.ts
    - test/auto-practice/ai-double-blind.spec.ts
    - docs/team/agent-orchestration/agent-cards/executor.json
    - docs/worklog/pending/af149-quality-admin-task-2026-11-20.md
    - docs/worklog/completed/phase2.5/af149-quality-admin-2026-11-20.md
    - docs/worklog/pending/phase2.5-README.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af149-quality-admin-2026-11-20.md
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
  - admin 调试会话创建 / 列表 / 详情 / 发轮 / 恢复 / 关闭 / 重命名 / 删除全部走真实接口
  - 会话详情 delta / 事件标签 / 降级 / 审议 trace 直接使用后端字段，不再前端造数
  - 后端缺失的 cap / 信念激活字段显示空态或不可用，不再 mock ±0.2 / 假信念
  - AutoPractice 不再出现“接口待补”假动作；无后端支持的 AI 重命名入口移除或明确禁用
  - ParamCalibrator 明确标注为模拟沙盘，并读取真实生效配置作为只读参考
  - 评分侧硬上限改后处理，补 cluster bootstrap 95% CI / AC1 / Krippendorff α，不调 0.40 阈值
  - 评分侧不把 5/6 或未达标写成临床验收达标；AI 结论保持 ai_proxy_candidate
  - code diff 不碰 src/engine-core；所有闸门数字必须真实执行并写入交付记录
---

## 背景

用户要求把 Phase 2.5 出口④剩余质量债和 admin 调试引擎前端一起收口，采用最新编排框架、独立分支、真实闸门。两条工作流并行：

- MiniMax：评分口径后处理硬上限 + 统计稳定性诊断 + 96 场校准复算。
- Main：admin-dashboard 调试引擎实数据化，清除前端 mock / fallback / 死动作。

## 边界

- 评分侧不调低 0.40 / 3.50 / safety≥3 任一阈值，不写临床验收达标。
- 前端侧不把无后端数据的字段造假；没有真实字段就显示空态或不可用。
- 两边不碰 `src/engine-core`。
- 编排状态面只由 Main 写；MiniMax 在独立 worktree 只改评分 scope，不改状态面。
