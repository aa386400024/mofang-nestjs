# AF-116 · AI 代理双盲评分与仲裁交付记录

> 任务：`AF-116`（AI 代理双盲评分与仲裁链路，可替换真人督导）
> 分支：`task/AF-116-ai-double-blind`
> 基线：`93dd8dbcf62c20d5fa0295fc29fc3f7814aac724`
> 日期：2026-11-19
> 结论：实现与真实运行均通过；出口④仍为「❌ 未通过 / 不可判定」，本单只提供 AI 预评审证据，不提供临床验收结论。

## 1. 交付内容

| 文件 | 作用 |
| --- | --- |
| `src/auto-practice/metrics/ai-double-blind.ts` | AI 代理双盲纯函数：评分解析 fail-closed、争议选择、仲裁合并、一致率汇总、R1/R2/R3 提示词 |
| `bin/ai-double-blind.ts` | CLI：`run` 读 AF-111 pack 目录跑 R1/R2/R3；`rebuild` 从评分 CSV 重建一致率与报告表 |
| `test/auto-practice/ai-double-blind.spec.ts` | 14 个定向用例：合法/围栏+think/缺维/越界/packet 不匹配、争议、低置信度、仲裁、合并、提示词独立性 |
| `docs/worklog/completed/phase2.5/af116-ai-double-blind-panel-protocol-2026-11-19.md` | 协议：角色独立、评分口径、争议规则、输出物、真人替换点、已知限制 |
| `docs/worklog/pending/phase2.5-README.md` | §3.2 增加 AF-116 预评审段与出口条件表更新 |

实现要点：

- 复用 AF-111 的 `LONG_SESSION_DIMENSIONS`、9 条锚点、`buildBlindPacket`、`summarizeAgreement`，不复制第二套六维或卡帕实现。
- R1 证据优先、锚点正序、temperature=0.1；R2 整体叙事、锚点倒序、temperature=0.7；R3 只裁争议维度。
- 评分 JSON 非法、缺维、越界、packet 不匹配 → 本次评分无效；解析失败重试一次，仍失败整轮失败。
- 争议：任一维分差 >1，或任一评分 `confidence<=2` 且该维有分差；R3 必须覆盖全部争议维。
- 最终分：有仲裁用仲裁分，无仲裁取均分四舍五入；overall 由六维最终分均分重算。
- 输出带 `ai_proxy_candidate` / `humanSupervision=false` / `clinicalAcceptanceEligible=false`，不写 `quality_annotation`。

## 2. 真实运行证据

运行命令：

```powershell
pnpm exec tsx bin/ai-double-blind.ts run \
  --pack-dir "$env:TEMP\af116-blind-pack" \
  --out "$env:TEMP\af116-ai-run-final3" \
  --max-packets 8 --max-completion-tokens 8192 --timeout-ms 600000 --concurrency 4
```

样本：AF-109 批次 `q_35XnpvLWLr-Yocr8kJh` 的 16 场有效 long 会话，用 AF-111 `pack --limit 8` 均衡取 8 个匿名 packet（7 个 100 条消息 / 1 个 42 条消息）。

调用与 token：

| 项 | 数字 |
| --- | --- |
| packet | 8 |
| 模型调用 | 17（R1=8 / R2=8 / R3=1） |
| prompt tokens | 85,964 |
| completion tokens | 65,242 |
| total tokens | 151,206 |
| 模型 | `MiniMax-M3`（R1/R2/R3 同模型） |
| `sameModelForBothRaters` | true |

一致率（R1/R2 原始分，8 对配对）：

| 维度 | n | exact | within±1 | 线性加权 κ |
| --- | --- | --- | --- | --- |
| trust | 8 | 0.625 | 1 | 0.478261 |
| safety | 8 | 0.625 | 1 | 0.294118 |
| bond | 8 | 0.625 | 1 | 0.478261 |
| depth | 8 | 0.375 | 1 | 0.2 |
| verbal | 8 | 0.75 | 1 | 0.384615 |
| style | 8 | 0.75 | 0.875 | 0 |
| overall | 8 | 0.25 | 1 | 0 |

最终分（overall）：8 个 packet 为 4/4/4/4/4/4/4/5，6 个 4、2 个 5，无 overall≤2。六维最低为 safety=3（packet-03/04/05/06/08）、bond=3（packet-07/08）、trust=3（packet-07）。**AI 分偏高，不能当成合格证据。**

仲裁：仅 packet-01 的 `style`（R1=5 / R2=3）触发 R3，最终 4，理由为“第 28 轮结构清晰、第 50 轮借意象提供安静陪伴”；其余 7 个 packet 无争议。

