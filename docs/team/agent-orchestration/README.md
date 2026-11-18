# mofang-nestjs 协作适配层（Project Adapter）

> 本目录是接入通用 **agent-collaboration-framework** 的项目适配层。
> 通用规则（角色模型、任务契约、状态机、回执契约、验收口径、可靠性、上下文与记忆、安全策略、人在环、演进路线）的唯一真相源在框架仓，本文件**只声明本项目的特定取值**（目录映射、角色绑定、工具与闸门命令、策略锚点、框架版本依赖），不复制通用规则正文。
>
> - 框架仓本地路径：`D:\work\Project\agent-collaboration-framework`（本地独立 git 仓 + 版本 tag `v2.0.0`；tag 是 annotated object `c50718856aa752bac3d87e44b3f309b16fbcb051`，指向 commit `67d329054f12ead1a1072d4edbbbfbe924ed1c79`；当前 `main` HEAD `7395748` 尚未发版；无包管理器分发，故以仓路径 + 契约 `contractRef` urn 双轨引用。权威锚点见 [framework-version-anchor.md](framework-version-anchor.md)）
> - 适配层声明规范：框架仓 `adapters/README.md`（八类映射项：`projectId / directories / tools-gates / policyAnchors / frameworkVersionRange / roleBindings / statePlane / conformance`）
> - 代码红线、命令规范、分层归属：`docs/team/conventions.md`；任务单模板：`docs/team/wp-task-template.md`，不在此重复。

---

## 0. 开发任务强制准入（项目硬门）

> 2026-11-17 起，`mofang-nestjs` 的任何写入型开发都必须先进入本适配层的任务闭环。此条是项目特定取值，通用框架规则仍以框架仓为准。

1. **入口**：开工先 `pnpm orchestration:status`；有写入意图时落任务单，`task register` → `task promote` → `pnpm orchestration:run` 领单。没有 `submitted / working` 任务不得改代码、数据库、Redis、migration、seed、配置或运行态。
2. **只读豁免**：阅读、搜索、解释、方案讨论、`status` / `events verify` / `git status` 等只读检查不建任务。只要会产生文件、数据或运行态变化，就不在豁免内。
3. **禁止替代**：会话内待办、口头清单、“先做后补”、手改状态索引均不构成任务登记；状态面只能经 CLI 写。
4. **提交门禁**：`.husky/pre-commit` 先调用 `scripts/orchestration/task-entry-gate.mjs`（`pnpm orchestration:preflight`）。无在办任务、任务仍在 `ready`、暂存文件越出任务 `scope.files` 一律阻断；状态面生成物按 V7 口径豁免。验收归档后若暂存区**只有**状态面生成物，门禁以 `state-plane-only` 放行；只要混入一个非状态面文件，就恢复在办任务与 scope 硬校验。squash 合并若同次暂存携带 `task-state-index.json` 的 active→completed 归档迁移，门禁可用 HEAD 中同 taskId 的在办记录校验 scope（`archived-transition`）；canceled/rejected、未携带索引或越界文件仍阻断。
5. **收尾**：交付记录 + 机读回执成对产出，`run-once` 摄入验收后按 CLI 归档；事件条数、归档数、台账数字以 CLI 输出为准。
6. **服务端硬门（AF-056/057）**：CI `Orchestration Gate` 对 PR→integrate 与 integrate push 的每个新增提交重新执行同一状态机，校验提交标题 taskId、提交时刻任务状态、文件 scope、任务单存在性及归档迁移；PR 最终 HEAD 还必须是 completed/archived 并携带可合并 durable 回执（`passed`，或 `conditional-pass` 且无人工复核项、每条遗留有编号、scope=in-scope、finalStatus=completed），防止绕开本地工具直接页面合并。本地 `--no-verify` 不能替代远端判定。`integrate` 保护要求 13 项检查、PR（审批数 0）、strict 最新分支、线性历史并 `enforce_admins`，禁止 force push / 删除。

门禁脚本只读暂存区与状态索引，不自动 stage、不修改状态；任务与回执语义不变。

## 1. 标识与框架版本依赖

