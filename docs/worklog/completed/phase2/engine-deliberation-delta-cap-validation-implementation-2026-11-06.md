# 约束校验层 交付记录 — 审议输出逐维 delta cap

> 状态: ✅ 已交付
> 任务单: [`deliberation-delta-cap-validation-2026-11-06.md`](deliberation-delta-cap-validation-2026-11-06.md)
> 日期: 2026-11-06
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**（直接 import 内核现有函数）
> 边界断言: ✅ `boundary.spec.ts` 全绿（11 条不变量 + 扫描自检，零改动即零影响）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 约束校验层
> 承接: WP63（Schema 设计，prompt 写 0.2 粗口径时就说"超出部分由下游约束校验层 clamp"）/ WP64（影子模式 PoC）/ WP65 后半段（mutex + 版本号）

---

## 1. 实际改了哪些文件

### 1.1 生产代码：1 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **改**（+126 行 / -2 行）：① 新增导出类型 `DeliberationCapEntry`；② 新增导出纯函数 `applyDeliberationDeltaCap(deltas)` → `{ cappedDeltas, capEntries }`；③ 新增私有 `capEntryDelta(dim, value)`（探针法调内核 `capTurnDelta`）+ `ZERO_DELTA_VECTOR` / `MutableDeltaVector`；④ `DeliberationTraceRecord` 加必填字段 `capEntries`；⑤ `buildSuccessRecord` 内部应用 cap（`deliberationDelta` / `entries` / `deltaDiff` 全部改用砍后的值）；⑥ `buildFailureRecord` 填 `capEntries: []`（形状与成功轮次一致）；⑦ import 改成内核 `capTurnDelta` + `DEFAULT_DELTA_CAP_CONFIG` 的**值导入** |

### 1.2 测试：1 增 1 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp-deliberation-delta-cap.spec.ts` | **新增 22 例**（本单主测试）：① 砍幅口径 4 例 ② 边界（正好等于边界不砍）5 例 ③ 稀疏适配（不丢不增）3 例 ④ 重复维度 1 例 ⑤ trace 记录（端到端）4 例 ⑥ 两道校验各司其职 2 例 ⑦ 隐私边界 1 例 |
| `test/admin-debug/wp58-debug-session.spec.ts` | **改**：`makeDeliberationRecord()` 造的 trace 字面量补 `capEntries: []`（新字段是必填） |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/deliberation-delta-cap-validation-2026-11-06.md` | 状态行改 ✅ + 指向交付记录；追加「§十三 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 新增 ✅ 条目（约束校验层 · delta cap 这一半已交付）；PoC 组小结的"下一站"改为"只剩临床合理性 + 过期判定" |
| `docs/worklog/README.md` | Phase2 已开工列表 +约束校验层条目；WP65 那条 ✅ 注记的"切灰度还要补"清单更新 |

### 1.4 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/engine-core/index.ts` 的公开面 —— **零新增导出**（`capTurnDelta` / `DEFAULT_DELTA_CAP_CONFIG` 早就导出了）
- 现有 0.2 格式校验 —— **一行未动**（`validateDeliberationOutput` / `validateDeltaEntry` 原样保留，两道校验各司其职）
- 审议 prompt —— **零改动**（`deliberation-prompt.ts` 一字未动，见 §2.6 的说明）
- 无 migration / 无 entity / 无新表 / 无新列
- **不新增 env 开关** —— 复用 `ENGINE_DELIBERATION_ENABLED`，`.env.example` 与 `typings/global.d.ts` 零改动
- **不新增 admin 接口** —— `capEntries` 直接出现在 Redis trace 的 JSON 里，debug 面板原样可见（admin 侧是 `JSON.parse(raw) as DeliberationTraceRecord` 透传，无字段枚举 → 形状零影响）
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

> 任务单与代码不符的地方按 `team/conventions.md` §2.5 处理：**先 grep 核实 → 找企业级最佳方案 → 在交付记录里写明偏差**。
> 任务单 §二的 6 条核实清单**逐条自己 grep 核实过**（第 6 条的路径在 `src/engine-core/cognition/state-transition.ts`，任务单写的 `domain/cognition/` 少一层）。

### 2.1 决策 D1（最重要）：任务单 §九 闸门 5 的 "trust delta=0.25 → 砍到 0.2" **走完整管道时不可达**

**核实过程**：

