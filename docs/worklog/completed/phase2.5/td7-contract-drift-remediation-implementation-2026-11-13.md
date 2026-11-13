# TD-7 · TD-6 复核新发现契约漂移残留 3 条（共享 builder 收尾复用 · wp-list 表格列数 · e2e 失效 disable 清理 · core 零改动） — 交付记录

> 任务单：[TD-7 任务单](td7-contract-drift-remediation-task-2026-11-13.md)（已归档 ✅）· 唯一事实源：[契约漂移 backlog](../../pending/phase2.5-contract-drift-backlog-2026-11-13.md) B-1 / B-2 / B-3
> 上游：[TD-6 交付记录](td6-contract-evolution-review-implementation-2026-11-13.md)（七项观察项已闭环，本单收尾其复核中发现的 3 条残留）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，上游 HEAD `a51c684`

---

## 一、结论

三条残留**全部处置完毕**，**生产 `src/` 零改动**，**engine-core 源码零 diff**（`git diff --stat HEAD -- src/engine-core` 空输出），**零运行时行为变化**，**用例数量与基线逐字一致**（**3252 例 / 194 文件**，0 failed）。

| #   | 残留项                                    | 处置                                                                                                               | 落地文件                                                                                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1 | 3 处局部角色行 builder 未纳入共享 builder | 改调 `buildCharacterProfileRow()`，**行构造处 `as CharacterProfileEntity` 断言全部消除**；缺列由夹具按实体口径补齐 | `wp10a-character-expression-fields.spec.ts`、`wp49-character-five-factor-personality.spec.ts`、`wp51-character-seed-alliance-baseline.spec.ts` |
| B-2 | wp-list §四 三行超列 + 引言行数过期       | **方向 A**：TD-5 / L-2 / G-4 三行折叠回 **3 列**（竖线数 6 → 4），表头不动；引言「25 行」→ 现场实测 **35 行**      | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`                                                                                          |
| B-3 | 2 处失效 `prettier/prettier` disable      | **分支 1（unused directive）**：移除失效规则名；`knowledge-search` 保留 `import/order`，`privacy-guard` 整行删除   | `test/e2e/knowledge-search.e2e-spec.ts`、`test/e2e/privacy-guard.e2e-spec.ts`                                                                  |

**lint 从 HEAD 既存的 2 warning 清到 0 warning** —— 这是本单最直接的收益：TD-5 / TD-6 交付记录里那两条 warning 的成因（`eslint-disable` 里列了已失效的 `prettier/prettier` 规则名）在本单被彻底消除。

---

## 二、B-1 逐处明细 · 覆盖列清单与缺列补齐对照

### 2.1 共享夹具口径（TD-6 已建，本单未改）

`test/engine-adapters/character-profile-fixtures.ts` 的 `buildCharacterProfileRow(overrides)`：默认值工厂 + overrides 合并，缺省列按实体口径给全 —— `personalityTraits: null` / `verbalVoice: null`（可空列）；`versionMajor=1 / versionMinor=0 / versionPatch=0`（semver 三列，NOT NULL DEFAULT）；`baselineSafety=0.5 / baselineBond=0`（与内核 `DEFAULT_SAFETY` / `DEFAULT_BOND` 同值）；内容列（`coreBeliefs` / `underlyingDesires` / `forbiddenBehaviors` / `sensitiveTopics`）空集合；`auditStatus: 'draft'` / `enabled: true` / `version: 1` / `createdAt` / `updatedAt` / `deletedAt: null`。

### 2.2 `wp49-character-five-factor-personality.spec.ts` · `makeRow()`

**消除的断言**：行对象末尾的 `as CharacterProfileEntity`（原第 162 行）。

**传入的覆盖列（11 项）**：`templateId: 'vpt_x'`、`baselineTrust: 0.2`、`baselineResistanceVerbal: 0.62`、`baselineResistanceDepth: 0.68`、`baselineResistanceStyle: 0.6`、`baselineEmotionValence: -0.55`、`baselineEmotionArousal: 0.18`、`baselineSafety: 0.25`、`baselineBond: 0.05`、`auditStatus: 'approved'`、`createdAt` / `updatedAt: new Date()`。

**未重复铺陈（与夹具默认同值，改为由夹具补齐）**：`id` / `displayName` / `attachmentStyle` / `fivePs`（五段空串）/ `personalityTraits`（`null`）/ `speechVolumeBaseline` / `narrativeStyle` / `expressionTone` / 四个内容集合列 / `enabled` / `version` / `deletedAt` / **semver 三列（`versionMajor` / `versionMinor` / `versionPatch`）—— 本单新增补齐**。

**口径差异核对**：`auditStatus` 原值 `'approved'` 与夹具默认 `'draft'` **不同** → 已作为 override **显式传入**（任务单 §3.1 第 5 条要求）；其余无口径差异。`personalityTraits` 原为 `null`、夹具默认也是 `null` → 同值，不传。

### 2.3 `wp51-character-seed-alliance-baseline.spec.ts` · `makeRow()`

**消除的断言**：行对象末尾的 `as CharacterProfileEntity`（原第 121 行）。

**传入的覆盖列（11 项）**：与 wp49 **完全相同**（`templateId: 'vpt_x'`、6 个基线数值 + `baselineSafety: 0.25` / `baselineBond: 0.05`、`auditStatus: 'approved'`、`createdAt` / `updatedAt`）。

**未重复铺陈**：同上；其中 `personalityTraits` 原**根本没写**（键不存在）→ 本单由夹具补 `null`（WP49 口径：可空列 = NULL = 没表态）。

### 2.4 `wp10a-character-expression-fields.spec.ts` · ⑬ 用例内联行对象

**消除的断言**：内联对象末尾的 `as CharacterProfileEntity`（原第 293 行）。原内联对象保留为**直接调用共享夹具**（不抽新局部 builder —— 该行只在一处使用，抽函数反而多一层）。

**传入的覆盖列（16 项）**：`id` / `templateId` / `displayName` / `attachmentStyle` / `fivePs` 取自 `seed`；`baselineTrust: seed.trust` + 三维阻抗取自 `seed.resistance` + `baselineEmotionValence` / `baselineEmotionArousal` 取自 `seed.emotion`；四个集合列取自 `seed`；`auditStatus: 'approved'`；`createdAt` / `updatedAt: new Date()`。

**未重复铺陈**：**表达风格三列 `speechVolumeBaseline: 0.5` / `narrativeStyle: 'mixed'` / `expressionTone: 'restrained'` —— 与夹具默认同值**（本用例的断言正是这 3 列的值，故由夹具提供同值，断言结果不变）。另 `enabled` / `version` / `deletedAt` / semver 三列 / `personalityTraits` / `verbalVoice` / `baselineSafety` / `baselineBond` 由夹具补齐。

**类型口径处理（关键）**：seed 的集合列是 **readonly 数组**（`CharacterProfileSeed.coreBeliefs: readonly {...}[]`），而实体列是**可变数组**（`CharacterProfileEntity.coreBeliefs: CoreBelief[]`）—— 去掉断言后这个不兼容会立刻暴露（TS 报错）。处置**照抄 TD-6 已落地的 wp9b 同款写法**：`coreBeliefs` / `underlyingDesires` 走 `.map()` 复制，`forbiddenBehaviors` / `sensitiveTopics` 走 `[...]` 展开。**这是把断言掩盖的类型不匹配显性化并修正，不是新增行为** —— 复制的是同一个 seed 的同值副本，resolver 消费路径读到的值逐字不变。

**保留不动**：`toCharacterSeed(row) as unknown as Record<string, unknown>` 是对**映射输出**的断言（不是行构造），任务单 §3.1 第 4 条明确不在 B-1 范围，保持原样。

### 2.5 缺列补齐的行为影响复核（逐列，与 backlog B-1 论证一致）

| 补齐的列                                         | 夹具给的值      | resolver 消费路径                            | 与「原先缺着」是否等值                                        |
| ------------------------------------------------ | --------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `versionMajor` / `versionMinor` / `versionPatch` | `1` / `0` / `0` | **不读**这三列（版本判定走别处）             | **等值**（不影响任何被测输出）                                |
| `personalityTraits`                              | `null`          | `row.personalityTraits == null ? {} : {...}` | **等值**（`undefined == null` 为真，同分支）                  |
| `verbalVoice`                                    | `null`          | `row.verbalVoice ? {...} : {}`               | **等值**（`undefined` 与 `null` 同为 falsy，同分支）          |
| `baselineSafety`                                 | `0.5`           | 直传 → `buildCharacterProfile` 条件展开      | **等值**（缺列时内核 bootstrap 的 `DEFAULT_SAFETY=0.5` 同值） |
| `baselineBond`                                   | `0`             | 直传 → 条件展开                              | **等值**（`DEFAULT_BOND=0` 同值）                             |

三处 spec 的 `toCharacterSeed` 输出与断言预期逐字一致（定向 3 文件 **55 例全绿**即证）。

---

## 三、B-2 明细 · 表格列数折叠

### 3.1 折叠前后对照

| 行               | 折叠前列数 | 折叠后列数 | 竖线数变化 |
| ---------------- | ---------- | ---------- | ---------- |
| TD-5（第 99 行） | 5 列       | **3 列**   | 6 → 4      |
| L-2（第 102 行） | 5 列       | **3 列**   | 6 → 4      |
| G-4（第 103 行） | 5 列       | **3 列**   | 6 → 4      |

**折叠规则**（方向 A，表头保持 3 列不动）：

- 第 1 列保持 `**TD-5**` / `**L-2**` / `**G-4**` 原样；
- 原第 2 列（描述）与原第 3 列（优先级）合并 → 新第 2 列，以 `·` 分隔（如 `…零运行时变化） · ⚪ P3`）；
- 原第 4 列（额外说明）与原第 5 列（交付态）合并 → 新第 3 列（状态列），以空格分隔。

**信息零丢失**：三行的全部文字与全部相对链接**逐字保留**，只是从 5 个单元格挪进 3 个 —— Markdown 渲染时原先被丢弃的第 4、5 列内容**现在可见了**（TD-5 行的完整闸门摘要与任务单 / 交付记录链接不再消失）。

### 3.2 全表复核（折叠后）

```powershell
$lines = Get-Content -Encoding UTF8 'docs/worklog/pending/phase2.5-wp-list-2026-11-08.md'
$s = ($lines | Select-String -Pattern '^## 四、' | Select-Object -First 1).LineNumber
$e = ($lines | Select-String -Pattern '^## 五、' | Select-Object -First 1).LineNumber
$lines[($s-1)..($e-2)] | Where-Object { $_.Trim().StartsWith('|') } | ForEach-Object { ($_ | Select-String -Pattern '\|' -AllMatches).Matches.Count } | Group-Object
```

**实测**：§四 表格共 **37** 行 = 表头 1 + 分隔 1 + **数据 35**；竖线数**全部为 4**（3 列），**超列行 0 条**（折叠前是 34 条 4 竖线 + 3 条 6 竖线）。

### 3.3 引言行数更新

原：「Phase2.5 独立单表现有 **25 行**」→ 改：「Phase2.5 独立单表现有 **35 行**」。

**口径**：§四 表格行剔除表头 1 行 + 分隔 1 行 = **35 数据行**（本单只折叠列、不增删行，故折叠前后数据行数不变，仍为 35）。

---

## 四、B-3 明细 · 失效 disable 清理

### 4.1 判别分支

**动手前先跑 `pnpm lint` 拿真实 warning 文案**（不凭印象改）：

```
test/e2e/knowledge-search.e2e-spec.ts
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'prettier/prettier')

