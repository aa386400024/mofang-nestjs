---
taskId: AF-316
contextId: phase2.5-orchestration-closed-loop
title: BDI 决策敏感性与临床校准修复（AF-315 返修闭环）
type: implementation
status: backlog
baselineRef: 59f6e07406816920d615ea146cc43a66b22740a2
dependsOn: []
priorTasks: [AF-315]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T23:50:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/engine-core/cognition/
    - src/engine-core/domain/
    - src/engine-core/in-memory/
    - src/admin-debug/
    - test/engine-core/
    - test/admin-debug/
    - test/engine-adapters/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af316-bdi-decision-sensitivity-rework-2026-11-22.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-core/af315-bdi-decision-sensitivity.spec.ts test/engine-core/wp1-bdi.spec.ts test/engine-core/wp42-alliance-three-dimensions.spec.ts test/engine-core/s1-open-depth-threshold.spec.ts test/engine-adapters/wp42-alliance-config.spec.ts test/engine-adapters/wp58-turn-delta-audit.spec.ts test/admin-debug
    check: BDI 场景回归 + 适配层系数镜像 + 调试验收
    threshold: exit=0
  - command: pnpm typecheck
    check: 后端类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: 内核边界与公开面
    threshold: exit=0
successCriteria:
  - 20 轮共情脚本中，来访者 safety 能从低基线持续增长并跨过探索门槛，至少出现一次 cognitive_exploration 或 affective_exploration，不再出现 trust 已到 0.9、safety 仍卡在 0.4、20 轮全靠叙述的死锁。
  - 深度探索不得在第 1 轮发生；首轮最多到 recounting 或 simple_response，第二轮起才允许进入探索类策略。
  - planIntention 至少读取核心信念激活、底层愿望权重与移情三维；高负移情、高依赖移情、高核心信念激活分别能产生可解释的策略变化。
  - empathy、acceptance、normalization、open_probe 等正向事件对 safety 的增量足以在 10 至 15 个有效回应内越过 0.6，且单回合 delta 仍受既有 cap 约束。
  - 规则轨事件词典覆盖常见中文反映式共情与开放式提问表达；新增测试样例不再被误判为 neutral，且不把单纯重复来访原话判成共情。
  - 调试 trace 的 bdiSnapshot 与 deltaDetail 补齐移情三维、核心信念激活峰值等决策相关字段；后端类型与管理台既有读取路径不破坏。
  - 新增确定性场景测试覆盖：正向同盟成长、负移情转抗拒、高依赖请求、核心信念激活下的探索抑制、首轮探索抑制、可复现性。
  - 定向测试、boundary.spec、typecheck、lint、全量测试全绿；交付记录六组机读字段、机读回执、归档与受保护 PR 齐全。
---

# AF-316 · BDI 决策敏感性与临床校准修复（AF-315 返修闭环）

## 0. 为什么重签发

AF-315 的代码、测试、交付记录与回执都已完成，但 `run-once` 自动验收把任务归档为 `rejected`。原因不是实现失败，而是任务单 scope 漏列了两个必须同步的测试镜像文件：

- `test/engine-adapters/wp42-alliance-config.spec.ts`
- `test/engine-adapters/wp58-turn-delta-audit.spec.ts`

这两个文件断言适配层暴露的同盟门槛与 turn delta 镜像，AF-315 调整 `DELTA_TABLE` 与 `allianceThresholds` 后必须同步更新，否则全量回归会失败。AF-315 任务单只列了 `test/engine-core/` 与 `test/admin-debug/`，导致机读护栏判定“回执声明集含 scope 外文件”。

另有两项交付记录机读锚点缺失（`gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict`），已在本单新交付记录补齐。

本单是对已归档 `rejected` 任务的正式返修闭环：代码沿用 AF-315 工作树，scope 修正为包含适配层测试镜像，交付记录重建为 AF-316 版本。不手工改写 AF-315 的归档终态，不修改 `task-state-index.json` / `journal.jsonl`。

## 1. 背景与已核实事实

AF-314 完成后，对 8 场 20 轮真实调试 trace 做只读复核，发现的问题不是“BDI 没有跑”，而是“BDI 跑了但决策带宽太窄”。

1. **探索门槛实际不可达。** 以 `debug_PNbYXZIn3MQQt-EOlUVvm` 为例，第 20 轮 `trust=0.916`、`safety=0.414`；探索门槛是 `min(trust, safety) >= 0.6`，所以 20 轮共情后仍在 `recounting`。
2. **safety 增量与 trust 严重不对称。** 旧 `empathy` 给 `trust +0.10`、`safety +0.02`；8 场 20 轮的 `max(min(trust,safety))` 全部低于 0.42。即使咨询师持续共情，safety 也几乎不可能在 20 轮内到 0.6。
3. **首轮探索偏早。** 安全型角色 `trust=0.65 / safety=0.70`，第一轮就进入 `affective_exploration`，与“初次见面先建立关系”的临床节奏不符。
4. **移情不是全零。** 复核 `intention.transference`：`debug_PNbYXZIn3MQQt-EOlUVvm` 正向峰值 0.17、负向峰值 0.04；`debug_xw7uAJodsn6o3ln9FGL_Q` 负向峰值 0.21。此前“100 轮全零”的读数来自 `bdiSnapshot` / `deltaDetail` 投影不含移情字段，属于可观测性缺口，不是状态没跑。依赖维度确实长期为 0，因为没有事件驱动它。
5. **决策输入过窄。** 旧 `planIntention()` 只读阻抗三维、`trust`/`safety`、情绪效价和固定门槛；`coreBeliefActivation`、`underlyingDesires`、`situationalDesires`、`transference` 都不改变策略。
6. **规则轨事件漏判多。** 8 场中 `neutral` 占 10 至 19 轮；实际咨询师文本里存在大量“你停不下来，可能是……”“这更像是……”这类反映式共情，但词典未覆盖。模型轨存在但缺省 `rule_only`，不能把全部 neutral 归因于 BDI。

