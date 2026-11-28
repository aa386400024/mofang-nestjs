# AF-599 · 图标字段 HTTP 契约回归与旧字段弃用标记

> 任务：AF-599｜状态：完成｜日期：2026-11-28
> 分支：task/AF-599-icon-contract-http-regression
> 基线：a18f0ffc95860067be69723b4de44ba314eabd0f（AF-598 squash 合并后的 integrate）
> 前序：AF-597 已把 `avatarGlyph / coverGlyph / glyph` 枚举字段合并进 integrate

## 1. 本次做了什么

### 1.1 真实 HTTP 契约回归

新增 `test/home/af599-icon-glyph-http-contract.spec.ts`，用 `@nestjs/testing + supertest` 启动 Nest 应用，override `JwtAuthGuard` 注入 `userId=u1`，对四条真实端点发请求：

| 端点 | 断言 |
| --- | --- |
| `GET /home/overview` | `companions[].avatarEmoji` 与 `avatarGlyph` 同时存在；L2 → `personCompanion` |
| `GET /home/overview` | 微干预 `📅` → `growthTarget`；未知 `🦄` → `glyph=null` |
| `GET /home/companion-overview` | 首页 `avatarGlyph=personSupport`；被陪伴者 `avatarGlyph=personCompanion`；工具箱 5 项 emoji + glyph 同时在场 |
| `GET /guide/courses` | 12 门课程均含 `coverEmoji` 与合法 `coverGlyph`；`⚠️` → `systemHandbook` |
| `GET /counselor/home/overview` | 4 个分类均含 `emoji` 与合法 `glyph`；`⏱️` → `statusSuccess` |

共 6 个用例，全部通过。4 个非 1:1 映射全部在 HTTP 响应中被锁住。

### 1.2 OpenAPI 弃用标记

8 个已有 glyph 替代的旧字段加 `deprecated: true`，字段本身保留：

| DTO | 旧字段 |
| --- | --- |
| `SupportCompanionDto` | `avatarEmoji` |
| `MicroInterventionScenarioDto` | `icon` |
| `CompanionPersonStatusDto` | `avatarEmoji` |
| `ToolboxItemDto` | `emoji` |
| `SwitchAccompaniedPersonResponseDto` | `avatarEmoji` |
| `CompanionHomeOverviewDto` | `avatarEmoji` |
| `GuideCourseDto` | `coverEmoji` |
| `CounselorTrainingCategoryDto` | `emoji` |

`GuideCategoryDto.emoji`、`DualPracticeItemDto.emoji`、`DailyCompanionTipDto.icon` 没有 glyph 替代，本轮不标弃用、不删除。

### 1.3 弃用标记验证

测试用 `SwaggerModule.createDocument(..., { extraModels })` 强制生成 8 个 DTO schema，逐一断言旧字段存在且 `deprecated === true`。这补上了“字段没被误删 + 元数据可见”的双重证据。

## 2. 改动文件

修改：

- `src/home/dto/home-overview.dto.ts`
- `src/home/dto/home-companion-overview.dto.ts`
- `src/guide/dto/guide.dto.ts`
- `src/counselor/dto/counselor-home.dto.ts`

新增：

- `test/home/af599-icon-glyph-http-contract.spec.ts`
- `docs/worklog/completed/phase2.5/af599-icon-contract-http-regression-2026-11-28.md`

状态面（CLI 写入）：

- `docs/team/agent-orchestration/task-state-index.json`
- `docs/team/agent-orchestration/state/journal.jsonl`
- `docs/team/agent-orchestration/orchestration-snapshot.json`
- `web/orchestration/data.js`

## 3. 闸门证据

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/home/af599-icon-glyph-http-contract.spec.ts` | 1 file / 6 tests passed / 0 failed；11.53s |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error / 0 warning（定向 eslint --fix 后全量 lint 通过） |
| `git diff --stat HEAD -- src/engine-core` | 空，engine-core 零 diff |

环境：DESKTOP-E3EVQ9P / Windows / PowerShell 7.6.4 / node v22.23.2 / pnpm 9.15.0。

## 4. 契约边界

- 旧字段只标 `deprecated`，一个都没删。
- `glyph` 取值限定 23 个白名单枚举名；测试用 `isIconGlyph` 和 `IconGlyph` 类型双重校验。
- 未知微干预 icon 返回 `glyph=null`，由前端兜底 `personUser`。
- 未改 `src/engine-core/`，未改数据库，未改前端。
- 未新增依赖。

## 5. 风险与后续

- 旧字段仍在下发，旧客户端继续可用；弃用标记只是文档层提示，不会改变运行时行为。
- AF-600 若执行硬删，会与 AF-599 的“字段存在”断言冲突；AF-600 必须同步删除/改写本测试中的旧字段断言，并重新评估旧客户端兼容窗。
- 前端 XS-142 仍需把 7 处 `glyphForEmoji(...)` 切到新 glyph 字段；AF-600 必须等前端切换并评估旧客户端后再删。

## 6. 结论

AF-599 完成：四条真实端点的新旧图标字段兼容契约已被 HTTP 级测试锁住，8 个旧字段已进入 OpenAPI 弃用状态，且没有任何字段被删除。下一步为 XS-142 前端切换，最后再按兼容窗决定 AF-600 删除时机。
