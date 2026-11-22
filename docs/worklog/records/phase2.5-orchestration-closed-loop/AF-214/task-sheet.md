---
taskId: AF-214
contextId: phase2.5-orchestration-closed-loop
title: 来访者真人度 R5：AI 双盲评分协议与可复算评测包
type: implementation
status: backlog
baselineRef: f32b62b4d290f4b0b9a382e762e593b4b04f906a
dependsOn: []
priorTasks: [AF-207, AF-208, AF-209, AF-213]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-21T01:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/
    - bin/
    - test/auto-practice/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af214-realism-ai-double-blind-2026-11-21.md
    kind: report
  - name: AI 双盲评测报告
    path: data/phase25-exit/af214-realism-ai-double-blind/report.json
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/af213-register-scene.spec.ts test/auto-practice/af213-realism-baseline.spec.ts test/auto-practice/af214-realism-rating.spec.ts test/auto-practice/af214-realism-blind-pack.spec.ts
    check: R4 回归 + R5 评分协议测试全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试 0 failed
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
successCriteria:
  - 建立五维真人度评分协议：自然度、情绪连续性、话轮形态、场景一致、关系在场；每维 1–5 分锚点有可观察行为描述，不评临床有效性。
  - 盲评包只暴露 packetId、场景标签与对话轮，不暴露角色 slug、咨询师档位、session id；按场景分层、按哈希稳定抽样。
  - R1 证据优先、R2 整体叙事；分歧达到阈值才仲裁；输出必须带 evidence 引用且能在 packet 原文中定位。
  - 一致性按线性加权 κ、exact、within±1 计算，并给出场景切片；不足以估计一致性时返回 null，不伪造 0 或 1。
  - 报告与日志不输出台词原文；必须带 humanSupervision=false / clinicalAcceptanceEligible=false 免责声明。
  - 对既有 data/debug-sessions 至少跑 8 个 packet 的真实 AI 双盲，产出可复算基线；失败 packet 计入失败表而非静默丢弃。
  - 定向测试、类型检查、lint、全量测试全绿；engine-core 零 diff；交付记录与回执齐全。
---

# AF-214 · 来访者真人度 R5

## 目标

R0–R4 已把“能不能说、说得对不对、场景像不像、prompt 会不会漏”做成确定性闸门。R5 补最后一层：**像不像真实来访者**。

本单不新跑 LLM 对练批次，也不改服务端运行时；只做离线 AI 代理双盲评测协议，并用既有 `data/debug-sessions` 产出可复算基线。这样 active 灰度前就有一把不会随模型心情漂移的尺子。

## 评分维度

固定五维，均为“观察来访者台词”，不评咨询师技术，不作诊断：

1. 自然度：是否像人在边说边想，而不是成稿朗读。
2. 情绪连续性：情绪是否承接上一轮，不突兀跳档、不为剧情服务而演。
3. 话轮形态：是否有短答、停顿、回避、反问等真实话轮，而不是每轮完整论述。
4. 场景一致：是否遵守本场接触方式，不混入其他媒介的表达。
5. 关系在场：是否对咨询师有真实反应（信任、试探、阻抗、靠近），而不是自说自话。

## 硬约束

- 不碰 `src/engine-core`；不改 provider 配置、不改 `.env`、不改编排脚本。
- 不新增 LLM 调用到生产链路；评分 CLI 只在离线运行。
- 盲评包不得带角色/档位/session id；报告不得含台词。
- 明确标注 AI 代理，不是真人督导；不得写成临床质量达标。
- 评分协议版本化；改锚点或提示词必须递增版本。

## 验收边界

- 本单只跑离线评测，不启动/重启服务，不新跑对练批次。
- 现有批次场景层大多缺失，基线按 `in_person` 回落，并在报告中显式说明。
- active 灰度与真实批次对照留到 R6；本单不宣称灰度通过。
