---
taskId: AF-011
contextId: phase2.5-orchestration-closed-loop
title: 文件域 scope 校验与在办任务交集拦截（双代理文件互斥前置护栏）
type: implementation
status: completed
baselineRef: 9a25342
dependsOn: [AF-009]
policyRefs: [framework/roles.md, framework/reliability.md, framework/task-contract.md]
createdAt: 2026-11-16
---

# AF-011 · 文件域 scope 互斥校验 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 76 passed）
- **基线 HEAD**：`9a25342`（与 `origin/integrate` 一致）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：编排层工具链演进，业务源码零改动
- **方案契约**：`docs/team/agent-orchestration/autonomous-team-design.md` §5（并发与文件域互斥）、§8 P0-3；框架 `reliability.md` §6.5（残留文件识别）、`roles.md` §3/§5（角色隔离与能力声明）、`task-contract.md` §3（scope 字段组）

---

## 一、本单做了什么（一句话）

落地任务文件域前置护栏：`scope.files` 路径归一化（相对仓根、目录前缀、通配降级）与在办任务文件域交集计算收口为零 IO 纯函数；claim 派发前拦截与在办任务文件域相交的任务（留 ready、不登记租约、不投递），冲突落审计；验收侧新增 V7 残留护栏，变更清单与 scope 比对，清单外文件判残留只识别报告、不删除不归集；只读 / 调研类任务豁免写域互斥。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/scope-mutex.mjs`（新增）                                          | 文件域纯函数：`normalizeScope`（路径归一化、目录 / 文件条目分类、只读判定、错误清单）；`scopeCovers`；`findScopeConflicts`（与 submitted / working 在办任务求交集，只读豁免，返回冲突任务与相交条目清单）；`detectResidualFiles`（变更清单与 scope 比对，covered / residual 分组）；导出 `READONLY_TASK_TYPES`、`ACTIVE_SCOPE_STATUSES`；模块不读文件系统、不调 git |
| `scripts/orchestration/scheduler.mjs`                                                    | `claimReadyTasks` 在依赖与类型白名单通过后、租约登记前调 `findScopeConflicts`；有冲突 → 推送 `scope-conflict` 动作并 `continue`，任务留 ready，不登记租约、不投递交接件；任务枚举、状态迁移表、租约字段未改                                                                                                                                                         |
| `scripts/orchestration/acceptance-runner.mjs`                                            | 新增 V7「文件域残留」护栏：`runAcceptance(task, index, opts)` 第三参 `opts.changedFiles` 可选；传入清单时经 `detectResidualFiles` 比对，scope 外文件判 fail；未传入记 skip；向后兼容既有两参调用                                                                                                                                                                    |
| `scripts/orchestration/cli.mjs`                                                          | 调度动作审计扩展 `scope-conflict` 类型：correlationId `scope-conflict:<taskId>`，resources 记冲突对方 taskId，reason 记相交任务清单；复用 `TOOL-QUEUE-SCHEDULER` 工具契约，未新增工具声明                                                                                                                                                                           |
| `scripts/orchestration/tool-registry.mjs`                                                | 注册表审计记录透传 `ctx.reason`（业务原因）；denied 原因与显式原因口径分离；返回值与授权判定逻辑未改                                                                                                                                                                                                                                                                |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | 新增 AF-011 测试段 8 例：路径归一化（相对 / 目录 / 反斜杠 / `./`、拒绝绝对路径与 `..`）、通配降级目录前缀、精确命中与无交集、目录前缀覆盖与父子目录包含、只读任务双向豁免、非在办状态不参与冲突、残留 covered / residual 分组、V7 fail / pass / skip 三态                                                                                                           |
| `docs/team/agent-orchestration/improvement-log.json`                                     | 登记候选 IM-009、IM-010、IM-011（见 §五）                                                                                                                                                                                                                                                                                                                           |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                              |

### 2.1 口径对齐（框架真相源）

- **文件域前置声明**（设计备忘 §5.1）：任务单 `scope.files` 列可写文件 / 目录；派发前与在办（submitted / working）任务文件域求交集，有交集拦截派发，不并行。
- **残留识别**（`reliability.md` §6.5）：以 `artifacts` 清单与 `scope.files` 为基线比对实际变更；清单外文件判残留，不进提交分组、不计交付清单；本单只识别与报告，不删除、不归集。
- **只读豁免**（设计备忘 §5.5）：调研 / 评审 / 验证类任务不占写域，既不作为冲突方，也不与实现任务产生写冲突；`scope.readOnly=true` 或类型命中 `investigation / review / verification` 判定只读。
- **资源域真相源**（`roles.md` §5）：角色资源域以 Agent Card `resources` 声明为准；本模块不另抄目录白名单，任务 scope 是否越出角色域的前置校验留 IM-010。

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/` —— **零 diff**。
- **未新增第三方依赖**；未改动 `package.json` / lockfile；未实现跨机器 / 跨进程文件锁；未自动 commit / push。
- 向后兼容：`runAcceptance` 第三参缺省 skip；`processReceipts` 既有调用不传清单；既有 68 例测试不破坏；非在办状态任务不进入冲突集合。