- 格式校验 `validateDeltaEntry` 里有一句 `Math.abs(candidate.delta) > DELIBERATION_MAX_ABS_DELTA → return null`，而 `DELIBERATION_MAX_ABS_DELTA = 0.2`（`deliberation-types.ts`）；
- 即 **trust=0.25 在格式校验那一步就被拒了**（进 `rejectedEntries`），压根到不了 cap 层。

**顺着这条推下去，能得到一个更要紧的结论**：

| 维度 | 内核 cap 上向 | 格式校验粗口径 | cap 层实际效果 |
|---|---|---|---|
| trust / safety / bond / valence | +0.20 | ±0.2 | **无**（0.2 不 > 0.2） |
| arousal / 阻抗三维 (verbal/depth/style) | +0.20 | ±0.2 | **无** |
| **移情三维 (positive/negative/dependency)** | **±0.15** | ±0.2 | **有**（0.16~0.20 → ±0.15） |

**也就是说**：格式校验的 ±0.2 与内核 cap 的"上向 0.2"**完全重合**，cap 层在除移情三维外的**所有维度上都不会产生任何效果**。

**这与任务单 §一 自己的判断完全一致** —— §一 说"内核 `DEFAULT_DELTA_CAP_CONFIG` 里移情三维（positive / negative / dependency）是 ±0.15，比 0.2 更严……按内核 cap 是越界的"。**§一 是对的，闸门 5 的 trust 例子是错的**。

**落法**：

- 用例 **①-2** 直接调 `applyDeliberationDeltaCap` 验 "trust 0.25 → 0.2"（这条在**纯函数层**可达）；
- 用例 **①-1 / ⑤-1** 验走完整管道真正会触发的**移情三维** 0.18 → 0.15；
- 用例 **⑥-1** 把"trust 0.25 被格式校验拒掉、到不了 cap"这件事**钉死**（防后人以为审议能输出 0.25）。

**顺带挖出一条切灰度前必须知道的事**：内核 cap 的**下向**边界（trust 等 -0.30 / 其余 -0.20）是"损失厌恶"设计（信任破得快），但格式校验的 ±0.2 把它**完全遮住**了 —— 审议层压根到不了 -0.25。**如果切灰度时希望审议能给出比 -0.2 更狠的信任跌幅，必须先放宽格式校验的下向口径**，否则 cap 的下向边界在审议层形同虚设。

### 2.2 决策 D2：cap 应用在 `buildSuccessRecord` **内部**，不是任务单 §4.3 说的 `executeShadowMode` 调用点

**为什么**：结构性地保证"**进 trace 的 delta 一定过了约束校验层**"。放在调用点的话, 将来有人从别处调 `buildSuccessRecord`（忘了砍）→ trace 里就混进没砍过的 delta —— 而影子期**看不出任何差别**（结果不生效), 切灰度就是状态错乱。放在函数内部, 这类静默失效在结构上就发生不了。

**代价**：无。`applyDeliberationDeltaCap` 是**导出的纯函数** —— 切灰度时落快照那条链直接复用它, 不需要再调一次。

### 2.3 决策 D3：用**逐条探针**调内核 cap, 不用任务单 §三 的"补成全量 → capTurnDelta → 提取非零"整向量往返

**任务单 §三 的算法**：稀疏 delta → 补成全量（11 维）→ `capTurnDelta` → 再提取非零维度 → 放回稀疏结构。

**逐条 grep 核实后发现三个问题**：

1. **整向量往返会丢 entry 的标签与理由** —— `entries` 是人工复核的主字段（维度 + 标签 + 理由）, 而稀疏 map 只有数值。任务单 §4.1 说"维度 + delta + 标签 + 理由不变, 只改 delta 数值" —— 那就不能从 map 重建列表；
2. **会改掉稀疏 map 的既有语义** —— 任务单的"提取非零维度"会把模型**明确提到但 delta=0** 的维度抹掉。现行代码是 `deliberationDelta[dim] = round(delta.delta)`（0 也留着）—— 改了它, PoC 的"模型提到了多少维"统计就会漂移；
3. **模型可能对同一维度给多条建议**（格式校验不拦重复维度）。整向量往返只能拿到"最后一个值"的砍幅, 前面几条会被算成别的值 —— 逐条探针保证每条建议**只改自己的数值**（用例 ④-1）。

