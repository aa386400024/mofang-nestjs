# WP-L · 临床增量表纠正 + 12 轮档验收口径重写（交付记录）

- 交付日期：2026-11-11
- 关联任务单：`docs/worklog/pending/wp-l-clinical-delta-and-acceptance-correction-task-2026-11-11.md`
- 变更性质：engine-core 内核协议变更（仅 `state-transition.ts` 一个文件）
- 状态：**已全部完成**。代码与文档落盘、静态闸门全绿；16 场真实批次重跑通过（16/16 completed、llm_call_ratio=1.0、intake 验收 PASS、语桐 depth 不触底）。

---

## 1. 一句话总结

拆开 `DELTA_TABLE` 里「同盟上升 ↔ 阻抗下降」的等量反向配平，让「我信任你，但这件事我还不想说」这个临床正交状态可表达；同时把 12 轮档（intake）验收口径从「探索率」改为「留在场」。纯内核复算确认核心断言——语桐 depth 改后停在 0.225、不再触底。

---

## 2. 实际改动数值 before/after（逐行，共 24 处）

任务单 §8 标题写「15 个数值」是仅指 resistance；实际连同情绪共改动 **24 处**（resistance 15 + emotion 9），全部列于下表。负向事件（judgment/preaching/minimizing/boundary_cross）的 resistance 与 trust/safety/bond、cap、门槛、词表、基线、判定器均未改动。

### 2.1 resistance 三维（15 处）

| 事件          | 维度   | before | after      |
| ------------- | ------ | ------ | ---------- |
| empathy       | depth  | −0.10  | **−0.02**  |
| empathy       | style  | −0.06  | **−0.01**  |
| empathy       | verbal | −0.08  | **−0.03**  |
| acceptance    | depth  | −0.08  | **−0.02**  |
| acceptance    | style  | −0.05  | **−0.01**  |
| acceptance    | verbal | −0.06  | **−0.02**  |
| normalization | depth  | −0.07  | **−0.02**  |
| normalization | style  | −0.04  | **−0.01**  |
| normalization | verbal | −0.05  | **−0.02**  |
| affirmation   | depth  | −0.06  | **−0.02**  |
| affirmation   | style  | −0.04  | **−0.01**  |
| affirmation   | verbal | −0.04  | **−0.015** |
| open_probe    | depth  | −0.06  | **−0.03**  |
| open_probe    | style  | −0.03  | **−0.015** |
| open_probe    | verbal | −0.03  | **−0.02**  |

### 2.2 情绪二维（9 处）

| 事件            | 维度    | before | after     | 备注                                                  |
| --------------- | ------- | ------ | --------- | ----------------------------------------------------- |
| empathy         | valence | +0.10  | **+0.03** |                                                       |
| empathy         | arousal | −0.05  | **−0.02** |                                                       |
| acceptance      | valence | +0.08  | **+0.03** |                                                       |
| acceptance      | arousal | −0.04  | **−0.02** |                                                       |
| normalization   | valence | +0.07  | **+0.02** | arousal 0 不变                                        |
| affirmation     | valence | +0.10  | **+0.04** |                                                       |
| affirmation     | arousal | −0.03  | **−0.02** |                                                       |
| open_probe      | valence | +0.04  | **+0.02** | arousal +0.02 不变                                    |
| sensitive_touch | valence | −0.05  | **−0.12** | arousal +0.15 不变；触碰代价是共情收益（0.03）的 4 倍 |

---

## 3. 前置检查：受影响的既有测试清单与处理

改前先 grep 全部数值断言，区分「断言具体数值（需同步）」与「断言不等式/独立构造（保持不变）」。

### 3.1 同步修改的测试文件（5 个）

| 文件                                                           | 受影响内容                                                                                   | 处理                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `test/engine-core/wp60-delta-table-config.spec.ts`             | 不传配置用例的 verbal/depth/style/valence/arousal 5 项，及另 4 处 valence/arousal 硬编码     | 同步到新值，trust/safety/bond 断言不动   |
| `test/engine-core/wp34-personality-modulator.spec.ts`          | empathy.verbal 基础值 −0.08（多处）及 resistanceScale=2 的 −0.04；另含会话层 resistance 断言 | 同步到 −0.03 与 −0.015                   |
| `test/engine-core/wp53-personality-alliance-extension.spec.ts` | avoidant 三维 verbal/depth/style 与 resistanceScale=1 的 verbal                              | 同步到新值                               |
| `test/engine-core/wp15-delta-cap.spec.ts`                      | empathy.valence 0.1（113 行）                                                                | 同步到 0.03                              |
| `test/engine-adapters/wp58-turn-delta-audit.spec.ts`           | empathy+sensitive_touch 的 arousal 合计 0.1；另含 empathy 完整 11 维 toEqual 对象            | 同步到 0.13 与新 11 维；safety 0.01 不变 |

