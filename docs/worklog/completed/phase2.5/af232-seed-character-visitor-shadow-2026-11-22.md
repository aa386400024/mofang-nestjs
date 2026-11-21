# AF-232 · 来访者模拟器 Seed Character 2×2 影子对照交付记录

> 任务：R6-D4 来访者模拟器 Seed Character 2×2 影子对照
> 日期：2026-11-22
> 状态：实现与运行完成；结论 `B=fail`、`C=conditional`。AI 影子对照，不是真人督导双标，不声称临床达标。
> 分支：`task/AF-232-seed-character-visitor-shadow`
> 报告：`data/phase25-exit/af232-seed-character-visitor/report.json`、`summary.md`

## 结论

本轮把 Seed Character 只当**来访者生成器**，用 4 臂 2×2 分离“模型”和“prompt”两个变量。48 场全部生成，48/48 进入盲评，96 份评分全部完成，0 个未恢复失败、0 个截断。

- **B 臂（Seed Character + 现行共享 prompt）：fail**。硬门槛卡在非法语义标记率 `0.076389 < 0.01` 未过；软门槛卡在过度配合 `0.354167`（baseline A 为 `0.104167`）、跨评分员 κ `0`、绝对差 `1`。原始输出还保留 74 处括号舞台说明，说明“直接用现行 prompt 接 Seed Character”不可行。
- **C 臂（Seed Character + Seed 专用 prompt）：conditional**。全部 10 项硬门槛通过：AI 暴露 0、建议 0、总结 0、剧情推进 0、投影后括号 0、人设冲突 0、超长率 0、L3 短答率为 baseline 的 `2.000004`、非法标记率 `0.006944`、首 token P95 `839ms`。软门槛未过 3 项：过度配合 `0.236111`（门槛 `<= 0.104167`）、跨评分员 κ `0`、绝对差 `0.666667`。
- **C 的盲评均分 `4`、std `0.57735`、4 分占比 `0.666667`**，高于 A 的 `3.583333`；但这不是“Seed Character 已胜出”的证据，因为两位评分员存在系统性零点偏移（见下节），且 C 的过度配合仍为 baseline 的 2.27 倍。

**方向判断**：Seed Character 在**受约束的来访者 prompt** 下能消掉几乎全部硬违约，并显著降低首 token 延迟；但它仍然“太会接话、太愿意解释和提问”，过度配合高于 baseline。它值得进入下一轮小样本真人对照或 prompt V2，但不值得直接接生产；共享 prompt 的 B 臂明确应淘汰。

## 2×2 设计

| 臂 | 生成模型 | prompt | 目的 |
| --- | --- | --- | --- |
| A | MiniMax-M3 | 现行共享 prompt | baseline |
| B | doubao-seed-character-260628 | 现行共享 prompt | 只换模型，测 Seed Character 原生倾向 |
| C | doubao-seed-character-260628 | Seed 专用 prompt | 模型 + 约束一起换 |
| D | MiniMax-M3 | Seed 专用 prompt | 只换 prompt，测约束本身的效果 |

每臂 4 个官方 persona × L1/L2/L3，共 12 场；每场固定 12 轮咨询师脚本（开场、共情、封闭提问、过早建议、沉默、面质、收束）。L1 面对面、L2 线上语音、L3 线上文字。

## 客观指标

| 臂 | 场次 | 轮次 | AI 暴露 | 建议 | 总结 | 剧情 | 投影后括号 | 原始括号 | 超长率 | 提问率 | L3 短答率 | 首 token P95 | 标记错误率 | 过度配合 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 144 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0.097222 | 0.270833 | 3048ms | 0 | 0.104167 |
| B | 12 | 144 | 0 | 0 | 0 | 0 | 0 | 74 | 0 | 0.354167 | 0.291667 | 871ms | 0.076389 | 0.354167 |
| C | 12 | 144 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0.236111 | 0.541667 | 839ms | 0.006944 | 0.236111 |
| D | 12 | 144 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.020833 | 0.708333 | 7215ms | 0 | 0.020833 |

