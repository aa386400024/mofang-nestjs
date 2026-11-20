---
taskId: AF-004
contextId: framework-bootstrap
title: 框架规范边界补齐与本仓遗留小修 —— 终态工件归宿、归档字段口径、残留识别、历史回溯、轮询档位与 L1/L4 清理
type: documentation
status: completed
baselineRef: 2ac2993
dependsOn: [AF-003]
policyRefs: []
createdAt: 2026-11-15
---

# AF-004 · 框架规范边界补齐与本仓遗留小修（纯文档 + JSON 口径 · 零运行代码）

> 状态：✅ 已交付（2026-11-15）｜交付记录：`docs/worklog/completed/phase2.5/af004-framework-hardening-implementation-2026-11-15.md`　｜　执行方：MiniMax Code　｜　编排：主控 Doubao
> 归档说明：本单任务单**未移动**（仍留在 `docs/worklog/pending/`），归档与索引回写由主控在验收时一并处理 —— 理由见交付记录偏差 D-1。
> 仓库：本仓 `E:\Work\Project\backend\mofang-nestjs`（分支 `integrate`，基线 HEAD `2ac2993`）；框架仓 `E:\Work\Project\agent-collaboration-framework`（本地独立 git，未挂远端）
> 任务性质：纯 Markdown 规范文档 + 索引 JSON 口径 + `.gitattributes`；不写运行时代码、不建脚本 / CI / 依赖、不跑全量测试。

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. 框架仓 `docs/state-machine.md`（状态枚举、迁移路径、状态规则、归档对应）
2. 框架仓 `docs/task-contract.md`（任务单字段组、工件模型、不可变规则、字段扩展）
3. 框架仓 `docs/reliability.md`（幂等、领取租约、重试与失败定性、崩溃恢复）
4. 框架仓 `adapters/README.md`（六类映射项；通用层不含任何项目取值）
5. 框架仓 `examples/example-task-state-index.json`（归档条目轻量结构样例）
6. 本仓适配层 `docs/team/agent-orchestration/README.md`（目录映射、角色绑定、通用层指针）
7. 本仓索引 `docs/team/agent-orchestration/task-state-index.json`（待小修对象）
8. 本任务单（就是你在读的这份）

## 1. 背景与目标

AF-003 验收通过并已分组提交到 `integrate`。复盘框架契约调研与验收遗留，确认三类待补口径与两项低风险遗留：

- **规范缺口（通用层）**：终态（`canceled` / `failed` / `rejected`）半成品工件归宿未成文；归档条目「是否允许二次补录运行态字段」未显式口径；崩溃恢复后残留文件识别判据缺失；历史任务回溯路径未集中说明。
- **本仓遗留**：索引 `version` 仍为 `"1.0"`（schema 要求三段 semver，是 ajv 校验唯一报错点）；`.gitattributes` 未对 md / json 显式声明 `eol=lf`。
- **编排口径**：relay 轮询档位（S / M / L 预估时长、deadline 缓冲、兜底检测次数）需在 adapter 取值层成文。

**目标**：通用层规范补齐到企业级口径（字段只增不删、不新增 schema 必填项、不破坏 1.0.0 契约）；本仓两项遗留清零；档位表作为 adapter 取值的唯一真相源。

### 关键现状（已核对，别当新问题）

- 框架仓：docs 10 篇 + schema 2 份 + 模板 2 份 + `adapters/README.md` + examples；CHANGELOG 当前 `[1.0.0]`；README 第 5 行标注「版本 1.0.0」。
- 本仓索引：`tasks[]` 为空、`archivedTasks[]` 20 条；`version="1.0"`；`schemaRef` 为框架 URN。
- 返修关联已有机制：`rejected` 后同一 `contextId` 下新开任务，新任务经 `priorTasks` 指向被拒单（state-machine §4.1 注、§6）；**本单不新增 `reworkOf` 字段**。
- `.gitattributes` 现状：`* text=auto` + `*.js eol=lf` + `*.ts eol=lf`。

## 2. 范围（严格遵守，不越权）

### 2.1 在范围内 —— 框架仓（通用层）

**F1. 终态工件归宿**（落 `state-machine.md` §5 状态规则或 `reliability.md` 新增小节，按内容归属择定，两处不重复定义）：

- `canceled` / `failed` / `rejected` 终态任务：任务单 `artifacts` 清单之外的半成品文件不登记为交付工件；索引归档条目只记录终态与已交付指针；半成品由编排者在提交分组前识别并排除，不得混入交付提交。
- 文字与既有 §4.1 / §6 不可变原则衔接；不新增状态、不新增迁移路径。

**F2. 归档字段口径显式化**（`task-contract.md` §6 或 `state-machine.md` §7）：

- 归档条目字段集合 = `taskId` / `status` / `artifacts`；`contextId` / `type` / `agent` / `claimedAt` / `dependsOn` / `policyRefs` / `createdAt` / `baselineRef` / `deadline` / `verdict` / `history` 等运行态字段不回填、不二次补录。
- 如实说明：schema 显式定义 `artifacts.taskSheet` / `artifacts.deliveryRecord`；`reply` 属 `additionalProperties` 放宽项（兼容既有回执指针），**不是**显式契约字段。
- schema 的 `additionalProperties` 放宽仅为向前兼容，不得作为运行态字段回填通道。

