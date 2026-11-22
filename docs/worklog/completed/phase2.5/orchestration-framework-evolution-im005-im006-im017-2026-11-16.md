# 框架仓跨仓演进（IM-005 / IM-006 / IM-017）— 交付记录

- **状态**：✅ 完成（2026-11-16，框架仓纯规范层落地 + 本仓台账/快照/看板回写；本仓零规则代码改动）
- **基线 HEAD**：本仓 `f2918af`（== `origin/integrate`）；框架仓 `agent-collaboration-framework` 基线 `49f0eb5` → 提交 `016d6b8`（已推送 `origin/main`，工作区干净）
- **范围**：框架仓 12 份规范 / schema / 模板 / 样例 / 文档指针；本仓仅 `improvement-log.json`、`orchestration-snapshot.json`、`web/orchestration/data.js` 三份台账与双写产物。`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff；零新增依赖
- **取证来源**：框架仓 `schemas/`、`templates/`、`examples/`、`docs/`、`adapters/README.md`、`CHANGELOG.md`、`README.md`；本仓 `handover-contract.mjs`、`validator.mjs`、台账 `improvement-log.json`

---

## 一、背景

编排纯函数批（AF-015/016/017）与台账批次 IM-022、IM-021 推送后，本仓 adapter 纯函数 / 纯文档 / 台账层已无内聚可闭环项。经四方向比选，选定**框架仓跨仓演进**：在独立框架仓 `agent-collaboration-framework` 处理三条台账条目——IM-005（枚举 / schema 复用消除双源镜像）、IM-006（review 交接件结构上提框架 schema / 模板）、IM-017（熔断扩展位参数化口径）。

框架仓为纯规范层（Markdown + JSON Schema Draft 2020-12 + Markdown 模板 + 样例 + adapters 规范），无运行时代码、脚本、CI、`package.json` 与 node 依赖。

## 二、方案约束（决定落地形态）

本仓 `validator.mjs` 用 ajv 2020-12 `ajv.compile(schema)`，**未注册外部 `$ref` resolver**（无 `addSchema` / `resolve`），跨文件 `$ref: "./x.schema.json#..."` 无法编译。故 IM-005 落地**不引入跨文件 `$ref`**：枚举 / 模式在各 schema 内部收敛到文件内 `$defs`（ajv 原生支持）；另新增纯 JSON 数据真相源文件供适配层读取常量，schema 内 enum / pattern 保持自包含。枚举取值与正则值保持不变（脚本校验 types / statuses / pattern 全一致）。

## 三、框架仓落地明细（commit `016d6b8`，12 文件，368 insertions / 28 deletions）

### 3.1 IM-005：枚举 / 模式双源镜像收敛（框架侧真相源就位，条目留 candidate）

| 文件                                   | 动作 | 内容                                                                                                                         |
| -------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `schemas/contract-enums.json`          | 新增 | 枚举 / 模式数据真相源（非 Schema）：`taskTypes` 6、`taskStatuses` 10、`finalStatuses` 3、`reviewVerdicts` 3、`taskIdPattern` |
| `schemas/task-sheet.schema.json`       | 修改 | `taskType` / `taskStatus` / `taskId` 收敛进内部 `$defs` 并用 `$ref` 复用                                                     |
| `schemas/task-state-index.schema.json` | 修改 | 内部 `$defs/taskId` 复用三处 taskId；`taskStatus` description 标注与 contract-enums 同源                                     |

枚举现状值（语义未变）：`taskTypes = implementation, review, investigation, documentation, fix, verification`；`finalStatuses = completed, failed, rejected`；`reviewVerdicts = passed, conditional-pass, rejected`；`taskIdPattern = ^[A-Z0-9]+-[0-9]+$`。

### 3.2 IM-006：review 交接件标准件上提（条目流转 done）

| 文件                                               | 动作 | 内容                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas/review-handover.schema.json`              | 新增 | `$id urn:agent-collaboration-framework:schema:review-handover:1.0.0`；必填 `reviewId / taskId / contextId / proposal / risks / alternatives / disputes / recommendation / createdBy / createdAt`；可选 `resolution{decision 必填, rationale / resolvedBy / resolvedAt}`；`additionalProperties: true` |
| `templates/review.template.md`                     | 新增 | review 交接件 Markdown 模板                                                                                                                                                                                                                                                                           |
| `examples/example-review-handover.json`            | 新增 | 中性样例（`taskId TASK-001`、`reviewId REVIEW-001`、`contextId CTX-EX-001`）                                                                                                                                                                                                                          |
| `docs/roles.md` §2.6、`docs/autonomous-loop.md` §9 | 修改 | critic 角色与自治循环补 review-handover 契约指针                                                                                                                                                                                                                                                      |

口径约束：`resolution.decision` 为自由文本，**不套用验收三级结论枚举**（方案意见裁决 ≠ 验收 verdict）。

### 3.3 IM-017：熔断扩展位参数化口径固化（条目留 candidate）

