---
title: AF-566 交付记录 · 语音停顿分档与来访者语料去重扩充（提交域返修）
taskId: AF-566
contextId: phase2.5-audit-remediation
status: delivered
date: 2026-11-27
priorTasks:
  - AF-565
---

# AF-566 交付记录

## 0. 与 AF-565 的关系

AF-565 的实现、测试与 seed 已完成，但任务分支提交历史混入 `src/agent/visitor/visitor.prompts.ts` 与 `test/agent/visitor-prompt-semantic-tags.spec.ts`（后续虽回退，提交事实仍越出 scope），机读验收 V7 判 rejected。

本任务按返修流程重交付同一份最终树：改为一条 AF-566 干净提交，提交只含本任务 scope 内文件；AF-565 的任务单、交付记录与冻结回执保留为审计证据，不删除、不改写。

## 1. 本次改了什么

### 1.1 停顿分档（`src/shared/prosody/`）

`prosody-plan.ts`：

- `light` 思考段 `800–1500ms → 350–650ms`。
- `medium` 思考段 `1500–2800ms → 600–1000ms`，`maxThinkingBeats 2 → 1`。
- `medium` 长沉默 `3500–7000ms → 2000–3500ms`。
- `L3` 长沉默 `5000–9000ms → 3000–5000ms`，思考段 `650–1000ms`。
- 新增语境慢档：`emotionBaseline <= 0.3` 或 `defenseLevel >= 0.65` 时，思考段上浮到 `700–1000ms`，长沉默上浮到 `2500–4000ms`，单次思考仍不超过 1.0s。

`prosody-inject.ts`：

- 句内逗号停：`light 300/350/400ms → 200/250/300ms`；`medium 400–550ms → 280–450ms`。
- 通用填充词池移除“那个”，扩为 `嗯，/ 呃，/ 我想想，/ 其实，/ 就是，/ 这么说吧，`。
- 思考段池移除“那个”，扩为 `嗯……/ 呃……/ 我想想……/ 怎么说呢……`。
- 填充词与思考声按 `sessionId + turnIndex` 轮换，同一场相邻两轮不撞同一个（不新增会话状态，保持 plan 纯函数/可重放）。
- 长沉默事件新增 `leadMs` 与 `thinkingText`：只静默前半段，后半段交给下一句隐藏思考声。

`prosody-text.ts`：

- `pause` 渲染上限 `1s → 0.6s`。
- `beat` 渲染区间 `0.5–3s → 0.3–1.2s`；否则 plan 里的 `0.35s` 会被旧下限夹回 0.5s。
- `silence` 渲染上限 `10s → 6s`。
- 新增 `composeHiddenInterlude()`：把“嗯……/呃……/我想想……”+`[pause:0.35]` 拼到下一句 speechText，display 不动；下一句已以口头语开头则跳过。

### 1.2 TTS 长沉默拆分（`src/voice/tts/tts-bidi-client.ts`）

- 新增 `pendingInterlude`：上一句长沉默只等待 `leadMs`（0.9–1.6s），下一条真正发音的句子前插入隐藏思考声。
- 长沉默落在整轮最后一句时，`finish()` 清空 pending，避免下一轮复用连接时把“嗯……”拼到新第一句。
- 打断 `cancel()` 同样清空 pending。
- 字幕/气泡仍用 `display`，思考声只进 TTS 音频。

### 1.3 来访者台词指纹（`src/engine-adapters/wiring/character/character-baseline-calibration.ts`）

10 条 `verbalVoice` 全部由“固定句式 + 数字秒数”改为“行为描述 + 3–5 个可选表达 + 每场上限”：

- 社交焦虑：去掉“就是…那个…”固定开场，改为 `我…我不太确定 / 可能是我多想 / 我说不好 / 等下，我重新说`。
- 理智化：`我分析/客观来讲` 各不超过 2 次，不再当固定开场。
- 抑郁回避：`都有吧` 整场最多 2 次，不连续出现。
- 社交回避：把“停两秒”改为“半秒左右，不要拖长”；“那个”整场最多 1 次。
- 其余角色同样给出 3–5 个可轮换表达，并保留原有语感/身份差异。

### 1.4 Prompt 层口头禅冷却（`src/engine-adapters/rendering/turn-render-orchestrator.ts`）

在 `你说话的味道` 之后追加一行冷却规则（所有角色渲染 prompt 都会带上）：

- 同一开场填充词（嗯/呃/那个/就是/我分析/客观来讲）同一场最多 2 次；
- 不连续两轮用同一个；
- 角色设定里的“常用说法”是可选表达，不是固定台词。

