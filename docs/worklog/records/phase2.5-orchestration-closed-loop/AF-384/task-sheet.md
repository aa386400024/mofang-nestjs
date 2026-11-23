---
taskId: AF-384
contextId: phase2.5-orchestration-closed-loop
title: 公开仓泄露面收敛与 4C8G self-hosted runner 接入准备（终版）
type: implementation
status: backlog
baselineRef: 31eaf7d2faabcdd5957b10cfc0ee4065e795a526
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.2.0
policyRefs: [conventions.md#1.3, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-23T20:35:00+08:00
deadline: null
agentRole: orchestrator
riskClass: R2
riskRationale: 清理公开仓已入库的密钥备份、调整 PR 生命周期与 CI runner 选择面，涉及安全与 CI 基础设施。
gateProfile: full
objective: 在不立即切换私有仓的前提下，移除公开 HEAD 中的密钥备份、固化轮换与历史清理清单，并完成 4C8G self-hosted runner 的接入前准备。
successCriteria:
  - .env.bak 密钥备份从当前 HEAD 移除，.gitignore 阻断同类文件再次入库
  - 输出不含任何密钥值的轮换清单与历史清理步骤
  - CI 所有 job 的 runs-on 统一走仓库变量 CI_RUNNER，未配置时回退 GitHub 托管
  - pr-release create 默认创建 draft PR，merge 前自动转 ready 并等待 required checks
  - 新增 self-hosted runner 运行手册，覆盖标签、资源上限、缓存、隔离与 public 仓禁用约束
outOfScope:
  - 不重写公开仓历史，不做 filter-repo，不删除远端仓库
  - 不轮换密钥本体，密钥轮换由用户在外部平台执行
  - 不接入真实 self-hosted runner，不购买或配置服务器
  - 不改业务代码、engine-core、数据库迁移与生产配置
  - 不切换仓库可见性，不执行 Leave fork network
references: []
priorTasks:
  - AF-383
  - AF-382
  - AF-381
  - AF-380
  - AF-379
constraints:
  - 状态面只能经 CLI 写入
  - 不打印、不提交任何密钥值
  - 不关闭分支保护，不减少 required check 覆盖
  - 回执先 freeze 再 run-once
  - 任何提交不得使用 --no-verify
scope:
  files:
    - .env.bak.rsa-fix-2026-10-15
    - .gitignore
    - .github/workflows/ci.yml
    - scripts/orchestration/pr-release.mjs
    - scripts/orchestration/__tests__/
    - docs/security/
    - docs/worklog/records/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af384-public-hardening-and-selfhosted-prep-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: exit 0，0 failed
  - command: pnpm lint
    check: ESLint 全绿
    threshold: exit 0
  - command: pnpm typecheck
    check: TypeScript 全量类型检查通过
    threshold: exit 0
  - command: pnpm test
    check: 全量单测通过
    threshold: exit 0，0 failed
assertions:
  - git ls-files 不再包含 .env.bak*
  - CI 中不再存在裸 ubuntu-latest 作为默认 runs-on，统一经 vars.CI_RUNNER 回退
  - pr-release create 的 GitHub 请求体 draft=true；merge 对 draft PR 先转 ready
---

## 背景

公开仓 aa386400024/mofang-nestjs 历史中存在 .env.bak.rsa-fix-2026-10-15，包含 MiniMax、Embedding、Qdrant、JWT、数据库、Redis、SMTP 与 RSA 私钥等真实值。该文件已公开约五周，必须先从 HEAD 移除并推动轮换；历史清理留给私有化窗口。

同时用户计划下月配置 4C8G 专用 CI/staging 服务器。本轮只做接入准备：runner 变量、draft PR 生命周期与运行手册，不实际接入 runner。AF-383 已把删除路径补入 orchestrator 资源域，本单为最终执行。

## 范围

- 删除 .env.bak 文件并补充 .gitignore。
- 新增 docs/security 轮换清单与 self-hosted runner 手册。
- ci.yml 全部 job 的 runs-on 改为 vars.CI_RUNNER 回退 ubuntu-latest。
- pr-release create 默认 draft；merge 先转 ready 再等待 required checks。
- 补对应测试。

## 验收

- 编排单测、lint、typecheck、全量 test 全绿。
- git diff --stat HEAD -- src/engine-core 为空。
- 不输出密钥值；只在报告中列键名和处置动作。
