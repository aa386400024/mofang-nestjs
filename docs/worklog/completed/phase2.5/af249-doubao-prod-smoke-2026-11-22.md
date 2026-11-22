# AF-249 · visitor 豆包 Seed Character 生产链路 smoke（真实 API，一次）

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-249/task-sheet.md`
- 基线：`18881783605bd7f868581ee29411ba3770de78ae`（AF-248 合并后的 integrate）
- 分支：`task/AF-249-visitor-doubao-smoke`
- 日期：2026-11-22

## 做了什么

新增 `bin/visitor-doubao-smoke.ts`，作为灰度前/发版前的人工生产链路证据：

1. 只读加载项目根 `.env`（`dotenv`），不打印任何密钥。
2. 用**生产 `LlmService`** 的 per-call `provider: 'doubao'` 发起一次短请求，走真实端点拼接 `buildChatEndpoint()`，而不是另写一套 fetch。
3. 默认模型 `doubao-seed-character-260628`，可用 `--model` / `VISITOR_DOUBAO_MODEL` 覆盖；`--max-tokens` 默认 160，`--timeout-ms` 默认 45s。
4. 汇总所有流式 chunk：记录正文、usage、finishReason、error；有 error chunk 或空正文时按诊断退出码失败。
5. 输出只保留模型、耗时、字符数、finishReason、usage 与前 80 字预览；完整正文和密钥都不落盘。

为什么不做成单测：真实 API 需要有效 key、会计费、会受额度与网络影响，CI 必须离线可复现。本脚本只在人工/发布前跑一次。

## 真实调用结果

命令：`pnpm exec tsx bin/visitor-doubao-smoke.ts`

```json
{
  "ok": true,
  "provider": "doubao",
  "model": "doubao-seed-character-260628",
  "elapsedMs": 970,
  "chars": 35,
  "finishReason": "stop",
  "usage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 },
  "preview": "就那样吧，躺床上翻来覆去一两个小时才能睡着。[emotion:sad]"
}
```

日志侧证据：`[first_token] latency_ms=649`、`[stream_done] attempts=1 total_ms=970 first_token_ms=649 chars=35`。完整日志在 `data/af249-smoke.log`（untracked）。

结论：**AF-248 的生产接线真实可用**——key 有效、模型已开通、端点拼接正确、SSE 流式正常、`doubao-seed-character-260628` 能按来访者口吻输出并带合法 `[emotion:sad]` 标签。

## 发现的新问题

**流式 usage 全为 0**。豆包 SSE 响应没有回 `usage` 字段，`LlmService.parseSseLine()` 只在上游带 usage 时才累加，于是本次 `promptTokens/completionTokens/totalTokens` 都是 0。

影响：若 visitor 灰度切到豆包，现有 session cost 汇总会把豆包 token 记成 0，成本看板与预算闸门失真。这不是 smoke 脚本的问题，是生产 provider 的计量口径问题。

建议下一步（另开任务）：

- 在豆包请求体加 OpenAI 兼容的 `stream_options: { include_usage: true }`，或在流结束后补一次非流式 usage 查询；
- 若火山方舟不支持 `include_usage`，则改为按返回文本长度估算并在 cost 记录里显式标 `costBasis: 'estimated'`，不能静默记 0；
- 用同一条 smoke 复验 usage 非 0。

## 闸门（真实输出）

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 真实生产 smoke | `pnpm exec tsx bin/visitor-doubao-smoke.ts` | exit 0；970ms / 35 chars / finishReason=stop / 无 error chunk |
| 定向 lint | `pnpm exec eslint bin/visitor-doubao-smoke.ts` | exit 0（首轮 1 个 no-unnecessary-type-assertion + 3 import/order，修复后 0） |
| 全量 lint | `pnpm lint` | exit 0，0 error / 0 warning |
| CI 同口径 typecheck | `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0，0 error（日志 `data/af249-tsc.log`） |
| 全量测试 | `pnpm test` | exit 0，256 passed + 1 skipped（257 files），4235 passed + 4 skipped（4239 tests）（日志 `data/af249-fulltest.log`） |

## 未做 / 遗留

- 只验证了单轮短回复，没有验证长对话、多轮记忆、V5 prompt 在真实豆包上的稳定性；这些需要灰度观察或另做多轮 smoke。
- 没有验证并发/限流/超时；单次调用不能代表生产峰值行为。
- usage 计量缺口见上，需另开任务修。
- 未做真人双标；本次只证明链路连通与输出形态，不证明临床质量。

## commit message

`feat(af249): 新增 visitor 豆包生产链路 smoke`
