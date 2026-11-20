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

# AF-017 · 改进台账回执正文抽取通道

> 状态：✅ 已交付（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）｜交付记录：af017-receipt-body-extraction-dual-channel-implementation-2026-11-16.md
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/improvement-log.mjs`（新纯函数）、`state-store.mjs`（回执归档目录路径）、`cli.mjs`（`--extract` 双通道接线）、`__tests__/orchestration.spec.mjs`、设计备忘 §6.4
> 唯一事实源：框架 `docs/receipt-contract.md` 回执遗留组字段；本仓 `improvement-log.mjs` 台账抽取口径；回执归档目录 `docs/worklog/pending/archive/relay-response-*.md`
> 任务性质：adapter 层纯函数 + CLI 注入接线 + 单测 + 活文档口径；零业务源码改动、零进程 / 剪贴板 IO、零新增依赖

## 0. 【必读入口】动手前按顺序读完

1. `scripts/orchestration/improvement-log.mjs`：`extractFromSnapshot` 快照抽取、标题键 / 签名去重、候选草稿字段
2. 回执模板 `docs/team/agent-orchestration/relay-receipt-template.md` §4 遗留组（`backlogItems` / `openQuestions` / `manualReviewList`）
3. 归档回执样本 `docs/worklog/pending/archive/relay-response-af013-drill-20261116.md` 遗留小节正文形态
4. 改进台账 IM-001 条目原文与建议；CLI `improvements --extract` 现状接线

## 1. 背景

台账抽取通道此前只从调度器快照的结构化字段（人工复核项 / 附条件通过 verdict / 返修提案 / 死信）抽取候选；回执交接件正文中 `backlogItems` / `openQuestions` 列表项若未进入快照遗留区，不会被台账捕获，存在漏登记风险（IM-001）。本单在 adapter 层补回执正文解析通道，与快照抽取双通道合并去重；纯函数只吃 markdown 文本，文件枚举与 IO 归 CLI。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- **回执正文抽取纯函数**：`improvement-log.mjs` 新增 `extractFromReceiptDoc(markdown, existing, opts)`——解析回执遗留组 `**backlogItems**` / `**openQuestions**` 下的有序 / 无序列表项，转候选草稿（source `acceptance`、type `gap`、layer `adapter`，关联 taskId 取 frontmatter `taskId:` 或正文 `任务标识：`，取不到为 null；evidence 记 `receipt:<文件名>` + 组标签）；`manualReviewList` 仍归快照通道，本通道不重复采集；表格行、空行、段内叙述句不入台账。
- **去重**：复用 `titleKey` / `signature`，existing 命中跳过；同通道重复标题去重；CLI 合并时回执通道 existing 并入快照草稿，避免跨通道重复登记。
- **CLI 接线**：`state-store.mjs` `PATHS` 增 `receiptArchiveDir`；`cli.mjs` `--extract` 枚举归档目录 `relay-response-*.md`，读正文调纯函数，快照草稿 + 回执草稿统一 `addCandidate`；目录缺省返回空清单。
- 单测：覆盖 backlog / openQuestion 列表抽取、`manualReviewList` 与表格行跳过、existing 命中去重、空文本 / 非字符串空态、taskId frontmatter 与正文解析、无标识回落 null。
- 设计备忘：§6.4 追加 AF-017 同步记录段。
- 台账：IM-001 流转终态 done，关联 AF-017。

**明确不在范围内：**

- 不解析回执表格内条目（偏差表 / 取证表）；不解析非加粗标签的自由小节；不新增台账枚举或状态。
- 不补交接件独立工件版本号（IM-007）；不消除框架 schema 双源镜像（IM-005）；review 交接件结构上提框架仓（IM-006，跨仓）；scope 真实 glob 展开（IM-011，P2）；squash 合并提交动作自动化（IM-012，L1 阶段留 P1）。
- 不清算业务依赖技术债：typeorm-model-generator 废弃链（IM-002）、传递依赖升级（IM-003）；不接入远端 CI 门禁（IM-018）；不执行 `development` 分支退役（IM-019）；熔断阈值参数化（IM-017，P2）。
- 不改业务 `src/`、`test/`、配置与依赖；进程 / 窗口 / 剪贴板 IO 仍留注入接口位，纯函数模块内零 IO。

## 3. 目标架构 / 交付物

- **交付物 1：回执正文抽取纯函数** —— `improvement-log.mjs` `extractFromReceiptDoc`；纯函数可替身单测，不读写文件。
- **交付物 2：CLI 双通道接线** —— `state-store.mjs` 路径常量 + `cli.mjs` 枚举归档回执、合并去重；文件 IO 归 CLI。
- **交付物 3：单测 + 活文档** —— 编排层 vitest 全绿；备忘 §6.4 口径同步；台账 IM-001 闭环。

## 4. 红线（违反即返工）

- 纯函数 `extractFromReceiptDoc` 不做文件 / 网络 / 进程 IO；回执文件枚举与读取只在 CLI 层。
- `manualReviewList` 双通道不重复采集；既有 `extractFromSnapshot` 行为与签名保持不变。
- 候选只产 `candidate`；`queued` / `accepted` / 终态仍由编排者 / 人工显式流转，抽取通道不自动立项。
- JSON 无 BOM、纯 LF；历史交付记录与已归档文档只读不改；不把过渡口径写成永久设计。

## 5. 闸门（实施时填真实数字）

编排层定向 vitest；`pnpm lint:fast`；CLI `validate`（索引 / 工具契约 / 三角色卡 schema）；JSON `Test-Json`；编码探测（BOM / CR）；`git diff --stat HEAD -- src test` 为空。纯函数 / 文档单不跑全量 typecheck（改动不进入 `src/test` 运行时），在交付记录注明。pnpm 强制；本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af017-receipt-body-extraction-dual-channel-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 快照 / 看板 data.js / 阶段入口 README 同步回写；
- [ ] IM-001 映射到落地纯函数与测试用例；保留项（IM-005 / 006 / 007 / 011 / 012 / 017 / 018 / 019 / 002 / 003）在交付记录列清；回执通道新抽候选（IM-020~027）标注待人工评审立项；
- [ ] 审计链闭合：`taskId`（AF-017）贯穿任务单 / 交付记录 / 台账关联 / commit message。
