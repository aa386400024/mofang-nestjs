# AF-225 · 来访者真人度 R6-B 交付记录

日期：2026-11-21
基线：`4017839ce8b5a5faccf812e75b9861f49de180ed`（AF-224 拉取后 `integrate` HEAD）
任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-225/task-sheet.md`

## 一句话结论

R6-B 把 R5 评分链路的失败从“整包扔掉的 `dimension_missing:naturalness`”改成**可诊断、可恢复的两段式评分**：首次仍走 R5 行协议；只有首次输出被截断、只剩思考块或缺少维度行时，才切到 compact 行协议重试，明确禁止 `<think>` 与 JSON、强制五维齐全、quote 限短，但证据定位纪律不放宽。按任务单原命令对 R5 的 4 个失败 packet 真实重跑，**4/4 完成五维评分、0 失败**；其中 `069466ea9f8e0261` 的 R2 在 5000 token 再次 `finish=length`，compact 重试成功接住，`dimension_missing` 不再出现。

本报告是 AI 代理预评审，`humanSupervision=false`、`clinicalAcceptanceEligible=false`，不构成临床验收。

## 根因确认

R5 的 4 个失败不是“模型漏评自然度”，而是评分员把预算全花在推理里：

- `finish=length`，`completionTokens=3000` 耗尽；
- 输出 10K–13K 字符，整体包在 `<think>` 里；
- 去掉思考块后没有一条 `维度=分数|轮次|原句`，协议根本没开始；
- 旧重试提示词要求“只输出一个 JSON 对象”，与主协议行协议不一致，二次重试继续被思考吃满预算。

因此失败原因应分成两类：`no_protocol_lines`（协议未开始）与 `dimension_missing:<dim>`（协议已开始但缺维）。前者是预算/截断问题，后者才是维度遗漏。

## 改了什么

### 1. 解析层区分“协议未开始”与“缺维”

`src/auto-practice/metrics/visitor-realism-rating.ts`：

- 行协议解析先剥离 `<think>` 块；剥离后若拿不到任何维度行，返回 `no_protocol_lines`；
- 已有维度行但缺某一维，仍返回 `dimension_missing:<dim>`，保留原错误语义；
- 证据校验不变：quote 必须能在指定轮次的来访者台词中定位，不改写、不拼接、不编造。

### 2. compact 重试提示词

`buildRealismRaterCompactPrompt(packet, raterId, failureReason)`：

- 明确“不要思考、不要解释、不要 `<think>`、不要 JSON、不要 markdown”；
- 第一行必须是 `naturalness=`，五维必须全部输出，一行都不能省；
- quote 最多 12 个字符，必须原样来自该轮来访者台词；没有明显证据时选最接近的一轮原句，不得编造，也不得省略该维；
- 只保留压缩锚点（1/3/5 分），notes 可省；
- 仍要求 quote 能在指定轮次定位，不放宽证据校验。

主协议的证据纪律同步改为“即使没有明显证据，也必须选最接近的一轮原句，不得省略该维”，避免提示词本身诱导缺维。

### 3. CLI 评分重试与预算

`bin/visitor-realism-blind.ts`：

- 新增 `--max-output-tokens`，默认 **5000**（原硬编码 3000）；评分员与仲裁都按该值传 `maxCompletionTokens`；
- 首次解析失败后，下一次重试切 compact 行协议，不再用 JSON 重试；
- 截断失败原因记为 `truncated:<error>`，日志新增 `[PROTOCOL] ... 切 compact 行协议`；
- 新增 `--packet-ids` 精确筛选与 `--report-title`，不改变盲评包抽样与去身份逻辑；
- 报告新增 `selectedPackets`、`packetFilter`、`maxOutputTokens` 字段，仍只落 packetId / 分数 / 计数 / 失败原因，不落台词原文。

### 4. packet 精确筛选与恢复探针

- 新增 `src/auto-practice/metrics/visitor-realism-packet-filter.ts`：按 packetId 返回命中包与缺失 ID，不重新抽样、不改变 packet 内容。
- 新增 `bin/visitor-realism-stability-probe.ts`：复用同一评分 CLI，按 packetId 重跑失败包；任一包失败即 exit 1，避免闸门假绿。

### 5. 测试

新增 `test/auto-practice/af225-realism-stability.spec.ts`（7 例）：

- 只有思考块 → `no_protocol_lines`；
- 缺自然度 → `dimension_missing:naturalness`；
- 五维齐全仍可解析；
- compact 提示词仍是行协议、五维齐全、禁止思考/JSON、quote 限短；
- compact 不放宽证据校验；
- packetId 筛选只命中目标且不改变内容。

## 真实恢复探针

最终闸门按任务单原命令执行：

`node --env-file=.env --import tsx bin/visitor-realism-stability-probe.ts --packet-ids 005c9606d209a55d,02b82823ffa9479e,04172a05c74f4b76,069466ea9f8e0261 --max-output-tokens 5000`

结果：**exit 0，rated=4/4，failed=0，targetMet=true**。

关键现场：

- `005c9606d209a55d`：R1/R2 均 `finish=stop`，直接通过；
- `02b82823ffa9479e`：R1/R2 均 `finish=stop`，直接通过；
- `04172a05c74f4b76`：R1/R2 均 `finish=stop`，直接通过；
- `069466ea9f8e0261`：R2 首次 `finish=length`、`completionTokens=5000`、19K 字符仍包在 `<think>`，判 `truncated:no_protocol_lines`；随即切 compact 行协议，`finish=stop`、10.9K 字符，解析成功。

最终报告（`data/phase25-exit/af225-realism-stability/report.json`）：

- `ratedPackets=4`，`failedPackets=0`，`targetMet=true`；
- 总体均值 3.35，自然度 3.0；
- 总体 exact / ±1 / κ 均为 1。

同一版代码共跑了 3 次独立 4-packet 真实探针，3 次均 4/4 完成；其中 2 次触发 compact 重试并恢复（第一次 R1 `evidence_not_in_turn:naturalness` 与 R1 截断，第二次与最终闸门各 1 次截断）。这说明修复不是“刚好没截断”的偶然通过。

### 必须如实记录的边界

1. **只验证了 4 个 R5 失败 packet 的恢复**，没有重跑全量 12 packet；不能据此宣称整个盲评批次已稳定。
2. 三次探针的分数有波动（总体 3.375 / 3.575 / 3.35，自然度 3.125 / 3.25 / 3.0），这是评分员随机性与重试路径差异，不是质量提升证据；不同 run 的分数不可直接比较。
3. compact 重试只解决“被思考吃满预算、协议未开始”的整包失败；若模型稳定输出但持续缺某一维，仍会按 `dimension_missing:<dim>` 失败，不会被掩盖。
4. 真人督导师双标与仲裁仍未做，`clinicalAcceptanceEligible=false`。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向 vitest（AF-225 + AF-214 评分 + AF-214 盲评包） | 3 files passed，30 tests passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint`（全量，带缓存） | exit 0，0 error / 0 warning |
| `pnpm test`（全量） | 247 files passed + 1 skipped；4175 tests passed + 4 skipped |
| 恢复探针原命令 | exit 0，4/4 packet 完成五维评分，0 failed，无 `dimension_missing` |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 与任务单的偏差