## 三、关键决策与偏差

1. **互斥逻辑独立成纯函数模块**：`scope-mutex.mjs` 无 fs / git IO，路径判定与交集计算可单测；调度器只做状态机接线，验收 runner 只做护栏编排。
2. **目录覆盖按路径前缀判定**：目录条目覆盖其下所有文件；目录与目录按互相前缀判定包含；纯函数不列目录枚举（通配降级口径见 IM-011）。
3. **冲突拦截留在 ready，不转冻结**：本批单 executor 串行队列，文件域相交属「等待在办释放」的可恢复排队场景，不构成需人工裁决的死锁；冲突原因经动作与审计留痕。冻结 / 转人工仅用于死信、授权缺失等不可自动恢复场景（沿用既有状态机）。
4. **残留护栏挂验收而非提交分组**：V7 只出机读判定（fail / pass / skip）；提交分组与文件归集仍归编排者与人工流程，护栏不越权删除或移动文件。
5. **变更清单由调用方采集**：纯函数边界内不调 git；`changedFiles` 经 `runAcceptance` 第三参注入，未接入采集器前 V7 记 skip（IM-009）。
6. **偏差**：无。任务单 §2 范围内落地；多代理并行调度器与文件锁升级（P2）、Agent Card 资源域越域校验（IM-010）、git diff 采集器（IM-009）未越界实现。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                                   |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                                                |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                                                         |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 76 passed（基线 68 + AF-011 新增 8）                                                                   |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.json` / `.md` 均 `bom=False`、纯 LF（`cr=0`）                                          |
| 框架契约对照                                                                  | —      | 残留口径对齐 `reliability.md` §6.5；角色隔离对齐 `roles.md` §3；scope 字段组对齐 `task-contract.md` §3 |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线全量口径；编排层定向单测已覆盖新模块全部路径。
- **CLI 试跑**：`improvements --add` 三条候选登记成功；快照双写刷新退出码 0。

## 五、遗留与未决

- **IM-009（candidate · adapter · tech-debt）**：验收残留比对缺 git diff 变更清单采集器；纯函数模块无 git IO，`changedFiles` 须由调用方采集传入，未接入前 V7 记 skip，清单外文件不会被机读拦截。后续在调度 / 验收入口采集 `git diff --name-only`（相对仓根）传入。
- **IM-010（candidate · adapter · gap）**：任务 scope 未与 Agent Card `resources` 角色资源域做越域校验；本单只做任务间互斥，任务 scope 越出角色声明资源域暂无前置机读校验。P1 接入 resources 投影后在派发前校验。
- **IM-011（candidate · adapter · tech-debt）**：scope 通配路径仅降级目录前缀，未做真实目录枚举 glob 展开；`src/**/*.ts` 按 `src/` 前缀近似，跨层通配与单段 `*` 口径可能偏宽或偏窄。P2 文件锁升级时引入只读路径匹配器。
- **并行冲突升级**：多 executor 并行、文件域锁升级为版本号 / 文件锁属 P2（设计备忘 §9.1）；本单只做单队列下前置校验与残留识别。
- **后续 P0 依赖链**：AF-012、AF-014 独立；AF-013 依赖 AF-010（已交付）与 AF-011（本单）。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录）填全
- [x] 快照与看板 data.js 经 CLI 双写刷新；冲突动作经审计落盘
- [x] `taskId`（AF-011）贯穿任务单 / 交付记录 / 台账关联 / commit message
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