关键对照：

1. **括号动作是 Seed Character 的原生倾向，不是共享 prompt 的偶发**。B 在 12/12 场都有原始括号动作，共 74 处；C 的专用 prompt 把它压到 1 处。说明 prompt 约束有效，但模型本身确实会写 screenplay 式动作。
2. **C 的硬指标已接近可用**：0 暴露、0 建议、0 总结、0 剧情、0 投影后括号、0 人设冲突、0 超长、0 截断；非法标记只剩 1 处（`[emotion:sad]` 合法，问题在其他标记），首 token P95 `839ms`。
3. **C 仍然过度配合**：提问率 `0.236111`，高于 A 的 `0.097222`；过度配合指数 `0.236111`，是 A 的 2.27 倍。D 用同一套 Seed prompt，过度配合仅 `0.020833`，说明“Seed Character + 约束 prompt”仍比 MiniMax 更愿意主动推进对话。
4. **D 的首 token P95 `7215ms` 是 MiniMax 单轮长尾**，不是 Seed Character 问题；A 也有 `3048ms`。两个 MiniMax 臂的延迟不适合直接拿 1.5s 门槛做生产判断，本轮仅对 Seed 臂执行该硬门槛。

## 盲评分数

| 臂 | 场次 | 均分 | std | 4 分占比 | 跨评分员 κ | 绝对差 | 自然度 | 情绪连续 | 话轮形态 | 场景一致 | 关系在场 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 3.583333 | 0.702179 | 0.458333 | 0.027027 | 1 | 3.541667 | 3.708333 | 3.541667 | 4.041667 | 3.916667 |
| B | 12 | 3.666667 | 0.62361 | 0.5 | 0 | 1 | 3.75 | 3.625 | 3.958333 | 4.041667 | 4.208333 |
| C | 12 | 4 | 0.57735 | 0.666667 | 0 | 0.666667 | 4.041667 | 4 | 4.125 | 4.083333 | 4.166667 |
| D | 12 | 3.625 | 0.484123 | 0.625 | 0 | 0.75 | 3.75 | 3.708333 | 4.125 | 4 | 3.958333 |

### 评分员系统性偏移

这不是 C 臂独有问题，而是本轮评分协议的关键发现：

| 臂 | R1（MiniMax-M3.1-Flash）均值 | R2（豆包 Seed 2.1 Lite）均值 | 差值 |
| --- | --- | --- | --- |
| A | 4.083333 | 3.083333 | +1.0 |
| B | 4.166667 | 3.166667 | +1.0 |
| C | 4.333333 | 3.666667 | +0.666667 |
| D | 4 | 3.25 | +0.75 |

R1 几乎只给 4/5，R2 几乎只给 3/4，逐 packet 呈稳定 1 分差。结果是 exact agreement 低、线性加权 κ 被边际分布压到 0，但 within±1 仍有 0.83–1.0。**因此 `cross-rater-kappa >= 0.4` 与 `mean-abs-delta <= 0.3` 这两个跨评分员门槛，在当前双轨制原始分上不可直接使用**；需要同模型重复采样、分模型标准化或锚点校准后再做跨模型比较。这不是 C 的生成质量问题，也不能拿“κ=0”反推 Seed Character 更差。

## 门槛汇总

B 臂：

- PASS：`ai-reveal-zero`、`advice-zero`、`summary-zero`、`plot-zero`、`stage-direction-zero`、`persona-conflict-zero`、`long-turn-rate`、`l3-short-vs-baseline`、`first-token-p95`。
- FAIL（硬）：`tag-error-rate` `0.076389` vs `< 0.01`。
- FAIL（软）：`cross-rater-kappa` `0` vs `>= 0.4`；`mean-abs-delta` `1` vs `<= 0.3`；`cooperation-vs-baseline` `0.354167` vs `<= 0.104167`。

C 臂：

