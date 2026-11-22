# AF-042 交付记录 · WP38 用例超时预算复单

- 任务单：`docs/worklog/pending/af042-wp38-timeout-budget-rework-task-2026-11-17.md`
- 角色：executor（会话内执行，文件通道投递） ｜ 类型：fix ｜ 基线 `ba582325d10426d5bf194048b07899dcb3a1a373`
- 日期：2026-11-17 ｜ 结论：**completed / passed**

## 1. 事实

| 项          | 事实                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 代码改动    | 已在库：commit `c8632c6`（`test/admin-debug/wp38-debug-session-resume.spec.ts`，+4/−1）                                                 |
| 本单新增    | 仅交付记录 1 份                                                                                                                         |
| 投递        | 文件通道（`config.dispatch.channel=file` 临时切换，领单后恢复 gui-relay）                                                               |
| AF-041 结论 | `failed`，原因：`channel fallback` 未给 `--cause`，缺省落 `deterministic-defect`，决策链按 `reliability.md §4.1` 判 `delivery-terminal` |

## 2. 闸门（实跑）

| 命令                                                                      | 退出码 | 结果                |
| ------------------------------------------------------------------------- | ------ | ------------------- |
| `pnpm exec vitest run test/admin-debug/wp38-debug-session-resume.spec.ts` | 0      | 10 passed（1.67s）  |
| `pnpm lint`                                                               | 0      | 0 error / 0 warning |
| `pnpm typecheck`                                                          | 0      | 0 error             |

## 3. 偏差表

| 项   | 任务单说                | 现实                          | 处置                             | 为什么                                               |
| ---- | ----------------------- | ----------------------------- | -------------------------------- | ---------------------------------------------------- |
| 通道 | executor 走 `gui-relay` | 会话内执行，桌面 relay 未参与 | 临时置 `file` 通道领单，事后恢复 | 文件通道就是「不驱动桌面」的合法通道，比伪装送达诚实 |
| 代码 | 复用 AF-041 改动        | 已在 `c8632c6`                | 不重复改                         | 重复改动会与上一单冲突且不可复核                     |

## 4. 登记给下一单（AF-042-I1）

`channel fallback` 的 `cause` 缺省值等于「判决值」：不给 `--cause` 就落 `deterministic-defect`，任务直接进 `failed` 终态。**代执行 / 未走本通道属于「流程事实」，不是「确定性缺陷」**，必须显式给 `--cause`（或先补 fallback 的 cause 必填校验）。这条已进回执 `backlogItems`，建议下一批把 `--cause` 变成 fallback 的必填项。

## 5. 回执字段标记（机读口径）

- gateResults：见 §2 闸门表（3 条命令，全部 exitCode=0）
- scopeCheck：in-scope（仅新增交付记录 1 份，代码改动属 AF-041 的 commit c8632c6）
- contractChecks：taskId / state-write / index-schema / event-chain 四项 pass
- backlogItems：AF-042-I1（fallback 的 cause 缺省值等于判决值）
- deviationTable：见 §3 偏差表（通道 / 代码归属）
- reviewVerdict：passed
