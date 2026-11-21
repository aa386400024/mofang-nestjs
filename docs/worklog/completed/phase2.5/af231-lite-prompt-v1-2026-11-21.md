# AF-231 · R6-D3 Lite 原生评分 prompt V1 与 12 packet 开发集

- 日期：2026-11-21
- 任务：AF-231（由 AF-230 重建；priorTasks: AF-229、AF-230）
- 分支：`task/AF-231-lite-prompt-v1`（基于 AF-229 HEAD `1b4762a1` 的堆叠分支）
- 协议：`ai-realism-cross-model-v1`
- 状态：`ai_proxy_candidate`；`humanSupervision=false`；`clinicalAcceptanceEligible=false`
- 结论：**V1 未通过预登记门槛；不进入 24 评测、不跑 48 全量、不写临床达标结论。V1 冻结，进入 V2 设计。**

## 一、结论先说

V1 做到两件事：12/12 解析成功，跨模型总体绝对差从 `0.416667` 降到 `0.208333`，总均值从 `3.833333 vs 3.5` 拉近到 `3.833333 vs 3.875`。

但 V1 没有证明 Lite“单独抗打”：

- 跨模型总体 κ 从 `0.361702` 降到 `0.333333`，仍低于 `0.4`。
- Lite 的 24 个评分里 22 个是 4 分，0 个 5 分；分布 `{2:1, 3:1, 4:22, 5:0}`，std `0.438986`，低于 `0.5`。
- 五维跨模型 κ 中，情绪连续性 `0.09434`、场景一致 `-0.2`、关系在场 `0.0`；只有自然度 `0.314286` 和话轮形态 `0.375` 接近 baseline。
- Lite reasoning 从 `147975` 涨到 `276201`，约 `1.87x`；质量未过门，成本先过门。

一句话：**V1 学会了“给 4”，但没有学会“什么时候不给 4”。**

## 二、交付内容

### 2.1 新增

- `bin/realism-rater-lite-prompt.ts`（12,121 bytes）
  - `LITE_PROMPT_VERSION = 'lite-rubric-v1'`
  - `buildLiteRaterPrompt(packet, raterId)`，输出 AF-214 行协议
  - 五维行为清单：每维把 1/3/5 分写成可观察行为，不沿用共享 prompt 的抽象锚点
  - 5 分需命中 5 分档 ≥3 条且无 1 分档特征；4 分命中 2 条；3 分命中 ≤1 条；2 分命中 1 分档 1 条；1 分命中 1 分档 ≥2 条
  - 五维最多 2 维给 5 分；场景一致 5 分锚点改为“当前媒介的可观察线索贯穿 ≥2 轮”
  - 显式反默认 3 分，但本轮实际塌到了 4 分
- `test/auto-practice/af229-lite-prompt.spec.ts`（8,416 bytes，12 例）
  - 覆盖版本号、五维顺序、行协议、5 分上限、场景媒介限制、rater 身份隔离、无 1 分档特征等契约

### 2.2 修改

- `bin/realism-rater-runtime.ts`
  - `RaterSpec.promptVariant?: 'shared' | 'lite-v1'`
  - `resolveRaterConfig` 拒绝 MiniMax 使用 `lite-v1`
  - `ratePacketWithRater` 对 `lite-v1` 走 `buildLiteRaterPrompt`，重试仍沿用 V1，不切 shared compact
  - `[CALL]` 日志增加 `promptVariant`
  - 修复 MiniMax 指出的 HEAD 既存 TS4111：`mergedKwargs.thinking` → `mergedKwargs['thinking']`
- `bin/visitor-realism-cross-model.ts`
  - 新增 `--doubao-prompt shared|lite-v1`
  - `RuntimeStat` 与报告 models 增加 `promptVariant`
  - summary 运行时表新增 prompt 列
- `test/auto-practice/af229-calibration-analysis.spec.ts`
  - 新增 promptVariant 校验 1 例；现有 11 例全绿

### 2.3 MiniMax Code 分工与回收

- MiniMax Code 负责 `bin/realism-rater-lite-prompt.ts` 与 `test/auto-practice/af229-lite-prompt.spec.ts` 初版，12 例测试全绿。
- 主控负责 runtime/CLI 接入、`--doubao-prompt` 切换、报告字段、TS4111 修复、12 packet 实验、对照脚本与交付记录。
- 回收验收：实际 diff 仅落在上述两个 MiniMax 文件，未越界；闸门数字由主控在本分支复跑确认，未直接采信回复自述。
- MiniMax 回复已归档：`docs/worklog/pending/archive/relay-response-AF-229-lite-prompt-20261121-2350.md`。

