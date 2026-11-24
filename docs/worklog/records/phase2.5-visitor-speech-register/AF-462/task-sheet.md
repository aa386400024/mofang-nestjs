---
taskId: AF-462
contextId: phase2.5-visitor-speech-register
title: 来访者语域指纹全链路落地（角色资产 + 渲染层 + 双路径 + 评估）
type: implementation
status: backlog
baselineRef: dcb28dd13d09428286adc171fe9e55873d1e03aa
dependsOn: []
priorTasks: [AF-461, AF-214, AF-209]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.1, conventions.md#1.2, conventions.md#1.3, conventions.md#5.3]
createdAt: 2026-11-24T16:30:25+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/speech-register/
    - src/engine-adapters/wiring/character/
    - src/engine-adapters/wiring/engine-turn.service.ts
    - src/engine-adapters/wiring/engine-stream-backend.adapter.ts
    - src/engine-adapters/wiring/render-config.factory.ts
    - src/engine-adapters/rendering/
    - src/agent/visitor/
    - src/counselor/providers/
    - src/counselor/config/
    - src/counselor/domain/visitor-persona/
    - src/counselor/entities/visitor-pool-template.entity.ts
    - src/counselor/entities/visitor-full-persona.entity.ts
    - src/auto-practice/metrics/
    - src/admin-debug/
    - src/migration/
    - bin/ormconfig.ts
    - bin/seed-character-profiles.ts
    - test/shared/speech-register/
    - test/engine-adapters/
    - test/agent/
    - test/counselor/
    - test/auto-practice/
    - test/admin-debug/
    - docs/runbooks/visitor-speech-register.md
    - docs/worklog/completed/phase2.5/af462-visitor-speech-register-2026-11-24.md
    - docs/worklog/records/phase2.5-visitor-speech-register/AF-462/
  modules:
    - shared/speech-register
    - engine-adapters/rendering
    - engine-adapters/wiring/character
    - agent/visitor
    - counselor
    - auto-practice/metrics
    - migration
  interfaces:
    - SpeechRegister
    - SpeechRegisterRenderInput
    - CharacterProfileEntity.speechRegister
    - ResolvedCharacter.speechRegister
    - EngineTurnOpenOptions.speechRegister
    - TurnSessionContext.speechRegister
    - AdaptiveRenderSpec.speechRegister
    - VisitorContextBlock.speechRegister
    - VisitorFullPersonaScript.speech
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af462-visitor-speech-register-2026-11-24.md
    kind: report
  - name: 运行手册
    path: docs/runbooks/visitor-speech-register.md
    kind: document
gates:
  - command: pnpm exec vitest run test/shared/speech-register test/engine-adapters test/agent test/counselor test/auto-practice test/admin-debug
    check: 语域定向单测全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 纯层零改动
    threshold: exit=0
successCriteria:
  - 新增可空 speech_register JSON 资产，版本化、可校验、可回滚；未配置角色的 prompt 与 HEAD 逐字一致。
  - 语域指纹不直接使用文化水平低、农村人、底层等评价标签；教育程度只映射词汇预算，地域只做词汇层，不做口音谐音。
  - 引擎链路把 speechRegister 从角色资产经 EngineTurnOpenOptions、TurnSessionContext、AdaptiveRenderSpec 注入 buildVisitorSystemPrompt，不新增任何 LLM 调用。
  - 旧 VisitorService 链路通过 VisitorContextBlock 可选 speechRegister 条件渲染；未配置时 renderSystemPrompt 输出逐字不变。
  - 语域漂移只允许话量、抽象词预算、直接度三项受 BDI 状态有限调制；教育背景、地域、标志词、生活锚点不得漂移。
  - 风险信号为 medium 及以上时压制方言词、俚语和比喻，回到短、直、具体表达。
  - 增加 VISITOR_REGISTER_MODE=off|audit|active 与 VISITOR_REGISTER_PILOT_IDS 灰度开关，默认 off；active 可只对试点角色生效。
  - 新增 register-v1 指标与盲评协议，至少覆盖语域贴合、刻板风险、跨轮稳定、具体度；交付记录给出三角色 base vs active 对比与真实数字。
  - 全量闸门在交付前各跑一次并记录真实数字；engine-core git diff 为空；心理对话原文不得进入普通日志。
---

# AF-462 · 来访者语域指纹全链路落地

## 背景

AF-461 已完成 TTS provider 参数契约修复，三家语音实测恢复。用户随后反馈语音真人度明显改善，但用词仍不接地气：不同来访者听起来像同一套标准普通话，没有体现文化水平、社会环境、年龄、地域差异。

只读调查确认：

1. 自动对练引擎链路 `buildVisitorSystemPrompt()` 没有身份行，`characterLabel` 不进 prompt；8 条 `verbalVoice` 主要区分防御、情绪和叙事习惯，不含社会语域。
2. 旧语音链路 `renderSystemPrompt()` 只渲染姓名和年龄，`identity.occupation` 定义了但未使用；`Persona` 没有教育、地域、社会处境字段。
3. 公共模板 6 个角色中 4 个本科、1 个高中、1 个硕士在读，职业集中在城市白领；`script.basics` 有教育和居住状态，但 `buildVisitorPersonaBehaviorBlock()` 只渲染职业。
4. 现有 `visitor-register-audit` 主要检测咨询术语、书面连接词和助手口吻，不检测“这个人的社会语域是否成立”。
5. 项目设计文档明确：BDI 只决定“想不想说、说多少、带什么情绪”，具体用词属于渲染层；语域不应进入 BDI 决策核。

