# AF-214 · 来访者真人度 R5 交付记录

日期：2026-11-21
基线：`f32b62b4d290f4b0b9a382e762e593b4b04f906a`（AF-213 R4 合并后 HEAD）
任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-214/task-sheet.md`

## 一句话结论

R5 把“像不像真实来访者”从主观判断变成可复算的 AI 双盲评分协议，并对既有 360 场会话跑出第一份基线：**总体 3.46/5，自然度只有 2.75/5，是五维里唯一明显不及格的一项**；双评分员总体 ±1 一致率 100%、线性加权 κ 0.50，说明“自然度不足”不是单个评委的偏好，而是当前来访者文本的结构性短板。本报告是 AI 代理预评审，`humanSupervision=false`、`clinicalAcceptanceEligible=false`，不能写成临床质量达标。

## 改了什么

### 1. 五维真人度评分协议

新增 `src/auto-practice/metrics/visitor-realism-rating.ts`：

- 五维：自然度（naturalness）、情绪连续性（emotional_continuity）、话轮形态（turn_shape）、场景一致（scene_congruence）、关系在场（relational_presence）。
- 每维 1–5 分，带可观察行为锚点，不写“好/差”这种空话。
- 每个分数必须带 evidence：`turnIndex` + 从该轮来访者台词里原样摘出的 `quote`；定位不到、引到咨询师轮次、引用超过 120 字，一律判解析失败。
- 明确声明：`status=ai_proxy_candidate`、`humanSupervision=false`、`clinicalAcceptanceEligible=false`，并把“同模型双评分、AI 偏好、盲标残留线索、只评表层、不能替代督导师”写进 `AI_REALISM_LIMITATIONS`。
- `deriveRealismPacketId()` 用 session id + seed 做稳定哈希，报告里不出现 session id。

### 2. 去身份盲评包与分层抽样

新增 `src/auto-practice/metrics/visitor-realism-blind-pack.ts`：

- packet 只保留 `packetId / scene / 轮次`，不保留 `sessionId`、`characterSlug`、`characterLabel`、咨询师档位。
- 按场景分层轮转抽包，避免小场景被哈希排序整体饿死；同输入同 seed 完全可复算。
- 含 R4 硬违约（prompt 回显、不可朗读文本）的会话整场剔除，不把脏台词送进评分；剔除只输出计数，不输出原文。
- 旧批次没有场景字段时回落 `in_person`，与 R4 的默认口径一致。

### 3. 可执行的评分 CLI

新增 `bin/visitor-realism-blind.ts`：

- 读取 `data/debug-sessions`，先 dry-run 打印包体量与剔除计数，再调用评分模型。
- R1 证据优先（temperature 0.1），R2 整体叙事（temperature 0.5），分差 ≥2 才进 R3 仲裁；R3 只裁分歧维度。
- 评分员输出被截断或解析失败时最多重试一次；仍失败则计入 `failed` 表，不静默丢弃。
- 候选包按确定性顺序回填：目标 8 个有效 packet，失败一个就继续取下一个候选，直到达标或候选耗尽。
- 报告与日志不输出任何台词原文，只输出 packetId、分数、计数与失败原因。

### 4. 输出协议的关键决策：行协议优先，JSON 兼容

任务单原计划“评分员输出 JSON”。实跑发现 MiniMax-M3 会把大段 `<think>` 内联在 content 里，JSON 要么被长度上限截断、要么在推理块后根本不再输出；9 个包里 1 个直接失败、多个需要重试。因此评分协议改为**行协议优先**：

```
naturalness=4|2|嗯……不太好
emotional_continuity=3|4|胸口闷
...
overall=4
notes=整体能接住咨询师的话。
```

- 行协议更短、更不容易被模型写坏；
- `parseRealismRating()` 仍先尝试 JSON，失败再回退行协议，结构化 provider 不会被绑死；
- 证据校验、分数范围、仲裁规则在两种协议下完全共用。

## 真实 AI 双盲基线（360 场既有会话）

数据源：`data/debug-sessions`，360 个会话；排除 1 个来访者轮次不足、16 个含硬违约（prompt 回显 / 不可朗读文本），候选 343 个；旧批次全部无场景字段，场景切片只能落 `in_person`。

抽样结果：16 个候选包，按序评分到第 9 个达标；8 个有效、1 个因 R1 解析失败进失败表，失败包由后续候选回填。

| 指标 | 结果 |
| --- | ---: |
| 有效 packet | 8 |
| 总体均值 | 3.4625 / 5 |
| 自然度 | **2.75** |
| 情绪连续性 | 3.6875 |
| 话轮形态 | 3.0625 |
| 场景一致 | 3.9375 |
| 关系在场 | 3.875 |
| 双评分员 exact / ±1 | 62.5% / 100% |
| 总体线性加权 κ | 0.50 |
| 仲裁 | 0 个 packet 进入仲裁、0 个未决分歧 |
| 失败 packet | 1 / 9（R1 行协议解析失败） |

逐维一致性：

| 维度 | exact | ±1 | κ | 解读 |
| --- | ---: | ---: | ---: | --- |
| 自然度 | 0.75 | 1.00 | 0.692 | 两人都认为自然度偏弱，共识稳定 |
| 情绪连续性 | 0.875 | 1.00 | 0.714 | 共识稳定 |
| 话轮形态 | 0.625 | 1.00 | 0.556 | 有分歧但都在 1 分内 |
| 场景一致 | 0.875 | 1.00 | 0 | exact 很高但 κ=0，属分布集中下的 kappa paradox，应以 exact / ±1 为主 |
| 关系在场 | 0.75 | 1.00 | 0.692 | 共识稳定 |

### 这份基线说明什么

1. **自然度是当前最明确的短板**：2.75/5，和情绪连续性（3.69）、场景一致（3.94）差出接近 1 分；两个评分员在这个维度上一致率高、κ 也高，不是偶然低分。
2. **“像咨询室里的对话”已经基本成立**：场景一致 3.94、关系在场 3.88，说明 R3/R4 的场景语域与去 prompt 化起了作用；旧批次全员默认 `in_person`，线上场景还没被验证。
3. **话轮形态仍是“顺”而不是“真”**：3.06 分，说明短答、停顿、反问出现了，但分布仍偏均匀、偏模板化；这与 R2 的口语事件计划只做到“有事件”而未做到“事件随状态变化”一致。
4. **AI 双评分可以用，但不能当验收**：总体 ±1 一致率 100%，说明分歧主要在 1 分内；但 1/9 的解析失败率、同模型独立性不足、旧批次场景缺失，都决定了它只能做预评审与分歧发现。

### R6 建议（按优先级）

1. **自然度专项**：不要继续加“口语事件数量”，而要改“事件的条件分布”——同一角色在防御/松动/试探状态下的停顿长度、改口位置、短答比例必须有差异；把 R5 的自然度低分 packet 作为回归集，改完复算均值和 ±1 一致率。
2. **线上场景补样本**：当前 `online_voice/online_text` 切片为 0，必须先用 R4 的场景标签跑一批线上语音与线上文字会话，否则场景一致的高分只代表面对面。
3. **评分稳定性**：1/9 解析失败仍偏高；下一步把行协议再加一层“只输出 6 行、禁止 think”的硬约束，或换结构化输出 provider；失败率要压到 0 才能做灰度门禁。
4. **真人督导师到位后**：保留同一批 packet 与同一套锚点，让真人督导师双人盲标，直接算 AI vs 真人的一致率；这是唯一能把 `clinicalAcceptanceEligible` 翻成 true 的路径。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向 vitest（R5 2 文件 + R4 2 文件） | 4 files passed，41 tests passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint`（全量，带缓存） | exit 0，0 error / 0 warning |
| `pnpm test` | 239 files passed + 1 skipped（240）；4106 tests passed + 4 skipped（4110） |
| `git diff --stat HEAD -- src/engine-core` | 空 |

