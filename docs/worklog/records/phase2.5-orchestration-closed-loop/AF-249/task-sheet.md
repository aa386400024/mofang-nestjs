---
taskId: AF-249
contextId: phase2.5-orchestration-closed-loop
title: visitor 豆包 Seed Character 生产链路 smoke（真实 API，一次）
type: implementation
status: backlog
baselineRef: 18881783605bd7f868581ee29411ba3770de78ae
dependsOn: [AF-248]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-22T06:58:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af249-doubao-prod-smoke-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-doubao-smoke.ts
    check: 真实豆包 Seed Character 调用返回非空正文且无 error chunk
    threshold: exit=0
  - command: pnpm lint
    check: 0 error
    threshold: exit=0
  - command: pnpm exec tsc --noEmit -p tsconfig.json
    check: CI 全量 typecheck 0 error
    threshold: exit=0
---

# AF-249 · visitor 豆包 Seed Character 生产链路 smoke

## 背景

AF-248 已把生产 visitor 的 provider 与 prompt 变体做成 env 开关，但只用假端口单测验证了拼接与解析，没有用真实 `LLM_DOUBAO_API_KEY` 走通 `LlmService → 火山方舟 /api/v3/chat/completions → doubao-seed-character-260628`。开灰度前必须有一次真实链路证据。

## 目标

1. 新增 `bin/visitor-doubao-smoke.ts`：只读加载 `.env`，用生产 `LlmService` 的 per-call `provider='doubao'` 调一次 `doubao-seed-character-260628`，短 prompt、低 `maxTokens`、单次请求。
2. 校验 HTTP 成功、至少收到 1 个 `content` chunk、无 `error` chunk；打印模型、耗时、字符数、usage、finishReason，不打印密钥与完整长文（只截前 80 字）。
3. 失败时按 error code 明确区分 key 无效、模型未开通、端点错误、网络错误，退出码非 0。

## 非目标

- 不改 `src/engine-core`。
- 不跑影子实验复评，不做真人双标。
- 不把 smoke 脚本接入 CI（真实 API 只在人工/发布前执行）。

## 验收

- 真实调用 exit 0，输出包含非空正文与 usage。
- `pnpm lint`、`pnpm exec tsc --noEmit -p tsconfig.json` 全绿。
- 交付记录写清真实调用的模型、耗时、字符数与失败时的诊断口径。
