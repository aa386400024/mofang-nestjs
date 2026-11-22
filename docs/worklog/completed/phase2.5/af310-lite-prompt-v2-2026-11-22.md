# AF-310 · R6-D3 Lite 原生评分 prompt V2 与 6 packet 小筛

- 日期：2026-11-22
- 任务：AF-310（承接 AF-295/AF-299 两次号段冲突前的 V2 实现；priorTasks: AF-227、AF-229、AF-230、AF-231）
- 分支：`task/AF-310-lite-prompt-v2`
- 基线：`75993239`（最新 `integrate`，AF-299 渲染故障矩阵真实回放提交）
- 协议：`ai-realism-cross-model-v1`
- 状态：`ai_proxy_candidate`；`humanSupervision=false`；`clinicalAcceptanceEligible=false`
- 结论：**V2 未通过 6 packet 小筛；不扩 12 packet、不跑 24/48；V2 保留为显式 opt-in 实验变体，不设默认、不进入生产评分。**

## 一、结论先说

V2 按 AF-231 交付记录 §6.1–§6.3 落地：阈值整体下移、全 4 复核、overall 跟最突出/最低/中位数。它确实打散了 V1 的“全 4”：

- 4 分占比从 V1 的 91.67%（22/24）降到 **16.67%**（2/12）。
- 唯一分数从 V1 的 3 个（2/3/4）增到 **4 个**（1/2/4/5）。
- 豆包 std 从 V1 的 0.438986 升到 **1.552328**。

但它没有换来跨模型可复现性：

- 跨模型总体 κ **0.347826**，低于 0.4 门。
- 总体绝对差 **0.75**，远高于 0.3 门，也差于 V1 的 0.208333。
- 同一 packet 在 T=0.1 / T=0.5 下出现 1 分与 5 分两极跳跃（`836fb12e32da5190` 为 1 / 5）。
- 豆包分布从“全 4”变成“偏 5”：`{1:2, 2:1, 4:2, 5:7}`，5 分占 58.33%。

一句话：**V2 用阈值硬切制造了方差，但没有制造跨模型可复现的判断；问题从“4 分安全答案”变成“阈值计数不稳定 + 5 分偏置”。**

因此 6 packet 小筛按预登记规则停止：不扩 12、不跑 24/48，也不再继续堆规则。

## 二、交付内容

### 2.1 新增与修改

- `bin/realism-rater-lite-prompt.ts`
  - 新增 `LitePromptVariant = 'lite-v1' | 'lite-v2'`
  - 新增 `LITE_PROMPT_VERSION_V2 = 'lite-rubric-v2'`；`LITE_PROMPT_VERSION` 仍默认 V1
  - `buildSystem(raterId, variant)` 拆 V1/V2；V1 system 文本逐字保留
  - `buildLiteRaterPrompt(packet, raterId, variant = 'lite-v1')` 默认 V1，V2 显式选择
  - V2 新增：5/4/3/2/1 阶梯、五维最多 2 维给 5、全 4 必须复核最弱维、overall 规则、反“默认 4”
- `bin/realism-rater-runtime.ts`
  - `RaterSpec.promptVariant?: 'shared' | LitePromptVariant`
  - `RaterResolvedConfig.promptVariant`
  - 非豆包使用 Lite 变体 fail fast
  - `[CALL]` 日志增加 `promptVariant`
  - `ratePacketWithRater` 对 Lite 变体走 `buildLiteRaterPrompt`；解析重试仍沿用同一 Lite prompt，不切 shared compact
- `bin/visitor-realism-cross-model.ts`
  - `--doubao-prompt shared|lite-v1|lite-v2`
  - 报告 `models` / `runtime.byRater` / summary 运行时表输出 `promptVariant`
- `test/auto-practice/af229-lite-prompt.spec.ts`
  - 从历史提交 `f41061cd` 导入 V1 契约 12 例，保证 A/B 基线不漂
- `test/auto-practice/af310-lite-prompt-v2.spec.ts`
  - 新增 V2 专项 6 例：版本与默认 V1 保留、阶梯下移、全 4 复核、overall 规则、五维/证据/行协议共用、字数与解析兼容

### 2.2 明确未改

- 未改 `src/engine-core/**`（`git diff --stat HEAD -- src/engine-core` 为空）。
- 未改共享 `buildRealismRaterPrompt`、`parseRealismRatingLines`、AF-214 行协议与既有评分阈值。
- 未改 V5 引擎渲染路径与 AF-278 遥测。
- 未改 Flutter、`admin-dashboard/`。

## 三、6 packet 小筛设计

### 3.1 样本

取 baseline 上分歧最大的 6 个 packet：

