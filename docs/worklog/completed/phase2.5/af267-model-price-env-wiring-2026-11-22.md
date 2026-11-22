# AF-267 · 模型级成本覆盖键装配与模板声明

- 日期：2026-11-22
- 基线：`b0f6d59702703cb161aa2dbe741632282de42b78`（AF-266 合并后 integrate）
- 分支：`task/AF-267-model-price-env-wiring`
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-267/task-sheet.md`

## 背景

AF-266 已内置火山方舟官方模型价 `doubao/doubao-seed-character-260628 = 0.0008 / 0.002 元/千 tokens`，并让 `resolveSessionCostPricingTable` 接受 `models` 入参，但 `engine.module.ts` 没有读对应的两个 env 键，`.env.example` 也没有声明。部署方只能吃内置价，无法按当期账单纠偏。

当时 AF-266 的 scope 不含 `.env.example`，一旦装配新键，WP25 的 env 覆盖测试就会失败，因此把装配与模板声明拆到本任务。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `src/engine-adapters/wiring/engine.module.ts` | 定价表装配新增 `models`：`doubao/doubao-seed-character-260628` 读 `LLM_PRICE_INPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628` / `LLM_PRICE_OUTPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628` |
| `.env.example` | AF-261 provider 覆盖价区块后新增模型覆盖价区块，声明两个键；说明留空 = 内置官方价、优先级为模型价 → provider 价 → 全局价 |

未改 `session-cost.ts`：AF-266 的解析能力与内置价保持原样。未改真实 `.env`。

## 闸门

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| WP25 11 例 + AF-266 5 例 | 16/16 通过，exit 0 | `data/af267-targeted.log` |
| `pnpm lint` | 0 error / 0 warning，exit 0 | `data/af267-lint.log` |
| `pnpm exec tsc --noEmit -p tsconfig.json` | 0 error，exit 0 | `data/af267-tsc.log` |
| `pnpm test` | 262 files passed + 1 skipped；4269 tests passed + 4 skipped，exit 0 | `data/af267-test.log` |
| `git diff --stat HEAD -- src/engine-core` | 空，零改动 | 本地 `git diff` |

## 关键决策

1. **env 键留空仍算“已声明”**：与 AF-261 的 provider 键同口径，模板声明行本身满足 WP25 覆盖测试；运行时空串由 `parsePrice` 回退内置官方价。
2. **不把 Doubao provider 级价预填**：provider 级一刀切会误伤同账号的 `doubao-seed-2-1-pro`，模型级键只覆盖已核对型号。
3. **真实 `.env` 不动**：部署侧是否覆盖由账单决定，本地继续吃内置官方价。

## 遗留

- MiniMax M3 官方单价仍未核对；跨厂商成本对比有一侧是工程默认价。
- `auto-practice` 落库路径尚未消费 `providerBreakdown`，管理后台成本看板未按 provider/model 展示。

## 提交

`feat(af267): 装配模型级成本覆盖键并声明模板`

## scopeCheck

`in-scope`。改动限于 `src/engine-adapters/wiring/engine.module.ts` 与 `.env.example`，外加交付记录；未触碰 `src/engine-core`，未改真实 `.env`，未暂存 `web/orchestration/data.js` 与 `data/` 取证日志。

## contractChecks

| 项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | 分支名与提交标题只含 AF-267 |
| state-write | pass | register / promote / run-once / branch create 均经 CLI |
| index-schema | pass | 回执六组字段齐全，JSON 完整闭合 |
| compat | pass | AF-266 5 例仍全绿，三档优先级未变 |
| engine-boundary | pass | 未触碰 `src/engine-core` |

## gateResults

- 定向：`pnpm exec vitest run wp25-env-example-coverage + af266-model-cost-pricing`，exit 0，2 files / 16 tests 全过。
- 静态：`pnpm lint` exit 0；`pnpm exec tsc --noEmit -p tsconfig.json` exit 0。
- 全量：`pnpm test` exit 0，262 files passed + 1 skipped，4269 tests passed + 4 skipped。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空。

## backlogItems

| id | 影响 |
| --- | --- |
| minimax-m3-official-pricing | MiniMax M3 官方单价未核对，跨厂商成本对比有一侧仍是工程默认价 |
| provider-breakdown-consumers | auto-practice 落库与管理后台成本看板尚未消费 provider/model 明细 |

## deviationTable

本任务无偏差：按任务单装配两个模型价 env 键并声明模板，未改解析逻辑与真实 `.env`。

## reviewVerdict

`passed`。模型级 env 键已装配，`.env.example` 已声明，WP25 覆盖测试与 AF-266 模型价测试全绿；lint/tsc/全量测试 0 失败；engine-core 零改动。
