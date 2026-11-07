
# 临床合理性校验 交付记录 — 观测版

> 状态: ✅ 已交付
> 任务单: [`deliberation-clinical-sanity-2026-11-07.md`](deliberation-clinical-sanity-2026-11-07.md)
> 日期: 2026-11-07
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**（纯适配层实现）
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 例，零改动即零影响）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 约束校验层（临床合理性那一半）
> 承接: 约束校验层（delta cap）/ 过期判定与丢弃 / cap 配置统一
> ⚠️ **影子模式不变** —— 审议结果照旧**不写** BDI 快照；本单只是把"可疑"的轮次**标记**出来记进 trace
> ⚠️ **这是观测版，不是"临床合理性校验"做完** —— 阈值是**工程种子值**（非临床标定），只标记不拦截；拦截版要等督导校准出真数字

---

## 1. 实际改了哪些文件

### 1.1 生产代码：1 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **改**（+220 行 / -0 行）：① 新增导出类型 `ClinicalSanityRule`（规则名联合类型）+ `ClinicalFlag`（单条标记）；② 新增导出常量 `CLINICAL_SANITY_THRESHOLDS`（三条阈值，工程种子值）；③ 新增导出纯函数 `applyClinicalSanityCheck(deltas, enabled)` → `{ checkedDeltas, clinicalFlags }`；④ 新增 `parseBooleanEnv()` 纯函数（`resolveDeliberationEnabled` 改为调它，**判定收口一份**）；⑤ `DeliberationTraceRecord` 加**必填**字段 `clinicalFlags`；⑥ `buildSuccessRecord` 在 `applyDeliberationDeltaCap` **之后**跑临床校验并把 flags 塞进 trace；⑦ `buildFailureRecord` 填 `clinicalFlags: []`（形状与成功轮次一致）；⑧ 新增私有方法 `isClinicalSanityEnabled()`；⑨ 文件头补本单说明块 |

### 1.2 测试：1 增 1 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp-deliberation-clinical-sanity.spec.ts` | **新增 26 例**（本单主测试）：① 规则 1 三例 ② 规则 2 两例 ③ 规则 3 三例 ④ 边界四例 ⑤ 开关三例 ⑥ trace 形状两例 ⑦ 观测版语义三例 ⑧ 端到端 + 管道可达性三例 ⑨ 隐私一例 |
| `test/admin-debug/wp58-debug-session.spec.ts` | **改**：`makeDeliberationRecord()` 造的 trace 字面量补 `clinicalFlags: []`（新字段是**必填**）—— 与前两单同款处理 |
| 其余 7 个审议 spec（wp64 / wp65 ×2 / wp66 / wp68 / delta-cap / cap-config） | **零改动** —— 本单没动 service 的依赖签名，既有断言全绿 |

### 1.3 配置：2 改（新增 env 键的登记，任务单 §九 没列，见 §2.8 偏差 B8）

| 文件 | 改了什么 |
|---|---|
| `typings/global.d.ts` | 加 `ENGINE_CLINICAL_SANITY_ENABLED?: string`（仓库 env 治理约定：显式声明到 ProcessEnv） |
| `.env.example` | 加 `ENGINE_CLINICAL_SANITY_ENABLED=false`（生效行）+ 7 行注释块（缺省关 / 只标记不拦截 / 阈值非临床标定 / 总开关关着时无意义） |

