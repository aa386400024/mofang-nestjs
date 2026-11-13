# TD-6 · TD-5 §五 七项生产契约演进观察项核对 — 交付记录

> 状态：✅ 已交付（2026-11-13）
> 执行方：MiniMax Code（主控派单 · 按开工任务单执行）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，起点 HEAD `32493f0`（TD-5 提交）
> 任务单：`td6-contract-evolution-review-task-2026-11-13.md`（已归档至本目录）
> 任务性质：既有技术债清理（契约口径对齐）—— **零运行时行为变化**，不新增/删除测试用例

---

## 一、结论

七项观察项全部处置完毕，**engine-core 源码零改动**（`git diff --stat HEAD -- src/engine-core` 为空），生产侧改动只有 **voice 层两个文件的类型标注**（端口放宽 + 调用点收窄），用例数量与基线逐字一致（**3252 例 / 194 文件**）。

> 复核中另新发现 **3 条任务单未覆盖的契约漂移残留**（3 处局部角色行 builder 漏列 / wp-list §四 表格列数与表头不匹配 / 2 处既存 lint warning）—— 按任务单 §6「不顺手修」要求登记为 [TD-7 契约漂移 backlog](../../pending/phase2.5-contract-drift-backlog-2026-11-13.md)，**本单未改动对应文件**。

| #   | 观察项                                                         | 处置                                                                                                                              | 落地文件                                                                                               |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | `DeliberationOutput.intentionShift` 三件套夹具                 | 夹具补 `intentionShift: null`（四件套）+ 键数断言 3→4 + 去 `as unknown as`                                                        | `wp63-deliberation-schema.spec.ts`（两处）、`wp67-deliberation-circuit-breaker.spec.ts`                |
| 2   | `CharacterProfile.forbiddenBehaviors` / `sensitiveTopics` 必填 | 调试桩补 `[]` + 去断言；**core 必填语义不动**                                                                                     | `wp38-debug-event-tags.spec.ts`、`wp58-debug-session.spec.ts`                                          |
| 3   | `CharacterProfileEntity` 后加列夹具漂移                        | 抽**共享 row builder**（默认值工厂 + overrides），4 处局部 builder 复用                                                           | 新增 `test/engine-adapters/character-profile-fixtures.ts` + 4 个 spec                                  |
| 4   | `VoiceTurnBackendTurnOptions.userId`                           | 端口 `userId: string` → `userId?: string`（**本单唯一生产语义面改动**）；连带把 voice 层构造的 turn options **收窄回必填 userId** | `src/voice/voice-turn-backend.port.ts`、`src/voice/voice.service.ts`、`wp43-evaluation-wiring.spec.ts` |
| 5   | `RiskProbeResult.categories` 类别口径                          | **走 A（core 零改动）**：桩改喂合法来访类别 `'neutral'`（11 类里唯一不在危机子集内的），表达同一「非危机类别 → 放行」分支         | `wp14-block-no-llm-start.spec.ts`                                                                      |
| 6   | `DeliberationInput` 旧形状夹具（g123）                         | 迁移共享夹具 `buildTestStructuredInput()`（走真实 `buildDeliberationInput` 装配），手搓旧字段与 `as unknown as` 全消              | `g123-deliberation-scenario-fingerprint.spec.ts`                                                       |
| 7   | `QualityAnnotationEntity` 九列夹具漂移                         | 抽**独立**标注实体 row builder（与 #3 字段域不同，不合并），复用 2 处                                                             | 新增 `test/quality/quality-annotation-fixtures.ts` + 2 个 spec                                         |

---

## 二、逐项处置明细

### 2.1 #1 · `DeliberationOutput.intentionShift`（三处）

生产契约（`deliberation-types.ts`）：`intentionShift: DeliberationIntentionShift | null` —— **key 必填、值可为 null**（消费方不判 undefined）。