**F3. 半成品残留识别**（`reliability.md` §6 崩溃恢复补一条规则）：

- 恢复 / 验收时以任务单 `artifacts` 清单与 `scope.files` 为基线，比对工作区实际新增文件；清单外文件判为残留，不进提交分组，登记进交付记录落地组。

**F4. 历史回溯约定**（`task-contract.md` §6 内补一小节，或 `state-machine.md` §7）：

- 已完成任务经 `archivedTasks[]` 指针回溯任务单 / 交付记录 / 回执；归档目录只读；新任务不得改写历史条目；返修在同一 `contextId` 下新开任务并经 `priorTasks` 关联（不新增字段）。

**F5. 版本与变更记录**：

- 按框架仓 `CHANGELOG.md` §版本号含义判定本次变更级别：纯措辞 / 表格 / 链接修正 → 修订号；新增独立规范章节 → 次版本；不新增 schema 字段、不改枚举、不改必填性，故不触发主版本。
- 本次 F1–F4 含新增规范小节，预期落**次版本 1.1.0**；若执行者判定全部为既有章节内措辞补充，则落修订号 1.0.1，判定理由必须写进交付记录。
- 同步更新 `CHANGELOG.md` 条目与 `README.md` 版本行。

### 2.2 在范围内 —— 本仓 adapter（mofang-nestjs）

**A1.** 索引 `version`：`"1.0"` → `"1.0.0"`（对齐 schema semver pattern）；其余索引内容一字不动。

**A2.** `.gitattributes`：在既有规则后追加 `*.md eol=lf`、`*.json eol=lf`；保留 `* text=auto` 与 js / ts 两行。

**A3.** 适配层 README `docs/team/agent-orchestration/README.md` 新增「轮询档位」小节（置于 §4 工具与闸门命令之后，编号顺延）：

| 档位 | 预估时长                          | deadline 缓冲 | 兜底检测次数 |
| ---- | --------------------------------- | ------------- | ------------ |
| S    | 10–15 min                         | +10–15 min    | 1            |
| M    | 20–30 min                         | +20–30 min    | 2            |
| L    | 40–60 min（类推缩短，不拉长窗口） | +30–45 min    | 2–3          |

并注明：平台 cron 最小间隔为 1 小时；分钟级自适应间隔属本地常驻 watcher（框架演进 backlog），本形态不实现；档位取值是 adapter 层编排口径，不进通用层 schema。

**A4.** 任务单模板 `docs/team/wp-task-template.md` 调度组（`priority` / `deadline` / `retention` 附近）补一行备注：档位取值以适配层 README 轮询小节为准（SSOT，模板不复制阈值数字）。

### 2.3 明确不在范围内（禁止顺手做）

- 不新增任何 schema 字段（含 `reworkOf`）；不改状态枚举、不改字段必填性、不改既有字段语义。
- **L2**（wp-list §四 引言行数校准）：计数基准（方案行是否计入交付口径）尚未定义，留 backlog，本单不改引言数字。
- 不写 watcher、状态机自动化、机读校验脚本（框架 L1 演进 backlog）。
- 不碰 `src/`、`test/`、`bin/`、`scripts/`、`admin-dashboard/`、`src/migration/`、`.github/`、`.husky/`、`package.json`、锁文件。
- 两仓均不执行 git commit / push；交付记录给 commit message 草稿即可。
- 不改历史交付记录与已归档任务单正文；不回填 TD-5…TD-21、AF-001…AF-003 任何历史字段。
- 框架仓不挂远端；`development` 分支不推；phase3 设计稿 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 不入库、不登记、不改动。

## 3. 交付物（逐文件规则）

### 3.1 框架仓

| 文件                                                                  | 动作 | 规则                                                                                       |
| --------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `docs/state-machine.md`                                               | 改   | F1 终态工件归宿 / F2 归档字段口径（归属按内容择定，与 task-contract 不重复定义）           |
| `docs/task-contract.md`                                               | 改   | F2 归档字段口径 / F4 历史回溯（契约字段与不可变规则在 contract，状态迁移在 state-machine） |
| `docs/reliability.md`                                                 | 改   | F1（若归宿口径放可靠性）+ F3 残留识别                                                      |
| `CHANGELOG.md`                                                        | 改   | F5 版本条目                                                                                |
| `README.md`                                                           | 改   | F5 版本行同步                                                                              |
| `docs/` 其余 7 篇、`schemas/`、`templates/`、`adapters/`、`examples/` | 不动 | —                                                                                          |

> F1 / F2 在 state-machine 与 task-contract 之间的归属由执行者按上述分工落位；同一口径只在一处成文，另一处用指针引用，不复制正文（SSOT）。

### 3.2 本仓