## 三、实验设计

### 3.1 开发集选择

- 从 48 池之外的同一候选池选 60 个候选，取尾部 12 个作为开发集。
- 三场景各 4 个：in_person / online_voice / online_text。
- 与 AF-229 的 24 评测 + 24 锚点交集断言为 0。
- 清单落在 `data/phase25-exit/af229-lite-dev-12/dev-ids.txt` 与 `dev-set.md`，候选统计在 `candidates.log`。

12 个 packet：

| packetId | 场景 | 轮次 | 字符数 |
| --- | --- | ---: | ---: |
| `0b7c99f76406cf19` | in_person | 32 | 2958 |
| `7bca75a765c9cabb` | online_voice | 16 | 2382 |
| `5eb61380dc656702` | online_text | 32 | 1643 |
| `0d6a2562a4c1f798` | in_person | 32 | 2090 |
| `836fb12e32da5190` | online_voice | 32 | 2437 |
| `64a878daf632f7a6` | online_text | 32 | 2556 |
| `0e3bcd907818919e` | in_person | 32 | 2065 |
| `86d88bd8fee882aa` | online_voice | 32 | 1987 |
| `685b894775c1a07d` | online_text | 12 | 1603 |
| `10cecca5021e6af8` | in_person | 18 | 252 |
| `889820c4d8c93279` | online_voice | 32 | 1935 |
| `751731f1bdd6de99` | online_text | 32 | 2171 |

### 3.2 两轮对照

- 基线：共享 prompt，MiniMax-M3.1-Flash + 豆包 Lite auto，各 T=0.1 / T=0.5。
- V1：同一 12 packet，MiniMax 仍共享 prompt，豆包改 `--doubao-prompt lite-v1`。
- 两轮都只跑 12 开发 packet；不扩 24 评测、不跑 48 全量。
- 报告目录：`data/phase25-exit/af229-lite-dev-12/baseline/` 与 `v1/`。
- 对照脚本：`data/phase25-exit/af229-lite-dev-12/compare-variants.mjs` → `v1-vs-baseline.json`。

## 四、结果

### 4.1 总体对照

| 指标 | 基线 | V1 | 变化 |
| --- | ---: | ---: | ---: |
| 完成 packet | 12/12 | 12/12 | 持平 |
| calls | 49 | 51 | +2 |
| truncated | 0 | 0 | 持平 |
| 跨模型 κ | 0.361702 | 0.333333 | -0.028369 |
| 跨模型 exact | 0.583333 | 0.75 | +0.166667 |
| within±1 | 1 | 1 | 持平 |
| 总体绝对差 | 0.416667 | 0.208333 | -0.208334 |
| MiniMax 均值 | 3.833333 | 3.833333 | 持平 |
| Lite 均值 | 3.5 | 3.875 | +0.375 |
| Lite 分布 | {2:2,3:9,4:12,5:1} | {2:1,3:1,4:22,5:0} | 4 分集中 |
| Lite std | 0.7071 | 0.438986 | -0.268121 |
| Lite 模型内 κ | 0.54717 | 0.647059 | +0.099889 |
| Lite 模型内 exact | 0.666667 | 0.916667 | +0.25 |

V1 的绝对差和模型内稳定性都变好了，但这是以“几乎全给 4”为代价换来的。跨模型 κ 反而下降，说明分数贴上了均值，排序信息丢了。

### 4.2 五维跨模型 κ

| 维度 | 基线 | V1 | 判断 |
| --- | ---: | ---: | --- |
| 自然度 | 0.333333 | 0.314286 | 基本持平 |
| 情绪连续性 | 0.387755 | 0.09434 | 明显恶化 |
| 话轮形态 | 0.37931 | 0.375 | 基本持平 |
| 场景一致 | 0.318182 | -0.2 | 方向反转 |
| 关系在场 | 0.181818 | 0.0 | 退化为随机 |

场景一致的负 κ 不是“稍微不一致”，而是 Lite 与 MiniMax 在同一批 packet 上的排序方向相反。V1 把场景 5 分锚点改成“当前媒介线索贯穿 ≥2 轮”，但 Lite 对 online_voice/online_text 的媒介线索识别可能过度统一，导致三个场景被压成同一档。

