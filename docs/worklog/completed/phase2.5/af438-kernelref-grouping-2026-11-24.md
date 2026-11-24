# AF-438 交付记录 · 台账按 kernelRef 分组统计语料版本分布（已被取代）

本任务**未按原样实施**：其目标已由 AF-450 与 AF-451 完成，此文件用于补齐记录包声明的交付记录路径，不含实现内容。

## 事实

- AF-438 停在 `backlog`，`dependsOn: [AF-437]`；AF-437 投递失败被归档，依赖永远不可满足，该单无法被 `task promote`（这正是它长期挂在 backlog 的原因）。
- 目标已实际达成，且不挂旧依赖：
  - **AF-450**（`50ef424f`）：`af427-operator-delta-ledger.mjs` 增 `scope` 过滤（real / synthetic / all）与按 `kernelRef` 分桶统计，渲染新增「表三附 · 合成语料覆盖」与「表四 · 语料 kernelRef 分布」，并补 6 例分组单测。
  - **AF-451**（`ecfcde19`）：合成语料生成器写入 `KERNEL_REF`，表四出现 `kr1-f83dcfed01fec2b4` 桶（6 场 / 34 轮 / 合成 6），`none` 桶保留 13 场真实历史语料。
- 因此 AF-438 仅做状态面闭合（canceled，理由=已被 AF-450 / AF-451 取代），不二次实现，避免同一改动在两条任务链上重复落地。

## 参考

- 实现与证据：`docs/worklog/completed/phase2.5/af450-ledger-kernelref-grouping-2026-11-24.md`、`af451-scripted-kernelref-2026-11-24.md`
- 口径说明：`docs/architecture/behavior-operator-delta-ledger-v1.0.md` 第七节「语料分组口径（AF-450 起）」
