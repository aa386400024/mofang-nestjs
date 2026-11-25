---
taskId: AF-510
contextId: phase2.5-memory-runtime
title: 生产运行收口：管理后台鉴权、BDI Redis 存储与 DeepSeek 退出候选链
type: fix
status: backlog
baselineRef: a1d04f957a36b4749e26c1115b490ae90da1e218
dependsOn: []
priorTasks: [AF-509]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.2, conventions.md#1.3]
createdAt: 2026-11-25T16:50:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/runbooks/memory-runtime-production-release.md
    - docs/worklog/completed/phase2.5/af510-production-runtime-hardening-2026-11-25.md
    - docs/worklog/records/phase2.5-memory-runtime/AF-510/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af510-production-runtime-hardening-2026-11-25.md
    kind: report
gates:
  - command: curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health
    check: 生产健康检查 200
    threshold: '200'
  - command: curl -s -o /dev/null -w '%{http_code}' -u "$ADMIN_BASIC_AUTH_USER:$ADMIN_BASIC_AUTH_PASS" 'http://127.0.0.1:3001/admin/api/memories?limit=1'
    check: 管理后台记忆接口带 basic auth 返回 200
    threshold: '200'
  - command: docker logs mofang-nestjs-api 2>&1 | grep -E 'BDI 状态存储形态=memory|候选 deepseek 缺少 apiKey'
    check: 不再出现 BDI memory 与 deepseek 候选缺 key 告警
    threshold: empty output
successCriteria:
  - 生产 ADMIN_BASIC_AUTH_USER / ADMIN_BASIC_AUTH_PASS 已配置，管理后台可用，密钥不回显、不入库。
  - 生产 ENGINE_BDI_STATE_STORE=redis，启动日志不再出现 memory 形态告警。
  - 生产不再配置或使用 DeepSeek；渲染主候选固定 MiniMax，启动日志不再出现 deepseek 候选缺 key 告警。
  - 生产 API 保持 Up (healthy)，/health 200，/admin/api/memories 带鉴权 200。
  - 不改 engine-core；不泄露服务器密码、Qdrant key、MiniMax key、admin 口令。
---

# AF-510 · 生产运行收口

> 状态：📋 待执行（2026-11-25）
> 仓库：D:\work\Project\backend\mofang-nestjs-af281r
> 基线：integrate a1d04f95（AF-509 squash 合并后）

## 1. 背景

AF-509 上线后生产 API 已 healthy，但仍有三个运行面遗留：

1. 生产 `/admin/api/memories` 返回 401：`ADMIN_BASIC_AUTH_USER/PASS` 未配置。
2. 生产 BDI 状态仍为 memory：启动日志建议 `ENGINE_BDI_STATE_STORE=redis`。
3. 生产无 DeepSeek key，且以后不再使用；需显式固定 MiniMax 主候选，DeepSeek 退出渲染候选链。

## 2. 范围

**在范围内：**

- 生产 `/opt/mofang-nestjs/.env` 新增 admin basic auth、BDI redis、渲染主候选配置。
- 生产容器 `--force-recreate` 并验证健康、鉴权记忆接口、启动日志无对应告警。
- 更新生产发布手册与交付记录。

**明确不在范围内：**

- 不修改 `src/**`、`test/**`、`engine-core`。
- 不重建生产镜像（本次只改 env）。
- 不删除 DeepSeek provider 历史代码；仅让生产不再配置、不再进候选链。
- 不泄露任何密钥值到仓库、日志、回执或聊天正文。

## 3. 实施要点

1. 生成强随机 admin 口令，写入 `ADMIN_BASIC_AUTH_USER=admin` / `ADMIN_BASIC_AUTH_PASS`，值不打印。
2. `ENGINE_BDI_STATE_STORE=redis`；Redis 已由生产既有配置提供。
3. `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`、`ENGINE_RENDER_FALLBACK_PROVIDERS=`，确保无 DeepSeek 候选。
4. `docker compose -f docker-compose.prod.yml up -d --force-recreate`，等待 healthy。
5. 用服务端 Python 读取 env 后发 basic auth 请求，验证 `/admin/api/memories` 200 且返回真实记忆条目。

## 4. 验收

- `/health` 200；容器 `Up (healthy)`。
- `/admin/api/memories?limit=1` 带 basic auth 200，返回 `source=qdrant` 或真实条目。
- 日志无 `BDI 状态存储形态=memory`、无 `候选 deepseek 缺少 apiKey`。
- 生产 env 中不存在 `LLM_DEEPSEEK_API_KEY`。
