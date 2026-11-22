# AF-005 ~ AF-008 · 框架 L1/L2/L3 演进四批次落地 — 交付记录

- **状态**：✅ 四批次 adapter 运行时 + 框架仓规范 / schema / 示例只增变更落地（2026-11-15，本机闸门全绿；定向测试 48 passed）
- **基线 HEAD**：`eaf19c9`（与 `origin/integrate` 一致）
- **提交方式**：工作区改动待提交；按仓库纪律本单不自动 commit / push，草稿见 §六
- **方案契约**：`docs/architecture/orchestration-l1-l3-evolution-plan-2026-11-15.md`（分层不变量、逐条交付物、批次依赖、闸门、红线例外、遗留清单）

---

## 一、本单做了什么（一句话）

按方案 memo 分四批落地框架演进 backlog：AF-006 框架 schema 机读校验固化、AF-007 工具注册表收口 + 调用审计、AF-005 Store 持久化端口 + JSON/SQLite 双后端 + 文件 watcher、AF-008 协议映射层 + Transport 端口 + 文件默认实现；运行时全部落在本仓 `scripts/orchestration/` adapter，框架仓只补 schema 可选字段、中性示例与规范概念位，不新增脚本 / 依赖。

---

## 二、改动文件清单

### 2.1 批次 1 · AF-006 机读校验固化（`scripts/orchestration/`）

| 文件                          | 改动                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validator.mjs`（新增）       | ajv 8（Draft 2020-12，`ajv/dist/2020.js`）加载框架仓四份 schema（task-sheet / task-state-index / tool-contract / agent-card）做机读校验；schema 不可达时容错 `skipped=true` 不阻断；compile 前 `removeSchema` 规避同 `$id` 重复注册；导出 `validateTaskSheet / validateTaskIndex / validateTool / validateAgentCard / validateToolManifest` |
| `cli.mjs`                     | 新增 `validate` 子命令；`package.json` 增 `orchestration:validate` 脚本                                                                                                                                                                                                                                                                     |
| `__tests__/fixtures/`（新增） | 三份中性样例：合法 / 非法 task-sheet、合法 state-index                                                                                                                                                                                                                                                                                      |

### 2.2 批次 2 · AF-007 工具注册表 + 调用审计

| 文件                        | 改动                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-log.mjs`（新增）     | 审计只追加；去重签名不含时间戳（同 actor + correlationId + toolId + result 幂等）；`listAudits` 倒序 + 按工具过滤；`summarizeAudits` 按结果 / 工具 / 角色计数        |
| `tool-registry.mjs`（新增） | `buildRegistry` 校验契约（重复 toolId / 非法 sideEffect / 非法角色抛错）；`loadRegistry` 读清单容错空；`call` 做角色白名单校验并写审计；未注册 / 未授权返回 `denied` |
| `state-store.mjs`           | PATHS 增 `auditLog`（运行态，gitignore 忽略）                                                                                                                        |
| `scheduler.mjs`             | `buildSnapshot` 返回增 `toolAudits[]`（最近 15 条投影）与 `auditSummary`                                                                                             |
| `cli.mjs`                   | 增 `auditRegistryCall` 辅助；run-once / snapshot / pack 三处接线工具注册表；审计先于快照写入，使本轮快照即反映本轮调用                                               |
| `.gitignore`                | 忽略运行态 `tool-audit-log.json`                                                                                                                                     |

### 2.3 批次 3 · AF-005 Store 端口 + SQLite 后端 + watcher

