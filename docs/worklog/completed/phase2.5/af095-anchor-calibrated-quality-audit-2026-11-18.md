# AF-095 无真人督导条件下的质量锚定审计与长会话真实批次（交付记录）

- 任务：AF-095 `phase2.5-exit4-proxy-quality`
- 分支：`task/AF-095-anchor-quality-audit`
- 基线：`6a52d7e62795bc427408d0cc7c6eb415b03363c5`
- 日期：2026-11-18
- 边界：不伪造督导师六维标注；不改 `engine-core`；不把合成分数当验收。
- **机读字段标记**：gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict

## 1. 正式结论

**出口④质量：❌ 未达标，当前只能判「未通过 / 部分可判」。**

本任务交付的是一条**真人锚点校准 + 可复算行为审计 + 真实长会话运行**的替代证据链，
不是 80% 临床准确率验收。四个硬事实决定了不能给达标结论：

1. **真人锚点只有质量等级，没有六维逐轮真值。** 496 轮 `turns.jsonl` 提供
   `gold/normal/borderline/bad` 与事件标签，但没有 trust / safety / bond /
   verbal / depth / style 的连续评分。
2. **行为信号对真人质量等级的判别力不足。** 最强的长回合 AUC 0.680、
   长度比 0.687；提问 0.491、开放式提问 0.493、反映 0.531、建议 0.534、
   负向语言 0.531，接近随机。按现有阈值，长回合 precision 0.533 / recall 0.427，
   不能作为质量门槛。
3. **现有真实逐字稿存在可量化的行为问题。** 46 场 / 497 轮中，
   咨询师空输出 88 轮（17.7%）、空输出过高 18 场、台词重复过高 19 场、
   反映式倾听不足 20 场、场次过短 15 场、提问过密 8 场、负向语言过高 1 场；
   风险披露 11 轮，覆盖 4 轮，**5 场存在未覆盖披露**。清洗推理块后长回合率均值
   2.2%，“长回合过高 36 场”是推理块被当作咨询师台词的假阳性，已纠正。
4. **长会话跑满 50 轮，但 36.3% 的咨询师回合是空输出。** 三场 completed
   long 会话共 146 个可审计回合，53 轮只有推理块、没有可见回复；
   `render_fallback_turns=0`，批次健康仍判 true。跑满轮数不等于有效咨询轮次。

因此：审计器可作**分诊/复核排序**，不可作临床六维验收；出口④仍为未通过。

## 2. 方法与边界

- **锚点**：`docs/reference/psych-dataset/dataset/turns.jsonl` 496 轮，
  `quality=gold 153 / normal 268 / borderline 63 / bad 12`；阳性定义为
  `borderline` 或 `bad`（75 轮）。
- **信号**：长回合（≥120 字符）、长度比（咨询师/来访者）、问号提问、开放式提问、
  反映式倾听、建议/指导、负向语言（说教/淡化/评判）、安全探询。
- **统计**：Mann-Whitney AUC（平局 0.5）；固定阈值上的 precision / recall。
- **真实审计**：读取 `data/debug-sessions` 的 46 份真实逐字稿；只审计可见台词，
  剔除模型推理块 `<think>...</think>`；输出不含任何对话原文。
- **不做的**：不把 `resistance` 拆成三维；不把规则 delta 当督导真值；
  不把 `synthetic-supervisor-v1` 的 0.833 当 80% 验收。

## 3. 真人锚点校准结果

| 信号 | AUC | 阈值 | Precision | Recall | TP/FP/FN/TN |
| --- | ---: | ---: | ---: | ---: | --- |
| 长回合 `longTurn` | 0.680 | 120 字符 | 0.533 | 0.427 | 32/28/43/393 |
| 长度比 `lengthRatio` | 0.687 | 2.0 | 0.262 | 0.667 | 50/141/25/280 |
| 提问 `question` | 0.491 | 1 | 0.148 | 0.680 | 51/294/24/127 |
| 开放式提问 `openQuestion` | 0.493 | 1 | 0.105 | 0.027 | 2/17/73/404 |
| 反映 `reflection` | 0.531 | 1 | 0.226 | 0.160 | 12/41/63/380 |
| 建议 `advice` | 0.534 | 1 | 0.333 | 0.107 | 8/16/67/405 |
| 负向语言 `negativeLanguage` | 0.531 | 1 | 0.273 | 0.120 | 9/24/66/397 |
| 安全探询 `safetyProbe` | 0.598 | 1 | 0.375 | 0.280 | 21/35/54/386 |

**判读**：只有长回合与长度比有中等判别力；其余信号接近随机。阈值不可直接作为
验收门，只能作为人工复核的排序线索。任何“80% 准确率”结论都不能从这张表推出。

## 4. 真实逐字稿批次审计

- 样本：46 场 / 497 轮真实逐字稿。
- 咨询师空输出 88 轮（17.7%）；风险披露 11 轮，被下一轮咨询师安全探询覆盖 4 轮，
  **5 场存在未覆盖披露**。
