# AF-442 交付记录：内核指纹（kernelRef）落盘与记录包占位入库

- 日期：2026-11-24
- 任务：AF-442（implementation / executor；承接 AF-439、AF-437）
- 基线：`f89aa09165acda2d403ddad1e9f8c4474e3e1add`
- 分支：`task/AF-437-kernelref`（任务 id 变更但分支沿用，避免多次重排历史）

## 1. 改了什么

1. `src/engine-adapters/observability/kernel-fingerprint.ts`（新增）
   - 用公开 API `aggregateTurnDelta` 对 13 个 `CounselorEventKind` 逐事件求运行时有效 delta（不读内核私有 `DELTA_TABLE`，`src/engine-core` 一行不动）。
   - 规范化（键名 `localeCompare` 排序 + 6 位小数）后 sha256，取前 16 位，前缀 `kr1-`。
   - 导出 `KERNEL_FINGERPRINT_SCHEMA` / `FINGERPRINT_EVENT_KINDS` / `fingerprintRows()` / `hashFingerprintRows()` / `computeKernelFingerprint()` / 模块级 `KERNEL_REF`。
2. `src/admin-debug/debug-session-record.ts`：`DebugSessionRecord` 加可选 `kernelRef?: string`。
3. `src/admin-debug/debug-session.service.ts`：`persistCreate` 建档时写 `kernelRef: KERNEL_REF`（import 顺序按 `import/order` 规则排在 `llm-deliberation.service` 之后）。
4. `test/engine-adapters/kernel-fingerprint.spec.ts`（新增 5 用例）。
5. 三份记录包占位：`af437-*`、`af438-*`、`af439-*`（各自写明去向，无实现内容）。

## 2. 关键设计决策

1. **指纹输入用行为不用常量**：`DELTA_TABLE` 未导出，读它必须改纯层；`aggregateTurnDelta` 返回真正落地的向量（含规则覆写与同盟基础值）。
2. **不写死哈希快照断言**：内核正常调参就会改哈希；单测断言性质（格式 / 稳定 / 覆盖系数），具体分布交给台账表四。
3. **模块级 `KERNEL_REF` 缓存**：系数是进程内常量，每场会话重算 13 次 `aggregateTurnDelta` 无意义。
4. **一个提交承载四份交付记录**：`worklog verify --strict` 按记录包声明的路径检查文件存在性，缺一个就阻断所有提交——占位必须与实现同批入库。

## 3. gateResults

| 闸门       | 命令                                                                   | 结果                                            |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| 指纹单测   | `pnpm exec vitest run test/engine-adapters/kernel-fingerprint.spec.ts` | 1 file / 5 tests passed（370ms，无长驻进程）    |
| lint       | `pnpm lint`                                                            | 0 error 0 warning（`eslint --cache`，命中缓存） |
| 类型检查   | `pnpm typecheck`                                                       | 0 error（`tsc --incremental`）                  |
| 纯层边界   | `git diff --stat HEAD -- src/engine-core`                              | 0 行（空）                                      |
| 记录包校验 | `node scripts/orchestration/cli.mjs worklog verify --strict`           | PASS                                            |

## 4. scopeCheck

`in-scope`：改动全在 AF-442 任务单 scope 内（`src/engine-adapters/observability/`、两个 admin-debug 文件、`test/engine-adapters/`、三份占位与 AF-442 记录包）；未触 `src/engine-core`、未新增依赖。

## 5. contractChecks

| 项              | 结果 | 说明                                                                       |
| --------------- | ---- | -------------------------------------------------------------------------- |
| taskId          | pass | AF-442 贯穿任务单、记录、回执、提交标题                                    |
| scope           | pass | 见 §4                                                                      |
| engine-boundary | pass | 纯层零 diff                                                                |
| dispatch        | pass | GUI relay 环境缺陷 → `channel fallback`（cause=transient）留痕，未手改状态 |
| privacy         | pass | 指纹只由系数算出，不含对话内容                                             |

## 6. backlogItems

| ID       | 影响                                                                                                                   | 层级      | 状态      |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| AF442-B1 | 老语料无 `kernelRef` 只能标 `legacy`；要判「当前系数是否生效」需重跑带指纹语料                                         | data      | candidate |
| AF442-B2 | GUI relay 发送器子进程 `PSModulePath` 被污染导致 `Get-FileHash` 不可用（exit 9）；修好才能真正把实现任务派给外部执行器 | framework | candidate |
| AF442-B3 | `FINGERPRINT_EVENT_KINDS` 与内核 `CounselorEventKind` 是两份名单，内核新增算子需人工同步                               | adapter   | candidate |

## 7. deviationTable

| 项       | 任务单要求                 | 实际                                                                                    | 处置                                                              | 原因                               |
| -------- | -------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| 执行主体 | executor 经 GUI relay 执行 | relay 子进程 `Get-FileHash` 不可用，AF-437 判投递失败归档；本单由编排者按同一设计代执行 | 登记 `channel fallback`，回执如实标注 `agentRole=executor` 与偏差 | 环境缺陷非代码问题，不绕过派发链路 |
| 任务编号 | AF-439                     | 提交被 verify 阻断（占位缺失），改由 AF-442 一并入库                                    | 取消 AF-439 并在记录里写清原因                                    | scope 不原地修改                   |

## 8. reviewVerdict

`passed` — 指纹只用公开 API、纯函数、无 IO；单测断言性质；老记录兼容；纯层零 diff；四份记录同批入库后 verify 恢复 PASS。

## 9. openQuestions

- 指纹是否也写进 trace 顶层（每轮）：暂不写入——会话生命周期内系数不变，轮级重复只会放大 JSON。
