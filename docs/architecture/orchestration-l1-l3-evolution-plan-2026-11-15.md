# 编排工具链 L1→L3 演进落地方案（AF-005 / 006 / 007 / 008）

> 日期：2026-11-15　拟稿：主控 AI（Doubao）
> 文档性质：四条 backlog 框架演进项的**实施契约**。本备忘定义模块边界、数据模型、接口端口、依赖顺序、闸门与红线；运行时落本仓 adapter，框架仓只补规范 / schema / 示例。
> 与既有文档关系：`orchestration-l2-autonomous-pipeline-2026-11-15.md` 是当前 L2 承载现状；本备忘是其上的 L1 工具收口、L2 持久化 / watcher、L3 协议映射增量。
> 通用口径边界（2026-11-16 复核）：任务契约 / 状态机 / 工具契约 / 能力声明 / 交付包的字段与枚举一律以框架仓 v2.0.0（tag `v2.0.0`，commit `c507188`）为准（版本轴 `schemas/versions.json`，schema 共 6 份：task-sheet / task-state-index / tool-contract / agent-card / review-handover / delivery-package）；本文档保留为实施决策留档，与框架仓不一致时以框架仓为准。

---

## 1. 背景与已拍板结论

四条 backlog 任务单（`docs/worklog/pending/af005~008-*.md`）原标注"触发后另开 ready 子单"。2026-11-15 用户明确批准四条一并实施，含 AF-008 L3 协议适配（突破任务单"远期概念位、不提前实现"的原始备注；例外记录见 §9）。

选型决策（用户确认）：

| 决策点          | 结论                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AF-005 持久层   | Store 端口抽象 + JSON 文件后端（默认）+ SQLite 可选后端（config 开关）；不进业务 MySQL                                      |
| AF-008 协议形态 | 映射层 + Transport 端口接口 + 文件 Transport 默认实现；预留 MCP / HTTP 实现位，不实现、不引协议栈依赖                       |
| 分层落点        | 运行时全部落本仓 `scripts/orchestration/` adapter；框架仓保持纯规范层，只补 Markdown / JSON / schema / 示例，零脚本、零依赖 |

## 2. 分层与不变量

### 2.1 落点划分

| 层           | 仓库                            | 内容                                                      | 约束                                                                    |
| ------------ | ------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 通用规范层   | `agent-collaboration-framework` | 规范文档、JSON Schema、模板、中性示例                     | 零运行时、零脚本、零第三方依赖；不含项目取值 / 命令名 / 路径 / 业务实体 |
| 适配运行时层 | 本仓 `scripts/orchestration/`   | Store 后端、工具注册表、校验执行、watcher、协议映射运行时 | 项目特定取值只在此层；不改 `src/` / `test/` / `bin/` 业务代码           |

### 2.2 不变项（沿用框架 `evolution.md` §5）

1. 任务单字段组与必填性不变；2. 状态枚举与有效迁移不变；3. 回执七组字段不变；4. 验收五类与三级结论不变；5. 工件不可变与追溯规则不变；6. 角色隔离不变；7. 升级消息标准字段不变。

- 快照 / 索引 / 交付包既有字段只增不删；新增能力以附加字段承载。

## 3. 总体架构（增量）

```
scripts/orchestration/
  state-store.mjs        # 既有：JSON 文件持久化 + 原子写 + 租约
  acceptance-runner.mjs  # 既有：V2–V5 结构 / 枚举护栏（本轮扩 ajv schema 校验）
  scheduler.mjs          # 既有：队列扫描 / 领单 / 验收 / 返修 / 死信 / 快照
  delivery-pack.mjs      # 既有：交付包汇总
  improvement-log.mjs    # 既有：台账
  cli.mjs                # 既有：CLI 入口（本轮新增 validate / tools / watch / protocol 子命令）
  ── 本轮新增 ──
  store-port.mjs         # Store 端口接口；JSON 后端适配；SQLite 后端（可选开关）
  tool-registry.mjs      # 标准工具注册表：原语登记、角色白名单、副作用分级、调用审计
  validator.mjs          # ajv Draft 2020-12 schema 校验（任务单 / 索引 / 工具契约 / Agent Card）
  file-watcher.mjs       # 内置 fs.watch 监听回执 / 工件目录，触发一轮 run-once
  protocol-mapper.mjs    # 任务 / 状态 / 工件 / 归组标识 → 标准协议模型纯函数映射
  transport.mjs          # Transport 端口接口 + 文件 Transport 默认实现（预留其他实现位）
  audit-log.mjs          # 工具调用审计记录落盘（actorRef / correlationId / resources / sideEffect / recordedAt）

docs/team/agent-orchestration/
  tools/TOOL-*.json                # 一工具一文件（6 条工具契约，2.0.0 类别映射见适配层 README §4.1）
  agent-cards/*.json                # 2 份可路由角色卡（human 属 nonRoutableRoles，不产卡）
```

