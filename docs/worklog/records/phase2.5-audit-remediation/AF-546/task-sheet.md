---
taskId: AF-546
contextId: phase2.5-audit-remediation
title: 运行时镜像剥离 npm 自带高危依赖
type: fix
status: backlog
baselineRef: 157f4bcba218d21b55908c5f4bdeda2d7d2406d7
dependsOn: [AF-545]
priorTasks: [AF-540, AF-542, AF-545]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T19:40:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - Dockerfile
    - Dockerfile.prod
    - docs/worklog/records
    - docs/worklog/completed
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af546-runtime-image-npm-strip-2026-11-26.md
    kind: report
gates:
  - command: pnpm orchestration:preflight
    check: PASS
    threshold: exit 0
successCriteria:
  - 运行时镜像删除 npm 及其内置 node_modules
  - Trivy 不再扫到 npm 自带的 undici / brace-expansion 高危项
  - 应用启动只依赖 node + dist + 生产 node_modules
---

# AF-546 · 运行时镜像剥离 npm 自带高危依赖

## 背景

AF-545 把 Trivy 放回 build job 后，扫描到 6 个 HIGH，全部位于 `usr/local/lib/node_modules/npm/node_modules/`（npm 自带的 undici 6.28.0 与 brace-expansion 5.0.9），不是应用依赖。运行时镜像不需要包管理器。

## 改动

- `Dockerfile` prod 阶段删除 `/usr/local/lib/node_modules/npm` 与 npm/npx 软链。
- `Dockerfile.prod` 单阶段在安装完成后删除 npm、corepack、pnpm 及其软链，保留 node 运行时。

不升业务依赖，不放宽 Trivy 阈值。
