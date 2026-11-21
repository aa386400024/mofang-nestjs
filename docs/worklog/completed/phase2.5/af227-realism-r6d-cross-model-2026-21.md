# AF-227 · 来访者真人度 R6-D 交付记录

> 任务：MiniMax × 豆包 Seed 2.1 Pro 跨模型评分校验
> 日期：2026-11-21
> 状态：已完成；AI 预评审，不是真人督导结论
> 分支：`task/AF-227-realism-r6d-cross-model`

## 结论

R6-D 用 R6-C 同一批 24 个 packet，把 MiniMax 与豆包各接两位评分员（T=0.1 / T=0.5），真实完成 96 次评分（`calls=98`，其中 2 次为解析自愈重试），失败 0、截断 0。

预登记判定为 **conditional**，唯一不达项是跨模型总体绝对差均值 `0.375 > 0.3`：

- 跨模型总体线性加权 κ：T=0.1 为 `0.440415`、T=0.5 为 `0.425532`，均高于预登记下限 `0.4`。
- 五维 within±1：除情绪连续性 T=0.5 为 `0.958333` 外，其余均为 `1.0`，全部高于 `0.8`。
- 三场景方向：MiniMax 与豆包都是 `online_voice`、`online_text` 高于 `in_person`，无翻转。
- 模型均值：MiniMax `3.6875`，豆包 `3.3125`；豆包整体系统性偏严 `0.375`，其中情绪连续性偏移最大（`4.020833` vs `3.416667`，绝对差 `0.604167`）。

**结论边界**：方向在跨模型上成立，逐 packet 没有出现 ±1 以外的粗大分歧；但两把尺子的零点不一致，豆包整体压低约 0.375。按预登记规则不能扩到 48 / 96 / 360 场，也不能把两模型分数平均成单一临床总分。下一步应先做锚点校准或补真人双标，不是直接扩样本。

留一法敏感性复核（`data/phase25-exit/af227-realism-cross-model/sensitivity.md`）进一步显示：**偏移是稳健的，κ 只是边际过线**。剔除任意 1 个 packet 后，总体绝对差均值始终在 `0.347826`~`0.391304`，全部超 `0.3`；但 T=0.1 跨模型 κ 在剔除低分锚点 `0283788d65a673e5` 后从 `0.440415` 跌到 `0.342857`。因此 `0.44` 不能当作稳定尺子的强证据，24 packet 的 κ 对单个样本太敏感。

## R6-C 复现对照

R6-D 的 MiniMax 聚合分数几乎复现 R6-C，说明聚合层面的批次稳定性较好。

| 维度 | R6-C | R6-D MiniMax | 差值 |
| --- | --- | --- | --- |
| 总体 | 3.683333 | 3.6875 | +0.004167 |
| 自然度 | 3.291667 | 3.291667 | 0 |
| 情绪连续性 | 3.958333 | 4.020833 | +0.0625 |
| 话轮形态 | 3.291667 | 3.270833 | -0.020833 |
| 场景一致 | 3.958333 | 4.041667 | +0.083333 |
| 关系在场 | 3.916667 | 3.9375 | +0.020833 |

但 MiniMax 模型内一致性从 R6-C 的 κ `0.614973` 降到本轮 `0.432432`（exact `0.75` → `0.708333`），而豆包模型内 κ 为 `0.934066`（exact `0.958333`）。两轮都是 T=0.1 / T=0.5 双评分员，因此这组下降不能只归因于温度；它提示 MiniMax 在**逐 packet 层面**的评分抖动明显大于豆包。跨模型 κ `0.440415` 甚至略高于 MiniMax 模型内 κ `0.432432`，说明当前最主要的噪声源不是“两个模型不同”，而是 MiniMax 自身在不同温度/采样下的波动。

这不是“豆包更准”的证据：豆包 thinking 关闭，模型内稳定但区分度可能被压低；它只能说明两模型误差结构不同。

## 统计稳健性

- 留一法 24 次：T=0.1 跨模型 κ 范围 `0.342857`~`0.477273`，仅剔除 `0283788d65a673e5` 就跌破 `0.4`；T=0.5 范围 `0.403458`~`0.465116`，全部过线但都在阈值附近。
- 总体绝对差均值范围 `0.347826`~`0.391304`，**全部高于 `0.3`**。偏移不是单个 packet 造成。
- 结论：`conditional` 的主因是稳定的模型零点偏移；κ 的“过线”不足以支撑扩样本，也不足以宣称两把尺子已对齐。

