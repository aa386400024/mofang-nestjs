# AF-129 交付记录 · 长会谈开场知情框架与结束收束纪律

- **任务**：AF-129（承接 AF-126 重签发）
- **类型**：implementation
- **角色**：executor → 本机主控直接实现（dispatch `gui-relay` 仅生成交接件，未实际发送 MiniMax）
- **基线**：`873f3f9660e6eea021f9fbe8553b672604cabbeb`
- **日期**：2026-11-19
- **结论**：**实现完成，结构单测全绿；本单不宣称临床质量达标，AI 层面是否达标待 AF-130 同口径复评。**

## 1. 改了什么

### 1.1 新增开场知情框架

`src/auto-practice/counselor/builder/prompt-sections/opening-framework.ts`

- 新 prompt 块 `## 开场知情框架`，`order=25`；
- 仅在 `profile.targetTurnsBand !== null`（standard / long）启用；legacy 关闭；
- 要求前 3 轮内用自然口语覆盖五件事：
  1. **保密与例外**：保密、不会告诉别人；自伤/自杀、生命危险、法律要求时联系相关的人或机构保护来访者；
  2. **设置边界**：约定、咨询框架、边界、不评判、不指责、不能替来访者决定；
  3. **时长与频率**：每次约 50 分钟、每周一次、可商量调整；
  4. **可暂停与可拒答**：随时喊停/暂停、可以拒绝、可以跳过、不用勉强；
  5. **录音与知情同意**：说明是否录音、本次不录音、以后录音/录像先征得同意。
- 明确“像真实咨询师开场，不要念条款”；危机时先安全评估与稳定化，再补框架。

### 1.2 长会话收尾纪律补三要素

`src/auto-practice/counselor/builder/prompt-sections/close-discipline.ts`

- 保留原有“不得早于 `minTurnsBeforeClose` 输出 END”的纪律；
- 新增“收尾必须做满三件事”：
  1. **总结本次理解**：用“我听到 / 我的理解”复述核心议题，并明确“我们总结 / 回顾一下”；
  2. **来访者带走的内容**：一句可以带走的话、一个可以记住的点，或一张可以写下来的卡片；
  3. **下一步安排**：下次时间、回去可以试着做的小行动，或接下来的方向；
- 明确三项要自然落在正文，不能只输出 `END`；不伪造来访者发言，不用空洞共情拖轮次。

### 1.3 接线与指纹

- `counselor-prompt-builder.ts`：在静态纪律块之后、危机稳定化与长会话收尾纪律之前接入 `sessionOpeningFrameworkSection(profile)`；
- `prompt-fingerprint.ts`：
  - `PROMPT_TEMPLATE_FILES` 增加 `counselor/builder/prompt-sections/opening-framework`；
  - `resolveFingerprintSource` 从“只看当前模块 dist 是否存在”改为“dist 必须完整覆盖当前模板清单”；新增模板尚未 build 时整体回退源码口径，避免 `computePromptVersion()` 静默 `unknown`。这是本单在开发期可验证 prompt_version 的必要修复。

### 1.4 测试

`test/auto-practice/counselor-prompt-builder.spec.ts`

新增 6 例：

- legacy 隐式与显式档案输出逐字一致，且不含开场框架 / 长会话收尾纪律；
- long 档包含开场五要素关键词；
- standard 档同样启用；
- 长会话收尾包含总结 / 带走 / 下一步，且写“第 35 轮之前不得输出”；
- 开场块 legacy 关闭、standard/long 启用；
- `PROMPT_TEMPLATE_FILES` 包含 opening-framework，`computePromptVersion()` 非 `unknown`。

## 2. 闸门证据

| 闸门 | 实际命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/auto-practice/counselor-prompt-builder.spec.ts test/auto-practice/prompt-version.spec.ts` | 0 | 2 files / **19 tests passed** |
| 类型检查 | `pnpm exec tsc --noEmit` | 0 | **0 error** |
| lint | `pnpm lint` | 0 | **0 error / 0 warning** |
| engine-core 零 diff | `git diff --stat -- src/engine-core` | 0 | 空输出 |
| 任务单 schema | `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af129-opening-framework-closeout-task-2026-11-19.md` | 0 | 通过 |

日志：

- `C:\Users\Admin\AppData\Local\Temp\af129-vitest3.log`
- `C:\Users\Admin\AppData\Local\Temp\af129-tsc.log`
- `C:\Users\Admin\AppData\Local\Temp\af129-lint.log`

## 3. 与任务单的偏差

| 项 | 任务单 | 实际 | 说明 |
| --- | --- | --- | --- |
| 任务编号 | AF-126 | AF-129 | 原 AF-126 `agentRole: orchestrator`，与 src scope 资源域冲突；按框架 `task reissue` 重签发为 executor，scope 未原地改写 |
| 指纹修复 | 只要求纳入 opening-framework | 另加 dist 完整性检查 | 不加则开发期 `computePromptVersion()` 直接 `unknown`，单测无法验证；改动在 `prompt-fingerprint.ts` 既有职责内 |
| 16 packet 复评 | 本单不做 | 本单不做 | 新 prompt 需要新批次，另立 AF-130 验证任务 |

## 4. 未完成 / 下一步

- 本单只证明“prompt 结构已补齐”，**不证明模型实际会照做**；
- 下一步 AF-130：用 `sessionProfile=long` 生成新的 16 场批次，跑 AF-127 结构审计，再用 AF-125 同口径 `ai-proxy-v2` 评分；
- 在新批次结构审计出来前，出口④仍保持“未通过 / 不可判定”，不提前改写为达标。