## 4. 逐条交付物

### 4.1 AF-006 · 机读校验工具固化（批次 1，先做）

**现状缺口**：`acceptance-runner.mjs` 的 V1 仅"工件存在非空 + 头部标识抽取"、V6 仅"字段与枚举合法"；未接 JSON Schema 校验；框架仓 schema 已齐备（task-sheet / task-state-index / tool-contract / agent-card 四份）。

**交付物**：

- `validator.mjs`：加载框架仓四份 schema（只读引用路径，不复制口径），用 ajv 8（Draft 2020-12）编译并校验；返回结构化错误清单（定位到文件 / 字段）。
- 护栏补齐：V1 任务单 schema、V2 索引 schema、V6 工具契约 schema 机读校验；Agent Card schema 校验纳入同一入口。
- 中性自检样例：`scripts/orchestration/__tests__/fixtures/` 内合法 / 非法样例各一，测试断言通过 / 报错。
- CLI：`pnpm orchestration:validate [--sheet|--index|--tools|--cards]`；失败退出码非 0。
- `acceptance-runner.mjs` 调用 `validator` 作为 schema 护栏子项，不替代既有人工复核列。

**依赖**：ajv 8 + ajv-formats（本仓 devDep，工具链校验用，不进 prod）。

### 4.2 AF-007 · L1 工具标准化注册表（批次 2）

**现状缺口**：规范层 `tools.md` + `tool-contract.schema.json` 已成型；本仓工具契约 6 条已登记；缺运行时工具注册表——权限收口、副作用分级判定、调用审计在工具层统一收口。

**交付物**：

- `tool-registry.mjs`：
  - `register(toolDef)`：按 tool-contract schema 登记标准原语；
  - `call(toolId, actor, payload, correlationId)`：角色白名单校验（未列角色拒绝）、副作用级别声明核对、调用经 `audit-log` 留痕；返回 IO 契约约定的结果 / 错误形态；
  - 内置标准原语映射：`workspace-read` / `workspace-write` / `gate-execution` / `version-control` / `retrieval` / `state-store` / `artifact-archive`（类别沿用 `tools.md` §2，不新增项目类别名）。
- `audit-log.mjs`：审计记录结构对齐 schema `audit` 字段组（actorRef / correlationId / resources / sideEffect / recordedAt）；落独立附加状态文件，不污染索引。
- 快照增量：`toolAudits[]` 最近审计条目只读投影（接现有 `buildSnapshot`）。
- 既有 CLI 动作（读索引 / 写索引 / 读工件 / 执行闸门 / 归档）经注册表调用；代理侧不持有底层凭据或内部句柄。

**不做**：工具并行调度的并发队列（L2 承载，列入 §10 遗留）；不实现协议适配（AF-008）。

### 4.3 AF-005 · L2 持久化端口 + SQLite 后端 + watcher（批次 3）

**现状缺口**：`state-store.mjs` 为 JSON 文件 + 原子写 + 租约；无 Store 端口抽象；无文件事件 watcher（现由 CLI `run-once` 或定时衔接）。

**交付物**：

- `store-port.mjs`：定义统一 Store 端口——`loadIndex()` / `saveIndex(index)` / `getTask(taskId)` / `claim(taskId, agent, leaseMinutes)` / `release(taskId)` / `listByStatus(status)` / `appendHistory(taskId, record)`。上层 scheduler 只经端口读写状态，不感知后端。
- JSON 后端：既有 `state-store.mjs` 能力适配为端口实现，保持默认；既有索引格式 / 字段语义不变。
- SQLite 后端：可选后端，config `store.backend = 'json' | 'sqlite'`（默认 `json`）；SQLite 库文件落在 `docs/team/agent-orchestration/` 附加状态目录；表结构只存指针 / 状态 / 租约 / history，工件正文仍留文件。优先内置 `node:sqlite`；若内置不可用，改用 `better-sqlite3` devDep（实施第一步探测并记录选型）。
- `file-watcher.mjs`：内置 `fs.watch` 监听回执 / 工件目录；事件去抖（debounce）后触发一轮 scheduler `run-once`；CLI `orchestration:watch` 长驻进程；watcher 失败不影响单次 `run-once`。
- L0 兼容：文件索引格式、快照口径、交付包结构不破坏；JSON 后端路径保持现行为默认，SQLite 后端可回切。

### 4.4 AF-008 · L3 协议映射层（批次 4）

**现状缺口**：`state-machine.md` §2 九态→标准大写状态映射表已存在；Agent Card / 工具契约 schema 已成型；缺任务 / 工件 / 归组标识到标准协议模型的映射运行时与传输端口。

**交付物**：

