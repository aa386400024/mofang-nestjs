---
taskId: AF-601
contextId: phase2.5-quality-gates
title: 删除已有 glyph 替代的 8 个旧 emoji 字段（AF-600 重签发）
type: implementation
status: backlog
baselineRef: 3e09857652efda56e728400b1ac9fe6ce4107b4c
dependsOn: [AF-599]
priorTasks: [AF-596, AF-597, AF-598, AF-599, AF-600]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T21:18:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/home/dto/
    - src/home/providers/
    - src/guide/dto/
    - src/guide/providers/
    - src/counselor/dto/
    - src/counselor/providers/
    - test/home/
    - test/guide/
    - test/counselor/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af601-icon-emoji-field-removal-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/home/af600-icon-field-removal.spec.ts test/home/af596-icon-glyph-contract.spec.ts
    check: 四条图标端点旧字段缺席、新 glyph 在场
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
successCriteria:
  - SupportCompanionDto、CompanionPersonStatusDto、SwitchAccompaniedPersonResponseDto、CompanionHomeOverviewDto 不再有 avatarEmoji
  - MicroInterventionScenarioDto 不再有 icon；glyph 仍由数据库 icon 推导
  - ToolboxItemDto 不再有 emoji
  - GuideCourseDto 不再有 coverEmoji
  - CounselorTrainingCategoryDto 不再有 emoji
  - GET /home/overview、/home/companion-overview、/guide/courses、/counselor/home/overview 的 HTTP 响应无上述旧字段
  - OpenAPI 文档中 8 个旧属性全部消失，新 glyph 属性保留
  - GuideCategoryDto.emoji、DualPracticeItemDto.emoji、DailyCompanionTipDto.icon 不删
  - typecheck、lint、定向测试全绿，engine-core 零 diff
  - 任务单与交付记录统一 UTF-8 无 BOM + LF
objective: AF-599 已锁住新旧字段兼容契约并归档；前端 XS-142 已切到 glyph 优先读点。本单删除 8 个已有 glyph 替代的旧 emoji 字段，让图标契约收敛为单一 glyph 事实源。AF-600 因 GUI 投递租约过期被归档为 rejected（内容与闸门本身无问题），本单为其内容重签发，代码与测试沿用 AF-600 已落盘结果，测试文件保留 af600 命名作为历史来源。
outOfScope:
  - 不删 GuideCategoryDto.emoji、DualPracticeItemDto.emoji、DailyCompanionTipDto.icon（尚无 glyph 替代）
  - 不改前端仓库与 Flutter 代码
  - 不改数据库表结构、migration 或种子数据
  - 不改 src/engine-core
  - 不重写 AF-596 / AF-597 / AF-599 已归档证据
constraints:
  - glyph 字段值只能是 23 个白名单枚举名，不得输出 emoji 或 Unicode
  - 旧字段删除后不得留下空占位属性或 undefined 序列化
  - 微干预 glyph 仍按数据库 icon 推导，未知 icon 返回 null
  - 任务单、交付记录、回执统一 UTF-8 无 BOM + LF
---

# AF-601 · 删除已有 glyph 替代的 8 个旧 emoji 字段（AF-600 重签发）

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-601-icon-emoji-field-removal
> 前序任务：AF-600（同内容，因 GUI 投递租约过期被归档为 rejected）
> 唯一事实源：AF-596 / AF-597 / AF-599 的字段清单与 4 个非 1:1 映射

## 1. 目标

把已由 glyph 完整替代的 8 个旧 emoji 字段从 DTO、OpenAPI 与 HTTP 响应中删除，避免新旧两套图标事实源长期并存。删除范围严格限定在 AF-599 标记 deprecated 的字段。

## 2. 删除清单

| DTO | 旧字段 | 替代字段 |
| --- | --- | --- |
| SupportCompanionDto | avatarEmoji | avatarGlyph |
| MicroInterventionScenarioDto | icon | glyph |
| CompanionPersonStatusDto | avatarEmoji | avatarGlyph |
| ToolboxItemDto | emoji | glyph |
| SwitchAccompaniedPersonResponseDto | avatarEmoji | avatarGlyph |
| CompanionHomeOverviewDto | avatarEmoji | avatarGlyph |
| GuideCourseDto | coverEmoji | coverGlyph |
| CounselorTrainingCategoryDto | emoji | glyph |

## 3. 不删清单

- `GuideCategoryDto.emoji`：指南分区入口，没有 glyph 替代。
- `DualPracticeItemDto.emoji`：双人练习卡，没有 glyph 替代。
- `DailyCompanionTipDto.icon`：Material 图标名，不是 emoji 字段。

## 4. 兼容风险

删除会破坏仍读旧字段的旧客户端。当前 `xin_su_app` 已完成 XS-142 切换，glyph 优先、旧 emoji 兜底；真实响应不再下发旧字段后，前端走 glyph。若线上仍有旧版安装包，需要回滚本提交或走 API 版本化，不在本单补兼容层。

## 5. 交付

- 4 个 DTO 删除 8 个字段。
- 5 个 provider 删除旧字段赋值。
- AF-596 / AF-599 契约测试改写为「旧字段缺席、glyph 在场」。
- `docs/worklog/completed/phase2.5/af601-icon-emoji-field-removal-2026-11-28.md`
