# Admin 调试会话存储运维手册（AF-313）

> 适用对象：维护 `admin-dashboard` 调试对练/标注台的研发与运维。
> 目标：调试会话正文不再只落在某一台机器、某一个工作树的本地 JSON，而是以远程 MySQL 为系统记录，跨机器、跨工作树可读。
> 隐私红线：`record_json` 含咨询师与来访者完整对话原文。任何日志、截图、工单、IM 都不得输出正文；只允许输出会话 id、计数、错误类型名。

---

## 1. 架构与数据流

```
写:  admin 调试接口
       → DebugSessionStore
       → [远端开启] DebugSessionMirror.upsert → MySQL `admin_debug_sessions`（先写）
       → 本地 `<ADMIN_DEBUG_SESSION_DIR>/<id>.json`（写穿缓存，后写）
       → 本地按 createdAt 保留最近 N 条

读详情: DebugSessionStore.get(id)
       → [远端开启] MySQL 优先 → 命中后回填本地缓存
       → MySQL 无记录 → 回落本地文件（兼容未导入的历史）

列表:  DebugSessionStore.list()
       → 本地摘要 + 远端摘要合并
       → 同 id 取 updatedAt 更新的一份，按 createdAt 倒序

删除:  远端删除 + 本地删除，至少一侧成功即 true
```

设计取舍：

- **专用表，不混正式训练表**。调试会话不写 `training_sessions` / `turn_debug_trace`，避免污染训练数据与统计口径。
- **大字段与列表投影分离**。完整 JSON 存 `record_json LONGTEXT`；列表只查投影列（`title/status/turn_count/created_at/updated_at` 等），列表页不解析大字段。
- **文件仍是缓存，不是唯一真相**。远端开启时 MySQL 是系统记录；文件只用于加速、兼容旧读路径与离线回滚。
- **不做对象存储 / KMS / 应用层加密**。本轮边界是专用表 + 数据库访问控制；加密与密钥托管登记为后续技术债。
- **不承诺跨进程并发写**。同一场活跃会话仍由单进程持有；多实例同时写同一 id 不在本轮范围。

---

## 2. 配置项

| env | 缺省 | 说明 |
| --- | --- | --- |
| `ADMIN_DEBUG_SESSION_REMOTE` | `on` | `on`：MySQL 系统记录 + 本地写穿缓存；`off/false/0/no`：纯文件模式（回滚开关） |
| `ADMIN_DEBUG_SESSION_MAX` | `500` | 保留上限，夹在 `1..10000`。DB 模式建议 `2000+`，避免导入历史后首次 create 淘汰老基线 |
| `ADMIN_DEBUG_SESSION_DIR` | `data/debug-sessions` | 本地缓存目录；相对路径按进程工作目录解析 |

`.env.example` 已声明前两项。真实 `.env` 需按部署补齐；改完必须重启后端进程。

---

## 3. 首次上线步骤

1. **备份**
   - 备份远程库 `mofang_dev` 的 `admin_debug_sessions`（若已存在）与 `migrations` 表。
   - 备份现有 `data/debug-sessions` 目录；至少保留一份只读快照。
2. **执行迁移**
   ```powershell
   pnpm migration:show
   pnpm migration:run
   ```
   预期看到 `CreateAdminDebugSessions1714900000049` 从 `[ ]` 变 `[X]`。迁移只建表，不写数据。
3. **配置 env**
   ```dotenv
   ADMIN_DEBUG_SESSION_REMOTE=on
   ADMIN_DEBUG_SESSION_MAX=2000
   ```