**落法**：每条 entry 造一个"**只有该维度带值、其余维度全 0**"的探针向量喂给内核 `capTurnDelta`，读回该维度的值。

- 成立前提（已核实）：`capTurnDelta` 是**逐维独立**处理的 —— 它对每个维度各砍各的, 不看别的维。所以探针里其他维度是 0 不会干扰;
- 代价：N 次调用（N ≤ 11, 每次 11 维循环）—— 一次审议一次调用, 量级完全可忽略;
- **判定只有一份**：直接复用内核 `capTurnDelta` + `DEFAULT_DELTA_CAP_CONFIG`, **不自己写一份 clamp**。自己写就等于开了第二个真相 —— 哪天内核改了边界数值或改了 `capAsym` 的语义（严格大于 vs 大于等于）, 这份会**静默漂移**且不报错, 只在某个维度上表现不同（仓库纪律: env 守卫 / 召回策略 / cap 边界都是"判定只有一份"的实例）。

### 2.4 决策 D4：cap 边界用种子值，与规则算子的 env 可调口径存在**临时分歧**

任务单 §4.5 与大炮的注意点都明确要求直接用 `DEFAULT_DELTA_CAP_CONFIG`（内核种子值）, 不做 env 覆写 —— 本单**照办**。

**但有一件事必须记下来**：仓库**已经有** env 驱动的 cap 装配器 —— `src/engine-adapters/wiring/delta-cap.config.ts` 的 `resolveDeltaCapConfig(config)`（22 个 `ENGINE_CAP_*` 键, WP26 P2-14 做的）。**规则算子用的是它**（可 env 覆写）, **审议层用的是种子值**。

**后果**：生产若调了 `ENGINE_CAP_*`, 两侧的 cap 边界就**不一致**了（规则侧 0.1 / 审议侧仍是 0.15）。

- 影子期**无害**（只观测, 砍幅不影响任何状态）;
- 切灰度前**必须统一** —— 好消息: `resolveDeltaCapConfig` 就在仓库里, 接线**零成本**（审议层改成注入同一份 config 即可, 本单的函数签名已经预留了 config 参数位）。

### 2.5 决策 D5：deltaDiff 的"两边都过 cap"—— **规则侧不需要额外处理**

任务单 §4.4 说"两边都过 cap 后再比（审议 capped - 规则 capped）"。**核实结论：规则侧本来就是砍过的, 不需要任何额外代码。**

- 审议入参的 `ruleDelta` 来自门面的 `computeRuleDelta(baseSnapshot, output.snapshot)` = **落库后快照 − 落库前快照** 的逐维差;
- 而内核在落库**之前**已经对本轮总 delta 过了一次 `capTurnDelta`（WP15 §1.1）→ 落库后的快照反映的就是**砍过**的状态。

**所以本单只需砍审议侧**（`deliberationDelta` / `entries` / `deltaDiff` 三处都改用砍后的值）, 规则侧零改动。这不是偏差, 是核实结论。

⚠️ **一个已知的口径小偏差**（WP64 交付记录 §2.2 记过, 这里再确认一次）：快照落盘时还会 clamp 到 [0,1] / 情绪区间 —— 贴着边界的那一轮, `ruleDelta` 会**小于**内核砍完的总 delta（差值 = 被 clamp 掉的部分）。这是**既有**行为, 本单没有改变它。

### 2.6 决策 D6：审议 prompt **不知道**逐维上限 —— 这是观测价值, 也是切灰度时要决定的事

WP63 定 prompt 时写的是**统一 0.2 粗口径**（并在交付记录里如实写明"移情三维精确上限是 0.15, 超出部分由下游约束校验层 clamp"）。模型因此**不知道**移情三维的真实上限是 0.15 → 移情维度**会经常被砍**。

- **影子期这是好事** —— `capEntries` 正好能量化"模型有多少建议超出了逐维标准"（这是切灰度前必须知道的数据）;
- **切灰度时要么**把逐维上限写进 prompt, **要么**保留砍幅层 —— **建议保留砍幅层**（prompt 说清了模型仍可能越界, 砍幅是最后一道防线）, 但可以再把上限写进 prompt 减少无谓的砍幅。

**本单不动 prompt**（任务单 §八 未要求, 且改了会让 PoC 对比数据的基线漂移）。

### 2.7 决策 D7：`capEntries` 是**必填**字段, 失败轮次填空数组

