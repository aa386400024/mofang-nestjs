# AF-435 交付记录：台账版本口径附注

- 日期：2026-11-24
- 任务：AF-435（documentation / orchestrator）
- 基线：`4da75b978f2d1ffdd2b2155ddd55b5bca74fef7e`

## 1. 改了什么

单文件：`docs/architecture/behavior-operator-delta-ledger-v1.0.md`

1. 表三结论 3 由「原因待核实（两个候选解释）」改为已定性结论：
   - 31 个 empathy 单算子轮分簇（24 轮 trust 0.12 / safety 0.014，另有 0.06 与 0.10 两簇）；
   - 破坏性算子（judgment / preaching / minimizing / sensitive_touch）与当前表逐字一致 → 「`AllianceConfig` 覆写」降为次位；
   - `safety: 0.06` 最早出现在 `bea5a719`（2026-11-22），语料生成于 2026-11-21/22，部分早于该改动；
   - 明确「表三只判同一算子内部相对稳定性，不判当前系数是否生效」。
2. 新增「版本口径附注（2026-11-24 补）」小节，给三条读表限定：同算子内部可比 / 跨算子不可横比 / 不能当系数生效证据；补救口径是带 `kernelRef` 与 `deltaTable` 哈希重跑语料。

## 2. 为什么这样写

台账是给别人复算的依据，悬案留在正文里会被反复当成「未解之谜」。取证文档已经定性，正文必须同步，否则两份文档口径冲突（违反单一真相源）。

## 3. 闸门

| 闸门             | 命令                                                         | 结果 |
| ---------------- | ------------------------------------------------------------ | ---- |
| 记录包校验       | `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core`                    | 空   |

## 4. 遗留

- 带版本指纹的语料重跑尚未立项（AF-427 backlog B1 的最终补丁）。
- `normalization` / `affirmation` / `boundary_cross` / `holding_present` / `cold_absent` 仍是零语料，需构造剧本（AF-427 backlog B2，boundary_cross 优先）。
