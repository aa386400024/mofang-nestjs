# AF-510 · 生产运行收口交付记录

- 任务：AF-510（承接 AF-509 的三条运行面遗留）
- 分支：`task/AF-510-production-runtime-hardening`
- 基线：`a1d04f957a36b4749e26c1115b490ae90da1e218`
- 交付日期：2026-11-25
- 结论：管理后台鉴权、BDI Redis 存储、DeepSeek 退出候选链三项已上线；生产 API 保持 healthy，记忆接口带鉴权返回真实数据。

## 1. 改动内容

本次只改生产 `/opt/mofang-nestjs/.env` 与运行态，不重建镜像、不改业务代码：

| 项            | 配置                                                                                                                                            | 结果                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 管理后台鉴权  | `ADMIN_BASIC_AUTH_USER=admin`、`ADMIN_BASIC_AUTH_PASS=<强随机>`                                                                                 | `/admin/api/memories` 从 401 变为 200，返回 `source=qdrant`        |
| BDI 持久化    | `ENGINE_BDI_STATE_STORE=redis`                                                                                                                  | 启动日志不再出现 `BDI 状态存储形态=memory` 告警                    |
| DeepSeek 退出 | 删除 `LLM_DEEPSEEK_API_KEY`；`ENGINE_RENDER_PRIMARY_PROVIDER=minimax`、`ENGINE_RENDER_FALLBACK_PROVIDERS=`、`LLM_DEFAULT_CHAT_PROVIDER=minimax` | 启动日志不再出现 `候选 deepseek 缺少 apiKey`，生产无 DeepSeek 候选 |
| 文档          | `docs/runbooks/memory-runtime-production-release.md`                                                                                            | 新增 §2.1 配置口径与验证命令                                       |

## 2. 关键决策

1. **只改 env，不重建镜像**：三项都是部署形态配置；AF-509 镜像已包含所需能力，重建收益为零。
2. **admin 口令不回显**：本地用加密随机源生成，经临时片段 scp 写入服务器 `.env` 后 `shred`；仓库、日志、回执与交付记录只有键名或 `<强随机>` 占位。实际口令在服务器 `/opt/mofang-nestjs/.env`。
3. **DeepSeek 只退出运行链，不删历史 provider 代码**：`AIProviderId.DEEPSEEK` 可能出现在历史 DB 行；直接删枚举/provider 会扩大迁移风险。生产已无 key、无主备候选，启动注册也不会发生。
4. **BDI 用 redis 符合启动期 fail-fast**：Redis 不可用会启动失败而不是静默回落 memory；本次容器 healthy 即证明 Redis 装配成功。

## 3. 验收证据

### gateResults

| 闸门             | 命令/观测                                       | 结果                                                                     |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| 容器健康         | `docker ps --filter name=mofang-nestjs-api`     | `Up (healthy)`                                                           |
| 健康检查         | `curl http://127.0.0.1:3001/health`             | `200`                                                                    |
| 管理后台记忆接口 | 带 basic auth `GET /admin/api/memories?limit=1` | `200`；`source=qdrant`、`scope=long_term`、`total=4`、`entries` 4 条     |
| BDI 告警         | `docker logs ...                                | grep 'BDI 状态存储形态=memory'`                                          | 空输出 |
| DeepSeek 告警    | `docker logs ...                                | grep '候选 deepseek 缺少 apiKey'`                                        | 空输出 |
| DeepSeek 配置    | 生产 `.env` 键检查                              | `LLM_DEEPSEEK_API_KEY` 不存在                                            |
| 配置生效         | 生产 `.env` 键检查                              | `ENGINE_BDI_STATE_STORE=redis`、`ENGINE_RENDER_PRIMARY_PROVIDER=minimax` |
| engine-core      | `git diff --stat HEAD -- src/engine-core`       | 空输出（本次无 src 改动）                                                |

### 回滚

```bash
cp /opt/mofang-nestjs/.env.bak.af510 /opt/mofang-nestjs/.env
cd /opt/mofang-nestjs
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

回滚后管理后台回到 401、BDI 回 memory、渲染主候选重新读取旧 env；镜像不变。

## 4. scopeCheck

`scopeCheck: in-scope`

- 仓库提交只含 `docs/runbooks/memory-runtime-production-release.md`、本交付记录与 AF-510 记录包。
- 生产 `.env` 不在仓库，未入库；备份 `.env.bak.af510` 保留在服务器。
- 未修改 `src/**`、`test/**`、`engine-core`、生产镜像。
- 未清理仓库既有并行未提交文件。

## 5. contractChecks

- taskId：AF-510 贯穿任务单、交付记录、回执与状态索引。
- state-write：登记 / 提级 / 派发 / 回执 / 归档均经 CLI。
- index-schema：任务单 frontmatter 与回执六组字段齐全。
- event-chain：由 `run-once` 摄入并归档。
- engine-boundary：`src/engine-core` 零 diff。
- secrets：服务器密码、Qdrant key、MiniMax key、ASR token、admin 口令均未写入仓库/日志/回执；admin 口令只存在服务器 `.env`。

## 6. deviationTable

| 项            | 计划          | 实际                                          | 原因                              |
| ------------- | ------------- | --------------------------------------------- | --------------------------------- |
| 修复方式      | 可能重建镜像  | 只改 env + `--force-recreate`                 | 三项都是运行配置，镜像无需变化    |
| DeepSeek 处理 | 删除          | 删除生产 key 与候选链，保留历史 provider 代码 | 避免枚举/历史 DB 行迁移风险       |
| 管理后台口令  | 配 basic auth | 生成强随机口令，账号 `admin`，不回显          | 满足可用性同时不在仓库/聊天留明文 |

## 7. backlogItems

1. **admin 口令轮换**：当前口令由本次生成并只存服务器 `.env`；后续轮换需同步管理后台登录方。
2. **DeepSeek 历史代码清理（可选）**：如果确认永远不用，可另立任务删除 `DeepSeekChatProvider`、枚举值与相关测试；本次不做以避免迁移风险。
3. **AF-481 仍 ready**：与本任务无关，状态面仍有 1 个 ready 任务。

## 8. reviewVerdict

`reviewVerdict: passed`

三条运行面遗留均已闭环：管理后台可用、BDI 落 Redis、DeepSeek 不再进候选链；生产 healthy，记忆接口返回真实 Qdrant 数据，未泄露任何密钥。
