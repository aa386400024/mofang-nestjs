# 后端任务单模板（所有写入型开发任务通用）

> **用途**：本仓**所有写入型开发任务**（代码、测试、脚本、配置、migration、seed、DB/Redis、批量数据、环境启停）一律按本模板写任务单，不只用于派给 MiniMax Code；主 AI 自己做同样必须先立项。
> **强制门**：没有 `submitted / working` 编排任务不得开工；任务单登记用 `pnpm orchestration:task register --sheet <md>`，提交前由 `pnpm orchestration:preflight` 校验任务与 scope。只读问答/搜索/讨论不需要建任务。
> **为什么有这个文件**：之前任务单结构不一、读完不知从何下手、做完忘回写索引。本模板固化三件事——
> ① 开头固定「必读入口」，每次从同一条链路进；② 中间结构固定；③ 结尾有「交付回写清单」，做完逐项勾选，不许跳。
> **怎么用**：复制本文件 → 另存为 `docs/worklog/pending/<wp-id>-<slug>-YYYY-MM-DD.md` → 填掉所有 `{{双花括号}}` 占位 → 红字提示保留在任务单里提醒执行者。
> **契约来源**：任务单字段骨架与必填项以通用框架为准（框架仓 `templates/task-sheet.template.md`、`schemas/task-sheet.schema.json`、`docs/task-contract.md`）；本模板在框架骨架上叠加本项目的必读入口、范围红线、闸门命令与回写清单（适配层取值）。

---

## 头部（每条任务必填）

### A. YAML frontmatter（机器可读；状态索引与审计链依据。字段定义与必填项见框架仓 `docs/task-contract.md` 与 `schemas/task-sheet.schema.json`）

```yaml
---
taskId: TD-XX # 唯一标识，贯穿任务单 / 回执 / 索引 / commit message
contextId: phase2.5-c2-ports # 归组标识；返修新任务沿用同一 contextId
title: 任务一句话标题 # 必填；与正文 §B 标题一致
type: implementation # implementation / review / investigation / documentation / fix / verification
status: backlog # backlog / ready / submitted / working / input-required / completed / failed / canceled / rejected / auth-required（auth-required 为冻结态：缺授权只入不出，缺授权一律转 input-required）
baselineRef: 2b03756 # 版本锚点（commit ref）
dependsOn: [TD-20] # 上游任务；上游 completed 才解锁下游
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0 # 可选；契约引用 urn，版本以框架仓 schemas/versions.json 为准
policyRefs: [conventions.md#1.1, conventions.md#1.3] # 策略规则锚点，验收逐条核对
createdAt: 2026-11-15T00:00:00+08:00 # date-time，必须带时区偏移（框架 2.0.0 口径）
agentRole: orchestrator # 本任务目标角色；orchestrator / executor / reviewer
---
```

> 类型名历史映射：`repository-port` / `feature` → `implementation`；`docs` → `documentation`；`fix`、`verification` 不变。
>
> **调度组取值**：本模板 frontmatter 示例未展开可选的 `priority` / `deadline` / `retention`；需要声明时按框架字段组补入，档位与缓冲取值以适配层 README 的「轮询档位」小节为准（唯一真相源，见 [适配层 README §5](agent-orchestration/README.md)，模板不复制阈值数字）。

### B. 人类可读元信息（正文首屏）

```
# {{WP-ID}} · {{任务一句话名}}（{{企业级 / 修复 / 验证}}）

> 状态：📋 待执行（{{YYYY-MM-DD}}）
> 执行方：{{MiniMax Code / 自做}}
> 仓库：D:\work\Project\backend\mofang-nestjs，分支 {{integrate}}
> 唯一事实源：{{相关研究文档 / spec 路径，没有就写"无"}}
> 任务性质：{{新功能 / 数值标定落地 / bug 修复 / 纯验证 / 文档}}
> 改动范围：{{仅后端 src/test/bin/scripts ｜ 含 admin-dashboard 前端 ｜ 纯文档}}
```

