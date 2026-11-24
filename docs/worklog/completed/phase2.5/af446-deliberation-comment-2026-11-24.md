# AF-446 交付记录：修正 deliberation-types 中在场状态 delta 种子的过期注释

- 日期：2026-11-24
- 任务：AF-446（executor，MiniMax Code）
- 基线：`8cd5be58ec1902ac46a7bb92a2a6feb79ab81d09`
- 结论：**passed** — 只改注释，把「两类的 delta 种子是 ZERO」这句已被 AF-322 推翻的过期论据换成内核实录系数；「暂不纳入 `DELIBERATION_RULE_ALIGNED_TAGS`」的结论不变，依据换成词表覆盖。

## 背景与问题

`src/engine-adapters/deliberation/deliberation-types.ts` 里 `DELIBERATION_RULE_ALIGNED_TAGS` 上方的 D-2 段落写着：

```
 *   · 两类的 delta 种子是 ZERO, 没有"规则可覆盖的 delta"可对齐;
```

这条论据的前提是「`holding_present` / `cold_absent` 在内核 `DELTA_TABLE` 里乘 ZERO」。AF-322 标定后该前提已被推翻 —— 内核 `src/engine-core/cognition/state-transition.ts` 的 `DELTA_TABLE` 里，两类都有真实非零系数。

注释还在拿这条过期论据给「刻意不加这两个标签」背书，等于让后来人按一个已失效的理由做决定。任务单要求：只改注释，删掉过期论据、换成内核实录系数，保留仍然成立的理由，并把依据从「零 delta」改成「词表覆盖」。

## 实际改了哪些文件

| 文件                                                                                      | 改动                   | 说明                                          |
| ----------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------- |
| `src/engine-adapters/deliberation/deliberation-types.ts`                                  | modified（+8 / -1 行） | 仅 D-2 段落注释；**代码与枚举零改动**         |
| `docs/worklog/completed/phase2.5/af446-deliberation-comment-2026-11-24.md`                | added                  | 本交付记录                                    |
| `docs/worklog/records/phase2.5-orchestration-closed-loop/AF-446/receipt-RC-AF-446-1.json` | added                  | 记录包回执副本（内容与 transport 回执同哈希） |

`git diff --numstat` 实测：`8  1  src/engine-adapters/deliberation/deliberation-types.ts`。逐行核对 8 个新增行全部是 `*` 开头的注释行，无一行是可执行代码。

## 改了什么（注释正文对照）

删掉：

```
 *   · 两类的 delta 种子是 ZERO, 没有"规则可覆盖的 delta"可对齐;
```

换成（内核实录系数 + 标定通道说明）：

```
 *   · 两类**有真实非零 delta 种子** (AF-322 标定后内核 `state-transition.ts` 的 `DELTA_TABLE` 实录):
 *     `holding_present` = safety +0.004 / bond +0.002 / valence +0.004 / verbal -0.002 / arousal -0.002;
 *     `cold_absent` = trust -0.004 / valence -0.004 / verbal +0.004 / safety -0.002 / bond -0.002
 *     / depth +0.002 / style +0.002 / negative +0.002 (其余维度 0);
 *     ⚠️ 幅度是**工程种子值, 非临床标定** —— 标定批次要调幅度走 `ENGINE_DELTA_HOLDING_PRESENT`
 *     / `ENGINE_DELTA_COLD_ABSENT` 覆写 (AF-419 补的通道), 不改基础表.
```

并在结论行补一条依据更正（结论本身不变）：

```
 *   → 纳入本组 = 把模型独有标签误算成规则可覆盖 (任务单 §6 T6).
 *     ⚠️ **依据是"规则侧产不出这两个标签" (词表覆盖), 不是"delta 是零"** ——
 *     "零 delta" 那条论据已被 AF-322 推翻, 但**暂不纳入**的结论不变.
 *   是否纳入**留标定批次评估**.
```

保留的两条仍然成立的理由（逐字未动）：

