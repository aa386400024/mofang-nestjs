# AF-579 交付记录：修复 validate 对已归档旧回执 deletionChecks 的误报

- 任务：AF-579
- 上下文：phase2.5-orchestration-closed-loop
- 类型：fix
- 日期：2026-11-27
- 分支：task/AF-579-legacy-receipt-deletion-checks

## 改动

| 文件 | 改动 |
| --- | --- |
| `scripts/orchestration/validator.mjs` | 新增 `normalizeReceiptForValidation`；`validateReceiptSchema` 接受 `archived` 选项，仅在归档任务视图内把字符串 `deletionChecks` 补成 `{path, check}` |
| `scripts/orchestration/cli.mjs` | `validate` 读取索引 `archivedTasks`，按回执 `taskId` 判断是否归档，并传入兼容选项 |
| `scripts/orchestration/__tests__/orchestration.spec.mjs` | 新增 AF-579 回归用例：归档旧结构通过、活动任务旧结构仍失败、原对象不被修改 |

未改动三份历史回执、manifest、框架 schema、`src/engine-core` 与业务代码。

## 根因与取舍

`validate` 会遍历 `transport/receipts/*.json` 做 receipt schema 校验。AF-534 / AF-535 / AF-557 三份已归档回执的 `changedFiles.deletionChecks` 是字符串数组，而 receipt schema 要求每项为 `{path, check}` 对象，因此报 `must be object`。

三份回执已冻结并进入记录包，直接改正文会改变 sha256、破坏 manifest 与证据链；全局放宽 schema 又会让新回执失去约束。最终采用**只在已归档任务校验视图内归一化**的方案：

- 归档任务：字符串项按 `deleted[index]` 补 `path`；对不上时使用 `legacy://<taskId>/deleted-<n>` 作为仅校验用的占位，不回写。
- 活动任务：原样严格校验，字符串项继续失败。
- 历史回执正文、sha256、manifest 均不动。

## 闸门

| 命令 | 退出码 | 数字 | 定性 |
| --- | --- | --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 0 | 284 passed / 0 failed | 新增 1 例，原 283 例全绿 |
| `node scripts/orchestration/cli.mjs validate` | 0 | 无 FAIL；AF-534/535/557 已 PASS | 全仓机读校验恢复 |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 2409 条事件；schema / 哈希链 / 索引投影一致 | PASS |
| `pnpm lint` | 0 | 0 error | 含 `scripts/**/*.{mjs,cjs}` 脚本层 |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 | engine-core 零改动 |

## 偏差

无。任务单未要求改台账，AF-580 另行处理。

## 遗留

- 无新增遗留。
- 已归档回执的兼容属于审计视图能力，不改变冻结证据；后续若重新签发旧任务，应按新任务新回执严格生成。
