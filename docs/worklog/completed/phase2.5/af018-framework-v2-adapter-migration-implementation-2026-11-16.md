# AF-018 交付记录 · 协作适配层迁移到框架 v2.0.0

> 任务单：`af018-framework-v2-adapter-migration-2026-11-16.md`｜执行：主控 AI（orchestrator 自做）｜日期：2026-11-16
> 仓库：`D:\work\Project\backend\mofang-nestjs`（分支 `integrate`，基线 `1aa12fe`，未提交）
> 上游：框架仓 `D:\work\Project\agent-collaboration-framework`，tag `v2.0.0` = `c507188`（已 push）

## 1. 落地

框架 2.0.0 发布后，本仓协作适配层仍按 1.x 口径声明。本单把**数据 / 代码 / 文档 / 运行态**四层一次性迁移到 2.0.0，并把验收阶段发现的 5 处遗漏补齐，全程保留既有实现进度（34 条归档、9 条归档说明、改进台账、运行态 DR-001）。

### 1.1 数据与运行态

| 工件                                                                                      | 变化                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/team/agent-orchestration/task-state-index.json`                                     | 升 `task-state-index:1.1.0`；`tasks: []`；34 条归档原样；9 条 `note` 外移 `archivedNotes`；`note` 声明未启用事件溯源；新增 AF-018 归档条目（35 条 / 10 条说明） |
| `docs/team/agent-orchestration/tools/TOOL-*.json`                                         | 6 个单文件工具契约（`state-store` ×4、`gate-execution` ×1、`artifact-archive` ×1），旧 `orchestration-tools.json` 删除                                          |
| `docs/team/agent-orchestration/delivery-packs/pack-20261115-225603.json`                  | 改 `delivery-package:1.0.0`（`cycle` / `counts` / `tasks` / `leftovers`），旧结构整体留 `legacy`（4 条 `taskResults` / 0 条 `openItems`）                       |
| `docs/team/agent-orchestration/agent-cards/{executor,orchestrator}.json`                  | 改 `contractRef`；`tools` 改工具 ID（orchestrator）；`human.json` 删除                                                                                          |
| `docs/team/agent-orchestration/transport/tasks/DR-001.json`                               | 升 `task-sheet:1.1.0`；`agentRole: executor`；artifact 三字段；references 三对象；从游离的仓库根 `transport/` 归位到配置声明目录（gitignore 覆盖）              |
| `docs/team/agent-orchestration/tool-audit-log.json`                                       | 从旧快照恢复 12 条审计（类别按 8 值枚举映射），作为运行态审计链（gitignore 覆盖）                                                                               |
| `docs/team/agent-orchestration/orchestration-snapshot.json` + `web/orchestration/data.js` | 按新工具类别与 129 例逻辑重生成（35 条归档 / 12 条审计）                                                                                                        |

### 1.2 代码（`scripts/orchestration/`）

| 文件                                         | 变化                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract-enums.json` / `contract-enums.mjs` | 投影框架 2.0.0 枚举（25 键）；导出 14 组枚举 + `CONTRACT_REF_PATTERN` / `ENUMS_VERSION`；`FINAL_STATUSES` 兼容别名                         |
| `state-store.mjs`                            | `PATHS.toolsDir`、`loadToolContracts()` 目录遍历、`listDeliveryPacks()` 新结构 + 旧键兼容                                                  |
| `tool-registry.mjs`                          | 全量重写：目录建注册表、toolId 模式 / 类别 / 副作用 / 角色校验、`call()` 白名单 + 审计                                                     |
| `validator.mjs`                              | 新增 `deliveryPackage` schema、`validateToolDir`、`loadVersions`、`validateContractVersion`、`validateDeliveryPackage`；schemaId 动态化    |
| `delivery-pack.mjs`                          | 重写为 delivery-package 1.0.0 生成器；`tasks[]` 只收指针齐全的终态任务，缺口入 `meta.pointerGaps`；未知状态入 `leftovers.manualReviewList` |
| `cli.mjs`                                    | `validate` 改目录口径 + 新增交付包 / 运行态任务单两个 section；pack 摘要读新字段                                                           |
| `acceptance-runner.mjs`                      | V6 改目录遍历 + `contractRef` / 文件名 / 类别断言；`TOOL_CATEGORIES` 改为枚举单一来源                                                      |
| `handover-contract.mjs`                      | `contractRef` 三常量；回执契约组改 `contractRef`；`createdAt` 校 `date-time`；`agentRole` 空则省略                                         |
| `protocol-mapper.mjs`                        | `buildProtocolView` 增 `unknownStatuses`，落实 `unknownEnumPolicy: tolerant`                                                               |

### 1.3 测试

- fixtures：`valid-task-sheet.json`（`createdAt +08:00` + `contractRef`）、`valid-task-index.json`（1.1.0）。
- 修 4 例旧断言（`validateToolDir` / `TERMINAL_STATUSES` / `contractRef` / `date-time`），新增 7 例（真实工件只读合规、`validateContractVersion` 漂移拦截、临时目录非法类别拦截、`generateDeliveryPack({write:false})` 过 schema、归档说明外移、tolerant 未知状态、工具目录契约字段）。

