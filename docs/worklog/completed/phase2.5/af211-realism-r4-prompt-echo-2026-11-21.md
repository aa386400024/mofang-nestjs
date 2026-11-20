# AF-211 · 来访者真人度 R4 交付记录

日期：2026-11-21
基线：`e54012bfc3f7f01c36bf60695df7bfa775558dca`（AF-209 合并后 HEAD）
任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-211/task-sheet.md`

## 一句话结论

R4 完成两件治本的事：prompt 回显词表收成单一真相源并接入常开输出闸门；界面内容按场景判定，线上文字允许真实界面动作，面对面/语音仍硬拦。批次基线改为只统计“可朗读文本”，并单独保留原始审计口径，避免把推理块里的设定复述算成台词故障。

## 改了什么

### 1. prompt 回显常开拦截

- `src/shared/realism/visitor-register-audit.ts` 导出 `PROMPT_ECHO_MARKERS`，成为唯一词表。
- `src/shared/text/output-integrity.ts` 直接引用这份词表，不再维护第二份 `PROMPT_MARKERS`。
- 效果：`RENDER_REALISM_MODE=off` 时，模板标题回显也会被输出完整性闸门判 `prompt_marker`；不依赖真人度灰度开关。
- 新增定向测试：`test/auto-practice/af211-prompt-echo-guard.spec.ts`，逐条覆盖全部模板标记 + 整段角色设定回显。

### 2. 场景化语域

- `inspectVisitorRegister(text, { scene })`：缺省 `in_person`。
  - `prompt_echo` 与括号/星号舞台动作：所有场景硬拦。
  - 界面 chrome：`online_text` 放行；`in_person` / `online_voice` 仍判 `non_spoken_text`。
- `inspectVisitorRealism` 的 profile 增加可选 `scene`，`llm-render.adapter.ts` 把 `runtime.profile.scene` 透传进审计，避免运行时仍按默认场景判定。
- `visitor-realism-profile.ts` 的 `online_text` directive 改为：允许提到正在看对话、等回复这类真实动作，但不把界面操作写成旁白。
- 新增测试：`test/auto-practice/af211-register-scene.spec.ts`，覆盖三种场景、舞台动作、prompt 回显、审计链路透传与 prompt directive。
- 保留 R3 的“prompt 自身不出现界面词”约束：directive 只提到“看对话/等回复”，不把“聊天框”等界面词写回 prompt。

### 3. 可复算批次基线

- 新增 `src/auto-practice/metrics/visitor-realism-baseline.ts`：纯函数聚合，只输出数字与分类计数。
- 新增 `bin/visitor-realism-baseline.ts`：扫描 `data/debug-sessions`，输出 JSON 报告；不打印、不保存任何台词。
- 口径拆成两层：
  - **可朗读文本**：`stripReasoningBlocks` 后的文本，用来统计台词级硬违约、过长、口语事件、软信号；
  - **原始审计**：R3 的原始文本口径，单独保留，用来说明推理块会抬高计数，不作为台词质量结论。
- 报告字段包括：会话数、台词数、硬违约率、按类型/场景分布、软信号、过长率、六类口语事件密度、常开输出闸门命中、场景切片。
- 报告落在 `data/phase25-exit/af211-realism-baseline/report.json`（`data/` 已被 gitignore 覆盖，不入库）。
- 新增测试：`test/auto-practice/af211-realism-baseline.spec.ts`，覆盖计数、场景切片、过长阈值、分类全集、报告不泄漏台词、旧批次场景回落。

## 真实批次基线（360 场 / 11298 条 visitor 台词）

| 指标 | 可朗读口径 | 原始审计口径 |
| --- | ---: | ---: |
| 硬违约 | 15（0.13/100 轮） | 39（0.35/100 轮） |
| prompt 回显 | 10 | 34 |
| 不可朗读文本 | 5 | 5 |
| 过长台词（>3 句或 >260 字） | 317（2.81/100 轮） | 916（8.11/100 轮） |
| 六类口语事件 | 3963（0.35/轮） | 6163（0.55/轮） |
| 软信号 | 365（书面连接词 360、助手口吻 5） | — |
| 常开输出闸门 invalid | 121 | — |

常开闸门命中细分：`foreign_word 104`、`foreign_latin 43`、`english_reasoning 40`、`structured_output 19`、`prompt_marker 10`、`empty 13`、`json_object 8`、`json_array 1`、`reasoning_prefix 1`。

### 关键纠偏：34 条不是 34 条“说出口”的回显

对 34 条原始 `prompt_echo` 做了逐条复算：

- 32 条位于 `<think>` 推理块内，本身不是可见台词；
- 2 条是明文回显，标记均为 `关键事件：`；
- 去掉推理块后仍残留 prompt 回显的共 10 条。

因此此前“R3 识别 34、常开闸门只命中 9、约 25 条漏过”的判断不成立：绝大多数是推理块抬高了口径，真正可朗读的回显是 10 条。R4 后常开闸门对这 10 条全部判 `prompt_marker`；相对旧闸门的净增约 1 条（`关键事件：`），不是 25 条。

这个纠偏已固化进基线的双口径设计，后续批次不会再拿“原始文本计数”当台词质量结论。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向 8 文件 | 8 passed，97 tests passed |
| `pnpm typecheck` | exit 0，0 error |
| 全量 ESLint（src/test/bin，无缓存） | exit 0，0 error / 0 warning |
| `pnpm test` | 235 files passed + 1 skipped（236）；4075 tests passed + 4 skipped（4079） |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 与任务单的偏差

1. AF-210 因 `scripts/ops/quality/` 越出 executor 资源域取消并归档；AF-211 把基线 CLI 收到 `bin/`，功能不变。
2. 基线报告在任务单要求之外增加 `rawAudit` 与 `outputIntegrity` 两块：前者用于解释 R3 原始口径，后者用于观察常开闸门命中。仍只输出数字，不输出台词。
3. 未新增 env 键，未改变 `RENDER_REALISM_MODE` 默认 `off`；未触碰 `src/engine-core`。

## 遗留

- 现有 `data/debug-sessions` 全部是旧批次，场景层缺省，基线只能落 `in_person`；`online_voice` / `online_text` 切片要等新批次产生后再看。
- 121 条常开闸门 invalid 中，外语残片与结构化输出仍是主要项；R4 只保证 prompt 回显不漏，不处理外语/结构化生成质量。
- AI 双盲评分与 active 灰度仍留 R5，不在本单范围。
- 工作区存在此前批次遗留的 `data/phase25-exit/*`、`data/batch-reports/*` 与编排草稿，本单不清理、不纳入提交。

## commit message

`feat(af211): 收口 prompt 回显常开拦截与场景化语域，补真人度批次基线`
