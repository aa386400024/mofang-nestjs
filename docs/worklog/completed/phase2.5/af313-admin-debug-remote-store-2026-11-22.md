# AF-313 · Admin 调试会话远端持久化：MySQL 系统记录 + 本地文件缓存

## 1. 背景与根因

`/auto-practice` 列表来自远程 MySQL `ap_practice_sessions`，但调试正文原先只写在后端进程工作目录的 `data/debug-sessions/<id>.json`。目标场次 `zgdBLq4hL3lfcTu9cufeA` 的 `debugSessionId=debug_xw7uAJodsn6o3ln9FGL_Q` 确实在列表中，文件却在 `mofang-nestjs-af070` 工作树；当时监听 3000 的后端跑在旧工作树 `mofang-nestjs`，读不到该文件，于是 `getPersistedSession` 抛 404，页面表现为“场次有、对话空白”。

本次把“录像带编号在远程库、录像带在本机柜子”的错配收敛为：**MySQL 专用表为跨机器系统记录，本地文件降为写穿缓存与历史兼容层**。

## 2. 交付内容

### 2.1 远端记录层

- 新表 `admin_debug_sessions`：完整 `DebugSessionRecord` JSON 存 `record_json LONGTEXT`；列表投影列独立存（`title/status/turn_count/has_kernel_state/created_at/updated_at` 等）。
- `content_sha256` / `record_bytes` / `schema_version` 用于审计、幂等与容量观测。
- 新实体 `AdminDebugSessionEntity` 与手写 DDL `CreateAdminDebugSessions1714900000049`；`bin/ormconfig.ts` 与 `src/migration/index.ts` 双登记。
- 不写 `training_sessions` / `turn_debug_trace`，不污染正式训练表。

### 2.2 存储语义

- `ADMIN_DEBUG_SESSION_REMOTE=on`（缺省）：`create`/`appendTurn`/`updateTitle`/`markCompleted`/`markActive` 先写远端、再写本地缓存；`get` 远端优先，命中回填本地；缺失回落本地，兼容未导入历史；`remove` 双侧删除；`list` 合并远端与本地，同 id 取 `updatedAt` 更新者。
- `onModuleInit` 严格加载远端 id 集：远端开启但表缺失 → 启动即失败（fail-closed）；已知 id 每 60s 刷新，供标注台同步 `exists` 判定。
- `off`：`mirror=null`，逐字回到纯文件模式，作为回滚开关。
- `ADMIN_DEBUG_SESSION_MAX`：文件与远端共用口径，缺省 500，夹在 1..10000；本次部署设 2000，避免导入历史后首次 create 淘汰老基线。

### 2.3 历史导入 CLI

`bin/import-debug-sessions.ts`：

- 默认 dry-run；`--apply` 才写库；`--source` 可重复；`--overwrite` 强制；`--max N` 导入后按 `created_at` prune。
- 按 `updatedAt` 只升不降；校验 `record.id === 文件名`；损坏文件跳过并计数；输出 `created/updated/skipped/invalid/failed`；异常退出码 1。
- 隐私：强制 `logging:false` + `maxQueryExecutionTime:0`，不输出 SQL 参数与对话正文。

### 2.4 标注台来源判定

`quality-annotation-batch.service.ts` 的 `hasLiveFile` 由“同机 `existsSync`”改为 `DebugSessionStore.exists`。远端已知 id 不再因本机无文件误判 missing；异常只记错误类型名。

### 2.5 隐私护栏（实现中发现并修复）

首次导入时，共享 DataSource 的 `maxQueryExecutionTime` 触发 TypeORM 慢查询日志，把 `record_json` 参数打印到终端。处置：

1. 立即停止并删除两份含原文的临时工具日志。
2. 导入 CLI 硬编码关闭 SQL 日志与慢查询阈值。
3. 新增 `DebugSessionQueryLogGuard`：包裹共享 DataSource logger，对 `admin_debug_sessions` 的 `logQuery/logQueryError/logQuerySlow` 参数替换为 `[redacted:admin_debug_sessions]`，其余 SQL 日志原样委托；单测覆盖脱敏与非敏感表透传。
4. 运行手册明确禁止为排障打开 `DB_QUERY_LOGGING=true` 后跑导入。

## 3. 真实环境落地

### 3.1 迁移

```text
pnpm migration:show  → CreateAdminDebugSessions1714900000049 [ ]
pnpm migration:run   → executed successfully
```

迁移只建表，不影响其他表。

### 3.2 历史导入

- dry-run：3 个源目录、576 个文件，`invalid=0 failed=0`。
- apply 完成：576 个文件，最终 `created=176 updated=0 skipped=400 invalid=0 failed=0`（跨目录同 id 去重，唯一记录 480）。
- 远端核对：
  - `total=480`，`bytes=114,856,984`，`oldest=2026-11-17T08:36:06.451Z`，`newest=2026-11-21T06:34:42.706Z`（目标场次）。
  - 目标 `debug_xw7uAJodsn6o3ln9FGL_Q`：`title=晚晴与伴侣临时失约的等待`、`status=completed`、`turn_count=20`、`record_bytes=198,584`。
