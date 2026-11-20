# TD-6 · TD-5 §五 七项生产契约演进观察项核对（spec/夹具口径对齐 · 一处 voice 类型放宽 · core 零改动）

> 状态：✅ **已交付**（2026-11-13）→ [交付记录](td6-contract-evolution-review-implementation-2026-11-13.md)
> 执行方：MiniMax Code（主控派单 · 按本开工任务单执行；只读扫描 + 最小对齐，范围小、边界清晰）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 `integrate`，上游 `origin/integrate`
> 唯一事实源：`docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md` §五 观察项表 + 主控 2026-11-13 HEAD `32493f0` 现场复核（扫描备查 `data/quality/ce-scan-1.txt`，gitignore 不入库）
> 任务性质：既有技术债清理（契约口径对齐），**零运行时行为变化**；改动仅落在 `test/**/*.spec.ts`、`test/**` 夹具 helper、1 个 voice 层端口类型文件与 docs 回写。
> 遗留登记：复核中新发现、任务单未覆盖的契约漂移残留 3 条 → [TD-7 契约漂移 backlog](../../pending/phase2.5-contract-drift-backlog-2026-11-13.md)（本单未顺手修）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\AGENTS.md` —— 仓库入口与 engine-core 红线
2. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线、16 条硬约束、交付格式
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\wp-task-template.md` —— 任务单结构与交付回写清单
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` §3 与 `phase2.5-wp-list-2026-11-08.md` §TD-5 行
5. 上一份交付记录：`docs/worklog/completed/phase2.5/td5-type-debt-clearing-implementation-2026-11-13.md` §五（七项观察项原始出处）
6. 本任务单（你在读的这份）

---

## 1. 背景（方向别错）

### 1.1 来源

TD-5 把根 `tsconfig` 全量类型债从 **401 条 / 87 文件清到 0 / 0**，全部在测试层收敛，**生产契约零改动**。交付记录 §五另列 **7 个生产契约演进观察项**——它们不是 TD-5 类型债（编译已绿），而是「spec 夹具 / 断言口径相对生产契约现状滞后」「一处端口类型与实现实际消费口径不一致」「实体后加列导致夹具默认值漂移」三类小债。本单把这 7 项一次性核对、对齐到生产现状。

### 1.2 主控现场复核结论（2026-11-13，HEAD `32493f0`；行号以现场 Grep 为准，可能漂移）

| #   | 观察项                                                    | 生产契约现状（已核实）                                                                                                                                                                                                | spec / 夹具现状（已核实）                                                                                                                                                                                                                                                                                                    | 处置归类                                                                                                                                                           | 边界归属                                                            |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | `DeliberationOutput.intentionShift`                       | `deliberation-types.ts` Output：key 必填、值 `DeliberationIntentionShift \| null`（字段恒在，消费方不判 undefined）                                                                                                   | `wp63` 两处 + `wp67` 一处仍造**三件套**并 `as unknown as DeliberationOutput`；`wp63` 一处 `Object.keys` 锁 3 key。其余 spec 已四件套（带 `intentionShift: null`）                                                                                                                                                            | spec 夹具/断言口径对齐                                                                                                                                             | engine-adapters test；**非 core**                                   |
| 2   | `CharacterProfile.forbiddenBehaviors` / `sensitiveTopics` | core `character-profile.ts` 两字段**必填** `readonly string[]`；内核 planner / classifier / session / applier 四处真实消费（`?? []` 或并集）                                                                          | `wp38-debug-event-tags`、`wp58-debug-session` 两个调试 spec 的 `makeCharacterProfile()` 故意不填两字段、用类型断言                                                                                                                                                                                                           | spec 夹具补空数组、去断言；**core 必填语义成立，类型不改**                                                                                                         | core 源码零改动；只动 `test/admin-debug/`                           |
| 3   | `CharacterProfileEntity` 后加列                           | 实体：`personalityTraits` / `verbalVoice` nullable；`versionMajor/Minor/Patch`（default 1/0/0）、`narrativeStyle` / `expressionTone` / `speechVolumeBaseline` / `baselineSafety` / `baselineBond` 有 default          | 4 个 spec 各有**局部** `buildRow`（默认值各自维护 = 漂移源）                                                                                                                                                                                                                                                                 | 抽共享角色实体 row builder（默认值工厂 + overrides），4 处复用                                                                                                     | test helper + test spec；生产实体不动                               |
| 4   | `VoiceTurnBackendTurnOptions.userId`                      | `voice-turn-backend.port.ts` TurnOptions `userId: string`（必填）；同文件 `OpenOptions.userId?: string`（可选）。adapter `streamTurn` **不读** `opts.userId`——身份一律取自会话 context（openSession 写入、turn 读取） | `wp43-evaluation-wiring` openSession 与 streamTurn 都不带 userId，用 `as VoiceTurnBackendTurnOptions` 断言                                                                                                                                                                                                                   | **生产类型放宽为可选** `userId?: string`（与 OpenOptions 及实现实际口径一致）；实现不动；wp43 断言消除                                                             | **voice 层，非 core**                                               |
| 5   | `RiskProbeResult.categories` 类别口径                     | core `risk-probe.ts` 端口 `categories: VisitorRiskCategory[]`；`probe(text, side: SafetySide)`。`SafetyVerdict.categories` 才是两类并集 `SafetyCategory[]`。架构口径：probe 只探测来访输出，咨询师类别归规则层        | `wp14-block-no-llm-start` 探针桩喂 `promise_cure`（咨询师侧 `CounselorSafetyCategory`）跨 `as unknown as RiskProbeResult`；用例本意是验「非危机类别 → gate 不丢信号、放行」                                                                                                                                                  | **执行前先读 gate / probe 调用链定性**；默认 core 类型不动，桩改走规则路径或合法来访类别表达同一分支；仅若链路证实端口确需并集口径，才作为 core 例外批准项单列取舍 | **core 红线**；例外须任务单明确批准 + 过 `boundary.spec.ts` 12 断言 |
| 6   | `DeliberationInput` 旧形状夹具（g123）                    | `deliberation-types.ts` Input 七字段：`events` / `stateComparison` / `characterBrief` / `resistanceBaseline` / `riskLevel` / `riskCategories` / `ruleStrategy`                                                        | `g123-deliberation-scenario-fingerprint.spec.ts` 手搓**旧字段名**（`kernelEvents` / `stateBefore` / `stateAfter` / `counselorVerdict` / `visitorText` …）+ `as unknown as DeliberationInput`；用例只验 exam 场次 0 次 LLM 调用，不消费该对象。共享夹具 `buildTestStructuredInput()`（走真实 `buildDeliberationInput`）已存在 | g123 迁移到共享夹具，消除旧形状手搓与断言                                                                                                                          | engine-adapters test；**非 core**                                   |
| 7   | `QualityAnnotationEntity` WP-N 9 列                       | `quality-annotation.entity.ts` 九列全 nullable：`batchId` / `counselorModeId` / `turnCount` / `engineVersion` / `promptVersion` / `characterVersion` / `firstBadTurn` / `badTurns` / `turnNote`                       | `test/quality/` 3 个 spec 构造实体对象，列默认值各自手写漂移                                                                                                                                                                                                                                                                 | 抽标注实体 row builder（与 #3 字段域不同，**各自独立** builder，不强行合并），3 处复用                                                                             | test helper + test spec；生产实体不动                               |

### 1.3 改动面预判（执行时以实际 diff 为准）

- **生产 `src/` 改动：仅 #4** 一处端口类型（`userId: string` → `userId?: string`，注释同步口径）。
- **engine-core：0 改动**（#2 维持 core 必填现状；#5 默认不动 core，例外路径见 §3.5）。
- **test**：wp63 ×2、wp67、wp38、wp58、wp14-block、g123、4 个角色 spec、3 个 quality spec；**新增 2 个** test helper 文件（角色实体 row builder、标注实体 row builder）。
- 不改断言期望语义、不改 mock 返回值、不增删测试用例数量（对齐 TD-5 零运行时纪律）。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- §1.2 表列 7 项对应 spec / 夹具 / helper 的类型标注、字段补全、断言形状对齐、局部 builder 抽共享；
- #4 voice 层 TurnOptions.userId 类型放宽（含同文件注释口径同步）；
- docs 回写：交付记录、任务单归档、wp-list 与 README 索引。

**明确不在范围内（禁止顺手做）：**

- `src/engine-core/**` 源码 diff 必须为空（#5 例外除外，且例外须 §3.5 路径走批准）；`boundary.spec.ts` 一行不许动。
- 不改表结构 / 不加 migration / 不加列；不改实体映射、resolver、module 装配。
- 不改 #2 两个 core 字段为可选（内核四处真实消费，必填语义成立）；不为消类型错反向改生产签名迁就 spec。
- 不改 mock 数据语义、断言条件、用例通过结果；不新增 / 删除测试用例；不新增第三方依赖。
- 不动 `.env.example`、prompt 模板、判据数组与阈值常量；不改任何 tsconfig / vitest 配置。
- 不重构相邻代码、不做无关格式重排；#3 与 #7 的 builder 不合并成一个跨域工厂。
- 提交分组隔离：工作区若有并行进程未提交产物，只暂存本单文件，不混入并行产物。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

---

## 3. 逐项处置（先复核定性，再最小改动）

> 通用纪律：每项动手前先 Grep 复核锚点文件与行号；改完该项跑定向 spec 确认通过；类型对齐生产现状，**不反向改生产迁就 spec**。

### 3.1 观察项 #1 · `DeliberationOutput.intentionShift` 三件套夹具

- **复核点（动手前先读用例上下文定性）**：
  - `wp63-deliberation-schema.spec.ts` ⑥ 段两处与 `wp67-deliberation-circuit-breaker.spec.ts` `okOutcome()`：区分「形状断言」与「校验层容忍测试」。
  - 已知 `wp68` ②-9（缺省 `intentionShift` → `null`、不计 rejectedEntry）已专门覆盖「校验器容忍缺字段」路径；本项 3 处若**不是**在测该校验容忍，即属落后于契约的形状断言。
- **处置**：
  - 若为形状断言：夹具补 `intentionShift: null`（四件套）；`wp63` 那处 `Object.keys(...).sort()` 期望数组由 `['confidence','deltas','summary']` 改为含 `intentionShift` 的 4 key；去掉 `as unknown as DeliberationOutput`（形状齐了应可直接标注）。
  - 若某处确属校验层容忍测试（喂原始缺字段输出给 `validateDeliberationOutput`）：保留三件套输入，但把注释写清「喂校验器的原始 LLM 输出，容忍缺字段由 wp68 ②-9 覆盖」，断言目标对齐校验后结果，不与「恒在字段」契约混淆。
- **不改** `DeliberationOutput` 生产类型；其余已四件套的 spec 不动。

### 3.2 观察项 #2 · `CharacterProfile.forbiddenBehaviors` / `sensitiveTopics` 必填夹具

- **复核点**：读 `wp38-debug-event-tags.spec.ts`、`wp58-debug-session.spec.ts` 的 `makeCharacterProfile()` 与被喂入的调试服务，确认调试服务确实只读 `attachmentStyle` / `personalityTraits` 等展示字段、不读这两字段；若服务确实不读，补 `[]` 对运行时零影响。
- **处置**：夹具补 `forbiddenBehaviors: []`、`sensitiveTopics: []`，去掉对应类型断言；注释更新为「必填字段补空数组，调试服务不消费」。
- **不改** core `character-profile.ts` 两字段为可选；内核 planner:84 / classifier:32 / session:420 / applier 消费链一行不动。

### 3.3 观察项 #3 · `CharacterProfileEntity` 后加列夹具漂移

- **现状**：4 处局部 `buildRow`（`character-baseline-calibration.spec.ts:64`、`character-baseline-seed-calibration.spec.ts:131`、`wp41-expression-style-rendering.spec.ts:101`、`wp9b-db-character-resolver.spec.ts:110`）。
- **处置**：
  - 在 `test/engine-adapters/` 新建角色实体 row builder helper（参照 `deliberation-fixtures.ts` 既有约定：非 spec 文件名、不被 vitest 收集），导出默认值工厂 + `overrides: Partial<CharacterProfileEntity>` 合并；默认值与实体列 default / nullable 口径一致（`versionMajor=1 / versionMinor=0 / versionPatch=0` 等）。
  - 4 处局部 `buildRow` 改为复用共享 helper；各 spec 原有的漂移覆盖项通过 `overrides` 传入，语义保持一致。
- **不改** 生产 `character-profile.entity.ts`；不新增列、不动 DDL。

### 3.4 观察项 #4 · `VoiceTurnBackendTurnOptions.userId` 类型放宽（本单唯一生产 src 改动）

- **复核点（动手前 Grep 全仓）**：确认除 `engine-stream-backend.adapter.ts` 外，没有第二个后端实现读取 TurnOptions 上的 `opts.userId`；`voice.service.ts` `buildTurnOptions`（传 `state.meta.userId`）与 adapter 私有 `recordCommittedTurn` / `recordEvaluationTurn` 均不读 turn 级 `opts.userId`（身份取会话 context）。
- **处置**：
  - `voice-turn-backend.port.ts` TurnOptions 的 `userId: string` 改为 `userId?: string`，注释同步「身份以会话 context 为准；turn 级 userId 缺省 = 无学员身份」口径，与同文件 `OpenOptions.userId?` 对齐。
  - adapter 实现**不动**（本就不读该字段）；`voice.service.ts:1317` 传 `meta.userId`（string）仍是合法可选实参，无破坏。
  - `wp43-evaluation-wiring.spec.ts` 去掉对 TurnOptions 的类型断言（形状已匹配可选口径）。
- **边界**：voice 层端口，非 engine-core；类型方向为「必填 → 可选」，既有传 string 的调用方不破坏。

### 3.5 观察项 #5 · `RiskProbeResult.categories` 类别口径（core 敏感项，默认不动 core）

- **复核点（必须先读链路，再定方向；不许直接改 core）**：
  1. 读前置 gate 实现与 probe 调用链：`probe()` 结果的类别是否可能在任何生产路径进入咨询师侧类别（`CounselorSafetyCategory`，如 `promise_cure`）；
  2. 确认架构口径：probe 只探测来访输出（`VisitorRiskCategory`），咨询师违规类别由规则层 `SafetyVerdict` 产出；
  3. 对照 `wp14-student-risk-disposal.spec.ts`：该处 `promise_cure` 走 `SafetyVerdict` 构造，口径正确，作为正确写法参照。
- **处置（默认方向 A）**：
  - **A（优先，core 零改动）**：`wp14-block-no-llm-start.spec.ts:227` 桩改用规则层 `SafetyVerdict` 路径或合法 `VisitorRiskCategory` 类别，表达同一「非危机类别 → 放行、gate 不丢信号」分支；消除跨 `as unknown as RiskProbeResult`。
  - **B（仅当链路复核证实端口确需并集类别，须走例外批准）**：若生产某条链确实会把咨询师类别塞进 probe 结果，则把 `RiskProbeResult.categories` 类型放宽为 `SafetyCategory[]` 或增加 side 判别；**此项属 engine-core 改动**，必须：① 在交付记录 §方案写明根因、证据链、为什么 A 不可行；② 过 `boundary.spec.ts` 12 断言；③ 任务单验收时由主控 / 大炮明确批准。未获批准前不得动 core。
- **交付记录必须写清**：复核结论走 A 还是 B；若走 A，注明 probe 端口类别口径维持 `VisitorRiskCategory[]`。

### 3.6 观察项 #6 · `DeliberationInput` 旧形状夹具迁移（g123）

- **现状**：`g123-deliberation-scenario-fingerprint.spec.ts:159-168` 手搓旧字段 + `as unknown as DeliberationInput`；用例只验 exam 场次 0 次 LLM 调用，不消费该对象。
- **处置**：改用共享夹具 `buildTestStructuredInput()`（`test/engine-adapters/deliberation-fixtures.ts`，走真实 `buildDeliberationInput`）；旧字段名手搓与 `as unknown as` 断言消除；用例语义（0 次调用、`applyDeliberation` 返 null）保持不变。
- 若共享夹具的可调项覆盖不了该用例需要的 `ruleStrategy` 等口径，优先扩夹具 options（夹具层改动），不在 g123 spec 内回退手搓。

### 3.7 观察项 #7 · `QualityAnnotationEntity` 九列夹具漂移

- **现状**：`test/quality/` 3 spec（`quality-annotation-batch-contract.spec.ts`、`quality-annotation-seed.spec.ts`、`quality-annotation-contract.spec.ts`）实体对象列默认值各自手写。
- **处置**：在 `test/quality/`（或 `test/` 既有夹具约定位置）新建标注实体 row builder helper，默认值工厂 + `overrides: Partial<QualityAnnotationEntity>`；九列 nullable 默认 `null`（或与 spec 既有种子口径一致）；3 处复用。
- **不改** 生产 `quality-annotation.entity.ts`；与 #3 builder 各自独立。

---

## 4. 红线（违反即返工）

1. **零运行时变化**：diff 只允许类型标注、夹具字段补全、断言形状对齐、局部 builder 抽共享、#4 一处类型放宽；mock 返回值、断言条件、用例通过 / 失败结果前后一致；用例数量不增不减。
2. **生产契约为准**：spec 过时 → spec 对齐生产现状；发现生产类型确有设计缺陷 → 登记 backlog，不在本单顺手改（#5 例外路径除外，按 §3.5 B 批准流程）。
3. **engine-core 边界**：`git diff --stat HEAD -- src/engine-core` 为空；`test/engine-core/` 下只改 spec 类型标注，`boundary.spec.ts` 禁止动。
4. **配置不放宽**：不改 tsconfig / vitest 配置；不删断言、不注释报错行消错。
5. **隐私**：spec 夹具不引入真实逐字稿、心理对话原文；只保留构造句。
6. **命令规范**：一律 pnpm，禁止裸 npx；跑闸门前确认无 `nest start --watch` / `vite dev` 长驻进程；Windows 本机 git 在 `D:\Apps\Git\cmd`，依赖 git 的 spec 先补 PATH。
7. **既有债与新增分开**：交付记录写清本单改动文件清单；TD-5 之前的既有问题不混入本单；#5 复核中若发现新的契约缺陷，另开 backlog 登记。

---

## 5. 闸门（真实命令 / exit code / 数字写进交付记录）

| #   | 命令                                                                    | 通过标准                                                                                                        |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0 error、exit 0**（TD-5 已清零，本单不得回退）                                                                |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 保持 0 error（生产口径不退化）                                                                                  |
| 3   | `pnpm lint`                                                             | 0 error；warning 基线如实记录，不新增                                                                           |
| 4   | `pnpm exec vitest run test/engine-core`                                 | boundary 12 例全绿                                                                                              |
| 5   | 收尾 `pnpm test` 一次（仅交付前；`pnpm test:fast` 冒烟不作证据）        | 0 failed；记录测试文件数 / 用例数 / skipped / 墙钟与机器状态（Node 版本、长驻进程、盘读取状态），数字可复现     |
| 6   | `git diff --stat HEAD -- src/engine-core`                               | 为空（#5 走 §3.5-B 例外批准时除外，须在交付记录逐条写明例外文件与依据）                                         |
| 7   | `git diff --name-only HEAD`                                             | 逐条对照本单 §2 范围：仅 voice 端口类型 1 文件 + test spec / helper + docs，无生产 src 非 spec 文件、无并行产物 |

既有基准（HEAD `32493f0`）：全量 **3248 passed + 4 skipped（3252 例，194 文件）**；本单不改用例数量。#4 类型放宽不影响运行时；#5 若走 A，core diff 同样为空。

---

## 6. 交付物与固定路径

1. 交付记录：`docs/worklog/completed/phase2.5/td6-contract-evolution-review-implementation-2026-11-13.md`，含：
   - 七项逐项结论（走 A / B、改了哪些文件、去断言还是补字段）；
   - 改动文件清单（spec / helper / voice 端口 / docs 分组，区分新增 / 修改 / 删除）；
   - 闸门表：实际命令、exit code、error / warning 数、测试文件 / 用例数、墙钟与机器状态；
   - #5 链路复核证据（probe 调用链是否出现咨询师类别）与 A/B 取舍；
   - 回归说明：未改 mock 语义 / 断言期望 / 用例逻辑，全量测试结果与基准一致；
   - 遗留项：复核中发现但本单未处理的新契约缺陷（若有），登记 backlog。
     - **本单实际登记**：复核中新发现 3 条任务单未覆盖的残留（3 处局部角色行 builder 漏列 / wp-list §四 表格列数与表头不匹配 / 2 处既存 lint warning），已登记为 [TD-7 契约漂移 backlog](../../pending/phase2.5-contract-drift-backlog-2026-11-13.md)，**本单未顺手修**（见交付记录 §三 偏差 7 与 §七 第 5、6 条）。
2. 任务单归档：验收通过后本单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链接交付记录。
3. 索引回写：`phase2.5-wp-list-2026-11-08.md` 新增 TD-6 行（完成态 + 交付记录链接）；`phase2.5-README.md` §3 对应行同步。
4. commit 草稿（一个提交一个意图；不跳过 `--no-verify`）：
   - `refactor(voice,test): TD-6 对齐七项契约演进观察项（TurnOptions.userId 放宽可选 + spec/夹具口径对齐，零运行时变化）`
   - `docs(worklog): TD-6 契约演进核对任务单 / 交付记录与索引回写`

---

## 7. DoD 核对清单

- [x] 七项逐项有结论与落地改动；#5 链路复核证据写进交付记录，core 未在未批准情况下改动
- [x] 根 tsc 0 error；build tsc 0 error；lint 0 error；`pnpm test` 全绿；boundary 12 绿
- [x] `git diff --name-only HEAD` 仅含 voice 端口 1 文件 + test spec / helper + docs；生产 src 非该端口文件零改动；engine-core diff 为空（或例外已批准并过 boundary）
- [x] 未新增 / 删除测试用例；未改断言期望与 mock 语义；全量用例数与基准一致（3252 例 / 194 文件）
- [x] #3 / #7 共享 builder 已落地，4 处角色 spec + 3 处标注 spec 复用；局部手写默认值漂移消除
- [x] 交付记录、任务单归档、wp-list / README 索引一致，无断链

---

## 附录 A · 七项锚点清单（主控扫描备查，行号现场复核）

| #   | 生产锚点                                                                                               | spec / 夹具锚点                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/engine-adapters/deliberation/deliberation-types.ts` Output.intentionShift                         | `test/engine-adapters/wp63-deliberation-schema.spec.ts`（⑥ 两处）、`test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts` `okOutcome()`                                             |
| 2   | `src/engine-core/character-profile.ts` forbiddenBehaviors / sensitiveTopics                            | `test/admin-debug/wp38-debug-event-tags.spec.ts`、`test/admin-debug/wp58-debug-session.spec.ts` `makeCharacterProfile()`                                                                      |
| 3   | `src/engine-adapters/.../character-profile.entity.ts`                                                  | `test/engine-adapters/character-baseline-calibration.spec.ts`、`character-baseline-seed-calibration.spec.ts`、`wp41-expression-style-rendering.spec.ts`、`wp9b-db-character-resolver.spec.ts` |
| 4   | `src/voice/voice-turn-backend.port.ts` TurnOptions.userId（:306 段）                                   | `test/voice/.../wp43-evaluation-wiring.spec.ts`；实现参照 `src/engine-adapters/wiring/engine-stream-backend.adapter.ts`、`src/voice/voice.service.ts` `buildTurnOptions`                      |
| 5   | `src/engine-core/risk-probe.ts` RiskProbeResult.categories；`src/engine-core/safety-types.ts` 类别联合 | `test/engine-adapters/wp14-block-no-llm-start.spec.ts`（:227 桩）；正确写法参照 `wp14-student-risk-disposal.spec.ts` SafetyVerdict 路径                                                       |
| 6   | `src/engine-adapters/deliberation/deliberation-types.ts` DeliberationInput 七字段                      | `test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts`（:159-168）；共享夹具 `test/engine-adapters/deliberation-fixtures.ts` `buildTestStructuredInput()`                      |
| 7   | `src/.../quality-annotation.entity.ts` 九列                                                            | `test/quality/quality-annotation-batch-contract.spec.ts`、`quality-annotation-seed.spec.ts`、`quality-annotation-contract.spec.ts`                                                            |
