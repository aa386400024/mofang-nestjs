---
taskId: AF-586
contextId: phase2.5-quality-gates
title: WP29 用户数据导出纵切
type: implementation
status: backlog
baselineRef: 1f42ce825dff2669d9738291a22bfa6080cec847
dependsOn: []
priorTasks: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T04:12:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/profile/providers/export.service.ts
    - src/profile/providers/export-archive.ts
    - src/profile/providers/user-data-export.collector.ts
    - src/profile/controllers/export.controller.ts
    - src/profile/dto/export.dto.ts
    - src/profile/profile.module.ts
    - src/user/enums/audit-event.enum.ts
    - test/profile/export.spec.ts
    - test/profile/user-data-export.collector.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af586-data-export-vertical-slice-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/profile test/app/af555-module-wiring.spec.ts
    check: 导出与模块装配单测全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit 0
  - command: pnpm lint
    check: Lint 0 error
    threshold: exit 0
  - command: git diff --stat HEAD -- src/engine-core
    check: 内核零改动
    threshold: empty output
successCriteria:
  - POST /profile/me/export 返回 completed 任务、真实 sizeBytes 与相对下载地址
  - JSON 与 ZIP 两种格式都能生成合法文件，ZIP 为单成员归档
  - GET 任务状态与下载都只允许任务所有者，过期统一 404
  - 同一用户 60s 内重复导出被限流，写 user_data_export_requested 审计
  - 导出采集覆盖 account / profile / 通知 / 会员 / 认证 / 陪伴 / 自护 / burnout / 同意 / 隐私授权十域
  - 对话 / 记忆 / 练习 / 语音转写明确列在 pendingDomains，不假装全量
objective: 把 WP29 的用户导出权从 501 占位推进到可真实下载 profile 域数据的纵切
outOfScope:
  - 不纳入对话原文 / 记忆 / 练习记录 / 语音转写（需单独脱敏与留存策略）
  - 不做加密 ZIP 与 presigned URL（本地 Redis 24h TTL 先闭环）
  - 不改 Flutter 前端
constraints:
  - 心理内容不进日志；审计只记 taskId / format / size
  - 账号侧只导出白名单字段，禁止 password_hash / failed_login_count 入库
  - 不新增 migration
  - 不引入第三方 ZIP / 压缩依赖
---
