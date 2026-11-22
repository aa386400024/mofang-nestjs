---
taskId: AF-313
contextId: phase2.5-orchestration-closed-loop
title: Admin 调试会话远端持久化：MySQL 系统记录 + 本地文件缓存
type: implementation
status: backlog
baselineRef: 2095e0a75ecb6974d15d9dd07eba2ebab530df1a
dependsOn: []
priorTasks: [AF-312]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: "2026-11-22T20:55:00+08:00"
deadline: null
agentRole: executor
scope:
  files:
    - src/admin-debug/
    - src/quality/
    - src/migration/
    - bin/
    - test/admin-debug/
    - test/quality/
    - docs/runbooks/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
    - .env.example
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af313-admin-debug-remote-store-2026-11-22.md
    kind: report
  - name: 运维手册
    path: docs/runbooks/admin-debug-session-storage.md
    kind: report
gates:
  - command: pnpm exec vitest run test/admin-debug/debug-session-persistence.spec.ts test/admin-debug/debug-session-remote-mirror.spec.ts test/quality/quality-annotation-contract.spec.ts
    check: 调试会话文件回归 + 远端镜像契约 + 标注来源判定全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型闭合
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量回归
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: 输出为空
successCriteria:
  - 新增专用表 admin_debug_sessions，存完整调试会话 JSON 与列表投影列，不写 training_sessions / turn_debug_trace。
  - 远端开启时 MySQL 为系统记录；本地 data/debug-sessions 保留为写穿缓存与历史兼容，不破坏既有文件读路径。
  - list 合并远端与本地并按 updatedAt 取新；get 远端优先、缺失回落本地并回填缓存；remove 双侧删除。
  - 标注台逐字稿来源判定改用 DebugSessionStore.exists，远端已知 id 不因本机无文件而误判 missing。
  - 新增幂等导入 CLI，支持多源目录、dry-run、按 updatedAt 只升不降、输出逐项计数且不打印任何对话原文。
  - ADMIN_DEBUG_SESSION_REMOTE=on|off 可一键回滚；on 时表缺失启动即失败，off 时逐字回到本地文件模式。
  - 设计取舍与多机一致性、保留上限、备份、故障排查写进 docs/runbooks/admin-debug-session-storage.md 与交付记录。
  - 定向测试、lint、typecheck、全量测试全绿；engine-core 零改动。
  - 交付记录、机读回执、归档与受保护 PR 齐全。
---

# AF-313 · Admin 调试会话远端持久化：MySQL 系统记录 + 本地文件缓存

## 背景

`/auto-practice` 页面按 `ap_practice_sessions.debugSessionId` 请求 `GET /admin/api/debug/sessions/:id`，但调试会话正文目前只落在后端进程工作目录的 `data/debug-sessions/*.json`。远程 MySQL 里只有场次元数据，没有调试正文，于是出现“列表有 489 场、详情 404”的跨工作树/跨机器错配。

现状证据：目标会话 `debug_xw7uAJodsn6o3ln9FGL_Q` 的 JSON 在 `mofang-nestjs-af070/data/debug-sessions`，当前 3000 后端跑在旧工作树 `mofang-nestjs`，其目录只有 20 个文件，`getPersistedSession` 读不到即抛 404。三份 `.env` 的 `DB_HOST` 都是 `117.72.30.78/mofang_dev`，说明远程库已可用，缺的是调试正文的远端记录层。

原 AF-312 因 scope 超出 executor 资源域（含 docs/adr 与 package.json）被调度器拦截；本单为同内容重签发，改为 executor 角色并把 scoped 文件收敛到 src/bin/test/docs/runbooks/.env.example/worklog。

## 目标

1. 新增 `admin_debug_sessions` 专用表，MySQL 作为跨机器系统记录；完整记录 JSON 存 LONGTEXT，列表投影列单独存，避免列表页解析大字段。
2. 保留现有文件存储为写穿缓存与历史兼容层：远端开启时写远端再写本地，读远端优先、缺失回落本地并回填；远端关闭时逐字回到原文件行为。
3. `list` 合并远端与本地，按 `updatedAt` 取新，解决跨工作树/跨机器只看到一部分的问题。
4. 提供幂等导入 CLI，把现有所有工作树目录一次性回灌远端；默认 dry-run，按 `updatedAt` 只升不降。
5. 修标注台 `hasLiveFile` 的同机文件假设：改为 `DebugSessionStore.exists`，远端已知 id 不再误判 missing。
6. 企业级配套：运维手册、env 开关、保留上限、失败关闭、可回滚、可观测计数、测试与闸门。

## 非目标

- 不改 `src/engine-core/**`、Flutter、`admin-dashboard/**` 交互。
- 不把调试正文写进 `training_sessions` / `turn_debug_trace` 等正式训练表。
- 不做对象存储 / KMS / 应用层加密；本轮以专用表 + 数据库访问控制为边界，加密与密钥托管登记为后续技术债。
- 不做实时多写协同；同一场活跃会话仍由单进程持有，跨进程并发写不在本轮承诺范围。

## 边界

- 只改 `src/admin-debug/`、`src/quality/` 的必要接线、`src/migration/`、`bin/`、测试、`docs/runbooks/`、`.env.example` 与 worklog。
- 不打印任何对话原文；日志只出会话 id、计数、错误类型名。
- 远端开关关闭时必须与改动前行为逐字一致，保证可回滚。

## 验收

- 迁移可重复执行，表与实体列严格对齐；`bin/ormconfig.ts` 与 `src/migration/index.ts` 均已登记。
- 远端开启：新建会话、追加轮次、改名、完成/恢复、列表、详情、删除全部双写/双读正确。
- 远端关闭或测试无 DataSource：原文件测试不改断言仍全绿。
- 导入 CLI：dry-run 不写库；apply 幂等；重复跑计数稳定；损坏文件跳过并计数，不中断整批。
- 标注台来源判定在“本机无文件、远端有记录”时返回 live 而非 missing。
- 运维手册包含上线步骤、回滚步骤、备份与 404 排查清单。
