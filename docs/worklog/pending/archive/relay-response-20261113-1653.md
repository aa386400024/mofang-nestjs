TD-6 契约演进核对单已完成并归档。七项观察项全部处置到位，**engine-core 源码零改动**，**零运行时行为变化**，**用例数量与基线逐字一致**。收尾复核时另新发现 3 条任务单未覆盖的契约漂移残留，已按任务单 §6 要求登记 backlog，**未在本单顺手修**。

## 一、逐项结论

| #   | 观察项                               | 处置                                                                                                            | 落地                                                                         |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `DeliberationOutput.intentionShift`  | 三处夹具补 `intentionShift: null` 对齐四件套、键数断言 3→4、去 `as unknown as`                                  | `wp63`（两处）、`wp67`                                                       |
| 2   | `CharacterProfile` 必填字段          | 调试桩补 `[]`、去断言；**core 必填语义不动**                                                                    | `wp38`、`wp58`                                                               |
| 3   | `CharacterProfileEntity` 后加列漂移  | 抽共享 row builder，**4 处**局部 builder 复用                                                                   | 新增 `test/engine-adapters/character-profile-fixtures.ts` + 4 spec           |
| 4   | `VoiceTurnBackendTurnOptions.userId` | 端口 `string` → `userId?: string`；**连带把 voice 层构造的 turn options 收窄回必填**                            | `src/voice/voice-turn-backend.port.ts`、`src/voice/voice.service.ts`、`wp43` |
| 5   | `RiskProbeResult.categories`         | **走 A（core 零改动）**：桩改喂合法来访类别 `neutral`（11 类里唯一非危机类），走同一条「非危机类别 → 放行」分支 | `wp14-block-no-llm-start`                                                    |
| 6   | g123 旧形状 `DeliberationInput`      | 迁移共享夹具 `buildTestStructuredInput()`（走真实装配），手搓旧字段与断言全消                                   | `g123-deliberation-scenario-fingerprint`                                     |
| 7   | `QualityAnnotationEntity` 九列       | 抽**独立**标注 row builder（与 #3 字段域不同，不合并），**2 处**复用                                            | 新增 `test/quality/quality-annotation-fixtures.ts` + 2 spec                  |

**#5 为什么走 A**：probe 结果不可能携带咨询师侧类别（gate 内部自行包 SafetyVerdict，spec 无法注入），「规则层 SafetyVerdict 路径」在本用例不可达；而 `neutral` 完全落在端口类型口径内、能走**完全相同**的代码路径 —— 没有理由开 core 红线。咨询师侧 `promise_cure` 的语义仍由规则层 `wp14-student-risk-disposal.spec.ts` 覆盖，覆盖不丢。

**#4 为什么连带动了 2 个生产文件**：端口放宽后，voice 层把 turn options 转交旧链路 `VisitorTurnOptions`（`userId` **必填且真读**）→ 4 处 TS2345。解法是**纯类型收窄**（`buildTurnOptions` / `guardEngineStream` 改为 `... & { readonly userId: string }`），不造假身份、零运行时变化。

## 二、闸门（收尾复跑，真实数字）

