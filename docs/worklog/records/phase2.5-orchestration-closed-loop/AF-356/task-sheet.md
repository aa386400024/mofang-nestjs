---
taskId: AF-356
contextId: phase2.5-orchestration-closed-loop
title: BDI 临床语义补齐：角色愿望映射与短期信念生成
type: implementation
status: backlog
baselineRef: cb3cb868d5b27c134862a333a32f9bd76d6bd9af
dependsOn: [AF-354]
priorTasks: [AF-349, AF-354, AF-355]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, conventions.md#1.3, conventions.md#2.5]
createdAt: 2026-11-23T11:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/cognition/
    - src/engine-core/domain/
    - src/engine-core/in-memory/
    - src/engine-adapters/wiring/character/
    - src/engine-adapters/wiring/bdi-runtime.config.ts
    - src/engine-adapters/wiring/engine.module.ts
    - src/engine-adapters/rendering/turn-render-orchestrator.ts
    - bin/bdi-readiness-audit.ts
    - test/engine-core/
    - test/engine-adapters/
    - test/config/
    - .env.example
    - docs/worklog/inbox/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - engine-core
    - engine-adapters
  interfaces:
    - UnderlyingDesireSeed
    - TemporaryBelief
    - EngineTurnInput
    - BeliefOperatorConfig
    - TransitionStateOptions
    - InMemoryEngineSessionOptions
artifacts:
  - name: 角色愿望到内核四键的显式映射
    path: src/engine-adapters/wiring/character/character-desire-mapping.ts
    kind: code
  - name: 短期信念生成算子
    path: src/engine-core/cognition/state-transition.ts
    kind: code
  - name: 来访上一轮文本回灌入口
    path: src/engine-core/domain/engine-session.types.ts
    kind: code
  - name: 信念生成运行时配置与装配
    path: src/engine-adapters/wiring/bdi-runtime.config.ts
    kind: code
  - name: 审计 CLI 映射覆盖更新
    path: bin/bdi-readiness-audit.ts
    kind: code
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af356-bdi-desire-belief-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/af356-bdi-belief-formation.spec.ts test/engine-adapters/af356-character-desire-mapping.spec.ts test/engine-adapters/af356-bdi-runtime-config.spec.ts test/engine-core/boundary.spec.ts test/config/wp25-env-example-coverage.spec.ts
    check: 定向测试全绿
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核改动仅限任务单授权文件
    threshold: 仅本单授权文件
successCriteria:
  - 新增适配层纯函数映射表，把 8 个角色及 2 个内置种子的角色级愿望键显式映射到内核四键 understood / accepted / avoid_pain / control；映射表是唯一真相源，幂等、可审计、未知键保留不猜测。
  - 角色解析与 DB 种子装配都经过同一映射函数；Admin 后台保存后再次解析仍得到同一组内核键，不出现双份语义。
  - 映射后至少一个角色的 control 基线 >= controlPlanGate 0.55，discussing_plans 在低阻抗、同盟达标的轮次可实际触发；不再依赖运行时时序演化才可能触发。
  - 新增短期信念生成算子：只从来访上一轮原话提取第一人称自我觉察陈述，source=observed；禁止把咨询师解释、问句、否定式、第三人称转述、危机/自伤内容写成来访信念。
  - 信念生成是确定性纯函数，重复陈述按规范化文本去重并递增 evidenceCount 与置信度；单轮最多生成 formationMaxPerTurn 条；新生成条目不在同一轮立即衰减。
  - temporaryBeliefs 在机制开启且来访出现自我觉察陈述时不再恒为空；连续同一条自我觉察达到置信度门槛后，insight 分支在 turnNumber >= insightMinTurn 且同盟/阻抗条件满足时可实际触发。
  - 来访上一轮原话通过 EngineTurnInput 的可选 priorVisitorText 进入内核；缺省不传时既有行为逐字不变；渲染门面从 history 取最近一条真实来访发言，降级兜底句不进入。
  - 信念生成机制由 ENGINE_BELIEF_FORMATION_ENABLED 控制，缺省 false；未开启时 temporaryBeliefs 与改造前逐字一致。角色愿望映射是缺陷修复，不设开关。
  - .env.example 显式声明新键；非法数值逐项回退内核种子，不产生 NaN / 反向衰减 / 无限生成。
  - 审计 CLI 输出映射前原始键、映射后内核键、覆盖矩阵、discussing_plans 与 insight 的静态可达性，以及机制开关状态；不连库、不调模型、不读对话原文。
  - 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读标记。
  - 不宣称临床有效性；映射语义与置信度参数标注为工程种子，真实咨询师逐轮标注后校准；未覆盖的角色愿望与模型轨事项进 backlog。