| 文件                       | 动作 | 内容                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/reliability.md` §5.1 | 修改 | 新增「熔断扩展位参数与计数口径」：计数维度 = 按工具 / 下游实例通用计数，跨任务复用同一熔断平面，**不按通道 / 任务另立独立熔断**；阈值 / 观察窗口 / 试探次数由适配层声明（本规范不固化数值）；状态概念位 closed / open / half-open；触发 / 试探 / 恢复均升级为可观察事件；熔断（工具 / 下游平面）与死信（任务平面）分工互不替代 |

### 3.4 索引与版本回写

| 文件                    | 动作 | 内容                                                                                                                 |
| ----------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `README.md`             | 修改 | 版本 1.1.0 → 1.4.0；目录导览（schemas / templates / examples）；§5 契约表加 review-handover 行 + contract-enums 说明 |
| `adapters/README.md` §6 | 修改 | 枚举读取行（适配层读 contract-enums 常量）                                                                           |
| `CHANGELOG.md`          | 修改 | 新增 `[1.4.0] - 2026-11-16` 段（向后兼容新增，次版本）                                                               |

## 四、台账变更（本仓 `improvement-log.json`，total 28）

| 台账   | 层 / 类型             | 流转                                   | 说明                                                                                                                                                                       |
| ------ | --------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM-006 | framework / standard  | `candidate → queued → accepted → done` | 框架 1.4.0 落地 review-handover 标准件（commit `016d6b8`）；`linkedTaskId=AF-009`；本仓 adapter 切读框架 schema 另批                                                       |
| IM-005 | adapter / tech-debt   | 保持 `candidate`                       | 框架侧枚举 / 模式真相源已就位；剩余 adapter 接线：`handover-contract.mjs` 改读 `contract-enums.json`，消除手写 `TASK_TYPES / TASK_STATUSES / TASK_ID_PATTERN` 镜像（另批） |
| IM-017 | framework / guardrail | 保持 `candidate`                       | 框架侧扩展位参数语义与通用计数口径已固化（§5.1）；阈值数值与计数实现仍归适配层 P2（接入真实通道时声明）                                                                    |

台账终态：**done 12、accepted 1、candidate 15**（total 28）。IM-005 / IM-017 仅更新 `evidence` / `impact` / `suggestion` 与 `updatedAt`，未追加状态迁移 history（无状态变化）。

## 五、闸门证据

| 命令 / 校验                                                                   | 结果                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**116 passed**；Duration 957ms；EXIT=0                                                 |
| `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**（状态索引、工具契约、三角色 Agent Card）；EXIT=0                                         |
| `improvement-log.json` / `orchestration-snapshot.json`                        | JSON 解析 OK；快照含 `improvements` 段；计数与台账一致（done 12 / accepted 1 / candidate 15）         |
| 编码探测（台账、快照、contract-enums、review-handover schema、样例）          | 全部 **no-BOM、LF**                                                                                   |
| 业务源码隔离                                                                  | `git diff --stat HEAD -- src/engine-core src/migration test` 为空；本批无 `src` 改动                  |
| 框架仓 schema 编译（落地时）                                                  | ajv 2020-12 编译全部 5 份 schema 成功；taskIndex / agentCard / review / toolContract 四类样例回归通过 |

> 本批本仓无 `scripts/*.mjs` 规则改动，未重跑 `pnpm lint:fast`（沿用 AF-017 0 warning / 0 error 基线）；未跑全量 typecheck（台账 JSON / 快照 / 看板 JS / 框架 Markdown 与 JSON 不进入 `src/test` 运行时，同 IM-021 / IM-022 口径）。框架仓无测试 / CI，JSON 合法性用 `JSON.parse` 校验，编码探 BOM / CR。

## 六、遗留条目与保留理由（本批未闭环，维持 backlog）

| 台账                                       | 类型 / 层                                  | 保留理由                                                                                                                        |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| IM-005                                     | implementation / tech-debt / adapter       | 框架侧 `contract-enums.json` 真相源已就位；本仓 `handover-contract.mjs` 仍手写常量镜像，待 adapter 批次切读框架枚举文件消除双源 |
| IM-017                                     | review / guardrail / framework             | 框架 §5.1 口径槽位已固化；连续失败阈值数值、观察窗口、试探次数与计数实现归适配层 P2，依赖真实桌面通道接入                       |
| IM-025                                     | acceptance / gap / adapter                 | 开放问题：熔断阈值通道侧复用通用熔断还是独立计数；与 IM-017 近义，评审时评估合并；不擅自删改，待框架定调                        |
| IM-002 / IM-003                            | review / tech-debt / adapter               | typeorm-model-generator 废弃链、uuid / glob / minimatch 传递依赖；业务开发期工具债，随主依赖升级处理                            |
| IM-007                                     | implementation / tech-debt / adapter       | 回执幂等次键补工件版本号；工件版本字段名 / 生成规则框架 task-contract 未固化，待框架契约后落 adapter                            |
| IM-011 / IM-012 / IM-018 / IM-019 / IM-020 | implementation / review / acceptance / gap | scope glob 展开、squash 自动化、L3 远端 CI、development 分支退役、两仓文档大项；均 P2 或高风险 / 跨仓大项，非本批纯规范范围     |
| IM-023 / IM-024 / IM-026 / IM-027          | acceptance / gap / adapter                 | 通道终态出口、重试预算归属、失败定性三分法豁免、演练基线取值；待框架 reliability.md 定调后回填                                  |
| IM-028                                     | implementation / gap / adapter             | 派发决策链运行时接线；依赖真实桌面通道激活（P2），规则层函数已备                                                                |

### 框架仓既有漂移（非本批引入，未擅自改动）

- 框架仓 README 导览未列既有样例 `example-tool-audit-record.json`、`example-protocol-view.json`；属既有漂移，留待框架仓导览整理批次核对。

## 七、审计链

- 台账 `improvement-log.json`：IM-006 done（四级 history + resolution）；IM-005 / IM-017 candidate 证据与剩余项更新；快照 `orchestration-snapshot.json` 与看板 `web/orchestration/data.js` 由 CLI `refreshSnapshotArtifacts` 双写刷新。
- 本记录为台账治理 / 跨仓规范类单份交付记录（无 AF 任务单落索引归档段，同 IM-004 / IM-021 / IM-022 先例）。
- 框架仓产物均在提交 `016d6b8`，`origin/main` 同步；本仓改动尚未提交（提交分组与推送按编排批次闸门统一处理）。
