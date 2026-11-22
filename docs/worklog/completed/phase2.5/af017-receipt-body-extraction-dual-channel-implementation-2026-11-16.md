---
taskId: AF-017
contextId: phase2.5-orchestration-closed-loop
title: 改进台账回执正文抽取通道（快照 / 回执正文双通道合并去重）
type: implementation
status: completed
baselineRef: 8fab1d3
dependsOn: [AF-016]
policyRefs: [framework/receipt-contract, autonomous-team-design.md#improvement-log]
createdAt: 2026-11-16
---

# AF-017 · 改进台账回执正文抽取通道 — 交付记录

- **状态**：✅ 已交付（2026-11-16，本机闸门全绿；编排层单测 116 passed）
- **基线 HEAD**：`8fab1d3`（与 `origin/integrate` 一致；本批改动尚未提交）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：adapter 层纯函数 + CLI 注入接线 + 单测 + 活文档口径；零业务源码改动、零进程 / 剪贴板 IO、零新增依赖
- **方案契约**：框架 `docs/receipt-contract.md` 回执遗留组字段；本仓 `improvement-log.mjs` 台账抽取口径；归档回执 `docs/worklog/pending/archive/relay-response-*.md`；台账 IM-001

---

## 一、本单做了什么（一句话）

在台账抽取通道补回执正文解析（IM-001）：`extractFromReceiptDoc` 解析回执 markdown 遗留组 `backlogItems` / `openQuestions` 列表项转候选草稿，与 `extractFromSnapshot` 快照结果按标题键 + 签名合并去重；`manualReviewList` 仍归快照通道避免双源重复；CLI `--extract` 枚举归档回执接入双通道。纯函数落 `improvement-log.mjs`，文件 IO 归 CLI，未碰业务 `src/`。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/orchestration/improvement-log.mjs`                                              | 新增纯函数 `extractFromReceiptDoc(markdown, existing, opts)`：按 `**backlogItems**` / `**openQuestions**` / `**manualReviewList**` 加粗标签切段，段内抽取有序 / 无序列表项；`manualReviewList` 跳过；表格行（含 `                             | `）、空行、非列表叙述句不入台账。辅助 `parseReceiptTaskId`（frontmatter `taskId:`优先，其次正文`任务标识：`，模式校验不通过返回 null）、`cleanReceiptItem`（去反引号 / 链接保留文本 / 折叠空白）、`RECEIPT_SECTION_TAG`证据标签映射。草稿 source`acceptance`、type `gap`、layer `adapter`，evidence `receipt:<docRef>`+ 组标签；复用`titleKey`/`signature` 去重。纯函数零 IO |
| `scripts/orchestration/state-store.mjs`                                                  | `PATHS` 增 `receiptArchiveDir`（`docs/worklog/pending/archive`）                                                                                                                                                                              |
| `scripts/orchestration/cli.mjs`                                                          | import `extractFromReceiptDoc`；`--extract` 枚举归档目录 `relay-response-*.md`（目录缺省返回空），逐份读正文调纯函数；回执通道 existing 并入快照草稿，跨通道去重；草稿统一 `addCandidate`；输出文案改「从快照与回执正文抽取候选」             |
| `scripts/orchestration/__tests__/orchestration.spec.mjs`                                 | import 补 `extractFromReceiptDoc`；新增 4 个用例：backlog / openQuestion 抽取 + manualReview 与表格行跳过 + 字段断言；existing 命中标题跳过与同通道去重；空文本 / null / undefined 返回空数组；正文 `任务标识` 行解析 taskId、无标识返回 null |
| `docs/team/agent-orchestration/autonomous-team-design.md`                                | §6.4 追加 AF-017 同步记录段（双通道抽取口径与职责边界）                                                                                                                                                                                       |
| `docs/team/agent-orchestration/improvement-log.json`                                     | IM-001 流转 `done`，`resolution.linkedTaskId = AF-017`；回执通道新抽候选 IM-020~027（candidate，待人工评审立项）；CLI 双写                                                                                                                    |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI `writeSnapshotArtifacts` / `refreshSnapshotArtifacts` 双写刷新                                                                                                                                                                            |

### 2.1 台账缺口映射

| 台账   | 缺口                                                                         | 本单处置                                                                                                                                                                 | 落点                                                                                                    |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| IM-001 | 抽取通道仅识别快照遗留项，未直接解析回执文件正文；回执遗留缺口存在漏登记风险 | **已落地**：回执正文解析通道解析 `backlogItems` / `openQuestions` 列表项；与快照草稿标题键 + 签名合并去重；`manualReviewList` 归快照通道防双源重复；CLI 枚举归档回执接入 | `improvement-log.mjs` `extractFromReceiptDoc`；`state-store.mjs` 路径；`cli.mjs` `--extract`；备忘 §6.4 |

### 2.2 双通道实跑结果

归档目录共 26 份 `relay-response-*.md`；其中仅 `relay-response-af013-drill-20261116.md` 使用加粗遗留组标签，其余历史回执为早期格式、解析为空（符合容错口径）。回执通道实抽 8 条候选：3 条 backlogItems + 5 条 openQuestions，与该回执 §遗留 3 / 5 / 4 结构一致（4 条 manualReviewList 归快照通道，未重复采集）。

## 三、闸门证据（本机实跑）

| 闸门         | 命令                                                                          | 结果                                                                                  |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 编排层单测   | `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**116 passed**（基线 112 + 新增 4）；Duration 2.04s                    |
| 静态检查     | `pnpm lint:fast`（oxlint src test bin）                                       | **0 warnings / 0 errors**；1350 文件，93 规则，160ms                                  |
| 契约校验     | `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**：状态索引、工具契约清单、executor / human / orchestrator 三份 Agent Card |
| 业务源码隔离 | `git diff --stat HEAD -- src test`                                            | **空**（业务 `src/` 与 `test/` 零改动）                                               |
| 编码探测     | 改动 8 文件字节探测                                                           | 全部 `BOM=False`、`CR=False`（纯 LF、无 BOM）                                         |
| JSON 校验    | 台账 / 快照 `Test-Json`                                                       | 两份 JSON **OK**；`data.js` 为 JS 产物不做 JSON 校验                                  |

> 未跑全量 typecheck：本批仅 `scripts/*.mjs` 纯规则与 docs，不进入 `src/test` 运行时；与 AF-015 / AF-016 同口径。

## 四、遗留与保留项（本批不做）

| 台账            | 保留原因                                                    | 后续口径                                                                             |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| IM-005          | 交接契约枚举 / taskId 模式与框架 ajv schema 双源镜像        | 复用框架 schema 消除手写镜像；跨模块契约改造，留 P1 backlog                          |
| IM-006          | review 交接件结构上提框架仓 schema 与模板                   | 跨仓 framework 层演进，本仓不改框架                                                  |
| IM-007          | 回执幂等次键缺独立工件版本号（revision/version）            | 任务条目 / 交接件补版本字段，指纹以 taskId+version 为准；留 backlog                  |
| IM-011          | scope 通配路径仅降级目录前缀，未做真实 glob 展开            | P2 并行文件锁升级时引入只读路径匹配器；纯函数外采集层展开                            |
| IM-012          | squash 合并提交动作未自动化（当前仅 `merge --squash` 暂存） | 真实 commit 属编排闸门动作；L1 半自动闭环阶段再补提交 message 构造与清理串联，留 P1  |
| IM-017          | 熔断阈值参数化与通道独立计数预留                            | P2 复用框架熔断扩展位；不另立通道独立熔断                                            |
| IM-018          | L3 合并接远端 CI 状态门禁                                   | 本机无 gh CLI / token；接入后以 CI 状态作自动合并门禁，过渡口径不固化                |
| IM-019          | `development` 分支退役执行                                  | 高风险不可逆，待人工拍板并复核 `integrate..development` 为空后执行                   |
| IM-002 / IM-003 | typeorm-model-generator 废弃工具链移除、传递依赖版本告警    | 业务依赖技术债，需评估 DB 反向生成需求并全量绿跑 + 墙钟数字，不属本批 adapter 工具链 |

### 4.1 回执通道新抽候选（待人工评审立项）

| 候选       | 来源回执             | 说明                                                                          |
| ---------- | -------------------- | ----------------------------------------------------------------------------- |
| IM-020~022 | DR-001 backlogItems  | 两仓文档修订消化、备忘 §3.5 字段自洽修正、`dispatch-channel.mjs` 未审读核对单 |
| IM-023~027 | DR-001 openQuestions | 终态出口 / 重试预算 / 熔断计数 / 失败定性豁免 / 演练基线 五个开放问题         |

> **近义提示**：IM-025（熔断阈值复用通用熔断还是独立计数）与既有 IM-017（熔断阈值参数化与通道独立计数预留）主题相近；两者 source / relatedTaskId / 标题不同，去重未合并。评审立项时评估是否归并，本批不擅自合并或删除候选。

## 五、审计链与回写清单

- [x] 任务单 `af017-receipt-body-extraction-dual-channel-2026-11-16.md` 与本交付记录成对归档至 `completed/phase2.5/`
- [x] 台账 IM-001 流转 `done`，`resolution.linkedTaskId = AF-017`；新抽 IM-020~027 保留 `candidate` 待人工评审
- [x] 快照 `orchestration-snapshot.json` 与看板 `web/orchestration/data.js` 由 CLI 双写刷新
- [x] 阶段入口 `phase2.5-README.md` 追加 AF-017 交付行
- [x] `taskId`（AF-017）贯穿任务单 / 交付记录 / 台账关联 / commit message；脚本与文档改动可由 `git diff` 复核