报告落盘：`data/phase25-exit/af214-realism-ai-double-blind/report.json` 与 `summary.md`（`data/` 被 gitignore 覆盖，不入库）。

## 与任务单的偏差

1. 评分输出从“纯 JSON”改为“行协议优先、JSON 兼容”。原因是真实模型把 `<think>` 内联进 content，JSON 被截断后无法解析；行协议是实测可用的最短契约，且证据校验规则不变。
2. 任务单要求“至少 8 个 packet”；实际跑了 9 个候选，8 个有效、1 个失败并保留在失败表，由候选回填达标。没有把失败包静默替换掉。
3. `scene` 在 packet 中保留，因为评分锚点本身依赖场景；去身份只去 session id / 角色 slug / 档位，不去场景标签。

## 遗留

- 既有 360 场全部无场景字段，`online_voice/online_text` 切片为 0；线上场景要等新批次。
- 1 个 packet 的 R1 解析失败已记录，但未做失败包的二次人工复核；R6 应把解析失败率纳入门禁。
- AI 评分员同模型，独立性有限；真人督导师双标与仲裁仍未做，`clinicalAcceptanceEligible` 保持 false。
- 工作区存在此前批次遗留的 `data/batch-reports/*`、`data/phase25-exit/af13*` 与编排草稿，本单不清理、不纳入提交。

## commit message

`feat(af214): 建立来访者真人度 AI 双盲评分协议与可复算基线`
