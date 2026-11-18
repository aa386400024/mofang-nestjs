# long 50 轮候选验收口径与双人盲标协议（AF-111）

> 状态：**候选（candidate）**，不产生 PASS/FAIL，不接入 `batch-report` / CI 硬门，不修改 intake 阈值。
> 未取得真实督导师双人盲标 + 仲裁前，本文任何内容都不得写成“临床质量达标”。
> 版本：`long-v0-candidate`（2026-11-19）

## 1. 为什么需要单独一套 long 口径

`intake-v1/v2` 是**首次会谈约 12 轮**的判据：看开场同盟、安全感、首轮信任变化，并用全时段 delta 判断是否“快速理想化”。

50 分钟真实咨询通常 40–50 轮，包含建立、工作、收尾三段。把全时段 delta 直接套 12 轮阈值，会把正常的结盟增长误判成快速理想化，也会把收尾整合漏掉。AF-109 的 16 场 long 批次已经实测到这一点：管道与逐字稿清洁度达标，但 intake 全局 FAIL，不能据此写“来访者质量不合格”。

因此 AF-111 只做两件事：

1. 给 long 会谈一套**按阶段看**的观察锚点；
2. 给真实督导师一套**可执行的双人盲标 + 仲裁工具**。

它**不**做第三件事：不把候选锚点变成硬门。

## 2. 三段边界

| 阶段 | 轮次 | 临床任务 | 不要求 |
| --- | --- | --- | --- |
| engagement 建立 | 1–12 | 结盟、知情同意、框架与安全、允许暂停 | 不要求深挖、不要求明显 BDI 增长 |
| working 工作 | 13–40 | 具体情境→内在感受的推进、阻抗/移情命名与修复、自主探索、情绪调节 | 不要求每轮都“有效”，允许沉默与绕行 |
| closing 收尾 | 41–50（可提前自然收尾） | 收束、整合、可带走的一句话/下一步、风险与边界 | 不强行拉满 50 轮；危机协议可提前结束 |

边界实现：`resolveLongSessionPhase(turnIndex)`，`<=12` → engagement，`<=40` → working，`>=41` → closing。

## 3. 9 条观察锚点

锚点是给督导师评分时的**观察提示**，不是机器判据；评分人按 1–5 分给分，工具只算一致性，不算临床准确率。

| # | 阶段 | 维度 | 观察问题 | 正例 | 反例 |
| --- | --- | --- | --- | --- | --- |
| 1 | engagement | trust | 前 12 轮是否出现“愿意再谈一次”的微小信号？咨询师是否接住，而不是急着推进？ | 来访者从试探/回避转向具体描述，咨询师用复述/确认接住 | 连续追问事实，来访者只给短答；或过快承诺“会好起来” |
| 2 | engagement | safety | 是否建立会谈框架（时间、保密、边界、可以停）？来访者的“不敢说”是否被正常化？ | 明确说明可以慢、可以不说；试探性披露后没有被评判 | 未说明边界就深挖创伤；或把沉默当成不配合 |
| 3 | working | depth | 13–40 轮是否出现至少一次“具体情境→当时的内在感受”的推进？ | 从工作场景推进到“当时其实挺难受/有点怕”，并停留、扩展 | 50 轮仍在列问题清单、反复讲同一件事，没有向内移动 |
| 4 | working | verbal | 是否出现来访者自己带出的新细节/新角度，而不是咨询师单方面提问？ | 来访者主动补充此前没提过的场景或念头，咨询师跟随而非换题 | 问题密度过高，只回答不探索；或话题频繁跳跃 |
| 5 | working | process | 出现阻抗、沉默、迟到/讨好/贬低咨询师时，是否被命名并修复？ | 把“你刚才好像往后退了一点”放回对话，来访者能回应并继续 | 阻抗被忽略或被解释成“你在防御”；修复失败后直接换话题 |
| 6 | working | arousal | 情绪被激活后，咨询师是否帮助来访者回到可承受窗口，而不是继续加码？ | 降低节奏、锚定当下、给选择；arousal 回落并能继续 | 持续深挖导致 shutdown/解离；或过早安抚把情绪压平 |
| 7 | closing | bond | 41–50 轮是否收束到“这次谈到了什么/带走什么/下次想从哪里开始”？ | 来访者用自己的话说出新理解或下一步，咨询师不替她总结 | 结束时仍在开新话题；或给一长串建议，来访者只点头 |
| 8 | closing | safety | 若涉及风险/危机，是否有明确的安全计划、边界与“可以怎么做”？ | 有具体联系人/求助路径/下次时间；来访者知道可以停或求助 | 只做情绪安抚，没有具体计划；或把风险轻描淡写 |
| 9 | closing | style | 整体语言是否稳定、具体、不模板化、不评判？是否像“一个人”，而不是话术库？ | 短句、具体、跟随来访者用词；阶段间语气有变化但一致 | 重复模板句、过度解释、用“你应该”评判；或前后风格断裂 |

实现：`LONG_SESSION_REVIEW_ANCHORS`。锚点修改必须升版本，并另立任务，不在评分阶段随手改。

## 4. 双人盲标流程

### 4.1 角色

| 角色 | 职责 | 可以看到 |
| --- | --- | --- |
| PI / 研究负责人 | 生成 packet、保管解盲映射、执行 ingest、组织仲裁 | `blind-map.json`、全部 packet、两份评分表、一致性结果 |
| 评分人 R1 | 独立阅读 packet，按六维打分 | 只拿 `packets/` + `ratings-rater-1.csv` |
| 评分人 R2 | 独立阅读 packet，按六维打分 | 只拿 `packets/` + `ratings-rater-2.csv` |
| 仲裁人 | 只看分歧 packet 与两份分数，给最终分 | 分歧 packet、两份分数、锚点表；不需要看全量 |

