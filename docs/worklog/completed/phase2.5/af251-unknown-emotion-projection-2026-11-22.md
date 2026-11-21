# AF-251 交付记录 · 未知 emotion 投影归一化

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-251/task-sheet.md`
- 分支：`task/AF-251-unknown-emotion-projection`
- 基线：`284fef824ff7c23f9dc2ef1f401d161f7d4ff6bf`
- 日期：2026-11-22

## 1. 问题

AF-250 真实豆包 smoke 输出 `[emotion:anxiety]`，而语义层 `SemanticEmotion` 只认 `sad|calm|fearful|angry|happy`。原行为把未知情绪值当成“未知标签”：

- `displayText` 保留 `[emotion:anxiety]`；
- `emotion` 为 `null`，语音拿不到情绪；
- 记 `TAG_UNKNOWN` error、计入 illegal chars；
- 若未知值大量出现，可能把一轮推到 Level 2。

AF-244 已实测否决在 V5 prompt 里硬枚举情绪，因此修复放在投影层。

## 2. 改动

### 2.1 `src/auto-practice/utils/semantic-tag-parser.ts`

- 新增 `SEMANTIC_EMOTION_ALIASES` 有限别名表，按语义族映射到 5 个合法值：
  - 焦虑/恐惧族（`anxiety/anxious/nervous/worried/panic/scared/afraid/fear/tense/uneasy/overwhelmed` 等）→ `fearful`
  - 悲伤/低落族（`sadness/depressed/down/lonely/hopeless/hurt/grief` 等）→ `sad`
  - 愤怒/烦躁族（`anger/mad/annoyed/irritated/frustrated/furious` 等）→ `angry`
  - 喜悦/积极族（`joy/glad/excited/grateful/hopeful` 等）→ `happy`
  - 平静/中性族（`neutral/peaceful/relaxed/relieved/quiet/gentle` 等）→ `calm`
- 新增诊断码：
  - `EMOTION_ALIAS_MAPPED`（warning）：命中别名，标记被消费并落情绪；
  - `EMOTION_VALUE_DROPPED`（warning）：已知 `emotion` 容器但值映射不了，安全消费标记、`emotion:null`。
- `SemanticTagClassification` 的 `emotion` 分支新增 `viaAlias`，让离线扫描能区分“别名映射”与“模糊拼写纠错”。
- 抽出 `classifyEmotionValue()`，顺序为 exact → alias → fuzzy；同时把 `classifySemanticTag` 的圈复杂度从 21 降回 lint 门槛内（≤20）。
- `applyEmotionTag()` 对映射不了的值不再返回 `'unknown'`，改为 `'consumed'`：内部标记不再进入 `displayText`，也不写 `unknownTags`；只有非 emotion 的未知标签仍按原契约“正文保留 + `TAG_UNKNOWN`”。

### 2.2 `test/auto-practice/af251-emotion-projection.spec.ts`

新增 10 例：

1. `[emotion:anxiety]` → `fearful`、正文干净、无 error、无 unknownTags；
2. 10 组别名族映射；
3. 不可映射值 → 消费 + `EMOTION_VALUE_DROPPED`，不猜情绪；
4. 非 emotion 未知标签行为不回归；
5. `[emotion:sadd]` 仍走 `TAG_FUZZY_CORRECTED`，不误报别名；
6. 片段解析与离线扫描同一判定；
7. 流式预处理 `anxiety` 不向 TTS 输出、`detectedEmotion=fearful`；
8. 流式预处理不可映射值静默丢弃；
9. 诊断 meta 不含原始自由词（隐私）；
10. AF-250 生产真实句子回归。

## 3. 关键设计决策

- **焦虑归 `fearful`，不新增枚举**：语义层 5 值是 TTS 官方白名单与下游契约的共同边界；新增 `anxious` 会穿透两层，收益不抵风险。
- **不可映射值安全丢弃，不猜**：宁可这一轮无情绪，也不把未知值错标成相近但错误的情绪。
- **只改投影层，不改 prompt**：遵循 AF-244 实测结论，避免为标签合法率牺牲自然度。
- **别名命中记 warning 而非 error**：这是可预期的正常归一化，不应抬高降级级别。
- 隐私：诊断 meta 只写 `tag:'emotion'` 与计数，不写原始自由词。

## 4. 闸门证据

| 闸门 | 结果 |
| --- | --- |
| 定向测试 `af251 + semantic-tag-parser + streaming-preprocessor` | 3 files / **97 passed**（AF-251 10、parser 70、streaming 17），exit 0 |
| 定向 eslint | exit 0 |
| `pnpm lint` | exit 0（0 error） |
| `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0（CI 同口径） |
| `pnpm test` | **258 passed + 1 skipped files / 4248 passed + 4 skipped tests**，exit 0 |
| `git diff HEAD -- src/engine-core` | 空 |

日志：

- `data/af251-targeted.log`
- `data/af251-lint.log`
- `data/af251-tsc.log`
- `data/af251-fulltest.log`

## 5. 遗留

- 豆包与 MiniMax 的 per-provider 成本分账仍未实现（`session_cost_summary` 只按 token 汇总）；已在 AF-250 回执登记。
- 多轮/长对话、并发、429/5xx/超时行为仍未验证。
- V5 生产灰度量级与观察指标/停止条件仍未定义。
- 不可映射情绪值当前选择“静默丢弃”；若灰期统计显示比例偏高，再评估扩别名表，而不是扩枚举。

## 6. commit message

`fix(af251): 归一化未知 emotion 投影并安全消费不可映射值`
