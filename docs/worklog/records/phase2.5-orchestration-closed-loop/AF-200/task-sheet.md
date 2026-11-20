---
taskId: AF-200
contextId: phase2.5-orchestration-closed-loop
title: 自动对练场景默认语音与坏咨询师边界压测矩阵
type: fix
status: backlog
baselineRef: 7b16f69654c500df1ea9807f0f35ea6a90f312a7
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T19:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/encounter/
    - admin-dashboard/src/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/af200-scene-default-voice-boundary-matrix-2026-11-20.md
    - docs/worklog/records/phase2.5-orchestration-closed-loop/AF-200/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af200-scene-default-voice-boundary-matrix-2026-11-20.md
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
  - 线上场景缺省子通道改为语音，后端注册表、非法通道回落、开场提示保持一致
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
priorTasks: [AF-187, AF-198, AF-199]
---

# AF-200 · 自动对练场景默认语音与坏咨询师边界压测矩阵

## 背景

AF-187 已把接触方式做成一级会话配置，但线上缺省子通道仍是 `video`，与产品口径「线上默认语音」不一致；后台单场与批量入口也把 `video` 写在默认值上。

同时，咨询师种子里已有 7 种模式（专家 / 中级 / 新手 / 聊家常 / 冷漠 / 说教 / 胡说八道），但固定验收只覆盖 `cold / expert / intermediate`。坏咨询师输入是来访者引擎鲁棒性的关键压测面，需要进入确定性回归矩阵，而不是依赖人工临时选模式。

## 范围

1. 后端 `online.defaultChannel` 改为 `voice`，非法通道回落与线上基础开场提示同步为语音。
2. 后台单场 / 批量场景默认通道改为 `voice`；历史 `online` 且 `encounterChannel` 为空的会话按语音展示。
3. 新增确定性边界矩阵测试：7 种咨询师模式 × `in_person / online voice / online text`，验证模式提示不被场景块覆盖、坏台词不改变场景契约、跨场景媒介词被拦截。
4. 保留 `in_person` 缺省与 legacy 无场景调用逐字不变。

## 验收

见 frontmatter `successCriteria`。真实模型批量压测不在本单伪造，只登记为后续 AI rubric 批次。
