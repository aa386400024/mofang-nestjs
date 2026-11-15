# mofang-nestjs 协作适配层（Project Adapter）

> 本目录是接入通用 **agent-collaboration-framework** 的项目适配层。
> 通用规则（角色模型、任务契约、状态机、回执契约、验收口径、可靠性、上下文与记忆、安全策略、人在环、演进路线）的唯一真相源在框架仓，本文件**只声明本项目的特定取值**（目录映射、角色绑定、工具与闸门命令、策略锚点、框架版本依赖），不复制通用规则正文。
>
> - 框架仓本地路径：`E:\Work\Project\agent-collaboration-framework`（当前为本地独立 git 仓，未挂远端、未发包；框架仓挂远端后，引用改为仓库路径或版本化 schema 引用）
> - 适配层声明规范：框架仓 `adapters/README.md`（六类映射项）
> - 代码红线、命令规范、分层归属：`docs/team/conventions.md`；任务单模板：`docs/team/wp-task-template.md`，不在此重复。

---

## 1. 标识与框架版本依赖

| 项                      | 值                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `projectId`             | `mofang-nestjs`（心塑 / XinSu 后端 NestJS 仓）                                             |
| `frameworkVersionRange` | `>=1.0.0 <2.0.0`                                                                           |
| 框架契约版本            | 任务单 / 状态索引 / 工具声明 schema 均为 1.0.0（见框架仓 `schemas/` 的 `$id`）             |
| 框架发布版本            | 当前本地发布版本 `1.2.0`（框架仓为本地独立 git、未挂远端未发包；挂远端后以版本化引用为准） |

> 框架契约发生破坏性变更（字段删除或语义改变）时，先复核本适配层的版本区间与字段对齐，再升级；既有字段只增不删。

## 2. 角色绑定（roleBindings）

框架角色枚举与隔离规则见框架仓 `docs/roles.md`；本表只声明本项目的执行方映射与兼任制衡。