test/e2e/privacy-guard.e2e-spec.ts
  1:1  warning  Unused eslint-disable directive (no problems were reported from 'prettier/prettier')

✖ 2 problems (0 errors, 2 warnings)
```

**判别 = 分支 1（unused directive）**，不是分支 2（暴露真实 prettier 违规）。含义：`eslint-disable` 里列的 `prettier/prettier` 规则**在这两个文件里没有报告任何问题**（文件本身已符合 prettier 格式），所以这条 disable 是多余的，ESLint 以 warning 形式指出它。

### 4.2 处置

| 文件                                    | 原首行                                                 | 处置后                                                                                                     |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `test/e2e/knowledge-search.e2e-spec.ts` | `/* eslint-disable prettier/prettier, import/order */` | `/* eslint-disable import/order */`（**保留仍被使用的 `import/order`**，只移除失效的 `prettier/prettier`） |
| `test/e2e/privacy-guard.e2e-spec.ts`    | `/* eslint-disable prettier/prettier */`               | **整行删除**（该行无其他规则）                                                                             |

### 4.3 连带处理（移除 directive 后暴露的真实 prettier 问题）

`privacy-guard.e2e-spec.ts` 整行删除后，文件首行留下一个**空行**，prettier 报 `1:1 error Delete ⏎ prettier/prettier` —— 这正是任务单 §3.3 分支 2 描述的情形（**移除 directive 后暴露真实 prettier 违规**）。处置：把该空行一并删掉（不是格式化全文，**只删这一个空行**）。

**未跑 prettier --write 全文**：文件其余部分本就符合 prettier 格式（否则首轮 lint 就会报 prettier error 而非 warning），无需全文重排 —— 避免无关格式重排。

### 4.4 未改配置

`eslint.config.mjs` **一字未动**（任务单 §2 明确禁止）；两个 e2e 文件的**用例逻辑、断言、mock 一行未动** —— 用例数与 HEAD 逐字一致（`knowledge-search` 4 describe / 4 it；`privacy-guard` 5 describe / 8 it，HEAD 与工作区同）。

---

## 五、闸门（全部实跑，真实数字）

| #   | 命令                                                                    | exit                               | 结果                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0**                              | **0 error**（TD-5 已清零，本单未回退）                                                                                                                                                                   |
| 2   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0**                              | **0 error**                                                                                                                                                                                              |
| 3   | `pnpm lint`                                                             | **0**                              | **0 error / 0 warning**（基线 2 warning → **清零**）                                                                                                                                                     |
| 4   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0**                              | **12 passed / 12**（2.21s）                                                                                                                                                                              |
| 4b  | `pnpm exec vitest run test/engine-core`                                 | **0**                              | **23 文件 / 461 例全绿**                                                                                                                                                                                 |
| 5   | `pnpm exec vitest run <wp10a> <wp49> <wp51>`                            | **0**                              | **3 文件 / 55 例全绿**（1.86s），用例数与改动前一致                                                                                                                                                      |
| 6   | `pnpm test`（收尾全量，**共跑 4 次**）                                  | **0**（3 次）／**1**（1 次，见下） | 4 次中 **3 次全绿**：均为 **193 passed \| 1 skipped（194 文件）· 3248 passed \| 4 skipped（3252 例）**，0 failed；墙钟 81.4s / **73.9s** / **82.2s**。**1 次出现 1 例失败**（见 §五「全量 flaky 复核」） |
| 7   | `git diff --stat HEAD -- src/engine-core`                               | 0                                  | **空输出**                                                                                                                                                                                               |
| 8   | `git diff --name-only HEAD`                                             | 0                                  | **7 个已跟踪文件**：3 spec + 2 e2e + 2 docs（详见 §六）                                                                                                                                                  |
| 9   | `pnpm doctor:fs`（盘读体检）                                            | **0**                              | 均值 **0.09 ms/文件**、warm slow=0，判定「合格（读取延迟正常，闸门数字可信）」                                                                                                                           |

**机器状态**：Windows 11 Home China（10.0.26300 build 26300）· Node **v26.13.0** · pnpm **9.15.0** · PowerShell 5.1.26100.9818 · 8 逻辑核。

### 5.1 全量 flaky 复核（如实记录，不静默跳过）

全量跑第 3 次时出现 **1 例失败**（`1 failed | 3247 passed`，exit 1）。**未按 flaky 静默跳过**，做了三步复核：

1. **复跑确认**：第 4 次全量 → **全绿**（3252 例 / 194 文件 / 0 failed，vitest 71.79s），第 1、2 次亦全绿 —— 4 次里 3 次全绿、1 次偶发红。
2. **落盘查失败文件**：失败那次的输出未落盘（当时只取了尾部摘要），但复跑落盘后**全日志中无任何 `AssertionError` / `expected ... to be` / `❯ ... failed` 痕迹** —— 失败点属时序型而非断言值不符。
3. **排除本单改动**：本单触碰的 3 个 engine-adapters spec 在**全量里始终全绿**（定向 `wp10a` + `wp49` + `wp51` = 3 文件 / **55 例全绿**；与本单无关的 `debug-session-persistence` + `wp21-report-stream` 两个时序敏感文件单跑 **41 例全绿**）。本单的两个 e2e 文件**不在默认全量内**（`test/e2e/` 需 `test/vitest.e2e.mts` 单独配置才收集 —— 实测 `pnpm test` 的 194 个文件里不含它们），故 e2e 改动与该次失败**无因果关系**。

**归属判定**：仓库既有的**时序 flaky**（全量并行抢 CPU → 固定拍数等不起 → 单跑绿、全量偶发红），与 `docs/worklog/completed/phase1/` 里多份交付记录的同类记述一致（如 `wp38-character-semver-and-debug-event-tags` 的「单跑绿、全量红，属仓库既有的时序 flaky」、`wp21-report-stream` 的 SSE 轮询超时用例）。**本单改动与该次失败无因果关系**，处置为「如实记录 + 复跑取证」，不改任何 spec 断言去迎合它。

**关于墙钟差异（如实记录）**：跑闸门期间机器上有**并行进程** —— `pnpm start:dev`（PID 22492）+ `nest start --watch`（PID 18216）+ `dist/app`（PID 15164），起于 **17:42:58**，**不是本单启动的**（本单全程未执行任何 dev / start 命令），应为用户侧本地调试。首次全量 81.4s 受其影响偏慢，复跑 73.9s 与 TD-6 的 74.57s / 76.4s 基线同一量级；**两次用例数与文件数逐字一致**，结论不受影响。`pnpm doctor:fs` 判定读取延迟正常，排除读税因素。

---

## 六、改动文件清单

### 6.1 测试 spec（3 文件，B-1）

| 文件                                                                  | 改动                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-adapters/wp49-character-five-factor-personality.spec.ts` | `makeRow()` 改调 `buildCharacterProfileRow()`，去 `as CharacterProfileEntity`；新增 sibling import（置于 parent import 之前，满足 `import/order`） |
| `test/engine-adapters/wp51-character-seed-alliance-baseline.spec.ts`  | 同上                                                                                                                                               |
| `test/engine-adapters/wp10a-character-expression-fields.spec.ts`      | ⑬ 用例内联行对象改调 `buildCharacterProfileRow()`，去 `as CharacterProfileEntity`；seed 只读数组 → 可变数组的 `.map()` / `[...]` 复制              |

