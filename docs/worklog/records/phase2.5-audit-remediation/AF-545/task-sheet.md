---
taskId: AF-545
contextId: phase2.5-audit-remediation
title: 修复 CI 镜像扫描位置与取消任务记录包缺口
type: fix
status: backlog
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
dependsOn: [AF-540, AF-542]
priorTasks: [AF-540, AF-542]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T19:20:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - .github/workflows/ci.yml
    - docs/worklog/records
    - docs/worklog/completed
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af545-ci-and-record-closure-2026-11-26.md
    kind: report
gates:
  - command: pnpm orchestration:preflight
    check: PASS
    threshold: exit 0
successCriteria:
  - Trivy 在构建镜像的同一 job 内扫描该镜像
  - Security Audit job 不再引用不存在的跨 job 镜像
  - AF-538 / AF-539 取消任务的记录包缺口补齐
---

# AF-545 · 修复 CI 镜像扫描位置与记录包缺口

## 背景

- AF-540 把 Trivy 的 `image-ref` 改成 `mofang-nestjs:${{ github.sha }}`，但 Security Audit job 与 Build job 不在同一 runner，镜像不存在，Trivy 直接 FATAL。
- 工作流记录包校验报 AF-538 / AF-539 交付记录缺文件——两条重签发中间任务被取消后没有留下取消说明。

## 改动

1. 把 Trivy 步骤移入 `build` job 的镜像构建之后，保持 `exit-code: '1'` 阻断；Security Audit 只保留 `pnpm audit`。
2. 为 AF-538 / AF-539 各写一份取消说明交付记录，满足 worklog verify。

不涉及业务代码。
