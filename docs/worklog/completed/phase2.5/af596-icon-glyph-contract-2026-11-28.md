# AF-596 交付记录 — 图标字段 glyph 枚举兼容契约

- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-596/task-sheet.md`
- 分支：`task/AF-596-icon-glyph-contract`（自 `origin/integrate` `0ea1efb8`）
- 日期：2026-11-28
- 结论：**passed** — 后端新增 `avatarGlyph / coverGlyph / glyph` 三个可空枚举字段；旧 `avatarEmoji / coverEmoji / emoji / icon` 全部保留；新老字段同对象同图。定向 323 例、全量 5209 例全绿。

## 问题

前端正在做 emoji 全量清零，图标注册表分四族 `AppIcons / AppIconsGrowth / AppIconsPractice / AppIconsPeople`。后端仍有 4 类响应字段直接下发 emoji 字符串，前端无法按枚举渲染 SVG：

1. `avatarEmoji`：陪伴对象、伙伴列表、首页支撑关系、陪伴者端首页。
2. `coverEmoji`：guide 课程封面。
3. `emoji`：陪伴者端首页工具卡、咨询师端训练入口卡。
4. `icon`：首页微干预工具卡。

本轮只做兼容扩展：新增枚举字段并保留旧字段一个版本供前端灰度；迁移完成、前端确认后再单独提删旧字段。

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/shared/types/icon-glyph.types.ts` | 新增单一事实源 `ICON_GLYPHS`（23 个白名单）、`IconGlyph` 类型、`DEFAULT_ICON_GLYPH = personUser`、`isIconGlyph` 运行时判定 |
| `src/home/dto/home-overview.dto.ts` | `SupportCompanionDto` 增加 `avatarGlyph`；`MicroInterventionScenarioDto` 增加 `glyph`；均保留旧字段 |
| `src/home/dto/home-companion-overview.dto.ts` | `CompanionPersonStatusDto` / `SwitchAccompaniedPersonResponseDto` / `CompanionHomeOverviewDto` 增加 `avatarGlyph`；`ToolboxItemDto` 增加 `glyph`；旧字段保留 |
| `src/guide/dto/guide.dto.ts` | `GuideCourseDto` 增加 `coverGlyph`，保留 `coverEmoji` |
| `src/counselor/dto/counselor-home.dto.ts` | `CounselorTrainingCategoryDto` 增加 `glyph`，保留 `emoji` |
| `src/home/providers/home-overview.service.ts` | `emojiForRelation` 收敛为 `avatarForPermission`，同一 helper 同时产出 emoji 与枚举，避免漂移 |
| `src/home/providers/home-companion.service.ts` | 首页头像、被陪伴者头像、切换对象、空状态、5 个工具卡同时写旧 emoji 与新 glyph |
| `src/home/providers/home-micro-intervention-scenario.service.ts` | `toDto` 增加 `glyphForIcon`；7 个种子图标有稳定映射，未知图标返回 `null` 交由前端兜底 |
| `src/guide/providers/guide.service.ts` | 12 门课程逐条补 `coverGlyph`，与 `coverEmoji` 相邻同图 |
| `src/counselor/providers/counselor-home.service.ts` | 4 个训练分类逐条补 `glyph`，与 `emoji` 相邻同图 |
| `test/home/af596-icon-glyph-contract.spec.ts` | 新增 9 例契约测试：白名单、guide、咨询师端、首页支撑关系、陪伴者端首页、微干预 7 图标与未知图标 |

### 枚举映射

| 场景 | 旧值 → 新枚举 |
| --- | --- |
| 首页支撑关系 L1 / L2 / L3 | `🌸 → personUser`、`🌿 → personCompanion`、`🌷 → personVerified` |
| 陪伴者自身 / 被陪伴者 / 切换 / 空状态 | `🤝 → personSupport`、`🌱 → personCompanion` |
| 陪伴者工具卡 | `💌 → actionMail`、`🤝 → personSupport`、`📝 → actionArchive`、`🆘 → statusWarning`、`🌱 → growthTarget` |
| guide 课程 | `💝 → statusCare`、`🔗 → growthTarget`、`🌿 → moodNature`、`🚪 → systemHandbook`、`🎭 → moodNeutral`、`💧 → moodLow`、`🚶 → personUser`、`💔 → moodCrisis`、`🚨 → statusWarning`、`⚠️ → systemHandbook`、`🔋 → statusCare`、`👨‍⚕️ → personVerified` |
| 咨询师入口卡 | `🎯 → growthTarget`、`⏱️ → statusSuccess`、`🗣️ → actionShare`、`🧠 → systemHandbook` |
| 微干预工具卡 | `📅 → growthTarget`、`👥 → personSupport`、`🌙 → moodNeutral`、`💢 → statusWarning`、`📱 → moodLow`、`🌌 → moodNature`、`☀️ → moodGreat` |

关键设计决策：