- 真实远端记录层冒烟：临时 id upsert → get → list 命中 → remove，全部成功，临时数据已删除。

### 3.3 服务切换与端到端验证

- 停止旧工作树 `mofang-nestjs` 的 `nest start --watch` 进程树；从 `mofang-nestjs-af281r` 以 `node --enable-source-maps dist\app` 启动，监听 3000（PID 42244，工作目录 af281r）。
- `GET /admin/api/debug/sessions/debug_xw7uAJodsn6o3ln9FGL_Q`：200，92,645 bytes；`id/title/status/turnCount/messages=40` 与目标记录一致。
- `GET /admin/api/debug/sessions`：480 条，包含目标 id。
- 经 `5174` Vite 代理同路径：200，92,645 bytes。`/auto-practice` 404 端到端消失。

## 4. 闸门与证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向测试 | `pnpm exec vitest run test/admin-debug/debug-session-persistence.spec.ts test/admin-debug/debug-session-remote-mirror.spec.ts test/quality/quality-annotation-contract.spec.ts` | 3 files / 49 tests passed，exit 0 |
| 类型 | `pnpm typecheck` | exit 0，0 error |
| lint | `pnpm lint` | exit 0，0 error / 0 warning |
| 全量回归 | `pnpm test` | 282 files passed + 1 skipped；4387 tests passed + 8 skipped；exit 0（23.96s） |
| engine-core | `git diff --stat HEAD -- src/engine-core` | 输出为空 |
| 构建 | `pnpm build` | exit 0 |

定向测试补充：

- `debug-session-remote-mirror.spec.ts` 9 例：create 双写、远端 get 回填、list 合并取新、known ids exists、双删、remote=off、上限解析、onlyIfNewer、慢查询脱敏。
- `debug-session-persistence.spec.ts` 28 例：原文件回归不改断言，仍全绿。
- `quality-annotation-contract.spec.ts` 12 例：标注来源契约不变。

## 5. 变更文件

新增：

- `src/admin-debug/debug-session-record.ts`
- `src/admin-debug/debug-session-mirror.ts`
- `src/admin-debug/debug-session-query-log.guard.ts`
- `src/admin-debug/entities/admin-debug-session.entity.ts`
- `src/migration/1714900000049-CreateAdminDebugSessions.ts`
- `bin/import-debug-sessions.ts`
- `test/admin-debug/debug-session-remote-mirror.spec.ts`
- `docs/runbooks/admin-debug-session-storage.md`

修改：

- `src/admin-debug/debug-session-store.ts`
- `src/admin-debug/admin-debug-chat.module.ts`
- `src/quality/quality-annotation-batch.service.ts`
- `src/quality/quality-annotation.module.ts`
- `src/migration/index.ts`
- `bin/ormconfig.ts`
- `.env.example`

环境（不入库）：`.env` 增加 `ADMIN_DEBUG_SESSION_REMOTE=on`、`ADMIN_DEBUG_SESSION_MAX=2000`。

## 6. 与任务单的偏差

1. **AF-312 → AF-313**：原 AF-312 因 `agentRole=orchestrator` + scope 含 `src/`、`docs/adr/`、`package.json` 被 `scope-domain-conflict` 拦截。按“scope 不原地修改、重签发新任务”规则，用 `task reissue --from AF-312 --sheet ... --apply --archive-old` 重签发 AF-313（executor），AF-312 已 canceled/archived。
2. **未写 ADR**：AF-313 executor scope 不含 `docs/adr/`，设计取舍写入运维手册与本文；加密/KMS 等后续技术债已登记在手册 §8。
3. **未改 `package.json` 脚本**：导入 CLI 以 `pnpm exec tsx bin/import-debug-sessions.ts` 调用，不新增 npm script，避免超出 scope。
4. **`ADMIN_DEBUG_SESSION_MAX` 取值**：按部署建议设为 2000；代码缺省仍 500，保持文件模式零回归。
5. **隐私护栏为本轮追加**：任务单只要求“不打印正文”，实现中发现慢查询日志会带出参数，因此增加 logger 脱敏护栏与单测；属于任务单边界内的必要加固。

## 7. 遗留与技术债

- 应用层加密 / KMS 密钥托管未做，当前依赖 DB 访问控制与网络边界；需单独立项。
- 跨进程并发写无乐观锁；同一活跃会话仍由单进程持有。
- 列表一次性合并返回，数据量继续增长应改远端分页 + 本地增量。
- 导入非事务批处理：单条失败不回滚已成功记录，重复执行幂等。
- `ADMIN_DEBUG_SESSION_MAX` 远端/本地各自 prune，可能出现远端有、本地已淘汰；读时回填。
- 旧工作树 `mofang-nestjs` 的 watcher 已停止；后续 3000 服务统一从 af281r 构建产物启动，避免再次读错工作树。

## 8. 回滚

1. `.env` 设 `ADMIN_DEBUG_SESSION_REMOTE=off`，重启后端。
2. 行为回到纯文件模式，不校验远端表。
3. 需要撤表时执行 `pnpm migration:revert`；`down` 只删 `admin_debug_sessions`。

## 9. 提交信息

```text
feat(admin-debug): 调试会话远端持久化与历史导入 (AF-313)
```