- `wp63-deliberation-schema.spec.ts` ⑥ 段第一处：**形状断言**（用例标题就是「输出契约形状」），断言的期望数组原为 3 key —— 那是在锁**已经过期**的契约形状（生产契约自 WP68 起就是四件套）。改为四件套 + 期望数组含 `intentionShift`（4 key），去 `as unknown as`，用例标题同步改为「四件套」。
- `wp63-deliberation-schema.spec.ts` ⑥ 段第二处（「没变化 = 空数组」）：只验 `deltas` 长度，补 `intentionShift: null` + 去断言，用例语义不变。
- `wp67-deliberation-circuit-breaker.spec.ts` 的 `okOutcome()`：补 `intentionShift: null` + 去断言，并把内联对象提成具名 `const output: DeliberationOutput`（类型标注保留，不靠断言）。

**「校验器容忍缺字段」那条路径不由本项承担**：`wp68-deliberation-intention-lock.spec.ts` ②-9 已专门覆盖（缺省 `intentionShift` → `null` 且不计 `rejectedEntries`），本项三处都不是那条路径。

### 2.2 #2 · `CharacterProfile` 两个必填字段

内核 `domain/character-profile.ts:150/152`：`forbiddenBehaviors` / `sensitiveTopics` 是**必填** `readonly string[]`；内核四处真实消费（`intention-planner.ts:84` `profile?.forbiddenBehaviors ?? []`、`rule-based-classifier.ts:32` `(context?.sensitiveTopics ?? [])`、`in-memory-engine-session.ts:420` 透传、`trajectory-applier.ts:197/222` 并集）—— **必填语义成立，core 一行不动**。

调试服务侧复核（`src/admin-debug/`）：`debug-session.service.ts` 只把 `resolved.characterProfile` 交给 `engine.open(...)`（内核按 `?? []` 回落），展示字段只读 `attachmentStyle` / `personalityTraits`（`buildCharacterBrief`），**不读这两个字段**；两个 spec 里的引擎替身是 stub，根本不碰 profile。→ 补 `[]` 对运行时零影响。

夹具由「三字段 + `as unknown as CharacterProfile`」改为**完整满足内核契约**（`coreBeliefs` / `attachmentStyle` / `personalityTraits` / `forbiddenBehaviors: []` / `sensitiveTopics: []`），断言消除，注释改为「必填字段补空数组，调试服务不消费」。

### 2.3 #3 · 角色实体共享 row builder

新增 `test/engine-adapters/character-profile-fixtures.ts`（非 spec 文件名，vitest 不收集；沿用 `deliberation-fixtures.ts` 的既有约定），导出 `buildCharacterProfileRow(overrides?: Partial<CharacterProfileEntity>)`：

- 默认值与 `character-profile.entity.ts` 的列定义**逐条对齐**：`versionMajor=1 / versionMinor=0 / versionPatch=0`（WP38 semver 三列）、`baselineSafety=0.5 / baselineBond=0`（WP51，与内核 `DEFAULT_SAFETY` / `DEFAULT_BOND` 同值）、`speechVolumeBaseline=0.5 / narrativeStyle=mixed / expressionTone=restrained`（WP10A）、`personalityTraits=null` / `verbalVoice=null`（两个可空列）、内容列一律空集合。
- 4 处局部 builder 改为复用：`character-baseline-calibration.spec.ts`（`buildRow(target)`）、`character-baseline-seed-calibration.spec.ts`（`buildDriftedRow(target, overrides)`）、`wp41-expression-style-rendering.spec.ts`（`buildRow(overrides)`）、`wp9b-db-character-resolver.spec.ts`（`buildRow(seed, overrides)`）；各 spec 自己的取值全部通过 `overrides` 传入，**语义保持一致**。

**零运行时变化的逐条核对**（新增的列原本是「缺着的」）：

| 新补列                                             | 原形状    | 消费方                                                                                              | 结论                                                                                                                 |
| -------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `personalityTraits: null`                          | undefined | `db-character-profile.resolver.ts:81` `row.personalityTraits == null ? {} : {...}`                  | `== null` 同时兜住 null 与 undefined → 不变                                                                          |
| `verbalVoice: null`                                | undefined | `db-character-profile.resolver.ts:158` `row.verbalVoice ? {...} : {}`                               | null 与 undefined 同为 falsy → 不变                                                                                  |
| `versionMajor/Minor/Patch`                         | undefined | resolver **不读**；校准路径的 UPDATE 载荷由标定表构造（`FORBIDDEN_COLUMNS` 断言保证载荷不含这三列） | 不变                                                                                                                 |
| `baselineSafety=0.5 / baselineBond=0`（wp9b 独有） | undefined | `toCharacterSeed` 直接传 → `buildCharacterProfile` 条件展开                                         | 之前是「键不存在 → 内核 bootstrap `?? DEFAULT_SAFETY/DEFAULT_BOND` 回落到 0.5 / 0」，现在显式给同值 → **有效值不变** |