## 目标

把“这个人会怎么说话”从自由文本里拆出来，做成可复用、可审计、可测试的 `SpeechRegister` 资产，沿现有 `verbalVoice` 通路进入渲染层；旧链路同步接入；用灰度开关和盲评验证，不做一次性全局替换。

## 非目标

- 不改 `src/engine-core/**`，不把语域写进 BDI 决策状态。
- 不做方言发音、口音谐音、地域梗；`dialectStrength` 默认 0–1，只做词汇层。
- 不新增 LLM 调用，不做在线实时改写；语域是 prompt 资产。
- 不做 `admin-dashboard` 可视化编辑器；本期只做后端资产、DTO 读写和调试审计。
- 不重写全部角色内容；先补 8 个现有角色，后续新角色生成时按 schema 产出。

## 设计口径

### 分层

- 角色资产层：`character_profiles.speech_register`（引擎侧派生快照，可空 JSON）。
- 内容源层：`visitor_pool_templates.script.speech`（公共角色内容源，可空 JSON）。
- 旧链路：`VisitorContextBlock.speechRegister`（可选块，不配置零变化）。
- 渲染层：`AdaptiveRenderSpec.speechRegister` 与 `renderSystemPrompt()` 的条件块。
- BDI：只读消费 `BdiSnapshot` 作为语域漂移调制输入，不存语域、不改内核。

### 语域指纹

字段至少包含：`version`、`identity`（年龄/职业/教育档/居住状态/大区）、`socialContext`、`dialectStrength`、`vocabulary`（抽象词预算/术语预算/具体密度）、`syntax`（句长/碎片容忍/连接词）、`stance`（直接度/礼貌/暴露）、`anchors`、`signatureLexicon`、`avoidLexicon`、`sampleLines`、`antiSampleLines`。

渲染时压缩成 150–250 字自然语言块，最多 3 句正例、2 句反例；不暴露原始枚举，不出现“文化水平低/底层/农村人”等评价标签，不出现角色代号和舞台指令。

### 语域漂移

`resolveCurrentRegister(base, snapshot)` 只允许：

- 话量：高阻抗更短，低阻抗更展开；
- 抽象词预算：高唤醒下降，理智化防御可保留；
- 直接度：愤怒更直，羞耻更绕。

教育背景、地域、标志词、生活锚点、方言强度不得漂移。`riskSignal >= medium` 时压制全部语域风味，回到短、直、具体。

## 实施顺序

1. 资产层：`src/shared/speech-register/` 类型、schema 校验、渲染器、漂移纯函数、标定表；`character_profiles` 可空 JSON 列 + migration + ormconfig 注册；seed 从 `script.speech` 派生。
2. 引擎链路：resolver → `EngineTurnOpenOptions` → `TurnSessionContext` → `SpecAssemblyInput` → `AdaptiveRenderSpec` → `buildVisitorSystemPrompt()`；`VISITOR_REGISTER_MODE`/`VISITOR_REGISTER_PILOT_IDS` 开关。
3. 旧链路与生成端：`VisitorContextBlock.speechRegister`、`buildVisitorPersonaBehaviorBlock`、`renderSystemPrompt` 条件块、`visitor-pool-prompts`/`visitor-persona-prompts` 的 `script.speech` schema、counselor contributor。
4. 评估与运营：`register-v1` 指标、盲评协议、三角色 base vs active 对比、runbook、交付记录。

## 红线

- `git diff --stat HEAD -- src/engine-core` 必须为空；不通过修改 `boundary.spec.ts` 绕过。
- 不把学历、地域、社会处境作为评价性标签写入 prompt 或日志。
- 心理对话原文、量表答案、自伤输入不进普通日志；只记录 code、计数和哈希指纹。
- 不在 `VISITOR_REGISTER_MODE=off` 时改变任何现有 prompt 字节；用黄金样本回归证明。
- 不引入新依赖；不新增 LLM 调用；不改变 TTS 参数契约。
- 提交与推送按仓库发布分层执行；不得 `--no-verify`、不得直推 integrate。

## 闸门

- 定向测试：`pnpm exec vitest run test/shared/speech-register test/engine-adapters test/agent test/counselor test/auto-practice test/admin-debug`
- 全量：`pnpm typecheck` / `pnpm lint` / `pnpm test` 各一次，记录真实数字。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空。
- 黄金样本：off 模式下引擎与旧链路 prompt 与 HEAD 逐字一致。
- 幂等：`pnpm seed:character-profiles` 连跑两次，`speech_register` 内容不漂移、不重复写入。
- 验收：三角色 base vs active 盲评，语域贴合提升且自然度不下降；刻板风险不得高于基线。

## 交付回写

- 交付记录：`docs/worklog/completed/phase2.5/af462-visitor-speech-register-2026-11-24.md`
- 任务单与回执：`docs/worklog/records/phase2.5-visitor-speech-register/AF-462/`
- 运行手册：`docs/runbooks/visitor-speech-register.md`
- 一行 commit message：`feat(af462): 落地来访者语域指纹与双链路渲染`
