---
taskId: AF-542
contextId: phase2.5-audit-remediation
title: 审计 P0/P1 部署与 CI 修复（Redis / 镜像 / compose / Trivy / 依赖审计）
type: fix
status: backlog
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
dependsOn: [AF-540, AF-541]
priorTasks: [AF-540, AF-541]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1]
createdAt: 2026-11-26T18:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - .dockerignore
    - Dockerfile
    - Dockerfile.prod
    - docker-compose.yml
    - docker-compose.prod.yml
    - package.json
    - .github/workflows/ci.yml
    - docs/worklog/completed/phase2.5
    - docs/worklog/records
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af542-deploy-ci-hardening-2026-11-26.md
    kind: report
gates:
  - command: pnpm orchestration:preflight
    check: PASS
    threshold: exit 0
successCriteria:
  - Redis 强制密码且仅回环暴露
  - 生产镜像固定 NODE_ENV=production
  - 构建上下文排除本地数据
  - Trivy 扫真实产物并以漏洞退出码阻断
  - 移除 entity:sync 危险入口
---

# AF-542 · 部署与 CI 修复

承接 AF-540 审计修复里落在仓根部署/CI 文件的剩余改动（AF-540 scope 不含这些文件）。改动在业务提交前已在工作树完成，本任务只负责按正确 scope 提交与归档。

范围：

- `docker-compose.yml`：Redis `--requirepass`、`127.0.0.1` 端口、`noeviction`、带密码 healthcheck。
- `docker-compose.prod.yml`：`BIND_HOST=127.0.0.1`，避免 host 网络把 3001 暴露到所有网卡。
- `Dockerfile` / `Dockerfile.prod`：prod 阶段 `ENV NODE_ENV=production`。
- `.dockerignore`：排除 `data/`、`*.sqlite`、`*.db`。
- `.github/workflows/ci.yml`：Trivy 扫 `mofang-nestjs:${{ github.sha }}` 且 `exit-code: '1'`。
- `package.json`：删除 `entity:sync`。

不涉及业务代码与 `src/engine-core`。