### 根因判断

- **主因**：同盟三维的成长系数与探索门槛不匹配，导致策略锁死在 `recounting`。
- **次因**：规则轨事件覆盖不足，使 BDI 拿不到有效输入。
- **结构性问题**：决策器只用了 BDI 状态的一小块，移情、信念激活、愿望层没有进入策略选择。
- **观测问题**：trace 投影缺字段，导致把“没展示”误判成“没发生”。

## 2. 目标

1. 修正 safety 成长系数，使持续有效共情能在合理轮次内建立安全感，同时保留单回合 cap。
2. 给探索增加阶段门槛，禁止首轮进入深度探索。
3. 扩展 `planIntention()` 的决策输入：核心信念激活、底层愿望权重、移情三维、负向移情与依赖移情。
4. 让依赖移情有真实事件来源，不再长期恒为 0。
5. 补规则轨事件词表，降低真实咨询文本的 neutral 漏判，同时守住“不把复述当共情”的边界。
6. 补齐调试 trace 的决策相关字段，保证后续审计能从 trace 直接看到移情与信念激活。
7. 用确定性场景测试锁定临床行为边界，形成后续真实咨询师在环校准的可回归基线。

## 3. 非目标

- 不宣称本轮已经完成临床有效性验证；真实咨询师在环的盲评仍需独立批次。
- 不改来访者渲染 prompt、不改豆包 Seed Character 模型配置。
- 不改变考核场景 `rule_only` 红线；不在 exam 场次启用模型轨。
- 不做完整 BDI 模型轨替换；本轮只修规则轨决策与可观测性。
- 不为了“像真人”而引入随机抖动；所有行为仍必须可复现。
- 不改 `admin-dashboard/src/` 前端展示；本单只保证后端追加字段不破坏既有读取。

## 4. 边界

- `src/engine-core/**` 属于红线区域，改动必须保持纯 TS、零 `@nestjs/*` / `typeorm`、零 env、零随机。
- 新增门槛字段必须可选，缺省行为可解释；非法值必须有回落。
- `bdiSnapshot` / `deltaDetail` 只加字段，不改既有字段名，不破坏管理台与 metrics 读取。
- 不打印对话原文；测试只使用合成文本。
- 适配层测试镜像同步属于本单显式授权范围；不改 `src/engine-adapters/` 生产代码。

## 5. 验收

### A. 同盟成长与探索时机

用 `vpt_intimate_avoidance_l1` 的低安全感基线（`trust=0.32 / safety=0.35 / bond=0.65 / depth=0.40`）跑 20 轮共情脚本：

- 第 1 轮不得出现 `affective_exploration` / `cognitive_exploration`。
- safety 必须持续上升，并在 15 轮内至少一次达到 `>= 0.6`。
- 20 轮内至少出现 2 种策略，且至少一次探索类策略。
- 每轮 delta 仍受 `DEFAULT_DELTA_CAP_CONFIG` 约束，不出现 NaN / 越界。

### B. 决策输入

- 高负移情（`negative >= 0.3`）且阻抗不低时，策略进入 `resistance`，rationale 明确指出移情。
- 高依赖移情（`dependency >= 0.4`）且安全度足够时，策略进入 `request`，不再永远 `recounting`。
- 高核心信念激活（任一 `activation >= 0.5`）且 safety 不足时，不得进入探索；rationale 指出信念激活。
- 底层愿望 `avoid_pain` 权重显著高于 `understood` 时，探索倾向下降；反向时探索倾向上升。

### C. 事件分类

- 10 条真实风格反映式共情/开放提问样例，规则轨至少 8 条不再判 `neutral`。
- 单纯复述来访原话（如“他说他晚回”）不得判 `empathy`。
- 既有 13 类事件与 `neutral` 的既有测试不回归。

### D. 可观测性

- 新 trace 的 `bdiSnapshot` 包含 `transference.positive/negative/dependency` 与 `coreBeliefActivation` 峰值。
- `deltaDetail` 包含移情三维 delta。
- 既有管理台读取不报错；缺失字段时降级为 0 / 空对象。

### E. 工程闸门

- 定向测试（含 `test/engine-adapters/` 镜像）、boundary.spec、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿。
- `pnpm orchestration:validate` / `events verify` 通过。
- 交付记录六组机读锚点、durable 回执、归档、受保护 PR 完整。