---

# AF-356 · BDI 临床语义补齐：角色愿望映射与短期信念生成

## 1. 背景

AF-354 的只读审计已经证明两个结构性缺口。

第一，8 个真实角色与 2 个内置种子的 `underlyingDesires` 全部使用角色级自造键（acceptance / stability / recognition / self_reliability / competence / autonomy / continuity / safe_grief / authenticity / belonging / rest / being_understood / safety / control / security）。内核意图规划器只读 `understood / accepted / avoid_pain / control` 四键，键不匹配时全部得到 `undefined ?? 0`，导致 `discussing_plans`、情境 request 与部分探索分支在真实角色上不可达。

第二，`TemporaryBelief` 已有形状、衰减和读取，但全仓没有任何写入点。`bootstrap` 初始化为空数组，`state-transition` 只衰减，`intention-planner` 只统计 `source=observed` 且置信度过阈的条目，于是 `insight` 分支结构性不可达。

本单只补这两条临床语义链，不碰已决的阈值数值、不做临床标定、不打开模型轨。

## 2. 范围

在范围内：

- `src/engine-adapters/wiring/character/character-desire-mapping.ts`：角色愿望键 → 内核四键的显式映射表与纯函数；未知键保留，不猜测。
- `src/engine-adapters/wiring/character/builtin-character-registry.ts`、`character-profile.seed.ts`、`character-profile.db-only.seed.ts`、`db-character-profile.resolver.ts`：统一经过映射函数，保证内存种子、A 类种子、B 类种子、DB 解析四条路径同口径。
- `src/engine-core/domain/beliefs.ts`：为 `TemporaryBelief` 增加可选证据字段（evidenceCount / firstFormedAtTurn / lastObservedAtTurn），旧快照缺字段仍可读。
- `src/engine-core/cognition/state-transition.ts`：新增确定性短期信念生成算子，并在 `applyBeliefEvolution` 中接线；缺省关闭时逐字零回归。
- `src/engine-core/domain/engine-session.types.ts`、`src/engine-core/in-memory/in-memory-engine-session.ts`：增加可选 `priorVisitorText` 入参，临时快照与落库快照同一口径。
- `src/engine-adapters/rendering/turn-render-orchestrator.ts`：从 history 取最近一条真实来访发言，传入下一轮内核；兜底句不进。
- `src/engine-adapters/wiring/bdi-runtime.config.ts`、`engine.module.ts`、`.env.example`：信念生成 6 个运行时键的解析与生产装配。
- `bin/bdi-readiness-audit.ts`：输出映射前后键、覆盖矩阵、两条策略的静态可达性与机制开关。
- 测试与交付记录。

明确不在范围内：

- 不改 12 个决策阈值、愿望演化 5 参数、锁 TTL、时序斜率的数值。
- 不新增 migration / 表结构；不改 admin-dashboard / Flutter / scripts / typings。
- 不改模型轨缺省形态，不打开任何未标定机制。
- 不从来访原话生成 `introduced` 信念；咨询师解释只走既有 core belief 激活，不冒充来访信念。
- 不采集、不记录、不输出任何心理对话原文到日志 / 报告 / 审计产物。

## 3. 临床语义映射表（工程种子，待咨询师标注校准）

映射原则：

- 一个角色愿望只映射到一个主内核键，避免把一个诉求拆成多份权重、凭空抬高决策信号。
- 只有语义上确实是“被看见 / 被理解”的愿望进 understood；只有“被接纳 / 归属 / 真实自我被接受”进 accepted；只有“安全 / 稳定 / 回避痛苦 / 休息”进 avoid_pain；只有“自主 / 胜任 / 自我信任 / 掌控”进 control。
- 同一角色有多个愿望映射到同一内核键时，取最大基线权重，不求和。
- 未登记的角色键原样保留，不静默丢弃，审计输出为 unmapped。