与 `deliberationDelta` / `entries` / `rejectedEntries` 的既有口径一致（成功 / 失败两种情况下 trace 形状**一致**, 消费方不用判分支）。

**连带**：`test/admin-debug/wp58-debug-session.spec.ts` 的 `makeDeliberationRecord()` 要补 `capEntries: []`（TS 报必填字段缺失）。

---

## 3. 闸门数字

| # | 闸门 | 结果 |
|---|---|---|
| 1 | ESLint | ✅ **0 problem**（`npx eslint "{src,test,bin}/**/*.ts"` exit 0） |
| 2 | TypeScript | ✅ **0 error**（`npx tsc -p tsconfig.build.json --noEmit` exit 0） |
| 3 | 单测 | ✅ **125 文件 / 2136 例全绿**（基线 124 文件 / 2114 例 → 本单 **+1 文件 / +22 例**, 既有 2114 例零回归） |
| 4 | engine-core | ✅ **零改动**（`git diff --stat HEAD -- src/engine-core` = **空**） |
| 5 | cap 口径 | ✅ 移情三维 0.18 → 0.15（用例 ①-1 / ⑤-1）；trust 0.25 → 0.2（直接调 cap 函数时, 用例 ①-2 —— **走管道不可达**, 见 D1） |
| 6 | 边界 | ✅ 正好等于边界不砍（用例 ②-1, 5 例：±0.15 / ±0.2） |
| 7 | 稀疏适配 | ✅ 不丢不增（用例 ③-1 / ③-2 / ③-3） |
| 8 | trace 记录 | ✅ 砍后的 delta 进 `deliberationDelta` / `entries` / `deltaDiff`, 砍幅明细进 `capEntries`（用例 ⑤-1 / ⑤-2） |

**闸门命令**：

```bash
npx eslint "{src,test,bin}/**/*.ts"                        # 0 problem
npx tsc -p tsconfig.build.json --noEmit                  # 0 error
npx vitest run --exclude "**/e2e/**/*.ts"                # 125 文件 / 2136 例全绿
git diff --stat HEAD -- src/engine-core                  # 空（内核零改动）
```

> ⚠️ e2e 需要真 DB，本单按仓库惯例排除。

---

## 4. 本单**不做**的事（任务单 §八 反双胞胎，逐条照办）

1. **不做"临床合理性"校验** —— 本期只做逐维 delta cap。"临床合理性"是更大的话题（蓝图 §2.3 列的"trust 单轮最多 +0.05 / 阻抗不能从 0.2 跳到 0.9"那类规则）, 切灰度后真出问题了再补;
2. **不做 env 覆写 capConfig** —— 用内核种子值（但见 D4: 切灰度前要统一, 且接线零成本）;
3. **不做审议结果写回快照** —— 那是切灰度的事;
4. **不做 admin 前端面板** —— `capEntries` 已在 trace 里, debug 面板能查;
5. **不改内核** —— 直接 import 内核 `capTurnDelta` + `DEFAULT_DELTA_CAP_CONFIG`, 不自己写一套;
6. **不替换现有 0.2 格式校验** —— 两道各司其职: 格式校验防离谱, 业务校验按标准砍。

---

## 5. 切灰度（Phase3A）还差什么

本单把约束校验层的**一半**做完了（delta cap 那一半）。剩下的是:

1. **临床合理性校验** —— 蓝图 §2.3 的那类规则（单轮幅度上限、跨维度一致性、阻抗跳变等）;
2. **过期判定与丢弃** —— 拿 WP65 后半段传下来的 `baseRevision` 跟"回来时的当前版本"比, 不一致就丢弃（WP65 后半段已把版本号铺好, 本单不涉及）;
3. **cap 配置统一** —— 审议侧改用 `resolveDeltaCapConfig(config)` 注入的同一份 config（与规则算子逐字同口径）;
4. **prompt 补逐维上限**（可选）—— 减少无谓砍幅, 但**保留砍幅层**作为最后防线。

> 一句话：**delta cap 这道网已经铺好, 影子期仍然只观测** —— 审议结果照旧只写 Redis trace, 不进 BDI 快照。

---

_创建：2026-11-06_
_核实：任务单 §二 的 6 条核实清单逐条自己 grep 过；闸门 5 的 trust 例子经核实**走管道不可达**（见 D1）_