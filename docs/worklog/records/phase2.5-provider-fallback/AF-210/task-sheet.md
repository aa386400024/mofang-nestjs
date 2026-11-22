---
taskId: AF-210
contextId: phase2.5-provider-fallback
title: 豆包（火山方舟）第二 provider 接入：档位模型映射修复、热备开关与连通取证
type: fix
status: backlog
baselineRef: e54012bfc3f7f01c36bf60695df7bfa775558dca
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.4]
createdAt: 2026-11-21T00:26:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/llm/registry/llm-router.service.ts
    - src/llm/providers/doubao.provider.ts
    - src/engine-adapters/wiring/render-config.factory.ts
    - test/llm/
    - test/engine-adapters/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-provider-fallback/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af210-doubao-fallback-provider-2026-11-21.md
    kind: report
gates:
  - command: pnpm exec vitest run test/llm/af210-doubao-tier-mapping.spec.ts test/engine-adapters/af210-render-model-override.spec.ts
    check: 豆包档位映射与候选模型覆盖定向用例全绿
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
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 适配层机读校验全 PASS
    threshold: FAIL=0
successCriteria:
  - 豆包三档模型名全部换成方舟当前有效型号（lite-260915 / pro-260628），旧名 doubao-lite、doubao-pro-32k、doubao-pro-128k 不再出现在任何档位映射里。
  - 渲染候选模型解析支持 provider 维度 env 覆盖（ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>），且不改变既有全局 env 优先级与 MiniMax 主候选行为。
  - 主候选仍是 minimax；ENGINE_RENDER_FALLBACK_PROVIDERS=doubao 时候选序列为 2，启动不再报单候选告警。
  - .env 落 LLM_DOUBAO_API_KEY 与 fallback 开关，连通证据记录在交付记录里，任何工件不出现 key 明文。
  - 定向用例覆盖「豆包档位不再返回旧名」「provider 维度 env 优先于档位表」「全局 env 仍最高优先」三类断言。
  - 全量测试、typecheck、lint 全绿；engine-core 零 diff；交付记录与回执齐全。
---

# AF-210 · 豆包（火山方舟）第二 provider 接入

## 背景（为什么这单必须动代码）

2026-11-14 的选型结论是「豆包做渲染备候选、代码零改动、只差采购 key」。实际取证推翻了这个前提：

- 方舟 API Key 已于 2026-11-20 创建（default 项目，名称 `xinsu-render-fallback`），`/api/v3/models` 与 chat 均连通。
- 代码 `TIER_MODELS` 里给豆包预留的三个模型名 `doubao-lite` / `doubao-pro-32k` / `doubao-pro-128k`，在方舟全部返回 404（已实测）。
- 因此仅配 `ENGINE_RENDER_FALLBACK_PROVIDERS=doubao` 时，熔断切到备候选必然 404，备候选等于未接，且会持续触发熔断计数。

## 目标

1. 把豆包三档映射改为方舟当前有效型号：
   - BASIC → `doubao-seed-2-1-lite-260915`
   - RAG → `doubao-seed-2-1-pro-260628`
   - ADVANCED → `doubao-seed-2-1-pro-260628`
2. 增加 provider 维度的渲染模型覆盖，避免以后换型号再改代码：
   - `ENGINE_RENDER_CHAT_MODEL_<PROVIDER>` / `ENGINE_RENDER_STABLE_MODEL_<PROVIDER>` / `ENGINE_RENDER_ADVANCED_MODEL_<PROVIDER>`
   - 优先级：全局 `ENGINE_RENDER_<KIND>_MODEL`（既有语义，保留）> provider 维度 env > 档位表。
3. `DoubaoChatProvider` 内置默认模型 `doubao-pro-32k` 同步改为 `doubao-seed-2-1-pro-260628`，避免非渲染链路回落到已下线型号。
4. 本机 `.env` 落 key 与 fallback 开关，完成连通性与候选序列取证。

## 硬约束

- 不碰 `src/engine-core`。
- 不改 MiniMax 主候选行为、不改 `MINIMAX_LLM_MODEL` / `MINIMAX_BASE_URL` 共用语义。
- key 只写入本机 `.env`（gitignore），不写进 src、文档、测试、任务单、回执；交付记录只写「已配置 + 验证结论 + key 指纹后四位」。
- 不新增依赖；不扩大部署契约，不改 `.env.example`。
- 不改 `ENGINE_RENDER_TIMEOUT_MS` / 熔断阈值等既有默认。

## 编号说明

本单最初登记为 AF-209，与并行机器在同一分支提交的「来访者真人度 R3」撞号（对方已合入 `integrate`）。在推送前发现，按「后登记者让号」改为 AF-210，代码与验收口径不变，交付记录与回执同步改名。

## 验收边界（不在本单）

- 96 场 shadow 同口径对照（需要批次与预算，另开任务）。
- 跨机器 key 分发机制（密钥不走 git，另案）。
- 豆包作为主候选的切换判定。
- embedding / 语音 provider 接入。
- 与 AF-209（R3 语域审计）的功能交叉：本单不触碰 realism 相关文件。

## 交付要求

- 交付记录写清：改了哪些文件、优先级设计、404 取证、连通证据（不含明文 key）、闸门真实数字。
- 回执经 `run-once` 摄入后归档；commit message：`fix(af210): 豆包备候选档位映射修复与 provider 维度模型覆盖`