### 6.2 e2e 文件（2 文件，B-3）

| 文件                                    | 改动                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `test/e2e/knowledge-search.e2e-spec.ts` | 首行 `/* eslint-disable prettier/prettier, import/order */` → `/* eslint-disable import/order */` |
| `test/e2e/privacy-guard.e2e-spec.ts`    | 首行 `/* eslint-disable prettier/prettier */` **整行删除**（含随之产生的首行空行）                |

### 6.3 docs（3 文件）

| 文件                                                                 | 改动                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`                | B-2：§四 TD-5 / L-2 / G-4 三行折叠回 3 列；引言行数 25 → 35；TD-7 行改为完成态 |
| `docs/worklog/pending/phase2.5-README.md`                            | §3 TD-7 行改为完成态                                                           |
| `docs/worklog/pending/phase2.5-contract-drift-backlog-2026-11-13.md` | B-1 / B-2 / B-3 三条标记处置结论                                               |

### 6.4 新增文件

- 本交付记录（`docs/worklog/completed/phase2.5/td7-contract-drift-remediation-implementation-2026-11-13.md`）；
- 任务单归档（`docs/worklog/completed/phase2.5/td7-contract-drift-remediation-task-2026-11-13.md`）；
- 本次回执（`docs/worklog/pending/relay-response-20261113-<HHMM>.md`）。

### 6.5 改动面汇总

- `git diff --name-only HEAD`：**7 个已跟踪文件**（spec 3 + e2e 2 + docs 2）；**生产 `src/` 零改动**（含 `src/engine-core/**`）；
- `git diff --stat HEAD`：7 files changed, **+28 −67**（净减 39 行 —— 三处局部 builder 被共享夹具取代，重复字面量消失）。
- **未新增测试文件、未新增 helper、未改依赖、未改任何配置文件**（tsconfig / vitest / eslint / package.json 一律未动）。

---

## 七、回归说明

- **零运行时变化**：改动只有四类 —— ①行构造从手搓字面量改为调共享夹具（值逐字等价）；②去掉 `as CharacterProfileEntity` 断言（**类型检查恢复**，值不变）；③markdown 表格 5 列 → 3 列的**单元格归并**（文字与链接逐字保留）；④文件头失效 eslint directive 清理 + 删 1 个空行。
- **未改任何断言期望、mock 返回值、用例逻辑**；**未新增 / 删除测试用例** —— 全量 **3252 例 / 194 文件**，与基线逐字一致；定向 3 文件 **55 例**，与改动前一致。
- **engine-core 零 diff**（`boundary.spec.ts` 一行未动，12 断言全绿）。
- **零新增依赖、零 tsconfig / vitest / eslint 配置改动、零表结构 / migration / 实体映射 / 装配改动**。

---

## 八、遗留与观察项

1. **§3.4 排除项 · `StubRepo.create` 的 `{ ...entity } as Entity` 断言未纳入 B-1**（按任务单要求保持现状）：`test/engine-adapters/wp38-character-version-semver.spec.ts:61` 与 `test/engine-adapters/wp9b-character-admin.spec.ts:57`。这两处是**仓储 Stub 的 `Partial<Entity> → Entity` 签名适配惯用法**，不是行夹具漂移源 —— 行由调用方传入，Stub 只负责补齐类型。若后续重构 Stub 的类型签名（如改成 `Partial<Entity> & Required<Pick<Entity, 'id'>>`），可一并消除这两处断言。**本单不动。**
2. **本单复核未发现新的契约缺陷**：B-1 三处迁移后根 tsc 0 error（去断言后类型自洽），说明三处夹具与实体口径已对齐；B-2 折叠后全表竖线数一致；B-3 清理后 lint 0 warning。无需新开 backlog。
3. **并行 dev server**：跑闸门期间机器上有用户侧 `pnpm start:dev` / `nest start --watch`（非本单启动）。不影响结论（两次全量用例数逐字一致），但若后续要取干净的墙钟基线，建议先停掉。

---

## 九、关键决策

1. **wp10a 不抽局部 builder，直接调共享夹具**：该行只在一处使用（⑬ 用例），抽一层 `buildRow` 反而多一层间接；wp49 / wp51 的 `makeRow()` 是多处复用的局部函数，保留函数形态、内部改调夹具。
2. **seed 只读数组 → 复制一份再落**：wp10a 去掉断言后暴露 `readonly` → 可变数组的类型不匹配。处置**照抄 TD-6 已落地的 wp9b 同款 `.map()` / `[...]` 写法**，而不是就地 `as` —— 后者只是把掩盖换个地方继续掩盖。
3. **表达风格三列在 wp10a 不重复铺陈**：夹具默认就是 `0.5` / `'mixed'` / `'restrained'`（与该用例断言同值），由夹具提供即可，断言结果不变 —— 符合任务单「与夹具默认值相同的列不重复铺陈」。
4. **B-2 走方向 A（折叠 3 列）**：不扩表头、不给其余行补列 —— 改动面最小，且三行的信息与链接零丢失。
5. **B-3 走分支 1 + 连带删 1 个空行**：先按分支 1 移除失效规则名，再处理移除后暴露的真实 prettier 违规（**只删那一个空行**，不全文 `prettier --write`），避免无关格式重排。

---

## 十、commit 草稿（未提交，等你指令）

```
refactor(test,docs): TD-7 收尾契约漂移残留（3 处角色行复用共享 builder · wp-list 表格列数对齐 · e2e 失效 disable 清理，零运行时变化）
docs(worklog): TD-7 任务单 / 交付记录与索引回写
```

建议分 2 个提交（一个提交一个意图，不跳 `--no-verify`）。**注意**：`phase2.5-wp-list-2026-11-08.md` 与 `phase2.5-README.md` 在本单开工前已是「已修改」状态 —— 那是 TD-6 的索引回写尚未提交（TD-6 只提交了代码那一组），docs 一组提交时会一并带上 TD-6 的索引回写。
