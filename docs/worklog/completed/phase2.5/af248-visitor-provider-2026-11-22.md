# AF-248 · 生产 visitor 豆包 Seed Character 路由与 V5 prompt 开关（默认关闭）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-248/task-sheet.md`
- 基线：`7bfe4c98c5207e1242c20c6ad3abf1f9ac88d235`（AF-247 合并后的 integrate）
- 分支：`task/AF-248-af248-visitor-provider`
- 日期：2026-11-22

## 做了什么

1. **visitor 运行时开关**（`src/agent/visitor/visitor.runtime.ts`）
   - 新增 `resolveVisitorRuntime(source)`：解析 `VISITOR_LLM_PROVIDER`（`minimax` / `doubao`，默认 `minimax`）、`VISITOR_PROMPT_VARIANT`（`shared` / `seed-v5`，默认 `shared`）、`VISITOR_DOUBAO_MODEL`（默认 `doubao-seed-character-260628`）。
   - 空串 / 纯空白按未配置处理，回落默认值；非法枚举值与“切豆包但缺 `LLM_DOUBAO_API_KEY`”一律启动期抛错，**不静默回退**。
   - 接收 env 原始值快照对象而不是 read 回调：生产装配点必须以字面量 `config.get('KEY')` 出现，WP25 的 AST 断言才能守住 `.env.example` 与读取点一一对应。