### 1.4 文档

- 适配层 README：版本表 / 角色表（human 不可路由）/ 目录映射（`tools`）/ §4.1 工具类别映射理由表 / §4.2 交付包口径 / 文件表 / 通用层指针 / `archivedNotes` 扩展说明。
- `agent-cards/README.md`：human 不产卡依据、`tools` 取值口径（有契约填 toolId、无契约填 8 值类别）、维护规则。
- `wp-task-template.md`：`createdAt` date-time、`contractRef`、`auth-required` 冻结态、交付记录回写项改 `contractRef`。
- `AGENTS.md`、`docs/README.md`：项目地图加框架仓与协作规范入口、路径改 D 盘、闸门命令改 pnpm。
- 4 篇架构备忘：边界句锚到 `v2.0.0`；字段名 `schemaVersion → contractRef`；l1-l3 工具路径与角色卡数量更正。
- `autonomous-team-design.md`：`human.json` 引用改为"不产卡 + 边界说明"。
- `acceptance-checklist.md`、`relay-receipt-template.md`：工具路径、机读 JSON + 人读 MD 成对、`contractRef`、`finalStatus` 补 `canceled`。

## 2. 证据

| 闸门        | 命令                                                                          | 结果                                                                                              |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| schema 校验 | `node scripts/orchestration/cli.mjs validate`                                 | **6/6 PASS，0 违规**（迁移前同类校验 26 条违规）                                                  |
| 编排层单测  | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | **129 passed / 0 failed**（迁移前 4 failed / 118 passed；122 → 129，净增 7）                      |
| 保留性校验  | `python verify_preservation.py`（workspace）                                  | 备份 34 条：缺失 0、状态与工件指针逐条一致 True、9 条说明一一对应 True；`DR-001` 内容字段差异：无 |
| 归档说明    | 同上                                                                          | 旧 9 条 → 新 `archivedNotes` 10 条（含 AF-018）                                                   |
| 交付包结构  | 同上 + CLI                                                                    | `legacy.taskResults` 4 条 / `openItems` 0 条；`leftovers` 0/0；`packageId PACK-20261115-225603`   |
| 审计链      | 快照复核                                                                      | `toolAudits` 12 条、`archivedCount` 35                                                            |
| 展示层      | 重生成 `data.js`                                                              | 旧类别名 0 命中（仅工具 ID 子串命中检索词）                                                       |

未跑：`pnpm lint` / `pnpm typecheck` / `pnpm test` 全量（按 `AGENTS.md` §2.3 由用户收尾执行一次）。

## 3. 范围核对

- `src/engine-core`：**零改动**；业务源码、依赖、migration 零改动。
- 改动只落在 `docs/`、`scripts/orchestration/`、`AGENTS.md` 与运行态 transport；未纳入用户未跟踪设计稿 `phase3-judge-layer-ai-review-design-2026-11-15.md`。
- 并行产物：无其他进程写入；`improvement-log.json` 条目内容未改写。
- 历史只读：`docs/worklog/archive|completed/` 中 `E:\` 旧路径未批量重写（历史记录只读纪律）。

## 4. 契约核对

- 六类契约 `contractRef` 与框架 `versions.json` 对账一致：task-sheet / task-state-index / tool-contract / agent-card / delivery-package / review-handover 均为 2.0.0 发布版本（1.1.0 或 1.0.0）。
- 兼容声明 `>=2.0.0 <3.0.0`、`unknownEnumPolicy: tolerant` 已写入适配层 README，并在 `protocol-mapper` 落地。
- 枚举单一来源：`contract-enums.mjs` 为唯一枚举入口，`acceptance-runner` 不再自带类别数组。

## 5. 遗留与另案

- 用户侧全量闸门（lint / typecheck / 全量 test）未跑，属交付前最后一步。
- `improvement-log.json`（6 条候选）与 `orchestration-snapshot.json` 的语义内容按既有台账保留；快照已按新结构重生成。
- 历史任务单若 `createdAt` 仅日期，`handover-contract` 的 date-time 校验会拒绝；当前在途 0 条，无实际阻塞，派单前需补时区偏移。
- 本仓禁止自动 commit / push：改动全部留在工作区，commit message 草稿随交付说明给出。

## 6. 偏差（实际 vs 任务单）

| 项             | 原方案                 | 实际                                              | 原因                                                            |
| -------------- | ---------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| 运行态目录     | 保持 `transport/` 原位 | 归位到 `docs/team/agent-orchestration/transport/` | 原位在 gitignore 之外，可被误提交；代码与文档的权威路径均在后者 |
| 快照与审计     | 仅迁移 schema 实例     | 另恢复 12 条审计并重生成快照                      | 审计日志文件缺失，历史仅在快照内；不恢复会丢失审计链            |
| 角色卡 `tools` | 不在迁移清单           | orchestrator 改工具 ID、executor 保留类别         | 旧类别名已不在 8 值枚举，语义过时但 schema 不拦                 |
| 工作记录       | 不在迁移清单           | 补 AF-018 任务单 + 交付记录 + 索引条目            | 本仓每个 AF 任务均有成对记录，缺失会断链                        |
