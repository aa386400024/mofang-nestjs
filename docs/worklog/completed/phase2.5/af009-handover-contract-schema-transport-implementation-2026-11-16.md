---
taskId: AF-009
contextId: phase2.5-orchestration-closed-loop
title: 交接契约 schema 与 transport 目录接线（tasks / receipts / reviews 三组交接件机读结构）
type: implementation
status: completed
baselineRef: d1d806b
dependsOn: []
policyRefs: [framework/task-contract.md, framework/receipt-contract.md, framework/evolution.md]
createdAt: 2026-11-16
---

# AF-009 · 交接契约 schema 与 transport 目录接线 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 61 passed）
- **基线 HEAD**：`d1d806b`（与 `origin/integrate` 一致）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：编排层工具链演进，业务源码零改动
- **方案契约**：`docs/team/agent-orchestration/autonomous-team-design.md` §3.4（契约文件化）、§8 P0-1

---

## 一、本单做了什么（一句话）

把交接件从「无显式结构的自由 JSON」固化为三组机读契约（任务 / 回执 / 协商轮意见），落纯函数校验与构造器，并给文件 Transport 补上 `reviews/` 子目录与 `submitReview` 入口；字段口径对齐框架 `task-sheet.schema.json` 与 `receipt-contract.md` 七组字段，适配层只做投影，不复制阈值。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/orchestration/handover-contract.mjs`（新增）                                    | 三组交接件字段组、必填集与校验纯函数 `validateTaskHandover` / `validateReceiptHandover` / `validateReviewHandover`（返回 `{ valid, errors[] }`）；构造器 `buildTaskHandover` / `buildReceiptHandover` / `buildReviewHandover`；导出 `HANDOVER_SCHEMA_VERSION`、`TASK_TYPES`、`TASK_STATUSES`、`FINAL_STATUSES`、`REVIEW_VERDICTS`、`RECEIPT_GROUPS`；taskId 模式、枚举、数组类型、相对路径越界（`..` / 绝对路径）校验；构造器补 `schemaVersion` / `producedBy` / `producedAt` 来源追溯字段 |
| `scripts/orchestration/transport.mjs`                                                    | 目录补 `reviews/`；新增 `submitReview(review)` 写交接件；端口接口注释由三方法更新为四方法；明确「结构校验归 handover-contract 纯函数，本层保持薄 IO、不强制校验、不回写索引」；tasks / receipts / artifacts 既有行为不变                                                                                                                                                                                                                                                                   |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | 新增 AF-009 测试段 5 例：任务合法构造 + 构造器追溯字段投影；任务负向（缺 contextId / taskId 模式非法 / type 越界 / scope.files 路径越界）；回执合法 + 缺七组字段 + `reviewVerdict` / `finalStatus` 越界；review 合法 + 缺意见字段 + `resolution` 缺 decision；文件 Transport 落盘 `reviews/` 目录并回读交接件                                                                                                                                                                              |
| `docs/team/agent-orchestration/README.md`                                                | §3 目录映射补 `directories.handoverTransport` 行（`transport/` 四子目录：tasks / receipts / reviews / artifacts；运行态 gitignore）                                                                                                                                                                                                                                                                                                                                                        |
| `docs/team/agent-orchestration/improvement-log.json`                                     | 登记候选 IM-005、IM-006（见 §五）                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 2.1 三组交接件字段口径（对齐框架真相源）

- **task**：必填 `taskId`（`^[A-Z0-9]+-[0-9]+$`）、`contextId`、`type`（六枚举）、`title`、`status`（十状态）、`createdAt`；可选投影 `baselineRef` / `dependsOn` / `priorTasks` / `policyRefs` / `objective` / `successCriteria` / `outOfScope` / `scope{files,modules,interfaces}` / `exclusions` / `requiredSkills` / `requiredTools` / `agentRole` / `artifacts` / `gates` / `priority` / `deadline` / `retention` / `references` / `constraints`。
- **receipt**：头部标识 `taskId` / `contextId` / `type` / `baselineRef` / `dependsOn` / `policyRefs` + 回执七组 17 字段（落地 `changedFiles` / `artifactRefs`；证据 `gateResults` / `reproNotes`；范围 `scopeCheck` / `parallelArtifactsExcluded` / `noOutscopeRefactor`；契约 `contractChecks` / `schemaVersion` / `fieldAlignment`；遗留 `backlogItems` / `openQuestions` / `manualReviewList`；偏差 `deviationTable`；结论 `finalStatus` / `reviewVerdict` / `verdictRationale`），字段名与框架 `receipt-contract.md` §1 逐字同名。
- **review**：必填 `reviewId` / `taskId` / `contextId` / `proposal` / `risks` / `alternatives` / `disputes` / `recommendation` / `createdBy` / `createdAt`；可选 `resolution{by,at,decision,note}` 承载 orchestrator 裁决回写。框架仓暂无 review 契约 schema，本结构为本仓适配层定义（见 IM-006）。

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/`、`admin-dashboard/` —— **零 diff**。
- **未新增第三方依赖**；未改动 `package.json` / lockfile；MCP / HTTP Transport 预留位现状保持，未实现协议适配。
- 既有交接件行为向后兼容：`submitTask` / `submitReceipt` / `publishArtifact` 签名与落盘口径不变，AF-008 既有测试不破坏。