- 规则轨**词表不扩** → 规则侧**产不出**这两个标签（本组是「规则算子也会打」的标签）；
- 模型轨走 shadow 旁路 → 影子对比口径不变（两侧都是规则轨口径）。

## 事实核对（系数与任务单逐项对齐）

系数不是照抄任务单，是回到内核源码逐项比对 `src/engine-core/cognition/state-transition.ts`（`DELTA_TABLE`，第 369–394 行）：

| 维度       | `holding_present` | `cold_absent` |
| ---------- | ----------------- | ------------- |
| trust      | 0                 | **-0.004**    |
| safety     | **+0.004**        | -0.002        |
| bond       | +0.002            | -0.002        |
| valence    | +0.004            | -0.004        |
| arousal    | -0.002            | 0             |
| verbal     | -0.002            | +0.004        |
| depth      | 0                 | +0.002        |
| style      | 0                 | +0.002        |
| positive   | 0                 | 0             |
| negative   | 0                 | +0.002        |
| dependency | 0                 | 0             |

与任务单 §事实 给出的两组系数**逐项一致**（任务单用「其余 0」概括的维度，实测确为 0）。

三条支撑事实的源码依据：

1. **规则侧产不出这两个标签** —— `src/engine-core/cognition/rule-based-classifier.ts:13` 明写「跨轮语义 (holding_present / cold_absent) 归模型轨, 不在本类伪造」，规则轨词表确实不含这两类。
2. **模型轨能产出** —— `src/engine-adapters/cognition/model-event-classifier.ts:238-239` 的判定 prompt 里有 `holding_present` / `cold_absent` 两个标签；同文件 441–444 行的注释也已写明「两类新 kind 的幅度自 AF-322 起已有内核工程种子值 (safety +0.004 / bond +0.002 …), 不再是 ZERO」，与本单改动口径一致。
3. **标定走 env 覆写通道** —— `src/engine-adapters/wiring/delta-table.config.ts:140-148` 有 `ENGINE_DELTA_HOLDING_PRESENT` / `ENGINE_DELTA_COLD_ABSENT` 两个键（AF-419 补齐），所以注释写「调幅度走 env 覆写，不改基础表」。

## 闸门

<!-- gateResults -->