| 项                      | 值                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`             | `mofang-nestjs`（心塑 / XinSu 后端 NestJS 仓）                                                                                                                                                                                   |
| `frameworkVersionRange` | `>=2.0.0 <3.0.0`                                                                                                                                                                                                                 |
| 框架版本                | `2.0.0`（本地 annotated tag `v2.0.0` object `c507188` → commit `67d3290`，releasedAt `2026-11-16`；tag 之后 `main` 另有 6 个未发版提交，HEAD `7395748`。版本轴见框架仓 `schemas/versions.json`，锚点见 [framework-version-anchor.md](framework-version-anchor.md)） |
| 框架契约版本            | 任务单 `1.1.0` / 状态索引 `1.1.0` / 工具契约 `1.1.0` / Agent Card `1.1.0` / 交付包 `1.0.0` / 回执 `1.0.0` / review 交接件 `1.1.0`（逐项见框架仓 `schemas/versions.json`）                                                        |
| 契约引用形式            | 实例内用 `contractRef` / `schemaRef` 的 urn 声明（`urn:agent-collaboration-framework:schema:<contract>:<version>`），不写裸版本号                                                                                                |
| `unknownEnumPolicy`     | `tolerant`（框架 2.0.0 兼容声明要求；未知枚举值按保留值透传并记人工复核，不静默丢弃、不擅自映射。状态轴由 `protocol-mapper.mjs` 列入 `unknownStatuses`，交付包落入 `leftovers.manualReviewList`）                                |
| 枚举投影                | `scripts/orchestration/contract-enums.json` 为框架仓 `schemas/contract-enums.json`（2.0.0）的 vendored 投影，随本仓评审；一致性由 `orchestration.spec.mjs` 跨仓对账                                                              |
| 契约供应链              | `contracts/agent-collaboration-framework/2.0.0/`（14 份框架 2.0.0 schema 的不可变副本 + `PROVENANCE.json` 逐文件 SHA-256）；CI `Contracts` job 以 `ORCH_REQUIRE_FRAMEWORK=1` 硬校验，缺框架直接 fail-fast，不允许 skipped 软通过 |

> 2.0.0 与本适配层的历史差异已在本轮迁移中一次性收口：任务单 `status` 降级为立项快照、时间字段改带偏移 `date-time`、工具声明改**一工具一文件**、`human` 移出可派发角色、归档条目关闭附加字段（归档说明外移到 `archivedNotes`）、交付包改用 `delivery-package` 1.0.0 结构。破坏性变更（字段删除或语义改变）仍须先复核本表再升级；既有字段只增不删。
>
> `archivedNotes` 是**适配层扩展字段**（`task-state-index` schema 顶层 `additionalProperties: true` 允许），键为 `taskId`、值为 1.x 归档说明原文，只读保留、不做二次改写；框架未定义该字段，若后续框架定义归档说明槽位则以框架为准对齐。AF-020 起该字段外移到 `state/archived-notes.json`，索引中的 `archivedNotes` 只是从日志重建时的合并投影，禁止手改。

### 1.1 状态日志与单写者（`statePlane`）

| 字段                        | 本项目取值                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `statePlane.journal`        | `docs/team/agent-orchestration/state/journal.jsonl`（append-only，`state-event:1.0.0` + SHA-256 哈希链；历史段在 `state/journal-archive/`） |
| `statePlane.index`          | `docs/team/agent-orchestration/task-state-index.json`（只读投影，禁止手改）                                                                 |
| `statePlane.lock`           | `file-lock`（`state/journal.lock`，CLI 进程内超时 30s；单写者 + 文件锁双保险）                                                              |
| `statePlane.writer`         | `orchestrator-cli`（`scripts/orchestration/cli.mjs` / `scheduler.mjs`；同一时刻只允许一个 orchestrator 进程提交事件）                       |
| `statePlane.rebuildCommand` | `pnpm orchestration:events rebuild`（从 `state/journal.jsonl` + 归档段重建索引；`rebuiltAt` 除外逐字节一致，INV-15 现场判据）               |

> 状态写入顺序固定为「读日志 → 追加事件 → 重建投影」，全部在 `file-lock` 临界区内完成；多写者合并、事件重排一律禁止。运行态 `orchestration-state.json` 是 L2 扩展状态面，不替代事件日志的唯一写面。

### 1.2 校验入口与容错策略（`conformance`）

| 字段                            | 本项目取值                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformance.command`           | `pnpm orchestration:validate && pnpm orchestration:contracts`（前者校验索引 / 任务单 / 回执 / Review / Agent Card / 交付包 / 协议视图与事件链，后者校验 14 份框架 2.0.0 schema 的不可变副本与来源哈希） |
| `conformance.ciHook`            | `.github/workflows/ci.yml` 的 `Contracts` job：`push` / `pull_request` 目标 `integrate` 时触发，`ORCH_REQUIRE_FRAMEWORK=1` 硬校验，缺框架 fail-fast，不允许 skipped 软通过                              |
| `conformance.unknownEnumPolicy` | `tolerant`（未知枚举按保留值透传并记人工复核，不猜测、不静默丢弃；状态轴由 `protocol-mapper.mjs` 列入 `unknownStatuses`）                                                                               |

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

| 映射项                             | 本项目落点                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `directories.taskSheets`           | `docs/worklog/pending/`（`ready / submitted / working` 任务单）                                                                                                    |
| `directories.deliveryRecords`      | `docs/worklog/completed/<phase>/`（任务单 + 交付记录成对归档，只读历史）                                                                                           |
| `directories.replyArchive`         | `docs/worklog/pending/archive/`（回执原文、机读回执副本 `<taskId>-receipt-*.json`、中间产物归档；transport 只作收件箱）                                            |
| `directories.artifacts`            | 各任务单切片范围内的源码 / 测试 / 规格路径；工件正文留在各自文件                                                                                                   |
| `directories.stateIndex`           | `docs/team/agent-orchestration/task-state-index.json`（**只读投影**，带 `projection` 指向日志末条事件；禁止手改）                                                  |
| `directories.stateJournal`         | `docs/team/agent-orchestration/state/journal.jsonl`（**唯一写面**，append-only 事件日志；`state-event:1.0.0` + SHA-256 哈希链）；历史段在 `state/journal-archive/` |
| `directories.stateArchivedNotes`   | `docs/team/agent-orchestration/state/archived-notes.json`（归档说明侧车，重建时合并进索引 `archivedNotes`）                                                        |
| `directories.runtimeState`         | `docs/team/agent-orchestration/orchestration-state.json`（L2 运行态，首次 run-once 生成）                                                                          |
| `directories.snapshot`             | `docs/team/agent-orchestration/orchestration-snapshot.json`（队列快照，网页数据源；空跑或仅时间戳变化不重写，避免脏 diff）                                         |
| `directories.improvementLog`       | `docs/team/agent-orchestration/improvement-log.json`（候选改进台账；口径见 `improvement-loop.md`）                                                                 |
| `directories.deliveryPacks`        | `docs/team/agent-orchestration/delivery-packs/`（夜间交付包汇总目录）                                                                                              |
| `directories.orchestrationScripts` | `scripts/orchestration/`（L2 工具链实现；工具契约声明见 `tools/<TOOL-ID>.json`，一工具一文件）                                                                     |
| `directories.tools`                | `docs/team/agent-orchestration/tools/`（工具契约声明目录，框架 2.0.0 单对象口径，目录即清单）                                                                      |
| `directories.agentCards`           | `docs/team/agent-orchestration/agent-cards/`（本项目代理能力声明 JSON）                                                                                            |
| `directories.handoverTransport`    | `docs/team/agent-orchestration/transport/`（运行态交接件：`tasks/` 任务契约、`receipts/` 回执、`reviews/` 协商轮意见、`artifacts/` 工件指针；gitignore 忽略）      |

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

