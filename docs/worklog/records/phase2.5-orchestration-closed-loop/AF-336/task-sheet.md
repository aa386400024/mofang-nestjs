---
taskId: AF-336
contextId: phase2.5-orchestration-closed-loop
title: 真人度 off 基线扩样与 full 分离复核
type: verification
status: backlog
baselineRef: 83dcb2d7f2edb5cf7975251fd4940ca52a5c1694
dependsOn: [AF-335]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T04:58:00+08:00
deadline: 2026-11-23T07:00:00+08:00
agentRole: executor
scope:
  files:
    - docs/worklog/pending/
    - docs/worklog/completed/
    - docs/worklog/records/
  modules:
    - visitor-realism
  interfaces:
    - realism-sample-separation
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af336-realism-off-baseline-extension-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af336-realism-off-baseline-extension-report-2026-11-23.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: exit=0
  - command: pnpm lint
    check: 0 error / 0 warning
    threshold: exit=0
  - command: pnpm test
    check: 全量测试全绿
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: 输出为空
    threshold: exit=0
successCriteria:
  - 用 AF-333 CLI 的 --turn-set long 再跑 8 次 12 轮 off-only 独立重复（2 人设 × 8 × 12 = 192 次调用），0 失败。
  - 把新 8 个 off 样本与 AF-333/334 的 8 个 off 样本合并成 16 个，报告逐样本、均值、中位数、极值、窗口内计数。
  - 用 AF-335 的敏感性 CLI 复核 full 与 off 的分离区间是否仍存在；若消失，必须明确写“不可分”。
  - 不改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不调 humanization-v1 阈值。
  - typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-336 · 真人度 off 基线扩样与 full 分离复核

AF-335 的结论是“8 个 off 样本下 full 完全可分，但 off 最大值 `4.280156` 已接近 full 下界，样本再多可能消失”。本单只扩 off 样本：再跑 8 次 12 轮 off-only，把 off 提到 16 个，再用同一敏感性 CLI 复核 full 是否仍完全可分。

## 边界

- 合成人设、合成台词；不写库、不启服务、不改生产 prompt、不调阈值。
- 只调用豆包 Seed Character，provider 固定 doubao。
- 原始 JSON 放 gitignored data/phase25-exit/af336-realism-off-baseline-extension/，不入库。
- 8 次新重复只增加 off，不改变 full/minimal/tightened 的已有样本。
