---
taskId: AF-566
contextId: phase2.5-audit-remediation
title: AF-565 语音停顿与语料改造（提交域返修）
type: implementation
status: backlog
baselineRef: 2d965fb3fb98ca5826ae038a66c3c4ec3ba39796
riskClass: R2
gateProfile: full
dependsOn:
  - AF-561
priorTasks:
  - AF-565
reworkOf: AF-565
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-27T08:15:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/prosody/
    - src/voice/
    - src/engine-adapters/wiring/character/
    - src/engine-adapters/rendering/
    - test/shared/prosody/
    - test/voice/
    - test/engine-adapters/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-audit-remediation/AF-565/
    - docs/worklog/records/phase2.5-audit-remediation/AF-566/
  modules: [voice, auto-practice]
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af566-voice-pause-lexicon-rework-2026-11-27.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit 0
  - command: pnpm lint
    check: 0 error
    threshold: exit 0
  - command: pnpm exec vitest run test/shared/prosody test/engine-adapters/wp-j-p2-verbal-voice-wiring.spec.ts
    check: 定向测试全绿
    threshold: exit 0
successCriteria:
  - 交付内容与 AF-565 最终树一致：分档停顿、长沉默思考声、口头语轮换、10 条 verbalVoice、渲染层口头禅冷却
  - 提交历史只包含 AF-566 scope 内文件，不再混入 src/agent/visitor 或 test/agent
  - 通用池移除“那个”，角色签名低频保留
  - engine-core 零 diff
  - 回执七组字段通过预检，验收为 passed
---

# AF-566 · AF-565 语音停顿与语料改造（提交域返修）

## 背景

AF-565 的实现与测试已完成，但任务分支提交历史混入 `src/agent/visitor/visitor.prompts.ts` 与 `test/agent/visitor-prompt-semantic-tags.spec.ts`（后续虽已回退，提交事实仍越出 AF-565 scope），机读验收 V7 判定 rejected。

本任务按返修流程重交付：把同一份最终树压成一条 AF-566 干净提交，口头禅冷却规则放在 `src/engine-adapters/rendering/`，保留 AF-565 的任务单与交付记录作为审计证据。

## 范围

- 继承 AF-565 最终代码：`src/shared/prosody/`、`src/voice/`、`src/engine-adapters/wiring/character/`、`src/engine-adapters/rendering/`。
- 继承 AF-565 测试：`test/shared/prosody/`、`test/engine-adapters/wp-j-p2-verbal-voice-wiring.spec.ts`。
- 新增本任务交付记录；保留 AF-565 记录包，不删除原证据。

## 不在范围

- 不改 engine-core。
- 不改 MiniMax 模型/provider 选择。
- 不重跑 1000 场批次，不做人工盲评。
- 不改 `src/agent/visitor/` 与 `test/agent/`。