4. **导入历史文件（先 dry-run）**
   ```powershell
   pnpm exec tsx bin/import-debug-sessions.ts `
     --source D:\work\Project\backend\mofang-nestjs-af070\data\debug-sessions `
     --source D:\work\Project\backend\mofang-nestjs-af152-minimax\data\debug-sessions `
     --source D:\work\Project\backend\mofang-nestjs\data\debug-sessions
   ```
   默认 dry-run，不写库。确认 `invalid=0 failed=0` 后追加 `--apply`。
   - `--overwrite`：强制覆盖远端新记录；默认按 `updatedAt` 只升不降。
   - `--max N`：导入完成后按 `created_at` 保留最近 N 条。
   - 导入 CLI 强制 `logging: false` + `maxQueryExecutionTime: 0`，不输出 SQL 参数与正文。
5. **重启后端**（必须是目标工作树构建出的进程）
   ```powershell
   pnpm build
   pnpm start
   ```
6. **验收**
   - 打开 `/auto-practice`，目标场次详情应能拉到对话，不再 404。
   - `GET /admin/api/debug/sessions` 的列表应包含远端历史 id。
   - 标注台该 id 的 `hasLiveFile` 应为 live，而不是 missing。

---

## 4. 回滚步骤

1. 把 `ADMIN_DEBUG_SESSION_REMOTE` 改为 `off`（或删除该行，缺省为 on，因此必须显式 `off`）。
2. 重启后端。
3. 行为回到改动前：只读本地文件，启动不校验远端表是否存在。
4. 如需彻底撤销表结构：确认无业务读依赖后执行
   ```powershell
   pnpm migration:revert
   ```
   `down` 只删 `admin_debug_sessions`，不影响其他表。

回滚期间不要删除本地 `data/debug-sessions`，它是纯文件模式下的唯一数据源。

---

## 5. 404 排查清单

按顺序核对，任一项不成立都会表现为“列表有场次、详情空白/404”：

1. **场次元数据在哪个库**：`ap_practice_sessions` 是否来自当前后端连接的远程 MySQL（`DB_HOST/DB_NAME`）。
2. **`debugSessionId` 是否非空**：目标行 `zgdBLq4hL3lfcTu9cufeA` → `debug_xw7uAJodsn6o3ln9FGL_Q`。
3. **远端表是否有该 id**
   ```sql
   SELECT id, title, status, turn_count, updated_at
   FROM admin_debug_sessions
   WHERE id = 'debug_xw7uAJodsn6o3ln9FGL_Q';
   ```
4. **当前后端进程的工作树**：`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select CommandLine`。跑旧工作树的 `dist/app` 时，它读的是旧工作树的 `data/debug-sessions`。
5. **本地缓存目录**：`ADMIN_DEBUG_SESSION_DIR` 解析后的绝对路径下是否存在 `<id>.json`。
6. **远端开关**：`ADMIN_DEBUG_SESSION_REMOTE` 是否为 `on`；`off` 时不会查远端。
7. **启动是否 fail-closed**：远端 `on` 但表缺失时 `onModuleInit` 会直接抛错，进程起不来。先跑 `pnpm migration:show`。
8. **前端代理**：`admin-dashboard/vite.config.ts` 的 `/admin/api` 是否代理到当前 3000 端口。

---

## 6. 备份与恢复

- **逻辑备份**：`mysqldump` 单表导出 `admin_debug_sessions`。该表含心理对话原文，备份文件必须按敏感数据管理（加密存储、最小权限、限定保留期）。
- **恢复**：先停写（停后端或 `REMOTE=off`），再导入备份，最后启动并抽查 3 个 id 的 `content_sha256` 与 `record_bytes`。
- **本地缓存**：可随时从远端重建；不要把它当作备份。
- **容量**：576 条历史约 161MB 文件，`record_json` 平均约 280KB、最大约 950KB。按 `ADMIN_DEBUG_SESSION_MAX` 估算表容量，并预留 `LONGTEXT` 的页外存储。

---

## 7. 可观测与故障处理

- 启动日志只应出现 `DebugSessionStore` 的通用告警；出现 `调试会话文件内容不可解析` 时，说明本地坏文件被跳过，不影响列表。
- 远端 `upsert/get/list/remove` 失败会抛出，由上层接口返回错误；日志只记录 id 与错误类型名。
- 常见错误：
  - `ER_NO_SUCH_TABLE`：迁移未执行或连错库。
  - `ER_DATA_TOO_LONG`：`record_json` 超出 `LONGTEXT`（理论上不会，单条 <1MB）。
  - `ER_LOCK_WAIT_TIMEOUT`：并发导入或大事务；改为分批源目录导入。
  - `ECONNREFUSED` / `ETIMEDOUT`：远程 DB 网络或安全组。
- **禁止**为了排障打开 `DB_QUERY_LOGGING=true` 后跑导入；导入 CLI 已硬编码关闭 SQL 日志。应用侧如需开 query log，必须先确认不会落正文。

---

## 8. 已知技术债

1. **应用层加密与密钥托管**未做；当前依赖 DB 访问控制与网络边界。后续单独立项评估 KMS/列级加密。
2. **跨进程并发写**未做乐观锁；同一 id 多实例同时写可能后写覆盖。当前同一活跃会话由单进程持有。
3. **列表分页**仍是一次性合并后返回；数据量继续增长时应改为远端分页 + 本地增量。
4. **导入非事务批处理**；单条失败不中断整批，但不会回滚已成功记录。重复执行幂等。
5. **`ADMIN_DEBUG_SESSION_MAX` 双口径**：远端按 `created_at` prune，本地也按 `created_at` prune；两者独立，可能出现远端有、本地已淘汰（读时回填）。
