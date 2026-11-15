---
taskId: AF-002
contextId: framework-adapter-decoupling
type: documentation
baselineRef: 2b03756
dependsOn: [AF-001]
policyRefs: []
finalStatus: completed
reviewVerdict: passed
---

# AF-002 交付记录 · 框架副本剥离为薄 Adapter · 模板改引用框架契约

> 交付记录按通用框架回执契约（七组字段）书写；§2 闸门数字均为本次本机实跑/只读核对结果，不留"待执行"。
> 框架仓库：`E:\Work\Project\agent-collaboration-framework`（独立仓库，AF-001 已验收闭环，提交 `a195318`，main 分支）。本轮**未向框架仓搬运或改动任何内容**。
> 本仓（mofang-nestjs）本轮主控工作仅限 `docs/team/` 与 `docs/architecture/` 文档；`src/`、`test/` 零改动。所有产物**未暂存、未提交、未 push**，分组清单见 §7，待用户拍板。

---

## 0. 任务标识

| 字段            | 值                           |
| --------------- | ---------------------------- |
| `taskId`        | AF-002                       |
| `contextId`     | framework-adapter-decoupling |
| `type`          | documentation                |
| `baselineRef`   | 2b03756                      |
| `dependsOn`     | AF-001                       |
| `policyRefs`    | （无）                       |
| `finalStatus`   | completed                    |
| `reviewVerdict` | passed                       |

---

## 1. 落地

### 1.1 改写文件清单（6 个，全部 UTF-8 无 BOM、LF）

| #   | 路径                                                                    | 字节  | 改动要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `docs/team/agent-orchestration/README.md`                               | 8103  | 重写为 adapter 入口：按框架 `adapters/README.md` 六类映射项填真实取值——`projectId=mofang-nestjs`、`frameworkVersionRange=>=1.0.0 <2.0.0`、角色绑定（Human=大炮 / orchestrator=主控 Doubao / executor=MiniMax Code / reviewer=主控兼任，制衡：验收只基于工件证据与抽跑复现）、目录映射、工具闸门（pnpm 口径）、策略锚点（`conventions.md` §1.1/1.2/1.3/1.4/三、gate-performance 台账）、通用层指针表（框架仓 docs / schemas / templates 逐文件对照）。通用规则正文不再复制。                                                                   |
| 2   | `docs/team/agent-orchestration/acceptance-checklist.md`                 | 4782  | 重写：五类核对口径指向框架 `docs/acceptance.md`；本文件只保留项目命令清单（`git diff` / `Test-Path` / vitest / `pnpm lint:fast` / typecheck）、仓库特定边界（engine-core、admin-dashboard、并行产物排除、既有债基线）、结论分级与索引状态映射。                                                                                                                                                                                                                                                                                               |
| 3   | `docs/team/agent-orchestration/relay-receipt-template.md`               | 4229  | 重写为指针页：保留项目路径约定与证据组闸门命令示例（pnpm tsc / lint / vitest / 全量 / 边界）；七组字段骨架指向框架 `templates/receipt.template.md`；frontmatter 示例标注框架 type 枚举与历史类型映射。                                                                                                                                                                                                                                                                                                                                        |
| 4   | `docs/team/wp-task-template.md`                                         | 19603 | 三处精准 Edit：① 头部加框架契约来源说明；② frontmatter 补 `title`（框架必填）、`type` 改框架枚举 `implementation / review / investigation / documentation / fix / verification`（历史映射：`repository-port` / `feature`→implementation，`docs`→documentation，`fix` / `verification` 不变）；③ §6 交付记录七组编号对齐框架（0 标识 / 1 落地 / 2 证据 / 3 范围 / 4 契约 / 5 遗留 / 6 偏差 / 7 结论）。保留既有章节号骨架（§0 必读入口 / §2 范围 / §5 闸门 / §7 回写清单），避免 conventions、gate-performance、历史归档文档的章节号引用断链。 |
| 5   | `docs/architecture/multi-agent-baseline-profile-2026-11-15.md`          | 25078 | 头部加"框架归属（2026-11-15 标注）"段：通用概念章节已由框架仓 v1.0.0 承载，口径以框架仓为唯一真相源；本仓文档保留项目特定选型与基线取值。                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | `docs/architecture/multi-agent-collaboration-loop-design-2026-11-15.md` | 32989 | 头部加归属标注：通用概念以框架仓为准；选型论证留作本仓目标态参考。                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 1.2 未改动文件（项目数据，保留不动）

