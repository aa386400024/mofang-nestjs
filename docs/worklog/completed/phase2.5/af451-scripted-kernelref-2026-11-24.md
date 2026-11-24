# AF-451 交付记录 · 合成语料生成器补写内核指纹并重跑

- 任务：AF-451（orchestrator，`priorTasks: [AF-450, AF-449]`）
- 分支：`task/AF-451-scripted-kernelref`（自 `integrate` = `50ef424ff2005da7dae593791b4dd854c4231851`）
- 日期：2026-11-24

## 1. 问题

AF-450 把台账拆成真实 / 合成 / kernelRef 三段后，表四显示 19 场语料全在 `none` 桶 —— 其中 6 场是 AF-449 刚生成的合成语料，本可以带当时内核指纹。根因：生成器读了内核 delta 表来算 delta，却没把 `KERNEL_REF` 写进会话本体（AF-450-B1）。

## 2. 改了什么

`scripts/ops/quality/af448-scripted-corpus.ts`：新增 `import { KERNEL_REF } from '../../../src/engine-adapters/observability/kernel-fingerprint.js'`，并在会话 payload 里写 `kernelRef: KERNEL_REF`（紧挨 `synthetic: true` 放置，注明是表四分桶依据）。随后 `--apply` 重跑，覆盖 6 个会话文件。

- 用公开导出而不是复刻指纹算法：脚本跑在 tsx 下可以直读 `src`，没有理由维护第二份哈希实现。
- 指纹值随脚本执行时的内核 delta 表变化，天然满足「语料 ↔ 内核版本」可追溯。

## 3. 闸门与证据

| 闸门     | 命令                                                                                 | 结果                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 重跑     | `pnpm exec tsx scripts/ops/quality/af448-scripted-corpus.ts --apply`                 | exit=0，6 个文件重写；`debug_scripted_af448_1.json` 实测 `"kernelRef": "kr1-f83dcfed01fec2b4"`、`"synthetic": true`     |
| 台账复核 | `node scripts/ops/quality/af427-operator-delta-ledger.mjs --dir data/debug-sessions` | 表四从「全部 none」变为两桶：`none` 13 场 / 205 轮 / 合成 0；`kr1-f83dcfed01fec2b4` 6 场 / 34 轮 / 合成 6；指纹版本数=2 |
| 口径回归 | 同上，表三                                                                           | 表三仍为 13 场真实 / 205 轮，零语料算子清单不变 —— 真实口径未被指纹改造影响                                             |
| 类型     | `pnpm typecheck`                                                                     | 0 error                                                                                                                 |
| 红线     | `git diff --stat HEAD -- src/engine-core`                                            | 空                                                                                                                      |

## 4. 偏差

- 无功能偏差。仅一处事实澄清：`pnpm lint` 的脚本配置只匹配 `scripts/**/*.{mjs,cjs}`，本文件是 `.ts`，定向 eslint 报 `File ignored because no matching configuration`（0 error / 1 warning「被忽略」）—— 该 warning 是配置覆盖缺口，不是本文件有违规，已登记为遗留。

## 5. 遗留

1. **AF451-B1**：`scripts/ops/quality/*.ts`（`af322-classifier-shadow-audit.ts`、`af448-scripted-corpus.ts`）不在 lint 覆盖面内（`lint` 的 scripts 段只扫 `.mjs/.cjs`），也不确定是否被 `tsconfig.json` 纳入 tsc。建议单独开单把 scripts 下的 `.ts` 纳入 lint 与 typecheck 口径，否则「pipeline 里的 TS 脚本」长期无静态兜底。
2. **AF451-B2**：真实语料 13 场仍无 `kernelRef`（早于 AF-442），表四 `none` 桶会长期存在；按版本对比真实语料幅度只能等新语料按新版内核落盘。
3. **AF451-B3**：`pnpm lint` 两条既有 warning（`src/admin-debug/tts/debug-tts.service.ts:13-14` import/order）仍在。
