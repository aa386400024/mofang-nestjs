---
taskId: AF-466
contextId: phase2.5-visitor-register-eval
title: 补齐 10 个标定角色的语域资产并重跑机制稳定性评测
type: implementation
status: backlog
baselineRef: 28aa06c1dbfe9f35acda47fb62c18c0c25a08f01
dependsOn: []
priorTasks: [AF-465, AF-462]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-24T19:30:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-adapters/wiring/character/
    - bin/seed-character-profiles.ts
    - test/engine-adapters/
    - scripts/eval/visitor-register-stability/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-visitor-register-eval/AF-466/
  modules:
    - character-assets
    - eval
  interfaces: []
artifacts:
  - name: 10 角色语域资产补齐与重跑报告
    path: docs/worklog/completed/phase2.5/af466-10role-register-rerun-2026-11-24.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/character-baseline-calibration.spec.ts test/engine-adapters/character-baseline-seed-calibration.spec.ts test/engine-adapters/af106-character-pool.spec.ts test/engine-adapters/wp9b-db-character-resolver.spec.ts test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts test/engine-adapters/wp10a-character-expression-fields.spec.ts test/engine-adapters/af357-character-desire-mapping.spec.ts
    check: 角色资产相关单测全绿
    threshold: 0 failed
  - command: pnpm exec vitest run scripts/eval/visitor-register-stability/__tests__/metrics.spec.mjs
    check: 评测指标单测全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查
    threshold: 0 error
  - command: pnpm lint
    check: 全量 lint
    threshold: 0 error
successCriteria:
  - 10 个标定角色在 character_profiles 中全部为 approved + enabled，且 speech_register 非空
  - 两个缺口角色（vpt_parenting_projection_l1 / vpt_social_anxiety_avoidance_l1）进入 A 类内容 seed，核心信念取自来访池模板
  - 4 个 B 类角色的内容 seed 按 templateId 装配 speechRegister，不复制第二份语域真相
  - 权威标定表扩到 10 行并通过区间 / 情绪标签 / 可区分性 / 无维度塌缩自检
  - seed 连续两次执行幂等（第二次 A 类 6 / B 类 4 全部 unchanged）
  - 用既有 harness 跑满 10 角色 × base/active × 30 轮 = 20 场，失败轮 0
  - active 注入覆盖 10/10，base 0/10；报告给出方向、刻板、稳定、不回归、护栏与成本口径
  - 不改 src/engine-core；不提交原始心理台词；报告写清与 AF-465 的结论差异
---

## 1. 背景

AF-465 已完成 8 可用角色 × 双模式 × 30 轮的机制稳定性评测，结论是 `injection_coverage_blocked`：
阻断不在渲染层或 pilot 白名单，而在数据库的 `character_profiles.speech_register` 列。要回答
“10 个标定角色上机制是否稳定有效”，必须先把 10 个角色的 profile 行与语域列补齐，再按同一套
预注册门槛重跑。

## 2. 已核实的缺口

- `vpt_parenting_projection_l1`（阿禾）、`vpt_social_anxiety_avoidance_l1`（小舟）在
  `visitor-pool-seed.ts` 有完整来访池模板，但不在 `CHARACTER_PROFILE_SEED_SPECS` 与
  `CHARACTER_BASELINE_CALIBRATION` 中，seed 不会建行。
- 4 个 B 类角色（安然 / 语桐 / 沉舟 / 惊尘）有 profile 行，但 `speech_register` 为 NULL；
  其内容 seed 的 `baselineOf` 目前只装配 8 个数值 + `verbalVoice`，未带 `speechRegister`。
- `speech-register.calibration.ts` 已含全部 10 个角色的语域标定，语域内容本身不缺。

## 3. 实现口径

- A 类：两个缺口角色补 `CHARACTER_PROFILE_SEED_SPECS`；五 Ps、愿望、约束、敏感议题从既有
  来访池模板转写；数值与台词指纹从权威标定表装配，语域从 `getVisitorSpeechRegister` 装配。
- B 类：把 `speechRegister` 纳入 DB-only 内容 seed 的 `baselineOf` 装配，随内容 upsert 落库；
  基线校准路径保持“只更新 8 个基线列 + 台词指纹”的既有纪律。
- 权威标定表新增两行，数值为工程标定值（非临床标定），必须通过既有可区分性 / 跨度自检。
- 测试从“8 角色池”口径升级到“10 角色池”，同时保留 B 类 4 个的边界断言。
- 评测复用 AF-465 的 harness 与预注册门槛；脚本与门槛如需改动，必须在开跑前完成并冻结哈希。

## 4. 判定口径

沿用 AF-465 §4 预注册门槛，按 10 角色重算：
注入 10/10；方向至少 8/10；刻板至少 9/10 且无角色下降 > 0.5；稳定至少 8/10；
不回归与 BDI 护栏逐场核对；prompt 中位 ≤ +25%，p95 延迟 ≤ +15%。
若仍不达门槛，按真实结果给出阻塞层级，不把“注入成功”写成“机制稳定”。

## 5. 非目标

- 不改 `src/engine-core`，不改语域渲染算法本身。
- 不引入人评，不扩大角色池到 10 以外。
- 不提交 `data/eval-reports/` 下原始台词与 judge 原始响应。