### 3.2 保持不变（确认不依赖被改基础值）

- `wp15-delta-cap.spec.ts` 内 cap 透传用例（179–193 行）：raw 是测试自造输入，不引用 `DELTA_TABLE`，断言 cap 不修改它，依然成立，按最小改动保留。
- wp3-trajectory、wp42、wp36、wp51、wp57：断言 trust/safety/bond/coreBelief，本单不改这些维度。
- engine-adapters 其余 wp-deliberation-* 、eval.metrics、wp64 等：数值为 deliberation 独立构造或配置值，不依赖 `DELTA_TABLE` 的 empathy 基础值。
- `boundary.spec.ts`：AST 边界检查，不涉及数值，**未修改**。

---

## 4. 闸门表（命令 / exit code / 真实数字）

按已固化的命令规范，任务单里写的 `npx` 实际全部用 `pnpm exec` 执行（禁止裸 npx）。

| 闸门                        | 实际命令                                                                 | 结果                                                                    |
| --------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 类型                        | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | **exit 0，0 error**（日志为空）                                         |
| Lint                        | `pnpm exec eslint`（6 个改动文件）                                       | **exit 0，0 error 0 warning**                                           |
| 边界护栏                    | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | **exit 0，12 用例全绿，文件未改**                                       |
| engine-core 变更范围        | `git diff --stat HEAD -- src/engine-core`                                | 仅 `state-transition.ts`（+35/−24），无其他文件                         |
| engine-core + adapters 测试 | `pnpm exec vitest run test/engine-core test/engine-adapters`             | 86 文件 / 1582 用例：1580 通过；wp12 两例在高并发下 30s 超时            |
| wp12 超时复核               | `pnpm exec vitest run test/engine-adapters/wp12-memory-closeout.spec.ts` | **exit 0，40 用例全绿**，确认前次为负载导致的 flaky timeout，非真实失败 |

说明：直接跑根 `pnpm exec tsc --noEmit` 会因根 tsconfig 的 `types:["node"]` 不含 vitest 全局类型而报 5000+ 测试全局名错误，属命令误用；正确的业务类型闸门是 build 配置，测试文件类型由 vitest 运行时校验。

---

## 5. 16 场改前 vs 改后对照表（已执行）

批次 `p1d-r3-intake-2026-11-11`，8 角色 × 仅 expert × 2 repeats = 16 场，maxTurns=12，worker concurrency=1。两批次初始值（first_avg）完全相同，差异仅来自事件计数与 delta 系数，对比干净。

### 5.1 批次级结果

| 指标                    | 改前（verify-route1-p1d）            | 改后（p1d-r3-intake） | 结论                     |
| ----------------------- | ------------------------------------ | --------------------- | ------------------------ |
| intake 验收             | **FAIL**                             | **PASS**              | 口径切换后通过           |
| 纳入/期望               | 16/16（183 轮）                      | 16/16（188 轮）       | 全纳入                   |
| 配置指纹 combined       | `418e08ca1224e53e`                   | `0591af6a068e5e7e`    | 指纹不同，证明配置变更   |
| session.outcome         | completed 14 / crisis 1 / stagnant 1 | **completed 16**      | 全完成（要求 ≥14）       |
| session.zero_motion     | 4                                    | **0**                 | 零变化场消除             |
| pipeline.llm_call_ratio | 0.9375                               | **1.0**               | 全 LLM 调用（要求 ≥0.9） |
| pipeline.fallback_ratio | 0.0601                               | **0**                 | 零降级                   |
| exploration.rate        | 0.125                                | 0.125                 | 持平（见 §6.2 修正说明） |
| depth p10（最低值）     | 0.15                                 | **0.23**              | 最低 depth 抬升、无触底  |

### 5.2 八维 delta 逐维对照（按 intake-v1 判据）

| 维度    | 改前 delta | 改后 delta | 变化    | intake-v1 判据    | 改后判定                         |
| ------- | ---------- | ---------- | ------- | ----------------- | -------------------------------- |
| trust   | +0.08875   | +0.14575   | +0.0570 | +0.05 ~ +0.20     | **PASS**                         |
| safety  | +0.011438  | +0.02175   | +0.0103 | +0.02 ~ +0.06     | **PASS**（改前不达标）           |
| bond    | +0.009313  | +0.014438  | +0.0051 |                   | Δ                                | ≤ 0.03 | **PASS** |
| valence | +0.09125   | +0.03625   | −0.0550 | 不要求改善        | **PASS**（改善幅度收窄）         |
| arousal | −0.02875   | −0.0175    | +0.0113 | 结束 ≥ 基线 −0.05 | **PASS**（降幅 0.0175 < 0.05）   |
| verbal  | −0.069095  | −0.039062  | +0.0300 | 降幅 ≤ 0.15       | **PASS**                         |
| depth   | −0.084655  | −0.023357  | +0.0613 | 降幅 ≤ 0.10       | **PASS**（改前 0.0847 接近上限） |
| style   | −0.050421  | −0.007304  | +0.0431 | 降幅 ≤ 0.05       | **PASS**（改前 0.0504 略超）     |

