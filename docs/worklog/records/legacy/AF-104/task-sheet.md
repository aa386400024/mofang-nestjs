---
taskId: AF-104
contextId: phase2.5-exit4-quality-remediation
title: 修复后 long 批次真实回归验证与出口④判定回写
type: verification
status: backlog
baselineRef: d7b477baf9b7bf05c44599a0d87cec4c6740c485
dependsOn: [AF-102]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T21:10:00+08:00
deadline: null
agentRole: executor
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - data/batch-reports/
  modules:
    - auto-practice-quality
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af104-postfix-long-batch-quality-verdict-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run test/auto-practice/batch-report-cli.spec.ts
    check: WP-K CLI 回归用例全绿
    threshold: failed=0
  - command: corepack pnpm exec tsc --noEmit -p tsconfig.json
    check: 类型检查零错误
    threshold: error=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零 diff
    threshold: 输出为空
successCriteria:
  - 用 AF-102 后的构建重启本地服务，确认进程加载的是当前 integrate 代码
  - 通过生产入口 POST /admin/api/auto-practice/batch 发起真实 long 批次：4 个已审核角色 × expert × 1 次重复，maxTurns=50
  - 批次 4/4 场完成，总轮次不少于 180，且批次健康门禁可取证
  - 批次完成后用 bin/batch-report.ts 产出 JSON 与 Markdown，给出 improved / neutral / regressed / incomparable 四态结论
  - 统计咨询师可见输出为空率并与 AF-095 的 36.3% 对照；目标不高于 5%，且不得把推理块计成咨询师台词
  - 回写 docs/worklog/pending/phase2.5-README.md §3.2 的正式判定；无 post-fix 证据前不得宣称 80% 达标
  - 未闭合遗留项与本次新增遗留项显式登记，不静默跳过
---
# AF-104 修复后 long 批次真实回归验证与出口④判定回写

## 背景

AF-102 已修复 long 档咨询师可见输出为空的根因：推理预算、截断重试、降级计数与推理块剥离。代码已合并到 `integrate`，但还没有修复后的真实 long 批次证据，因此出口④仍只能维持“未达标 / 部分可判”。

## 目标

1. 用修复后的构建跑一批真实 long 对练，验证咨询师可见输出不再被推理块吃掉。
2. 用 WP-K 判读器给出四态结论，而不是用单点数字替代正式判定。
3. 把证据与判定回写 `phase2.5-README.md` §3.2，明确“达标 / 未达标 / 部分可判”的边界。

## 非目标

- 不在本单修代码；发现新缺陷另开任务登记。
- 不用合成评测集冒充真实批次。
- 不因为一批 4 场就把整体质量抬到 80%。

## 验收

- 批次参数、batchId、场次数、轮次数、健康门禁全部可复现。
- WP-K 报告与 §3.2 使用同一组数字。
- 空输出率、降级计数、推理块剥离三项都有独立证据。
- 闸门只跑定向：WP-K CLI 单测、tsc、engine-core 零 diff。