L2 编排工具链（状态存储、验收护栏、调度器、交付包、候选改进台账、CLI）的契约声明在 `tools/<TOOL-ID>.json`（一工具一文件，字段 `toolId / category / sideEffect / allowedRoles / resources / contractRef`），实现位于 `scripts/orchestration/`，注册与授权收口于 `tool-registry.mjs`。自治模式自 AF-023 起默认开启（`autoLoop.enabled=true`，`maxConcurrentTasks=1`）：`run-once` 每轮先释放超时租约、摄入回执 / 验收归档，再领取下一单，同一轮即可完成「回收 → 派发」；租约超时释放写 `releaseReason=lease-expired` 并置 `heldForHuman=true`，不自动重派，人工确认后用 `pnpm orchestration:task resume --taskId <id>` 恢复；如需只读快照，用 `pnpm orchestration:config --disable` 显式关闭。任务单立项用 `pnpm orchestration:task register --sheet <md>`（解析 frontmatter + schema 校验 + 事件登记）；历史 transport 交接件补登用 `pnpm orchestration:task import --handover <json>`；误立项 / 资源域切错的任务用 `pnpm orchestration:task cancel --taskId <id>` 按状态机闭合到 `canceled`（`archive` 只接受已终态任务，不能改终态）；登记在 `backlog` 的任务用 `pnpm orchestration:task promote --taskId <id>` 提到 `ready`，提级前硬校验任务单指针、`baselineRef` 与依赖满足，缺一即拒（避免「能立项、不能启用」的死状态）。依赖判定同时查活跃与归档：上游已完成归档后仍算满足，上游完全不存在时推 `dependency-unresolved`。验收 V7 先剔除编排状态面生成物（快照 / 索引 / 事件日志 / `web/orchestration/data.js` / `transport/`）再与任务 `scope.files` 比对，避免把编排自身写入判成任务越域；索引 `artifacts` 只允许 `taskSheet / deliveryRecord / reply / others`，回执副本指针留在 `task.receipt.archiveRef`。常驻自治用 `pnpm orchestration:watch`（启动先跑一轮，监听 pending / completed / transport tasks / transport receipts，防抖后推进）。改进台账命令：`pnpm orchestration:improvements`（list / `--extract` / `--add` / `--transition`），闭环口径见 `improvement-loop.md`。事件溯源命令：`pnpm orchestration:events`（`verify` / `rebuild` / `backfill` / `create` / `rotate`）；契约包校验：`pnpm orchestration:contracts`。所有状态写入必须经 `commitIndex` / `archiveTask` / `createTask`，不得直接改索引。

### 4.0 事件日志长期保留与分段归档

- **唯一写面不变**：运行期仍只 append `state/journal.jsonl`；归档段只读，不参与写入。
- **分段不删事件**：`events rotate --max-events N` 把当前日志整段移入 `state/journal-archive/journal-<首序号>-<末序号>.jsonl[.gz]`，再重建空的活动日志。事件正文逐字保留，`eventSeq` / `prevHash` / `hash` 跨段连续；`verify` 仍能检出篡改或断链。
- **压缩**：`--compress`（别名 `--gzip`）对归档段做 gzip；读取端按首事件序号排序并透明解压。压缩只缩小体积，不改变任何事件字节语义。
- **触发口径**：建议按事件量轮转（默认 `5000` 条）；当前仓首次归档 `journal-000001-000074.jsonl.gz`，之后 AF-021 追加 2 条到活动日志（总 76 条），跨段链已由 `events verify` 验证。
- **保留策略**：归档段永久保留、不自动删除；审计需要时 `events verify` 会同时校验活动段与全部归档段。若未来要冷备到对象存储，必须保持文件字节与哈希链原样，不得重算事件。
- **归档语义**：`archived` 是终态后的归档动作，投影落事件前 `rec.status`（框架 `state_projection.py` 口径），不得用 `to` 改写终态；非终态任务须先经合法迁移链闭合再归档。
- **终态扫档**：`ARCHIVE_STATUSES = [completed, rejected, canceled, failed]`，每轮 `run-once` 在回执验收之后调用 `sweepTerminalTasks`，把「已闭合但没走回执链」的任务（`canceled` / `failed`）搬进 `archivedTasks`。漏掉这一步，死任务会永久留在 `tasks[]`，让队列概览的「活跃计数」把已终态的任务算成在办（AF-039 / AF-041 实测：两单取消/失败后仍显示 `failed=1 canceled=1`）。
- **时间戳口径**：事件 `at` 一律 UTC `Z` 形态（框架 schema 按 RFC3339 校验）。任务单 frontmatter 允许写 `+08:00`，`buildCreatedEvent / buildHistoryEvent / buildArchivedEvent` 统一经 `toUtcIso()` 归一；「同一任务 `at` 单调递增」按时间值比较，混用偏移会被判倒退。`createdAt` 另经 `createdAtForEvent()` 把**未来时间夹到写入时刻**——任务单写成未来整点（AF-030 / AF-031 各踩一次）会让 created 事件晚于其 promoted/claimed。
- **本地未发布段纠偏**：仅当事件内容有缺陷且尚未交付下游时，用 `events rechain --from <EV-xxxx> [--apply]` 从切点起重编号重算当前段哈希；切点前的字节逐字保留，段首切点必须带 `prevSeq/prevHash`（取自前一段末条事件），归档段永不重写。这是运维级例外通道，不是常规写入路径。

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
| `TOOL-RELAY-SUPERVISOR`  | `state-persistence` | `state-store`      | 以任务级账本与文件检测回收 relay 回执，写运行态与通知，不改业务代码              |

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

轮询节奏按任务规模分四档。档位取值属**适配层编排口径**，不进通用层 schema。

| 档位 | 预估时长   | 首次检测 | 兜底间隔序列（分钟）   | deadline | 兜底检测次数 |
| ---- | ---------- | -------- | ---------------------- | -------- | ------------ |
| S    | 10–15 min  | 10 min   | 10 / 10 / 15           | 45 min   | 3            |
| M    | 20–30 min  | 10 min   | 10 / 15 / 15 / 20      | 90 min   | 4            |
| L    | 40–60 min  | 15 min   | 15 / 15 / 20 / 30 / 30 | 180 min  | 5            |
| XL   | 60–120 min | 15 min   | 15 / 20 / 30 / 45 / 60 | 240 min  | 5            |