### 4.2 生成 packet

```powershell
pnpm exec tsx bin/long-session-acceptance.ts pack `
  --batch q_35XnpvLWLr-Yocr8kJh `
  --limit 8 `
  --out data/phase25-exit/long-session-blind/q_35XnpvLWLr-Yocr8kJh
```

输出：

- `packets/packet-01.md` …：匿名会谈记录，只有轮次、角色、文本；
- `ratings-rater-1.csv` / `ratings-rater-2.csv`：两份独立评分表；
- `blind-map.json`：packet → debugSessionId / characterSlug / counselorModeId 的**解盲映射**，只给 PI / 仲裁人；
- `README.md`：评分说明 + 9 条锚点。

取样规则：只取 `completed` 会话，按 `expert` / `cold` 两档各自洗牌后交替取样，避免样本偏一档；不新跑 LLM 批次。

### 4.3 匿名化边界

packet **不包含**：`debugSessionId`、`title`、`characterSlug`、`characterLabel`、`scenarioType`、`counselorModeId`。

packet **仍可能包含**：来访者台词里的角色线索、职业/关系信息、咨询师风格线索。这是文本盲标的已知边界，不宣称完全匿名；评分人不得根据台词猜角色后去查库。

### 4.4 评分表

CSV 列：

`packet_id,rater_id,trust,safety,bond,depth,verbal,style,overall,adjudicate,notes`

- 六维 1–5 分：1=明显差，3=可接受，5=明显好；
- `overall` 为整体印象，不参与逐维 κ；
- 任一 packet 认为需要第三方仲裁：`adjudicate=yes`，`notes` 写一句理由，不写人名/角色名；
- 两份 CSV 在回传前**不得互相查看**，不得先讨论再打分。

### 4.5 回收与一致性

```powershell
pnpm exec tsx bin/long-session-acceptance.ts ingest `
  --rater1 <R1.csv> --rater2 <R2.csv> `
  --out data/phase25-exit/long-session-blind/<batch>/ingest
```

输出：

- `agreement.json`：逐维 `n` / `exactAgreement` / `withinOneAgreement` / `linearWeightedKappa`，以及 overall；
- `adjudication.csv`：`packet_id, dimensions, max_gap, reason`。

判读（**试点参考，不是硬门**）：

- 逐维 κ `<0.6`：评分口径未对齐，先做 2–3 个 packet 的校准会，再扩样本；
- `0.6–0.8`：对分歧 packet 做仲裁；
- `>=0.8`：才可讨论“是否值得升级为硬门”，仍需真实样本量与每维 signal 门槛。

仲裁规则：任一维分差 `>1`，或任一评分人 `adjudicate=yes`，进入仲裁清单。仲裁只解决“这个 packet 该几分”，不反过来改锚点；锚点要改须另立任务。

## 5. 候选状态与升级条件

当前：`LONG_SESSION_ACCEPTANCE_STATUS='candidate'`、`gateEligible=false`。

**不接入**：

- `batch-report` / WP-K 四态；
- CI required checks；
- `acceptance-thresholds.ts` 的 intake-v1/v2 阈值；
- 任何“质量达标”自动结论。

升级为硬门的前置（当前均未满足）：

1. 至少 100–200 轮真实督导师双人盲标 + 仲裁；
2. 六维 κ / MAE 与仲裁率达到 AF-091 协议门槛；
3. 锚点在至少 2 个独立批次上稳定，不随角色/模式漂移；
4. 另立任务、单独评审，不在评分或取证任务里顺手升级。

## 6. 本轮实测证据

| 项 | 命令 / 证据 | 结果 |
| --- | --- | --- |
| 定向单测 | `vitest run test/auto-practice/af111-long-session-acceptance.spec.ts` | 8/8 passed |
| pack 冒烟 | `pack --batch q_35XnpvLWLr-Yocr8kJh --limit 2` | 2 packet（22 KB / 28 KB），评分表与解盲映射生成 |
| ingest 冒烟 | 手工填 2 packet / 12 评分对 | `agreement.json` 逐维 κ 输出，仲裁清单 1 条 |
| summarize 冒烟 | 单场 50 轮 transcript | 三段汇总正常输出，`gateEligible=false` |

真实督导师评分尚未产生；以上只证明工具可执行，不证明临床质量。

## 7. 已知限制与遗留

1. **真实督导师缺口**：人员 / 排期未定；工具不能替代真人判断。
2. **文本盲标不彻底**：只能去除结构化身份字段，不能去除台词内的角色线索。
3. **`docs/clinical/` 不在 executor 资源域**：本协议暂落 `docs/worklog/completed/phase2.5/`；若要迁回临床目录，须另立任务并调整 Agent Card resources。
4. **κ 样本量**：2 packet / 12 评分对只能冒烟，不能作为一致性结论；试点建议至少 8 packet（约 400 轮）。
5. **未计算 MAE**：本工具只算 κ 与 ±1 一致率；AF-091 协议里的 MAE 门槛需在后续任务补实现，不在本单冒充。
6. **升硬门未发生**：任何“质量达标”写法都属伪造。

## 8. 参考

- AF-109 出口④判读：`docs/worklog/completed/phase2.5/af109-exit4-quality-verdict-2026-11-18.md`
- AF-091 六维临床标注协议：`docs/worklog/completed/phase2.5/af091-*`
- 候选实现：`src/auto-practice/metrics/long-session-acceptance.ts`
- CLI：`bin/long-session-acceptance.ts`
- 单测：`test/auto-practice/af111-long-session-acceptance.spec.ts`
