# AF-250 · 豆包流式 usage 计量修复（stream_options.include_usage）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-250/task-sheet.md`
- 基线：`f88579f8807dbaaea961d86abc2049e30bfabecb`（AF-249 合并后的 integrate）
- 分支：`task/AF-250-doubao-stream-usage`
- 日期：2026-11-22

## 根因

AF-249 真实 smoke 显示豆包 `usage` 全 0。火山方舟 Chat API 文档明确：**流式调用默认不统计 token 用量**，`stream_options.include_usage` 默认 `false`；只有设为 `true`，才会在 `[DONE]` 前额外返回一个 `choices=[]`、`usage` 非空的 chunk。`LlmService` 的 `parseSseLine()` 本来就能接住任意带 `usage` 的 chunk，缺的只是请求侧开关。

## 做了什么

1. `MiniMaxChatRequest` 增加可选 `stream_options?: { include_usage: boolean }`（命名沿用 OpenAI 兼容口径）。
2. `executeStream()` 仅在 `provider === 'doubao'` 时下发 `stream_options: { include_usage: true }`；MiniMax 请求体逐字不变。
3. 新增 `test/agent/llm-doubao-usage.spec.ts` 3 例：
   - doubao 请求体含 `stream_options.include_usage=true`；
   - 模拟末尾 `choices=[] + usage` chunk，断言正文正常流出且 `done` chunk usage = 100/20/120；
   - minimax 请求体不含 `stream_options`。
4. 复用 AF-249 的 `bin/visitor-doubao-smoke.ts` 做真实复验，不新建一次性脚本。

## 真实复验

命令：`pnpm exec tsx bin/visitor-doubao-smoke.ts`

```json
{
  "ok": true,
  "provider": "doubao",
  "model": "doubao-seed-character-260628",
  "elapsedMs": 848,
  "chars": 43,
  "finishReason": "stop",
  "usage": {
    "promptTokens": 93,
    "completionTokens": 24,
    "totalTokens": 117,
    "reasoningTokens": 0
  },
  "preview": "就那样吧，该睡的时候睡不着，不该睡的时候又困得要死。[emotion:anxiety]"
}
```

对比 AF-249：`usage` 从 全 0 → `93 / 24 / 117`，`finishReason` 仍为 `stop`，正文 43 字，首 token 413ms、总耗时 848ms。说明 usage chunk 在 `[DONE]` 前被正确接收并落入 `done`。

## 顺带发现

真实输出带 `[emotion:anxiety]`，而生产 `semantic-tag-parser` 的 `SemanticEmotion` 只认 `sad|calm|fearful|angry|happy`，`anxiety` 不是合法值，会被记 `TAG_UNKNOWN` 并从 `ttsText` 剥离。这正是 AF-248 交付记录里登记的 `unknown-emotion-tag-projection` 缺口；本单不扩围，继续留作独立任务。

## 闸门（真实输出）

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/agent/llm-doubao-usage.spec.ts` | exit 0，1 file / 3 tests 全通过 |
| 真实复验 | `pnpm exec tsx bin/visitor-doubao-smoke.ts` | exit 0，usage.totalTokens=117 > 0 |
| 全量 lint | `pnpm lint` | exit 0，0 error / 0 warning |
| CI 同口径 typecheck | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0，0 error（日志 `data/af250-tsc.log`） |
| 全量测试 | `pnpm test` | exit 0，257 passed + 1 skipped（258 files），4238 passed + 4 skipped（4242 tests）（日志 `data/af250-fulltest.log`） |

## 未做 / 遗留

- 只修了用量回传，没有改 session cost 的计价逻辑；豆包单价与 MiniMax 不同，成本汇总仍需按 provider 分账（现有 `session_cost_summary` 只按 token 算，模型单价来源需核对）。
- `reasoningTokens=0` 是上游给出；Seed Character 非推理模型，属正常。
- 未做多轮/长对话 usage 复验；单轮已证明协议正确。
- 未知 emotion 投影仍未处理，见上。

## commit message

`fix(af250): 豆包流式请求启用 include_usage 修复 token 计量`
