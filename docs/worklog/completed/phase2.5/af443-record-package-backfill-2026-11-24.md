# AF-443 交付记录：补齐 AF-436/437/438 记录包占位并复位 verify

- 日期：2026-11-24
- 任务：AF-443（orchestrator，self-dispatch）
- 基线：`f89aa09165acda2d403ddad1e9f8c4474e3e1add`
- 结论：**done** — 三个记录包与 `af436-*` 占位入库，`worklog verify --strict` 与 `validate` 复位 PASS。

## 改了什么

只入库既有记录文件，不碰 `src/`、`scripts/`、`bin/`：

| 路径                                                                          | 内容                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-436/`             | task-sheet（canceled，scope-domain-conflict） + manifest         |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-437/`             | task-sheet（rejected + archived，GUI relay 投递失败） + manifest |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-438/`             | task-sheet（backlog，依赖永不满足） + manifest                   |
| `docs/worklog/completed/phase2.5/af436-kernel-ref-fingerprint-2026-11-24.md`  | AF-436 取消说明（无实现内容）                                    |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-443/`             | 本单记录包（task-sheet + manifest + 冻结回执）                   |
| `docs/worklog/completed/phase2.5/af443-record-package-backfill-2026-11-24.md` | 本文件                                                           |

## 关键设计决策

1. **为什么必须单独开一单**：`preflight` 的 `task-entry-gate` 按 scope 判断暂存归属，AF-442 的 scope 不含上述路径，整目录 `git add` 会直接判 `scope-residual`。记录包不全则 `worklog verify` 阻断**每一次**提交，CI 的 `worklog verify --strict --state-free` 同理会红，所以只能用一个覆盖这些路径的独立任务单承接。
2. **不改历史任务单正文**：AF-436/437/438 的任务单正文保持登记时原样（不可变），终态原因写在各自的 `af4xx-*` 交付记录里，只做陈述不做美化。
3. **占位文件写真实原因**：AF-437 写明「GUI relay 子进程 `Get-FileHash` 不可用 → 投递失败 → 自动闭合归档」，AF-438 写明「`dependsOn: [AF-437]` 永不满足，由后续台账分组单承接」，避免后来者把占位误认为已完成。

## 闸门

<!-- gateResults -->

| 命令                                                         | 结果                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS（活跃=2 归档=411 记录包=424 legacy指针=133/133 继承孤儿=10/10） |
| `node scripts/orchestration/cli.mjs validate`                | PASS（运行态任务单 / 状态事件日志哈希链 / 索引投影一致）             |
| `git diff --stat HEAD -- src/engine-core`                    | 空（0 行）                                                           |

说明：本单不含代码改动，故未重复跑 `pnpm lint` / `pnpm typecheck` / `pnpm test`；AF-442 的代码闸门数字见 `af442-kernel-ref-fingerprint-2026-11-24.md`。

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 暂存路径全部落在本单 scope：`records/AF-436,437,438,443/`、`af436-*`、`af443-*`。PASS
- 未修改 `src/`、`scripts/`、`bin/`、`docs/architecture/`，未混入 AF-442 的已提交产物。PASS

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- taskId 一致（任务单 / 回执 / 本记录）：AF-443
- `src/engine-core` 零 diff：PASS
- 记录包声明路径全部落地：PASS
- 状态面只经 CLI（`task register/promote`、`run-once`）：PASS

<!-- /contractChecks -->

## backlog 遗留项

<!-- backlogItems -->

- AF443-B1（adapter）：GUI relay 发送器 `PSModulePath` 污染导致 `Get-FileHash` 缺失，外部执行器派发链路实际不可用，仍待修（详见 af442 的 AF442-B2）。
- AF443-B2（framework）：`worklog verify` 对 canceled/rejected 任务同样强制要求交付记录文件存在，容易被「取消任务」误伤成全局阻断；建议在框架侧区分终态类型。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项       | 任务单写的                              | 实际                             | 处置           |
| -------- | --------------------------------------- | -------------------------------- | -------------- |
| 执行通道 | orchestrator self-dispatch（file 通道） | 与预期一致，无偏差               | —              |
| 闸门范围 | 声明 verify + validate                  | 一致；未加代码闸门（本单无代码） | 已在闸门表说明 |

<!-- /deviationTable -->

## 结论

<!-- reviewVerdict -->

passed — 记录包补齐、状态面复位，属纯文档与运行态收口，无风险面扩大。
<!-- /reviewVerdict -->

## commit message

`chore(af443): 补齐 AF-436/437/438 记录包占位并复位 verify`
