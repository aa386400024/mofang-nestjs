---
taskId: AF-596
contextId: phase2.5-quality-gates
title: 图标字段 glyph 枚举兼容契约
type: implementation
status: backlog
baselineRef: 0ea1efb88a0d975524751975d20724b6a4efaff3
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T15:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/shared/types/
    - src/home/dto/
    - src/home/providers/
    - src/guide/dto/
    - src/guide/providers/
    - src/counselor/dto/
    - src/counselor/providers/
    - test/home/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af596-icon-glyph-contract-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/home test/counselor
    check: 图标契约定向测试全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: pnpm test
    check: 全量测试全绿
    threshold: 0 failed
successCriteria:
  - 新增共享 IconGlyph 枚举常量，严格包含本轮 23 个白名单值
  - 陪伴对象、伙伴列表与首页支撑关系新增可空 avatarGlyph，旧 avatarEmoji 保留
  - guide 课程新增可空 coverGlyph，旧 coverEmoji 保留，且同一课程新旧字段语义一致
  - 首页工具卡新增可空 glyph，咨询师端入口卡新增可空 glyph，旧 emoji 保留
  - 首页微干预工具卡新增可空 glyph，旧 icon 保留
  - 定向测试、typecheck、lint、全量测试全绿，engine-core 零 diff
objective: 给前端 emoji 全量清零提供枚举名图标字段，同时保留旧字段一个版本供灰度，保证新旧字段同图
outOfScope:
  - 不删除 avatarEmoji / coverEmoji / emoji / icon 任一旧字段
  - 不改前端仓库与 Flutter 代码
  - 不改数据库表结构与 migration
  - 不改非本轮清单内的其他 emoji 字段
  - 不引入新依赖
constraints:
  - glyph 字段值只能是 23 个白名单枚举名，不得输出 emoji 或 Unicode
  - 同一响应对象内 glyph 与旧 emoji 必须指向同一图形语义
  - 字段可空；未知值由前端兜底 personUser
  - 不触碰 src/engine-core
---

# AF-596 · 图标字段 glyph 枚举兼容契约

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-596-icon-glyph-contract（自 integrate）
> 唯一事实源：前端 emoji 清零字段清单 + 23 个枚举白名单
> 改动范围：仅后端 src/test/docs

## 1. 背景

前端正在做 emoji 全量清零，注册表分四族 `AppIcons / AppIconsGrowth / AppIconsPractice / AppIconsPeople`。
后端当前以 emoji 字符串下发头像、课程封面、工具卡图标，前端需要改为按枚举名渲染 SVG。
本轮先加新字段并保留旧字段一个版本，供前端灰度切换；迁移完成后再单独提删旧字段的 PR。

## 2. 范围与映射

新增字段：

- `avatarGlyph`：陪伴对象 / 伙伴列表 / 首页支撑关系
- `coverGlyph`：guide 课程封面
- `glyph`：首页工具卡、微干预工具卡、咨询师端入口卡

旧字段一律保留：`avatarEmoji` / `coverEmoji` / `emoji` / `icon`。

枚举白名单：

`personUser`、`personSupport`、`personFriend`、`personFamily`、`personCompanion`、`personVerified`、`statusCare`、`statusSuccess`、`statusWarning`、`moodNature`、`moodGreat`、`moodGood`、`moodNeutral`、`moodLow`、`moodCrisis`、`growthTarget`、`growthStar`、`growthBadgeCompanion`、`actionMail`、`actionShare`、`actionArchive`、`systemHandbook`、`practiceBreathing`

## 3. 红线

- 新字段只允许白名单枚举名，不得回传 emoji / Unicode。
- 旧字段不能在同一版本删除。
- 同一对象的新旧字段必须指向同一图形语义。
- 字段可空，前端对未知值兜底 `personUser`。
- `src/engine-core/` 零 diff。

## 4. 闸门

- 定向：`pnpm exec vitest run test/home test/counselor`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## 5. 交付记录

`docs/worklog/completed/phase2.5/af596-icon-glyph-contract-2026-11-28.md`

