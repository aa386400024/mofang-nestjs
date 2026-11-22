---
taskId: AF-288
contextId: phase2.5-orchestration-closed-loop
title: 豆包主候选 20 轮长对练 soak 与 8 路并发真实 smoke
type: verification
status: backlog
baselineRef: c932e9d14f98a8e1300cf69279926f7378303766
dependsOn: [AF-285, AF-286, AF-287]
priorTasks: [AF-268, AF-278, AF-283, AF-285, AF-286, AF-287]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T16:15:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 长对练与并发 smoke 交付记录
    path: docs/worklog/completed/phase2.5/af288-doubao-long-soak-concurrency-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec tsx bin/visitor-switch-check.ts --expect-primary doubao
    check: 主候选仍为豆包
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --turns 20
    check: 20 轮串行长对练全成功、无 fallback/degraded
    threshold: exit=0
  - command: pnpm exec tsx bin/visitor-render-smoke.ts --provider doubao --caller router --concurrency 8 --turns 1
    check: 8 路并发单轮全成功、无 fallback/degraded
    threshold: exit=0
---
# AF-288 · 豆包主候选长对练 soak 与并发 smoke

## 背景

AF-285 只做了 3 轮豆包主候选 smoke，AF-268 的长上下文验证对象是 MiniMax。当前生产主候选已切到 `doubao-seed-character-260628`，但还没有证据回答：

1. 20 轮连续对练下，上下文增长是否导致 TTFT 漂移、prompt token 异常增长或截断？
2. 8 路并发单轮是否会触发 429、fallback 或 degraded？
3. 候选链在真实负载下是否仍保持 `doubao -> minimax`，而不是悄悄回退？

本单是验证任务，不改业务代码、不改配置、不改候选链。

## 目标

1. 只读确认 `VISITOR_LLM_PROVIDER=doubao`，主候选模型 `doubao-seed-character-260628`。
2. 跑 20 轮串行真实 smoke，逐轮记录 wall / TTFT / prompt / completion / finishReason / fallback / degraded / guard。
3. 跑 8 路并发单轮真实 smoke，记录每路耗时、TTFT、失败原因与是否回退。
4. 与 AF-285 的 3 轮基线对比，判断是否存在可复现的 TTFT 或 token 漂移。
5. 若发现异常，只登记 backlog，不在本单改代码；若出现 auth/持续 429/degraded，按 Runbook 判读并给出回滚建议。

## 非目标

- 不改 `src/**`、`docker/**`、`.env`。
- 不做压力上限探索（不跑 32/64 路），不测计费上限。
- 不启动 Nest、不写库、不触发真实会话持久化。
- 不替代生产灰度监控；本单只是发版前证据。

## 方法

- `bin/visitor-switch-check.ts`：只读 `.env`，不联网，不打印密钥。
- `bin/visitor-render-smoke.ts --turns 20`：同一会话串行 20 轮，咨询师台词按脚本循环，历史随轮次增长。
- `bin/visitor-render-smoke.ts --concurrency 8`：8 路独立会话各 1 轮，固定单轮，避免同文案互相掩盖串话。
- 所有输出落 `data/af288-*.log`，交付记录只引用数字与结论，不贴完整台词。

## 验收

- 三条命令 exit 0；若任一失败，交付记录必须写清失败轮次、cause、是否 fallback/degraded，并给出下一步。
- 20 轮结果逐轮表完整（turn / wall / TTFT / prompt / completion / finishReason）。
- 并发结果逐路表完整（slot / wall / TTFT / outcome / fallback）。
- 与 AF-285 基线对比有明确结论：一致 / 漂移（漂移需给数值与可能原因）。
- 不改任何业务文件；`git diff --stat` 只允许 docs/worklog 与状态面。