| 文件                                                  | 动作 | 规则                               |
| ----------------------------------------------------- | ---- | ---------------------------------- |
| `docs/team/agent-orchestration/task-state-index.json` | 改   | 仅 `version` → `"1.0.0"`；其余不动 |
| `.gitattributes`                                      | 改   | 追加 md / json `eol=lf` 两行       |
| `docs/team/agent-orchestration/README.md`             | 改   | A3 轮询档位小节                    |
| `docs/team/wp-task-template.md`                       | 改   | A4 调度组备注一行                  |

## 4. 红线（违反即返工）

- **通用层零业务耦合**：框架仓新增段落不得出现 `mofang`、`心塑`、`XinSu`、本机路径、具体命令名、真实任务标识；项目取值只留在本仓 adapter。
- 阈值数字只在适配层 README 一处成文；模板与其他文档只引用，不复制。
- 工件指针只写仓内相对路径；不写本机绝对路径进 JSON 或 Markdown 链接。
- 不新增依赖、不改锁文件、不改任何代码与配置。
- 历史交付记录与归档任务单只读；发现口径问题另开任务登记，不在本单修改。
- 不自动 commit / push。

## 5. 闸门（纯文档 / JSON 校验，填真实结果，禁止留空）

| #   | 检查项         | 命令 / 方法                                                                                                               | 通过标准                                                                                             |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | JSON 合法性    | `node -e "JSON.parse(...)"`（本机 PS 5.1 无 `Test-Json`；可辅以 `ConvertFrom-Json` 交叉验证，报错留档，不 silently skip） | exit 0，无解析错误                                                                                   |
| 2   | 契约级校验     | 工作区既有 `ajv@8.20.0`（`ajv/dist/2020`）对框架 task-state-index schema 复跑                                             | errors=0（version 修正后原唯一报错清零）                                                             |
| 3   | 工件指针存在性 | 索引内每个非 null `artifacts.*` 路径 `Test-Path` 且 Length > 0                                                            | 全部存在非空                                                                                         |
| 4   | 范围隔离       | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard`（两仓分别）对照 §2 在范围清单                    | 无 `src/ test/ bin/ scripts/ admin-dashboard/ migration/`、CI、配置、锁文件改动；phase3 设计稿未入库 |
| 5   | 编码           | 字节探测：无 BOM（`EF BB BF`）、CR 计数 = 0                                                                               | 新增 / 改写的 md 与 JSON 全部 UTF-8 无 BOM、LF                                                       |
| 6   | 通用层零耦合   | 对框架仓本次改动段落 grep `mofang` / `心塑` / `XinSu` / `E:\Work` / 具体脚本名                                            | 零命中                                                                                               |
| 7   | 链接一致性     | README / 模板新增相对链接 `Test-Path`                                                                                     | 全部存在                                                                                             |

本单零代码，不跑 tsc / eslint / vitest；交付记录证据组写上述 7 项的实际命令、退出码与结果。

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/af004-framework-hardening-implementation-2026-11-15.md`

字段骨架以框架仓 `templates/receipt.template.md` 与 `docs/receipt-contract.md` 为准，七组对应：

0. **任务标识**：`taskId / contextId / baselineRef / dependsOn / policyRefs / finalStatus / reviewVerdict`
1. **落地**：一句话总结 + 改动文件清单（新建 / 修改 / 改名 / 删除，逐个一句用途）+ 工件指针
2. **证据**：§5 闸门表（命令 / exit code / 真实结果）+ 复现说明
3. **范围**：`scopeCheck / parallelArtifactsExcluded / noOutscopeRefactor`
4. **契约**：schema 字段对齐、归档口径说明、版本级别判定理由
5. **遗留**：`backlogItems / openQuestions / manualReviewList`（L2 计数基准、watcher 演进等另案项逐条列出，不在本单清理）
6. **偏差**：实际实现 vs 任务单方案，有偏差写原方案 / 实际方案 / 理由
7. **结论**：`finalStatus / reviewVerdict / verdictRationale`

## 7. 【交付回写清单】做完逐项勾选

- [x] 交付记录已写到 §6 固定路径
- [x] 框架仓 F1–F4 口径成文，同一口径只在一处定义、他处指针引用
- [x] CHANGELOG 条目与 README 版本行已同步，版本级别判定理由入交付记录
- [x] 本仓索引 `version = "1.0.0"`，其余字段未动
- [x] `.gitattributes` 追加 md / json `eol=lf`
- [x] 适配层 README 轮询档位小节成文；模板备注引用该小节
- [x] §5 七项闸门结果写入交付记录证据组
- [x] 未触碰 §2.3 排除项；phase3 设计稿仍未跟踪
- [x] 给两仓各自的 commit message 草稿（不自己 commit / push）

## 8. 回复输出约定

完成后把完整回复内容原样写入：

`docs/worklog/pending/archive/relay-response-20261115-<实际完成 HHMM>.md`

（时间戳用你实际回复完成的时间。写完文件后在对话里说一句「已写入文件」即可，不用重复贴全文。）