| packetId | 场景 | 轮次 |
| --- | --- | ---: |
| `10cecca5021e6af8` | in_person | 18 |
| `836fb12e32da5190` | online_voice | 32 |
| `889820c4d8c93279` | online_voice | 32 |
| `7bca75a765c9cabb` | online_voice | 16 |
| `685b894775c1a07d` | online_text | 12 |
| `751731f1bdd6de99` | online_text | 32 |

### 3.2 对照口径

- 源：`D:\work\Project\backend\mofang-nestjs-af070\data\debug-sessions`（460 候选、60 盲评包），与 AF-231 同一候选池与同一 seed。
- MiniMax：`MiniMax-M3.1-Flash`，shared prompt，`thinking=auto`，T=0.1 / 0.5。
- 豆包：`doubao-seed-2-1-lite-260915`，`lite-v2`，`thinking=auto`，T=0.1 / 0.5。
- 只改豆包 prompt 一个变量；模型、thinking、温度、packet、seed 与 baseline/V1 对齐。
- 报告：`data/phase25-exit/af229-lite-dev-12/v2-screen6/report.json`
- 门槛：`data/phase25-exit/af229-lite-dev-12/v2-screen6/gates.json` / `gates.md`
- 运行日志：`data/phase25-exit/af310-v2-screen6.log`

### 3.3 运行事实

- 完成 6/6，失败 0，截断 0。
- 评分调用 27：MiniMax 15（含 3 次解析重试）、豆包 12。
- 豆包 reasoning 119286；baseline 12 packet 豆包 reasoning 147975，按同量级 12 次豆包评分归一约 **0.806x**。

## 四、结果

### 4.1 门槛逐条

| 门槛 | 阈值 | 实际 | 结果 |
| --- | --- | --- | --- |
| 跨模型总体 κ | ≥ 0.4 | 0.347826 | 未过 |
| 总体绝对差均值 | ≤ 0.3 | 0.75 | 未过 |
| 豆包分数 std | ≥ 0.5 | 1.552328 | 通过 |
| 唯一分数个数 | ≥ 3 | 4 | 通过 |
| 4 分占比 | < 70% | 16.67% | 通过 |
| reasoning 相对 baseline | ≤ 1.3x | 0.806x | 通过 |

**判定：fail。两条硬门（κ、绝对差）未过；按任务单停止扩样。**

### 4.2 分数分布

| 轮次 | 豆包分布 | 均值 | std | 4 分占比 |
| --- | --- | ---: | ---: | ---: |
| baseline 六子集 | `{2:2, 3:6, 4:3, 5:1}` | 3.25 | — | 25% |
| V1 六子集 | `{2:1, 3:1, 4:10}` | 3.833333 | — | 83.33% |
| V2 六子集 | `{1:2, 2:1, 4:2, 5:7}` | 3.916667 | 1.552328 | 16.67% |

V2 的 4 分确实被打散，但主要流向 5 分（7/12），不是流向 3 分。它没有把“安全答案”变成“真实区分”，只是把默认档从 4 推到 5。

### 4.3 逐 packet

| packet | 场景 | MiniMax T01/T05 | 豆包 V2 T01/T05 | 绝对差 |
| --- | --- | --- | --- | ---: |
| `7bca75a765c9cabb` | online_voice | 4/4 | 5/5 | 1 |
| `836fb12e32da5190` | online_voice | 4/4 | 1/5 | 2 |
| `685b894775c1a07d` | online_text | 4/4 | 4/5 | 0.5 |
| `10cecca5021e6af8` | in_person | 2/2 | 2/1 | 0.5 |
| `889820c4d8c93279` | online_voice | 4/4 | 4/5 | 0.5 |
| `751731f1bdd6de99` | online_text | 4/4 | 5/5 | 1 |

`836fb12e32da5190` 是结构性问题的最小样本：T=0.1 给 1，T=0.5 给 5。同一 prompt、同一 packet、只换温度，跨两档反转。这不是“更敏感”，而是评分规则没有稳定到可复现。

### 4.4 一致性

| 指标 | V2 | V1（12 packet） | baseline（12 packet） |
| --- | ---: | ---: | ---: |
| 跨模型总体 κ | 0.347826 | 0.333333 | 0.361702 |
| exact | 0.5 | 0.75 | 0.583333 |
| within±1 | 0.833333 | 1 | 1 |
| 总体绝对差 | 0.75 | 0.208333 | 0.416667 |

V2 的 κ 只比 V1 高 0.014493，仍低于 baseline 和 0.4 门；绝对差反而从 0.208333 恶化到 0.75。**这不是改进。**

## 五、诊断

