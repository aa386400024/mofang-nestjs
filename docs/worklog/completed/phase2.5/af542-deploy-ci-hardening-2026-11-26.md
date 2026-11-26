---
taskId: AF-542
contextId: phase2.5-audit-remediation
title: 审计 P0/P1 部署与 CI 修复
status: completed
completedAt: 2026-11-26T18:12:00+08:00
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
commit: 任务分支 HEAD（以回执 changedFiles.commits 为准）
---

# AF-542 部署与 CI 修复

## 改动

- `docker-compose.yml`：Redis 启动参数加 `--requirepass '${REDIS_PASSWORD:?...}'`；端口改为 `127.0.0.1:${REDIS_PORT:-6379}:6379`；`maxmemory-policy` 改 `noeviction`；healthcheck 带密码。
- `docker-compose.prod.yml`：新增 `BIND_HOST=127.0.0.1`，配合应用只监听回环，避免 host 网络把 3001 暴露到所有网卡。
- `Dockerfile` / `Dockerfile.prod`：prod 阶段 `ENV NODE_ENV=production`。
- `.dockerignore`：增加 `data/`、`*.sqlite`、`*.db`，避免本地心理数据/调试库进镜像层。
- `.github/workflows/ci.yml`：Trivy 扫构建出的 `mofang-nestjs:${{ github.sha }}`，`exit-code: '1'` 让漏洞阻断流水线。
- `package.json`：删除 `entity:sync`，消除绕过 migration 直接同步 schema 的入口。

## 闸门

- `pnpm orchestration:preflight`：PASS（task=AF-542，files=9 covered=7，其余为任务单/清单）。
- 本任务仅部署与 CI 配置，未改应用代码；AF-540 提交前的 typecheck / lint / test 全绿结论仍适用。

## 偏差

无。`docker compose config` 未在本机执行（本机无 Docker 运行时），配置为静态审阅与 CI 侧验证。
