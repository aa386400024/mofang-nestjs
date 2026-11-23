# AF-415 A′ 在场判定精确率评估器与分层抽样 — 交付记录

- 日期：2026-11-24
- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-415/task-sheet.md`
- 基线：`32be0ed0f03e4f27655c6f4823c5a0cbcd74a47d`
- 角色：orchestrator

## 一、要解决的问题

AF-409 把在场候选收窄成 A′，157 个 neutral 轮里命中 117；AF-412 已证明 100% 误判时整批 safety +0.4660 / bond +0.2320。但“命中里有多少是真的”一直缺人工标注，精确率无法计算，因此不能决定是否上线。

本单不做自动判定“真假”，而是把**标注 → 计算**这条链做成可复现工具，让后续人工标注有固定入口。

## 二、新增

### 2.1 `scripts/ops/quality/af415-presence-precision-eval.mjs`

纯函数：

- `buildPrecisionSample(rows, options)`：按 `sessionId` 分组，每场最多 3 条 holding、2 条非 holding，总量封顶 40；按 sessionId 排序、按输入顺序取前 N，保证同一批数据每次得到同一张表。
- `toSampleCsv(sample)`：固定四列 `sessionId,turnIndex,predicted,humanLabel`，人工标签留空；CSV 转义支持逗号 / 引号 / 换行。
- `parseLabelsCsv(text)`：跳过空标签；只接受 `holding / cold / neutral`，非法标签直接抛错，避免拼错标签污染指标。
- `computeBinaryMetrics(tp, fp, fn, tn)`：precision / recall / F1 / accuracy / coldRecall；分母为 0 时返回 0，不产生 NaN。
- `evaluatePrecision(predictions, labels)`：混淆矩阵 + 逐场分解 + `unmatched` 计数（标签指向不存在的预测行时单列，不污染矩阵）。
- `loadPredictionRows(dir)`：读 `data/debug-sessions`，只返回 `sessionId / turnIndex / predicted`，不返回对话原文。

CLI：

- `--sample-out <csv>`：生成待标注表；
- `--labels <csv>`：读人工标签出报告；
- 两者都不打印咨询师原文。

### 2.2 `scripts/orchestration/__tests__/af415-presence-precision-eval.spec.mjs`

8 条用例：分层配额、确定性排序、CSV 四列且无中文原文、空标签跳过、非法标签拒绝、混淆矩阵数值、逐场分解、未匹配计数。

## 三、实测

```text
场次 13 | neutral 轮 157
A′ holding=117 非 holding=40
抽样 40 行 → .tmp/af415-precision-sample.csv
```

抽样构成：24 条 holding、16 条非 holding（1 条 cold + 15 条 neutral），覆盖 10 个会话；抽样表只有会话 id、轮次、预测标签、空的人工标签列。

用“预测=标签”的合成 CSV 做通路烟测：`已标注 40 | TP=24 FP=0 TN=16`，precision 1.0000。**这不是真实精确率**，只证明 CSV 解析、匹配、指标计算链路可用；真实数字必须等人工标注。

## 四、设计取舍

1. **确定性抽样，不做随机**：随机抽样每次结果不同，无法复现“上次那 40 条”；按 sessionId 排序 + 取前 N 可复现、可增量替换。
2. **只输出索引，不输出文本**：标注人需要在本机打开 `data/debug-sessions` 看原文；工具本身不落任何心理内容，避免把逐字稿带进 docs / 日志。
3. **非法标签 fail-fast**：标签拼错（如 `holding_present`）如果被静默当作非 holding，会系统性拉低 precision；直接拒绝比“猜”安全。
4. **`unmatched` 单列**：人工可能标到抽样表之外的行；这些行不计入混淆矩阵，但计数暴露出来。
5. **coldRecall 一并给出**：A′ 把 1 条 cold 判成 holding，cold 召回比总体 precision 更能反映“该冷的时候没冷”。

## 五、闸门

| 闸门     | 命令                                                                                                      | 结果                                                                |
| -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 定向单测 | `pnpm exec vitest run scripts/orchestration/__tests__/af415-presence-precision-eval.spec.mjs`             | 8/8 全绿，283ms                                                     |
| 抽样脚本 | `node scripts/ops/quality/af415-presence-precision-eval.mjs --sample-out .tmp/af415-precision-sample.csv` | exit 0；13 场 / 157 轮 / 117 holding；样本 40 行                    |
| Lint     | `pnpm lint`                                                                                               | 0 error；仅 pnpm `node>=26` engine warning                          |
| 类型     | `pnpm typecheck`                                                                                          | 0 error                                                             |
| 内核边界 | `git diff --stat HEAD -- src/engine-core`                                                                 | 空                                                                  |
| 全量测试 | `pnpm test`                                                                                               | 317 passed / 1 skipped（318 文件），4798 passed / 4 skipped，25.40s |

全量测试在交付前跑一次，数字以当次输出为准。

## 六、遗留

- 真实精确率仍未产生：需要人工按 `humanLabel` 填 40 行（可分批），再跑 `--labels`。在标注完成前，任何“A′ 可以上线”的结论都不成立。
- 抽样配额是经验值（每场 3 holding / 2 非 holding、总量 40），不是统计功效推导；若要 95% 置信区间，应改用比例抽样公式重算样本量。
- 本单只评估 A′；B′/C′ 若要比较，需要复用同一批人工标签分别预测。