> **改动范围怎么填**：决定本单文件归哪组提交、走哪套闸门（见 §2 隔离规则与 §5 闸门）。`admin-dashboard/` 是嵌在本仓库的 Vue 前端；后端任务默认「仅后端」，只有任务单明确授权才在该目录写前端代码。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

> 执行者：**先读完这些再写一行代码**。这是固定链路，每次任务都从这里进，不要直接改文件。

1. `D:\work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `D:\work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航（它会告诉你接任务单该看哪）
3. `D:\work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（**engine-core 分层归属边界、16 条硬约束全在这里**）
4. 阶段工作入口：`D:\work\Project\backend\mofang-nestjs\docs\worklog\README.md` → 当前阶段子入口（Phase2.5 任务读 `docs/worklog/pending/phase2.5-README.md` 和 `phase2.5-wp-list-2026-11-08.md`）
5. 本任务唯一事实源：`{{研究文档 / spec / 上一份交付记录路径}}`
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

{{两三段说清：现在是什么状态、为什么要做、之前踩过什么坑。不写背景直接上方案 = 方向错。}}

### 关键现状（已核对，别当新问题）

- {{已经存在什么、哪条链已经通了、哪些列/函数/表已经有了}}
- {{本任务消费数据的真实路径：谁读、经哪个函数、别改这条链}}

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- {{1}}
- {{2}}

**明确不在范围内（禁止顺手做）：**

- 不在 `engine-core/` 里加任何副作用（NestJS / DB / Redis / HTTP / prompt / 模型名 / process.env / console 心理原文）；`boundary.spec.ts` 不许改。
  - 反过来：**如果正确做法就是在内核里加一个纯函数/纯计算/新出口，就放在 `engine-core/`，不要为了"避开内核"把它堆到适配层**——纯计算归内核、IO 归 adapters，这才是对的分层。
- 不改表结构 / 不加 migration / 不加列（除非本任务明确写了要加）。
- 不改映射函数、resolver、module 装配（除非本任务明确要求）。
- 不碰任何角色的 `enabled` / `audit_status` / `version` / 内容字段。
- **前端目录边界**（`admin-dashboard/` 嵌在本仓库的 Vue 前端，与 Flutter 客户端都属前端范畴）：
  - 后端任务默认不写前端实现；任务单 §头部「改动范围」标了「含 admin-dashboard」时，才允许动前端代码（共享类型 / API client / 视图 / 组件 / 接线），且只写与任务单不冲突的部分，交互与样式沿用前端工程既有结构。
  - `admin-dashboard/**` **不进**后端 lint-staged 的 eslint / prettier，也不在后端 `tsconfig` 内；前端闸门在前端目录用其自带脚本跑（`vue-tsc` / `vite build`），不套用后端分号 / 折行风格。详见 §5.3。
  - Flutter 客户端代码一律不碰（独立仓库）。
- **提交分组隔离**：工作区可能并行存在其他进程（MiniMax Code / 前端 AI）的未提交产物；若用户授权代提交，只暂存本单文件，按任务分组分开 stage，不混入并行产物（详见 §7）。
- 提交与推送按发布分层口径执行（[设计备忘 §6.1](agent-orchestration/autonomous-team-design.md#61-发布分层自动化逐层收紧)）：executor 不建分支、不提交、不推送，写完给 commit 草稿；L1–L3 在闸门绿 + 验收五类通过等前置条件下由 orchestrator 自动；L4 冻结动作转人工批准。

---

## 3. 目标架构 / 交付物

> 按任务类型写。**设计原则固定四条**：单一真相源 / 内容与逻辑分离 / 出错当场炸不进库 / 幂等。

- **交付物 1：{{名字}}** —— {{路径、导出什么、什么类型、纯函数还是 Nest provider}}
- **交付物 2：{{名字}}** —— {{路径与行为}}
- **交付物 3：测试** —— {{覆盖哪些路径、含哪些负向用例、端到端断言到什么程度}}；标注测试形态：纯静态投影校验（不起 Nest / 不连 DB）／单元纯函数／集成／黄金样本回归。

> **口径真相源（涉及指标 / 阈值 / 枚举 / 版本号时必填）**：写明唯一真相源是哪个常量文件或只读端点；消费端（含前端展示、报告、测试）只读取该源，**不复算判定阈值、不另抄一份口径**；口径版本号随数据一起下发，便于审计追溯。

---

## 4. 红线（违反即返工）

- **分层归属（不是"不许碰内核"）**：纯决策计算 / 纯出口字段 / 纯类型该进 `engine-core/` 就进；`engine-core/` 里**禁止**任何 NestJS / IO / 网络 / prompt / 模型名 / 心理原文 console；`boundary.spec.ts` 是机器护栏，不许自己改。详见 `conventions.md` §1.1。
- 心理对话原文禁止进日志 / console / crash report（只出码和计数）。
- {{任务特有红线，如：数值单一真相源、只 UPDATE 不 INSERT、不碰内容列}}
- schema / migration / 映射函数按 §2 范围处理；不越权加需求外功能。
- 提交 / 推送按发布分层口径执行（设计备忘 §6.1）：executor 不提交；L1–L3 前置条件满足由 orchestrator 自动；L4 冻结动作（master 合并、tag、release、对外部署、策略例外、路线选型、跨任务变更、验收分歧、新增依赖）人工批准。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

> **V2026-11-12 更新（闸门提速落地）**：实测口径已变，按下面三层走。旧的"单文件 lint 也要 100s"已作为反例登记——**ESLint 单进程启动固定成本 ~70–100s（97% 是加载插件 + 建 TS 程序），所以"定向 ESLint"没有意义**；日常改一行用 oxlint（全仓 0.4s），ESLint 只在收尾跑一次。全量 tsc/eslint/vitest 仍不要每个小改动都跑，把**实际命令、exit code、结果数字**写进交付记录。跑不起来就写明报错原因，**不许 silently skip、不许写"待用户执行"、不许用 `--no-verify`**。

### 5.0 命令规范（强制，禁止裸 npx）

- 本仓库 `packageManager=pnpm`，**一律用 pnpm 跑脚本/二进制，不要用裸 `npx`**（裸 npx 启动慢，且会绕过缓存）。
- 跑 package.json 脚本用 `pnpm <script>`（如 `pnpm lint`）；直接跑二进制用 `pnpm exec <bin> <args>`（如 `pnpm exec tsc ...`）。
- **跑闸门前先确认机器干净**：没有 `nest start --watch` / 后台 `vite dev` / `dist/app` 在跑。实测 `nest start --watch` 连跑两天占 7.7k s CPU、1.5 GB 常驻，全量 vitest 从 1102 s 恶化到 1512 s。
- **跑闸门前先确认盘不慢（一条命令体检）**：`pnpm doctor:fs`（读 `node_modules/@nestjs/common` 200 个 `.js`，判据"均值 <1 ms/文件 且 慢文件占比 <5%"）。当前本机正常值约 **0.8 ms/文件**，读取延迟已归零。不通过说明读税回来了：本质是 **minifilter 按 inode 收税**——`node_modules` 若以 pnpm 默认 hardlink 装法从 store 继承旧 inode，约 35% 文件每次读付 200–260 ms，全量 vitest 会从 132 s 打回 1100 s。修复：`pnpm install --force --config.package-import-method=copy`（只在本机执行，**不要写进仓库 `.npmrc`**）。机制与实测见 `gate-performance-remediation-2026-11-11.md` §1.5。
- **取证会话先补 PATH**：执行环境的 `PATH` 可能不继承系统 `PATH`，本机 `git` 在 `D:\Apps\Git\cmd`。依赖外部命令的 spec 会因此报假失败（实测 `wp-h-wave2-3-batch-observability.spec.ts` 报 `spawnSync git ENOENT`，补齐 PATH 后 25/25 全绿）。**不补齐就下结论，等于把环境缺陷记成回归。**

### 5.1 日常内循环（高频，定向，秒~分钟级）

| 目的                                           | 命令                                                      | 实测耗时                                                                    |
| ---------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| 语法/明显缺陷（全仓）                          | `pnpm lint:fast`（oxlint，1295 文件）                     | **1.0s**                                                                    |
| 需要类型感知的快速一遍                         | `pnpm lint:deep`（`oxlint --type-aware`）                 | **26.8s**                                                                   |
| 类型（增量，走 `tsc -b` 缓存）                 | `pnpm typecheck`                                          | **1.8s（热）**，改文件后 ~3s                                                |
| 单个测试文件                                   | `pnpm exec vitest run <file.spec.ts>`                     | 秒级~十几秒                                                                 |
| 受影响测试                                     | `pnpm test:changed` / `pnpm test:related -- <src/xxx.ts>` | 分钟级以内                                                                  |
| 全量测试的快速近似（**非权威，且已证伪更快**） | `pnpm test:fast`（`isolate:false`）                       | **比权威全量更慢**（179.2 s vs 132 s），且 5 文件 27 例跨文件污染；仅供冒烟 |
| 读取延迟体检（跑闸门前）                       | `pnpm doctor:fs`                                          | **~0.8 ms/文件，退出码 0 = 可信**                                           |

- `pnpm test:fast` 不是提速手段：读税归零后实测 **179.2 s（147.14 s Duration）慢于权威 132 s**，且 `wp65`/`wp67` 的 `vi.mock('bullmq')`、Redis/DB 假状态跨文件残留导致 27 例红，`wp12` 被拖到 80.5 s 超时。它只用来"快速看有没有大面积挂"，**不作为交付证据**，交付证据必须用 `pnpm test`。原理与数据见 `gate-performance-remediation-2026-11-11.md` §1.5.3。

### 5.2 收尾全量闸门（每个任务只跑一次，交付前后台执行，可同时做别的事）

| 闸门        | 命令                                                     | 要求                                                                       | 实测耗时                                        |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| 类型        | `pnpm typecheck`（`tsc -b tsconfig.check.json`，走缓存） | 0 error；怀疑缓存失真时改跑 `pnpm typecheck:full`（无缓存全量）            | 热 **1.8s**，冷 87s，增删文件后 ~32s            |
| Lint        | `pnpm lint`（ESLint type-aware，权威，不降级）           | 0 error，记 warning 数                                                     | **49.3s（0 error / 0 warning，读取归零后）**    |
| 测试        | `pnpm test`                                              | 全绿，记用例总数与墙钟；**同时记录机器状态**（是否干净、盘读延迟是否正常） | **132s / 3004 passed / 0 failed（读取归零后）** |
| engine-core | `git diff --stat HEAD -- src/engine-core`                | 空（或写明例外批准）                                                       | 即时                                            |
| 任务特有    | {{如 seed 连跑两次幂等、边界 spec、连库抽查}}            | {{要求}}                                                                   | —                                               |

### 5.4 验收闸门（回收方：定向 + 范围核对，**不重跑全量**）

验收方（大炮 / 验收代理）默认**不重跑全量套件**；执行方交付记录里的全量数字 + CI 结果作为合并底线。验收动作固定为：

| 动作                | 命令                                                                | 目的                         |
| ------------------- | ------------------------------------------------------------------- | ---------------------------- |
| 1. 相关测试         | `pnpm test:related -- <本次触碰的 src 文件>` 或 `pnpm test:changed` | 验证改动面覆盖               |
| 2. 关键路径抽跑     | 1–2 条关键 spec 单文件复现                                          | 核对交付记录里的用例数与断言 |
| 3. 触碰文件快速复查 | `pnpm lint:fast` + `pnpm typecheck`                                 | 类型/lint 未退化             |
| 4. 边界核对         | `git diff --stat HEAD -- src/engine-core`                           | 内核零改动                   |
| 5. 范围核对         | `git diff --name-only HEAD` 对照任务单授权范围                      | 无越界、无并行产物混入       |

**只有以下情形才升级为全量复跑**：交付记录闸门数字存疑、发现并行产物混入、抽跑出现确定性失败、里程碑/冻结节点。

**为什么要这么定**：验收侧重复全量会让总成本翻倍（放大系数 ≈2，历史 581s×2≈19min）。执行方已跑过全量，验收再跑一遍不提供新信息，只消耗时间。

### 5.3 前端产物闸门（仅当 §头部改动范围含 admin-dashboard）

- 前端目录不走后端 `tsc` / `eslint` / `lint-staged`；授权任务的执行方在 `admin-dashboard/` 目录跑前端脚本：`pnpm type-check`（`vue-tsc --build`）+ `pnpm build-only`（纯 `vite build`，不串 type-check）。
- **既有类型债基线**：前端工程可能存在改动前就有的类型错误。交付记录要分开写「本单新增文件 / 新增改动 0 错误」与「既有债 N 条（改动前基线，本单未清理，隔离红线不顺手重构）」；不要把既有债误记为本单引入，也不在本单清理。
- 前端产物不套后端 lint 规则；若发现后端 lint-staged 误扫 `admin-dashboard/**`，按 §2 前端目录隔离处理，不为迁就后端规则改写前端风格。

---

## 6. 交付记录（完成后写，路径固定）

写完到：`docs/worklog/completed/{{阶段}}/{{wp-id}}-{{slug}}-implementation-{{YYYY-MM-DD}}.md`

**字段骨架以框架仓 `templates/receipt.template.md` 与 `docs/receipt-contract.md` 为准**；本项目路径约定与命令示例见 `agent-orchestration/relay-receipt-template.md`。七组对应内容：

0. 任务标识：`taskId / contextId / baselineRef / dependsOn / policyRefs / finalStatus / reviewVerdict`（审计链入口）
1. 落地：本单做了什么（一句话总结）+ 改动文件清单（新建 / 修改 / 删除，逐个一句用途）+ 工件指针
2. 证据：闸门表（命令 / exit code / 真实数字 error、warning、用例数）+ 复现说明
3. 范围：scopeCheck / parallelArtifactsExcluded / noOutscopeRefactor
4. 契约：契约核对（`contractRef` 与框架 `versions.json` 对账）、字段对齐；口径真相源唯一
5. 遗留：backlogItems / openQuestions / manualReviewList（风险与回归、既有测试改动原因、未碰边界确认）
6. 偏差：实际实现 vs 任务单方案，有偏差就写清原方案 / 实际方案 / 为什么（conventions §2.5），列偏差表
7. 结论：finalStatus / reviewVerdict / verdictRationale

---

## 7. 【交付回写清单】做完逐项勾选（之前总忘，这次不许跳）

> 这是硬清单，不是建议。交付记录写完后，**逐条确认都做了**，再在对话里收尾。

- [ ] 交付记录已写到 §6 的固定路径
- [ ] 本任务单从 `pending/` 移到 `completed/{{阶段}}/`，顶部状态行从 `📋 待执行` 改成 `✅` 并链接交付记录
- [ ] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` 里本任务那行状态改成完成、补交付记录链接
- [ ] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3「当前有什么活」表里挪走/改成本任务已完成
- [ ] 回写 backlog（若任务单 §2 指定了母版）
- [ ] 状态索引已更新：`docs/team/agent-orchestration/task-state-index.json` 中本任务状态迁移追加 `history`（时间 / from / to / by），工件指针（任务单 / 交付记录 / 回执）填全
- [ ] 审计链闭合：`taskId` 贯穿任务单 frontmatter、交付记录、回执、commit message 草稿与台账更新行
- [ ] `policyRefs` 锚点在交付记录契约组逐条留痕核对结果
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交分组已核对：本单文件清单与并行进程产物分开；若授权代提交，stage 时只含本单文件（后端目录 / admin-dashboard 前端文件 / 文档各自成组，不混提）
- [ ] 给一行 commit message 草稿（executor 不自己 commit/push；提交 / 推送按 §6.1 分层：L1–L3 前置条件满足由 orchestrator 自动，L4 转人工）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附该文件路径，不用重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不要把代码 diff 全文贴进对话，让用户自己 `git diff`。
