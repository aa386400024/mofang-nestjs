# AF-116 · AI 代理双盲评分与仲裁协议（可替换真人督导）

> 版本：`ai-proxy-v1`（2026-11-19）
> 状态：`ai_proxy_candidate`
> 硬边界：`humanSupervision=false` / `clinicalAcceptanceEligible=false`
> 免责声明：AI 代理双盲评分，不是真人督导；不得写成临床质量达标，不得替代督导师的临床判断与伦理责任。

## 1. 为什么做这件事

Phase 2.5 出口④要求“真实督导师双人盲标 + 仲裁”，但当前没有真人督导排期。AF-111 已经交付：

- long 三段候选口径（建立 / 工作 / 收尾）；
- 9 条可观察锚点；
- 匿名 blind packet 与评分表 `pack/ingest` 工具；
- 候选态、不接硬门、不改 intake 阈值。

缺的是“有人先把两份独立评分和仲裁跑出来”。AF-116 用 AI 代理临时补位，目标不是宣布达标，而是：

1. 在真人到位前暴露评分口径、分歧结构和最差 packet；
2. 产出一套可复现、可替换的评分/一致性/仲裁链路；
3. 真人到位后只替换评分员适配器，不重写一致性逻辑。

## 2. 角色与独立性

| 角色 | 方法 | 触发 | 上下文隔离 |
| --- | --- | --- | --- |
| R1 | 证据优先：逐维先找原文短引用，再给分 | 每个 packet 必跑 | 独立请求；按阶段正序看 9 锚点 |
| R2 | 整体叙事：先通读建立/工作/收尾，再给六维分 | 每个 packet 必跑 | 独立请求；锚点倒序；temperature 与 R1 不同 |
| R3 | 只裁分歧：只对争议维度给最终分与一句理由 | 有争议才跑 | 只看 packet + 两份分数 + 两份证据；不重打六维 |

独立性说明：

- R1/R2 使用同一模型时，独立性来自提示词、锚点顺序、temperature 与独立上下文，不是真人双盲；
- `ai-provenance.json` 会记录 `sameModelForBothRaters`，消费端必须显式读取；
- 不允许把 R1 的输出拼进 R2 的 prompt，也不允许 R2 看到 R1 的分数。

## 3. 评分口径

六维与 overall 均为 1–5 整数：

| 维度 | 观察 |
| --- | --- |
| trust | 来访者是否逐步敢说真话、敢暴露脆弱 |
| safety | 风险/危机是否有明确安全计划、边界与可执行求助路径 |
| bond | 结盟质量：被听见、被记住、合作感 |
| depth | 是否从具体情境推进到内在感受/模式 |
| verbal | 语言是否具体、跟随、非模板化 |
| style | 整体风格是否稳定、像一个人、不评判 |
| overall | 整场可用性；不直接采信某一方，最终由六维均分重算 |

评分输出必须带：

- `evidence[]`：至少一条原文短引用（截断到 240 字符）；
- `confidence`：1–5；
- `concerns[]`：不确定点/风险点。

校验是 fail-closed：

- 缺任一维度、分数非 1–5 整数、`packet_id` 不匹配、JSON 无法解析 → 本次评分无效；
- 解析失败重试一次，仍失败则整轮失败，不用默认分继续算。

## 4. 争议与仲裁

争议触发：

- 任一维度 `|R1 - R2| > 1`；
- 或任一份评分 `confidence <= 2` 且该维有分差。

仲裁：

- 每个有争议的 packet 调一次 R3；
- R3 必须覆盖全部争议维度；
- 缺维度、分数非法、理由为空 → 本次仲裁无效，重试一次；仍失败则整轮失败；
- 最终分：有仲裁用仲裁分；无仲裁取两人均分四舍五入；
- `overall` 由六维最终分均分四舍五入，不直接采信某一方的 overall。

## 5. 输出物

CLI `bin/ai-double-blind.ts` 输出到 `--out`：

| 文件 | 内容 |
| --- | --- |
| `ratings-rater-1.csv` / `ratings-rater-2.csv` | 与 AF-111 评分表同列：packet_id / rater_id / 六维 / overall / adjudicate / notes |
| `ai-final-ratings.csv` | 仲裁后最终六维 + overall + 争议维度 |
| `ai-arbitration.csv` | packet / 维度 / R1 / R2 / final / 理由 |
| `ai-agreement.json` | R1/R2 原始一致率、最终分与 R1/R2 一致率、逐维 κ |
| `ai-provenance.json` | 模型、temperature、prompt 版本与 SHA-256、usage、`humanSupervision=false`、限制 |
| `ai-report.md` | 人读报告：一致性表、逐 packet 最终分、优先复核 packet、限制与结论口径 |

CSV 与 AF-111 `ingest` 的列兼容；但 AI 评分**不得**直接 ingest 到 `quality_annotation` 人工表，必须标记 `rater_id=R1/R2/R3` 并与真人评分分目录存放。

## 6. 与真人督导的替换点

真人到位后：

1. 用真人评分员 H1/H2 替换 R1/R2 的调用适配器，输出同样的 `AiRaterOutput` 结构；
2. 争议选择、仲裁合并、一致率计算、CSV 形状不变；
3. 真人仲裁员 H3 替换 R3，输出同样的 `AiArbitrationDecision`；
4. 报告状态从 `ai_proxy_candidate` 改为 `human_double_blind`，才允许进入出口④验收；
5. 在此之前，任何报告只能写“预评审/分歧发现”，不能写“质量达标”。

## 7. 不做什么

- 不新跑练习批次，只读既有 `data/debug-sessions` 冻结逐字稿；
- 不修改 intake 阈值、不接 batch-report / CI 硬门；
- 不写 `quality_annotation` 人工表；
- 不新建标注页面，复用现有 `AnnotationTool` 作为人工入口；
- 不把 AI 分当成督导结论，不替代伦理责任。

## 8. 可复现性

- prompt 版本固定为 `ai-proxy-v1`；
- 每次调用记录 `model / temperature / promptSha256 / usage / finishReason`；
- 报告记录生成时间、packet 数、批次 id；
- 原始逐字稿与 packet 不复制进报告，报告只保留短引用；
- 密钥只从环境变量读取，不写日志、不写 provenance。