| 命令                                                                                                                               | 结果                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm typecheck`                                                                                                                   | **0 error**，exit=0（`tsc --noEmit --incremental`，无输出即通过） |
| `pnpm lint`                                                                                                                        | **0 error**，exit=0（2 warning，均为既有债，见下）                |
| `pnpm exec vitest run test/engine-adapters/wp63-deliberation-schema.spec.ts test/engine-adapters/wp64-deliberation-shadow.spec.ts` | 2 files / **65 passed**，exit=0，696ms                            |
| `git diff --stat HEAD -- src/engine-core`                                                                                          | **空**（0 行，内核零 diff）                                       |

`pnpm lint` 的 2 条 warning 全部来自 `src/admin-debug/tts/debug-tts.service.ts:13-14`（`import/order`），**本单未触碰该文件**，属既有债基线，不计入本单新增。

<!-- /gateResults -->

## scope 自检

<!-- scopeCheck -->

- 改动文件全部落在任务单 `scope.files` 内：`src/engine-adapters/deliberation/deliberation-types.ts`、`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-446/`、`docs/worklog/completed/phase2.5/af446-deliberation-comment-2026-11-24.md`。PASS
- `git diff --stat HEAD -- src/engine-core` 为空 —— 内核一行未动。PASS
- 未混入 `admin-dashboard/`、Flutter、`scripts/`、`docs/architecture/`。PASS
- 未声明编排状态面生成物（`task-state-index.json` / `orchestration-snapshot.json` / `state/journal.jsonl` / `web/orchestration/data.js` 在本单开工前即已是脏文件，属编排者运行态，本单不碰、不声明）。PASS
- 纯注释改动：无枚举增删、无常量值变更、无控制流变更。PASS

<!-- /scopeCheck -->

## 契约核对

<!-- contractChecks -->

- taskId 一致：AF-446 贯穿任务单 / 回执 / 本记录。PASS
- 只改注释：8 个新增行逐行核对全部为 `*` 注释行。PASS
- 系数与内核一致：与 `state-transition.ts` 的 `DELTA_TABLE` 逐项比对一致（§事实核对）。PASS
- 结论未漂移：仍写「暂不纳入 `DELIBERATION_RULE_ALIGNED_TAGS`」「是否纳入留标定批次评估」，仅把依据从「零 delta」换成「词表覆盖」。PASS
- 保留理由未删：规则轨词表不扩、影子对比同口径两条逐字保留。PASS
- engine-core 边界：`git diff --stat HEAD -- src/engine-core` 为空。PASS
- 交付记录六组机读字段标记齐全（gateResults / scopeCheck / contractChecks / backlogItems / deviationTable / reviewVerdict）。PASS

<!-- /contractChecks -->

## 遗留登记

<!-- backlogItems -->

- **AF446-B1（kernel / 需大炮批准）**：`src/engine-core/domain/events/session-event.ts` 的类型注释里仍留着同一条过期论据 —— 第 19–20 行写「DELTA_TABLE 里的种子向量 = ZERO (零回归)」、第 34 行与第 36 行分别写 `holding_present` / `cold_absent`「种子 delta = ZERO, 临床增量待标定」。这与 AF-322 标定后的内核实际系数矛盾。**本单不动 engine-core**（红线），故登记为遗留：修它需要大炮在任务单里明确批准 engine-core 例外，并过 `boundary.spec.ts` 的 11 条断言。
- **AF446-B2（docs）**：`src/engine-core/cognition/state-transition.ts:364-367` 的内核注释对两类只列了部分维度（holding_present 列 safety/bond/verbal，cold_absent 列 trust/safety/bond），实际 `DELTA_TABLE` 还含 valence / arousal / depth / style / negative 等维度。不影响运行（注释非事实源），但对照阅读时容易漏维度。与 AF446-B1 同属内核注释口径，一并由大炮决定是否开单。

<!-- /backlogItems -->

## 偏差表

<!-- deviationTable -->

| 项       | 任务单写的                                                                                      | 实际                                                           | 处置               | 为什么                                                                             |
| -------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| 改动范围 | 目标 1 删过期论据、换真实系数；目标 2 保留两条仍然成立的理由；目标 3 结论不变、依据换成词表覆盖 | 全部照做，无冲突                                               | 一致               | —                                                                                  |
| 系数来源 | §事实 给了两组系数                                                                              | 回内核 `state-transition.ts` 逐项复核，与任务单**逐项一致**    | 一致，未偏离任务单 | 系数以内核为真相源，复核防止任务单笔误                                             |
| 额外补充 | 未要求                                                                                          | 额外补了「工程种子值非临床标定」+ env 覆写通道（AF-419）两句   | 补在注释里         | 只换一句 ZERO 会让读者以为系数已临床定标；标定通道是事实，不写等于留下第二个误导点 |
| 闸门清单 | `pnpm typecheck` / `pnpm lint`                                                                  | 两闸门全绿（0 error / exit=0），另加跑审议层定向回归 65 例全绿 | 超出任务单但同向   | 注释改动理论上不影响闸门，实跑确认「没有隐藏影响」而非假设                         |

<!-- /deviationTable -->

## 验收结论

<!-- reviewVerdict -->

passed — 过期论据已替换为内核实录系数，「暂不纳入」的结论与其余理由完整保留，依据换成词表覆盖。纯注释改动（+8/-1，全为注释行），`pnpm typecheck` 0 error / exit=0、`pnpm lint` 0 error / exit=0、审议层定向回归 65 例全绿、`src/engine-core` 零 diff，scope 内收敛无越界。内核里同源的过期注释已登记为 AF446-B1 / B2 遗留（需大炮批准方可动 engine-core）。

<!-- /reviewVerdict -->

## commit message

`docs(af446): 修正在场状态 delta 种子过期注释（改依据不改编排）`
