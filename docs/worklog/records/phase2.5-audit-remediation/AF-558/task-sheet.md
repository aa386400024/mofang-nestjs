---
taskId: AF-558
contextId: phase2.5-audit-remediation
title: TTS Max 回退 HD 而非 Turbo
type: fix
status: backlog
baselineRef: b22876e49a2224b62c4db31a5d4136289d2952e0
riskClass: R2
gateProfile: full
dependsOn: []
priorTasks: [AF-557]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3, docs/team/agent-orchestration/README.md]
createdAt: 2026-11-27T00:15:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/voice/tts/runtime/tts-profile.registry.ts
    - src/voice/tts/runtime/tts-profile.resolver.ts
    - src/voice/voice.service.ts
    - test/voice/tts-profile-resolver.spec.ts
    - docs/worklog/pending
    - docs/worklog/completed/phase2.5
    - docs/worklog/records/phase2.5-audit-remediation/AF-558
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af558-tts-max-fallback-hd-2026-11-27.md
    kind: report
gates:
  - command: pnpm exec vitest run test/voice/tts-profile-resolver.spec.ts test/voice/tts-membership-tier.adapter.spec.ts
    check: 定向单测全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error 0 warning
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit 0
successCriteria:
  - Max 的 premium 档在豆包未配置或启动失败时回退 minimax-hd，而不是 minimax-turbo，并保留 fallbackFrom=doubao-seed-2.0 与 fallbackReason
  - Free/Plus 仍为 minimax-turbo，Pro 仍为 minimax-hd；Pro HD 运行期失败仍不降档
  - 回退目标由 registry 单一事实源提供，resolver 不散落硬编码 profile 字符串
  - 定向测试覆盖决策期未配置回退与运行期启动失败回退两条路径
  - pnpm lint / pnpm typecheck / pnpm test 全绿；src/engine-core 零改动
---