| 路径                                                  | 说明                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `docs/team/agent-orchestration/task-state-index.json` | 项目状态索引，L0 工件指针存储；本轮未改。结构：`version=1.0`、`tasks=1`（TD-21）、`archivedTasks=16`（TD-5…TD-20），JSON 合法。 |

### 1.3 框架仓状态

- 分支 `main`，HEAD `a195318 chore: bootstrap agent-collaboration-framework v1.0.0`；`git status --porcelain` 无输出（干净）；无远端、未 push。本轮未向框架仓搬运或改动任何文件。

---

## 2. 证据

### 2.1 编码探测（终测，7 个文件含未改动索引）

| 文件                                                               | 字节  | BOM   | CR（CRLF 计数） |
| ------------------------------------------------------------------ | ----- | ----- | --------------- |
| `agent-orchestration/README.md`                                    | 8103  | False | 0               |
| `agent-orchestration/acceptance-checklist.md`                      | 4782  | False | 0               |
| `agent-orchestration/relay-receipt-template.md`                    | 4229  | False | 0               |
| `agent-orchestration/task-state-index.json`                        | 7280  | False | 0               |
| `wp-task-template.md`                                              | 19603 | False | 0               |
| `architecture/multi-agent-baseline-profile-2026-11-15.md`          | 25078 | False | 0               |
| `architecture/multi-agent-collaboration-loop-design-2026-11-15.md` | 32989 | False | 0               |

> 归一化前初测：模板与两份 architecture 为 CRLF（CR=True），已统一转 LF 无 BOM；终测 7 文件 CR 全 0、BOM 全 False。

### 2.2 框架仓被引用文件存在性（17 个，全部 exists=True）

README.md、CHANGELOG.md；`docs/`：roles.md、task-contract.md、state-machine.md、receipt-contract.md、acceptance.md、reliability.md、context-and-memory.md、security-and-policy.md、human-in-the-loop.md、evolution.md（10）；`schemas/`：task-sheet.schema.json、task-state-index.schema.json（2）；`templates/`：task-sheet.template.md、receipt.template.md（2）；`adapters/README.md`（1）。

### 2.3 本仓相对链接目标存在性（11 个，全部 exists=True）

`docs/team/conventions.md`、`docs/team/wp-task-template.md`、`docs/team/gate-performance-remediation-2026-11-11.md`、`agent-orchestration/task-state-index.json`、`agent-orchestration/acceptance-checklist.md`、`agent-orchestration/relay-receipt-template.md`、`agent-orchestration/README.md`、`docs/architecture`、`docs/worklog/pending`、`docs/worklog/pending/archive`、`docs/worklog/completed`。

### 2.4 索引结构与可解析性

- `version=1.0`、`tasks=1`、`archivedTasks=16`；`Test-Json` = True。
- 索引内 TD-21 工件指针（任务单 / 交付记录 / 回执）路径齐全；history 四段状态迁移完整（ready→submitted→working→submitted→completed）。

### 2.5 模板 diff 纯净度

`git diff -- docs/team/wp-task-template.md`：33+ / 8-，改动仅三处——契约来源说明段、frontmatter YAML（补 `title`、type 枚举、历史映射注）、§6 七组字段编号对齐框架 + 回写清单补三条（状态索引更新 / 审计链闭合 / policyRefs 留痕）。无混入其他改动。