### 2.4 #4 · `VoiceTurnBackendTurnOptions.userId` 放宽为可选

**动手前全仓 Grep 复核**（任务单 §3.4 要求的确认点）：

- `opts.userId` 在 `src/` 的全部命中只有 4 处，**全在 `openSession` 内**（`engine-stream-backend.adapter.ts:362/387/389/446`，即 `VoiceTurnBackendOpenOptions` —— 那一层本来就是 `userId?: string`）。
- **turn 级 `opts.userId` 无人读取**：`streamTurn` / `recordCommittedTurn` / `recordEvaluationTurn` / `buildStream` 都不读它 —— 身份一律取自**会话 context**（`openSession` 写入、`turn` 读取）。
- `voice.service.ts` 的 `buildTurnOptions` 传的是 `state.meta.userId`（`VoiceSessionMeta.userId: string`，**恒有值**）。

**处置**：

- `src/voice/voice-turn-backend.port.ts`：`TurnOptions.userId` → `userId?: string`，注释同步口径（身份以会话 context 为准；turn 级缺省 = 无学员身份），与同文件 `OpenOptions.userId?` 对齐。
- `src/voice/voice.service.ts`：**把 voice 层构造的 turn options 收窄回必填 userId** —— `buildTurnOptions` 与 `guardEngineStream` 的类型改成 `VoiceTurnBackendTurnOptions & { readonly userId: string }`。这是端口放宽的**必然连带面**：voice 层构造的这份 options 转交给旧链路 `VisitorTurnOptions`（`userId` 必填，且旧链路**真的读**它做上下文解析与 LLM 归属），收窄让「voice 层恒有学员身份」这条不变量在类型层显式成立，而不是用 `?? ""` 造一个假身份。**纯类型标注，运行时零变化。**
- `wp43-evaluation-wiring.spec.ts`：去掉对 `VoiceTurnBackendTurnOptions` 的类型断言（可选口径下形状已匹配），并删掉随之未使用的类型导入。

### 2.5 #5 · `RiskProbeResult.categories` 类别口径（**走 A，core 零改动**）

**链路复核证据链**（任务单 §3.5 要求先读链路再定性）：

1. **端口口径**：`src/engine-core/domain/ports/risk-probe.ts` 的 `RiskProbeResult.categories: readonly VisitorRiskCategory[]`；`VisitorRiskCategory` = PsyGUARD 11 类（`suicide_attempt` … `aggression_self` + `neutral`），`CounselorSafetyCategory`（`promise_cure` / `value_judgment` / …）是**另一条联合**，两者并集才是 `SafetyCategory`。
2. **probe 实现只产来访侧类别**：`local-crisis.probe.ts:166` `detectCrisisCategories(text)`；`http-psyguard.probe.ts` 归一后回传的也是 11 类 wire 名。**任何生产路径都不会把咨询师侧类别塞进 probe 结果。**
3. **架构口径**：咨询师侧违规由**规则层**产出 `SafetyVerdict`（`categories: SafetyCategory[]`，两类并集），再由 `decideStudentRiskAction` 按「side → 等级 → 危机类别」三条边界裁决（`student-risk-disposal.ts:125-135`）。
4. **前置 gate 的类别边界**：`preCheckSafety` → `buildStudentRiskDecisionFromProbe(result)` → 包成 `SafetyVerdict`（`side: counselor_input`）→ `decideStudentRiskAction` → `verdict.categories.filter(isCrisisCategory)` **为空 → action = none → 放行**。
5. **危机类别子集**：`render-risk.ts` 的 `CRISIS_RISK_CATEGORIES` = 11 类来访类别**去掉 `neutral`** —— 即 **`neutral` 是唯一「合法来访类别但不在危机子集内」的取值**。

**结论：走 A**。`neutral` 能表达与原用例**完全同一条代码路径**（类别非危机 → 过滤器为空 → 放行），且完全落在端口类型口径内，**core 一行不动**，不需要走 §3.5-B 的例外批准路径。

