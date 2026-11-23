# AF-428 交付记录：语料与内核版本漂移取证

- 日期：2026-11-24
- 任务：AF-428（investigation / orchestrator）
- 基线：`67e54372e171920fad603e667b181cfce59cb9b7`
- 分支：`task/AF-427-operator-delta-ledger`（随 PR #212 合入，未另开 PR）
- 交付：`docs/architecture/debug-corpus-kernel-version-drift-v1.0.md`

## 1. 做了什么

复核 AF-427 表三「实测/系数比 = 88.0%」的可信度，把「语料快照可能早于 safety 提到 0.06」这条猜想做成取证。

做法：对每个 trace 取 `deltaDetail.events` 长度恰为 1 的记录，按 8 维系数序列做键聚合，再看每簇与当前 `DELTA_TABLE` 是否逐字一致。

## 2. 结论

- 13 场语料是**跨内核版本的混合快照**：破坏性算子（judgment / preaching / minimizing / sensitive_touch）与 neutral 完全等于当前表；正向修复算子（empathy / acceptance / open_probe）几乎全部不等，且出现「旧值 0.014/0.020」和「非整比调制值 −0.023077」两种不同偏差形态。
- empathy 31 个单算子轮分五簇（24 / 3 / 2 / 1 / 1），同一算子内部也不一致 → **不能按会话整体打版本标签**。
- 因此表三只能用于同算子内部的相对稳定性判断，不能用于「当前系数是否达到设计幅度」。

## 3. 对 AF-427 台账的修正建议

- 88.0% 的差额主因是版本漂移，而非「AllianceConfig 覆写」猜想——破坏性算子在 100% 一致下已排除覆盖式覆写这条解释的主位。
- 表三结论段需补一行引用本取证（已在 AF-426/427 的 backlog 中登记为后续文档补丁，避免本单越界改 AF-427 已归档交付物）。

## 4. 闸门

| 闸门       | 命令                                                         | 结果                       |
| ---------- | ------------------------------------------------------------ | -------------------------- |
| 记录包校验 | `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS（本单交付记录落盘后） |
| lint       | `pnpm lint`                                                  | 0 error                    |

## 5. 遗留

- 语料重跑时须带版本指纹（`kernelRef` / deltaTable 哈希），否则下一批还会是混合体。
- 未验证「非整比调制值」来自哪一层（人格调节 / 依恋系数 / 会话衰减），只证明它存在。

## 6. 偏差

本单原计划独立成 PR，但 AF-427 的 PR #212 因 CI 守卫问题待修（AF-429），为避免同一批提交出现在两个 PR，本单文档随 PR #212 合入。
