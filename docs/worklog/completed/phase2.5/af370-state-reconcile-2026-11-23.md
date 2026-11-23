# AF-370 合并后状态面收口 — 交付记录

- 任务：AF-370（R1 / standard / orchestrator）
- 基线：`9babd9ed`（integrate 合并 AF-365 后的 HEAD）
- 日期：2026-11-23

## 问题

integrate 合入 AF-365 后，本地状态面与记录包出现三类漂移：

1. AF-368 durable 回执在 AF-369 修正后内容哈希变化，manifest 仍记旧哈希 → `worklog verify --strict` 报回执哈希不匹配。
2. AF-363 / AF-364 记录包存在但索引无归档条目 → 孤儿记录包。
3. AF-312 记录包 `deliveryRecord` 指向不存在的 `af312-*`，实际记录为 `af313-admin-debug-remote-store-2026-11-22.md`。

## 处置

- `node scripts/orchestration/cli.mjs worklog migrate --apply`：重算 AF-368 回执哈希并写回 manifest（任务单 0、回执 1）。
- 经 CLI 补登历史取消链路：
  - `events create AF-363` → `task cancel`（IM-010 scope 域冲突，由 AF-365 承接）→ `archive canceled`
  - `events create AF-364` → `task cancel`（并入 AF-365）→ `archive canceled`
- `AF-312/manifest.json` 的 `deliveryRecord` 修正为实际文件 `af313-admin-debug-remote-store-2026-11-22.md`。
- 把未入库的 AF-369 任务单/manifest 一并纳入记录包，避免再次出现状态面有任务、仓库无记录。

## 证据

- `worklog verify --strict`：`PASS 活跃=1 归档=357 记录包=359 legacy指针=133/133 无任务单=14/14`
- `events verify`：`PASS 事件日志 1635 条；哈希链与索引投影一致`
- 未提交状态面：`task-state-index.json` / `state/journal.jsonl` / `orchestration-snapshot.json` / `web/orchestration/data.js` 保持生成态本地，不回写业务分支。

## 偏差

- `worklog migrate` 对 300+ 个 legacy manifest 仅刷新 `updatedAt`，属无意义噪声；已回滚这些只含时间戳的 diff，只保留 AF-368 回执哈希这一实质变更。
- AF-363/364 采用“补登事件 → 取消 → 归档”重建历史，事件里保留原取消原因，不修改原始任务单。
