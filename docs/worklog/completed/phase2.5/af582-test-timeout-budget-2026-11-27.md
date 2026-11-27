# AF-582 交付记录：显式化两处测试超时预算

- 任务：AF-582
- 上下文：phase2.5-quality-gates
- 类型：fix
- 日期：2026-11-28
- 分支：task/AF-582-test-timeout-budget
- 基线：db586a05db0f68d0c092628ee73585f8f5e9d63f

## 1. 问题

AF-581 全量门两次运行出现 5 例失败，全部是既有测试内部 30s 超时，不是业务断言失败：

- `test/auto-practice/af073-batch-report-cli.spec.ts`：`spawnSync(..., { timeout: 30_000 })` 拉起真实 `tsx bin/batch-report.ts`，单跑每例 16.8–20.9s；363 文件并行时 CPU 争用导致超过 30s，子进程被杀，`status` 变 null。
- `test/engine-adapters/wp12-memory-closeout.spec.ts`：逐字稿覆盖写用例单跑 8.76s，并行时超过 vitest 默认 30s。

两文件单跑均全绿，证明不是代码回归。超时预算与实际耗时严重不匹配，导致全量门出现与代码无关的固定 flaky，破坏红灯语义。

## 2. 改动

| 文件 | 改动 |
| --- | --- |
| `test/auto-practice/af073-batch-report-cli.spec.ts` | 新增 `CLI_TIMEOUT_MS = 120_000` 常量与注释；`spawnSync` timeout 改用该常量；四个 `it` 第三参显式 `CLI_TIMEOUT_MS` |
| `test/engine-adapters/wp12-memory-closeout.spec.ts` | 目标用例第三参显式 `60_000`，注释记录实测 8.8s 与并行放大原因 |

只改超时预算与注释，不改断言、夹具、业务实现、用例语义或全局 vitest 配置。

## 3. 设计口径

1. 120s 是实测 20.9s 的约 5.7 倍，60s 是实测 8.8s 的约 6.8 倍，既覆盖并行放大，也仍是真实的挂起探测器。
2. 保留真实 CLI 端到端链路，不用 mock 子进程、不改成无限等待、不吞异常。
3. 不调全局 `testTimeout`，避免把其他慢用例的问题一起掩盖。
4. 注释写清实测值和放大原因，防止后人误删预算。

## 4. 闸门

| 命令 | 退出码 | 数字 |
| --- | --- | --- |
| `pnpm exec vitest run test/auto-practice/af073-batch-report-cli.spec.ts test/engine-adapters/wp12-memory-closeout.spec.ts` | 0 | 44 passed / 0 failed，72.99s |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm lint` | 0 | 0 error，无 warning |
| `pnpm test` | 0 | 5153 passed / 0 failed / 4 skipped，363 文件，714.55s |
| `git diff --stat HEAD -- src/engine-core` | 0 | 输出为空 |
| `git diff --check` | 0 | 无空白错误 |

全量门已恢复可信红灯：默认 363 文件并行下不再出现 `af073` / `wp12` 的 30s 固定超时。

## 5. 偏差

无。仅改任务单 scope 内两个测试文件。

## 6. 遗留

- CLI 冷启动 16–21s 本身仍是全量耗时大头；`isolate: false` 可省约 20s 启动开销，但涉及全局 vitest 配置，另案评估。
- 其他长耗时用例若后续接近预算，应按本单模式显式写预算并注明实测，而不是调全局超时。