**处置**：`wp14-block-no-llm-start.spec.ts` 的探针桩由 `{ level: block, categories: [promise_cure] } as unknown as RiskProbeResult` 改为 `{ level: block, categories: [neutral] }`（等级仍给 block，验的仍是「不是危机类别就不拦」），去 `as unknown as`；用例标题去掉已不成立的「(专业越界)」，输入句同步换成与 `neutral` 相称的中性句。

**「咨询师侧类别不走危机处置」这条语义没有丢** —— 它由**规则层**覆盖，已核实存在：`wp14-student-risk-disposal.spec.ts` ① 有 `counselor_input + block + 只有专业越界类别(promise_cure) → none`，编排层有「专业越界 (promise_cure) 不处置: 正常渲染且无 disposal 键」。本项只把**不可能出现在 probe 结果里**的状态从 probe 路径挪走。

### 2.6 #6 · g123 迁移共享夹具

g123 ③ 用例（exam 场次一次 LLM 都不发）原先手搓**审议输入最小化 WP-A 之前的旧字段名**（`kernelEvents` / `stateBefore` / `stateAfter` / `counselorVerdict` / `visitorText` / `riskLevel`）+ `as unknown as DeliberationInput`，而该对象**本用例根本不消费**。

改为 `buildTestStructuredInput({ ruleStrategy: 'simple_response' })`（`test/engine-adapters/deliberation-fixtures.ts`，走**真实** `buildDeliberationInput` 装配），手搓旧字段、`as unknown as` 与随之未用的两个导入全部消除；用例断言（0 次调用 / `applyDeliberation` 返 null）**一字未动**。

### 2.7 #7 · 标注实体共享 row builder

新增 `test/quality/quality-annotation-fixtures.ts`，导出 `buildQualityAnnotationRow(overrides?: Partial<QualityAnnotationEntity>)`：九列 WP-N（`batchId` / `counselorModeId` / `turnCount` / `engineVersion` / `promptVersion` / `characterVersion` / `firstBadTurn` / `badTurns` / `turnNote`）按实体口径**全部缺省 null**，其余列取 DDL 默认值或人工列 null。与 #3 的 builder **各自独立**（字段域不同，不合并成一个跨域工厂）。

复用 2 处：`quality-annotation-batch-contract.spec.ts`（`debugSessionId: debug_1` / `characterSlug: vpt_a` 走 overrides）、`quality-annotation-contract.spec.ts`（默认值即原 makeRow）。后者原先**故意不填**九列（用 `as QualityAnnotationEntity` 断言），现在按实体口径补 `null`。

**null vs undefined 的行为核对**：`quality-annotation.service.ts` 里对 WP-N 列的判定全部是「`=== null` 放行 / `!== null` 计数」或 `?? null` 回落：

- `isLegacyAnnotationRow(batchId, validBatchIds)` → `batchId === null || !validBatchIds.has(batchId)`：**undefined 与 null 都判 legacy** → 不变；
- `applyTurnColumns` 的 `turnCount !== null` → undefined 时 `firstBadTurn > undefined` 为 false（不抛），null 时直接跳过 → **两条路都不抛，等价**；
- `parseBadTurns(raw, turnCount)` 的 `turnCount !== null && value > turnCount` → 同上，等价；
- `batchList` 的 `row.batchId === null` 计数分支只被**另一个 spec**（batch-contract，其行本来就是 `batchId: null`）覆盖；contract spec 全文**没有**任何 WP-N 列断言（Grep 零命中）。

结论：补 `null` 对两个 spec 的被测行为**零影响**，且更贴近真库（DB 可空列读回来就是 null，不是 undefined）。

---

## 三、与任务单的偏差（7 处，均已在本记录写明理由）