### 1.4 文档：3 改

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/deliberation-clinical-sanity-2026-11-07.md` | 状态行改 ✅ + 指向交付记录；追加「§十二 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 小结块补一条 ✅（临床合理性校验 · 观测版）；修正两处"临床合理性仍未做"的表述（**观测版已做，拦截版仍未做**） |
| `docs/worklog/README.md` | Phase2 已开工列表加一条（临床合理性校验 · 观测版） |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- 内核 `capTurnDelta` / `resolveBounds` / `DEFAULT_DELTA_CAP_CONFIG` / `DELTA_TABLE` —— **零改动**（临床校验是**纯适配层**的观测，不碰内核任何判定）
- `src/engine-adapters/deliberation/deliberation-types.ts` —— **零改动**（阈值不写进契约层，契约层只管 LLM 的输出形状）
- `src/engine-adapters/wiring/**` —— **零改动**（不新增 provider / token）
- 无 migration / 无 entity / 无新表 / 无新列
- **不新增 admin 接口** —— `clinicalFlags` 直接出现在 Redis trace 的 JSON 里（admin 侧是 `JSON.parse(raw) as DeliberationTraceRecord` **透传**，无字段枚举 → 形状零影响）
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）
- **不改任何审议结果** —— 标记只进 trace，delta 一个字不动（用例 ⑦-1 / ⑦-3 / ⑧-2 钉死）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

> 任务单与代码不符的地方按 `team/conventions.md` §2.5 处理：**先 grep 核实 → 找企业级最佳方案 → 在交付记录里写明偏差**。
> 任务单 §二的 6 条核实清单**逐条自己 grep 核实过** —— **第 1 条任务单写错了**（见 B1）。

### 2.1 决策 D1（最重要）：任务单 §二 第 1 条的**校验链顺序写错了**

**任务单原文**（§二 第 1 条 + §三 的分层表）：

> 格式校验 → delta cap → 过期判定 → 意图锁定

**核实结果**（grep 实证，`llm-deliberation.service.ts`）：

| 步 | 实际位置 | 说明 |
|---|---|---|
| 格式校验 | `validateDeliberationOutput`（client 的 `validate` 回调） | 一致 |
| **意图锁定** | `executeShadowMode` :1160 `resolveLock(...)` | 任务单说它在**最后**，实际它在**过期判定之前** |
| **过期判定** | `executeShadowMode` :1164 `checkStale(...)` | 一致（在 `resolveLock` 之后） |
| **delta cap** | `buildSuccessRecord` **内部** :1298 `applyDeliberationDeltaCap(...)` | 任务单说它是**第 2 步**，实际它是**最后一步** |

**为什么这条要紧**：它直接决定"临床校验该插在哪"。见 B2。

### 2.2 决策 D2（与派单注意点 1 直接相关）：临床校验放在 **cap 之后**，但**不在"过期判定之前"**

**派单注意点 1 原文**："位置在 delta cap 之后，过期判定之前 —— 两道各司其职：cap 是硬边界，临床校验是软观测"

**为什么"过期判定之前"在当前调用链里**不可达：

- `delta cap` 发生在 `buildSuccessRecord` **内部**（最后一步）；
- `过期判定 (checkStale)` 发生在 `buildSuccessRecord` **之前**；
- 要让临床校验既"在 cap 之后"又"在过期判定之前"，**必须把 cap 从 `buildSuccessRecord` 里挪出来**（挪到 `executeShadowMode` 里 `checkStale` 之前）。

**为什么不挪**（两条理由）：

1. **会破坏 delta-cap 单交付时明确的不变式**。那单的落法是："cap 放在 `buildSuccessRecord` 内部 = 进 trace 的东西必然过了约束校验层，杜绝'换个调用点忘了砍'这类静默失效"。把 cap 挪到调用点，`buildSuccessRecord` 就变成"接收一个已经砍好的列表" —— 不变式从**结构保证**退化成**调用方自觉**。
2. **对输出零影响**。临床校验与过期判定是**两个独立观测**，都落进**同一条** trace 记录（`clinicalFlags` 与 `stale` / `currentRevision` 各占一个字段）。挪不挪，trace 里的内容**逐字相同**。为"零可观测差异"去动一个已交付单的结构性决策，是**净亏**。

**落法**：按任务单 §4.4 的原文 —— `buildSuccessRecord` 内部、`applyDeliberationDeltaCap` **之后**。

**"两道各司其职"这条完全满足**：cap 是**硬边界**（超了砍到边界并记账，改 delta）；临床校验是**软观测**（只标记，delta 一个字不动）。用例 ⑦-3 钉死"标记不改变审议结果"。

### 2.3 决策 D3：`applyClinicalSanityCheck` 加**必填**第二参 `enabled`

**任务单两处自相矛盾**：

- §4.2 的签名：`applyClinicalSanityCheck(deltas)` —— **单参**；
- §4.6 的行为："关着的时候，`applyClinicalSanityCheck` **直接返回空数组**，零开销"。

单参签名**没法知道开关状态**（函数是纯的，不读 env），所以 §4.6 用单参签名实现不了。

**落法**：`applyClinicalSanityCheck(deltas, enabled: boolean)` —— 第二参**必填**（不给默认值）。

- **必填而不是可选**：强制每个调用方**显式**表态开关状态，杜绝"忘了传 → 默认跑"或"忘了传 → 默认不跑"这类静默分歧；
- "空数组"这条保证落在**函数内部**（关着 → 直接返回 `{ checkedDeltas: deltas, clinicalFlags: [] }`），而不是散落在调用点的 if 里 —— 未来切灰度时改成"观测 / 拦截"两种模式，这个函数是**唯一**需要改的地方。

### 2.4 决策 D4：`ClinicalFlag` 的字段类型**收窄**（比任务单更严）

**任务单 §4.1**：`rule: string` / `dimension: string`。

**落法**：`rule: ClinicalSanityRule`（三个字面量的联合类型）/ `dimension: DeliberationDim`。

**先例**：`DeliberationCapEntry.dimension` 在 delta-cap 单里就是这么收窄的，理由就写在那个接口的注释里："审议层收窄后，消费方拿到的 dimension 一定是合法审议维度，不用再判一遍"。

**为什么 `rule` 也收窄**：规则名是**稳定的统计口径**（督导复盘按它聚合）。`string` 类型允许拼错的规则名混进 trace，聚合时静默多出一组"未知规则"。收窄后拼错**编译期就红**。

### 2.5 决策 D5：规则 3（三维同时）产出 **3 条** flag，不是 1 条

**问题**：`ClinicalFlag` 只有一个 `dimension` 字段。三维同时命中时，塞 "verbal,depth,style" 会毁掉这个字段的语义（消费方要 split 才知道是哪三维）。

**落法**：**每维一条** flag（三条 `rule: resistance_triple_jump`，`dimension` 分别是 verbal / depth / style，各自记自己的 `value`）。

- 消费方想看"这一轮是不是阻抗集体上升" → 看有没有 `resistance_triple_jump` 的 flag；
- 想看三维各是多少 → 三条 flag 的 `value` 里都有；
- 计数上要留意：一次"集体上升"在 `clinicalFlags.length` 里算 **3** 条，不是 1 条（督导统计时按 `rule` 聚合，不要按条数）。

### 2.6 决策 D6：同一维度多条建议 → **取最后一条**（任务单未规定）

**任务单没说**重复维度怎么办。落法取"**最后一条**"，理由是**口径必须与 trace 一致**：

- `buildSuccessRecord` 拼 `deliberationDelta` 时是 `deliberationDelta[delta.dimension] = round(delta.delta)` —— **后写覆盖前写**；
- 临床校验如果取"第一条"或"最极端的那条"，标记说的值就和 trace 记的值**对不上** —— 督导看到"标记说 trust=0.18、trace 里却是 0.05"会以为数据坏了。

用例 ⑦-2 把这条钉死（`[0.18, 0.05]` → 不 flagged；`[0.05, 0.18]` → flagged，值 0.18）。

### 2.7 决策 D7：布尔 env 解析**收口一个纯函数** `parseBooleanEnv`

**问题**：影子模式总开关（`ENGINE_DELIBERATION_ENABLED`）与本单的观测开关（`ENGINE_CLINICAL_SANITY_ENABLED`）是**两个不同的键**，但接受的字面量必须**同一套**（true / 1 / yes / on）。两处各写一份解析，迟早漂移（一处认 on 一处不认）—— 仓库纪律：**判定只有一份**。

**落法**：抽出 `parseBooleanEnv(raw)`（导出纯函数），`resolveDeliberationEnabled` 改为调它（**行为逐字不变**，既有测试全绿），本单的 `isClinicalSanityEnabled()` 也调它。

### 2.8 决策 D8：新增 env 键必须登记**两处**（任务单 §九 只说了"新增 env 键"）

仓库有一条**机器断言**（`test/config/wp25-env-example-coverage.spec.ts`）：

- 用例①：**代码里读的每个 env 键**，`.env.example` 都有**生效行**（漏了 = 运维照抄模板时根本不知道有这个键，配不了）；
- 用例②：`.env.example` 的每个生效行，代码里都**真的读它**（留了没人读 = 骗人的配置项）。

所以本单新增的键**必须**同时落在 `typings/global.d.ts`（仓库 env 治理约定：显式声明到 ProcessEnv）与 `.env.example`（生效行 + 注释块）。两处都已登记，env 守卫实跑全绿。

### 2.9 决策 D9：**规则 2 在完整管道里不可达** —— 这不是 bug，是上游更严

**发现**：格式校验的粗口径 `DELIBERATION_MAX_ABS_DELTA = 0.2`（`deliberation-types.ts:232`）比规则 2 的阈值（-0.25）**更严** ——

- 能过格式校验的负向 delta **最小是 -0.2**，永远够不到 "< -0.25"；
- → **观测数据里规则 2 恒为 0 条**。

**为什么不改阈值**：阈值是**工程种子值**，改成 -0.2 以内等于**发明一个临床数字** —— 任务单 §七 2 明令禁止。本单**照任务单的值实现**，把"不可达"这件事**写进代码注释**（`CLINICAL_SANITY_THRESHOLDS.allianceNegative` 的文档块）+ 用例 ⑧-3 钉死。

**切灰度时怎么办**（留给 Phase3A）：要让规则 2 有信号，得先决定 —— ① 放宽格式校验到 per-dim cap 边界（trust 下向是 -0.30），还是 ② 把阈值收到 -0.2 以内。**这是产品/临床决策，不是本单能定的**。

**闸门 6 的覆盖方式**：因为端到端跑不出来（建议在到达临床校验**之前**就被格式校验拒了），闸门 6 用**直接调函数**的用例 ②-1 覆盖 —— 这与 delta-cap 单处理"trust 0.25 → 0.2"那道闸门是**同一款处理**（那单的交付记录里也写明了"走完整管道时不可达"）。

---

## 3. 闸门数字（本单实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error / 0 warning** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 本单新增单测 | `npx vitest run test/engine-adapters/wp-deliberation-clinical-sanity.spec.ts` | **26 例全绿** ✅ |
| env 守卫 + 审议组回归 | `npx vitest run`（env 守卫 + wp58 + wp64 + wp66 + wp68） | **119 例全绿** ✅ |
| 全量单测 | `npx vitest run --exclude "**/e2e/**/*.ts"` | **128 文件 / 2186 例全绿** ✅ |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空**（零改动） ✅ |

