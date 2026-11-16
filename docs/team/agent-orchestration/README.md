# mofang-nestjs 协作适配层（Project Adapter）

> 本目录是接入通用 **agent-collaboration-framework** 的项目适配层。
> 通用规则（角色模型、任务契约、状态机、回执契约、验收口径、可靠性、上下文与记忆、安全策略、人在环、演进路线）的唯一真相源在框架仓，本文件**只声明本项目的特定取值**（目录映射、角色绑定、工具与闸门命令、策略锚点、框架版本依赖），不复制通用规则正文。
>
> - 框架仓本地路径：`D:\work\Project\agent-collaboration-framework`（本地独立 git 仓 + 版本 tag `v2.0.0`（commit `c507188`）；无包管理器分发，故以仓路径 + 契约 `contractRef` urn 双轨引用）
> - 适配层声明规范：框架仓 `adapters/README.md`（六类映射项）
> - 代码红线、命令规范、分层归属：`docs/team/conventions.md`；任务单模板：`docs/team/wp-task-template.md`，不在此重复。

---

## 1. 标识与框架版本依赖

| 项                      | 值                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`             | `mofang-nestjs`（心塑 / XinSu 后端 NestJS 仓）                                                                                                                                                                                   |
| `frameworkVersionRange` | `>=2.0.0 <3.0.0`                                                                                                                                                                                                                 |
| 框架版本                | `2.0.0`（本地 git tag `v2.0.0` → commit `c507188`，releasedAt `2026-11-16`；版本轴见框架仓 `schemas/versions.json`）                                                                                                             |
| 框架契约版本            | 任务单 `1.1.0` / 状态索引 `1.1.0` / 工具契约 `1.1.0` / Agent Card `1.1.0` / 交付包 `1.0.0` / 回执 `1.0.0` / review 交接件 `1.1.0`（逐项见框架仓 `schemas/versions.json`）                                                        |
| 契约引用形式            | 实例内用 `contractRef` / `schemaRef` 的 urn 声明（`urn:agent-collaboration-framework:schema:<contract>:<version>`），不写裸版本号                                                                                                |
| `unknownEnumPolicy`     | `tolerant`（框架 2.0.0 兼容声明要求；未知枚举值按保留值透传并记人工复核，不静默丢弃、不擅自映射。状态轴由 `protocol-mapper.mjs` 列入 `unknownStatuses`，交付包落入 `leftovers.manualReviewList`）                                |
| 枚举投影                | `scripts/orchestration/contract-enums.json` 为框架仓 `schemas/contract-enums.json`（2.0.0）的 vendored 投影，随本仓评审；一致性由 `orchestration.spec.mjs` 跨仓对账                                                              |
| 契约供应链              | `contracts/agent-collaboration-framework/2.0.0/`（14 份框架 2.0.0 schema 的不可变副本 + `PROVENANCE.json` 逐文件 SHA-256）；CI `Contracts` job 以 `ORCH_REQUIRE_FRAMEWORK=1` 硬校验，缺框架直接 fail-fast，不允许 skipped 软通过 |

> 2.0.0 与本适配层的历史差异已在本轮迁移中一次性收口：任务单 `status` 降级为立项快照、时间字段改带偏移 `date-time`、工具声明改**一工具一文件**、`human` 移出可派发角色、归档条目关闭附加字段（归档说明外移到 `archivedNotes`）、交付包改用 `delivery-package` 1.0.0 结构。破坏性变更（字段删除或语义改变）仍须先复核本表再升级；既有字段只增不删。
>
> `archivedNotes` 是**适配层扩展字段**（`task-state-index` schema 顶层 `additionalProperties: true` 允许），键为 `taskId`、值为 1.x 归档说明原文，只读保留、不做二次改写；框架未定义该字段，若后续框架定义归档说明槽位则以框架为准对齐。AF-020 起该字段外移到 `state/archived-notes.json`，索引中的 `archivedNotes` 只是从日志重建时的合并投影，禁止手改。

## 2. 角色绑定（roleBindings）

框架角色枚举与隔离规则见框架仓 `docs/roles.md`；本表只声明本项目的执行方映射与兼任制衡。框架 2.0.0 的可派发角色为 `roles` 五值（`orchestrator / executor / reviewer / researcher / critic`），`human` 属 `nonRoutableRoles`——人工只作审批节点，不参与路由、不产出 Agent Card（故 `agent-cards/` 下无 `human.json`，人工边界声明见 `agent-cards/README.md`）。

| 框架角色                      | 本项目执行方            | 是否兼任             | 兼任制衡手段                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Human`（`nonRoutableRoles`） | 用户（大炮）            | —                    | 目标与方向；审批 L4 冻结动作（master 合并、tag、release、对外部署、策略 / 红线例外、技术路线选型、跨任务架构变更、验收分歧、新增未声明依赖）；不实现工作单元、不参与任务路由。L1–L3 提交与推送不依赖 Human 批准（分层口径见 [设计备忘 §6.1](autonomous-team-design.md#61-发布分层自动化逐层收紧)） |
| `orchestrator`                | 主控 AI（Doubao）       | —                    | backlog 维护、任务拆解与切片、优先级与依赖、派发、claim 管理、验收组织、归档与索引回写、超时释放、升级判定；验收后执行 L1 任务分支提交、L2 推任务分支、L3 合并进 integrate（前置条件见 §6.1/§6.2）；L4 冻结动作转人工；不写业务实现、不扩任务范围                                                  |
| `executor`                    | 执行 AI（MiniMax Code） | —                    | 按任务契约实现、内循环自测、收尾闸门、写交付记录与偏差表、按约定回执；不扩范围、不改策略边界、不新增依赖；不建分支、不提交、不推送（提交归 orchestrator，见 §6.1 L1）                                                                                                                              |
| `reviewer`                    | 主控 AI（Doubao）       | 与 orchestrator 兼任 | 验收结论只能基于工件证据与抽跑复现，不引用执行侧「已通过」的自述；验收阶段不改代码，新问题另开任务                                                                                                                                                                                                 |
| `researcher` / `critic`       | 当前未启用              | —                    | 框架角色保留，需要调研或独立评审任务时再绑定                                                                                                                                                                                                                                                       |

## 3. 目录映射（directories）

| 映射项                             | 本项目落点                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directories.taskSheets`           | `docs/worklog/pending/`（`ready / submitted / working` 任务单）                                                                                               |
| `directories.deliveryRecords`      | `docs/worklog/completed/<phase>/`（任务单 + 交付记录成对归档，只读历史）                                                                                      |
| `directories.replyArchive`         | `docs/worklog/pending/archive/`（回执原文、中间产物归档）                                                                                                     |
| `directories.artifacts`            | 各任务单切片范围内的源码 / 测试 / 规格路径；工件正文留在各自文件                                                                                              |
| `directories.stateIndex`           | `docs/team/agent-orchestration/task-state-index.json`（**只读投影**，带 `projection` 指向日志末条事件；禁止手改）                                             |
| `directories.stateJournal`         | `docs/team/agent-orchestration/state/journal.jsonl`（**唯一写面**，append-only 事件日志；`state-event:1.0.0` + SHA-256 哈希链）                               |
| `directories.stateArchivedNotes`   | `docs/team/agent-orchestration/state/archived-notes.json`（归档说明侧车，重建时合并进索引 `archivedNotes`）                                                   |
| `directories.runtimeState`         | `docs/team/agent-orchestration/orchestration-state.json`（L2 运行态，首次 run-once 生成）                                                                     |
| `directories.snapshot`             | `docs/team/agent-orchestration/orchestration-snapshot.json`（队列快照，网页数据源）                                                                           |
| `directories.improvementLog`       | `docs/team/agent-orchestration/improvement-log.json`（候选改进台账；口径见 `improvement-loop.md`）                                                            |
| `directories.deliveryPacks`        | `docs/team/agent-orchestration/delivery-packs/`（夜间交付包汇总目录）                                                                                         |
| `directories.orchestrationScripts` | `scripts/orchestration/`（L2 工具链实现；工具契约声明见 `tools/<TOOL-ID>.json`，一工具一文件）                                                                |
| `directories.tools`                | `docs/team/agent-orchestration/tools/`（工具契约声明目录，框架 2.0.0 单对象口径，目录即清单）                                                                 |
| `directories.agentCards`           | `docs/team/agent-orchestration/agent-cards/`（本项目代理能力声明 JSON）                                                                                       |
| `directories.handoverTransport`    | `docs/team/agent-orchestration/transport/`（运行态交接件：`tasks/` 任务契约、`receipts/` 回执、`reviews/` 协商轮意见、`artifacts/` 工件指针；gitignore 忽略） |

四类落点互不重叠；任务单与交付记录成对归档；状态索引纳入 git 版本控制，保证崩溃后可重建。工件正文留在各自文件，状态索引只存**指针与状态**，不复制正文（见框架仓 `docs/task-contract.md` 工件模型）。运行态、快照、交付包与脚本目录为适配层扩展映射项，不进通用层 schema。

## 4. 工具与闸门命令（tools / gates）

工具类别、声明结构、IO 契约与调用审计见框架仓 `docs/tools.md`；工具副作用分级、敏感操作审批节点见框架仓 `docs/security-and-policy.md`；本项目命令口径固定如下，详细分层闸门见 `docs/team/wp-task-template.md` §5。

| 项                         | 本项目取值                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 包管理器                   | `pnpm`（`packageManager=pnpm`）；禁止裸 `npx`；跑脚本 `pnpm <script>`，跑二进制 `pnpm exec <bin> <args>`                                                                                                                                                                                                                                                                     |
| 内循环                     | `pnpm lint:fast` / `pnpm lint:deep` / `pnpm typecheck` / 单文件 `pnpm exec vitest run <file>` / `pnpm test:changed` / `pnpm test:related -- <file>`                                                                                                                                                                                                                          |
| 收尾全量（每任务一次）     | `pnpm typecheck`、`pnpm lint`、`pnpm test`；另跑 `git diff --stat HEAD -- src/engine-core` 核对内核边界                                                                                                                                                                                                                                                                      |
| 验收侧                     | 定向测试 + 关键路径抽跑 + 触碰文件快速复查 + 边界核对 + 范围核对；不重跑全量（升级全量的条件见模板 §5.4）                                                                                                                                                                                                                                                                    |
| 前端闸门（仅授权前端任务） | 在 `admin-dashboard/` 目录跑 `pnpm type-check` / `pnpm build-only`，不套用后端 tsc / eslint                                                                                                                                                                                                                                                                                  |
| 敏感操作                   | L4 冻结动作（master 合并、tag、release、对外部署、策略例外、路线选型、跨任务变更、验收分歧、新增未声明依赖）绑定 Human 批准；L1 任务分支提交、L2 推任务分支、L3 合并进 integrate 在闸门绿 + 验收五类通过等前置条件下由 orchestrator 自动（分层口径见 [设计备忘 §6.1](autonomous-team-design.md#61-发布分层自动化逐层收紧)，过渡口径 §6.2）；engine-core 例外改动仍需人工批准 |

L2 编排工具链（状态存储、验收护栏、调度器、交付包、候选改进台账、CLI）的契约声明在 `tools/<TOOL-ID>.json`（一工具一文件，字段 `toolId / category / sideEffect / allowedRoles / resources / contractRef`），实现位于 `scripts/orchestration/`，注册与授权收口于 `tool-registry.mjs`。自治模式关闭时，`run-once` 只生成只读快照，不执行领单、验收归档与返修等状态迁移；开启须经 `pnpm orchestration:config --enable` 显式操作。改进台账命令：`pnpm orchestration:improvements`（list / `--extract` / `--add` / `--transition`），闭环口径见 `improvement-loop.md`。事件溯源命令：`pnpm orchestration:events`（`verify` / `rebuild` / `backfill` / `create`）；契约包校验：`pnpm orchestration:contracts`。所有状态写入必须经 `commitIndex` / `archiveTask` / `createTask`，不得直接改索引。

### 4.1 工具类别映射（框架 8 值 `toolCategories` → 本项目工具）

框架 2.0.0 把工具类别收为 8 值枚举，历史类别（`state-persistence` / `acceptance-gate` / `queue-scheduler` / `delivery-packing` / `knowledge-capture` / `orchestration-cli`）已不在枚举内。本项目按下表重映射，理由同表：

| 工具标识                 | 原类别（1.x）       | 现行类别（2.0.0）  | 映射理由                                                                         |
| ------------------------ | ------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `TOOL-STATE-STORE`       | `state-persistence` | `state-store`      | 读写状态索引与运行态，是唯一状态写面                                             |
| `TOOL-QUEUE-SCHEDULER`   | `queue-scheduler`   | `state-store`      | 调度结果落运行态与索引，本质仍是状态迁移写操作（非独立类别）                     |
| `TOOL-ORCH-CLI`          | `orchestration-cli` | `state-store`      | CLI 是状态面的命令入口，副作用随其调用的状态操作，不另立类别                     |
| `TOOL-IMPROVEMENT-LOG`   | `knowledge-capture` | `state-store`      | 候选改进台账是带状态机的受控台账（candidate→queued→accepted→done），按状态面归类 |
| `TOOL-ACCEPTANCE-RUNNER` | `acceptance-gate`   | `gate-execution`   | 执行验收闸门（V1–V6 机读项），只读判定，不改业务代码                             |
| `TOOL-DELIVERY-PACK`     | `delivery-packing`  | `artifact-archive` | 生成并归档夜间交付包（工件汇总与指针），属工件归档类                             |

副作用级别保持原值（`restricted-write` / `read-only`）；角色白名单保持原值（仅 `orchestrator` 可调有副作用的工具，`TOOL-ACCEPTANCE-RUNNER` 另开放 `reviewer`）。

### 4.2 交付包取值口径（`delivery-package` 1.0.0）

- `cycle.mode`：自治开关关闭 → `human-in-the-loop`；开启 → `human-on-the-loop`（枚举仅此两值）。
- `cycle.stopReason`：手工 `run-once` 生成的包记 `human-stop`；自治循环队列排空记 `queue-empty`（其余 `limit-reached` / `circuit-open` 由对应触发点写入）。
- `cycle.queueSize`：循环开始时队列规模（整数，取快照各状态计数之和）。
- `tasks[]` 只收录 **工件指针齐全**（`artifactRefs.taskSheet` + `artifactRefs.deliveryRecord`）的终态任务；指针不全的终态任务不虚构路径，其结论只体现在 `counts`，缺口写入 `meta.pointerGaps`。
- `pendingApprovals[].node` 统一记 `sensitive-action`（冻结动作即敏感操作），细分原因在 `action` 与运行态 escalation 中留存。
- `leftovers` 由 `backlogItems` / `openQuestions` / `manualReviewList` 三个字符串数组组成，替代 1.x 的扁平 `openItems`；旧包结构整体保留在 `legacy` 字段，便于回溯。
- 包体是工件，只存指针与汇总，不复制工件正文；生成器在落盘前按 `delivery-package` schema 自检（不合规直接抛错，不产出工件）。

## 5. 轮询档位（relay 轮询节奏与兜底次数）

轮询节奏按任务规模分三档。档位取值属**适配层编排口径**，不进通用层 schema。

| 档位 | 预估时长                          | deadline 缓冲 | 兜底检测次数 |
| ---- | --------------------------------- | ------------- | ------------ |
| S    | 10–15 min                         | +10–15 min    | 1            |
| M    | 20–30 min                         | +20–30 min    | 2            |
| L    | 40–60 min（类推缩短，不拉长窗口） | +30–45 min    | 2–3          |

- 平台 cron 最小间隔为 1 小时；分钟级自适应间隔属本地常驻 watcher（框架演进 backlog），本形态不实现。
- L 档的预估时长按同类任务类推缩短，不拉长观察窗口；缓冲与兜底次数一律取上表值，不另设分支。
- 本节是档位与阈值的唯一真相源：任务单模板与其他文档只引用，不复制数字。

## 6. 策略锚点（policyAnchors）

任务单 `policyRefs` 只引用锚点，不复制规则正文；规则唯一真相源是 `docs/team/conventions.md`。

| 锚点                 | 文件                                                   | 规则摘要                                                                                                                                 | 机读                                |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `conventions.md#1.1` | `docs/team/conventions.md`                             | engine-core 按「纯计算 vs 副作用」分层；内核禁 NestJS / IO / prompt / 模型名 / 心理原文 console；`boundary.spec.ts` 为机器护栏，不许自改 | 部分（`boundary.spec.ts` AST 断言） |
| `conventions.md#1.2` | `docs/team/conventions.md`                             | 前端边界：默认不碰 `admin-dashboard/` 与 Flutter；授权前端任务只写与任务单不冲突的部分；命令边界见 §1.2                                  | 否                                  |
| `conventions.md#1.3` | `docs/team/conventions.md`                             | 命令规范：pnpm 优先、禁裸 npx；不跑 Flutter 命令；日常定向、收尾全量一次                                                                 | 部分（脚本存在性）                  |
| `conventions.md#1.4` | `docs/team/conventions.md`                             | 协作流程分工：开工对齐、环境操作、交付闸门、提交卫生、下游验收                                                                           | 否                                  |
| `conventions.md#三`  | `docs/team/conventions.md`                             | 写代码前必看的 16 条硬约束                                                                                                               | 部分                                |
| `gate-performance`   | `docs/team/gate-performance-remediation-2026-11-11.md` | 闸门性能基线、既有技术债台账与既有债基线口径                                                                                             | 否                                  |

## 7. 本目录文件

| 文件                          | 角色                                                                | 通用层对应                                                                       |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `task-state-index.json`       | 本项目状态索引（真实任务记录与归档指针）                            | 框架仓 `schemas/task-state-index.schema.json`                                    |
| `acceptance-checklist.md`     | 项目特定验收命令与仓库边界                                          | 五类核对口径见框架仓 `docs/acceptance.md`                                        |
| `relay-receipt-template.md`   | 回执 / 交付记录的项目路径约定与命令示例                             | 七组字段骨架见框架仓 `templates/receipt.template.md`、`docs/receipt-contract.md` |
| `agent-cards/*.json`          | 本项目代理能力声明（executor / orchestrator；human 不可派发故无卡） | 框架仓 `schemas/agent-card.schema.json`、`templates/agent-card.template.md`      |
| `agent-cards/README.md`       | 能力声明边界说明（human 不产卡的依据、卡片字段口径）                | 框架仓 `docs/roles.md`、`schemas/agent-card.schema.json`                         |
| `tools/<TOOL-ID>.json`        | L2 工具链工具声明（一工具一文件；类别、角色白名单、副作用级别）     | 框架仓 `schemas/tool-contract.schema.json`、`docs/tools.md`                      |
| `orchestration-state.json`    | L2 运行态（租约、领单、超时等；首次 run-once 生成）                 | 框架仓 `docs/reliability.md`、`docs/autonomous-loop.md`                          |
| `orchestration-snapshot.json` | 队列快照（网页与 CLI 只读数据源）                                   | 框架仓 `docs/autonomous-loop.md`                                                 |
| `delivery-packs/`             | 夜间交付包汇总输出目录                                              | 框架仓 `docs/autonomous-loop.md` 交付包结构                                      |
| `improvement-log.json`        | 候选改进台账（缺口 / 护栏 / 工具 / 规范 / 债的登记与闭环）          | 框架仓 `docs/context-and-memory.md` §2 共享记忆分层                              |
| `improvement-loop.md`         | 改进闭环字段、状态机、闸门边界与命令口径（adapter 活文档）          | 框架仓 `docs/context-and-memory.md`、`docs/evolution.md`                         |
| `autonomous-team-design.md`   | 双代理派发通道、分支治理、文件域互斥、分层发布与回退设计备忘        | 框架仓 `docs/roles.md`、`docs/autonomous-loop.md`、`docs/reliability.md`         |

## 8. 通用层指针（规则真相源在框架仓）

| 主题                                                                   | 框架仓位置（`D:\work\Project\agent-collaboration-framework\`）                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 版本轴与契约版本表                                                     | `schemas/versions.json`（framework / enums / contracts 三轴；契约取版本以此为准）                                         |
| 枚举与状态迁移表（唯一真相源）                                         | `schemas/contract-enums.json`                                                                                             |
| 角色模型与隔离规则                                                     | `docs/roles.md`                                                                                                           |
| 任务单字段组与工件模型                                                 | `docs/task-contract.md`；`schemas/task-sheet.schema.json`；`templates/task-sheet.template.md`                             |
| 状态枚举与迁移规则                                                     | `docs/state-machine.md`                                                                                                   |
| 状态事件日志与投影                                                     | `docs/state-machine.md` §8；`docs/reliability.md` §8；`schemas/state-event.schema.json`                                   |
| 回执七组字段契约                                                       | `docs/receipt-contract.md`；`templates/receipt.template.md`                                                               |
| 验收五类与三级结论                                                     | `docs/acceptance.md`                                                                                                      |
| 可靠性（租约、超时释放、重试、崩溃恢复）                               | `docs/reliability.md`                                                                                                     |
| 上下文隔离与记忆分层（共享记忆 / 台账受控写入与撤回留痕）              | `docs/context-and-memory.md`                                                                                              |
| 权限、策略与审计                                                       | `docs/security-and-policy.md`                                                                                             |
| 工具契约（类别、声明结构、权限收口与审计）                             | `docs/tools.md`；`schemas/tool-contract.schema.json`；`templates/tool.template.md`                                        |
| 能力声明（Agent Card：角色、能力、边界、可用性）                       | `docs/roles.md`；`schemas/agent-card.schema.json`；`templates/agent-card.template.md`；`examples/example-agent-card.json` |
| 自治循环（环上模型、决策与冻结边界、返修限次、死信、崩溃恢复、交付包） | `docs/autonomous-loop.md`                                                                                                 |
| 人在环模式与升级                                                       | `docs/human-in-the-loop.md`                                                                                               |
| 演进路线 L0–L3                                                         | `docs/evolution.md`                                                                                                       |
| 适配层声明规范                                                         | `adapters/README.md`                                                                                                      |
| 可执行校验（schema 护栏与不变量单测）                                  | `conformance/`（`run.py` 闸门；V 系列检查与 `conformance/tests/`）                                                        |

## 9. 与仓库文档的衔接

| 事项                                               | 位置                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| 任务单模板（frontmatter 字段、固定结构、回写清单） | `docs/team/wp-task-template.md`                                            |
| 交付记录归档约定                                   | `docs/worklog/completed/<phase>/*-implementation-*.md`                     |
| 台账与 backlog                                     | `docs/team/gate-performance-remediation-2026-11-11.md` 及阶段 wp-list      |
| 架构设计留档                                       | `docs/architecture/`（通用概念以框架仓为准；项目约束与待决策见各文档附录） |
| 回执归档                                           | `docs/worklog/pending/archive/relay-response-*`                            |
