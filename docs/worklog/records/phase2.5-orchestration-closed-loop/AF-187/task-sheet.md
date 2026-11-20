---
taskId: AF-187
contextId: phase2.5-orchestration-closed-loop
title: 自动对练场景建模与输出完整性闸门
type: fix
status: backlog
baselineRef: 4ca4dbe5c772bccc9bf1a3c73ad0dbc4a0e49866
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3, conventions.md#5]
createdAt: 2026-11-20T17:20:00Z
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/encounter/
    - src/shared/text/
    - src/engine-adapters/rendering/
    - src/engine-adapters/wiring/
    - src/auto-practice/
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - admin-dashboard/src/
    - test/
    - docs/worklog/completed/phase2.5/af187-encounter-scene-output-integrity-2026-11-20.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af187-encounter-scene-output-integrity-2026-11-20.md
    kind: report
gates:
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit=0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm test -- test/auto-practice/af187-encounter-scene-output-integrity.spec.ts
    check: 定向回归全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量全绿
    threshold: exit=0
successCriteria:
  - 场景作为一级会话配置：默认 in_person，支持 online 的 video / voice / text 子通道，新增场景只扩注册表不改调用链
  - 面对面提示词禁止线上媒介词，线上按子通道放开对应媒介词；来访者与咨询师两侧都拿到同一份场景契约
  - 来访者回复与咨询师回复在写入逐字稿前过输出完整性闸门，prompt 复述、推理泄漏、异常外语、乱码一律不进 transcript
  - 风险收束五组按会话级覆盖账本去重，连续收束轮不得重复粘贴同一套模板
  - 危机收尾状态自洽：安全收束完成有可读的完成态，不再只呈现 crisis_practice_max 加 crisisEnded=false
  - 两个导出文件中的已知泄漏样本全部被回归用例覆盖，且不引入新的 engine-core diff
plannedArtifacts: []
requiredSkills: []
requiredTools: []
outOfScope:
  - src/engine-core/ 任何文件
  - Flutter 客户端代码
constraints:
  - 新增场景能力必须保持无场景调用路径的 prompt 逐字不变
  - 输出闸门只做判定与安全兜底，不在纯层做内容改写
priorTasks: [AF-186]
---

# AF-187 · 自动对练场景建模与输出完整性闸门

## 1. 背景

用户导出的两场自动对练（`FzkJ9Z15n10nNUed1hWv_` / `fJI3UtvAl6u1Ss34JViWq`）暴露四类缺陷叠加：

1. **场景层缺失**：来访者提示词写“像真实的人聊天”，咨询师开场硬编码“咨询室场景”，媒介词随机出现，输出呈线上打字聊天风格。
2. **输出层无闸门**：来访者第 99 条复述整段渲染 prompt；咨询师第 100 条以 `We need respond in Chinese...` 开头；第 44 条出现韩文与英文；第 6/96/98 条出现 `mild`、`staying safe`、`NAC?`。坏输出直接进逐字稿并污染后续上下文。
3. **风险收束逐轮重复**：危机收束轮按单轮缺项判断，连续收束轮每轮重贴“移开药和刀、联系家人、不要独处、安全计划”整套。
4. **收尾状态不一致**：两场均 `completed` + `exitReason=crisis_practice_max` + `crisisEnded=false`，但第二场已完成热线、开门、收危险物。

## 2. 目标

- 场景显式建模为会话一级配置，默认面对面；线上支持视频 / 语音 / 文字三个子通道；新增场景通过注册表扩展。
- 来访者与咨询师提示词共用同一份场景契约，媒介词按场景与子通道约束。
- 落库前统一输出完整性闸门，非法文本重试一次、仍非法则安全兜底并标降级，绝不写入历史。
- 风险收束改会话级覆盖账本，整场只补真正缺项。
- 危机收尾增加可读完成态，修正导出语义。
- 用两个导出文件构造回归语料，覆盖已知泄漏样本。

## 3. 范围

- 代码：`src/shared/encounter/`、`src/shared/text/`、`src/engine-adapters/rendering/`、`src/engine-adapters/wiring/`、`src/auto-practice/`、`src/admin-debug/`、`src/migration/`、`bin/ormconfig.ts`、`admin-dashboard/src/`。
- 测试：`test/`。
- 文档：本任务交付记录。

## 4. 非目标

- 不改 `src/engine-core/`。
- 不碰 Flutter 客户端。
- 不做真人督导或临床双标；AI 结论仍只作 `ai_proxy_candidate`。
- 不重跑历史批次、不改历史数据。

## 5. 验收

见 frontmatter `successCriteria` 与 `gates`，交付记录必须给出真实命令输出数字。