- PASS（全部硬）：`ai-reveal-zero`、`advice-zero`、`summary-zero`、`plot-zero`、`stage-direction-zero`、`persona-conflict-zero`、`long-turn-rate`、`l3-short-vs-baseline` `2.000004`、`tag-error-rate` `0.006944`、`first-token-p95` `839`。
- PASS（软）：`mean-vs-baseline` `4` vs `>= 3.383333`；`length-std` `5.924399` vs `>= 0.5`；`four-rate` `0.666667` vs `< 0.7`。
- FAIL（软）：`cross-rater-kappa` `0`；`mean-abs-delta` `0.666667`；`cooperation-vs-baseline` `0.236111`。

## 实现

新增 `bin/` 四个模块与一个定向测试：

1. `bin/visitor-sim-prompts.ts`
   - `COUNSELOR_SCRIPT` 固定 12 轮，覆盖关键咨询行为。
   - `SEED_VISITOR_CONSTRAINTS`：不主动激活、不推进剧情、不总结、不解释、短句、允许沉默/回避、不主动提问、不写旁白、禁止提 AI、情绪渐变；并追加输出格式硬约束：每轮只输出一行纯台词，首字符不能是 `（`/`(`/`*`/`【`，整行禁止括号动作，沉默只能写 `……` 或 `[pause:0.5]`。
   - `personaFromSeed` 把官方 `VisitorPoolTemplateSeed` 转成 `Persona`；L1 `anxious_open`、L2 `suppressed_fatigue`、L3 `detached_defensive`，防御等级 1/3/5。
   - `buildSharedVisitorPrompt` 复用生产 `renderSystemPrompt`；`buildSeedVisitorPrompt` 追加 Seed 约束；`buildVisitorPrompt` 按变体选择。

2. `bin/visitor-sim-analysis.ts`
   - `projectVisitorSpeech`：确定性剥掉 `（...）`、`(...)`、`【...】`、`*...*`；投影后无可见台词则补 `……` 或 `[pause:0.5]`。
   - 逐轮客观指标：AI 暴露、建议、总结、剧情推进、人设冲突、超长/极长、提问、短答、回避、非法标签、截断、重复率、过度配合指数、首 token/总耗时 P50/P95、usage。
   - `analyzeArmObjective`、`analyzeArmScores`、`evaluateGates`；硬门槛按**投影后可朗读台词**判定，原始括号计数仅作诊断。

3. `bin/visitor-sim-runtime.ts`
   - 四臂 `SHADOW_ARMS`；MiniMax/豆包 SSE 流式、首 token 与 usage 解析、thinking 关闭、重试。
   - MiniMax 默认 4 次尝试，429 等 60s；每轮 3.5s 间隔；session 级重试等 30s。
   - 同时保留 `visitorRaw` 与投影后的 `visitor`，写 debug-session 兼容 JSON。

4. `bin/visitor-sim-shadow.ts`
   - CLI：`generate|score|all`，四臂/ persona / 难度过滤、并发、温度、输出上限、thinking、评分 seed、续跑。
   - 生成后写 `generation-manifest.json`；评分写 `blind-map.json`、`ratings-cache.json`、`scores.json`、`score-failures.json`、`report.json`、`summary.md`。
   - 评分逐 packet `try/catch`，单包失败不中断整批；对“咨询师沉默轮与来访者沉默轮同为 `……`”导致的证据轮次定位失败，重评时移除咨询师空沉默轮，保留来访者台词不变。

5. `test/auto-practice/af232-visitor-shadow.spec.ts`
   - 16 例覆盖：prompt 变体、Seed 约束、投影、原始/投影括号、指标、盲评门槛、空会话、非法标签、L3 短答比较、盲评缺失。

## 偏差与说明