2. **LlmService per-call provider**（`src/agent/llm/llm.service.ts`、`llm.types.ts`、`llm.endpoint.ts`）
   - `LlmStreamOptions` 新增可选 `provider: 'minimax' | 'doubao'`，缺省 `minimax`，旧调用零破坏。
   - 构造时额外读取 `LLM_DOUBAO_BASE_URL`（默认 `https://ark.cn-beijing.volces.com/api/v3`）、`LLM_DOUBAO_API_KEY`、`LLM_DOUBAO_MODEL`。
   - 端点由 `buildChatEndpoint()` 统一拼接：MiniMax 走 `/v1/chat/completions`（基址已带 `/v1` 不重复），豆包走 `/chat/completions`；基址误带 `/chat/completions` 会先剥掉。
   - 豆包缺 key 时抛明确错误；MiniMax 仍用 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_LLM_MODEL`，行为不变。

3. **V5 prompt 变体**（`src/agent/visitor/visitor.prompts.ts`）
   - `renderSystemPrompt(..., variant = 'shared')`；`shared` 输出逐字不变。
   - `seed-v5` 追加 `SEED_V5_VISITOR_CONSTRAINTS`：零抽象标签、接触防御（每 2 轮至少回应 1 轮）、具体情绪 + 身体感受/行为冲动、不把情绪翻译成领悟、不设计“防御—领悟—松动”治疗弧线。
   - 不硬枚举 emotion；V5.1 的标签硬枚举已在 AF-244 实测否决。

4. **生产接线**（`src/agent/visitor/visitor.service.ts`）
   - 构造注入 `ConfigService`，启动解析一次 `runtime`。
   - `streamChat` 传 per-call `provider` 与豆包模型；`buildLlmMessages` 传 `promptVariant`。

5. **部署契约**（`.env.example`）
   - 新增 `VISITOR_LLM_PROVIDER=minimax`、`VISITOR_PROMPT_VARIANT=shared`、`VISITOR_DOUBAO_MODEL=doubao-seed-character-260628` 与回滚说明。
   - 补一条生效的 `LLM_DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`（AF-248 起 LlmService 按本键拼端点；此前模板里只有注释行）。

6. **新增测试**
   - `test/agent/visitor-runtime-config.spec.ts`：默认值、显式开启、模型覆盖、空串回落、非法值抛错、缺 key 抛错，6 例。
   - `test/agent/llm-endpoint.spec.ts`：MiniMax 补 `/v1`、已带 `/v1` 不重复、豆包拼 `/chat/completions`、误带后缀先剥离，4 例。
   - `test/agent/visitor-prompt-v5.spec.ts`：默认不含 V5 段、`seed-v5` 含三条核心约束、不带影子实验术语，3 例。

## 关键设计决策

- **默认关闭**：不配 env 时 `minimax + shared`，与 AF-247 生产行为逐字一致；灰度与回滚都只改 env，不改代码。
- **fail-fast 而非回退**：非法 provider、非法 variant、doubao 缺 key 都在启动期抛错。灰度开关“看起来开了、实际没生效”比启动失败更难排查。
- **不改全局 `MINIMAX_*`**：豆包路由是 per-call 分支，只影响 visitor 显式传 provider 的调用；其他走 `LlmService` 的业务保持 MiniMax。
- **prompt 变体只做行为约束**：V5 段不枚举 emotion、不出现 V4/V1/V2 影子实验术语，避免生产模型把实验语义当指令。

## 与任务单的偏差

| 项 | 任务单 | 实际 | 理由 |
| --- | --- | --- | --- |
| runtime 解析入参 | 未指定 | 从 `read(key)` 回调改为 env 原始值快照 `VisitorRuntimeSource` | 首轮全量测试暴露 WP25 AST 断言看不到回调里的 env 键（`VISITOR_*` 被判定“模板有、代码不读”，`LLM_DOUBAO_BASE_URL` 被判定“代码读、模板没有”）；改快照 + 生产端字面量 `config.get('KEY')` 后 24/24 通过 |
| `.env.example` | 登记三个 visitor 键 | 另补一条生效的 `LLM_DOUBAO_BASE_URL` | 该键现在被 `LlmService` 真实读取，模板里只有注释行会让部署方配不上；补生效行同时满足 WP25 双向断言 |

## 闸门（真实输出）

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/agent/visitor-runtime-config.spec.ts test/agent/visitor-prompt-v5.spec.ts test/agent/llm-endpoint.spec.ts` | exit 0，3 files / 13 tests 全通过 |
| 定向 lint | `pnpm exec eslint <本次触碰的 9 个文件>` | exit 0（首轮 4 prettier + 2 import/order，`eslint --fix` 后复跑 0） |
| 全量 lint | `pnpm lint` | exit 0，0 error / 0 warning |
| CI 同口径 typecheck | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0，0 error（日志 `data/af248-tsc-full.log`） |
| 全量测试 | `pnpm test` | exit 0，256 passed + 1 skipped（257 files），4235 passed + 4 skipped（4239 tests）（日志 `data/af248-fulltest.log`） |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core` | 空 |

首轮全量测试曾出现 2 个 WP25 env 覆盖失败（`VISITOR_LLM_PROVIDER` / `VISITOR_PROMPT_VARIANT` / `VISITOR_DOUBAO_MODEL` 被判“模板有、代码不读”，`LLM_DOUBAO_BASE_URL` 被判“代码读、模板没有”），按上表偏差项修复后复跑全绿。

## 未做 / 遗留

- 未做真实豆包 Seed Character 生产 smoke：本单只保证开关与 prompt 变体可控，不证明生产可用。开灰度前需单独做一次带 `VISITOR_LLM_PROVIDER=doubao` + 真实 key 的端到端对练 smoke。
- 未处理未知 emotion 标签（如 `[emotion:anxious]`）：生产语义层只认 `sad|calm|fearful|angry|happy`，未知标签会被丢弃并记 warning。AF-244 已判定“prompt 硬枚举”不可行，应在投影层归一化或剥离，另开任务。
- 未定义生产灰度量级、观察指标与停止条件。当前默认关闭，灰度策略需与真实督导/双标计划一起定。
- 未做真人双标；V5 结论仍建立在 AI 盲评 + 三轮稳定性上。

## commit message

`feat(af248): 生产 visitor 豆包路由与 V5 prompt 开关`