1. **白名单单一事实源**。23 个枚举只在 `icon-glyph.types.ts` 声明，DTO 的 `enum` 与测试断言都引用同一常量，避免前后端或多文件复制漂移。
2. **同对象同图**。凡是同时下发新旧字段的对象，两个字段都在同一处赋值或同一 helper 产出，避免后续改 emoji 忘改 glyph。
3. **可空而非回填**。DTO 类型为 `IconGlyph | null` 且 `required: false`；已知对象返回值，未知图标返回 `null`，前端统一兜底 `personUser`。
4. **旧字段零删除**。本轮不删任何 `avatarEmoji / coverEmoji / emoji / icon`；前端灰度期间两套字段可并行消费。
5. **不改非清单字段**。`GuideCategoryDto.emoji`、`DualPracticeItemDto.emoji`、`DailyCompanionTipDto.icon`（Material icon 名）不在前端点名的四类字段内，本轮未扩，避免顺手扩大契约面。

## 闸门

<!-- gateResults -->

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/home test/counselor` | 22 files passed，323 passed / 0 failed，38.87s |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning |
| `pnpm test` | 368 files passed / 1 skipped，5209 passed / 0 failed / 4 skipped，328.58s |
| `git diff --stat HEAD -- src/engine-core` | 空 |

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 代码：`src/shared/types/`、`src/home/dto/`、`src/home/providers/`、`src/guide/dto/`、`src/guide/providers/`、`src/counselor/dto/`、`src/counselor/providers/` 均在任务单 files 内。
- 测试：`test/home/af596-icon-glyph-contract.spec.ts` 在 `test/home/` 内。
- 记录：本文件在 `docs/worklog/completed/phase2.5/`，任务记录包在 `docs/worklog/records/phase2.5-quality-gates/AF-596/`。
- 未改数据库表结构、未加 migration、未引入依赖、未改 `src/engine-core/**`、未碰前端仓库与 admin-dashboard。

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- `avatarGlyph` 只出现在 `SupportCompanionDto`、`CompanionPersonStatusDto`、`SwitchAccompaniedPersonResponseDto`、`CompanionHomeOverviewDto`，值为 `ICON_GLYPHS` 内枚举名字符串，不是 emoji / Unicode。
- `coverGlyph` 只出现在 `GuideCourseDto`，12 门 seed 课程全部有值且通过白名单断言。
- `glyph` 出现在 `ToolboxItemDto`、`MicroInterventionScenarioDto`、`CounselorTrainingCategoryDto`，均有对应旧字段保留。
- 所有新字段 `required: false` + `nullable: true`，TS 类型为 `IconGlyph | null`，未知值路径返回 `null`。
- 旧字段 `avatarEmoji / coverEmoji / emoji / icon` 在本版本全部保留，同对象旧值与新枚举在同一映射处产出。
- 状态面只经 CLI（`task register / promote / run-once`）。

<!-- /contractChecks -->

## backlog 遗留项

<!-- backlogItems -->

- **AF596-B1**（frontend）：本轮只给后端字段；Flutter 需按 `avatarGlyph / coverGlyph / glyph` 切换渲染，并对 `null` / 未知值兜底 `personUser`。客户端切换完成前，旧 emoji 字段仍可用。
- **AF596-B2**（backend）：`GuideCategoryDto.emoji`、`DualPracticeItemDto.emoji` 未在本轮点名字段清单内，仍是 emoji；前端若一并清零，需要后续任务单追加对应 glyph 字段。
- **AF596-B3**（process）：迁移完成、前端确认切换后再单独提删旧字段 PR，不在本版本同时删除。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项 | 任务单写的 | 实际 | 处置 |
| --- | --- | --- | --- |
| 首页支撑关系 L2 映射 | 初稿拟定 `personFriend` | 实际落 `personCompanion` | L2 是「进阶陪伴」权限，不是通讯录好友关系；`personCompanion` 语义更准 |
| 微干预 `📅` 映射 | 初稿拟定 `actionArchive` | 实际落 `growthTarget` | 日历对应「会前准备目标」，`actionArchive` 更偏归档动作 |
| guide `⚠️` 映射 | 初稿拟定 `statusWarning` | 实际落 `systemHandbook` | 该课是「避坑指南」知识手册；同时避免与 `🚨` 共用同一警告图标 |
| 咨询师 `⏱️` 映射 | 初稿未定 | 实际落 `statusSuccess` | 全流程计时入口，取「完成/进度」语义；白名单无 timer 专用枚举 |
| 陪伴者工具卡 `🌱` | 初稿拟定 `moodNature` | 实际落 `growthTarget` | 工具卡是「一起成长练习」，成长目标比情绪自然语义更准 |

<!-- /deviationTable -->

## 验收结论

<!-- reviewVerdict -->

passed — 三个新字段全部落地且只使用 23 个白名单枚举；旧字段一个未删；同一对象新旧字段在同一映射处产出，未知图标可空并由前端兜底；定向 323 例、全量 5209 例、typecheck、lint 全绿，engine-core 零 diff。
<!-- /reviewVerdict -->

## commit message

`feat(af596): add icon glyph enum fields with legacy emoji compatibility`