| 文件                       | 改动                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store-port.mjs`（新增）   | Store 端口接口（loadIndex / saveIndex / getTask / listByStatus / claim / release / appendHistory）；JSON 后端复用既有 state-store（可注入内存读写以便隔离测试）；SQLite 后端（内置 `node:sqlite`，只存指针 / 状态 / 租约 / history，工件正文仍留文件）；`createStore(config, opts)` 工厂按 `store.backend` 选择；后端暴露 `close()` |
| `file-watcher.mjs`（新增） | `createWatcher({ dirs, onChange, debounceMs, onError })`：内置 `fs.watch` + 防抖聚合；纯函数 `dedupeEvents` 窗口内同路径去重计数；watcher 异常经 `onError` 上报，不影响单次 run-once；回调注入，不直接推进状态机                                                                                                                    |
| `state-store.mjs`          | PATHS 增 `sqliteDb`；`validateConfig` 增 `store.backend` 归一化与枚举校验（`json` 默认 / `sqlite`）                                                                                                                                                                                                                                 |
| `config.json`              | 增 `store.backend: "json"` 与说明 notes                                                                                                                                                                                                                                                                                             |
| `cli.mjs`                  | 新增 `watch` 长驻子命令（监听 pending / completed 目录，防抖后一轮 run-once，SIGINT / SIGTERM 优雅退出）；`package.json` 增 `orchestration:watch`                                                                                                                                                                                   |
| `.gitignore`               | 忽略运行态 `orchestration-store.sqlite`                                                                                                                                                                                                                                                                                             |

### 2.4 批次 4 · AF-008 协议映射层 + Transport

| 文件                          | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol-mapper.mjs`（新增） | 纯函数零副作用：`mapStatus`（对齐 `state-machine.md` §2，backlog→DRAFT / ready→QUEUED 编排前置概念位，其余映射 SUBMITTED / WORKING / INPUT_REQUIRED / COMPLETED / FAILED / CANCELED / REJECTED，未知→UNKNOWN）；`mapTask` / `mapArtifactReferences`（兼容对象与数组两种工件口径）/ `mapCapabilityDeclaration` / `mapGroupId`；`buildProtocolView` 聚合 tasks / statusMap / artifacts / groupId(首组) / groupIds(去重) / capabilityDeclarations |
| `transport.mjs`（新增）       | Transport 端口（`submitTask` / `submitReceipt` / `publishArtifact`）；文件 Transport 默认实现（交接 JSON 落 tasks / receipts / artifacts 子目录）；`createTransport` 工厂按 `transport.type` 选择；MCP / HTTP 仅留注释预留位，不实现、不引协议栈依赖，选中未实现类型抛明确错误                                                                                                                                                                 |
| `scheduler.mjs`               | `buildSnapshot` 返回增 `protocolView` 只读投影段                                                                                                                                                                                                                                                                                                                                                                                               |
| `state-store.mjs`             | PATHS 增 `transportDir`；`validateConfig` 增 `transport.type` 枚举校验（`file` 默认 / `mcp` / `http` 预留）                                                                                                                                                                                                                                                                                                                                    |
| `config.json`                 | 增 `transport.type: "file"` 与说明 notes                                                                                                                                                                                                                                                                                                                                                                                                       |
| `cli.mjs`                     | 新增 `protocol` 子命令（导出 protocolView 只读 JSON）；`package.json` 增 `orchestration:protocol`                                                                                                                                                                                                                                                                                                                                              |
| `.gitignore`                  | 忽略运行态 `transport/` 交接目录                                                                                                                                                                                                                                                                                                                                                                                                               |

### 2.5 快照产物（CLI 双写刷新）

| 文件                                                        | 改动                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/team/agent-orchestration/orchestration-snapshot.json` | 刷新：新增 `toolAudits` / `auditSummary` / `protocolView` 段 |
| `web/orchestration/data.js`                                 | 前端数据同步刷新（与 snapshot 同批 CLI 生成）                |

### 2.6 框架仓侧只增变更（独立仓库 `agent-collaboration-framework`，无脚本 / 无依赖）

| 文件                                              | 改动                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas/tool-contract.schema.json`               | `audit` 段补可选字段：`toolId / category / sideEffect / resources / taskId / result / reason`；保持 `additionalProperties: true`，既有 required 不变 |
| `examples/example-tool-audit-record.json`（新增） | 工具调用审计记录中性占位样例                                                                                                                         |
| `examples/example-protocol-view.json`（新增）     | 协议视图投影中性占位样例                                                                                                                             |
| `docs/evolution.md`                               | §3.3 补 Store 端口可插拔概念位；§3.4 补协议映射层 + Transport 端口概念位；§4 扩展位表补 Store 后端 / 传输通道两行；仅章节追加，不改既有语义          |