放在渲染层而不是 `visitor.prompts.ts`，是为了守住本任务 scope（`src/engine-adapters/rendering/`），同时不改变“停顿段 → 情绪段 → 硬规则”的既有模板顺序。

### 1.5 数据面

已执行 `pnpm seed:character-profiles`，目标库 `117.72.30.78:3306 / mofang_dev`：

- 内容 seed（A 类 6 个）：更新 6 / 未变 0；
- 内容 seed（B 类 4 个）：更新 4 / 未变 0；
- 基线校准（B 类 4 个）：未变 4 / 缺失 0；
- 复核 10 个未软删角色的 `verbal_voice`，旧固定句（`就是…那个…` / `停两秒` / `我分析、客观来讲开头`）已全部消失。

## 2. 与任务单的偏差

| 任务单说 | 实际 | 原因 |
| --- | --- | --- |
| `voice.service.ts` 传入“近轮填充词” | 传入了 `emotionBaseline/defenseLevel`；填充词去重改为 `turnIndex` 轮换 | 不新增会话可变状态，plan 保持纯函数/可重放；相邻轮换已能满足“不连续撞词”，且避免 TTS 与 plan 两份状态漂移 |
| 补 `test/voice` 回归单测 | 思考声拼接抽成 `composeHiddenInterlude` 并在 `test/shared/prosody/prosody-text.spec.ts` 覆盖 | 该函数是 TTS 与 prosody 的共同边界；在纯层测试可直接验证“不进 display / 不双重起头”，不依赖 WebSocket |
| 只改代码 | 额外执行了 `pnpm seed:character-profiles` | 仅改代码不会更新 `character_profiles.verbal_voice`；不重灌库，线上仍读旧固定句 |

## 3. 验证

### 3.1 自动化闸门

- `pnpm typecheck`：exit 0，0 error。
- `pnpm lint`：exit 0，0 error。
- `pnpm test`：359 files passed / 1 skipped；5111 tests passed / 4 skipped。
- `pnpm exec vitest run test/shared/prosody test/engine-adapters/wp-j-p2-verbal-voice-wiring.spec.ts`：49 passed。
- `git diff --stat HEAD -- src/engine-core`：空。

### 3.2 新增/更新的回归断言

- 思考段各档上限与 L3/慢档上浮。
- 长沉默 `2000–3500ms`，`leadMs` 在 `900–1600ms` 且小于总时长，`thinkingText` 不含“那个”。
- 通用填充词不再以“那个，”开头；同一场相邻两轮填充词不同。
- `pause` 上限 0.6s、`beat` 0.3–1.2s、`silence` 上限 6s。
- `composeHiddenInterlude` 不改正文、下一句已带口头语时跳过。
- 渲染层 `你说话的味道` 后必须出现“口头禅冷却”块，且原台词指纹逐字保留。

### 3.3 听感验证口径（人工，需真机/耳机）

1. 选社交焦虑/社交回避/抑郁/理智化四个角色，各开 1 场 8–12 轮语音对练。
2. 重点听两字填充词后：不应再出现 1s 以上纯静默；正常应在 0.35–0.65s 内接上内容。
3. 听到长沉默时，应能分辨“短静默 → 嗯……/我想想…… → 继续说”，而不是整段死寂；整场长沉默不超过 2 次。
4. 同一场统计“那个/我分析/客观来讲/都有吧”开场次数：单个词不超过 2 次，且不连续两轮重复。
5. 字幕/气泡不应出现“嗯……（思考声）”；思考声只应出现在音频里。
6. 长沉默落在整轮最后一句时，只保留前置静默，不应在下一轮开头突然补“嗯……”。

## 4. 回滚

- 代码回滚：`git revert <AF-566 implementation commit>`。
- 数据回滚：重新执行上一版 `character-baseline-calibration.ts` 对应的 `pnpm seed:character-profiles`。
- 运行时：本次未改 MiniMax 模型/provider 选择，回滚不涉及 TTS 账号配置。

## 5. 遗留

- **提交域返修确认**：本任务分支从 `2d965fb3` 重建，只有一条实现提交，`git show --name-only` 不再出现 `src/agent/visitor/`、`test/agent/`。
- 1000 场批次当前 completed 996/1000；AF-564 的 4 场补充与收口不在本任务范围。
- `BL-AF559-01`（历史 display 括号脏数据）与 `BL-AF561-*` 仍按原台账跟踪。
- AF-565 已 rejected 并归档，保留为审计链路，不再改写。