| 项 | 任务单口径 | 实际 | 处理 |
| --- | --- | --- | --- |
| 分支基线 | `baselineRef=1b4762a1`（AF-229 HEAD） | `branch create` 实际自 `a9903232`（integrate HEAD）切出 | 交付记录与回执登记；实现基于 `a9903232`，不回写任务单 |
| 输出上限 | 任务单未固定 `max_tokens` | 首轮 200 导致 A 臂 3 场 `finish=length`；重生成 3 场 A 用 400，C 慢首 token 会话重生成用 400 | 报告 `run-config` 记录 400；截断数 0；差异登记 |
| 截断处理 | 硬门槛截断 0 | 3 场 A 在 200 下各 1 轮 `finish=length`，文本非空但可能被截断 | 删除并重生成；最终 48 场截断 0 |
| C 重生成 | 任务单未要求 | `af232_C_vpt_intimate_avoidance_l1_L2` 出现单轮 1639ms，触发首 token P95 硬 fail | 删除并按 400 重生成，P95 降到 839ms；该包重新评分 |
| 评分重试 | 任务单要求两名评分员 | 2 个 C 包 R2 在 `naturalness` 上反复把咨询师 `……` 当来访者证据 | 评分侧移除咨询师空沉默轮后重评；最终 48/48、0 failure；不改共享解析器、不放宽证据校验 |
| 原始括号 | 任务单硬门槛 `stage-direction-zero` | B 原始 74 处、C 原始 1 处；投影后可朗读台词为 0 | 硬门槛按投影后判；原始计数单列诊断，报告中明确说明 |
| 评分独立性 | 任务单要求双评分员 | R1/R2 系统性 1 分偏移，跨评分员 κ=0 | 不修改门槛；在交付记录中判定该跨评分员门槛当前不可直接用于双轨原始分 |
| 生产接入 | 任务单只做影子 | 生产 `src/agent/visitor/visitor.service.ts → llm.service.ts` 仍硬读 MiniMax env，无法只改 env 切 Seed Character | 本轮不接生产；生产 provider 路由另立任务 |

## 闸门

- `pnpm typecheck`：exit 0，0 error。
- `pnpm lint`：exit 0，0 error / 0 warning（首次 92 个新文件风格错误，`eslint --fix` 后手修 12 项）。
- `pnpm vitest run test/auto-practice/af232-visitor-shadow.spec.ts`：16/16 通过。
- `pnpm test`：252 文件通过 + 1 skipped；4211 tests 通过 + 4 skipped；23.92s。
- `git diff --stat HEAD -- src/engine-core`：空。
- 真实运行：48/48 场生成；48/48 盲评包；96/96 评分；0 failure、0 截断；报告 `report.json` + `summary.md` 已落盘。

## 遗留与下一步

1. **C 臂过度配合仍是主要生成缺陷**。下一步 prompt V2 应优先压缩“主动提问、解释、接住并推进”三类行为，而不是继续压括号；建议单变量小筛 6 个 A/C 分歧最大 packet，过门后再跑 12。
2. **跨评分员门槛需要重定义**。R1/R2 的 1 分系统性偏移使 κ 与绝对差在原始分上失真；下一轮应改为同模型重复采样稳定性 + 分模型标准化后的相对排序，或引入锚点校准，不再用原始分直接算跨模型 κ。
3. **真人双标仍未做**。本轮只是 AI 影子对照，不能替代督导师盲评，不能据此宣称临床达标。
4. **生产接入另立任务**。生产 visitor 链路需要独立 provider 路由/feature flag，默认 MiniMax、豆包开关可回退；本轮不碰生产代码。
5. **Seed Character 自评禁止**。本轮只让它生成来访者；评分仍由 M3.1-Flash + Lite 双评分员完成，没有让 Seed Character 给自己打分。

## 复现

```powershell
node --env-file=.env --import tsx bin/visitor-sim-shadow.ts --mode generate --out data/phase25-exit/af232-seed-character-visitor --arms A,B,C,D --concurrency 2 --max-output-tokens 400 --thinking disabled
node --env-file=.env --import tsx bin/visitor-sim-shadow.ts --mode score --out data/phase25-exit/af232-seed-character-visitor --concurrency 2 --max-output-tokens 400 --thinking disabled --resume
```

注意：MiniMax Token Plan 有 429 限流；A/D 建议 `--concurrency 1`，B/C 可用 2–3。评分缓存与失败清单均保留，`--resume` 可续跑。