### 2.6 既有 tracked 台账 diff 归属核对

三份 tracked M 台账文件（gate-performance 台账、phase2.5-README、wp-list）diff 经逐条核实，均为 **TD-21（P-DEBT-11 C2 第五批 counselor 金句子族）落地回写**：台账 P-DEBT-11 行更新 + 两条更新记录、README 增 TD-21 条目、wp-list 增 TD-21 行；与本单（AF-002 框架 adapter）无关，归 TD-21 文档组。

### 2.7 闸门说明

本单为文档 / 契约对齐类改动，无 `src` 代码变更：

- 类型检查 / lint / 单测：本单未触碰代码，不重复跑全量（全量闸门归 TD-21 交付记录，3377 passed + 4 skipped / 201 文件，以 TD-21 回执为准）。
- 断链 / 编码 / JSON 解析：见 §2.1–2.4，全部通过。

---

## 3. 范围

### 3.1 本单改动面

- 允许目录：`docs/team/agent-orchestration/`、`docs/team/wp-task-template.md`、`docs/architecture/` 两份框架归属标注文档。
- 未触碰：`src/`、`test/`、`bin/`、`package.json`、锁文件、CI 配置、`src/migration/`、engine-core。

### 3.2 并行产物隔离（显式排除，不进本单提交）

| 排除项                                                                                                                                     | 归属                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`                                                                      | phase3 并行设计稿，项目特定设计，本轮未改动 |
| `docs/worklog/pending/archive/relay-response-20261114-1524.md` / `1719.md` / `1818.md`、`20261115-0227.md` / `0346.md` / `1211.md`（6 份） | 历史回执原文归档，可另起归档组              |
| TD-21 全部 `src/`、`test/` 与台账回写                                                                                                      | TD-21 任务，归组 A / B，不混入本单组 C      |

### 3.3 未顺手重构

未清理既有技术债、未改其他历史文档章节号、未迁移索引历史 type 值（见 §5 遗留）。

---

## 4. 契约

### 4.1 通用层 / 适配层分界

- 通用规则（角色模型、任务契约、状态机、回执契约、验收口径、可靠性、上下文记忆、安全策略、HITL、演进）唯一真相源 = 框架仓 docs / schemas / templates；本仓文档只存项目取值与指针，不再复制规则正文。
- 适配层六类映射项（projectId、frameworkVersionRange、角色绑定、目录映射、工具闸门、策略锚点）在 `agent-orchestration/README.md` 逐项填真实值，对齐框架 `adapters/README.md` 规范。

### 4.2 字段与枚举对齐

- 任务单 frontmatter：`taskId / contextId / title / type / status / baselineRef / dependsOn / policyRefs / createdAt`；type 枚举取框架 `implementation / review / investigation / documentation / fix / verification`。
- 回执七组编号：0 标识 / 1 落地 / 2 证据 / 3 范围 / 4 契约 / 5 遗留 / 6 偏差 / 7 结论，对齐框架 `docs/receipt-contract.md`。

### 4.3 口径真相源

- 框架字段 / 状态机 / schema：以框架仓 `schemas/` 与 `docs/` 为准。
- 本仓台账真相源：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11。
- 消费端不另抄阈值 / 枚举；本单未新增任何复算口径。

---

## 5. 遗留项与建议人工复核

### 5.1 backlogItems

| #         | 项                                                                                                              | 影响面                                      | 建议                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| L-AF002-1 | 索引 `tasks[0].type` 仍为历史值 `repository-port`（框架枚举外）；16 条 archivedTasks 的 type 同理未批量迁移     | L0 索引数据；不影响当前状态机迁移与工件指针 | 后续另案批量迁移 type 值（按模板历史映射表）；迁移前确认框架索引 schema 对历史 type 的兼容性                  |
| L-AF002-2 | 索引 `schemaRef` 仍指向本仓 `multi-agent-baseline-profile-2026-11-15.md#5.2`（状态模型说明），未指向框架 schema | 索引自描述指针                              | 框架 schema 落地后评估是否改为框架 schema 路径；L0 阶段不阻塞                                                 |
| L-AF002-3 | 框架仓尚未声明 LICENSE；远端托管决策 = 暂不挂（见 §5.2 决策 3）                                                 | 框架作为通用仓对外复用的合规前提            | LICENSE 推荐 MIT（备选 Apache-2.0），版权人署名待用户确认后作为框架仓小任务落地；远端再评估条件见 §5.2 决策 3 |