### 5.3 核心断言：语桐 depth 终值（逐字稿实测）

| 场次          | 初始 depth | 末轮 depth              | 轮数 | 是否触底 |
| ------------- | ---------- | ----------------------- | ---- | -------- |
| 语桐 repeat 0 | 0.30       | **0.25**（0.2499999…）  | 12   | 否，>0   |
| 语桐 repeat 1 | 0.30       | **0.275**（0.2749999…） | 12   | 否，>0   |

两场均不触底，核心断言通过。真实末值（0.25/0.275）与纯 empathy 理论复算（0.225）略有差异，因真实批次事件序列并非纯 3 次 empathy，属合理。

---

## 6. 核心断言核对（已通过）

### 6.1 纯内核复算

用真实 `transitionState` 构造语桐（anxious，resistanceScale=0.8）初始快照，跑 3 次 empathy，终值与任务单 §3.3 预期逐维对上：

| 维度    | 改前实测         | 改后预期 | 纯内核复算值 | 结论             |
| ------- | ---------------- | -------- | ------------ | ---------------- |
| depth   | 0.30 → 0（触底） | 0.225    | 0.2249999…   | **不触底，通过** |
| style   | 0.30 → 0.075     | 0.2625   | 0.2624999…   | 通过             |
| verbal  | 0.55 → 0.25      | 0.4375   | 0.4375000…   | 通过             |
| trust   | 0.35 → 0.71      | 不变     | 0.71         | 未动，通过       |
| safety  | 0.40 → 0.442     | 不变     | 0.442        | 未动，通过       |
| valence | −0.40 → −0.10    | −0.31    | −0.3099999…  | 通过             |
| arousal | 0.72 → 0.57      | 0.66     | 0.6599999…   | 通过             |

### 6.2 探索率预测偏差的诚实修正

改前我在任务单/本记录里预测「`LOW_DEPTH=0.35` 不动、depth 不归零 → 满足 `depth<0.35` 更难，探索率必然下降」。**实测两个批次 exploration.rate 均为 0.125，持平，该预测未发生。** 原因核对：`exploration.rate` 的口径是「包含探索策略的**场次占比**」（两批均为 2/16 场），不是逐轮触发率，且本批次只有少数角色的 depth 原本就逼近门槛，调小减量后恰好仍有同样数量的场触发探索。

结论不变但表述要修正：核心目标是 depth 不再被错误打穿（已由 p10 0.15→0.23 与语桐终值证实），而非追求探索率下降。新 intake-v1 口径下探索率本就不是验收指标，评估严禁只看探索率单指标，须同时核对 trust 温和建立与 depth 不触底。

---

## 7. 风险与回归确认

- 未改动：trust、safety、bond 增量；单回合 cap；探索门槛与 LOW_DEPTH；词表；角色基线；WP-K 判定器（regression-evaluator）；migration。
- 负向事件（judgment/preaching/minimizing/boundary_cross/sensitive_touch）的 resistance 全部保持原值。
- engine-core 仅 `state-transition.ts` 一个文件改动，符合内核分层；boundary.spec 未改且全绿。
- 合规：全部验证只报计数、布尔与脱敏维度数值，无对话原文进入日志/console/交付物。

---

## 8. 遗留项与诚实说明

- **16 场重跑已通过**：16/16 completed、llm_call_ratio=1.0、零降级，depth/情绪真实曲线已确认（见 §5）。
- **I-20 不在本单标完成**：任务单 §9 回写清单写「I-20 已修复」，但 §2 范围明确不做角色级 valence/arousal 调节（personality-modulator 仍只有 4 个系数）。I-20 保持 P2 待处理，交付记录与 known-issues 均如实标注，不标完成。
- **I-08 标部分缓解而非已修复**：本单调小了多个 arousal 镇静系数，批次实测 arousal 降幅收窄（−0.02875→−0.0175），但纯共情路径仍有轻微安抚（合理），角色级情绪差异化仍属 I-20。
- 后续单（不在 WP-L）：K-3 统计显著性/CI/MDE（P3）、frame_gain、per-session 阈值注入、事件判定器召回（P3）；I-14 prompt_version 根因、I-15 gate_decisions、I-17 主导标签仍待闭环。
