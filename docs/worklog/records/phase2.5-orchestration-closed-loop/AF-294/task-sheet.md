---
taskId: AF-294
contextId: phase2.5-orchestration-closed-loop
title: 引擎渲染路径 V5 来访者约束对齐与生产路径盲评
type: implementation
status: backlog
baselineRef: b8e6d617
dependsOn: [AF-243, AF-248]
priorTasks: [AF-232, AF-237, AF-240, AF-241, AF-243, AF-245, AF-248, AF-252, AF-263, AF-280, AF-281, AF-292, AF-293]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T17:35:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/realism/
    - src/agent/visitor/
    - src/engine-adapters/rendering/
    - src/engine-adapters/wiring/
    - test/agent/visitor/
    - test/engine-adapters/
    - test/shared/realism/
    - bin/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-orchestration-closed-loop/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af280-visitor-v5-parity-2026-11-22.md
    kind: report
  - name: 生产路径盲评报告
    path: data/phase25-exit/af280-engine-render-v5/report.json
    kind: dataset
  - name: 生产路径盲评摘要
    path: data/phase25-exit/af280-engine-render-v5/summary.md
    kind: report
gates:
  - command: pnpm exec vitest run test/agent/visitor/af280-visitor-prompt-variant.spec.ts test/engine-adapters/af280-render-prompt-variant.spec.ts
    check: 共享 V5 约束与引擎渲染变体契约全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
successCriteria:
  - 新增纯共享模块，导出 VisitorPromptVariant、V5 约束正文与严格解析函数；旧 VisitorService 与引擎渲染路径引用同一份正文，禁止复制两套。
  - 引擎渲染 buildVisitorMessages 支持变体入参；默认 shared 时 system prompt 与改动前逐字一致，seed-v5 时只在硬规则之后追加 V5 约束块。
  - RenderConfigFactory 从 VISITOR_PROMPT_VARIANT 读取变体并注入 buildMessages；非法值 fail fast，错误文案含 key 与允许值。
  - 舞台说明投影仅在 seed-v5 开启，shared 路径不剥离任何字符。
  - 单测覆盖默认零回归、seed-v5 追加位置与正文、非法值拒绝、旧/新两条链路引用同一常量。
  - 用生产引擎渲染路径生成 12 场固定咨询师脚本会话，A=shared、B=seed-v5，同一 Seed Character 模型；两评分员盲评，身份不泄露。
  - 盲评报告包含 AI 暴露、建议、总结、剧情推进、投影后括号、原始括号、超长率、提问率、L3 短答率、标记错误率、过度配合指数、首 token P95、两评分员 κ/绝对差/exact/within±1。
  - 预登记硬门槛：AI 暴露 0、建议 0、总结 0、剧情推进 0、原始括号 0、标记错误率低于 1%、L3 短答率不低于 shared 的 80%、首 token P95 不高于 1500ms。
  - 预登记软门槛：五维 human-likeness 不低于 shared 0.2 分、过度配合指数不高于 shared、两评分员 κ 不低于 0.4 且绝对差不超过 0.3、长度 std 不低于 0.5。
  - 任一硬门槛失败即不切流，保留 VISITOR_PROMPT_VARIANT=shared，交付记录写失败原因与回滚证据。
  - 全部硬门槛通过且软门槛不退化后，设 VISITOR_PROMPT_VARIANT=seed-v5，重启本地服务，跑 20 轮真实 smoke；失败可一键回 shared。
  - 不修改既有评分 prompt、阈值、证据校验、R6-D 口径；不声称临床达标；真人双标仍标记为待上线阶段补做。
  - 定向测试、lint、typecheck、全量测试全绿；交付记录、机读回执、归档与受保护 PR 齐全。
---
# AF-294 · 引擎渲染路径 V5 来访者约束对齐与生产路径盲评（AF-281/AF-292/AF-293 重建）

## 背景

AF-232 到 AF-245 的影子实验已收敛：Seed Character + V5 约束（arm H）三轮硬门槛全过，盲评均值 4.0556（V2 3.8889），过度配合指数 0.0463（V2 0.0995），关系在场 4.35（V2 4.03），12 个 persona×难度单元 7 改善 / 5 持平 / 0 回落。

AF-292 已把 `VISITOR_PROMPT_VARIANT=seed-v5` 接到旧 `VisitorService`，但生产对练主路径是 `TurnRenderOrchestrator` 的 `buildVisitorSystemPrompt()`，它不读该变体，也没有 V5 的零抽象、接触防御、具体情绪约束。当前 `.env` 已是 `VISITOR_LLM_PROVIDER=doubao`，但 `VISITOR_PROMPT_VARIANT` 未设置，实际组合是「Seed Character + 引擎旧 prompt」，接近实验里 fail 的 B 臂，而不是 V5。

## 目标

1. 把 V5 约束抽成纯共享模块，旧/新两条链路只引用一份正文。
2. 引擎渲染 `buildVisitorMessages(spec, variant)` 支持 `shared|seed-v5`，默认 shared 逐字不变。
3. `RenderConfigFactory` 从 env 读变体并注入 `buildMessages`，非法值 fail fast。
4. 用生产引擎路径跑 12 场 A/B 盲评，预登记硬/软门槛。
5. 通过后切 `.env` 并重启本地服务，跑 20 轮真实 smoke；失败保留 shared 并记录回滚证据。

## 非目标

- 不改 `src/engine-core/**`。
- 不改评分 prompt、评分阈值、evidence 校验、R6-D 分析口径。
- 不做真人督导师双标；不声称临床达标。
- 不修 AF-278 遥测 P0/P1；该事项另开返修单。
- 不改 `admin-dashboard/`、Flutter、编排脚本。

## 边界

- 生产切流只在全部硬门槛通过后执行；未通过不得把 `VISITOR_PROMPT_VARIANT` 设为 `seed-v5`。
- 只改任务 scope 内文件；`.env` 是运行态配置，不提交。
- 盲评不得把生成模型身份写入评分输入；评分员只看到会话与 persona 卡。

## 验收

- 两个定向 spec 全绿；`pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿。
- `git diff --stat HEAD -- src/engine-core` 为空。
- 12 场盲评报告与摘要落盘；硬门槛逐条给结果。
- 切流成功时记录 20 轮 smoke 的 provider/model/prompt/首 token/回退状态；失败时记录回滚证据。
- 交付记录含六组机读字段标记。