### 5.2 决策结论（2026-11-15，用户授权按主控推荐落地）

| #   | 议题                                                                                       | 决策                                           | 理由（企业级口径）                                                                                                                                                                     | 状态                                           |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | 闸门 3 字段名是否改名：`artifactSchema`、`noOutscopeRefactor`（备选 `noAdjacentRefactor`） | **保留现状，不改名**；词边界口径不变           | 契约字段名随 schema v1.0.0 发布即冻结；演进用新增字段 + deprecation，不做破坏性重命名。现状口径已通过 AF-001 验收；改名波及 schema、模板、契约文档 3+ 处并偏离真相源，收益仅可读性     | 已定，无代码改动                               |
| 2   | AF-001 任务单"17 路径"计数笔误（实际 18，偏差 D-1）                                        | **回改为 18**；任务单 §7 闸门 1、§8.1 两处已改 | 任务单仍在 pending（未归档、非只读历史）；审计链要求任务单与交付记录计数一致                                                                                                           | 已落地（本环境，未提交）                       |
| 3   | 框架仓是否挂 GitHub 远端                                                                   | **现阶段不挂远端**，保持本地独立仓             | v1.0.0 刚验收，LICENSE 未声明、L1/L2/L3 未实现、任务单机读校验待 L1；对外公开前先补 LICENSE 与稳定基线。再评估触发条件：LICENSE 落地 + L1 机读校验完成 + 首个第二项目 adapter 验证通过 | 已定决策，backlog 跟踪                         |
| 4   | 本地 `development` 分支是否 push（merge commit `3144747`，未 push）                        | **不代为执行，留用户手动**                     | push 为外部不可逆动作；红线规定 AI 不自动 push。是否 push 由用户本人执行                                                                                                               | 待用户手动                                     |
| 5   | 框架层许可条款                                                                             | **推荐 MIT**；备选 Apache-2.0                  | 框架自用 + 通用化、独立开发者场景，MIT 最宽松、兼容性最好、法律文本最简；Apache-2.0 含显式专利授权，留作未来商业化 / 专利顾虑时备选。版权人署名须由用户确认，未擅自写入 LICENSE 文件   | 推荐已定；LICENSE 文本与版权人待用户确认后落地 |

### 5.3 manualReviewList

- 回执字段表与模板对照抽查（沿用 AF-001 manualReview）。
- 索引 schema 必填项抽查（沿用 AF-001 manualReview）。
- 另一台机器 clone 后复核 LF 行尾（沿用 AF-001 manualReview）。
- 本单两份 architecture 归属标注段：人工确认未误删项目特定选型论证内容。

### 5.4 归档待办

- AF-001 任务单 `docs/worklog/pending/agent-framework-bootstrap-task-2026-11-15.md` 按 D-4 仍留 pending/；其归档与母版回写留给主控在 mofang 提交时一并处理。

---

## 6. 偏差登记

