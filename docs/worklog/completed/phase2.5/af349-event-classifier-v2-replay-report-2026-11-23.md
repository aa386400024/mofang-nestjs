# AF-349 · 规则分类器 v2 真实语料回放报告

- 生成时间：2026-11-23
- 语料：`data/debug-sessions/` 11 个真实 debug 会话 JSON
- 轮次：176 条 counselor 消息
- 对照：`RuleBasedClassifier()`（legacy）vs `RuleBasedClassifier({ semantics: 'v2' })`
- 复现命令：
  `pnpm exec tsx bin/af347-event-classifier-v2-replay.ts --dir data/debug-sessions --out data/phase25-exit/af349-event-classifier-replay/report.json`
- 机读结果：`data/phase25-exit/af349-event-classifier-replay/report.json`

## 1. 结论先行

v2 在同一批 176 轮咨询师文本上只改了 **4 轮（2.27%）**：3 轮 `minimizing` 被否定抑制，1 轮 `empathy` 被否定抑制；其余 172 轮事件集合逐字一致。没有强度变化轮（本语料里弱化词没有出现在命中词前 4 字内）。

这不是“临床有效性提升”的证据，只是语义修正命中面：v2 修的是**旧规则把否定句、被否定描述误判成事件**的问题。工程数字不能替代临床标定。

## 2. 事件分布

| 事件 | legacy | v2 | 变化 |
| --- | ---: | ---: | ---: |
| `neutral` | 107 | 110 | +3 |
| `empathy` | 57 | 56 | -1 |
| `acceptance` | 9 | 9 | 0 |
| `minimizing` | 7 | 4 | -3 |
| `open_probe` | 2 | 2 | 0 |
| `judgment` | 1 | 1 | 0 |
| `preaching` | 1 | 1 | 0 |
| 事件总数 | 184 | 183 | -1 |

- legacy `neutral` 率：107 / 176 = **60.80%**
- v2 `neutral` 率：110 / 176 = **62.50%**
- 翻转轮：4 / 176 = **2.27%**
- 强度变化轮：0 / 176
- 强度分布：legacy `{1: 184}`；v2 `{1: 183}`（本语料没有 0.6 弱化命中）

## 3. 翻转明细（不输出原文）

| 会话 | 轮次 | legacy | v2 | 移除 |
| --- | ---: | --- | --- | --- |
| `debug_s6HNZ_d_YYBHCLF2PLHNd` | 2 | `minimizing` | `neutral` | `minimizing` |
| `debug_s6HNZ_d_YYBHCLF2PLHNd` | 15 | `empathy` | `neutral` | `empathy` |
| `debug_xw7uAJodsn6o3ln9FGL_Q` | 4 | `empathy` + `minimizing` | `empathy` | `minimizing` |
| `debug_xw7uAJodsn6o3ln9FGL_Q` | 13 | `minimizing` | `neutral` | `minimizing` |

人工复核（只看命中窗口，不记录原文）：

- 3 个 `minimizing` 都出现在“不会 / 不想 / 不需要”这类否定作用域内，旧规则把被否定的词面直接算成咨询师在淡化来访，v2 抑制正确。
- 1 个 `empathy` 是“你反复”出现在被否定描述里（“不需要你反复解释”），旧规则把描述来访行为的话算成反映式共情，v2 抑制正确。
- 1 个 `empathy` 同时在 `minimizing` 否定句里保留，是因为同一轮还有独立的反映式共情命中；长词遮盖与否定抑制都按“逐命中判定”，没有整句一刀切。

## 4. 机制覆盖与未覆盖

已覆盖并有单测：

- 否定抑制：`不 / 没 / 没有 / 别 / 并非 / 不是 / 不会 / 不用 / 不必 / 无需 / 谈不上 / 算不上`，限定 6 字回看、不跨标点、不误伤“不过 / 不仅 / 停不下来”这类结构。
- 双重否定：`不是不理解你` 不抑制。
- 反问 / 选择问：`会不会让你觉得` / `是否觉得` / `要不要` 不抑制。
- 长词遮盖：`你觉得` ⊂ `你觉得呢` 时只保留 `open_probe`。
- 强度折算：命中词前 4 字内出现 `有点 / 稍微 / 有些 / 可能 / 也许 / 大概 / 似乎 / 算是` 时 `strength=0.6`，下游 `aggregateTurnDelta` 按 strength 缩放。
- 生产装配：`createEngineSessionPort` 缺省注入 v2；直接 `new InMemoryEngineSession` 仍走 legacy，D-1 基线快照 spec 继续锁定旧口径。

未覆盖（明确不在本单伪装）：

- `holding_present` / `cold_absent` 的规则轨跨轮识别：内核边界仍是“事件分类只消费咨询师本轮文本”，不引入来访原文；跨轮语义由模型轨承担。
- 临床幅度标定：`strength=0.6` 是工程种子，不是临床斜率。
- 96 场 / 1112 轮 D-1 样本复评：本单只跑现有 11 场 debug 语料；D-1 样本复评需要单独批次与标注。
- 审议 100 场质量验收、`llm_active` 全量切换、MindGuard 临床层：均不在本单。

## 5. 风险与限制

- 176 轮不是 1112 轮 D-1 样本，不能把 2.27% 直接外推成全库翻转率。
- 回放只对照事件集合与 strength，不评估这些翻转是否让来访状态轨迹更“对”；后者需要临床标定。
- 本报告不含任何对话原文；会话 id 与轮次号只用于回查，不用于识别来访。
