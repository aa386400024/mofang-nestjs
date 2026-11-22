# 豆包来访者切流预案（2026-11-22 · AF-263）

## 适用边界

本预案覆盖**来访者模拟器**从 MiniMax 主候选切到 `doubao-seed-character-260628`。`VISITOR_LLM_PROVIDER` 是总开关：旧 `VisitorService` 与引擎渲染路径一起切，避免同一开关只覆盖一条链路。

不覆盖：咨询师侧 LLM、评分模型、Lily/督导链路。

## 前置条件

1. `LLM_DOUBAO_API_KEY` 已配置且有效（火山方舟控制台可查）。
2. `VISITOR_DOUBAO_MODEL` 指向已开通模型；缺省为 `doubao-seed-character-260628`。
3. 引擎渲染备候选为 `minimax`；`VISITOR_LLM_PROVIDER=doubao` 且未显式配 `ENGINE_RENDER_FALLBACK_PROVIDERS` 时，`RenderConfigFactory` 会自动补 `minimax`。
4. 以下真实 smoke 全绿：
   - `pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 6`
   - `pnpm exec tsx bin/visitor-render-smoke.ts --caller router --provider doubao --turns 20`
5. `pnpm exec tsx bin/visitor-switch-check.ts` 输出 `primary=doubao`、备候选 `minimax`。

## 切换步骤

1. 备份环境文件（示例）：
   ```powershell
   Copy-Item .env data/env-backup-$(Get-Date -Format yyyyMMdd-HHmm).env
   ```
2. 写入两行：
   ```dotenv
   VISITOR_LLM_PROVIDER=doubao
   VISITOR_DOUBAO_MODEL=doubao-seed-character-260628
   ```
3. 跑开关自检：
   ```powershell
   pnpm exec tsx bin/visitor-switch-check.ts
   ```
   必须看到 `engineRender.candidates[0].id=doubao`、`fallbackProviders=["minimax"]`。
4. 重启服务使 env 生效（本任务未自动重启；由部署方在维护窗口执行）。
5. 重启后跑一轮真实对练，确认来访者发言来自豆包而非兜底句。

## 观察指标（灰度首日）

| 指标 | 口径 | 建议阈值 |
| ---- | ---- | -------- |
| 首 token 延迟 P95 | `ttftMs` | ≤ 2000ms |
| 单轮完成延迟 P95 | `elapsedMs` | ≤ 5000ms |
| 空输出率 | 渲染结果 `text` 为空 | 0 |
| 降级率 | `degraded=true` | 0 |
| 备候选回退率 | `fallbackUsed=true` | ≤ 2% |
| 伦理 guard 拦截率 | `guardVerdict.level != pass` | 与 MiniMax 基线同量级 |
| 单场成本 | `session_cost_summary.estimatedCostCny` + `providerBreakdown` | 与预算对比 |

## 停止条件

出现任一条即回滚：

- 连续 10 轮出现空输出或 `degraded=true`。
- 备候选回退率 > 5%，或豆包 429/5xx 持续 5 分钟。
- 首 token P95 > 3000ms 且持续 10 分钟。
- 来访者回复出现明显角色崩坏、重复复读、脱离历史，且人工抽检确认。
- 成本超出当日预算 30%。

## 回滚

一行操作：

```dotenv
VISITOR_LLM_PROVIDER=minimax
```

重启服务后跑 `pnpm exec tsx bin/visitor-switch-check.ts`，确认 `primary=minimax`。旧 `VisitorService` 与引擎渲染会同时回到 MiniMax，不需要分别改。

## 已知缺口

- 豆包官方单价未内置，成本按全局价估算；需在 `LLM_PRICE_*_PER_1K_DOUBAO` 填入当期账单价。
- 未做并发、429/5xx、超时与回退注入 smoke。
- 20 轮 smoke 的 prompt 到 1356 token，长对话摘要 `sessionSummary` 触发点尚未覆盖。
- 真人双标评测仍留到上线补；当前质量判断依赖 AI 双轨与抽检。
