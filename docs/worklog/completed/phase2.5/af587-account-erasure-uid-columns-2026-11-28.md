# AF-587 账号硬擦除覆盖关系型 uid 列 — 交付记录

- 日期：2026-11-28
- 基线：`fec854029e8d16e8e45ea1dcee7d17ac741c1b37`
- 分支：`task/AF-587-account-erasure-columns`
- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-587/task-sheet.md`

## 1. 问题

`AccountErasureService` 原来只匹配数据库列名为 `uid` 或 `user_id` 的表，其余带用户归属列的表在硬擦除时被跳过。实际 schema 里陪伴 / 双人域大量使用关系列：

- `companion_bindings`：`owner_uid`、`companion_uid`
- `companion_records`：`companion_uid`、`companion_to_uid`
- `rehab_items`：`owner_uid`、`companion_uid`
- `dual_sessions`：`companion_uid`、`owner_uid`
- `soothing_cards`：`from_uid`、`to_uid`

这些表都属于用户个人数据，账号删除后仍留在库里，构成删除权漏删。

## 2. 改动

- `src/user/providers/account-erasure.service.ts`
  - 新增 `isUserOwnershipColumn`：归属列 = `uid` / `user_id` / 任意 `*_uid`。
  - 单表存在多个归属列时逐列删除（如一张表同时有 `owner_uid` 与 `companion_uid`，双边都清），去重后计表一次。
  - `audit_logs` 继续保留，`users` 最后删除，整段仍在单事务内。
  - 表名与列名只取自 TypeORM metadata，不接受外部输入拼接。
- `test/user/account-erasure.spec.ts`（新增）
  - 4 条：三类列匹配与删除顺序、同列去重、无归属列表跳过、删除失败向上抛出。

## 3. 设计决策

- **为什么用 `*_uid` 通配而不是枚举表清单**：仓库已有 40+ 实体，新增实体时枚举清单必漏；`*_uid` 是仓库既有命名约定，覆盖 owner / companion / from / to 等所有关系列。
- **不扩大到 `*_user_id`**：当前 schema 没有该命名；若日后出现，加一条约定或补前缀即可，避免把 `tenant_id` 等误判为用户归属。
- **保留 `audit_logs`**：合规审计需要留痕，与删除权的最小必要留存口径一致；该决策不在本任务内改动。

## 4. 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/user/account-erasure.spec.ts` | 4 passed / 0 failed |
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error |
| `pnpm test` | 见下方全量结果 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

全量：`365 passed + 1 skipped`，`5179 passed / 0 failed / 4 skipped`，耗时 `746.42s`。

## 5. 偏差与遗留

- 无任务单偏差。
- 遗留 AF-587-B1：`AccountErasureService` 仍按“列名约定”识别归属，若未来出现非 `*_uid` 命名的用户外键（如 `subject_id`），需要补约定或在实体层显式标注，否则仍可能漏删。
