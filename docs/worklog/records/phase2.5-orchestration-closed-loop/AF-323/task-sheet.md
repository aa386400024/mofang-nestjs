---
taskId: AF-323
contextId: phase2.5-orchestration-closed-loop
title: 工具链收口与真实语料分类器影子审计
type: implementation
status: backlog
baselineRef: 3f12ae0834a28ac0dee1dac5a378e0dd4d7a4bb8
dependsOn: [AF-322]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T01:18:00.000Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - package.json
    - .github/workflows/ci.yml
    - scripts/orchestration/
    - scripts/ops/quality/
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af323-toolchain-shadow-audit-2026-11-23.md
    kind: report
  - name: 真实语料影子审计报告
    path: docs/worklog/completed/phase2.5/af323-classifier-shadow-audit-2026-11-23.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs scripts/orchestration/__tests__/af322-classifier-shadow-audit.spec.mjs
    check: 编排单测与审计统计单测全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 本地类型检查与 CI 同口径覆盖整个 tsconfig.json
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试通过
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链一致
    threshold: exit=0
  - command: node scripts/orchestration/cli.mjs worklog verify --strict
    check: 记录包哈希一致
    threshold: exit=0
successCriteria:
  - package.json 的 typecheck 与 CI 完全相同地覆盖整个 tsconfig.json；保留 src 快检入口。
  - CI Typecheck 直接调用 pnpm typecheck，消除本地与远端命令漂移。
  - 任务分支名构造拒绝 slug 内混入任务编号，含大小写、连字符与嵌入位置变体。
  - 真实 trace 影子审计脚本可对指定场次抽样，输出 agreement、Jaccard、neutral 率、degraded 率与模型标识，且不输出任何对话原文。
  - 审计统计纯函数有独立单测，缺场次与降级轮不会被静默吞掉。
  - 对 8 场目标 trace 执行一次影子审计，报告给出真实数字、缺失场次与限制。
  - 交付记录含六组机读锚点与临床边界；任务归档并通过受保护 PR 合入 integrate。
---
# AF-323 · 工具链收口与真实语料分类器影子审计

## 1. 背景

AF-322 已闭合决策层、在场状态、跨会话移情、生产 trace 与 admin debug 分类器摘要，并通过 PR #154 合入 `integrate`（merge SHA `3f12ae08`）。剩余问题都在工具链与真实语料侧：

1. 本地 `pnpm typecheck` 只覆盖 `src`，CI 覆盖整个 `tsconfig.json`；AF-320 的 TS18048 就是这样漏到远端的。
2. 分支名构造允许 slug 内混入任务编号；AF-320 曾因双任务号分支被 PR 验收门拒绝。
3. AF-322 加了分类器运行口径的写入与读取，但真实 8 场 trace 从未做过规则轨 vs 模型轨影子审计。
4. `typings/global.d.ts` 未声明 AF-322 新增 env 键，但代码走 `ConfigService.get()`，不构成类型缺口；本单不为此越资源域，登记为后续治理项。

## 2. 范围

### 2.1 类型检查口径

- `package.json`：`typecheck` 改为 `tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo`。
- 保留 `typecheck:src` 作为 `tsc -b tsconfig.check.json` 快检。
- `.github/workflows/ci.yml` 的 Typecheck 改为 `pnpm typecheck`，缓存路径保持 `node_modules/.tmp/tcheck-full.tsbuildinfo`。

### 2.2 分支名护栏

- `buildBranchName` 在 slug 规范化后拒绝任何 `af-?\d{3}` 形式的任务编号片段。
- 覆盖大小写、带连字符、嵌入其他词中间、多个任务号等变体。
- 错误信息明确指向「slug 不得包含任务编号」。

### 2.3 真实语料影子审计

- 新增 `scripts/ops/quality/af322-classifier-shadow-audit.ts`：读取 `data/debug-sessions`，按目标 id 抽样咨询师轮，规则轨与模型轨并行（shadow 模式），只输出计数与比率。
- 新增 `scripts/ops/quality/af322-classifier-shadow-audit.mjs`：纯统计函数（exact agreement、mean Jaccard、neutral 率、degraded 率、按场次汇总），独立单测。
- 新增 `scripts/orchestration/__tests__/af322-classifier-shadow-audit.spec.mjs`。
- 审计报告落 `docs/worklog/completed/phase2.5/af323-classifier-shadow-audit-2026-11-23.md`，只含 id / 计数 / 比率 / 模型标识，不含原文。

### 2.4 隐私与成本

- 脚本不打印咨询师或来访原文，不落原文到输出文件。
- 默认每场抽样 3 轮；`--rule-only` 可零成本运行；`--limit` 控制总调用数。
- 不在 `exam` 场景跑模型轨；审计场景固定 `full_simulation`。

## 3. 非目标

- 不宣称临床有效性；影子审计是一致性观测，不是人工金标准。
- 不改模型轨 prompt、判定口径、分类器阈值。
- 不修改 `typings/global.d.ts`；env 声明缺口登记为资源域治理遗留。
- 不提交 `data/phase25-exit/*` 历史取证目录与审计原始输出。

## 4. 验收

- 编排单测、审计统计单测、全量 typecheck、lint、全量测试、events verify、worklog verify 全绿。
- 影子审计报告给出真实抽样数字、缺失场次、degraded 与 neutral 口径，不输出原文。
- 交付记录含 gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict 六组机读锚点。