| 框架角色                | 本项目执行方            | 是否兼任             | 兼任制衡手段                                                                                                                           |
| ----------------------- | ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Human`                 | 用户（大炮）            | —                    | 目标与方向、策略 / 红线例外批准、技术路线选型、跨任务架构变更、验收分歧仲裁、git push 决定；不实现工作单元                             |
| `orchestrator`          | 主控 AI（Doubao）       | —                    | backlog 维护、任务拆解与切片、优先级与依赖、派发、claim 管理、验收组织、归档与索引回写、超时释放、升级判定；不写业务实现、不扩任务范围 |
| `executor`              | 执行 AI（MiniMax Code） | —                    | 按任务契约实现、内循环自测、收尾闸门、写交付记录与偏差表、按约定回执；不扩范围、不改策略边界、不新增依赖、不自动提交推送               |
| `reviewer`              | 主控 AI（Doubao）       | 与 orchestrator 兼任 | 验收结论只能基于工件证据与抽跑复现，不引用执行侧「已通过」的自述；验收阶段不改代码，新问题另开任务                                     |
| `researcher` / `critic` | 当前未启用              | —                    | 框架角色保留，需要调研或独立评审任务时再绑定                                                                                           |

## 3. 目录映射（directories）

| 映射项                        | 本项目落点                                                               |
| ----------------------------- | ------------------------------------------------------------------------ |
| `directories.taskSheets`      | `docs/worklog/pending/`（`ready / submitted / working` 任务单）          |
| `directories.deliveryRecords` | `docs/worklog/completed/<phase>/`（任务单 + 交付记录成对归档，只读历史） |
| `directories.replyArchive`    | `docs/worklog/pending/archive/`（回执原文、中间产物归档）                |
| `directories.artifacts`       | 各任务单切片范围内的源码 / 测试 / 规格路径；工件正文留在各自文件         |
| `directories.stateIndex`      | `docs/team/agent-orchestration/task-state-index.json`                    |

四类落点互不重叠；任务单与交付记录成对归档；状态索引纳入 git 版本控制，保证崩溃后可重建。工件正文留在各自文件，状态索引只存**指针与状态**，不复制正文（见框架仓 `docs/task-contract.md` 工件模型）。

## 4. 工具与闸门命令（tools / gates）

工具类别、声明结构、IO 契约与调用审计见框架仓 `docs/tools.md`；工具副作用分级、敏感操作审批节点见框架仓 `docs/security-and-policy.md`；本项目命令口径固定如下，详细分层闸门见 `docs/team/wp-task-template.md` §5。

| 项                         | 本项目取值                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 包管理器                   | `pnpm`（`packageManager=pnpm`）；禁止裸 `npx`；跑脚本 `pnpm <script>`，跑二进制 `pnpm exec <bin> <args>`                                            |
| 内循环                     | `pnpm lint:fast` / `pnpm lint:deep` / `pnpm typecheck` / 单文件 `pnpm exec vitest run <file>` / `pnpm test:changed` / `pnpm test:related -- <file>` |
| 收尾全量（每任务一次）     | `pnpm typecheck`、`pnpm lint`、`pnpm test`；另跑 `git diff --stat HEAD -- src/engine-core` 核对内核边界                                             |
| 验收侧                     | 定向测试 + 关键路径抽跑 + 触碰文件快速复查 + 边界核对 + 范围核对；不重跑全量（升级全量的条件见模板 §5.4）                                           |
| 前端闸门（仅授权前端任务） | 在 `admin-dashboard/` 目录跑 `pnpm type-check` / `pnpm build-only`，不套用后端 tsc / eslint                                                         |
| 敏感操作                   | git commit / push、engine-core 例外改动、策略边界冲突处理，绑定 Human 批准；AI 不自动 commit / push                                                 |

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

| 文件                        | 角色                                     | 通用层对应                                                                       |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `task-state-index.json`     | 本项目状态索引（真实任务记录与归档指针） | 框架仓 `schemas/task-state-index.schema.json`                                    |
| `acceptance-checklist.md`   | 项目特定验收命令与仓库边界               | 五类核对口径见框架仓 `docs/acceptance.md`                                        |
| `relay-receipt-template.md` | 回执 / 交付记录的项目路径约定与命令示例  | 七组字段骨架见框架仓 `templates/receipt.template.md`、`docs/receipt-contract.md` |

## 8. 通用层指针（规则真相源在框架仓）

| 主题                                       | 框架仓位置（`E:\Work\Project\agent-collaboration-framework\`）                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 角色模型与隔离规则                         | `docs/roles.md`                                                                               |
| 任务单字段组与工件模型                     | `docs/task-contract.md`；`schemas/task-sheet.schema.json`；`templates/task-sheet.template.md` |
| 状态枚举与迁移规则                         | `docs/state-machine.md`                                                                       |
| 回执七组字段契约                           | `docs/receipt-contract.md`；`templates/receipt.template.md`                                   |
| 验收五类与三级结论                         | `docs/acceptance.md`                                                                          |
| 可靠性（租约、超时释放、重试、崩溃恢复）   | `docs/reliability.md`                                                                         |
| 上下文隔离与记忆分层                       | `docs/context-and-memory.md`                                                                  |
| 权限、策略与审计                           | `docs/security-and-policy.md`                                                                 |
| 工具契约（类别、声明结构、权限收口与审计） | `docs/tools.md`；`schemas/tool-contract.schema.json`；`templates/tool.template.md`            |
| 人在环模式与升级                           | `docs/human-in-the-loop.md`                                                                   |
| 演进路线 L0–L3                             | `docs/evolution.md`                                                                           |
| 适配层声明规范                             | `adapters/README.md`                                                                          |

## 9. 与仓库文档的衔接

| 事项                                               | 位置                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| 任务单模板（frontmatter 字段、固定结构、回写清单） | `docs/team/wp-task-template.md`                                            |
| 交付记录归档约定                                   | `docs/worklog/completed/<phase>/*-implementation-*.md`                     |
| 台账与 backlog                                     | `docs/team/gate-performance-remediation-2026-11-11.md` 及阶段 wp-list      |
| 架构设计留档                                       | `docs/architecture/`（通用概念以框架仓为准；项目约束与待决策见各文档附录） |
| 回执归档                                           | `docs/worklog/pending/archive/relay-response-*`                            |