### 4.3 逐 packet

| packet | 场景 | MiniMax T01/T05 | Lite V1 T01/T05 | 绝对差 |
| --- | --- | --- | --- | ---: |
| `0b7c` | in_person | 4/4 | 4/4 | 0 |
| `7bca` | online_voice | 4/5 | 4/4 | 0.5 |
| `5eb6` | online_text | 4/4 | 4/4 | 0 |
| `0d6a` | in_person | 4/4 | 4/4 | 0 |
| `836f` | online_voice | 3/4 | 4/4 | 0.5 |
| `64a8` | online_text | 4/4 | 4/4 | 0 |
| `0e3b` | in_person | 4/4 | 4/4 | 0 |
| `86d8` | online_voice | 4/4 | 4/4 | 0 |
| `685b` | online_text | 4/5 | 4/4 | 0.5 |
| `10ce` | in_person | 2/2 | 3/2 | 0.5 |
| `8898` | online_voice | 3/4 | 4/4 | 0.5 |
| `7517` | online_text | 4/4 | 4/4 | 0 |

12 个 packet 里 7 个完全同分，且集中在 4。开发集本身偏“好 packet”：MiniMax 几乎全 4，只有短样本 `10ce` 是 2。用这个集合判断“分辨力”会低估问题，但 22/24 个 4 分已经说明 Lite 的 4 分默认非常强。

### 4.4 成本

| 评分员 | V1 reasoning | 基线 reasoning | 倍数 |
| --- | ---: | ---: | ---: |
| MiniMax T01+T05 | 3888 | — | — |
| 豆包 T01+T05 | 276201 | 147975 | 1.87x |

V1 的 prompt 更长、规则更多，Lite 的 reasoning 接近翻倍。若 V2 不能把 κ 和分布同时拉过门，继续加规则只会更贵。

## 五、诊断

V1 的失败不是“均值没调好”，而是三个结构性问题：

1. **4 分成了新的安全答案。** V1 把 5 分门槛抬到“≥3 条 + 无 1 分特征 + 最多 2 维”，但 4 分只要“命中 2 条”。Lite 在不确定时稳定选择 4，因为 4 既不像 3 那样承认“有缺陷”，也不像 5 那样需要强证据。结果是 22/24 个 4。
2. **五维没有真正独立打分。** 情绪连续性、场景一致、关系在场的跨模型 κ 接近 0 或负值，说明 Lite 在这三维上没有稳定的可观察判据，可能被 overall 或整体印象带着走。
3. **场景媒介规则可能过度统一。** V1 要求“媒介线索贯穿 ≥2 轮”，但 Lite 对 in_person / online_voice / online_text 的线索识别没有分层；三个场景的 Lite 均值分别是 3.625 / 4 / 4，方向与 MiniMax 一致，但维度内部排序反转。

## 六、V2 方案（未实现，待确认）

V2 的目标不是继续抬 5 分门槛，而是把 Lite 从 4 分默认里逼出来，同时控制成本。建议先做 `lite-rubric-v2` 独立版本，不修改 V1，保留 A/B。

### 6.1 5/4/3 阶梯整体下移一档

- 5 分：命中该维 5 分档全部条目，且无 1 分档特征。
- 4 分：差 1 条（命中条目数 = 该维 5 分档条目数 - 1）。
- 3 分：差 2 条及以上，或命中 ≤1 条，且无 1 分档特征。
- 2 分：命中 1 分档 1 条。
- 1 分：命中 1 分档 ≥2 条。
- 五维最多 2 维给 5 分不变。

这里不能用固定“≥4 条”，因为五维的 5 分档条目数不同：自然度 4 条、情绪连续性 4 条、话轮形态 4 条、场景一致 3 条、关系在场 3 条。固定 ≥4 会让场景一致和关系在场永远拿不到 5 分。改成“全中 / 差 1 条 / 差 2 条以上”按维度自适应，才能把 V1 里“命中 2 条给 4”的样本压到 3，同时保留场景/关系维的 5 分通道。

### 6.2 反“全 4”默认

- 五维全为 4 时，必须重看最弱一维：
  - 若最弱维有任一 1 分档特征，压到 2 或 1；
  - 若最弱维命中 5 分档 ≤2 条，压到 3；
  - 只有最弱维也稳定命中 3 条，才保留 4。