## 三、关键决策与偏差

1. **校验与 IO 分层**：结构校验放 `handover-contract.mjs` 同步纯函数（零副作用、可单测）；Transport 保持薄文件 IO，不在写盘时强制抛错，避免破坏既有自由格式交接件与未来非交接件场景。派发前强制校验归 AF-010 派发接线。
2. **手写镜像而非复用 ajv**：validator.mjs 的 ajv 校验为异步且框架 schema 不可达时容错 skip；交接件校验需同步纯函数形态，故以手写枚举 / 模式镜像框架 schema。两处口径重复风险登记 IM-005，本批不重构。
3. **review 字段为本仓扩展**：框架 `autonomous-loop.md` 只定义协商轮流程，未定义意见件结构；review 字段组按本仓设计备忘 §39 语义落地（第二意见 / 风险 / 替代思路 / 分歧点 / 建议决策 / 裁决结论），无框架 schema 冲突；上提框架仓登记 IM-006。
4. **路径校验不查存在性**：纯函数只判相对仓根、不含 `..`、非绝对路径；工件文件存在性归验收层（acceptance-runner），保持模块零 IO。
5. **偏差**：无。任务单 §2 范围全部落地，未越界到 AF-010 派发调度、AF-011 文件域互斥、AF-012 分支流程。

## 四、闸门证据

| 命令                                                                          | 退出码 | 结果                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`（`tsc -b tsconfig.check.json`）                              | 0      | 0 error                                                                                                                                         |
| `pnpm lint:fast`（`oxlint src test bin`）                                     | 0      | 0 warning / 0 error，1350 文件                                                                                                                  |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0      | 61 passed（基线 56 + AF-009 新增 5）                                                                                                            |
| 编码探测                                                                      | —      | 改动 `.mjs` / `.json` / `.md` 均 `bom=False`、纯 LF（`cr=0`）                                                                                   |
| 框架契约对照                                                                  | —      | task 必填六字段 / type 六枚举 / status 十态 / taskId pattern 与 `task-sheet.schema.json` 一致；回执 17 字段与 `receipt-contract.md` §1 逐字对齐 |

- **未重跑全量**：改动不进入 `src/test` 运行时，沿用基线全量口径；编排层定向单测已覆盖新模块全部路径。
- **CLI 试跑**：`improvements --add` 两条候选登记成功；`snapshot` 双写刷新退出码 0。

## 五、遗留与未决

- **IM-005（candidate · adapter · tech-debt）**：交接契约校验枚举与 taskId 模式与框架 ajv schema 双源镜像；框架枚举或模式演进时两处需同步。建议交接件校验复用框架 schema 同步封装，消除手写镜像。
- **IM-006（candidate · framework · standard）**：协商轮 review 交接件结构尚未进框架仓 schema 与模板；P1 评估将字段组上提框架仓。
- **后续 P0 依赖链**：AF-010（派发接线 + 回执 watcher）与 AF-011（文件域互斥）依赖本单契约；AF-013 依赖 AF-010 / AF-011；AF-012、AF-014 独立。
- **MCP / HTTP Transport**：预留位，后续批次不本单实现。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录）填全
- [x] 快照与看板 data.js 经 CLI 双写刷新；README §3 目录映射回写
- [x] `taskId`（AF-009）贯穿任务单 / 交付记录 / 交接件结构 / 台账关联 / commit message
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
