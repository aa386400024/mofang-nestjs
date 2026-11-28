---
taskId: AF-599
contextId: phase2.5-quality-gates
title: 图标字段 HTTP 契约回归与旧字段弃用标记
type: verification
status: backlog
baselineRef: a18f0ffc95860067be69723b4de44ba314eabd0f
dependsOn: [AF-597]
priorTasks: [AF-596, AF-597, AF-598]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T18:40:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - src/home/dto/
    - src/guide/dto/
    - src/counselor/dto/
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
    path: docs/worklog/completed/phase2.5/af599-icon-contract-http-regression-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/home/af599-icon-glyph-http-contract.spec.ts
    check: 四条图标接口回归全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
successCriteria:
  - GET /home/overview 响应含 supportCompanions[].avatarEmoji 与 avatarGlyph，二者同时存在
  - GET /home/companion-overview 响应含 avatarEmoji/avatarGlyph、toolbox[].emoji/glyph、accompaniedPersonStatus.avatarEmoji/avatarGlyph
  - GET /guide/courses 响应 12 门课程均含 coverEmoji 与合法 coverGlyph
  - GET /counselor/home/overview 响应 4 个分类均含 emoji 与合法 glyph
  - 4 个非 1:1 映射在 HTTP 响应中断言：L2 -> personCompanion、微干预 📅 -> growthTarget、guide ⚠️ -> systemHandbook、咨询师 ⏱️ -> statusSuccess
  - 微干预未知 icon 在响应中 glyph 为 null
  - 旧字段在 OpenAPI 元数据标 deprecated，但字段不删除
  - typecheck、lint、定向测试全绿，engine-core 零 diff
  - 任务单与交付记录统一 UTF-8 无 BOM + LF，机读护栏通过
objective: 在前端视觉迁移完成后，用真实 HTTP 响应锁住新旧图标字段的兼容契约，并给旧字段加弃用标记，为后续删除提供可验证依据
outOfScope:
  - 不删除 avatarEmoji / coverEmoji / emoji / icon 任一旧字段
  - 不改前端仓库与 Flutter 代码
  - 不改数据库表结构与 migration
  - 不改 src/engine-core
  - 不重写 AF-596 / AF-597 已归档证据
constraints:
  - glyph 字段值只能是 23 个白名单枚举名，不得输出 emoji 或 Unicode
  - 同一响应对象内 glyph 与旧 emoji 必须指向同一图形语义
  - 字段可空；未知值由前端兜底 personUser
  - 任务单、交付记录、回执统一 UTF-8 无 BOM + LF
---

# AF-599 · 图标字段 HTTP 契约回归与旧字段弃用标记

> 状态：📋 待执行（2026-11-28）
> 执行方：自做
> 分支：task/AF-599-icon-contract-http-regression
> 前序任务：AF-597（glyph 枚举字段已合并进 integrate）
> 唯一事实源：AF-596 / AF-597 的字段清单与 4 个非 1:1 映射

## 1. 目标

前端视觉迁移已完成，但接口层仍需证明四条真实响应同时下发新旧字段、且语义一致。本单只补 HTTP 契约回归与 OpenAPI 弃用标记，不删字段。

## 2. 覆盖端点

- `GET /home/overview`
- `GET /home/companion-overview`
- `GET /guide/courses`
- `GET /counselor/home/overview`

## 3. 4 个非 1:1 映射

- L2 陪伴者头像：`personCompanion`
- 微干预 `📅`：`growthTarget`
- guide `⚠️`：`systemHandbook`
- 咨询师 `⏱️`：`statusSuccess`

## 4. 红线

- 不删除任何旧字段；旧字段仅标 `deprecated`。
- 不触碰 `src/engine-core/`。
- 不重写已归档任务证据。
- 任务单与交付记录使用 UTF-8 无 BOM + LF。

## 5. 闸门

- `pnpm exec vitest run test/home/af599-icon-glyph-http-contract.spec.ts`
- `pnpm typecheck`
- `pnpm lint`

## 6. 交付记录

`docs/worklog/completed/phase2.5/af599-icon-contract-http-regression-2026-11-28.md`
