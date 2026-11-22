# AF-210 · 豆包（火山方舟）第二 provider 接入交付记录

- 任务：AF-210「豆包（火山方舟）第二 provider 接入：档位模型映射修复、热备开关与连通取证」
- 基线：`e54012bfc3f7f01c36bf60695df7bfa775558dca`
- 日期：2026-11-21
- 结论：豆包渲染备候选从「名义接了、实际必 404」修到「映射可用 + 可单 provider 覆盖 + 本机连通取证完成」；主候选仍是 MiniMax，engine-core 零 diff。

## 1. 这单解决什么

2026-11-14 的选型结论是「豆包做备候选，代码零改动，只差 key」。2026-11-20 采购 key 后实测发现前提不成立：

- 方舟控制台三个旧型号名 `doubao-lite` / `doubao-pro-32k` / `doubao-pro-128k` **全部 404**。
- 代码 `TIER_MODELS` 给豆包三档写的正是这三个名字。
- 结果：只要 `ENGINE_RENDER_FALLBACK_PROVIDERS=doubao`，熔断切到备候选每次都 404，备候选等于没接，还会把失败计数持续打满。

本单做三件事：换成本效型号、加 provider 维度模型覆盖、把本机 `.env` 与连通证据补齐。

## 2. 实施方案

### 2.1 档位映射（`src/llm/registry/llm-router.service.ts`）

| 档位     | 旧（方舟已下线）  | 新（方舟当前有效）            |
| -------- | ----------------- | ----------------------------- |
| BASIC    | `doubao-lite`     | `doubao-seed-2-1-lite-260915` |
| RAG      | `doubao-pro-32k`  | `doubao-seed-2-1-pro-260628`  |
| ADVANCED | `doubao-pro-128k` | `doubao-seed-2-1-pro-260628`  |

型号表上方补了维护注释：旧别名已下线，换型号优先用 env 覆盖，不必改表；带日期后缀才是有效 ID。

### 2.2 provider 维度模型覆盖（`src/engine-adapters/wiring/render-config.factory.ts`）

新增键 `ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>`（KIND ∈ CHAT / STABLE / ADVANCED），优先级保持为：

1. 全局显式键 `ENGINE_RENDER_<KIND>_MODEL`（既有语义，原封不动）
2. provider 维度键 `ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>`
3. router 的档位表

`advanced` 未单独配置时，先回退全局 chat，再回退该 provider 的 chat 覆盖，保证与「advanced 与 chat 同口径」的既有约定一致。

这样主候选 MiniMax 不受影响：想只给豆包换型号，写 `ENGINE_RENDER_CHAT_MODEL_DOUBAO` 即可，不必动全局键。

### 2.3 豆包 provider 默认模型（`src/llm/providers/doubao.provider.ts`）

`defaultChatModel` 从 `doubao-pro-32k` 改为 `doubao-seed-2-1-pro-260628`，避免非渲染链路（直接走 provider 默认）回落到已下线型号。

### 2.4 本机运行配置（`.env`，gitignore，不入库）

- `LLM_DOUBAO_API_KEY`：已配置（长度 46，指纹后四位 `d5970`）
- `ENGINE_RENDER_FALLBACK_PROVIDERS=doubao`
- `ENGINE_RENDER_PRIMARY_PROVIDER=minimax`、`LLM_DEFAULT_CHAT_PROVIDER=minimax` 未改

## 3. 连通取证（不含 key 明文）

| 检查                                                      | 结果                            |
| --------------------------------------------------------- | ------------------------------- |
| `GET /api/v3/models`                                      | 200，列表返回豆包系列           |
| chat `doubao-seed-2-1-lite-260915`                        | 200（未开通时 404，开通后通过） |
| chat `doubao-seed-2-1-pro-260628`                         | 200                             |
| chat `doubao-seed-character-260628`                       | 200                             |
| chat `doubao-pro-32k` / `doubao-pro-128k` / `doubao-lite` | 404（旧名下线取证）             |

控制台账：`Doubao-Seed-2.1-pro` 与 `Doubao-Seed-Character` 原已开通；`Doubao-Seed-2.1-lite` 本次开通（免费额度 50 万 token，输入 0.0008 / 输出 0.0027 元/千 token）。

成本口径提醒：`pro` 在默认 `low` 思考强度下发一个 “ping”（`max_tokens=4`）实际计 347~684 token，思考 token 计入生成长度上限。渲染链默认 `DEFAULT_RENDER_REASONING_EFFORT=low`、预算 1500，接入后不做额外调整，但 shadow 对照与单价估算必须按「含思考 token」口径算。

## 4. 改动清单

| 文件                                                       | 改动                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/llm/registry/llm-router.service.ts`                   | 豆包三档换有效型号 + 维护注释                                         |
| `src/llm/providers/doubao.provider.ts`                     | 默认模型换有效型号                                                    |
| `src/engine-adapters/wiring/render-config.factory.ts`      | 新增 provider 维度模型覆盖与优先级                                    |
| `test/llm/af210-doubao-tier-mapping.spec.ts`               | 新增 3 例：三档有效、旧名不再出现、不误伤其他厂商                     |
| `test/engine-adapters/af210-render-model-override.spec.ts` | 新增 5 例：缺省 / provider 覆盖 / 全局优先 / advanced 回退 / 主备并存 |
| `.env`（不入库）                                           | key + fallback 开关                                                   |

## 5. 闸门

- 定向：`pnpm exec vitest run test/llm/af210-doubao-tier-mapping.spec.ts test/engine-adapters/af210-render-model-override.spec.ts` → 2 files / 8 tests passed
- `pnpm typecheck` → 0 error
- `pnpm lint` → 0 error / 0 warning
- `pnpm test` → 4049 passed / 7 skipped / 0 failed（234 passed + 1 skipped files，78.67s）
- `git diff --stat HEAD -- src/engine-core` → empty（零改动）
- `ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate` → 9 项全 PASS

## 6. 与任务单的偏差

**编号让位（AF-209 → AF-210）**：本单最初登记为 AF-209，推送前发现并行机器在同一分支提交了「来访者真人度 R3」也占用 AF-209，且已合入 `integrate`（`e54012b`）。按「后登记者让号」改为 AF-210，代码与验收口径不变，交付记录、测试文件名与注释同步改名；基线也随远端前进从 `fcac5b2` 更新为 `e54012b`。

- `.env.example` 未新增长注释段落：新增 env 键（`ENGINE_RENDER_<KIND>_MODEL_<PROVIDER>`）不在既有键位清单内，但属于「可选覆盖」，不写模板也能运行。为遵守任务单 scope（未列 `.env.example`），本单不改该文件，键名口径只落在本记录与代码注释里。后续若要进模板，另开小单。
- 未做 96 场 shadow 对照：任务单明确列在验收边界外，需要批次与预算，另案。

## 7. 后续

1. 96 场同口径 shadow（主 MiniMax vs 备豆包）需要单独任务单与预算。
2. 跨机器 key 分发：key 只在本机 `.env`，另一台机器需单独配；不入库、不走文档。
3. 若确定豆包转主候选，再评估 `doubao-seed-character-260628` 用于来访者发言的收益。

commit message：`fix(af210): 豆包备候选档位映射修复与 provider 维度模型覆盖`