- **事件优先**：本地 `relay-supervisor` 用文件系统事件监听 `docs/worklog/pending/`，只对已注册任务的精确回执文件触发；正常落盘可秒级发现，不依赖分钟级轮询。
- **兜底扫描**：每个 job 按上表 `nextCheckAt` 推进；事件丢失、进程重启或网络盘不触发时由兜底补漏。supervisor 的定时器只检查到期 job，不扫描目录。
- **平台降级**：Doubao cron 最小间隔为 1 小时，只作为最后降级通道；分钟级节奏由本地 supervisor 承担，不再建永久通用 cron。
- **无在途任务**：不保留永久扫描任务；`relay-supervisor` 无 job 时只保留低开销进程与空账本，命中或超时后 job 停止并由 `ack` 清理。
- L / XL 档的预估时长按同类任务类推缩短，不拉长观察窗口；缓冲与兜底次数一律取上表值，不另设分支。
- 本节是档位与阈值的唯一真相源：任务单模板与其他文档只引用，不复制数字。
- 工具契约见 `tools/TOOL-RELAY-SUPERVISOR.json`；命令入口 `pnpm orchestration:relay`。

## 5.1 派发通道与投递协议（`dispatch`，AF-024）

派发是「把活送进执行代理会话」的动作，不是一个打印函数。通道取值、投递状态、回写命令是本节唯一真相源，其他文档只引用。

### 通道选路

| 目标角色       | 通道                                          | 理由                                                                               |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `orchestrator` | `file`                                        | 编排者执行自己的任务，投给自己只产生噪声；交接件落 `transport/tasks/<taskId>.json` |
| `executor`     | `config.dispatch.channel`（默认 `gui-relay`） | 需要把任务单送进执行代理（MiniMax Code 等）的桌面会话                              |

选路由 `dispatch.mjs` 的 `resolveChannelSelection()` 决策（IM-028），调度层只消费结果，不在领单处散落 if。判定顺序：角色 → 上轮投递事实 → 配置通道 → 枚举收敛。

| 决策原因                          | 触发条件                                                             | 结果通道                  |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| `orchestrator-self-dispatch`      | `agentRole=orchestrator`                                             | `file`                    |
| `configured-channel`              | 执行代理角色且上轮无失败事实                                         | `config.dispatch.channel` |
| `delivery-fallback-after-failure` | 上轮 `delivery.state=failed` 或上轮已降级，且 `fallbackToFile≠false` | `gui-file-fallback`       |
| `fallback-disabled-retry`         | 同上但 `fallbackToFile=false`                                        | `gui-relay`（重试）       |
| `channel-unavailable-coerced`     | 配置通道不在 `DISPATCH_CHANNELS` 枚举内                              | `file`                    |

决策结果随领单记入运行态 `entry.dispatchDecision`（含 `attempt` / `previousDeliveryState`），并作为 `dispatch-decision` 动作进事件日志。降级后**同一任务**固定在文件降级通道，不自动回升；新任务仍按配置通道试 GUI。

### 投递状态机（派发记录 `delivery`）

| 状态        | 含义                                                                                | 写入者                                                  |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `pending`   | 投递件已生成（`briefRef` 非空），尚未确认送达                                       | `run-once` 领单（领单即生成投递件）/ `channel dispatch` |
| `delivered` | 桌面 relay 已送达并校验（会话路径 + 定位层 + 证据指针齐备，且原态必须是 `pending`） | `channel auto-confirm`（ack 到达）/ `channel confirm`（人工兜底） |
| `failed`    | 投递失败并降级，通道改 `gui-file-fallback`，文件交接件仍在                          | `channel fallback`                                      |
| `bypassed`  | 非失败事实：通道被旁路（会话内直做 / 已由既有进程执行），不计失败、不判终态         | `channel fallback --cause executed-in-session`          |

**送达 ack（AF-074）**：执行代理收到 brief 后，第一步写 `transport/acks/<taskId>.json`（`schemaVersion / taskId / receivedAt / executor`）。ack 只证明「收到了」，**不是完成回执**；`channel send` 写的 `transport/gui-sent/<taskId>.json` 是发送现场（窗口、时间、截图哈希），也不是送达证明。两者齐备后，`channel auto-confirm` / `run-once` 的 `autoConfirmDeliveries` 才把 `pending` 升为 `delivered`；缺 ack 保持 pending，交给投递租约回滚。

`pending` 用**独立投递租约**（`config.dispatch.deliveryLeaseMinutes`，默认 5 分钟）计时，不占 30 分钟任务租约：超时未确认，`run-once` 的 `releaseFailedDeliveries` 把任务回滚 `ready` 并置 `heldForHuman`，`releaseReason=gui-delivery-lease-expired`。

`failed` 的回收不再一律持单，而是把 relay 上报的**现场事实**（`delivery.lastAttempt`：`cause` / `loginGate` / `startRetries` / `sendRetries` / `sessionAttempted` / `locateAttempted` / `attemptCount`）喂给运行时决策链 `dispatch-channel.mjs#resolveDispatchDecision`（IM-028），动作映射如下：

| 决策动作                                                   | 调度层结果                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `fail-terminal`（不可恢复类别）                            | 任务 `submitted → failed`，`releaseReason=gui-delivery-terminal`，不重试                 |
| `continue-in-session`（非失败事实：`executed-in-session`） | 不动任务状态；`entry.deliveryBypassed=true` + `delivery-bypassed` 动作，任务按原状态推进 |
| `human-escalate`（任务级预算耗尽 / 进程拉不起来）          | 回滚 `ready` + `heldForHuman`，`releaseReason=gui-delivery-budget-exhausted`             |

`--cause` 是**必填**：它是决策链的判决值，缺省（旧行为）会退化成 `deterministic-defect` → 终态 `failed`，把"没走这条通道"误杀成"任务死"（AF-041 即此）。缺省或非法值 CLI 直接退出码 2，可选值见 `DELIVERY_CAUSES`。
| 其余（有现场事实但可恢复） | 回滚 `ready` + `heldForHuman`，`releaseReason=gui-delivery-failed` |

没有现场事实时**不得假定不可恢复**（缺省 `cause` 为空，走持单待人工），否则会把偶发故障直接判死。持单后修好通道再 `task resume`。

