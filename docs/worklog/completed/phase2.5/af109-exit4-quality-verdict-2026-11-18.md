# AF-109 交付记录：出口④ WP-K 四态判定与 8 角色 long 批次复测

- 任务单：`docs/worklog/pending/af109-exit4-quality-verdict-task-2026-11-18.md`
- 基线：`b739b6a821a15260fdc93c74382f17f5cc852428`（AF-108 合并 SHA）
- 类型：documentation（质量取证，不改 `src/`、不改 `engine-core`）
- 快照：2026-11-18 23:45 CST

## 1. 正式结论

**出口④：❌ 未通过 / 不可判定；不能写“质量达标”。**

- 管道与逐字稿清洁度 **达标**；
- WP-K 对 96 场基线为 **`incomparable`**（acceptance 判据漂移），不存在 improved / neutral / regressed；
- 无真实督导师双人盲标 + 仲裁，80% 临床准确率仍无真值；
- `intake` 的 12 轮判据被套到 50 轮 long 批次，属口径不匹配，不能当 50 轮质量硬门。

## 2. 批次

| 项 | 值 |
| --- | --- |
| batchId | `q_35XnpvLWLr-Yocr8kJh` |
| 角色 | 8 个 approved（A 类 4 + B 类 4） |
| 模式 | `expert` + `cold` |
| 重复 | 1 次 → 16 个角色×模式组合 |
| 档案 | `long`，`maxTurns=50` |
| 组合完成 | **16/16 completed** |
| 有效样本 | **16 场 / 710 轮** |
| 库内行 | 17 行 / 748 轮（含 1 个 failed/interrupted 旧会话，38 轮不计入） |
| batchHealth | `valid=true`、`flags=[]`、`llmCallRatio=0.9412`、`fallbackRatio=0`、`counterConsistent=true` |

失败旧会话：workplace / cold 第 38 轮服务进程退出，BullMQ 重跑为同角色同模式新会话并完成 50 轮；旧 38 轮作为 `failed` 保留在库内，**不并入质量样本**。

轮次分布：10 场 50 轮；1 场 `natural_close` 44 轮；3 场 `crisis_practice_max` 30 / 21 / 15 轮；1 场 interrupted 38 轮不计入。

## 3. 逐字稿审计

| 项 | 结果 |
| --- | --- |
| 来访者消息 | 710 |
| 咨询师消息 | 710 |
| 来访者 `<think>` 泄漏 | **0 / 710** |
| 咨询师 `<think>` 泄漏 | **0 / 710** |
| 咨询师空输出 | **0 / 710** |
| 剥离推理块后可见空输出 | **0 / 710** |
| 咨询师完全重复 | **0** |

按模式：`expert` 8 场 / 339 轮、`cold` 8 场 / 371 轮，两项泄漏与空输出均为 0。

## 4. WP-K 四态

命令：

```text
corepack pnpm exec tsx bin/batch-report.ts \
  --batch q_35XnpvLWLr-Yocr8kJh \
  --baseline-snapshot data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json \
  --format both --fail-on-incomparable
```

结果：**exit 2；`[q_35XnpvLWLr-Yocr8kJh] incomparable — 两批验收判据 (acceptance) 不同`**。

- 基线 96 场 `acceptance=f604fdaca19e87b5`、`combined=491558624aeafdb3`；
- 候选 `acceptance=4474dd5be381d905`、`combined=e1d4b3118bf55fa2`；
- 角色集合 / 模式集合本轮已对齐（8 角色 × expert+cold），不可比只剩 acceptance 判据；
- 按 WP-K fail-closed 设计，不能输出 improved / neutral / regressed，更不能写达标。

## 5. intake

- 全局 **FAIL**，唯一项 `session.zero_motion=2`；
- `expert` 8 场另报 `trust Δ=0.38925`、`bond Δ=0.049` 超 intake-v1 上限；`cold` 9 场（含失败旧会话）`zero_motion=2/9`。
- **口径不匹配（本轮新发现）**：intake-v1/v2 的判据是首次会谈约 12 轮；本批是 long / 50 轮，全时段 delta 直接套 12 轮阈值会把“长程结盟增长”误判为“快速理想化”。因此 intake 结果只进人工复核，**不作为 50 轮临床质量硬门**，也不反向证明来访者质量不合格。

## 6. 数据积累

`ap_practice_sessions` 复核（2026-11-18 23:45）：

- 总 111 行 / 1877 轮；
- completed 60 场 / 1496 轮；
- stagnant 39 / 323；failed 11 / 38；crisis_ended 1 / 20；
- 本批新增 17 行 / 748 轮（其中 completed 16 / 710）；
- 以 completed 计距 1000 场差 **940 场** → 出口⑤仍未达标。

## 7. 闸门

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 批次健康 | `GET /admin/api/auto-practice/batches/q_35XnpvLWLr-Yocr8kJh` | `valid=true`、flags 空 |
| WP-K | 见 §4 | exit 2，`incomparable`（预期 fail-closed，不是工具失败） |
| 逐字稿审计 | `node data/phase25-exit/af109-batch-audit.mjs q_35XnpvLWLr-Yocr8kJh` | 16 场 / 710 轮，四类泄漏与空输出均 0 |
| 数据库计数 | MySQL `ap_practice_sessions` 聚合 | 111 / 1877；completed 60 / 1496 |

## 8. 结论与后续

- **本轮完成的**：8 角色补池、50 轮真实批次、推理块零泄漏、咨询师空输出零、WP-K 正式 CLI 判定、README §3.2 回写、数据积累更新。
- **本轮不能完成的**：临床质量 80% 达标。缺两样硬前提：① 与 50 轮匹配的临床验收口径（不能复用 12 轮 intake）；② 真实督导师双人盲标 + 仲裁真值。
- **建议下一任务**：`long-session-acceptance-profile`——按 40–50 轮会谈阶段重定 anchor（trust/bond/depth/style 分段），先在 100–200 轮试点，不得用代码常量冒充临床阈值。

证据：`data/phase25-exit/af109-exit4-evidence-2026-11-18.json`。
