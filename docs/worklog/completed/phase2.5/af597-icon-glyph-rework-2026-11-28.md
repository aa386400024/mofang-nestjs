# AF-597 · 图标字段 glyph 枚举兼容契约（AF-596 返修）

> 状态：✅ 已完成（2026-11-28）
> 分支：`task/AF-597-icon-glyph-contract-rework`（stacked 自 AF-596 HEAD `ef8fcd7f`）
> 前序任务：AF-596（实现与全量测试完成，因任务单 CRLF 被机读护栏拒绝）
> 交付范围：后端 `src/`、`test/`、`docs/`

## 1. 返修原因

AF-596 的实现、定向测试、typecheck、lint、全量测试均已通过，回执也已冻结；`run-once` 的唯一验收失败项是：

`机读护栏不通过：taskSheet: 含 CR`

即任务单使用 CRLF 换行，触发 `receipt lint` 的换行检查。该失败与代码无关，但 AF-596 已按 `rejected` 归档，按编排规则不得继续写已归档任务，因此登记 AF-597 返修，保留 AF-596 原提交与证据。

## 2. 实现内容

新增 `src/shared/types/icon-glyph.types.ts`：

- `ICON_GLYPHS`：23 个白名单枚举，`as const` 单一事实源。
- `IconGlyph`：枚举名联合类型。
- `DEFAULT_ICON_GLYPH = 'personUser'`。
- `isIconGlyph()`：运行时判定。

DTO 新增可空字段（全部 `@ApiProperty({ enum: ICON_GLYPHS, required: false, nullable: true })`）：

- `src/home/dto/home-overview.dto.ts`：`SupportCompanionDto.avatarGlyph`、`MicroInterventionScenarioDto.glyph`
- `src/home/dto/home-companion-overview.dto.ts`：`CompanionPersonStatusDto.avatarGlyph`、`ToolboxItemDto.glyph`、`SwitchAccompaniedPersonResponseDto.avatarGlyph`、`CompanionHomeOverviewDto.avatarGlyph`
- `src/guide/dto/guide.dto.ts`：`GuideCourseDto.coverGlyph`
- `src/counselor/dto/counselor-home.dto.ts`：`CounselorTrainingCategoryDto.glyph`

旧字段 `avatarEmoji / coverEmoji / emoji / icon` 全部保留，未删除。

服务映射：

- `home-overview.service.ts`：`avatarForPermission` 同一 helper 同时产出 emoji + glyph；L1 `🌸→personUser`、L2 `🌿→personCompanion`、L3 `🌷→personVerified`、default `🌱→personCompanion`。
- `home-companion.service.ts`：陪伴者 `🤝→personSupport`；被陪伴者 / 切换 / emptyStatus `🌱→personCompanion`；工具卡 `💌→actionMail`、`🤝→personSupport`、`📝→actionArchive`、`🆘→statusWarning`、`🌱→growthTarget`。
- `home-micro-intervention-scenario.service.ts`：`glyphForIcon`；`📅→growthTarget`、`👥→personSupport`、`🌙→moodNeutral`、`💢→statusWarning`、`📱→moodLow`、`🌌→moodNature`、`☀️→moodGreat`，未知 icon 返回 `null`。
- `guide.service.ts`：12 门课程逐条 `coverGlyph`。
- `counselor-home.service.ts`：4 个入口卡 `glyph`。

测试：`test/home/af596-icon-glyph-contract.spec.ts`，9 例，覆盖白名单、guide、咨询师、支撑关系、陪伴者首页、切换对象、微干预与未知 icon。返修中修正了 `asRepo` 的 TypeORM 泛型约束，使 `pnpm typecheck` 恢复 0 error。

## 3. 映射清单

- guide：`💝 statusCare`、`🔗 growthTarget`、`🌿 moodNature`、`🚪 systemHandbook`、`🎭 moodNeutral`、`💧 moodLow`、`🚶 personUser`、`💔 moodCrisis`、`🚨 statusWarning`、`⚠️ systemHandbook`、`🔋 statusCare`、`👨‍⚕️ personVerified`
- 咨询师：`🎯 growthTarget`、`⏱️ statusSuccess`、`🗣️ actionShare`、`🧠 systemHandbook`

## 4. 闸门结果

- `pnpm exec vitest run test/home test/counselor`：22 files，323 passed / 0 failed。
- `pnpm typecheck`：exit 0，0 error。
- `pnpm lint`：exit 0，0 error / 0 warning。
- `pnpm test`：368 files passed / 1 skipped，5209 passed / 0 failed / 4 skipped，322.39s。
- `git diff --stat HEAD -- src/engine-core`：空。

## 5. 提交链

- `2f807c96` `chore(af596): register icon glyph task`（AF-596 原提交，仅补 Task trailer）
- `1b2ba899` `feat(af596): add icon glyph enum fields with legacy emoji compatibility`（AF-596 实现，仅补 Task trailer）
- `ef8fcd7f` `chore(af596): freeze delivery receipt`（AF-596 回执，仅补 Task trailer）
- `a2c17b96` `chore(af597): register rework task for icon glyph contract`
- 返修提交：`test/home/af596-icon-glyph-contract.spec.ts` 泛型约束修复

## 6. 风险与后续

- 前端切换前旧 emoji 仍可用；迁移完成、前端确认后再单独提删旧字段 PR。
- 4 个非 1:1 映射（L2 `personCompanion`、微干预 `📅 growthTarget`、guide `⚠️ systemHandbook`、咨询师 `⏱️ statusSuccess`）仍需前端确认 SVG 语义。
- `GuideCategoryDto.emoji`、`DualPracticeItemDto.emoji` 不在本轮清单内，仍为 emoji；如前端一并清零需后续任务。
- `full-test-af597.log`、`af597-targeted.log`、`af597-typecheck.log`、`af597-lint.log` 为本地临时日志，不入库。