### 校验守卫（AF-024 评审整改）

- **通道守卫**：只有 `channel=gui-relay` 的记录能被 confirm / auto-confirm / fallback，file 通道不得伪装成已送达。
- **状态守卫**：confirm 只接受 `pending → delivered`，`failed` 不得回退成 `delivered`。
- **枚举守卫**：`sessionPath` 必须取自 `SESSION_PATHS`（`existing-session` / `mini-chat` / `new-task`），`locateLayer` 必须取自 `LOCATE_LAYERS`。
- **文件守卫**：`evidenceRef` 与 `handoverRef` 必须能在仓内解析到真实文件。
- **留痕守卫**：重派 `attempt` 递增，上一轮 `delivery` 压入 `history`；降级清空定位痕迹，但失败原因与定性保留。
- **执行器标注**：`channel dispatch --executor <relay 标识>` 记录本次由谁驱动桌面（默认 `doubao-cu`），换 relay 只改标注。

### 命令

| 命令                                                                                                                                                                                         | 作用                                                                                                                                                                | 副作用           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `channel rules` / `channel queue --taskId` / `channel state --taskId`                                                                                                                        | 规则、队列可派判定、投递状态与停滞标记                                                                                                                              | 只读             |
| `channel dispatch --taskId <id> [--extra-file <md>]`                                                                                                                                         | 读交接件 → 生成 `transport/briefs/<taskId>.brief.md` → 置 `pending`                                                                                                 | 写投递件与运行态 |
| `channel send --taskId <id> [--dry-run] [--wait-ack] [--ack-timeout 90] [--no-click-input] [--window-title <title>]`                                                                           | 主桌面聚焦执行代理窗口 → 定位输入框 → 剪贴板粘贴 brief → 发送 → 写 `transport/gui-sent/<taskId>.json` 与截图；**不**直接确认送达                                                        | 写发送证据       |
| `channel auto-confirm [--taskId <id>]`                                                                                                                                                        | 读 `transport/acks/<taskId>.json` 与发送记录 → 回写 `delivered`；缺 ack / taskId 不一致一律不确认                                                                     | 写运行态         |
| `channel confirm --taskId <id> --session-path <..> --locate-layer <..> --evidence <..>`                                                                                                      | 人工兜底：回写 `delivered`；缺任一项即拒                                                                                                                             | 写运行态         |
| `channel fallback --taskId <id> --reason <..> --cause <类别> [--classification deterministic\|flaky\|legacy-debt] [--login-gate] [--start-retries N] [--send-retries N] [--attempt-count N]` | 回写 `failed` + 通道降级 + 现场事实（`delivery.lastAttempt`）；`--cause` **必填**且须在 `DELIVERY_CAUSES` 内，缺原因 / 缺 `handoverRef` / 缺 `cause` 即拒（exit 2） | 写运行态         |

### 分工与红线

- 规则判定在 `dispatch-channel.mjs`；投递件生成 / 确认 / 降级在 `gui-dispatch.mjs`；真实桌面动作（聚焦、粘贴、发送、截图）由 `gui-relay-send.ps1` 在主桌面执行；送达确认由执行代理 ack + `channel auto-confirm` 完成。
- **不把「已粘贴」当「已送达」**：发送器只写现场证据；`auto-confirm` 必须读执行代理 ack（taskId 一致、receivedAt 可解析），人工兜底 `confirm` 仍须带会话路径、定位层与可指认证据。
- **不静默降级**：失败必须写原因与定性；降级后 `channel=gui-file-fallback`，但交接件不删、任务不丢。
- 投递件只含任务契约字段（契约 / 范围 / 闸门 / 验收 / 投递确认 / 回执约定），不含编排内部状态与对话原文；brief 明确禁止执行代理自行执行 task / run-once / archive / improvements transition。
- CLI 不冒充 GUI 能力：`channel dispatch` 只准备投递件与状态；`channel send` 才驱动桌面，且发送后立即把前台还给原窗口。

## 5.2 通道熔断（IM-017）

熔断初始以「扩展位」存在，本批起**参数化落地**：阈值由适配层声明，框架侧只固定语义槽位（框架 `docs/reliability.md` §5.1）。

| 项         | 口径                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 计数维度   | 按**通道**（下游实例）连续失败次数计数，跨任务复用同一平面；**不**按任务另立独立计数                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 阈值参数   | `config.circuitBreaker.consecutiveFailureThreshold`（默认 3）、`cooldownMinutes`（默认 10）                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 判定函数   | `dispatch-channel.mjs#evaluateCircuitBreaker(task, config, { now })` → `{state, channel, consecutiveFailures, threshold, openedAt, cooldownMinutes, probeAllowed, reason}`                                                                                                                                                                                                                                                                                                                                                                     |
| 计数写入   | `gui-dispatch.mjs#fallbackDelivery` 递增 `delivery.consecutiveFailures`；`dispatch.mjs#buildDispatchRecord` 干净派发归零                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 开闸后果   | `entry.channelCircuit={state:'open',channel,consecutiveFailures,threshold,at}` + `channel-circuit-open` 动作（可观察事件）                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 状态位     | `closed` / `open` / `half-open` **三态已实现**：达阈值且冷却期未满 → `open`；冷却期满放**一次**试探 → `half-open`（`probeAllowed=true`，`channel-circuit-half-open` 事件）；试探成功 `consecutiveFailures=0` + `circuitOpenedAt=null` 并封 `closed`（`channel-circuit-closed`），试探失败按新失败重新开闸                                                                                                                                                                                                                                      |
| 跨轮计数   | 开闸时刻同步写 `record.delivery.circuitOpenedAt`，冷却期跨 `run-once` 计算，不靠内存                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 派发侧拦截 | `scheduler.mjs#resolveChannelCircuit(runtimeState, config, {now})` 扫描运行态取**最新开闸事实**并按当前时刻重算冷却（冷期内 `open`、期满 `half-open`、无事实 `closed`）；`claimReadyTasks` 在持单判定之后、scope 冲突之前拦：`open` **整轮不派发**、`half-open` **只放一次试探**，其余 ready 任务留 `ready`，不登记租约、不生成投递件，并发 `channel-circuit-blocked` / `channel-circuit-probe` 动作（blocked 带 state/channel/consecutiveFailures/threshold/openedAt/cooldownMinutes），试探任务写 `entry.circuitProbe={channel,at,openedAt}` |
| 探针跨轮   | 「只放一次」按**开闸周期**（`openedAt`）成立：`resolveChannelCircuit` 扫全部运行态条目里 `circuitProbe.openedAt` 相同的探针，已放过则 `probeIssued=true`，后续 `run-once` 一律拦截，不再每轮各放一次；熔断封闭时探针随周期清空，下一次开闸是新周期                                                                                                                                                                                                                                                                                             |