### 2.7 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/` 目录 —— **零 diff**（`git diff --name-only HEAD -- src/engine-core src/migration` 为空）。
- 批次 3 / 4 **未引入新第三方依赖**；批次 1 仅新增 devDep `ajv` / `ajv-formats`（工具链校验用，不进 prod）。
- SQLite 选用内置 `node:sqlite`（Node v22.23.2 提供 `DatabaseSync`，仅 ExperimentalWarning），**未引 better-sqlite3 原生依赖**。
- 快照 / 契约只增字段，既有字段不删（向后兼容）；通用层不含项目目录名 / 命令 / 工具名 / 业务实体，项目取值只出现在本仓 adapter。

### 2.8 任务单归档

| 文件                                                                                         | 改动                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `docs/worklog/pending/af005~008-*.md`（四份）                                                | 移入 `docs/worklog/completed/phase2.5/`；frontmatter `status: backlog → completed`；状态行指向本交付记录；§7 回写清单勾选 |
| `docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md` | 本交付记录（新增）                                                                                                        |

### 2.9 显式排除的产物（不纳入本单 stage）

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（Judge Layer 备忘，并行线产物）。
- 运行态文件（已 gitignore，不入库）：`tool-audit-log.json`、`orchestration-store.sqlite`、`transport/`。
- 上一阶段看板升级遗留未提交产物（与本批分开 stage）：`improvement-log.mjs`、`web/orchestration/*`、`open-web.mjs`、`__tests__/fixtures/`（看板部分）、`delivery-packs/`、看板升级交付记录 md。

---

## 三、关键决策与偏差

1. **SQLite 后端**：优先内置 `node:sqlite`，避免原生编译依赖；仅存指针 / 状态 / 历史，不存工件正文，不进业务 MySQL（方案 §4.3 红线）。
2. **审计时序**：审计记录先于快照写入，使本轮快照即可反映本轮工具调用；watcher 触发的轮次同样经注册表记审计。
3. **Store 端口落地范围**：端口接口 + JSON / SQLite 双后端 + 工厂已成型；JSON 后端内部复用既有 state-store 保持 L0 行为等价。scheduler 现有调用点暂未整体切换到端口（避免回归），整体切换列入后续遗留。
4. **协议视图归组字段**：同时输出 `groupId`（首个 contextId）与 `groupIds`（去重数组），兼容单组展示与多组聚合。
5. **AF-008 例外留痕**：任务单原备注为"远期概念位、L0/L1/L2 不提前实现"，经用户 2026-11-15 明确批准突破；仍遵守厂商中立 + 不引协议栈依赖，仅落地映射层 + 端口 + 文件 Transport。