| #         | 偏差                                                              | 原方案 / 框架口径                              | 实际处置                                 | 原因                                                                                                      |
| --------- | ----------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D-AF002-1 | 索引历史 type 值未迁移                                            | 框架 type 枚举 6 值                            | 保留历史值，登记 L-AF002-1               | 索引是项目历史数据，本轮只做 adapter 剥离；批量迁移另案，避免在文档单里混入数据回改                       |
| D-AF002-2 | 模板保留既有章节号骨架（§0 / §2 / §5 / §7），未照搬框架模板章节序 | 框架 `templates/task-sheet.template.md` 章节序 | 框架字段组映射到既有章节号内，章节号不动 | conventions、gate-performance、历史归档文档存在章节号引用；重排章节号会制造断链，适配层允许章节骨架本地化 |
| D-AF002-3 | 三份 tracked 台账 M 文件归 TD-21 组，未计入本单改动               | 提交分组按任务归属                             | 单独归入组 B                             | diff 逐条核实为 TD-21 回写；本单（组 C）只含模板与 adapter / architecture 文档                            |

---

## 7. 结论

### 7.1 验收结论

**passed**。五类核对全清：

- **落地**：6 个改写文件 + 1 个未改动索引，存在且非空，字节 / 编码已核（§2.1）。
- **证据**：框架 17 引用路径、本仓 11 链接目标全部存在；索引 JSON 合法、结构完整；模板 diff 纯框架对齐（§2.2–2.5）。
- **范围隔离**：本单零 `src/test` 改动；并行产物与 TD-21 文件显式排除（§3.2）。
- **契约口径**：通用层 / 适配层分界清晰，字段枚举对齐框架，真相源唯一（§4）。
- **遗留登记**：backlog 3 条、openQuestions 5 条、manualReview 4 项均书面登记，不阻塞本单交付（§5）。

### 7.2 未提交产物分组清单（待用户拍板；AI 未执行任何 stage / commit / push）

> 注意：`docs/team/agent-orchestration/` 整目录为 untracked；提交时 `task-state-index.json`（组 B）与三件 adapter 文档（组 C）必须**按文件路径分别 `git add`**，不可整目录 add，避免混组。

**组 A · TD-21 代码**

- `src/counselor/counselor.module.ts`（M）
- `src/counselor/providers/quote.service.ts`（M）
- `src/counselor/data/`（?? 目录）
- `src/counselor/domain/repositories/`（?? 目录）
- `test/counselor/td21-counselor-quote-port-c2-batch5.spec.ts`（??）

**组 B · TD-21 文档与台账回写**

- `docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md`（??）
- `docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-task-2026-11-15.md`（??）
- `docs/team/gate-performance-remediation-2026-11-11.md`（M）
- `docs/worklog/pending/phase2.5-README.md`（M）
- `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`（M）
- `docs/team/agent-orchestration/task-state-index.json`（??）

**组 C · 框架 adapter 改造（本单 AF-002）**

- `docs/team/wp-task-template.md`（M）
- `docs/team/agent-orchestration/README.md`（??）
- `docs/team/agent-orchestration/acceptance-checklist.md`（??）
- `docs/team/agent-orchestration/relay-receipt-template.md`（??）
- `docs/architecture/multi-agent-baseline-profile-2026-11-15.md`（??）
- `docs/architecture/multi-agent-collaboration-loop-design-2026-11-15.md`（??）
- `docs/worklog/completed/phase2.5/af002-framework-adapter-decoupling-implementation-2026-11-15.md`（??，本交付记录）

**组 D · AF-001 框架交付归档**

- `docs/worklog/completed/phase2.5/af001-framework-bootstrap-implementation-2026-11-15.md`（??）
- `docs/worklog/pending/agent-framework-bootstrap-task-2026-11-15.md`（??）
- `docs/worklog/pending/archive/relay-response-af001-20261115.md`（??）

**显式排除（不进本次功能提交）**

- `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`（??，phase3 并行设计稿）
- `docs/worklog/pending/archive/relay-response-20261114-1524.md` / `1719.md` / `1818.md` / `20261115-0227.md` / `0346.md` / `1211.md`（??，6 份历史回执）

### 7.3 提交纪律备注

- 不使用 `--no-verify`；不跳过 pre-commit 钩子。
- 提交后用 `git show --stat --oneline <commit>` 核对实际收录文件，与上表逐条比对。
- push 永远由用户决定；AI 不自动 push。