拦截口径为什么按运行态扫描：熔断是**通道级**语义，但状态位只落在触发它的那个任务条目上；只看当前任务会漏掉「A 单熔断通道、B 单照派」的窗口。探针同理必须从运行态读，否则「只放一次」退化成「每轮一次」。

判定完整口径（含终态出口、预算归属、失败定性）见 `channel-failure-decisions-2026-11-17.md` §3–§6。

## 5.3 合并收口与远端 CI 门禁（IM-012 / IM-018）

`branch merge` 不再把提交与清理留给人工，且可选在合并前**读远端 CI 结论**。

> AF-056 起这是**未保护分支的过渡兼容路径**。`integrate` 保护启用后禁止本地 squash 后直推，统一使用 §5.3.1 的 `pr-release.mjs`；不得为了继续直推而关闭保护或降低必需检查。

| 阶段            | 命令实现                           | 说明                                                                           |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `squash-merge`  | `git.squashMerge(branch)`          | 暂存到 integrate（原行为）                                                     |
| `commit`        | `git.commitSquash(message)`        | 提交标题 `` `${taskId} ${title}` ``，由 `finalizeSquashMerge` 在闸门全绿后补上 |
| `delete-local`  | `git.deleteLocal(branch)`          | 删源分支                                                                       |
| `delete-remote` | `git.deleteRemote(branch, remote)` | 传 `--remote` 才删远端；缺省只删本地                                           |

任一阶段抛错即**停在该阶段**，返回 `{stages, branchName, commitMessage, errors}`，`errors` 非空时 CLI 以退出码 2 中止，绝不静默继续删分支。

远端 CI 门禁（`--require-ci`）：

| 项        | 口径                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据源    | GitHub REST `GET /repos/<repo>/commits/<sha>/check-runs?per_page=100`（无 `gh`，也不依赖浏览器）                                                                                                     |
| token     | 按优先级 `GITHUB_TOKEN` → `GH_TOKEN` → `ORCH_GITHUB_TOKEN` → `git credential fill`（`host=github.com`）取 `password=`；`resolveGithubTokenDetail()` 返回 `{token, source, hint}` 便于核对来源        |
| CI 容器内 | `GITHUB_ACTIONS=true` 且无 token 时**不再白跑 credential helper**，直接给注入提示（`env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`，job 需 `permissions: checks: read`）；不冒充已配好              |
| 判定      | `ciGateVerdict()` 四态：`pass`（全 `success`/`skipped`/`neutral`）、`fail`、`pending`（存在未 `completed`）、`unknown`（取数失败或 **0 项 check**）                                                  |
| 放行规则  | 只有 `pass` 放行；`pending` / `unknown` **一律不放行**（空 check 不等于通过）                                                                                                                        |
| 参数      | `--repo`（默认 `aa386400024/mofang-nestjs`）、`--sha`（缺省取**该任务分支 HEAD**，取不到才回落当前 HEAD；`--apply` 时显式 `--sha` 必须等于分支 HEAD，否则拒绝——防「拿旧绿 SHA 给已前进的分支放行」） |
| GHES      | 基址取 `GITHUB_API_URL`（去尾部斜杠），缺省 `https://api.github.com`；私有部署不硬编码公网地址                                                                                                       |

门禁的「该拦就拦」有实弹记录：`ci-gate-fire-drill-2026-11-17.md`（阻断路径判 `unknown`、放行路径判 `pass` 后完成 squash 合并）。读的是**该 SHA** 上的结论，不是仓库最近一次绿。

### 5.3.1 受保护 integrate 的服务端逐提交门与 PR 流（AF-056）

**为什么调整旧 L3**：required status checks 不能验证一个刚在本机生成、从未跑过远端检查的新 squash SHA；若继续「先在 integrate 直推登记提交，再本地 squash 直推」，保护规则会把正常流程也拦掉。因此目标态把登记提交也放进任务分支，由 PR 承载全部提交与检查。

标准闭环：

1. 在 `integrate` 工作树落任务单并 `task register --status ready` → `run-once` 领单；此时登记产物**先不直接提交到 integrate**。
2. `node scripts/orchestration/cli.mjs branch create --taskId AF-0xx --apply`，让未提交的任务单与 CLI 状态面随工作树切到任务分支；在任务分支提交登记，再实现并提交。
3. `node scripts/orchestration/pr-release.mjs create --taskId AF-0xx --apply`：推送任务分支并创建/复用 PR。
4. 完成交付记录、durable 回执、`run-once` 验收与 CLI 归档，提交纯状态面；再执行一次 `create` 推送最新 HEAD。
5. `node scripts/orchestration/pr-release.mjs merge --taskId AF-0xx --apply`：要求 completed/archived、可合并 durable 回执、PR HEAD == 本地 HEAD、13 项检查全绿，随后 API squash 合并、fast-forward 本地 integrate，并在树一致后清理本地/远端任务分支。

远端门：

```powershell
node scripts/orchestration/ci-task-gate.mjs --base <base-sha> --head <head-sha>
node scripts/orchestration/branch-protection.mjs --repo aa386400024/mofang-nestjs --branch integrate          # dry-run
node scripts/orchestration/branch-protection.mjs --repo aa386400024/mofang-nestjs --branch integrate --apply # 幂等 apply + 读回核验
```