- 行为旗标（按场计）：
  - 空输出过高：18 场
  - 台词重复过高：19 场
  - 反映式倾听不足：20 场
  - 场次过短（<10 轮）：15 场
  - 提问过密：8 场
  - 负向语言过高：1 场
  - 风险未覆盖：5 场
- 长回合率均值 2.2%，无场次触发 25% 阈值；此前的“长回合 36 场”是推理块未清洗造成的假阳性。
- 证据：`docs/worklog/completed/phase2.5/af095-counselor-quality-evidence-2026-11-18.json`
  （只含 sessionId / 轮数 / 比率 / 旗标 / 校准数字，不含台词）。

## 5. 长会话真实批次（sessionProfile=long）

- 批次 A：`I1yoLioMUufoSUbg-FmRh`，1/1 场 completed，`turnCount=50`，
  `llm_call_turns=50`，`render_fallback_turns=0`，`degraded_turns=0`，
  `batchHealth.valid=true`。
- 批次 B：`owG7D8ODjfXjjO7Sio2Hn`，3 场中 2 场 completed（`vpt_grief_avoidance_l1`
  50 轮、`vpt_workplace_intellectualization_l1` 50 轮）、1 场 failed
  （`vpt_social_anxiety_avoidance_l1`，0 轮，`errorMessage=角色不存在`）。
- **真实轮数结论**：`long` 档确实能跑满 50 轮，不再是 15 轮上限。
- **质量结论**：**跑满 50 轮 ≠ 50 轮有效咨询**。三场 completed 的逐字稿审计：

| session | 可审计轮 | 咨询师空输出 | 空输出率 | 咨询师总字符 | 台词重复率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `debug_p52X…`（intimate） | 50 | 24 | 48.0% | 3,884 | 46.0% |
| `debug_dAweb…`（grief） | 47 | 18 | 38.3% | 3,970 | 36.2% |
| `debug_glnJ…`（workplace） | 49 | 11 | 22.4% | 5,529 | 28.6% |
| 合计 | 146 | 53 | **36.3%** | 13,383 | — |

- **token 侧证据**：intimate 场 `completion_tokens=32,640`、`reasoning_tokens=31,259`
  （95.8% 的输出预算被推理占用）；grief 场 28,975 / 27,720（95.7%）；
  workplace 场 21,561 / 20,086（93.2%）。咨询师生成策略 `maxCompletionTokens=500`
  + `reasoningEffort=low`，但真实推理块长度多次超过 1,000 字符，导致可见回复为空。
- **计数缺陷**：`llm_call_turns=50`、`render_fallback_turns=0`，批次健康仍为 true；
  空输出没有被计入 fallback / degraded，这是本轮发现的高优先级质量缺陷。
- 证据：`docs/worklog/completed/phase2.5/af095-long-batch-quality-audit-2026-11-18.json`
  （只含 sessionId / 轮数 / 空输出计数 / 比率，不含台词）。

## 6. 与出口④验收的关系

- **能证明的**：真实锚点上信号判别力有限；真实逐字稿存在长回合、负向语言、
  反映不足、风险覆盖不足等可复算问题；`long` 档可以跑满 50 轮，但 36.3% 的
  咨询师回合为空输出，跑满轮数不等于有效咨询。
- **不能证明的**：六维临床准确率 ≥80%；督导师双人盲标一致性；trust / safety /
  bond / verbal / depth / style 的逐维达标。
- **下一步（另立任务，不在本单夹带）**：
  1. **P0：修复 36.3% 咨询师空输出**——先查 `maxCompletionTokens=500` 与推理 token 的预算冲突，补空输出检测/重试/降级与计数器，再重跑 long 批次；
  2. 真实督导师双人盲标 + 仲裁，先做 224 轮试点；
  3. 修复台词重复 / 反映不足 / 风险覆盖的真实行为问题，再跑同口径对照；
  4. 1000 场数据积累与来访者角色扩充另立任务。

## 7. 闸门与证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 单测 | `corepack pnpm exec vitest run test/auto-practice/counselor-quality.spec.ts` | 9/9 passed，exit 0 |
| 类型检查 | `corepack pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| 定向 lint | `corepack pnpm exec eslint --cache --cache-strategy content "src/auto-practice/metrics/*.ts" "test/auto-practice/counselor-quality.spec.ts"` | exit 0 |
| engine-core | `git diff --stat 6a52d7e -- src/engine-core` | 零 diff |
| 事件链 | `node scripts/orchestration/cli.mjs events verify` | PASS，事件日志 409 条，哈希链与索引投影一致 |

## 8. 新增文件

- `src/auto-practice/metrics/counselor-quality.ts` — 纯审计模块（信号 / AUC / P/R / 场次旗标）。
- `src/auto-practice/metrics/counselor-quality-audit.cli.ts` — 校准 + 真实逐字稿审计 CLI。
- `test/auto-practice/counselor-quality.spec.ts` — 9 例单测。
- `docs/worklog/completed/phase2.5/af095-counselor-quality-evidence-2026-11-18.json` — 锚点校准 + 46 场真实逐字稿证据。
- `docs/worklog/completed/phase2.5/af095-long-batch-quality-audit-2026-11-18.json` — 3 场 long 会话审计证据。
