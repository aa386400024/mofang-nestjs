---
taskId: AF-202
contextId: phase2.5-orchestration-closed-loop
title: 自动对练默认语音与边界矩阵重签收入账
type: fix
status: backlog
baselineRef: 7b16f69654c500df1ea9807f0f35ea6a90f312a7
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T20:58:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/encounter/
    - src/auto-practice/auto-practice.controller.ts
    - admin-dashboard/src/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/af201-scene-default-voice-boundary-matrix-2026-11-20.md
    - docs/worklog/completed/phase2.5/af202-scene-default-voice-boundary-matrix-2026-11-20.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-200/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-201/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-202/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af202-scene-default-voice-boundary-matrix-2026-11-20.md
    kind: report
gates:
  - command: pnpm exec eslint --no-cache "{src,test,bin}/**/*.ts"
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm --dir admin-dashboard type-check
    check: 前端类型检查通过
    threshold: exit=0
  - command: pnpm test -- test/auto-practice/af187-encounter-output-integrity.spec.ts test/auto-practice/af200-scene-boundary-matrix.spec.ts
    check: 定向回归与边界矩阵全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包完整
    threshold: exit=0
successCriteria:
  - 线上场景缺省子通道改为语音，后端注册表、请求解析回落、开场提示保持一致
  - 后台单场与批量入口缺省通道同步为语音，历史无 channel 的线上会话按语音展示
  - 建立 7 种咨询师模式 × 3 种接触方式的确定性边界矩阵，覆盖专家、家常、胡言乱语、冷漠、说教、新手、中级
  - 坏咨询师台词不得改变来访者场景契约；跨场景媒介词必须被漂移检测与输出完整性闸门拦截
  - 既有面对面默认、legacy 无场景调用逐字不变行为不回退
  - 全量测试、lint、typecheck、前端 vue-tsc、engine-core 零 diff 真实通过
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
  - 真实模型批量压测与 AI rubric 评分（下一任务单执行）
constraints:
  - 不手改 journal / task-state-index
  - 不改变 in_person 默认与 legacy 无场景调用行为
  - 真实模型批次只定义矩阵入口与断言边界，不伪造模型输出
priorTasks: [AF-187, AF-198, AF-199, AF-200, AF-201]
---

# AF-202 · 自动对练默认语音与边界矩阵重签收入账

## 背景

AF-201 的技术实现与测试已通过，但执行提交把 AF-200 的 canceled 记录一并带入，而 AF-201 scope 只声明了 AF-201 记录目录，验收 V7 按 commit 事实判 AF-200 记录为 scope 外，任务被 `rejected` 并归档。

本单按框架重签发，继承 AF-201 的全部技术目标，并把 AF-200 / AF-201 的历史记录目录纳入 scope，保证“实现 + 状态面 + 历史记录”一次提交可通过 V7。

## 范围

1. 线上默认 `voice`：注册表、控制器请求解析、线上开场提示保持一致。
2. 后台单场 / 批量默认通道 `voice`；历史 `online` 且无 channel 按语音展示。
3. 7 种咨询师模式 × 3 种接触方式的确定性边界矩阵保持不变。
4. 保留 AF-201 的技术交付记录，并新增 AF-202 最终交付记录说明重签发原因。
5. 保留 `in_person` 缺省与 legacy 无场景调用逐字不变。

## 验收

见 frontmatter `successCriteria`。