- 这条只在全 4 时触发，不改变其他分布，token 成本低。

### 6.3 overall 跟最突出维度，不取平均

- 若任一维为 5 且无维度 ≤2，overall=5；
- 若任一维 ≤2，overall=该维分数；
- 否则 overall 取五维中位数，不取算术平均。

目的是让 overall 不再被四个 4 拉平；但该规则有抬高 5 的风险，必须在开发集上看分布，不能直接上 24。

### 6.4 先 6 packet 小筛，再 12 packet

- 先用 baseline 分歧最大的 6 个 packet：`10ce`、`836f`、`8898`、`7bca`、`685b`、`7517`。
- V2 小筛门槛：跨模型 κ ≥0.4、绝对差 ≤0.3、std ≥0.5、唯一分数 ≥3、4 分占比 <70%、reasoning ≤1.3x baseline。
- 6 packet 过门才跑 12；12 过门才讨论 24 评测；48 仍不跑。
- 若 6 packet 不过门，停止加规则，回到“Lite 是否适合做独立评分员”的产品判断，不继续烧 token。

## 七、闸门与验证

在本分支 `task/AF-231-lite-prompt-v1` 上复跑：

- `pnpm exec vitest run test/auto-practice/af229-lite-prompt.spec.ts`：12/12 通过。
- `pnpm exec vitest run test/auto-practice/af229-lite-prompt.spec.ts test/auto-practice/af229-calibration-analysis.spec.ts`：23/23 通过。
- `pnpm lint`：exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm exec tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo`：exit 0。
- `pnpm test`：253 passed / 1 skipped（254 files）；4218 passed / 4 skipped（4222 tests）。
- `git diff --stat HEAD -- src/engine-core`：为空。
- 闸门日志：`data/phase25-exit/af229-lite-dev-12/v1-gates.log`、`v1-full-test.log`。

## 八、偏差与边界问题

1. **AF-230 被取消，AF-231 重建。** AF-230 原依赖 AF-229，但 AF-229 处于 submitted，`task promote` 被“依赖未满足”阻断；`task reissue` 又因 AF-229 已进入实现、不允许改 scope 而失败。于是取消 AF-230，登记 AF-231，`dependsOn: [AF-227]`、`priorTasks: [AF-229, AF-230]`，避免阻塞。
2. **分支是堆叠分支。** `branch create --taskId AF-231` 默认从 `integrate` 切，但 AF-229 的两个提交尚未进 integrate；直接切会丢依赖。实际从 AF-229 HEAD `1b4762a1` 手工切 `task/AF-231-lite-prompt-v1`，保留 AF-229 提交，PR 需以 AF-229 分支为 base 或等 AF-229 先合。
3. **任务单 artifacts 路径继承 AF-230。** AF-231 任务单由 AF-230 记录复制，artifacts 仍写 `af230-lite-prompt-v1-2026-11-21.md`；实际交付记录落本文件 `af231-lite-prompt-v1-2026-11-21.md`，以此为准。
4. **未跑 24 评测、未跑 48 全量。** 这是任务边界，不是遗漏。V1 在 12 开发集未过门，扩样本只会放大成本，不会改变“4 分默认”的结构问题。
5. **未做 PR。** AF-231 依赖 AF-229 先合；当前只到分支提交与推送，PR 等 AF-229 状态推进后再开，避免把两个任务的提交混进同一个 PR diff。
6. **summary 标题仍是 AF-227。** 报告生成器沿用 R6-D 协议标题，未按任务号改写；数据与 packet 口径是 AF-231 的 12 开发集。

## 九、下一步

- 等大炮确认 V2 是否按 §6.1–§6.3 实现；未确认前不改 V1。
- 若确认，先做 6 packet 小筛，不直接跑 12。
- AF-229 的锚点校准与 thinking 对照仍未交付；AF-229 仍 ready/submitted 口径需在下一轮先收口，否则 AF-231 的 PR 无法独立合并。

## 十、提交信息

`feat(af231): 增加 Lite 原生评分 prompt V1 与 12 packet 开发集对照`

- 提交：`f41061cd`
- 远端：`origin/task/AF-231-lite-prompt-v1`
- 本记录后续修正（V2 阈值按维度条目数自适应）单独提交，不改变 V1 结果。