| 角色级键 | 内核键 | 语义依据 |
| --- | --- | --- |
| acceptance | accepted | 被接纳与认可 |
| stability | avoid_pain | 情绪与生活稳定、免于动荡 |
| recognition | understood | 被看见与认可 |
| self_reliability | control | 对自己的信任与效能感 |
| competence | control | 能力被认可与掌控感 |
| autonomy | control | 自主与不被打扰 |
| continuity | avoid_pain | 维持生活秩序、避免断裂 |
| safe_grief | understood | 悲伤被安放、被陪伴理解 |
| authenticity | accepted | 真实的样子被接受 |
| belonging | accepted | 被群体接纳、不被排斥 |
| rest | avoid_pain | 能停下来喘口气 |
| being_understood | understood | 被理解而不被催促 |
| safety | avoid_pain | 确定自己是安全的 |
| control | control | 能掌控周围发生的事 |
| security | avoid_pain | 不被抛弃的安全感 |
| understood / accepted / avoid_pain / control | 自身 | 幂等直通 |

映射后的静态覆盖预期（以真实种子当前数值为准）：

- 晚晴：accepted 0.72 / avoid_pain 0.55
- 小满：understood 0.70 / control 0.60
- 亦舟：control 0.70
- 念安：avoid_pain 0.68 / understood 0.58
- 安然：accepted 0.60
- 语桐：accepted 0.70
- 沉舟：avoid_pain 0.55 / understood 0.50
- 惊尘：avoid_pain 0.72 / control 0.50

惊尘的 control 0.50 低于 0.55，是临床上的“创伤解组状态尚不适合进入计划讨论”，不通过调数值强行达标；审计显式标注该角色 discussing_plans 仍不可达。

## 4. 短期信念生成规则

输入：来访上一轮真实发言（不是咨询师原话，不是兜底句）。

候选陈述必须同时满足：

1. 含第一人称自我觉察标记：我意识到 / 我发现 / 我觉察到 / 我注意到 / 原来我 / 我好像 / 我似乎 / 我开始意识到。
2. 是陈述句，不是问句；不含“没 / 没有 / 不”直接否定该标记。
3. 只含来访自身，不含“他说 / 她说 / 他们说”等第三人称转述。
4. 去标点后长度 6–80 字。
5. 不含危机 / 自伤 / 伤人词表（自杀、自伤、想死、不想活、结束生命、割腕、跳楼、伤害自己、伤害他人等）。
6. 单轮最多 2 条；按出现顺序取前 2 条。

置信度与去重：

- 首次生成置信度 formationBaseConfidence（缺省 0.55）；`source=observed`。
- 同一条规范化陈述再次出现：confidence += formationReinforcement（缺省 0.10），evidenceCount += 1。
- 新生成条目在生成轮不衰减；已有条目照旧按 observed 0.95 衰减。
- 低于 removeThreshold 的条目仍按既有规则移除。
- 置信度只是工程种子；真实咨询师逐轮标注后再校准。

隐私与安全：

- 信念陈述只进入 BDI 快照，不写日志、不进审计产物、不进报告。
- 危机词表命中时不生成信念，原文本继续走既有 safety 链路，不被复制到第二个存储面。

## 5. 红线

- 分层归属按 `conventions.md` §1.1：纯函数进内核，env/IO 进适配层；内核零 env、零网络、零 prompt。
- `src/engine-core` 改动仅限任务单列出的四个既有文件与新增测试；`boundary.spec.ts` 不改。
- 缺省行为逐字不变：`ENGINE_BELIEF_FORMATION_ENABLED=false` 时不生成任何信念。
- 角色愿望映射是缺陷修复，必须生效；但只改键，不改角色原始权重数值。
- 心理对话原文禁止进日志 / console / 报告；审计只输出键名、数值、布尔与计数。
- 提交 / 推送按发布分层口径执行；L3 经受保护 PR，不直推 integrate。

## 6. 闸门

- `pnpm typecheck` 0 error；`pnpm lint` 0 error / 0 warning。
- 定向：`test/engine-core/af356-bdi-belief-formation.spec.ts`、`test/engine-adapters/af356-character-desire-mapping.spec.ts`、`test/engine-adapters/af356-bdi-runtime-config.spec.ts`、`test/engine-core/boundary.spec.ts`、`test/config/wp25-env-example-coverage.spec.ts`。
- 全量：`pnpm test` 全绿，记录真实数字与机器状态。
- `git diff --stat HEAD -- src/engine-core` 只含授权文件。

## 7. 交付记录

`docs/worklog/completed/phase2.5/af356-bdi-desire-belief-2026-11-23.md`，含六组机读标记。

## 8. 回写清单

- [ ] 交付记录写入固定路径
- [ ] 任务单归档、状态索引与事件链由 CLI 写入
- [ ] 回写 phase2.5 WP 清单与阶段入口
- [ ] backlog 登记未覆盖角色愿望与临床标定项
- [ ] 提交分组核对，仅本单文件
- [ ] 一行 commit message
</content>
</Write>