## 实现

1. **模型配置单一来源**
   - `provider-env.ts` 增加 `LLM_DOUBAO_MODEL`、`DEFAULT_DOUBAO_CHAT_MODEL='doubao-seed-2-1-pro-260915'`、`DEFAULT_DOUBAO_BASE_URL`、`resolveDoubaoChatModel`、`resolveDoubaoBaseUrl`。
   - 方舟基址只去尾斜杠，不套 OpenAI `/v1` 归一，避免拼成 `/api/v3/v1/chat/completions`。
   - `llm.config.ts` 注册豆包时从 `LLM_DOUBAO_MODEL` 读取，provider 兜底与启动注册同源。

2. **Provider 能力**
   - `OpenAICompatibleConfig` / `OpenAICompatibleChatOptions` 增加 provider 级 `modelKwargs`；基类在 `buildLLM` 时合并进 `modelKwargs`。
   - `DoubaoChatProvider` 支持 `baseUrl`、`defaultChatModel`、`modelKwargs` 注入；默认模型改为 `doubao-seed-2-1-pro-260915`。
   - MiniMax 子类保留原有 `max_completion_tokens` / `reasoning_effort` 映射，同时合并默认 `modelKwargs`。

3. **评分运行时**
   - 新增 `bin/realism-session-loader.ts`，把盲评 CLI 的会话加载抽成共享模块；`bin/visitor-realism-blind.ts` 改用它，原 MiniMax 评分流程不变。
   - 新增 `bin/realism-rater-runtime.ts`：按 provider 解析 key/model/温度/thinking；豆包 `thinking=disabled` 时不下发 `reasoning_effort`，MiniMax 保持 `reasoning_effort=low`。
   - 新增 `bin/realism-cross-model-analysis.ts`：纯统计，单点定义 `CROSS_MODEL_THRESHOLDS`，输出模型内/同温跨模型 κ、exact、within±1、绝对差、场景切片、方向翻转与 pass/conditional/fail。
   - 新增 `bin/visitor-realism-cross-model.ts`：复用同一 packet、同一提示词、同一证据校验；报告只含 packetId、分数、计数、token 统计，不含台词原文。

4. **测试**
   - 新增 `test/llm/af227-doubao-rater.spec.ts` 5 例、`test/auto-practice/af227-rater-runtime.spec.ts` 5 例、`test/auto-practice/af227-cross-model-analysis.spec.ts` 3 例。
   - `test/llm/minimax-provider.spec.ts` 增补豆包 env 覆盖与空白回落断言。
   - 定向 4 文件 `36 tests passed`；全量 `4195 passed / 4 skipped`。

## 真实评分

- 源：`data/debug-sessions`
- packet：24（`in_person=8`、`online_voice=8`、`online_text=8`），ID 保存在 `data/phase25-exit/af227-realism-cross-model/packet-ids.txt`
- 评分员：MiniMax-M3（T=0.1 / T=0.5，`reasoning_effort=low`）、豆包 `doubao-seed-2-1-pro-260915`（T=0.1 / T=0.5，`thinking=disabled`）
- 完成：`ratedPackets=24`、`ratingCount=96`、`failedPackets=0`、`truncatedCalls=0`
- 调用：`totalCalls=98`；MiniMax T=0.5 有 2 次解析失败，按既有协议切 compact 行协议后成功，未放宽证据校验
- 豆包 reasoning token：两档均为 `0`
- 报告：`data/phase25-exit/af227-realism-cross-model/report.json`、`data/phase25-exit/af227-realism-cross-model/summary.md`
- 日志：`data/phase25-exit/af227-realism-cross-model/run.log`

