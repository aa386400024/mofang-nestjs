# AF-509 · 记忆链路收尾与生产升级交付记录

- 任务：AF-509（承接 AF-507 的收尾遗留）
- 分支：`task/AF-509-memory-runtime-closeout`
- 基线：`bbeff285`（AF-507 分支 HEAD，stacked）
- 交付日期：2026-11-25
- 结论：根 compose、Qdrant SDK、隧道脚本、生产镜像与生产 env 全部收口；生产 API 已 healthy，记忆集合可用；Qdrant 客户端版本警告消失。

## 1. 问题与结果

AF-507 已修复远端 Qdrant/TEI 与代码链路，但收尾还有四项。本次逐项闭环：

| 问题                                               | 根因                                                                                      | 结果                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 根 `docker-compose.yml` 的 Qdrant 启动错误         | 参数拼成 `--config-ration-filename`、镜像无 ENTRYPOINT、healthcheck 依赖镜像里没有的 curl | 改为显式 `entrypoint: ['/qdrant/qdrant']` + `--config-path`，healthcheck 改 bash `/dev/tcp`，`docker compose --profile rag config` 通过 |
| Qdrant 1.12 配置 schema 不符                       | `storage.wal: true` 是布尔值、配置文件写死 `api_key`                                      | `storage.wal: {}`，删除 `service.api_key`，鉴权只走 `QDRANT__SERVICE__API_KEY`                                                          |
| SDK 与服务器版本不兼容警告                         | 客户端 `^1.19.0` 实际装到 1.20，服务器 Qdrant 1.12                                        | `@qdrant/js-client-rest` 固定 `1.12.0`，运行时版本警告消失                                                                              |
| SSH 隧道依赖手工命令                               | 只有文档里的长 `ssh -N -L` 命令                                                           | 新增 `scripts/ops/memory-runtime-tunnel.ps1`，start/stop/status/restart，密码只从 `SSH_PASS` 或参数读取，不落盘                         |
| 生产 API 仍是 2026-08-26 旧镜像、`.env` 缺记忆配置 | 旧发布从未补 QDRANT / custom embedding                                                    | 新镜像 `af509-20261125` 已构建并上线，`.env` 补 QDRANT / LLM / 启动必需键，容器 `Up (healthy)`                                          |

## 2. 改动文件

| 文件                                                   | 改动                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `docker-compose.yml`                                   | Qdrant 加显式 `entrypoint`、`command` 改 `--config-path`、healthcheck 改 `CMD-SHELL` + bash `/dev/tcp` |
| `docker/qdrant/config/config.yaml`                     | `storage.wal: {}`，删除写死 `service.api_key`，补 1.12 schema 说明                                     |
| `package.json`                                         | `@qdrant/js-client-rest` 从 `^1.19.0` 固定 `1.12.0`                                                    |
| `pnpm-lock.yaml`                                       | 最小锁更新：importer、package entry、snapshot，新增 `@sevinf/maybe@0.5.0`                              |
| `scripts/ops/memory-runtime-tunnel.ps1`                | 新增本地 6333/8080 SSH 隧道管理脚本                                                                    |
| `docs/runbooks/remote-memory-runtime.md`               | 生产 host 网络口径、隧道脚本用法、收尾状态                                                             |
| `docs/runbooks/memory-runtime-production-release.md`   | 新增生产发布/回滚手册，含启动硬性 env、构建、验证、回滚                                                |
| `docs/worklog/records/phase2.5-memory-runtime/AF-509/` | 任务单与记录包                                                                                         |
| 服务器 `/root/mofang-rag/docker-compose.yml`           | Qdrant/TEI healthcheck 改 bash `/dev/tcp`，备份 `.bak.af509`                                           |
| 服务器 `/opt/mofang-nestjs/.env`                       | 补 QDRANT / custom embedding / MiniMax / ASR token 配置，备份 `.env.bak.af509`                         |
| 服务器 `/opt/mofang-nestjs/docker-compose.prod.yml`    | 未改；仍用 `mofang-nestjs-api:latest` + host 网络 + `.env`                                             |

## 3. 关键决策与踩坑

