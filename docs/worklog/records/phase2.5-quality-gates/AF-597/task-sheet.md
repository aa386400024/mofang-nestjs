---
taskId: AF-597
contextId: phase2.5-quality-gates
title: 图标字段 glyph 枚举兼容契约（AF-596 返修）
type: implementation
status: backlog
baselineRef: ef8fcd7fe3478daf888cbdbd641e78054c85b74c
dependsOn: []
priorTasks: [AF-596]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T16:09:57+08:00
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
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af597-icon-glyph-rework-2026-11-28.md
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
  - 任务单与交付记录统一 LF 且无 BOM，机读护栏通过
objective: 承接 AF-596 已完成的实现，修复任务单 CRLF 导致的机读验收拒绝，重新完成回执验收与 PR 收口
outOfScope:
  - 不删除 avatarEmoji / coverEmoji / emoji / icon 任一旧字段
  - 不改前端仓库与 Flutter 代码
  - 不改数据库表结构与 migration
  - 不改非本轮清单内的其他 emoji 字段
  - 不重写 AF-596 已归档证据，不引入新依赖
constraints:
  - glyph 字段值只能是 23 个白名单枚举名，不得输出 emoji 或 Unicode
  - 同一响应对象内 glyph 与旧 emoji 必须指向同一图形语义
  - 字段可空；未知值由前端兜底 personUser
  - 不触碰 src/engine-core
  - 任务单、交付记录、回执统一 UTF-8 无 BOM + LF
---

# AF-597 · 图标字段 glyph 枚举兼容契约（AF-596 返修）

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-597-icon-glyph-contract-rework（stacked 自 AF-596 HEAD `ef8fcd7f`）
> 前序任务：AF-596（实现与全量测试已完成；因任务单 CRLF 被机读护栏拒绝归档）
> 唯一事实源：前端 emoji 清零字段清单 + 23 个枚举白名单

## 1. 返修原因

AF-596 的实现、定向测试、typecheck、lint、全量测试均已通过，回执也已冻结；`run-once` 的唯一验收失败项是：

`机读护栏不通过：taskSheet: 含 CR`

即任务单使用 CRLF 换行，触发 `receipt lint` 的换行检查。该失败与代码无关，但 AF-596 已按 `rejected` 归档，按编排规则不得继续写已归档任务，因此登记 AF-597 返修。

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
- 不重写 AF-596 已归档证据；AF-597 使用独立任务单、交付记录与回执。

## 4. 闸门

- 定向：`pnpm exec vitest run test/home test/counselor`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## 5. 交付记录

`docs/worklog/completed/phase2.5/af597-icon-glyph-rework-2026-11-28.md`