---

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                  |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                               |
| `pnpm lint`（`eslint --cache {src,test,bin}/**/*.ts`）                        | 0      | 0 warning / 0 error                                                                   |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                                        |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 48 passed（基线 22 + AF-006 5 + AF-007 10 + AF-005 4 + AF-008 7）                     |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.json` 均 `bom=False`、`cr=0`；框架仓两份示例与 schema JSON 双解析通过 |
| 框架仓 JSON 校验                                                              | —      | `tool-contract.schema.json`、两份示例 `ConvertFrom-Json` 全部通过                     |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线 **3381 例 / 201 文件（4 skipped）**，收尾不重跑全量。
- **快照实测**：protocolView `tasks=25`、`artifacts=59`、`groupIds=["framework-evolution"]`、`capabilityDeclarations=3`、`statusMapKeys=10`；AF-005（backlog）映射 `protocol=DRAFT`。
- **CLI 试跑**：`status` / `help`（含 watch / protocol 行）/ `snapshot` / `protocol` 退出码 0；`watch` 为长驻进程，未在闸门中挂起运行。

---

## 五、遗留与未决（方案 §10 及既有 backlog）

- **Store 端口整体切换**：scheduler / CLI 现有 state-store 直接调用点迁移到端口；端口抽象与双后端已就位。
- **工具并行调度并发队列**：L2 承载，本单不做。
- **工作流引擎承接状态机 / 重试**：后续演进。
- **MCP / HTTP 真实 Transport** 与真实协议客户端 / 服务端：预留位，本批次不实现。
- **业务库 MySQL 化编排状态**：明确不做（编排状态留 adapter 本地文件 / 可选 SQLite）。
- **V3 上线清理清单**：`src/sample`、`foobar`、样品 entity、passport demo 链路、`prompts` / `rimraf` / `@types/prompts` 孤儿依赖。
- **P-DEBT-21 / IM-003**：prod 5 moderate 传递依赖升级；受既有约束（版本变动须附全量绿跑 + 墙钟数字），本单不实施。
- **IM-002 终态 `done`**：待归档提交后由编排闸门流转。

---

## 六、提交草稿（按仓库纪律不自动执行）

建议分两个仓库分别提交；本仓按"框架演进 adapter"与"上一阶段看板产物"分组，避免混进同一 commit。

本仓建议合并单 commit（框架演进 adapter 组）：

```
feat(orchestration): implement AF-005~008 framework evolution adapter (validation, registry audit, store port, protocol mapping)

- AF-006: ajv schema validation against framework contracts with skipped-on-missing fallback
- AF-007: tool registry with role allow-list, call audit log and snapshot audit projection
- AF-005: store port with JSON/SQLite backends, file watcher with debounced run-once
- AF-008: pure-function protocol mapper, transport port with file transport, protocolView snapshot segment

Scope: scripts/orchestration adapter, config, snapshot/data refresh; zero src/engine-core, src/migration, business code diff.
```

框架仓建议单 commit（规范层只增）：

```
docs(framework): add audit record optional fields, audit/protocol-view examples, store-port and transport-port concept slots

Scope: tool-contract schema audit properties, two neutral examples, evolution.md concept slots only; no scripts, no dependencies.
```

### Stage 清单（本仓，排除并行线与运行态产物）

框架演进 adapter 组：

- `scripts/orchestration/validator.mjs`、`audit-log.mjs`、`tool-registry.mjs`、`store-port.mjs`、`file-watcher.mjs`、`protocol-mapper.mjs`、`transport.mjs`
- `scripts/orchestration/state-store.mjs`、`scheduler.mjs`、`cli.mjs`、`config.json`
- `scripts/orchestration/__tests__/orchestration.spec.mjs`、`__tests__/fixtures/`
- `package.json`、`pnpm-lock.yaml`、`.gitignore`
- `docs/architecture/orchestration-l1-l3-evolution-plan-2026-11-15.md`
- `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js`
- 任务单归档（git 表现为 pending 四份 `D` + completed 四份 `??`，同一移动）：`docs/worklog/completed/phase2.5/af005-008-framework-evolution-implementation-2026-11-15.md`、`af005-` / `af006-` / `af007-` / `af008-` 四份任务单；删除 `docs/worklog/pending/` 同名四份

上一阶段看板产物组（另一个 commit，不在本批说明内展开）：

- `scripts/orchestration/improvement-log.mjs`、`open-web.mjs`、`web/orchestration/app.js`、`index.html`、`styles.css`、`docs/team/agent-orchestration/delivery-packs/`、看板升级交付记录 md

**不 stage**：`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`；`tool-audit-log.json`、`orchestration-store.sqlite`、`transport/`（gitignore 运行态）。