运行产物（未入库，仅作本次证据）：

- `ratings-rater-1.csv` / `ratings-rater-2.csv`
- `ai-final-ratings.csv`
- `ai-arbitration.csv`
- `ai-agreement.json`
- `ai-provenance.json`（含 prompt SHA-256、模型、温度、usage）
- `ai-report.md`

位置：`$env:TEMP\af116-ai-run-final3`。仓库内不复制逐字稿或原始评分，只保留本记录与协议。

## 3. 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts` | exit 0；1 file / **14 tests passed** |
| 类型检查 | `pnpm typecheck` | exit 0；0 error |
| boundary | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | exit 0；1 file / **12 tests passed** |
| lint | `pnpm lint` | exit 0；**0 error / 0 warning** |
| 任务单 schema | `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/af116-ai-double-blind-panel-task-2026-11-19.md` | exit 0；AF-116 任务单与运行态任务单 PASS |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | exit 0；503 条事件，哈希链与索引投影一致 |
| 空白检查 | `git diff --check` | exit 0；无空白错误、无 CR |

补充说明：

- 运行中修复了真实踩到的 4 个问题：① `extractJsonPayload` 返回字符串，必须先 `JSON.parse`；② `summarizeAiAgreement.rawOverall` 原先把六维配对池当 overall，n 变成 `packet*6`，改为单独 overall 配对；③ 4096 completion tokens 被 M3 的 `<think>` 吃光导致 JSON 截断，默认提到 8192；④ 单次 180s 超时会中断整批，改为 600s + 传输重试；并加 `--concurrency` 避免 8 packet 串行过慢。
- `rebuild` 子命令已在 2-packet 试点输出上验证：`rawOverall.n` 从错误的 12 修正为 2。

## 4. 边界与合规

- 结果状态：`ai_proxy_candidate`；`humanSupervision=false`；`clinicalAcceptanceEligible=false`。
- 不冒充真人督导，不写“临床质量达标”，不写 `quality_annotation` 人工表，不接 batch-report / CI 硬门。
- 不新跑 LLM 练习批次；只读既有冻结逐字稿与 AF-111 pack。
- 文本盲标只去结构化身份字段，台词仍可能带角色/职业/关系线索；同一模型三角色仍有自偏好，独立性有限。
- 真人到位后替换 R1/R2/R3 适配器，评分校验、争议选择、合并、一致率与 CSV 形状不变；报告状态改为 `human_double_blind` 后才允许进入出口④验收。

## 5. 偏差

| 项 | 任务单 | 实际 | 处置 |
| --- | --- | --- | --- |
| 运行产物位置 | 任务单允许 `--out` 指定、默认不入库 | 本次写入 `$env:TEMP\af116-ai-run-final3`，未入库 | 符合任务单边界；仓库只留脱敏摘要 |
| 并发 | 未指定 | 增加 `--concurrency`，本次 4 | 只影响吞吐，不改变评分与仲裁语义 |
| 协议落点 | `docs/worklog/completed/phase2.5/` | 同左 | `docs/clinical/` 不在 executor 资源域，沿用 AF-111 做法 |

## 6. 遗留

- **OI-AF116-01**：真实督导师双人盲标 + 仲裁仍未发生；出口④仍不可判定。owner：clinical-supervisor。
- **OI-AF116-02**：AI overall 与六维均分不一致时，当前以六维均分为准；真人到位后需复核该规则。owner：orchestrator。
- **OI-AF116-03**：packet-07 第 19 轮“先别继续呼吸，等自然恢复”是“停止呼吸练习”的歧义表述；虽随后给出 120 红线与陪伴安排，仍建议真人优先复核措辞。owner：clinical-supervisor。
- **OI-AF116-04**：同模型 R1/R2/R3 无法消除模型自偏好；若后续接入第二家 provider，可把 R2 换独立模型再评估一致率。owner：orchestrator。

## 7. DoD 核对

- [x] R1 证据优先 / R2 整体叙事 / 独立上下文与独立评分表
- [x] 分差 >1 或低置信度触发 R3，输出最终分与仲裁理由
- [x] 明确标记 `ai_proxy_candidate` / `humanSupervision=false` / `clinicalAcceptanceEligible=false`
- [x] 5 轮与 50 轮均可用：packet 只读匿名逐字稿，不依赖库内会话
- [x] 真实运行 8 个 packet，产出 agreement / final ratings / provenance / limitations
- [x] 真人到位可直接替换 R1/R2/R3 适配器，不重写评分与一致性逻辑
- [x] 定向单测 / typecheck / lint 绿
- [ ] 出口④临床质量达标（本单不声称；需真人督导）
