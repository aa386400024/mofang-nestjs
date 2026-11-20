---
taskId: AF-127
contextId: phase2.5-ai-proxy-acceptance
title: 长会谈开场框架与收束的规则化结构审计
type: implementation
status: backlog
baselineRef: c48cb96c63ae061186dc9576b82ddb3709fddecf
dependsOn: [AF-125]
priorTasks: [AF-125]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-19T09:35:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - src/auto-practice/metrics/session-structure-audit.ts
    - bin/session-structure-audit.ts
    - test/auto-practice/session-structure-audit.spec.ts
    - docs/worklog/pending/af127-session-structure-audit-task-2026-11-19.md
    - docs/worklog/completed/phase2.5/af127-session-structure-audit-2026-11-19.md
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af127-session-structure-audit-2026-11-19.md
    kind: report
gates:
  - command: pnpm exec vitest run test/auto-practice/session-structure-audit.spec.ts
    check: 定向单测全绿
    threshold: exitCode=0
  - command: pnpm exec tsc --noEmit
    check: 类型检查 0 error
    threshold: exitCode=0
  - command: pnpm lint
    check: lint 0 error / 0 warning
    threshold: exitCode=0
  - command: pnpm exec tsx bin/session-structure-audit.ts run --pack-dir %TEMP%\af125-pack16 --out %TEMP%\af127-audit
    check: 16 packet 全部产出审计行
    threshold: exitCode=0
  - command: node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af127-session-structure-audit-task-2026-11-19.md
    check: 任务单 schema 通过
    threshold: exitCode=0
successCriteria:
  - 纯函数模块解析 long packet Markdown，提取咨询师/来访者轮次与轮号，不依赖数据库或 LLM
  - 开场框架在前 10 轮内逐项检测保密与例外、设置边界、时长/频率、可暂停/可拒答、录音/知情同意
  - 收束在最后 10 轮内逐项检测总结本次理解、来访者带走内容、下一步安排
  - 每个 packet 输出布尔证据与命中原文短句，缺失项明确标 false，不猜测、不用整场关键词代替位置判断
  - 聚合输出各要素覆盖率、完全覆盖 packet 数、部分覆盖 packet 数；状态固定 candidate，gateEligible=false，附免责声明
  - CLI 只读 pack 目录，输出 JSON 与 Markdown 到 --out，不写仓库数据
  - 定向单测覆盖正例、反例、边界轮次、缺咨询师文本、只有部分要素
  - 不调用 LLM、不新跑练习批次、不改 ai-proxy 阈值、不把结构命中当成临床达标
---

# AF-127 · 长会谈开场框架与收束的规则化结构审计

## 背景

AF-125 的 `ai-proxy-v2` 把“无会谈框架 → safety≤3”“无收束 → style≤3”写成硬上限，但复核仍依赖 LLM 评分。需要一套确定性、可复跑的规则审计，先把“逐字稿里到底有没有这些结构”变成机器可核对的证据。

本任务只做结构审计，不做临床质量判断。命中结构不等于质量达标，缺失结构也不等于咨询失败。

## 目标

- 新增纯函数模块 `session-structure-audit.ts`；
- 新增 CLI `bin/session-structure-audit.ts`；
- 对 AF-125 的 16 个 long packet 跑出逐 packet 审计与聚合覆盖率；
- 输出 `candidate` 状态、`gateEligible=false` 与免责声明；
- 补定向单测与交付记录。

## 输入格式

`--pack-dir` 指向 AF-111/AF-125 生成的 pack 目录，读取 `packets/packet-*.md`。每个 packet 形如：

```md
### 第 1 轮

**咨询师**：……
**来访者**：……
```

## 输出要求

每个 packet 至少包含：

- `packetId`、`turnCount`、`counselorTurns`
- `opening`：`confidentiality`、`boundary`、`duration`、`pauseRefusal`、`recording`，各含 `covered` 与 `evidence`
- `closing`：`summary`、`takeaway`、`nextStep`，各含 `covered` 与 `evidence`
- `openingComplete`、`closingComplete`

聚合至少包含：

- 各要素覆盖率
- `openingComplete` / `closingComplete` packet 数
- `candidate` 状态与免责声明

## 非目标

- 不修改咨询师 prompt；
- 不修改 `ai-double-blind.ts` 或任何阈值；
- 不修改 `engine-core`；
- 不新增数据库表、不写 `quality_annotation`；
- 不声称临床质量达标。