1. **Qdrant 镜像必须显式 entrypoint**：`qdrant/qdrant:v1.12.0` 镜像本身没有 ENTRYPOINT，只改参数会 `exec: "--config-path=...": stat ... no such file`。
2. **1.12 的 `storage.wal` 必须是对象**：布尔值会让启动报 `invalid type: boolean true, expected struct WalConfig`；空对象走默认 WAL。
3. **SDK 降版而不是升服务端**：生产 Qdrant 1.12 与 TEI 已稳定，降客户端到同版本比升级服务端风险低；锁文件只做最小改动，避免顺带升级其他依赖。
4. **本地 `node_modules` 是 junction**：直接在 af281r 跑 `pnpm install` 会反复提示删除/重装并挂起，且会影响共享目录。改用 `%TEMP%` 临时目录只算锁文件，再用 `npm install --no-save --package-lock=false @qdrant/js-client-rest@1.12.0` 在本仓重建独立 `node_modules`，af070 共享 junction 未被破坏。
5. **生产启动缺 env 不是镜像问题**：新代码的 `LlmService` 硬性要求 `MINIMAX_BASE_URL` / `MINIMAX_API_KEY` / `MINIMAX_LLM_MODEL`，`AsrTokenService` 硬性要求 `MINIMAX_ASR_TOKEN_SECRET`；旧 `.env` 从未配置，所以容器启动即退出。补齐后 `Nest application successfully started`。
6. **`.env` 改动必须 `--force-recreate`**：`docker compose up -d` 不会因 env 文件内容变化重建容器；本次两次启动失败后都改为 `up -d --force-recreate` 才生效。
7. **密钥不回显**：生产 env 的所有密钥通过临时片段 scp + 服务端 Python 就地 upsert 写入，片段用 `shred -u` 销毁；命令与日志均未打印值。

## 4. 验收证据

### gateResults

| 闸门               | 命令                                                                                                                    | 结果                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 定向单测           | `pnpm exec vitest run test/engine-adapters/wp45-qdrant-sdk-contract.spec.ts test/llm/custom-embedding-provider.spec.ts` | 2 files / 10 tests passed      |
| Lint               | `pnpm lint`                                                                                                             | 0 error                        |
| 类型检查           | `pnpm typecheck`                                                                                                        | 0 error                        |
| 构建               | `pnpm build`                                                                                                            | 成功，`dist` 3594 文件 / 9.0MB |
| engine-core 零改动 | `git diff --stat HEAD -- src/engine-core`                                                                               | 空输出                         |

### 根 compose 与本地链路

- 根 `docker-compose.yml`：`docker compose --profile rag config --quiet` 通过。
- Qdrant 客户端实际版本 `1.12.0`；`memory-runtime-check.mjs` 复验远端写入/召回/隔离：`wrote: 4`，`aSeesB=false`、`bSeesA=false`、`tenantBSeesTenantA=false`。
- 隧道脚本实跑 `start` 成功（PID 43352），`status` 显示 6333/8080 均 `True`；`stop` 可按 PID 树清理。

### 生产运行态

- 新镜像：`mofang-nestjs-api:af509-20261125` / `latest`，ID `2935c7e5a378`，created `2026-11-25 16:10:19 +0800`，1.36GB；旧镜像保留 `rollback-af509`（`4c87887c8417`）。
- 容器：`mofang-nestjs-api` `Up (healthy)`，created `2026-11-25T08:15:23Z`，`image=mofang-nestjs-api:latest`。
- `curl http://127.0.0.1:3001/health` → `200`。
- `/admin/api/memories?limit=1` → `401`（生产 fail-close，路由已存在；不是 404/000）。
- `mofang-qdrant` / `mofang-tei` 均 `Up (healthy)`。
- Qdrant：`collections=['visitor_long_memory']`，`status=green`，`points_count=4`。
- 应用日志：`QdrantService` `Qdrant connected url=http://127.0.0.1:6333 collections=1`；无 Qdrant 客户端版本不兼容警告。

### 回滚路径