| #   | 任务单口径                                                                                   | 现场实际                                                                                                                                                                                                                                                          | 处置                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §3.4「本单唯一生产 src 改动 = 端口类型」；`voice.service.ts:1317` 传 `meta.userId`「无破坏」 | 端口放宽后，voice 层把 turn options 转交旧链路 `VisitorTurnOptions`（`userId` **必填**且旧链路真的读它）→ **4 处 TS2345**，必须再动 `src/voice/voice.service.ts`                                                                                                  | 追加**纯类型**收窄（`buildTurnOptions` / `guardEngineStream` 返回/参数类型改为 `... & { readonly userId: string }`），零运行时变化；生产侧共 **2 文件**                                                 |
| 2   | §3.7「3 个 quality spec 复用」                                                               | `quality-annotation-seed.spec.ts` **不构造** `QualityAnnotationEntity` 行（行由生产 `seedQualityAnnotations` 造）                                                                                                                                                 | 实际复用 **2 处**；seed spec 保持不动（无可复用点）                                                                                                                                                     |
| 3   | §1.2 / 附录 A：`character-baseline-seed-calibration.spec.ts:131` 的 `buildRow`               | 该处函数名是 **`buildDriftedRow`**（行号一致）                                                                                                                                                                                                                    | 按真名复用共享 builder                                                                                                                                                                                  |
| 4   | §3.3「4 处局部 buildRow 改为复用共享 helper」                                                | 共享 helper 补齐 `baselineSafety` / `baselineBond` 后，wp9b 的 C.1「DB 路径与内置种子路径产出逐字一致」用例里 `equivalentSeed` 必须**镜像 DB 行**这两列，否则 `toEqual` 不成立                                                                                    | 按该用例自己的注释原则（「等价的种子必须镜像 DB 行的全部字段」，WP41 三列已是同款处理）补 `safety` / `bond` 两行；**断言与被测行为不变**                                                                |
| 5   | §5 闸门 3「lint 0 error；warning 基线如实记录，不新增」                                      | 任务单沿用 TD-5 记录的「0 warning」，但 **HEAD `32493f0` 实测有 2 warning**：`test/e2e/knowledge-search.e2e-spec.ts` 与 `test/e2e/privacy-guard.e2e-spec.ts` 行首 `eslint-disable` 里的 `prettier/prettier` 规则已失效（`--no-cache` 复现，两文件本单**零改动**） | **既存基线**，非本单引入；本单**未新增 warning**；两处不在本单范围，**未顺手改**                                                                                                                        |
| 6   | §3.5「桩改用规则层 SafetyVerdict 路径**或**合法 VisitorRiskCategory 类别」                   | probe 结果**不可能**携带咨询师侧类别（§二 2.5 证据链 1~3），故「规则层 SafetyVerdict 路径」在本用例不可达（gate 内部自行包 SafetyVerdict，spec 无法注入）                                                                                                         | 取「合法 VisitorRiskCategory 类别」这一支，落点 `'neutral'`（唯一非危机来访类别）                                                                                                                       |
| 7   | §6 索引回写「wp-list 新增 TD-6 行」                                                          | §四 表格**表头是 3 列**（`独立单 / 一句话描述 / 状态`），但 TD-5 / L-2 / G-4 三行是 **5 列** —— 多出的第 4、5 列在 Markdown 渲染时被**丢弃**，TD-5 行的完整交付态在表里实际**不可见**（只剩「TD-5 / 一句话描述 / ⚪ P3」）                                        | TD-6 行按**表头 3 列**写（优先级与说明并入前两列），**不复制这 3 行的缺陷**；TD-5 行是本单开工前工作区里已存在的未提交回写（TD-5 组）、L-2 / G-4 是 HEAD 既有，本单均**不动** → 已登记 TD-7 backlog B-2 |

---

## 四、改动文件清单

### 4.1 生产代码（2 文件，**仅 voice 层**，非 core）

