# AF-602 · 删除已有 glyph 替代的 8 个旧 emoji 字段（AF-601 重签发）

> 任务：AF-602｜状态：完成｜日期：2026-11-28
> 分支：task/AF-602-icon-emoji-field-removal
> 基线：3e09857652efda56e728400b1ac9fe6ce4107b4c（AF-599 squash 合并后的 integrate）
> 前序：AF-596 / AF-597 / AF-598 / AF-599；AF-600 与 AF-601 同内容均被归档 rejected（前者 GUI 投递租约过期，后者回执漏声明重命名测试文件）

## 1. 本次做了什么

把 AF-599 已标记 `deprecated` 的 8 个旧 emoji 字段从 DTO 定义、provider 赋值与 HTTP 响应中整体移除，图标契约收敛为单一 glyph 事实源。

### 1.1 DTO 删除

| DTO | 删除字段 | 保留字段 |
| --- | --- | --- |
| `SupportCompanionDto` | `avatarEmoji` | `avatarGlyph` |
| `MicroInterventionScenarioDto` | `icon` | `glyph` |
| `CompanionPersonStatusDto` | `avatarEmoji` | `avatarGlyph` |
| `ToolboxItemDto` | `emoji` | `glyph` |
| `SwitchAccompaniedPersonResponseDto` | `avatarEmoji` | `avatarGlyph` |
| `CompanionHomeOverviewDto` | `avatarEmoji` | `avatarGlyph` |
| `GuideCourseDto` | `coverEmoji` | `coverGlyph` |
| `CounselorTrainingCategoryDto` | `emoji` | `glyph` |

### 1.2 Provider 删除

- `home-overview.service.ts`：`avatarForPermission` 由返回 `{ avatarEmoji, avatarGlyph }` 改为直接返回 `IconGlyph`，companion 只赋 `avatarGlyph`。
- `home-companion.service.ts`：删除 `avatarEmoji` 变量与状态卡 / 被陪伴者 / 切换响应的 3 处赋值；`defaultToolbox()` 删除 5 项 `emoji`。
- `home-micro-intervention-scenario.service.ts`：`toDto` 不再输出 `icon`，glyph 仍由数据库 `row.icon` 经白名单映射推导，未知 icon 仍返回 `null`。
- `guide.service.ts`：删除 12 门课程的 `coverEmoji` 赋值，`coverGlyph` 保留。
- `counselor-home.service.ts`：删除 4 个训练分类的 `emoji` 赋值，`glyph` 保留。

### 1.3 测试改写

- `git mv test/home/af599-icon-glyph-http-contract.spec.ts test/home/af600-icon-field-removal.spec.ts`，断言方向由「新旧并存」翻转为「旧字段缺席、新 glyph 在场」，并断言 OpenAPI 中 8 个旧属性完全消失。
- `test/home/af596-icon-glyph-contract.spec.ts` 同步改写：服务层断言旧字段 `not.toHaveProperty(...)`；微干预不再断言 `row.icon`。

### 1.4 明确不删

- `GuideCategoryDto.emoji`（指南分区入口，无 glyph 替代）
- `DualPracticeItemDto.emoji`（双人练习卡，无 glyph 替代；`home-companion.service.ts` 内部 `dualPracticeLibrary` 的 `emoji` 供其映射，保留）
- `DailyCompanionTipDto.icon`（Material 图标名，非 emoji 字段）

## 2. 改动文件

修改：

- `src/home/dto/home-overview.dto.ts`
- `src/home/dto/home-companion-overview.dto.ts`
- `src/guide/dto/guide.dto.ts`
- `src/counselor/dto/counselor-home.dto.ts`
- `src/home/providers/home-overview.service.ts`
- `src/home/providers/home-companion.service.ts`
- `src/home/providers/home-micro-intervention-scenario.service.ts`
- `src/guide/providers/guide.service.ts`
- `src/counselor/providers/counselor-home.service.ts`
- `test/home/af596-icon-glyph-contract.spec.ts`

重命名：

- `test/home/af599-icon-glyph-http-contract.spec.ts` → `test/home/af600-icon-field-removal.spec.ts`

新增：

- `docs/worklog/completed/phase2.5/af602-icon-emoji-field-removal-2026-11-28.md`

## 3. 闸门证据

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/home/af600-icon-field-removal.spec.ts test/home/af596-icon-glyph-contract.spec.ts` | 2 files / 15 tests passed / 0 failed；14.45s |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test`（全量收尾） | 370 files passed / 1 skipped；5222 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空，engine-core 零 diff |

环境：DESKTOP-E3EVQ9P / Windows / PowerShell 7.6.4 / node v22.23.2 / pnpm 9.15.0。

## 4. 范围核对

改动全部落在任务单 scope 内：4 个 DTO、5 个 provider、2 个测试文件（1 改 1 重命名）、1 份交付记录与状态面。未触碰前端仓库、数据库结构、`src/engine-core`，未改动 `GuideCategoryDto.emoji`、`DualPracticeItemDto.emoji`、`DailyCompanionTipDto.icon`。

## 5. 契约检查

- taskId：AF-602 贯穿任务单、分支、交付记录、回执与提交 trailer。
- 状态写入：登记 / 提级 / 领单 / 验收 / 归档只经 CLI，未手改状态面。
- 索引 schema：任务单 frontmatter 通过 validate，回执六组字段齐全。
- 字段删除：8 个旧字段全部移除，未留空占位或 undefined 序列化。
- 受保护字段：3 个无 glyph 替代的字段按任务单保留。
- 依赖与边界：无新依赖、无 migration、无表结构变更，engine-core 零 diff。

## 6. 遗留项

- AF602-B1：本单为 breaking change；若线上仍有旧版 App 读取 `avatarEmoji / coverEmoji / emoji / icon`，需要 revert 本提交或推进 API 版本化。
- AF602-B2：AF-599 归档回执仍引用旧测试文件名，该文件已重命名为 af600 文件；按历史记录不回改。
- AF602-B3：AF-600 / AF-601 因流程原因被归档 rejected，本单为同内容重签发，历史记录包保留审计链路。
- AF602-B4：前端 XS-142 已切 glyph 优先，7 处读点仍需与真实响应联调验证一次。

## 7. 偏差表

| 任务单原文 | 实际执行 | 处理 | 原因 |
| --- | --- | --- | --- |
| 任务单 gates 列三条 | 额外跑 `pnpm test` 全量与 `git diff --stat HEAD -- src/engine-core` | 保留并登记 | 全量测试按收尾一次口径执行；engine-core 是框架边界红线 |
| 删除 `af599-icon-glyph-http-contract.spec.ts` | 以 `git mv` 重命名为 `af600-icon-field-removal.spec.ts` 并翻转断言 | 保留并登记 | 保留四端点覆盖，避免重复维护两套 HTTP 契约测试 |
| AF-600 承接本单内容 | AF-600 / AF-601 均归档 rejected，改由 AF-602 重签发 | 保留并登记 | 已归档任务不得返修；代码与测试沿用同一份落盘结果 |

## 8. 验收结论

8 个旧字段已从 DTO、provider、四条真实端点的 HTTP 响应与 OpenAPI 中彻底移除，glyph 成为唯一图标事实源；3 个无 glyph 替代的字段按任务单保留；定向 15 例、typecheck、lint、全量 5222 例全部通过，engine-core 零 diff。机读护栏通过，验收结论为 passed。