| 项                | 强制口径                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提交范围          | PR 使用 `base.sha..head.sha`；integrate push 使用 `event.before..event.after`；不能只查最终 diff，否则坏提交可先混入再被后续提交掩盖                                                              |
| 提交身份          | 标题必须含唯一任务编号；同编号重复允许，多编号、日期形态或缺失编号不会获得任务权限                                                                                                                |
| 状态快照          | 同时读取当前提交与父提交的索引；active 提交用当前在办任务，归档提交与 squash 全生命周期用 `archived-transition`。父提交无任务时必须以零依赖解析从当前任务单重建 scope，并要求可合并 durable 回执；一条分支叠加多个已完成任务时，squash 提交按本次携带且各自已验收的任务单 scope 并集校验，不再只看标题主任务 |
| PR 验收（AF-057） | PR 最终 HEAD 必须 completed/archived，且 git tree 内 durable 回执满足 reviewVerdict=passed 或已登记 backlog 且无人工复核项的 conditional-pass、scopeCheck=in-scope、finalStatus=completed；否则 Orchestration Gate failure，页面/API 也不能合并  |
| 文件与任务单      | 非状态面文件必须落入 scope；任务单必须在该提交树中存在；canceled/rejected 不可借用                                                                                                                |
| 检查放行          | 13 项 context 全部存在且完成；失败优先 fail，缺项/进行中/空 checks 均不放行                                                                                                                       |
| 分支保护          | required PR（审批数 0）、strict、线性历史、enforce admins、禁止 force push/deletion；不设置人或团队 bypass                                                                                        |
| 凭据              | 复用 `GITHUB_TOKEN` / `GH_TOKEN` / `ORCH_GITHUB_TOKEN` / Git credential helper；不安装 gh、不打印或入库 token                                                                                     |

边界：Git 与 GitHub 能硬阻断未授权提交和合并；数据库、Redis、环境启停仍由任务登记、scope、回执和事件审计约束，不能伪装成操作系统级沙箱。仓库 admin 理论上可通过后续 API 改保护规则，因此保护配置的读回核验与变更审计是长期必要项，而不是宣称「管理员也无法改设置」。

## 5.4 回执指纹与范围通配（IM-007 / IM-011）

| 项         | 口径                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 回执指纹   | `dispatch.mjs#receiptFingerprint` 优先取 `task.artifacts.deliveryRevision ?? task.revision`，形如 `taskId@rev`；未登记版本才退回 `taskId | deliveryRef` |
| 为什么     | 同一交付记录路径被返修重写时，纯路径指纹会把新回执判成「已验收」而跳收                                                                   |
| 范围通配   | `scope-mutex.mjs#expandScopePattern` 按真实目录枚举（只读 `readdir`，逐段匹配 `*`，`maxDepth` 6 / `maxEntries` 500 兜底）                |
| 展开时机   | 只有传 `rootDir`（调度的 `claimReadyTasks` 传 `REPO_ROOT`）才展开；展开为空回退原前缀条目，避免「无匹配=无冲突」的假放行                 |
| 修掉的误报 | `src/*.ts` 旧口径降级成前缀 `src/`，会把 `src/shared/` 判成冲突；展开后只覆盖真实文件                                                    |

## 5.5 验收残留比对两种口径（AF-043-I1）

V7「文件域残留」有两条取证路径，按回执是否声明提交集合自动分流（`acceptance-runner.mjs#checkResidual`）：

| 口径            | 触发条件                        | 比对对象                                                                   | 失败语义                                                          |
| --------------- | ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 工作树比对      | 回执无 `changedFiles.commits`   | `git diff` 全树交付面（先剔除状态面生成物与本任务任务单）                  | 清单外文件即残留 → `rejected`                                     |
| **commit 比对** | 回执声明 `changedFiles.commits` | 声明提交的文件集合（`git show --name-only`，经 `resolveCommitFiles` 注入） | 提交内 scope 外文件 → `fail`；提交解析不到 → `fail`（声明即证据） |

- 声明 commit 后，工作树里**属同批次其它任务的在办改动不参与比对**，只写进 detail 供人看。修掉的正是 AF-040 / AF-042 连续被判 `rejected` 的根因：同树多任务，拿工作树套单个任务必然互相误判。
- 未注入 `resolveCommitFiles`（如纯函数调用）→ 记 `skip`，**不冒充通过**。
- 契约侧字段登记：后端回执校验 `handover-contract.mjs` 接受 `changedFiles.commits`（7–40 位小写十六进制），框架 `docs/receipt-contract.md` §3.1 已同步登记为可选扩展字段。
- 跨仓提交（IM-046）：本仓 `changedFiles.commits` 只写本仓 SHA；他仓提交写 `changedFiles.externalCommits`，每项为 `{ repo: "owner/repo", commits: ["7–40 位小写十六进制"] }`。校验器只验形状，不拿外部 SHA 去本仓对象库解析，也不把它混入 V7 的本仓 commit 比对；`artifactRefs.others` 继续用于人读工件指针。

## 5.6 scope 重签发、回执预检与两阶段提交（AF-084）

### 5.6.1 scope 不在原任务上原地改写

任务登记后，`scope` 属于任务契约本体，**没有原地修订入口**：`createTask` 拒绝复用任何已存在或已归档的 taskId，手改 `task-state-index.json` 会破坏哈希链，新增 `amended / rescoped` 事件类型又需要跨仓同步框架 `state-event.schema.json`、`contract-enums.json` 与 `versions.json`。

需要修正 scope 时走**任务版本化重签发**：

```powershell
node scripts/orchestration/cli.mjs task reissue --from AF-079 --sheet docs/worklog/pending/af080-xxx-task-YYYY-MM-DD.md
node scripts/orchestration/cli.mjs task reissue --from AF-079 --sheet docs/worklog/pending/af080-xxx-task-YYYY-MM-DD.md --apply --archive-old
```