| 文件                                   | 改动                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/voice/voice-turn-backend.port.ts` | `VoiceTurnBackendTurnOptions.userId: string` → `userId?: string` + 注释口径同步（**类型层放宽，运行时零变化**）                                       |
| `src/voice/voice.service.ts`           | `buildTurnOptions` 返回类型与 `guardEngineStream` 参数类型收窄为 `VoiceTurnBackendTurnOptions & { readonly userId: string }` + 注释（**纯类型标注**） |

### 4.2 新增 test helper（2 文件，非 spec）

| 文件                                                 | 职责                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `test/engine-adapters/character-profile-fixtures.ts` | `buildCharacterProfileRow(overrides)` —— 角色实体共享 row builder（#3）  |
| `test/quality/quality-annotation-fixtures.ts`        | `buildQualityAnnotationRow(overrides)` —— 标注实体共享 row builder（#7） |

### 4.3 测试 spec（13 文件）

| 文件                                                                  | 对应项 | 改动摘要                                                                       |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `test/engine-adapters/wp63-deliberation-schema.spec.ts`               | #1     | 两处夹具补 `intentionShift: null` + 去断言；键数断言 3→4；用例标题改「四件套」 |
| `test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts`      | #1     | `okOutcome()` 内联对象提具名 + 补 `intentionShift: null` + 去断言              |
| `test/admin-debug/wp38-debug-event-tags.spec.ts`                      | #2     | `makeCharacterProfile()` 补两个必填空数组 + 去断言                             |
| `test/admin-debug/wp58-debug-session.spec.ts`                         | #2     | 同上                                                                           |
| `test/engine-adapters/character-baseline-calibration.spec.ts`         | #3     | 局部 `buildRow` → 共享 builder                                                 |
| `test/engine-adapters/character-baseline-seed-calibration.spec.ts`    | #3     | 局部 `buildDriftedRow` → 共享 builder                                          |
| `test/engine-adapters/wp41-expression-style-rendering.spec.ts`        | #3     | 局部 `buildRow` → 共享 builder                                                 |
| `test/engine-adapters/wp9b-db-character-resolver.spec.ts`             | #3     | 局部 `buildRow` → 共享 builder；`equivalentSeed` 镜像 DB 行补 safety/bond 两列 |
| `test/engine-adapters/wp43-evaluation-wiring.spec.ts`                 | #4     | 去 `as VoiceTurnBackendTurnOptions` + 删随之未用的类型导入                     |
| `test/engine-adapters/wp14-block-no-llm-start.spec.ts`                | #5     | 桩类别 `promise_cure` → `neutral` + 去 `as unknown as` + 标题/输入句同步       |
| `test/engine-adapters/g123-deliberation-scenario-fingerprint.spec.ts` | #6     | 旧形状手搓 → `buildTestStructuredInput()`；删两个未用导入                      |
| `test/quality/quality-annotation-batch-contract.spec.ts`              | #7     | 局部 `makeRow` → 共享 builder                                                  |
| `test/quality/quality-annotation-contract.spec.ts`                    | #7     | 局部 `makeRow` → 共享 builder（九列按实体口径 null）                           |

### 4.4 docs（5 文件）

- 新增交付记录（本文件）；
- 任务单 `td6-contract-evolution-review-task-2026-11-13.md`（从 `pending/` 归档到 `completed/phase2.5/`，状态行改 ✅、DoD 全勾）；
- 索引回写：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 与 `docs/worklog/pending/phase2.5-README.md` 的 TD-6 行（行尾闭合竖线齐全；wp-list 侧 TD-6 行按该表**表头 3 列**写 —— 见 §三 偏差 7）；
- **新增** `docs/worklog/pending/phase2.5-contract-drift-backlog-2026-11-13.md`（复核中新发现、任务单未覆盖的 3 条契约漂移残留登记 —— 见 §七）；
- 两个索引文件**各加一行 TD-7**（指向上述 backlog，状态 📋 待开工），保持两个索引一致。

> ⚠️ 另注：上述两个索引文件在**本单开工前**就已是「已修改」状态 —— 那是 TD-5 的索引回写**尚未提交**（TD-5 只提交了代码那一组）。本单在同两行上追加 TD-6，提交时 docs 一组会同时带上 TD-5 的索引回写。

### 4.5 改动面汇总

- `git diff --name-only HEAD`：**17 个已跟踪文件**（生产 2 + spec 13 + docs 2）；**另有 6 个新增未跟踪文件**（交付记录 / 归档后的任务单 / 2 个 test helper / **契约漂移 backlog** / 本次回执 relay-response）。
- `git diff --stat HEAD`：17 files changed, **+85 −136**（docs 索引两文件含 TD-5 遗留部分 + 本单 TD-6 / TD-7 索引行）。
- **`src/engine-core/**` 零 diff**（`git diff --stat HEAD -- src/engine-core` 空输出）。

---

## 五、闸门（全部实跑，真实数字）

| #   | 命令                                                                    | exit  | 结果                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error / 0 文件**（TD-5 已清零，本单不得回退 —— 未回退）                                                                                                                   |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**                                                                                                                                                                   |
| 3   | `pnpm lint`                                                             | **0** | **0 error / 2 warning**（2 处为 HEAD 既存基线，见 §三 偏差 5；本单未新增）                                                                                                    |
| 4   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed / 12**（收尾复跑 2.50s；首轮 1.40s）                                                                                                                              |
| 4b  | `pnpm exec vitest run test/engine-core`                                 | **0** | **23 文件 / 461 例全绿**                                                                                                                                                      |
| 5   | `pnpm test`（收尾全量）                                                 | **0** | **193 passed \| 1 skipped（194 文件）· 3248 passed \| 4 skipped（3252 例）**，vitest **73.01s**，墙钟 **76.0s**（与基线 3252 例 / 194 文件**逐字一致**；首轮 74.57s / 76.4s） |
| 6   | `git diff --stat HEAD -- src/engine-core`                               | 0     | **空输出**                                                                                                                                                                    |
| 7   | `git diff --name-only HEAD`                                             | 0     | **17 个已跟踪文件**（生产 2 + spec 13 + docs 2）；**另有 6 个新增未跟踪文件**（交付记录 / 归档后的任务单 / 2 个 test helper / 契约漂移 backlog / 本次回执）                   |

> **收尾复跑说明**：登记 TD-7 backlog 与索引回写（**仅 .md 改动**，`git diff --name-only HEAD -- '*.ts'` 与闸门首跑时逐字一致）后，本单**在最终工作区状态下把 6 项闸门全部复跑一遍**，数字与首跑逐字一致（根 tsc 0 error / build tsc 0 error / lint 0 error 2 warning / boundary 12 绿 / 全量 3252 例 0 failed / core diff 空）。下表数字即**复跑后的最终状态**。

定向验证（本单触及的 spec，先跑后全量）：

- #1 / #2 / #4 / #5 / #6 九条：`wp63` `wp67` `wp68` `wp38` `wp58` `wp14-block` `wp14-student-risk-disposal` `g123` `wp43` → **9 文件 / 174 例全绿**；
- #3 / #7 七条：`character-baseline-calibration` `character-baseline-seed-calibration` `wp41` `wp9b` `quality-annotation-batch-contract` `quality-annotation-contract` `quality-annotation-seed` → **7 文件 / 117 例全绿**。

机器状态：Windows 11 Home China（10.0.26300 build 26300）· Node **v26.13.0** · pnpm **9.15.0** · PowerShell 5.1.26100.9818 · 8 逻辑核 · 跑闸门时 **node 进程 0 个**（无 `nest start --watch` / `vite dev` 长驻）。

---

## 六、回归说明

- **零运行时变化**：改动只有四类 —— ①类型标注 / 泛型 / `import type`；②`as` / `as unknown as` 断言消除；③夹具字段补全（补的值与「原先缺着」在所有消费路径上**等值**，逐条核对见 §二 2.3 / 2.7）；④`buildTurnOptions` / `guardEngineStream` 的**类型收窄**（不改对象构造）。
- **未改任何断言期望、mock 返回值、用例逻辑**；**未新增 / 删除测试用例** —— 全量 **3252 例 / 194 文件**，与 TD-5 基线逐字一致。
- **唯一断言期望变化**：`wp63` 的键数断言由 3 key 改 4 key —— 这是任务单 §3.1 明确授权的项（对齐 WP68 起的四件套生产契约），且该用例的标题同步改为「四件套」，不含糊。
- **零新增依赖、零 tsconfig / vitest 配置改动、零表结构 / migration / 实体映射 / 装配改动、零 prompt / 阈值 / 判据改动**。
- **engine-core 零 diff**（`boundary.spec.ts` 一行未动，12 断言全绿）。

---

## 七、遗留与观察项

1. **既存 2 lint warning**（`test/e2e/knowledge-search.e2e-spec.ts` / `test/e2e/privacy-guard.e2e-spec.ts` 行首 `eslint-disable` 的 `prettier/prettier` 规则失效）—— 不在本单范围，未顺手改；TD-5 记录里的「0 warning」是 `--cache` 造成的口径差，建议后续单独立一个工具链小单清掉。
2. **`CharacterProfileEntity` 的 `version` 计数列与 semver 三列并存**（TD-5 §五已列，本单未改）：`version` 只表达「改过几次」，版本判定一律读三列 —— 夹具侧本单已按实体口径补齐三列，但**计数列与 semver 的关系**仍建议生产侧后续确认是否要收敛。
3. **`RiskProbeResult` 的类别口径维持 `VisitorRiskCategory[]`**（本单结论，core 未动）：若将来产品要求 probe 也能回传咨询师侧类别，需走 core 例外批准流程（改端口类型 + 过 boundary 12 断言 + 单独取舍说明）。
4. **#3 / #7 两个 builder 目前只服务 spec**：若将来有新的 spec 需要角色行 / 标注行，优先复用它们，别再各写一份局部 builder（这正是本单要消灭的漂移源）。
5. **新发现 · 3 处局部角色行 builder 未纳入共享 builder**（`wp10a-character-expression-fields.spec.ts:293` / `wp49-character-five-factor-personality.spec.ts:125` / `wp51-character-seed-alliance-baseline.spec.ts:86`）：任务单 §3.3 的「4 处」只统计了**命名为 `buildRow` / `buildDriftedRow`** 的局部 builder，这 3 处名为 `makeRow` 或内联构造，未进清单；仍带 `as CharacterProfileEntity` 断言（**掩盖类型检查**）、缺 semver 三列。**逐列核对行为零影响**（resolver 不读 semver 三列；`personalityTraits` 走 `== null` 同分支；`verbalVoice` 同为 falsy；`baselineSafety` / `baselineBond` 由内核 `DEFAULT_SAFETY=0.5` / `DEFAULT_BOND=0` 兜底）—— 已登记 **TD-7 backlog B-1**，本单未改。
6. **wp-list §四 表格列数与表头不匹配**：表头 3 列，TD-5 / L-2 / G-4 三行是 5 列 → 多出的列在 Markdown 渲染中被丢弃，**TD-5 行的交付态在表里不可见**。本单 TD-6 行已按 3 列写（§三 偏差 7），三行既有问题登记 **TD-7 backlog B-2**，本单未改。

---

## 八、关键决策

1. **#5 走 A，不申请 core 例外**：`neutral` 是 11 类来访类别里唯一不在危机子集内的取值，能走**完全相同**的代码路径（`filter(isCrisisCategory)` 为空 → 放行），且完全落在端口类型口径内 —— 没有任何理由为它开 core 红线。
2. **#4 的连带面用「类型收窄」解决，而不是 `?? ""`**：voice 层构造的 turn options **恒带** userId（`VoiceSessionMeta.userId: string`），把它显式收窄回必填，既守住旧链路（真的读 userId）的契约，又不造假身份；端口那一层仍保持可选（实现方可以只依赖会话 context）。
3. **#3 / #7 的 builder 默认值取「实体列口径」而不是「原夹具口径」**：原夹具缺列 = 生产里不可能出现的形状；补齐后夹具**更像真行**，且逐条核对过每个新补列在所有消费路径上与「缺着」等值。
4. **`wp9b` 的 `equivalentSeed` 补 safety / bond**：该用例自己的注释就写着「等价的种子必须镜像 DB 行的全部字段」（WP41 三列已是同款处理），本单沿用同一原则，不是新增口径。
5. **不动 `quality-annotation-seed.spec.ts`**：它不构造实体行，硬塞 builder 就是为「凑数而改文件」。

---

## 九、commit 草稿（未提交，等你指令）

```
refactor(voice,test): TD-6 对齐七项契约演进观察项（TurnOptions.userId 放宽可选 + spec/夹具口径对齐，零运行时变化）
docs(worklog): TD-6 契约演进核对任务单 / 交付记录与索引回写
docs(worklog): 登记 TD-7 契约漂移 backlog（复核新发现 3 条，本单未顺手修）
```

> 建议**分 3 个提交**（一个提交一个意图，不跳 `--no-verify`）。注意：`phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 在**本单开工前就已是「已修改」**状态（TD-5 的索引回写尚未提交），docs 一组提交时会把 **TD-5 的索引回写一并带上** —— 这属于 HEAD 既有状态，不是本单引入。