- `protocol-mapper.mjs`（纯函数，零副作用）：
  - `taskSheet → task`：任务单字段 → 标准任务模型；
  - `status → taskStatus`：复用 `state-machine.md` §2 映射（`backlog` / `ready` 为编排前置态，标准侧标 `DRAFT` / `QUEUED` 概念位，不另造标准状态值）；
  - `artifactRefs → artifactReferences`：工件指针 → 工件引用；
  - `contextId → groupId`；
  - `agentCard → capabilityDeclaration`：能力声明字段映射。
- `transport.mjs`：Transport 端口接口 `submitTask(task)` / `submitReceipt(receipt)` / `publishArtifact(ref)`；文件 Transport 为默认实现（写交接文件，对齐现状）；MCP / HTTP 实现仅留接口注释位，不实现、不引依赖。
- CLI `orchestration:protocol`：导出标准协议视图（快照 JSON 的协议映射段），只读。
- 快照增量：`protocolView` 段（映射后的标准模型只读投影）。

**红线**：厂商中立，不绑定特定代理协议 / 厂商 / 存储；模型不变只换传输层。

## 5. 框架仓侧变更（只增）

- 核对四份 schema 与本仓实际字段对齐；如缺附加字段（如工具 `audit.resources[]`），以可选附加字段补充，`additionalProperties: true` 保持开放。
- 补中性示例：工具契约审计记录样例、协议映射中性占位样例（如缺）。
- 规范文档如需补"Store 后端可插拔概念位""协议映射层端口概念位"，以章节追加，不改既有语义。
- 框架仓不新增任何脚本 / package.json / 依赖。

## 6. 依赖顺序与批次

| 批次 | 内容                                                           | 前置                               |
| ---- | -------------------------------------------------------------- | ---------------------------------- |
| 1    | AF-006 validator + CLI 校验入口 + 测试                         | 无                                 |
| 2    | AF-007 tool-registry + audit-log + 快照审计段                  | 批次 1（schema 护栏先于工具收口）  |
| 3    | AF-005 store-port + SQLite 后端 + file-watcher + CLI watch     | 批次 2（状态读写经工具注册表收口） |
| 4    | AF-008 protocol-mapper + transport + CLI protocol + 快照协议段 | 批次 2（契约模型先行）             |

每批结束跑定向 vitest + 对应闸门；全部完成后刷新快照 / 网页并补交付记录。

## 7. 数据模型要点

- **审计记录**（`audit-log`）：`{ actorRef, correlationId, toolId, resources[], sideEffect, recordedAt }`；关联 `taskId` 贯穿任务单 / 交付记录 / 回执 / commit。
- **Store 端口**：与既有 `state-store` 导出函数一一对应迁移；端口签名见 §4.3；后端切换对 scheduler 透明。
- **协议视图**：`protocolView = { tasks[], statusMap, artifacts[], groupId, capabilityDeclarations[] }`；全部为映射只读投影，不回写索引。

## 8. 闸门与验收

| 闸门        | 命令                                                                                 | 范围                                                                             |
| ----------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 类型检查    | `pnpm typecheck`                                                                     | 0 error（改动不进 `src/test` 运行时）                                            |
| Lint        | `pnpm lint` / `pnpm lint:fast`                                                       | 0 warning / 0 error                                                              |
| 定向测试    | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`        | 新增 store-port / registry / validator / mapper / watcher 断言；现有 22 例不破坏 |
| 编码 / JSON | 改动文件 `bom=False`、纯 LF；schema / 样例 / 快照 JSON 双解析通过                    | 沿用既有探测口径                                                                 |
| 边界        | `git diff --name-only`：`src/engine-core` / `src/migration` / 非编排 `src/` 计数为 0 | 零业务 diff                                                                      |

全量 vitest 仅收尾按需跑；本单改动不进 `src/test` 运行时，沿用基线 3381 例 / 201 文件（4 skipped）。

## 9. 红线与例外记录

- **AF-008 例外**：任务单原备注"远期概念位、L0/L1/L2 不提前实现"，经用户 2026-11-15 明确批准突破；本次仍遵守厂商中立与"不引协议栈依赖"约束，仅落地映射层 + 端口 + 文件 Transport。
- 契约只增不删；状态枚举 / 工件模型向后兼容。
- 通用层零业务耦合；工具副作用分级必须显式声明，不推断。
- 终态不可变；返修沿用同一 `contextId` 新开任务，不新增返修关联字段。
- 实施阶段不自动 commit / push；提交分组与闸门按交付标准执行（仓库 §2.4）。

## 10. 遗留与不在本单

- 工具并行调度并发队列（L2 承载，AF-007 规范子集）。
- 工作流引擎承接状态机 / 重试（L2 演进，超出 Store 端口范围）。
- MCP / HTTP 协议 Transport 实现与真实协议客户端 / 服务端。
- 业务库 MySQL 化编排状态（明确不做，避免耦合业务库）。
- `src/sample` / `foobar` / 样品 entity / passport demo 链路与孤儿依赖（V3 上线清理清单）。