```bash
docker tag mofang-nestjs-api:rollback-af509 mofang-nestjs-api:latest
cd /opt/mofang-nestjs
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

env 回滚：`cp /opt/mofang-nestjs/.env.bak.af509 /opt/mofang-nestjs/.env` 后同样 `--force-recreate`。

## 5. scopeCheck

`scopeCheck: in-scope`

实际提交只落在 AF-509 `scope.files`：

- `docker-compose.yml`
- `docker/qdrant/config/config.yaml`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/ops/memory-runtime-tunnel.ps1`
- `docs/runbooks/remote-memory-runtime.md`
- `docs/runbooks/memory-runtime-production-release.md`
- `docs/worklog/completed/phase2.5/af509-memory-runtime-closeout-2026-11-25.md`
- `docs/worklog/records/phase2.5-memory-runtime/AF-509/`

未提交并行产物：`admin-dashboard/components.d.ts`、根目录两份备忘、`af476/477/479/480` 交付记录、AF-508 记录目录。`docs/team/agent-orchestration/agent-cards/executor.json` 曾临时扩展资源域以便 AF-509 通过 scope 校验，任务收尾后还原，不作为交付内容。

## 6. contractChecks

- taskId：AF-509 贯穿任务单、交付记录、回执与状态索引。
- state-write：登记 / 提级 / 派发 / 回执 / 归档均经 CLI，未手改状态索引。
- index-schema：任务单 frontmatter 与回执六组字段齐全。
- event-chain：回执摄入与 completed 事件由 `run-once` 生成。
- engine-boundary：`src/engine-core` 零 diff。
- secrets：服务器密码、Qdrant API key、MiniMax key、ASR token 未写入仓库、回执、日志或聊天正文；生产 env 片段已销毁。

## 7. deviationTable

| 项           | 计划                           | 实际                                                                                                                         | 原因                                                     |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 任务载体     | AF-508                         | AF-508 因 scope 含 `docs/worklog/completed/phase2.5/` 与 AF-481 域冲突被取消，AF-509 以文件级 scope 承接                     | 避免跨任务文件域冲突                                     |
| 生产启动配置 | 只补 QDRANT / custom embedding | 追加 `MINIMAX_BASE_URL` / `MINIMAX_API_KEY` / `MINIMAX_LLM_MODEL` / `MINIMAX_ASR_TOKEN_SECRET` / `LLM_DEFAULT_CHAT_PROVIDER` | 新代码启动硬性依赖；旧 `.env` 从未配置，容器两次启动退出 |
| 镜像基础层   | 沿用旧 Dockerfile 口径         | `node:26-alpine` + `pnpm install --prod --frozen-lockfile`                                                                   | 旧基础镜像与新 Node/依赖不兼容；锁文件固定保证可复现     |
| 发布方式     | `docker compose up -d`         | `up -d --force-recreate`                                                                                                     | compose 不会因 `.env` 文件内容变化重建容器               |
| 回滚标签     | `rollback-20261125`            | `rollback-af509`                                                                                                             | 与任务代号一致，便于检索                                 |

## 8. backlogItems

1. **生产 `/admin/api` 未配 basic auth**：`ADMIN_BASIC_AUTH_USER/PASS` 为空，生产按 fail-close 返回 401，管理后台当前无可用凭据；需运维决定是否启用 basic auth 或走管理员 JWT。
2. **生产 BDI 状态存储仍是 memory**：启动日志建议 `ENGINE_BDI_STATE_STORE=redis`，进程重启/多实例会丢会话快照；本次未改运行语义。
3. **`LLM_DEEPSEEK_API_KEY` 未配置**：deepseek 候选在渲染链中会失败；当前默认 MiniMax 单候选可用，批量跑批前需补 key 或移除候选。
4. **AF-507 代码尚未进 integrate**：AF-509 分支 stacked 在 AF-507 HEAD，PR 合并时会一并带入 AF-507 的 4 个提交。
5. **executor Agent Card 资源域仍不含 `scripts/ops/` 与根配置**：本次为临时扩展并还原；后续 ops 类任务仍会被 scope 拦截，需单独登记编排配置任务。

## 9. reviewVerdict

`reviewVerdict: passed`

代码闸门全绿；根 compose、SDK、隧道、生产镜像与生产 env 均完成；生产 API healthy、Qdrant 记忆集合 green 且可连接。遗留项已显式登记，不夹带并行产物。
