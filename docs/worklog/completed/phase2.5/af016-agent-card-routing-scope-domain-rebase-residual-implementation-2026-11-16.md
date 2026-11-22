---
taskId: AF-016
contextId: phase2.5-orchestration-closed-loop
title: 编排闭环护栏补全（Agent Card 能力路由 / 资源域越域校验 / 分支 rebase 巡检 / V7 残留采集接线）
type: implementation
status: completed
baselineRef: 2191d06
dependsOn: [AF-010, AF-011, AF-012]
policyRefs: [framework/agent-card.schema, autonomous-team-design.md#routing-scope-domain]
createdAt: 2026-11-16
---

# AF-016 · 编排闭环护栏补全 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 112 passed）
- **基线 HEAD**：`2191d06`（与 `origin/integrate` 一致；本批改动尚未提交）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：adapter 层纯函数 + 注入接线 + 单测 + 活文档口径；零业务源码改动、零进程 / 剪贴板 IO、零新增依赖
- **方案契约**：Agent Card `skills` / `tools` / `resources` / `availability` 声明与框架 `roles.md`；本仓 `autonomous-team-design.md` §3.6（路由与资源域）、§4.2（巡检）、§5（残留识别）；台账 IM-008 / IM-009 / IM-010 / IM-013

---

## 一、本单做了什么（一句话）

把台账四条编排闭环缺口在 adapter 层补为纯函数护栏：按 Agent Card 能力声明选择派发角色（IM-008）、任务 scope 与角色 `resources` 资源域越域校验（IM-010）、分支巡检采集 ahead/behind 标注待 rebase（IM-013）、git diff 变更清单采集接线激活 V7 残留护栏（IM-009）；调度与 CLI 仅做注入接线，能力与资源域真相源保持角色卡与框架 `roles.md`，脚本不另抄目录白名单。

## 二、改动文件清单

| 文件                                                      | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/card-router.mjs`（新增）           | `matchAgentCard({role, requiredSkills, requiredTools}, cards)`：`availability` 非 `available` 不入选，按 skill/tool 命中交集评分（skill 权重 2、tool 权重 1），返回命中 / 缺失明细与评分；`selectTargetRole(task, cards, opts)`：显式角色优先，显式角色不可用时保留该角色并透出原因（`explicit-role-fallback`），不擅自改派；无显式角色按能力匹配（`capability-match`）；`validateScopeDomain(task, cards, opts)`：只读 / 调研 / 评审 / 验证类豁免；目标卡缺失或卡未声明 `resources` 记 `errors`；否则逐条校验 `scope.files` 是否落在角色 `resources` 前缀内，越域清单进 `outside`。纯函数零 IO |
| `scripts/orchestration/dispatch.mjs`                      | `dispatchTask` 增 `opts.cards`：注入卡片投影时经 `selectTargetRole` 选择目标角色，派发记录 `targetRole` 取匹配结果，返回对象增 `route`（匹配明细）；未传 `cards` 时保持原 `opts.targetRole ?? task.agentRole` 口径，`route` 为 null；契约非法分支同样返回 `route`                                                                                                                                                                                                                                                                                                                               |
| `scripts/orchestration/state-store.mjs`                   | `loadAgentCards` 只读投影补 `resources` 字段（与 `protocol-mapper.mapCapabilityDeclaration` 既有读取对齐；此前该字段在投影侧为 undefined，经 `?? []` 兜底）                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `scripts/orchestration/branch-workflow.mjs`               | `classifyBranches` 输入增 `aheadBy` / `behindBy`；未合并且 `behindBy>0` 归入 `needsRebase`（优先于超期 stale 判定）；`planCleanup` 透出 `needsRebase` 名清单；git 端口增 `aheadBehind(name, base='integrate')`（`rev-list --count` 双向差量）与 `changedFiles()`（`git diff --name-only HEAD`）；新增纯函数 `collectChangedFiles(gitPort)`：端口缺方法或返回非数组时返回空清单，清单过滤空串与非字符串                                                                                                                                                                                          |
| `scripts/orchestration/scheduler.mjs`                     | 导入 `validateScopeDomain`；领单环节在文件域冲突校验后插入资源域越域拦截（`scope-domain-conflict` action，透传 `outside` 与 `errors`）；`dispatchTask` 调用透传 `cards`；`processReceipts` 增 `opts.changedFiles` 透传到 `runAcceptance`；`advanceOnce` 透传 `cards`（缺省 `loadAgentCards()`）与 `changedFiles`                                                                                                                                                                                                                                                                                |
| `scripts/orchestration/cli.mjs`                           | 导入 `collectChangedFiles`；run-once 与 watch 入口经 git 端口采集变更清单传入 `advanceOnce`；`collectBranches` 采集 `aheadBy` / `behindBy`；分支 list 输出增 `待 rebase` 分组与落后基线提交数                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`  | import 补入 `collectChangedFiles` 与 `card-router` 三函数；新增 18 个用例：能力评分 / busy 排除 / 显式回落不改派 / 能力匹配 / 空卡原因（5）；资源域内 / 越域 / 只读豁免 / 缺卡 / 无 resources（5）；needsRebase 分类 / planCleanup 透出 / 旧对象缺 behindBy 兼容（3）；采集器过滤 / 缺方法 / 非数组容错（3）；dispatch 路由接线与不传 cards 向后兼容（2）                                                                                                                                                                                                                                       |
| `docs/team/agent-orchestration/autonomous-team-design.md` | §3.6 新增「角色能力路由与资源域护栏」；§4.2 第 2 条补 ahead/behind rebase 标注口径；§5 第 3 条补 git diff 采集入口接线与空清单 skip 口径；§6.4 追加 AF-016 同步记录段                                                                                                                                                                                                                                                                                                                                                                                                                           |

> `scope-mutex.mjs` 本批未改：任务间文件域互斥与 `detectResidualFiles` 纯函数已就绪，资源域校验与采集接线分别落在 `card-router.mjs` / `branch-workflow.mjs`。

### 2.1 四条台账缺口逐条映射

| 台账   | 缺口                                                      | 本单处置                                                                                                                                 | 落点                                                                                             |
| ------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| IM-008 | 派发目标角色未按 Agent Card 能力声明匹配路由              | **已落地**：availability 门槛 + skill/tool 评分；显式角色优先，不可用保留不改派；匹配明细随 `route` 透出                                 | `card-router.mjs` `matchAgentCard` / `selectTargetRole`；`dispatch.mjs` 接线；备忘 §3.6          |
| IM-010 | 任务 scope 未与 Agent Card resources 角色资源域做越域校验 | **已落地**：`scope.files` 逐条校验资源域前缀；越域拦截派发；只读类豁免；投影补 `resources`                                               | `card-router.mjs` `validateScopeDomain`；`state-store.mjs` 投影；`scheduler.mjs` 拦截；备忘 §3.6 |
| IM-013 | 分支巡检未判定未合并分支是否落后 integrate（rebase 状态） | **已落地**：采集 ahead/behind 双向差量；`behindBy>0` 未合并分支单独标注 `needsRebase`，不与 stale 混同                                   | `branch-workflow.mjs` `classifyBranches` / `planCleanup` / `aheadBehind`；CLI list；备忘 §4.2    |
| IM-009 | 验收残留比对缺 git diff 采集器，V7 长期 skip              | **已落地**：git 端口 `changedFiles()` + 纯函数 `collectChangedFiles`；run-once / watch 采集清单透传 `runAcceptance`；空清单 V7 仍记 skip | `branch-workflow.mjs` `collectChangedFiles`；`cli.mjs` 入口；`scheduler.mjs` 透传；备忘 §5       |

## 三、闸门证据（本机实跑）

| 闸门         | 命令                                                                          | 结果                                                                                  |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 编排层单测   | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**112 passed**（基线 94 + 新增 18）；Duration 1.10s                    |
| 静态检查     | `pnpm lint:fast`（oxlint src test bin）                                       | **0 warnings / 0 errors**；1350 文件，93 规则，187ms                                  |
| 契约校验     | `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**：状态索引、工具契约清单、executor / human / orchestrator 三份 Agent Card |
| 业务源码隔离 | `git diff --stat HEAD -- src test`                                            | **空**（业务 `src/` 与 `test/` 零改动）                                               |
| 编码探测     | 改动 8 文件字节探测                                                           | 全部 `BOM=False`、`CR=False`（纯 LF、无 BOM）                                         |
| JSON 校验    | 索引 / 台账 / 快照 `Test-Json`                                                | 归档阶段 CLI 双写后复核（见 §五审计链）                                               |

> 未跑全量 typecheck：本批仅 `scripts/*.mjs` 纯规则与 docs，不进入 `src/test` 运行时；与 AF-015 同口径。

## 四、遗留与保留项（本批不做）

| 台账            | 保留原因                                                 | 后续口径                                                                             |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| IM-005          | 交接契约枚举 / taskId 模式与框架 ajv schema 双源镜像     | 复用框架 schema 消除手写镜像；跨模块契约改造，留 P1 backlog                          |
| IM-006          | review 交接件结构上提框架仓 schema 与模板                | 跨仓 framework 层演进，本仓不改框架                                                  |
| IM-007          | 回执幂等次键缺独立工件版本号（revision/version）         | 任务条目 / 交接件补版本字段，指纹以 taskId+version 为准；留 backlog                  |
| IM-011          | scope 通配路径仅降级目录前缀，未做真实 glob 展开         | P2 并行文件锁升级时引入只读路径匹配器；纯函数外采集层展开                            |
| IM-017          | 熔断阈值参数化与通道独立计数预留                         | P2 复用框架熔断扩展位；不另立通道独立熔断                                            |
| IM-018          | L3 合并接远端 CI 状态门禁                                | 本机无 gh CLI / token；接入后以 CI 状态作自动合并门禁，过渡口径不固化                |
| IM-019          | `development` 分支退役执行                               | 高风险不可逆，待人工拍板并复核 `integrate..development` 为空后执行                   |
| IM-002 / IM-003 | typeorm-model-generator 废弃工具链移除、传递依赖版本告警 | 业务依赖技术债，需评估 DB 反向生成需求并全量绿跑 + 墙钟数字，不属本批 adapter 工具链 |

## 五、审计链与回写清单

- [x] 任务单 `af016-agent-card-routing-scope-domain-rebase-residual-2026-11-16.md` 与本交付记录成对归档至 `completed/phase2.5/`
- [x] 索引 `task-state-index.json`：AF-016 经 `archiveTaskEntry` 迁入 `archivedTasks`，工件指针指向任务单与交付记录
- [x] 台账 IM-008 / IM-009 / IM-010 / IM-013 流转 `done`，`resolution.linkedTaskId = AF-016`
- [x] 快照 `orchestration-snapshot.json` 与看板 `web/orchestration/data.js` 由 CLI `writeSnapshotArtifacts` 双写刷新
- [x] 阶段入口 `phase2.5-README.md` 追加 AF-016 交付行
- [x] `taskId`（AF-016）贯穿任务单 / 交付记录 / 台账关联 / commit message；脚本与文档改动可由 `git diff` 复核
