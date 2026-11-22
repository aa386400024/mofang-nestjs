---
taskId: AF-337
contextId: phase2.5-orchestration-closed-loop
title: 真人度 full/minimal 配对扩样与阈值复核
type: verification
status: backlog
baselineRef: c1b119d674786cd520381acbc46bf0cee2fbe3d0
dependsOn: [AF-336]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-23T05:10:00+08:00
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
    path: docs/worklog/completed/phase2.5/af337-realism-paired-arm-extension-2026-11-23.md
    kind: report
  - name: 实测报告
    path: docs/worklog/completed/phase2.5/af337-realism-paired-arm-extension-report-2026-11-23.md
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
  - 用 AF-333 CLI 的 --turn-set long 再跑 8 次 12 轮 full+minimal（2 人设 × 2 分支 × 8 × 12 = 384 次调用），0 失败。
  - 把新 8 个 full 与 AF-333/334 的 8 个 full 合并成 16；minimal 同样合并成 16。
  - 用 AF-335 敏感性 CLI 以 off 16 / full 16 / minimal 16 / tightened 4 重算分离区间与中点混淆，逐人设报告。
  - 明确回答：full 与 off 是否仍完全可分、在 16+16 下空档多大、minimal 是否仍与 off 重叠。
  - 不改生产 prompt、不切 RENDER_REALISM_MODE、不写库、不调 humanization-v1 阈值。
  - typecheck、lint、全量测试、engine-core 零 diff 全部通过。
---

# AF-337 · 真人度 full/minimal 配对扩样与阈值复核

AF-336 只补了 off，full 仍只有 8 个，分离上界单边逼近 full 下界。本单补 full 与 minimal 各 8 次 12 轮，把两臂都提到 16，再用同一敏感性 CLI 复核 full 分离与 minimal 重叠是否随样本量变化。

## 边界

- 合成人设、合成台词；不写库、不启服务、不改生产 prompt、不调阈值。
- 只调用豆包 Seed Character，provider 固定 doubao。
- 原始 JSON 放 gitignored data/phase25-exit/af337-realism-paired-arm-extension/，不入库。
- 8 次新重复固定 full+minimal；off 16 与 tightened 4 沿用已有样本，不重复花钱。
- 该单是工程观测，不是临床真人度结论。