1. 任务单要求“compact 重试五维齐全”；实现同时把主协议里“找不到原句就说明该维无法评分”改为“必须选最接近的一轮原句”，否则提示词本身会诱导缺维。证据必须可定位这一条没有放宽。
2. 任务单的探针命令未指定 `--out`，脚本默认写 `data/phase25-exit/af225-realism-stability/`，与交付路径一致；未额外传参。
3. 新增了 packetId 筛选纯函数与探针包装脚本，属于任务单“按 packetId 精确重跑”的必要实现，未改盲评包抽样。
4. CLI 默认输出预算从硬编码 3000 改为可配置 5000；任务单原命令显式传 5000，行为可复算。

## 遗留

- **R6-C 线上场景补样本**：360 场仍只有 `in_person=343`，`online_voice=0`、`online_text=0`，线上切片无法验证。
- **全量 12 packet 复跑**：本单只按失败 packet 做恢复验证；若要给出批次级稳定性结论，需要另跑完整 12 packet 并保留失败表。
- 真人督导师双标与仲裁未做，`clinicalAcceptanceEligible` 保持 false。
- 工作区存在并行任务与历史取证文件（`data/batch-reports/*`、`data/phase25-exit/af13*`、`.af214-check.mjs` 等），本单不清理、不纳入提交。

## commit message

`fix(af225): 来访者真人度评分截断恢复与 compact 行协议重试`
