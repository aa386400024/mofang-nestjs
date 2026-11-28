# AF-601 · 删除已有 glyph 替代的 8 个旧 emoji 字段（AF-600 重签发）

> 任务：AF-601｜状态：完成｜日期：2026-11-28
> 分支：task/AF-601-icon-emoji-field-removal
> 基线：3e09857652efda56e728400b1ac9fe6ce4107b4c（AF-599 squash 合并后的 integrate）
> 前序：AF-596 / AF-597 / AF-598 / AF-599；AF-600 同内容因 GUI 投递租约过期被归档为 rejected

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

- `docs/worklog/completed/phase2.5/af601-icon-emoji-field-removal-2026-11-28.md`

## 3. 闸门证据

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/home/af600-icon-field-removal.spec.ts test/home/af596-icon-glyph-contract.spec.ts` | 2 files / 15 tests passed / 0 failed；14.45s |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test`（全量收尾） | 370 files passed / 1 skipped；5222 tests passed / 4 skipped |
| `git diff --stat HEAD -- src/engine-core` | 空，engine-core 零 diff |

环境：DESKTOP-E3EVQ9P / Windows / PowerShell 7.6.4 / node v22.23.2 / pnpm 9.15.0。

## 4. 兼容风险与回滚

本单是 breaking change：仍在读取 `avatarEmoji / coverEmoji / emoji / icon` 的旧客户端会读到 `undefined`。

- 前端 `xin_su_app` 已由 XS-142 切换为 glyph 优先、旧 emoji 兜底；后端不再下发旧字段后走 glyph 分支，正常路径不受影响。
- 若线上仍存在旧版安装包并依赖旧字段，回滚方式为 revert 本提交；长期方案为 API 版本化，不在本单补兼容层。
- `GuideCategoryDto.emoji`、`DualPracticeItemDto.emoji`、`DailyCompanionTipDto.icon` 未动，这三处旧读点仍可用。

## 5. 结论

8 个旧字段已从 DTO、provider 与四条真实端点的 HTTP 响应中彻底移除，OpenAPI 不再暴露旧属性；glyph 成为唯一图标事实源。AF-596 / AF-599 的契约测试已同步翻转为「旧字段缺席」断言，防止字段被静默复活。