**全量单测对比**：改动前 **127 文件 / 2160 例**，改动后 **128 文件 / 2186 例**（+1 文件 = 本单新测试；+26 例 = 本单新增用例；**既有 2160 例零失败**）。

---

## 4. 验收逐条（任务单 §八）

| # | 闸门 | 要求 | 结果 |
|---|---|---|---|
| 1 | ESLint | 0 problem | ✅ **0 error / 0 warning** |
| 2 | TypeScript | 0 error | ✅ **0 error** |
| 3 | 单测 | 全量跑通，不新增失败 | ✅ **128 文件 / 2186 例全绿** |
| 4 | engine-core | 零改动 | ✅ **`git diff --stat HEAD -- src/engine-core` = 空** |
| 5 | 规则 1 | trust 正向 delta = 0.18 → flagged（alliance_positive_spike） | ✅ 用例 ①-1（trust / safety / bond 三个维度各一例） |
| 6 | 规则 2 | trust 负向 delta = -0.3 → flagged（alliance_negative_spike） | ✅ 用例 ②-1（**直接调函数**；端到端不可达，见 §2.9） |
| 7 | 规则 3 | verbal / depth / style 同时 0.12 → flagged（resistance_triple_jump） | ✅ 用例 ③-1（端到端用例 ⑧-1 也覆盖） |
| 8 | 边界 | 正好等于阈值 → 不 flagged | ✅ 用例 ④-1（表驱动 4 例：0.15 / -0.25 / 0.1 / 0.1） |
| 9 | 开关 | 开关关着 → clinicalFlags 空数组 | ✅ 用例 ⑤-1（函数层）/ ⑤-2（端到端） |
| 10 | trace 形状 | 成功 / 失败两种情况下形状一致 | ✅ 用例 ⑥-1 / ⑥-2 |