真实评分前用 packet `0283788d65a673e5` 做了 1 packet × 4 评分员冒烟，4 次均 `finish=stop`，确认豆包经 LangChain `modelKwargs` 下发 `thinking.disabled` 后 reasoning token 为 0。该冒烟因 `packet<24` 被判 `fail`，是预登记阈值的预期结果，不是调用失败。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向 vitest 4 文件 | 4 files passed，36 tests passed |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint`（全量，带缓存） | exit 0，0 error / 0 warning |
| `pnpm test`（全量） | 251 passed + 1 skipped files；4195 passed + 4 skipped tests |
| `pnpm env:doctor --keys 'MINIMAX_API_KEY,LLM_DOUBAO_API_KEY,LLM_DOUBAO_MODEL'` | PASS，error=0 |
| 24 packet 跨模型评分 | 24/24 完成，96 ratings，0 failed，0 truncated |
| 报告隐私扫描 | JSON 最长字符串为声明 85 字符；无台词原文 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 与任务单的偏差

1. **`env:doctor` 参数写法**：任务单写 `pnpm env:doctor --keys A,B,C`。PowerShell 未加引号时会把逗号当数组分隔符，参数被拆成三个，误报键缺失；按 `--keys 'A,B,C'` 单参数形式复跑为 `PASS`，error=0。未改脚本。
2. **“无 dimension_missing”口径**：任务单闸门要求 96 次评分“无 dimension_missing”。实际有 2 次 MiniMax R2 解析级 `dimension_missing` / `evidence_not_in_turn`，均在同 packet 的 compact 重试后成功；最终 96 份评分五维齐全、0 failed、0 truncated。这里把“无未恢复的解析失败”作为实际验收口径，原始告警保留在日志中，未删改。
3. **调用数 98 而非 96**：96 是成功评分次数；2 次解析自愈各多调用一次，故 `calls=98`。报告同时记录 `ratingCount=96` 与 `totalCalls=98`。
4. **冒烟 exit 1**：`--target-scored` 下限为 2，单 packet 冒烟不满足 `packet>=24`，按设计返回 `fail`/exit 1；4 次真实调用本身全部成功。
5. **模型默认值影响面**：`LLM_DOUBAO_MODEL` 现在让豆包全局默认从 `doubao-seed-2-1-pro-260628` 变为 `doubao-seed-2-1-pro-260915`；tier 映射仍保留 `260628`。非评分链路若依赖旧默认风格，需要在部署 `.env` 显式覆盖，已登记遗留项。
6. **跨模型独立性口径**：`AI_REALISM_LIMITATIONS` 原有“两位评分员同模型、不能声称跨模型独立”仍然成立；本报告把跨模型结果作为额外证据，不写成临床双盲独立验证。
7. **解析回退温度**：MiniMax T=0.5 的 2 个 packet 在主协议解析失败后按既有 `ratePacketWithRater` 切 compact 回退，回退调用温度固定为 `0.2`。因此这 2 个分数不是严格 T=0.5；未改协议，原始告警与 `parseRetries=2` 保留在报告/日志中，作为 MiniMax 噪声源登记。

## 遗留

- BL-AF227-01：跨模型总体偏移 `0.375` 触发 conditional，按预登记规则不得扩样本；需先做锚点校准或真人双标。
- BL-AF227-02：MiniMax 模型内 κ `0.432432`，低于 R6-C 的 `0.614973`；留一法显示 T=0.1 跨模型 κ 可被单 packet 拉到 `0.342857`。24 packet 的 κ 不稳定，应在扩大样本前先扩到至少 48 或做 bootstrap 置信区间。
- BL-AF227-03：豆包 `thinking=disabled` 的模型内一致性很高，但可能压低复杂判断区分度；需要 `thinking=auto/enabled` 对照后再判断是否适合做仲裁尺。
- BL-AF227-04：真人督导师双标与仲裁仍未做，`humanSupervision=false`、`clinicalAcceptanceEligible=false`。
- BL-AF227-05：豆包全局默认模型切换会影响非评分业务链路；部署前需确认 `LLM_DOUBAO_MODEL` 是否按环境显式覆盖。
- BL-AF227-06：MiniMax 解析回退把温度固定到 `0.2`，使 2 个 T=0.5 packet 轻微偏离原温度槽位；后续应评估回退是否保留原温度，或在报告中把回退 packet 单独标记。

## 机读字段标记

- `scopeCheck`：in-scope（`src/llm/`、`bin/`、`test/llm/`、`test/auto-practice/`、`.env.example`、任务记录与交付记录；未碰 `src/engine-core`、`admin-dashboard`、Flutter、`scripts/orchestration`）
- `contractChecks`：taskId / state-write / index-schema / event-chain / engine-boundary / deploy-contract / text-privacy 全部 pass
- `backlogItems`：BL-AF227-01 至 BL-AF227-06
- `deviationTable`：7 条（env:doctor 引号、解析自愈、calls=98、冒烟 exit 1、豆包默认模型影响面、跨模型独立性口径、解析回退温度）
- `reviewVerdict`：conditional-pass（机器闸门全绿；真实评分 24/24、96 ratings；判定 conditional 仅因预登记偏移阈值，不掩盖、不改阈值）

## commit message

`feat(af227): 接入豆包评分模型并完成 MiniMax 跨模型真人度校验`
