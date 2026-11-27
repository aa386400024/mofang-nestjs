---
taskId: AF-588
contextId: phase2.5-quality-gates
title: WP29 删除账户纵切测试与 API 契约收口
type: implementation
status: backlog
baselineRef: d11a37b2cdd88404d0eaec38ac209183e0ac3973
dependsOn: []
priorTasks: [AF-586, AF-587]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-28T05:15:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/profile/dto/export.dto.ts
    - src/profile/controllers/export.controller.ts
    - src/profile/providers/export.service.ts
    - test/profile/export.spec.ts
    - docs/worklog/completed/phase2.5/
    - docs/worklog/records/phase2.5-quality-gates/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af588-delete-account-contract-2026-11-28.md
    kind: report
gates:
  - command: pnpm exec vitest run test/profile/export.spec.ts
    check: 导出与删除账户单测全绿
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
  - 删除账户成功路径覆盖软删字段、会话撤销、JWT 拉黑、OAuth 解绑与审计事件
  - 二次确认不匹配时不触碰用户与会话数据
  - 用户不存在或已删除时返回 404，不做删除
  - purgeAt 等于软删时间 + retentionDays
  - DeleteAccountDto 对 confirmation 做字符串校验
  - Controller / Service 注释不再声称 501 / 仅审计，与实际实现一致
  - 定向测试、typecheck、lint 全绿，engine-core 零 diff
objective: 为 WP29 删除账户路径补齐缺失单测，并收口 Swagger 与代码注释中与实现不符的契约描述
outOfScope:
  - 不改删除业务语义、冷静期与 retentionDays
  - 不新增取消删除 / 恢复接口
  - 不改导出采集范围
constraints:
  - 只补测试与契约文案，除非测试暴露真实缺陷
  - 不引入新依赖
  - engine-core 零改动
---