**额外覆盖**（任务单未列，本单补的）：

- ①-2 / ①-3 —— 过线一点点（0.16）要 flag；非同盟维度（valence 0.18）不 flag；
- ③-2 / ③-3 —— 规则 3 的"**集体**"语义：少一维不算，三维都在但只有一维超线也不算；
- ⑤-3 —— 端到端验 env 真的生效（trace 里出现 flag）；
- ⑦-1 / ⑦-2 / ⑦-3 —— 观测版语义：**不砍不丢不改** + 同维度取最后一条（与 trace 同口径）；
- ⑧-2 —— 端到端验"审议 delta 一个字没被改动"；
- ⑧-3 —— 钉死"规则 2 在完整管道里不可达"这个事实（防后人误判成 bug）；
- ⑨-1 —— 隐私边界：flag 里只有规则名 + 维度 + 两个数字。

---

## 5. 切灰度时必须知道的三件事（**本单不写进代码**，留给 Phase3A）

1. **观测版 ≠ 临床合理性校验做完了**。本单的三条阈值是**工程种子值**（注释里写死了"非临床标定"），只用来**挑出可疑轮次**。切灰度要变成拦截之前，必须先有督导校准出来的**真数字**。
2. **规则 2 在完整管道里恒为 0 条**（§2.9）—— 观测数据里看不到它，**不要**误判成"LLM 从来不会提出信任崩塌" —— 是格式校验的 0.2 粗口径先拦住了。要它有信号，得先决定放宽格式校验还是收阈值。
3. **阈值没有 env 化**（任务单 §七 3：先总开关，切灰度后再细化）。校准期若要临时改阈值，得改代码发版 —— 真需要频繁调档时再单开一单把三条阈值 env 化。
