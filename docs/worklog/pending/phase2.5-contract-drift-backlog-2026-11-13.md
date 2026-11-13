# Phase2.5 · 契约漂移 backlog（TD-6 复核登记 · 2026-11-13）

> 登记来源：[TD-6 任务单](../completed/phase2.5/td6-contract-evolution-review-task-2026-11-13.md) · [TD-6 交付记录](../completed/phase2.5/td6-contract-evolution-review-implementation-2026-11-13.md)。
> 登记原则：**本单不顺手修** —— TD-6 任务单 §2 约束 2 已把范围锁死（spec 对齐生产现状，不反向改生产）、§3 逐项给定 7 项；以下三条是复核取证到的、**任务单未覆盖**的残留项，留待独立单处置。
> 状态：**📋 待开工**（3 条）；每条均已给出可复跑的取证证据。

| #       | 残留项                                        | 位置                                                                                                                                                                             | 性质                                                         | 影响                                                                                                                                  | 建议处置                                                                                                  |
| ------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **B-1** | 3 处局部角色行 builder 未纳入共享 row builder | `test/engine-adapters/wp10a-character-expression-fields.spec.ts:293` / `wp49-character-five-factor-personality.spec.ts:125` / `wp51-character-seed-alliance-baseline.spec.ts:86` | 夹具形状漂移（`as CharacterProfileEntity` 断言掩盖类型检查） | 行为零影响（逐列核对见下），但实体再加列时这 3 处会再次漂移                                                                           | 改复用 `test/engine-adapters/character-profile-fixtures.ts` 的 `buildCharacterProfileRow()`，去 `as` 断言 |
| **B-2** | wp-list §四 表格 4 行列数与表头不符           | `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 第 99 / 101 / 102 行（TD-5 / L-2 / G-4）                                                                                   | 文档渲染缺陷                                                 | 多出的第 4、5 列（说明 / 交付态）在 Markdown 渲染中**被丢弃** —— TD-5 行在表里只剩「TD-5 / 一句话描述 / ⚪ P3」，**交付态完全不可见** | 二选一：把 3 行统一改成 3 列（信息并入前两列），或把表头扩成 5 列并同步全部 32 行                         |
| **B-3** | 2 处既有 lint warning                         | `test/e2e/knowledge-search.e2e-spec.ts` / `test/e2e/privacy-guard.e2e-spec.ts` 行首 `eslint-disable`                                                                             | 工具链债                                                     | `pnpm lint` 从 TD-5 记录的口径「0 warning」变为 **2 warning**（TD-5 用的是 `--cache`，是口径差不是回归）                              | 归入 [WP-M 工具链技术债清单](phase2.5-toolchain-tech-debt-2026-11-11.md) 一并清                           |

---

## B-1 详述 · 3 处局部角色行 builder

TD-6 #3 已把 4 处局部 `buildRow` 收敛到共享 builder `buildCharacterProfileRow()`（`test/engine-adapters/character-profile-fixtures.ts`）。但任务单 §3.3 的「4 处」只统计了**命名为 `buildRow` / `buildDriftedRow`** 的局部 builder，另有 3 处命名为 `makeRow` 或内联构造，**未进清单**：

| 文件                                                 | 局部构造                                  | 缺失列（相对实体口径）                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `wp10a-character-expression-fields.spec.ts:293`      | 内联对象 + `as CharacterProfileEntity`    | `versionMajor` / `versionMinor` / `versionPatch` / `personalityTraits` / `verbalVoice` / `baselineSafety` / `baselineBond` |
| `wp49-character-five-factor-personality.spec.ts:125` | `makeRow()` + `as CharacterProfileEntity` | `versionMajor` / `versionMinor` / `versionPatch` / `verbalVoice`                                                           |
| `wp51-character-seed-alliance-baseline.spec.ts:86`   | `makeRow()` + `as CharacterProfileEntity` | `versionMajor` / `versionMinor` / `versionPatch` / `personalityTraits` / `verbalVoice`                                     |

**行为影响逐列核对结论 = 零影响**（本单只读复核，未改这三个文件）：

- `versionMajor/Minor/Patch` —— resolver **不读**这三列（`db-character-profile.resolver.ts`），版本判定走别处，缺列不改变任何被测输出；
- `personalityTraits` —— resolver 走 `row.personalityTraits == null ? {} : {...}`，`undefined == null` 为真 → 与显式 `null` **同分支**；
- `verbalVoice` —— resolver 走 `row.verbalVoice ? {...} : {}`，`undefined` 与 `null` 同为 falsy → **同分支**；
- `baselineSafety` / `baselineBond`（仅 wp10a 缺）—— resolver 直传 → `buildCharacterProfile` 条件展开，缺列时由内核 bootstrap 的 `DEFAULT_SAFETY=0.5` / `DEFAULT_BOND=0` 兜底；wp10a 的断言只覆盖表达字段（`speechVolumeBaseline` / `narrativeStyle` / `expressionTone`）映射，不触及这两列。

**为什么仍要登记**：这 3 处的 `as CharacterProfileEntity` 断言**掩盖了类型检查** —— 实体再加列时它们不会报错，只会静默漂移（这正是 TD-6 #3 要消灭的漂移源）。TD-6 不动它们，是因为任务单把范围锁在 4 处；扩大改动面会违反「diff 名单逐条对照任务单范围」。

## B-2 详述 · wp-list §四 表格列数

§四 表格的表头与分隔行是 **3 列**（`独立单 / 一句话描述 / 状态`），但第 99 行（TD-5）、第 101 行（L-2）、第 102 行（G-4）是 **5 列**（多出「优先级」「说明」「交付态」两列）。

Markdown 表格的列数由表头决定，数据行多出的单元格在渲染时被**丢弃**。因此这 3 行在表里实际只显示前 3 列 —— 其中 **TD-5 行的完整交付态（那一长串闸门数字与任务单 / 交付记录链接）完全不可见**，只剩「TD-5 / 一句话描述 / ⚪ P3」。

取证命令（PowerShell）：

```powershell
$p = 'docs/worklog/pending/phase2.5-wp-list-2026-11-08.md'
Get-Content -Encoding UTF8 $p | Select-Object -Skip 65 -First 40 | ForEach-Object { if ($_ -match '^\|') { ($_ | Select-String -Pattern '\|' -AllMatches).Matches.Count } }
```

预期输出：绝大多数行 `4`（3 列），第 99 / 101 / 102 行 `6`（5 列）。

本单实测（HEAD `32493f0`，TD-6 行改 3 列后）：§四 共 **37** 个表格行 = 表头 1 + 分隔 1 + **数据 35**；其中竖线数 `6` 的仍有 **3** 行（第 99 / 101 / 102 行：TD-5 / L-2 / G-4），竖线数 `4` 的 **32** 行（含本单的 TD-6 与 TD-7 两行）。

**TD-6 的处置**：本单新加的 TD-6 行**按表头 3 列写**（不复制这 3 行的缺陷），因此 TD-6 行与 TD-5 行的竖线数不同（3 列 vs 5 列）—— 这是**有意为之**，记录在交付记录 §三 偏差 7。

**附带发现（同一小节，一并登记）**：§四 引言写「Phase2.5 独立单表现有 **25 行**」，但 HEAD `32493f0` 实测该表**数据行已是 33 行**（含本单加的 TD-6 / TD-7 两行后为 **35 行**）—— 这是**早于本单的过期声明**，本单**未顺手改**（改它就属于扩大范围）。建议在处理 B-2 的列数问题时一并把行数声明改成实测值。

## B-3 详述 · 2 处既有 lint warning

`pnpm lint` 实测 **0 error / 2 warning**，`--no-cache` 可复现，两处均在 `test/e2e/` 且**本单零改动**：

```
test/e2e/knowledge-search.e2e-spec.ts
test/e2e/privacy-guard.e2e-spec.ts
```

成因：两文件行首 `eslint-disable` 注释里列的 `prettier/prettier` 规则已失效（规则名变更 / 已不适用），于是该行被抑制的 prettier 格式问题不再被抑制，转而以 warning 形式报出。

**与 TD-5 记录口径差的说明**：TD-5 交付记录写「lint **0 error 0 warning**」，那是 `--cache` 造成的**口径差**（缓存命中时未重新计算这两文件），**不是回归** —— HEAD `32493f0` 实测即 2 warning。

---

_登记于 2026-11-13（TD-6 契约演进核对单收尾）；三条均未在 TD-6 内修改。_
