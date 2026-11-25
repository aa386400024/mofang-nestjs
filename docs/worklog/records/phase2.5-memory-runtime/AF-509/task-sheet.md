---
taskId: AF-509
contextId: phase2.5-memory-runtime
title: 记忆链路收尾：根 compose 修正、Qdrant SDK 版本对齐、隧道脚本、生产镜像与环境升级
type: implementation
status: backlog
baselineRef: bbeff285
dependsOn: []
priorTasks: [AF-505, AF-506, AF-507]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T14:52:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docker-compose.yml
    - docker/qdrant/config/config.yaml
    - package.json
    - pnpm-lock.yaml
    - scripts/ops/memory-runtime-tunnel.ps1
    - docs/runbooks/remote-memory-runtime.md
    - docs/runbooks/memory-runtime-production-release.md
    - docs/worklog/completed/phase2.5/af509-memory-runtime-closeout-2026-11-25.md
    - docs/worklog/records/phase2.5-memory-runtime/AF-509/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af509-memory-runtime-closeout-2026-11-25.md
    kind: report
  - name: 生产发布手册
    path: docs/runbooks/memory-runtime-production-release.md
    kind: report
gates:
  - command: pnpm exec vitest run test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts test/llm/custom-embedding-provider.spec.ts
    check: Qdrant 契约与 custom embedding 单测全绿
    threshold: 0 failed
  - command: pnpm lint
    check: 后端 lint 0 error
    threshold: 0 error
  - command: pnpm typecheck
    check: 后端 typecheck 0 error
    threshold: 0 error
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty output
successCriteria:
  - 仓库根 docker-compose.yml 的 Qdrant 服务能按 1.12 配置启动，含显式 entrypoint、正确 --config-path、无 curl 健康检查。
  - 仓库内 docker/qdrant/config/config.yaml 符合 Qdrant 1.12 schema（storage.wal 为对象、不写死 api_key）。
  - "@qdrant/js-client-rest 与服务器 Qdrant 1.12 版本对齐，运行时不再出现版本不兼容警告。"
  - 提供可复用的 SSH 隧道启动脚本，机器重启后可一条命令恢复 6333/8080 转发。
  - 生产 mofang-nestjs-api 镜像升级为本次构建版本，容器 healthy，/admin/api/memories 可用。
  - 生产 /opt/mofang-nestjs/.env 补齐 QDRANT 与 custom embedding 配置，密钥不回显、不入库。
  - 生产发布前后均有回滚路径；不改 engine-core；不泄露服务器密码/API key。
---

# AF-509 · 记忆链路收尾与生产升级

> 状态：📋 待执行（2026-11-25）
> 执行方：自做
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r
> 基线：task/AF-507-memory-runtime-repair 的 bbeff285（stacked）
> 授权：用户本轮明确要求“剩下的也修了、镜像也升级一下、版本警告能修也修”，视为 L4 生产发布授权。
> 说明：AF-508 因 scope 含 `docs/worklog/completed/phase2.5/` 与 AF-481 域冲突，取消后由 AF-509 以文件级 scope 承接。

## 1. 背景

AF-507 已修复远端 Qdrant/TEI 与代码链路，但收尾仍有四项：

1. 仓库根 `docker-compose.yml` 与 `docker/qdrant/config/config.yaml` 仍是错误口径（`--config-ration-filename`、`storage.wal: true`、写死 api_key、healthcheck 依赖 curl 但镜像无 curl）。
2. 本地 `@qdrant/js-client-rest` 实际装到 1.20，服务器 Qdrant 1.12，持续打印版本不兼容警告。
3. 本地 SSH 隧道是手工后台进程，机器重启/断线后需手工重建。
4. 生产 `mofang-nestjs-api` 仍是 2026-08-26 旧镜像，生产 `.env` 无 QDRANT / custom embedding 配置，`/admin/api/memories` 不可用。

## 2. 范围

**在范围内：**

- 根 compose Qdrant 服务与 `docker/qdrant/config/config.yaml` 修正。
- `package.json` / `pnpm-lock.yaml` 将 Qdrant 客户端对齐服务器 1.12。
- `scripts/ops/memory-runtime-tunnel.ps1` 隧道启动/停止脚本。
- `docs/runbooks/` 更新远端运行手册并新增生产发布手册。
- 生产服务器：`/tmp/mofang-build` 构建目录、`mofang-nestjs-api` 镜像重建、`/opt/mofang-nestjs/.env` 补配置、`docker-compose.prod.yml` 重启。
- 服务器 `/root/mofang-rag/docker-compose.yml` 健康检查修正。
- 生产 `/admin/api/memories` 与 Qdrant/TEI 真实链路复验。

**明确不在范围内：**

- 不修改 `src/engine-core/**`。
- 不修改 `src/engine-adapters/persistence/qdrant-memory.store.ts` 的召回策略。
- 不做 `master` 合并 / tag / release notes。
- 不清理仓库既有并行未提交文件；提交只暂存本任务文件。
- 不把服务器密码、Qdrant API key、记忆正文写入仓库、日志或回执。

## 3. 实施要点

1. 根 compose：Qdrant 加 `entrypoint: ['/qdrant/qdrant']`、`command: [--config-path=/qdrant/config/config.yaml]`；healthcheck 改 `CMD-SHELL` + bash `/dev/tcp`。
2. 根 Qdrant config：删 `service.api_key` 与 `storage.wal: true`，`wal: {}`，鉴权只走 compose env。
3. SDK：`@qdrant/js-client-rest` 固定 `1.12.0`，`pnpm install` 更新锁文件。
4. 隧道脚本：`scripts/ops/memory-runtime-tunnel.ps1` 支持 start/stop/status，密码只从 `SSH_PASS` 或交互输入读取，不落盘。
5. 生产：本地 `pnpm build` → rsync `dist` + `package.json` + `pnpm-lock.yaml` + `Dockerfile.prod` 到 `/tmp/mofang-build` → 服务器 build 新 tag 与 latest → `.env` 补 QDRANT/LLM → compose up -d → health 与 admin memories 验证。

## 4. 验收

- 根 compose `docker compose --profile rag config` 通过；Qdrant 容器 healthy。
- Qdrant 客户端版本告警消失。
- 隧道脚本 start/stop/status 可用。
- 生产 `/health` 200、容器 healthy、`/admin/api/memories` 返回 `source=qdrant`。
- lint/typecheck/定向测试全绿；engine-core 零改动。
