# WP-J P1d · 路线1 三处结构修复的遗留问题修复

> 状态：✅ 已完成（2026-11-10）→ 交付记录：[`wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md`](./wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md)
> 日期：2026-11-10
> 执行方：MiniMax Code（后端仓库 `mofang-nestjs`，分支 `integrate`，基线 HEAD `3e9646f`）
> 性质：**修复任务** —— P1c 交付记录 §八 遗留清单里的 #1/#2/#4/#5/#6/#7 六项

---

## 一、背景

P1c 验证完路线1 三处结构修复后，在交付记录 §八 列了 7 条遗留问题。其中 #3（上游 Token Plan 429 限流）确认是账号问题，**不改代码**；其余六项本期全修。

**六项的问题性质分三类**：

| 类 | 问题 | 后果 |
|---|---|---|
| 死代码 | #1 `attachmentStyle` 三处漏传 | anxious 行为通道**从来没生效过**（`spec.attachmentStyle` 恒 undefined） |
| 建了没人写 | #2 `llm_call_turns` / `render_fallback_turns` 落库 | 批次有效性门禁**永久 `valid:false`** |
| 口径/质量 | #4 词表、#5 degraded 口径、#6 日志脱敏、#7 深度约束 | 指标说不清 / 凭据泄漏 / 复述冒充新信息 |

## 二、任务要求（大炮原话要点）

**#1 P0・attachmentStyle 接线（anxious 通道死活，最关键）**

- `EngineTurnService.open()` options 加 `attachmentStyle?: string`
- `openKernelSession()` 从 character profile 读并登记进 kernel session
- `TurnRenderOrchestrator.assemble()` 透传 `context.attachmentStyle`
- 验证：grep 全链路至少 3 个写入点；起 3100 临时实例确认 anxious 行为指引文案真的进了 prompt（debug 日志，**不打台词原文**）。**必须加单测**。

**#2 P1・llm_call_turns / render_fallback_turns 落库**

- 在 `practice-runner.service.ts` 的 `updateSessionResult()` 落：`llm_call_turns` = 本场真实 LLM 调用轮数（不是 maxTurns）；`render_fallback_turns` = degraded 轮数
- 验证：跑 1 场查 DB 非零；`validity_flags` 不再永远是 `LLM_CALL_RATIO_LOW`。**必须加单测**。

**#4 P1・audit 词表补 anxious 三维**

- `visitor-quality-audit.ts` 的 `LABEL_LEXICON` 覆盖率 5.7% 太低，加求证 / 讨好 / 怕被抛弃三个维度词表，覆盖率到 15%+。

**#5 P2・degraded 口径对齐**

- DB `degraded_turns` 跟 audit 数 traces 不一致（r2 上 4 vs 1）。以 runner 落库为准，audit 读 DB 不自己数。

**#6 P1・admin 日志脱敏 Authorization（安全问题，从 P2 提上来）**

- basic auth 凭据原样打日志，base64 可还原。日志拦截器加 hook，`authorization` 头打 `***`。

**#7 P2・信息增量判据补"深度"约束**

- 现在"复述"也算"给了新信息"，导致 stagnant 消了但 recounting 53.9%→80.9%。在 engine-adapters 层的 prompt 模板补一条："新信息必须向情感体验（affective）或认知反思（cognitive）方向推进，单纯复述事实不算"。**不碰 engine-core 内核**，只改外层 prompt。

## 三、硬约束

- 不碰 `src/engine-core/**`（BDI 内核，红线）
- 不自动 git commit / push
- 不碰 `quality_annotation` 表（用户正在标 30 场）
- 3000 端口用户服务不动，验证用 3100 临时实例，跑完关掉
- 闸门：`npx tsc -p tsconfig.build.json --noEmit` 0 错、`npx eslint` 0 错、`npx vitest run test/auto-practice` 全绿
- #1 #2 必须加单测覆盖
- 心理内容不进日志

## 四、交付物

`docs/worklog/completed/phase2.5/wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md`，含每个问题的：根因文件行号、修法 diff 摘要、验证数字（闸门 / 单测结果 / DB 实查 / 临时实例验证）、遗留问题。

## 五、关联文档

- 前序：[`wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md`](./wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md)
- 交付后的验收/重跑方案：`docs/worklog/pending/phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md`