| 闸门                                                                 | exit | 结果                                                                                                                      |
| -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 根 tsc `tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0    | **0 error / 0 文件**                                                                                                      |
| build tsc `tsc -p tsconfig.build.json --noEmit`                      | 0    | **0 error**                                                                                                               |
| `pnpm lint`                                                          | 0    | **0 error / 2 warning**（HEAD 既存基线，本单未新增、未顺手改）                                                            |
| `vitest run test/engine-core/boundary.spec.ts`                       | 0    | **12 passed / 12**                                                                                                        |
| `vitest run test/engine-core`                                        | 0    | **23 文件 / 461 例全绿**                                                                                                  |
| `pnpm test` 全量                                                     | 0    | **193 passed \| 1 skipped（194 文件）· 3248 passed \| 4 skipped（3252 例）**，vitest 73.01s，墙钟 76.0s —— 与基线逐字一致 |
| `git diff --stat HEAD -- src/engine-core`                            | 0    | **空输出**                                                                                                                |

登记 backlog 后我**在最终工作区状态把 6 项闸门全部复跑了一遍**（本轮只动 .md，`git diff --name-only HEAD -- '*.ts'` 与首跑逐字一致），数字与首跑一致。两处 lint warning 是 `test/e2e/knowledge-search.e2e-spec.ts` 与 `test/e2e/privacy-guard.e2e-spec.ts` 行首 `eslint-disable` 的 `prettier/prettier` 规则失效，`--no-cache` 可复现，两文件本单零改动 —— TD-5 记录里的「0 warning」是 `--cache` 造成的口径差，不是回归。

机器：Windows 11 Home China（10.0.26300）· Node v26.13.0 · pnpm 9.15.0 · PS 5.1.26100.9818 · 8 逻辑核 · 跑闸门时 node 进程 0 个。

## 三、与任务单的偏差（7 处）

| #   | 任务单口径                                                             | 现场实际                                                                                                                        | 处置                                                                              |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | §3.4「唯一生产 src 改动 = 端口类型」                                   | 端口放宽后旧链路 `VisitorTurnOptions.userId` 必填且真读 → 4 处 TS2345，必须再动 `voice.service.ts`                              | 追加**纯类型**收窄，生产侧共 2 文件                                               |
| 2   | §3.7「3 个 quality spec 复用」                                         | `quality-annotation-seed.spec.ts` 不构造实体行（行由生产造）                                                                    | 实际复用 2 处，seed spec 不动                                                     |
| 3   | 附录 A `character-baseline-seed-calibration.spec.ts:131` 的 `buildRow` | 该处函数名是 `buildDriftedRow`（行号一致）                                                                                      | 按真名复用                                                                        |
| 4   | §3.3「4 处局部 buildRow」                                              | 共享 builder 补 `baselineSafety` / `baselineBond` 后，wp9b 的 C.1「两数据源逐字一致」要求 `equivalentSeed` 必须镜像 DB 行这两列 | 按该用例自身注释原则补两行，**断言与被测行为不变**                                |
| 5   | §5 闸门 3「warning 基线如实记录」                                      | 任务单沿用 TD-5 的「0 warning」，但 HEAD 实测有 2 warning                                                                       | 记为**既存基线**，本单未新增、未顺手改                                            |
| 6   | §3.5「SafetyVerdict 路径**或**合法类别」                               | probe 不可能带咨询师类别，SafetyVerdict 路径在本用例不可达                                                                      | 取「合法类别」这一支，落点 `neutral`                                              |
| 7   | §6 索引回写「wp-list 新增 TD-6 行」                                    | §四 表头是 3 列，但 TD-5 / L-2 / G-4 三行是 5 列 —— 多出的列在 Markdown 渲染中被**丢弃**，TD-5 行的交付态在表里实际不可见       | TD-6 行按**表头 3 列**写，不复制这 3 行的缺陷；三行既有问题登记 backlog，本单不动 |

## 四、新发现并登记的 backlog（本单未顺手修）

复核中另发现 **3 条任务单未覆盖的契约漂移残留**，已登记到 `docs/worklog/pending/phase2.5-contract-drift-backlog-2026-11-13.md`（索引里作为 **TD-7** 📋 待开工）：

- **B-1** —— 3 处局部角色行 builder 未纳入共享 builder：`wp10a` / `wp49` / `wp51`（任务单 §3.3 的「4 处」只统计了命名为 `buildRow` / `buildDriftedRow` 的，这 3 处名为 `makeRow` 或内联构造）。仍带 `as CharacterProfileEntity` 断言、缺 semver 三列。**逐列核对行为零影响**（resolver 不读 semver 三列；`personalityTraits` 走 `== null` 同分支；`verbalVoice` 同为 falsy；`baselineSafety` / `baselineBond` 由内核 `DEFAULT_SAFETY=0.5` / `DEFAULT_BOND=0` 兜底），但断言**掩盖了类型检查**，实体再加列时会静默漂移。
- **B-2** —— wp-list §四 表格列数与表头不匹配（3 行超列，TD-5 行交付态在渲染中丢失）；附带：§四 引言写「现有 25 行」，HEAD 实测已是 33 行（本单加 TD-6 / TD-7 后 35 行），属早于本单的过期声明。
- **B-3** —— 2 处既存 lint warning，建议并入 WP-M 工具链债一单清掉。

## 五、改动面

**生产代码 2 文件**（仅 voice 层，非 core）：`src/voice/voice-turn-backend.port.ts`（端口放宽，纯类型）、`src/voice/voice.service.ts`（类型收窄，纯类型）。

**测试 13 spec + 2 个新 helper**：`test/engine-adapters/character-profile-fixtures.ts`、`test/quality/quality-annotation-fixtures.ts`（新增）；13 个 spec 改动。

**docs 5 文件**：交付记录（新增）、任务单（归档）、wp-list + README（索引回写，各加 TD-6 与 TD-7 行）、契约漂移 backlog（新增）。

`git diff --stat HEAD` = **17 files changed, +85 −136**；另有 6 个新增未跟踪文件。**`src/engine-core/**` 零 diff**。

## 六、交付物

- 交付记录：`docs/worklog/completed/phase2.5/td6-contract-evolution-review-implementation-2026-11-13.md`（9 章，含 7 处偏差表与闸门表）
- 任务单（已归档 ✅、DoD 6/6 全勾）：`docs/worklog/completed/phase2.5/td6-contract-evolution-review-task-2026-11-13.md`
- 索引回写：`phase2.5-wp-list-2026-11-08.md`（TD-6 / TD-7 行）、`phase2.5-README.md`（TD-6 / TD-7 行）
- 新建 backlog：`docs/worklog/pending/phase2.5-contract-drift-backlog-2026-11-13.md`

**断链复查**：5 个文档共 **192 条相对链接全部可达，零断链**；两个索引的 TD-6 / TD-7 行竖线数与各自表头一致（README 3 竖线 / wp-list 4 竖线），行尾闭合竖线齐全，无空单元格、无 `undefined` 残留。

## 七、commit 草稿（未提交，等你指令）

```
refactor(voice,test): TD-6 对齐七项契约演进观察项（TurnOptions.userId 放宽可选 + spec/夹具口径对齐，零运行时变化）
docs(worklog): TD-6 契约演进核对任务单 / 交付记录与索引回写
docs(worklog): 登记 TD-7 契约漂移 backlog（复核新发现 3 条，本单未顺手修）
```

建议分 3 个提交（一个提交一个意图，不跳 `--no-verify`）。**注意**：两个索引文件在**本单开工前就已是「已修改」**状态 —— 那是 TD-5 的索引回写尚未提交，docs 一组提交时会一并带上，非本单引入。

## 八、未做的事（留给你决定）

1. **未提交、未 push** —— 只给了草稿，等你手动提交。
2. **未动 3 处 `makeRow`**（B-1）与 3 个超列行（B-2）—— 任务单把范围锁死在 7 项，扩大改动面会违反「diff 名单逐条对照任务单范围」，故登记 backlog 留独立单。
3. **未顺手清 2 处 lint warning**（B-3）—— 不在本单范围。
4. **未申请 core 例外** —— #5 走 A 解决，engine-core 一行未动，`boundary.spec.ts` 未改。
5. **未改任何断言期望、mock 返回值、用例逻辑与数量** —— 全量 3252 例 / 194 文件，与基线逐字一致；唯一断言变化是 `wp63` 键数 3→4，这是任务单 §3.1 明确授权的项，用例标题已同步改为「四件套」。
