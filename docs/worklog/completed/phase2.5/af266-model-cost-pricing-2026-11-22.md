# AF-266 · 豆包角色模型按模型单价计费

- 日期：2026-11-22
- 基线：`db6783491a0141902d7f486df101db59bc91a78b`（AF-265 合并后 integrate）
- 分支：`task/AF-266-model-cost-pricing`
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-266/task-sheet.md`

## 背景

AF-261 只做到 provider 维度分账，仓库没有任何厂商内置报价：豆包角色模型会话一直按 MiniMax 口径的全局默认价 `0.0015 / 0.0045 元/千 tokens` 估算，成本被高估约 1.9–2.3 倍。

provider 级覆盖价也解决不了：同一个豆包账号还跑 `doubao-seed-2-1-pro`（6 / 30 元每百万 tokens），一刀切会把 pro 调用严重低估。因此必须补**模型维度**计价。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `src/engine-adapters/observability/session-cost.ts` | `SessionCostPricingTable` 增加 `byModel`（键 `provider/model`）；新增 `OFFICIAL_MODEL_PRICING`、`modelPricingKey`、`resolveBucketPricing`；`estimateSessionCost` 与 `buildProviderBreakdown` 共用同一解析；`pricingSource` 增加 `model`；`resolveSessionCostPricingTable` 支持 `models` 覆盖 |
| `test/engine-adapters/af266-model-cost-pricing.spec.ts` | 新增 5 例：官方模型价命中、未知模型回落 provider 价、跨 provider 分桶守恒、env 模型覆盖、模型名缺失回落 |

### 计价优先级

模型价 → provider 覆盖价 → 全局回落价。三档共用 `resolveBucketPricing`，避免总价与明细两套口径漂移。

```ts
// 模型价命中
resolveBucketPricing('doubao', { model: 'doubao-seed-character-260628', ... })
// → { pricing: { inputPer1k: 0.0008, outputPer1k: 0.002 }, source: 'model' }
```

### 内置官方价

`OFFICIAL_MODEL_PRICING` 当前只收录已核对的一项：

```ts
'doubao/doubao-seed-character-260628': { inputPer1k: 0.0008, outputPer1k: 0.002 }
```

来源：火山方舟模型详情页，`doubao-seed-character-260628` 在线推理输入 0.8 元/百万 tokens、输出 2 元/百万 tokens（输入 ≤32k 档，2026-11-22 查询）。

未核对报价不进表，继续走 provider / 全局回落，并在 `pricingSource` 标为 `fallback`，不把猜测当报价。

## 闸门

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| 定向 5 + AF-261 6 + WP24 18 | 29/29 通过，exit 0 | `data/af266-targeted.log` |
| `pnpm lint` | 0 error / 0 warning，exit 0 | `data/af266-lint.log` |
| `pnpm exec tsc --noEmit -p tsconfig.json` | 0 error，exit 0 | `data/af266-tsc.log` |
| `pnpm test` | 262 files passed + 1 skipped；4269 tests passed + 4 skipped，exit 0 | `data/af266-test.log` |
| `git diff --stat HEAD -- src/engine-core` | 空，零改动 | 本地 `git diff --stat` |

## 关键决策与偏差

1. **模型级 env 覆盖键暂不装配**。任务单目标 5 要求 env 支持 `LLM_PRICE_*_MODEL_*` 键；实际装配后 WP25 的 `.env.example` 覆盖测试会要求模板声明这两个新键，而 AF-266 的 scope 不含 `.env.example`，暂存会被 preflight 判越界。为保证本任务单闭环、参数能力不丢，`resolveSessionCostPricingTable` 的 `models` 入参与 env 覆盖逻辑完整保留并有单测；`engine.module.ts` 暂不读这两个键。已登记后续任务补装配与 `.env.example` 声明。
2. **未知模型不沿用角色模型价**。只有精确命中 `provider/model` 才吃模型价；`doubao-seed-2-1-pro` 等未核对型号仍走 provider 覆盖价或全局回落，避免新的系统性低估。
3. **`pricingSource` 扩为三值**。旧的 `provider_override | fallback` 联合类型扩成三值属于向后兼容扩展，AF-261 的 6 例与 WP24 的 18 例均无断言破坏。
4. **只收录一条官方价**。MiniMax M3 当前没有核对过官方单价，继续走全局回落并在明细里显式标注，不做推测性内置。

## 遗留

- `LLM_PRICE_INPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628` / `LLM_PRICE_OUTPUT_PER_1K_MODEL_DOUBAO_SEED_CHARACTER_260628` 尚未装配进 `engine.module.ts`，`.env.example` 也还没有对应说明行。
- MiniMax M3 官方单价未核对；跨厂商成本对比目前仍有一侧是工程默认价。
- `auto-practice` 落库路径尚未消费 `providerBreakdown`，管理后台成本看板也还没按 provider/model 展示。

## 提交

`feat(af266): 豆包角色模型按模型单价计费`

## scopeCheck

`in-scope`。只改 `src/engine-adapters/observability/session-cost.ts`、新增本任务测试与交付记录；`engine.module.ts` 最终与基线一致（模型 env 装配拆到后续任务）；未触碰 `src/engine-core`，未暂存 `web/orchestration/data.js` 与 `data/` 取证日志。

## contractChecks

| 项 | 结果 | 说明 |
| --- | --- | --- |
| taskId | pass | 分支名与提交标题只含 AF-266 |
| state-write | pass | promote / run-once / branch create 均经 CLI |
| index-schema | pass | 回执六组字段齐全，JSON 完整闭合 |
| compat | pass | AF-261 6 例与 WP24 18 例无回归 |
| engine-boundary | pass | 未触碰 `src/engine-core` |

## gateResults

- 定向：`pnpm exec vitest run af266 + af261 + wp24`，exit 0，3 files / 29 tests 全过。
- 静态：`pnpm lint` exit 0（0 error / 0 warning）；`pnpm exec tsc --noEmit -p tsconfig.json` exit 0（0 error）。
- 全量：`pnpm test` exit 0，262 files passed + 1 skipped，4269 tests passed + 4 skipped。
- 边界：`git diff --stat HEAD -- src/engine-core` 为空。

## backlogItems

| id | 影响 |
| --- | --- |
| visitor-model-price-env-wiring | 模型级 env 覆盖键未装配进 engine.module，部署方暂无按账单纠偏入口 |
| minimax-m3-official-pricing | MiniMax M3 官方单价未核对，跨厂商成本对比有一侧仍是工程默认价 |
| provider-breakdown-consumers | auto-practice 落库与管理后台成本看板尚未消费 provider/model 明细 |

## deviationTable

| taskSays | reality | action | why |
| --- | --- | --- | --- |
| 目标 5 要求 env 支持模型覆盖键 | 装配新键后 WP25 要求 `.env.example` 声明，本任务 scope 不含该文件，暂存会被 preflight 判越界 | 保留 `models` 入参与单测，`engine.module` 暂不装配，另立任务补模板与装配 | 保证本任务闭环不越界；内置官方价与解析能力已生效，缺的只是部署侧入口 |

## reviewVerdict

`passed`。角色模型桶按 0.0008/0.002 计价并标 `model`，未知模型回落 provider 价，跨 provider 总价等于明细之和；定向、静态、全量闸门全绿；engine-core 零改动。

