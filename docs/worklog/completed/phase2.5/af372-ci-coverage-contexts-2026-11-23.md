# AF-372 风险分级下 coverage 矩阵 check 名称缺失修复 — 交付记录

- 任务：AF-372（R2 / full / orchestrator）
- 基线：`9babd9ed`（integrate）
- 日期：2026-11-23

## 根因

`coverage-shards` 与 `coverage-gate` 使用 job 级 `if: run_coverage == 'true'`。R1/R0 时 job 直接 skipped，GitHub 不展开 `${{ matrix.shard }}/${{ matrix.count }}`，job 名称显示为字面量，required context `Coverage (shard 1/3)`、`2/3`、`3/3`、`Coverage Gate` 永远不存在。GitHub 对 required check 缺失按 pending 处理，导致 R1 PR（如 #179）12 项通过仍无法合并。

## 修复

1. 移除 `coverage-shards` / `coverage-gate` 的 job 级 `if`。
2. 每个真实步骤加 `if: needs.risk-gate.outputs.run_coverage == 'true'`。
3. 新增首步 `Coverage skipped by risk gate` / `Coverage gate skipped by risk gate`，条件取反，`echo` 显式打印风险级别。
4. 结果：R0/R1 下 job 运行、矩阵名展开、required context 以 skipped step 的 success 收口；R2 下 coverage 测试与阈值门照常执行。

## 证据

- YAML 解析：`yaml ok jobs=10`。
- 本地 `pnpm lint` / `pnpm typecheck` 0 error（本任务前一轮）。
- 远端验证以 AF-372 分支 PR 的 14 项 checks 为准。

## 附带

- 同分支提交 AF-370 archive 后生成的 `AF-370/manifest.json` 终态（status completed、receipt 哈希、deliveryRecord），避免记录包 manifest 停留在 submitted。
- AF-371 因 scope 缺 `docs/worklog` 取消，由本任务重签发承接。
