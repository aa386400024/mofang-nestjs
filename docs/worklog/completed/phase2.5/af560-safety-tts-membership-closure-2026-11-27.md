# AF-561 · 出口④安全收束门 + Max TTS 并发治理 + 会员 TTS 口径对齐

- 日期：2026-11-27
- 分支：`task/AF-561-safety-tts-membership-closure`
- 基线：`0268e96da68fa7697dba00cad3559ff120dc7eb9`

## 改了什么

### 1. 危机窗收尾必须先过安全内容门

`src/auto-practice/practice-runner.service.ts`

- 危机窗内**每一轮**咨询师正文都进入 `crisisSafetyTexts`，不再只收集 escalated 后的计划轮。
- 新增 `gateCrisisStopSafety`：五组安全要素不齐时：
  - 第一次不齐 → 标记 `safetyRepairPending`，挡回收尾，继续 1 个修复轮；
  - 修复轮后仍不齐 → `crisis_safety_incomplete` 结束，`crisisOutcome=incomplete`，不再伪装成 `safety_plan_completed`；
  - 补齐 → 正常 `crisis_practice_close` / `crisis_practice_max`。
- `crisisCloseBlocked` 同时覆盖 `postTurns=0` 与 `safetyRepairPending`，避免修复轮中途从自由收尾出口漏出。

对应 AF-529 复评里“披露了风险但全稿没有安全计划”的 packet-10/37 形态。

### 2. Max / 豆包 TTS 并发闸门

- 新增 `src/voice/tts/tts-session-limiter.ts`：provider 无关的并发上限 + FIFO 排队 + 超时拒绝 + shutdown 拒绝排队项。
- `src/voice/tts/tts.service.ts` 豆包分支先 `acquire` 再建连；建连失败或 `dispose` 幂等释放；退出时关闭闸门。
- MiniMax 既有 `TtsBidiPoolService` 行为不变。

### 3. 会员 TTS 对外口径

- `TtsModel` 增加 `Premium`。
- `MEMBERSHIP_PLANS` 中 Max 的 `ttsModel` 从 `hd` 改为 `premium`，与 TTS resolver 对 max 档解析 premium 的实际行为一致；Pro 仍 `hd`，Free/Plus 仍 `turbo`。

## 验证

- 定向 `test/auto-practice test/voice test/membership`：87 files / 1120 tests 全绿。
- 全量 `pnpm test`：359 passed + 1 skipped（360 files），5104 passed + 4 skipped（5108）。
- `pnpm typecheck`：0 error。
- `pnpm lint`：0 error。
- `pnpm build`：通过。
- `git diff --stat HEAD -- src/engine-core`：空。

## 偏差与说明

1. 豆包并发参数复用 `MINIMAX_TTS_MAX_CONNECTIONS` / `MINIMAX_TTS_ACQUIRE_TIMEOUT_MS`，未新增 env 键。原因：任务 scope 不含 `src/config` 与 `.env.example`，而仓库有“代码读取 env 必须在 .env.example 登记”的测试；复用既有 bidi 池参数可立即获得容量上限且不破坏该守卫。后续若需要独立调豆包容量，再单开配置任务。
2. AF-529 复评里 6 场 safety=2 并非全部是产品缺陷：packet-20/36/46 是“咨询师筛查提问/第三方担忧”触发评测封顶；packet-09 是 grief 场景被危机协议误升级。本任务只修产品侧出口，评测封顶口径与误升级另登记遗留。

## 遗留

- `BL-AF561-01`：评测安全封顶应只对“来访者本人风险披露”生效，当前对筛查提问/第三方担忧也封顶，导致 packet-20/36/46 假阴性（evidence: AF-529 复评）。
- `BL-AF561-02`：packet-09 grief 场景在第 38 轮被误判危机并走完整危机协议，需补误报样本与风险分类回归（evidence: AF-529 structure-audit）。
- `BL-AF561-03`：豆包 TTS 容量参数目前借用 MiniMax env 名，若后续独立运营需拆 `DOUBAO_TTS_MAX_CONNECTIONS` 并登记 `.env.example`。
