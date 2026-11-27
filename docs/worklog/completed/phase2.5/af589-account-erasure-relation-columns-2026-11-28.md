# AF-589 账号硬擦除覆盖 `*_user_id` 与双人树归属列 — 交付记录

- 日期：2026-11-28
- 基线：`d1cf5da6f079a36f46f3620918fb324adf206990`
- 分支：`task/AF-589-account-erasure-relation-columns`
- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-589/task-sheet.md`

## 1. 问题

AF-587 已把归属列扩展到 `uid` / `user_id` / `*_uid`，但 schema 仍有未覆盖的用户列：

- `tree_water_logs.actor_user_id`：双人树浇水日志的操作者。
- `drift_bottle_entries.picked_by_user_id`：漂流瓶领取者。
- `companion_trees.owner_a_id` / `owner_b_id`：双人树双方。
- `oauth_identities.provider_user_id`：名字以 `_user_id` 结尾，但它是第三方 OAuth 用户 id，不是本站 uid。

前四项在账号删除后会留下用户关联数据；最后一项如果被泛化匹配，会制造错误的删除语义。

## 2. 改动

- `src/user/providers/account-erasure.service.ts`
  - `isUserOwnershipColumn` 增加 `*_user_id` 后缀与显式 `owner_a_id` / `owner_b_id`。
  - 新增 `EXTERNAL_USER_COLUMNS = ['provider_user_id']`，优先排除，不拿本站 uid 去匹配第三方 id。
  - 文件头与注释同步说明双人树 / 行为日志 / 第三方 id 三类边界。
- `test/user/account-erasure.spec.ts`
  - 原覆盖用例扩展到 `actor_user_id`、`owner_a_id`、`owner_b_id`、`picked_by_user_id`，删除表数 8、SQL 顺序逐条断言。
  - 新增 1 条：`oauth_identities` 只删 `user_id`，仅含 `provider_user_id` 的表不产生删除。

## 3. 设计决策

- **为什么用 `*_user_id` 后缀而不是全量 `*_id`**：`tree_id` / `case_id` / `session_id` / `tenant_id` 等业务外键不是用户归属；全量 `*_id` 会产生跨域误删。
- **为什么显式列 `owner_a_id` / `owner_b_id`**：这两个列名不符合 `_uid` / `_user_id` 后缀，但语义明确是双人树双方的用户 id；用白名单保持可解释性。
- **为什么排除 `provider_user_id`**：OAuth 第三方 id 可能与本站 uid 空间重叠但语义不同；禁止按本站 uid 匹配，避免误删或错误的合规陈述。

## 4. 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/user/account-erasure.spec.ts` | 5 passed / 0 failed |
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error |
| `pnpm test` | 见下方全量结果 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

全量：`365 passed + 1 skipped`，`5185 passed / 0 failed / 4 skipped`，耗时 `753.84s`。

## 5. 偏差与遗留

- 无任务单偏差。
- 延续 AF-587-B1：归属识别仍是列名约定；未来新增非 `*_uid` / `*_user_id` / 白名单命名的用户外键，需要同步补规则或改实体显式标注。