| 规则 | 口径 |
| --- | --- |
| 可重签发状态 | 只允许 `backlog / ready`；已进入 `submitted / working` 的任务表示实现已开始，换契约必须走返修任务 |
| 新任务标识 | 必须是新 taskId，且不在活跃或归档集合中 |
| 审计链路 | 新任务 `priorTasks` 必须显式包含原 taskId |
| 原子性 | `--apply` 内完成「登记新任务 → backlog 提级 ready → 原任务取消 canceled」；`--archive-old` 再归档原任务 |
| 默认行为 | 不带 `--apply` 只打印 dry-run 计划，不写状态面 |
| 同义入口 | `task rescope` 与 `task reissue` 等价；命令名表示「重签发」，不是原地改字段 |

新任务必须是一份完整任务单（可复用原任务单内容，改 taskId、scope、createdAt 与 `priorTasks`），不得只写一份 scope 补丁。

### 5.6.2 回执预检（run-once 之前）

```powershell
node scripts/orchestration/cli.mjs receipt lint --taskId AF-084
node scripts/orchestration/cli.mjs receipt lint --taskId AF-084 --path docs/team/agent-orchestration/transport/receipts/AF-084.json
```

预检把验收阶段才暴露的格式问题前移，覆盖：

- 框架七组字段（`gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict` + `verdictRationale`）；
- `changedFiles` 不得声明编排状态面生成物（`STATE_PLANE_PATHS`）与 scope 外文件；
- `artifactRefs.taskSheet / deliveryRecord / reply / others` 必须存在、在仓内且是文件；
- 交付记录必须 UTF-8 无 BOM + LF；
- `completed` 回执的 `reviewVerdict` 必须是 `passed / conditional-pass / rejected`；
- `gateResults` 占位命令给 warning，不阻断。

预检是**独立命令**，不改变 `run-once` 的既有摄入行为；`[FAIL]` 时退出码 1，修正后再摄入。

### 5.6.3 两阶段提交

实现提交与完成归档提交分开，避免 squash / preflight 阶段出现「任务已归档但实现提交还没落」的空档：

| 阶段 | 时机 | 提交内容 | 任务状态 |
| --- | --- | --- | --- |
| 阶段一 · 实现提交 | `run-once` 领单之后、回执摄入之前 | 代码、测试、任务单、交付记录（LF） | `submitted`（可提交） |
| 阶段二 · 完成归档提交 | 回执摄入 → 验收通过 → 归档之后 | 状态索引、事件日志、快照、看板数据等状态面生成物 | `completed` / 已归档 |

- 实现提交必须在 `run-once` 之前或任务仍为 `submitted / working` 时完成；不要等 `run-once` 把任务推到 `completed` 再回头提交实现。
- 状态面生成物只由 CLI 产出并单独提交，不写进回执 `changedFiles`。
- `task-entry-gate` 的 `no-active-task` 提示会在存在 completed 归档任务时明确给出这条两阶段说明；硬门本身不放宽。

### 5.6.4 文档 LF / BOM 规范化

```powershell
node scripts/orchestration/cli.mjs docs normalize --path docs/worklog/completed/phase2.5/af084-xxx.md
node scripts/orchestration/cli.mjs docs normalize --path docs/worklog/completed/phase2.5/af084-xxx.md --apply
```

- 默认只读：打印 `BOM / CR 数量 / 字节变化`，不写盘。
- `--apply` 才写回，统一为 UTF-8 无 BOM + LF。
- 只允许 `docs/` 下的文本文件，避免误改源码。
- 交付记录写完先跑一次只读检查，再进回执预检。

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

| 文件                                      | 角色                                                                                         | 通用层对应                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `task-state-index.json`                   | 本项目状态索引（真实任务记录与归档指针）                                                     | 框架仓 `schemas/task-state-index.schema.json`                                    |
| `framework-version-anchor.md`             | 框架 tag / commit / 未发版 HEAD 的唯一锚点与引用规则                                         | 框架仓 `schemas/versions.json`                                                   |
| `acceptance-checklist.md`                 | 项目特定验收命令与仓库边界                                                                   | 五类核对口径见框架仓 `docs/acceptance.md`                                        |
| `relay-receipt-template.md`               | 回执 / 交付记录的项目路径约定与命令示例                                                      | 七组字段骨架见框架仓 `templates/receipt.template.md`、`docs/receipt-contract.md` |
| `agent-cards/*.json`                      | 本项目代理能力声明（executor / orchestrator；human 不可派发故无卡）                          | 框架仓 `schemas/agent-card.schema.json`、`templates/agent-card.template.md`      |
| `agent-cards/README.md`                   | 能力声明边界说明（human 不产卡的依据、卡片字段口径）                                         | 框架仓 `docs/roles.md`、`schemas/agent-card.schema.json`                         |
| `tools/<TOOL-ID>.json`                    | L2 工具链工具声明（一工具一文件；类别、角色白名单、副作用级别）                              | 框架仓 `schemas/tool-contract.schema.json`、`docs/tools.md`                      |
| `orchestration-state.json`                | L2 运行态（租约、领单、超时等；首次 run-once 生成）                                          | 框架仓 `docs/reliability.md`、`docs/autonomous-loop.md`                          |
| `orchestration-snapshot.json`             | 队列快照（网页与 CLI 只读数据源）                                                            | 框架仓 `docs/autonomous-loop.md`                                                 |
| `delivery-packs/`                         | 夜间交付包汇总输出目录                                                                       | 框架仓 `docs/autonomous-loop.md` 交付包结构                                      |
| `improvement-log.json`                    | 候选改进台账（缺口 / 护栏 / 工具 / 规范 / 债的登记与闭环）                                   | 框架仓 `docs/context-and-memory.md` §2 共享记忆分层                              |
| `improvement-loop.md`                     | 改进闭环字段、状态机、闸门边界与命令口径（adapter 活文档）                                   | 框架仓 `docs/context-and-memory.md`、`docs/evolution.md`                         |
| `autonomous-team-design.md`               | 双代理派发通道、分支治理、文件域互斥、分层发布与回退设计备忘                                 | 框架仓 `docs/roles.md`、`docs/autonomous-loop.md`、`docs/reliability.md`         |
| `channel-failure-decisions-2026-11-17.md` | 通道失败权威口径裁定（终态出口 / 预算归属 / 熔断维度 / 定性范围 / 演练基线，IM-020·023–027） | 框架仓 `docs/reliability.md` §4 / §5.1 / §7                                      |

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