1. **阈值计数对小模型不是稳定判据。** V2 把 5/4/3 都绑定到“命中 5 分档的条数”。Lite 对同一条行为是否“命中”的判定随温度漂移，条数一变，分数跨两档。V2 把评分从“整体判断”改成“计数判断”，放大了这种噪声。
2. **全 4 复核只在全 4 时触发，没解决非全 4 的默认。** V2 的 4 分打散后，模型转向 5 分；全 4 复核没有覆盖“四维 5 + 一维 4”这种新集中形态。
3. **overall 跟最突出维度放大了高分偏置。** 任一维 5 且无 ≤2 就 overall=5，使单维高分直接把总体拉到 5；在 Lite 不稳定命中 5 档时，这个规则把噪声传到了 overall。
4. **根因不在规则数量。** AF-231 §6.4 已预登记“不过门就停止加规则”；V2 的证据正好验证这条。继续加规则会增加 prompt 长度与 reasoning，不会恢复跨模型可复现性。

## 六、决定与后续建议

- V2 不设默认：`buildLiteRaterPrompt` 默认仍 `lite-v1`；CLI 默认仍 `shared`；V2 只能显式 `--doubao-prompt lite-v2` 复现实验。
- 不扩 12 packet、不跑 24/48。
- 不把 V2 用于生产评分、告警、准入或对外质量声明。
- 产品判断建议：**放弃“Lite 作为独立绝对评分员”路线**。若仍需低成本第二信号，优先改为成对比较/强制选择（同一 packet 两版二选一），或让 Lite 只做缺陷检测（是否出现 AI 暴露、OOC、媒介穿帮），不再让它输出 1–5 绝对分。该建议未在本任务实现，需另行立项并由大炮确认。

## 七、闸门与验证

在本分支 `task/AF-310-lite-prompt-v2` 上复跑：

- `pnpm exec vitest run test/auto-practice/af229-lite-prompt.spec.ts test/auto-practice/af310-lite-prompt-v2.spec.ts`：2 files / 18 tests 通过，exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm lint`：exit 0，0 error / 0 warning。
- `pnpm test`：281 files passed / 1 skipped（282 files）；4377 tests passed / 8 skipped（4385 tests），exit 0。
- `git diff --stat HEAD -- src/engine-core`：输出为空。
- 闸门日志：`data/phase25-exit/af310-typecheck.log`、`data/phase25-exit/af310-lint.log`、`data/phase25-exit/af310-full-test.log`。

`test/auto-practice/af229-calibration-analysis.spec.ts` 在当前 `integrate` 树不存在，未纳入定向执行；AF-231 记录中的该文件属于当时分支。

## 八、偏差与边界

1. **AF-295 号段被并行任务占用，后续 AF-299 又发生同号段冲突，最终重发为 AF-310。** 实现与 6 packet 小筛先在 `8fedf002` 基线的 `task/AF-295-lite-prompt-v2` 完成；并行进程随后在 `integrate` 上用 AF-295 交付“smoke 双候选故障注入”（`bbc48ee4`）并归档，故在 `eb30f22f` 重发 AF-299。AF-299 归档并创建 PR #144 后，`integrate` 又被另一条同号段“渲染故障矩阵真实回放”（`75993239`）占用，PR 合并报 405 冲突。按号段不复用、状态面不可手改，本轮在 `75993239` 上第三次重发 AF-310；代码从 `88a7f763`/`4d0cb4d2` 逐字继承，5 个代码/测试目标文件在 `8fedf002..75993239` 区间无变更，6 packet 结果与模型配置一并沿用，未重复烧 token。
2. **首次 2 packet smoke 使用了 Pro 模型与 `thinking=disabled`。** 该次只验证端点连通，不作为证据；正式 6 packet 已改回与 baseline 一致的 Lite + `thinking=auto`，并重跑全部 6 packet。中途两次误配运行在发出评分请求前停止，未进入报告。
3. **报告生成器标题仍是 AF-227 协议标题。** 数据与 packet 口径是 6 子集；不改生成器标题，避免扩大范围。
4. **6 packet 样本小。** κ 抽样误差大，只用于小筛门；不据此做临床或生产结论。
5. **reasoning 对比按调用量级归一。** V2 是 6 packet × 2 通道 = 12 次豆包评分；baseline 是 12 packet × 2 通道 = 24 次。用 baseline 12 packet 豆包 reasoning 总量对比 V2 的 12 次评分，不是逐 packet 同集对比，已在 gates.json 注明。
6. **评分双方均为 AI 代理。** 不是真人督导双盲，不构成临床质量达标证据。

## 九、提交信息

`feat(af310): 增加 Lite 评分 prompt V2 与 6 packet 小筛负结果`
