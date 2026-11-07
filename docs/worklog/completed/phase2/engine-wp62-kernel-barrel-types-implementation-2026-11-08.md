# WP62 · 内核端口类型 barrel 收口 交付记录

> 状态: ✅ 已交付
> 任务单: [`wp62-kernel-barrel-types-2026-11-08.md`](wp62-kernel-barrel-types-2026-11-08.md)
> 日期: 2026-11-08
> 红线: ✅ **engine-core 只改了 `index.ts`**（任务单 §5.2 授权:「engine-core 只改 index.ts（加导出），不改任何算子逻辑、不改任何现有代码」）—— 算子逻辑、领域模型、端口实现**一行未动**
> 边界断言: ✅ `boundary.spec.ts` 全绿（断言⑥ 公开面白名单已同步登记 3 个新符号; 断言⑦ 内核文件清单**无需改**—— 本单没新增内核文件）
> 承接: WP59（召回策略端口统一 · 遗留的"结构化类型替身"）/ WP26 P2-16 / WP34 / WP42 / WP60 —— 同一范式（公开出口 + 断言守住）
> 配套守卫: 新增 `test/engine-adapters/wp62-kernel-barrel-types.spec.ts`（4 例）—— **适配层不得再长出 clamp 副本**的机器守卫

---

## 1. 实际改了哪些文件

### 1.1 内核（engine-core）: 1 改（**只加导出**）

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/index.ts` | **改**（+7 / -1）: ① barrel 导出 `clamp01` / `clampValence`（来自 `domain/emotion.js`）; ② `export type { RecallEvaluation, RecallPolicyOptions }` —— `RecallPolicyOptions` 并进原导出行（**没新起一行**，barrel 导出风格是同源符号合并）; ③ 两处导出各配一段说明注释（为什么现在才公开） |

> ⚠️ **内核改动只有这一处**: `git diff --stat HEAD -- src/engine-core` = **1 file changed, 7 insertions(+), 1 deletion(-)**。
> `domain/emotion.ts` / `memory/recall-policy.ts` **零改动** —— `clamp01` / `clampValence` / `RecallPolicyOptions` 本来就是 `export` 的, 本单只是让它们**出现在公开出口**。

### 1.2 适配层（engine-adapters）: 3 改（**全是"删副本"方向**）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/persistence/memory-config.ts` | **改**（+19 / -12）: ① `toRecallPolicyOptions()` 返回类型从**内联结构化类型** `{ halfLifeMs: number; minEffectiveImportance: number }` 改成**直接引用内核的 `RecallPolicyOptions`**; ② 加 `import type { RecallPolicyOptions } from '../../engine-core/index.js'`（type-only, 零运行时依赖）; ③ 删掉原注释里那段"⚠️ 返回类型**故意不写成内核的 `RecallPolicyOptions`**…超出本单预批准范围" —— **那句话已经过期了**, 留着就是给下一个人的假话; ④ 换成一段"为什么现在改成直接引用"的新说明 |
| `src/engine-adapters/wiring/character/builtin-character-registry.ts` | **改**（+30 / -23）: ① **删掉本地 `clamp01`** 与 **`clampValence`** 两个函数定义（11 行）; ② 改为从 `../../../engine-core/index.js` **值导入**（不是 type-only —— 这两个是运行时函数）; ③ 头部"反双胞胎"里那条"不自己写第二份 clamp01"改写为"现在直接 import 内核那一份 —— 全仓只有一份夹取口径" |
| `src/engine-adapters/persistence/qdrant-memory.store.ts` | **改**（+11 / -8）: ① **删掉本地 `clamp01`**（6 行, 用于 `point.score` 夹取）; ② 改为从 barrel 导入 `clamp01`; ③ 头部"反双胞胎"加一条说明 —— 为什么本文件那份副本的"NaN 透传"语义是个**坑**（见 D2） |

### 1.3 测试: 1 增 1 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp62-kernel-barrel-types.spec.ts` | **新增**（4 例）: ① 内核 barrel 导出的 `clamp01` / `clampValence` 口径逐字钉死（含 NaN → 0）; ② **适配层不得再声明本地 `clamp01` / `clampValence`** —— 扫描三个适配层源码, 机器守卫; ③ 适配层的 engine-core import **只能走 barrel**（只解析 `from '...'` 说明符, 不误伤注释里的路径提及）; ④ `toRecallPolicyOptions()` 的返回值**类型上就是**内核 `RecallPolicyOptions` |
| `test/engine-core/boundary.spec.ts` | **改**（+5 / -0）: 断言⑥ 公开面白名单加 3 个符号（`clamp01` / `clampValence` / `RecallPolicyOptions`）。断言⑦（内核文件清单）**未动** —— 本单没新增内核文件 |

### 1.4 **零改动**（逐条核实过）

- `src/engine-core/domain/emotion.ts` —— **零改动**（`clamp01` / `clampValence` 本来就是导出函数, 内核侧不需要任何修改）
- `src/engine-core/memory/recall-policy.ts` —— **零改动**
- `src/engine-core/memory/importance-decay.ts` 里那个**私有** `clamp01` —— **零改动**（见 D4）
- `src/engine-adapters/wiring/character/character-profile.entity.ts` 的 `CharacterNarrativeStyle` —— **零改动**（核实过: 那是 `NonNullable<CharacterProfile['narrativeStyle']>` **派生**写法, 不是重复声明, 且 `CharacterProfile` 已在 barrel —— 不需要动, 详见 D3）
- 无 migration / 无 entity / 无新表 / 无新列 / 无 env 键 / 无 `.env.example` 改动 / 无 `typings/global.d.ts` 改动
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）
- **不改任何算子逻辑** —— 内核判定链路一字未动

---

## 2. 任务单 §二 核实清单 · 逐条结论

| # | 任务单问什么 | 核实结论 |
|---|---|---|
| 1 | 现在有哪些端口类型/函数没进 barrel，但适配层在用？ | **3 处**（任务单只列了 2 处符号, 实际有 3 个文件在自带副本）: ① `memory-config.ts` —— 用**内联结构化类型**代替内核 `RecallPolicyOptions`; ② `builtin-character-registry.ts` —— 自带 `clamp01` + `clampValence` **两个**副本; ③ `qdrant-memory.store.ts` —— 自带 `clamp01` 副本（**任务单完全没提**）。另有 `resolveEmotionLabel` 只在注释里被提到、**没有实际 import/调用** → 按 §5.3「不要凑数」**不补**（见 D5） |
| 2 | 断言⑥ / 断言⑦ 是什么样的？ | 断言⑥ 是**双向**白名单（AST 解析 barrel 真实导出 vs `expectedPublic` 数组, 少导出与多导出都会红）; 断言⑦ 是内核目录结构清单（**新增内核文件必须登记**）。→ 本单只加导出, 不新增内核文件 → **断言⑦ 不动** |
| 3 | 内核 barrel 导出了哪些类型/函数？ | `src/engine-core/index.ts` 导出**类型 + 纯函数 + 默认常量**; 注释里明确写了"为什么不导出内存实现（InMemory*）"与"为什么不导出算子纯函数 / 默认常量"—— 本单补的 `clamp01` / `clampValence` 属于**跨层契约**（适配层要用）, 与"内部实现细节"不冲突 |
| 4 | `RecallPolicyOptions` 在哪个文件？ | `src/engine-core/memory/recall-policy.ts` —— WP59 引入的可选端口注入类型（`halfLifeMs?` / `minEffectiveImportance?`）; 内核**只导出**了 `RecallEvaluation` 与 `evaluateRecallCandidate`, **漏了这个端口类型** |
| 5 | `clamp01` 在哪个文件？ | `src/engine-core/domain/emotion.ts:24` —— `if (Number.isNaN(value)) return 0; return Math.min(1, Math.max(0, value));`。⚠️ **内核另有第三个同名私有函数** `memory/importance-decay.ts:44`（NaN 透传）—— 见 D4 |

### 2.1 补充扫描（全仓 `function clamp*` 定义）

```
src/engine-core/memory/importance-decay.ts:44        function clamp01  ← 内核私有, 不导出, 不在本单范围
src/engine-core/domain/emotion.ts:24                 export function clamp01       ← 本单公开
src/engine-core/domain/emotion.ts:30                 export function clampValence   ← 本单公开
src/engine-adapters/wiring/character/builtin-character-registry.ts:435  function clamp01       ← 本单删除
src/engine-adapters/wiring/character/builtin-character-registry.ts:443  function clampValence   ← 本单删除
src/engine-adapters/persistence/qdrant-memory.store.ts:202             function clamp01       ← 本单删除
```

适配层里 **`clamp` 一词共 35 处 / 7 文件**, 逐个核实后: 除上述 3 个副本外, 其余全是**调用点**或**注释提及**（`deliberation-types.ts` / `llm-deliberation.service.ts` / `turn-render-orchestrator.ts` / `character-profile.resolver.ts` / `db-character-profile.resolver.ts`）—— **不需要动**。

### 2.2 适配层深路径 import 违规扫描

`grep` 全 `src/engine-adapters` → **零违规**（断言⑪ 当前就是绿的）; 本单**没有制造**新的深路径 import。

---

## 3. 关键设计决策与偏差（与任务单有出入的地方 + 为什么）

### 3.1 D1: 补了 **3 个**符号, 不是任务单说的 2 个

- **任务单 §3.1** 列的是 `RecallPolicyOptions` + `clamp01` 两个。
- **本单补了 3 个**: 额外加了 `clampValence`。
- **理由**: §3.1 明确写「**后端开工时再扫描一下，看看还有没有其他的**」。扫描发现 `builtin-character-registry.ts` **自带两份**副本（`clamp01` **和** `clampValence`）—— 只补 `clamp01` 的话, 那个文件仍然留着一份自写副本, 任务单 §5.1「适配层要删掉自己写的实现」的目标**没达成**。补 `clampValence` 才是真的收口。
- `clampValence` 的语义（`[-1,1]`, NaN → 0）在情绪效价域上是**同一族**函数, 与 `clamp01` 同源同文件, 不存在"为了凑数"的问题。

### 3.2 D2: 行为差异 —— 任务单 §5.1「行为逐字不变」**不严格成立**, 本单照做并登记

任务单 §5.1 写「适配层改成直接 import 后，行为逐字不变」。**这条只在"所有可达输入"上成立**, 病态输入上三份副本的口径本来就**不一样**:

| 实现 | `NaN` | `+Infinity` | `-Infinity` |
|---|---|---|---|
| 内核 `domain/emotion.ts`（本单统一到这份） | → **0** | → 1（`clamp01`）/ 1（`clampValence`） | → 0（`clamp01`）/ -1（`clampValence`） |
| 适配层 `builtin-character-registry.ts` 原副本 | → 0（`!isFinite` → 0） | → **0** | → **0** |
| 适配层 `qdrant-memory.store.ts` 原副本 | → **NaN 透传** | → 1 | → 0 |

**可达性核实**: 三处 clamp 的输入全部来自 ① 内置角色种子常量（有限字面量）② DB 数值列 ③ JSON 请求体（**JSON 无法表达 Infinity / NaN**）→ **所有可达输入逐字不变**。

**两处差异的定性**:

- `builtin-character-registry.ts` 的 `±Infinity → 0` vs 内核 `±1 / -1`: 差异只在病态值。内核版语义更"标准"（夹到边界）, 适配层旧版是"非有限数一律当 0"（更保守）。
- `qdrant-memory.store.ts` 的 **NaN 透传** vs 内核 **NaN → 0**: **这是严格改善**。旧副本会让 `point.score` 变成 NaN, 而下面紧跟着的 `ranked.sort((a, b) => b.hit.score - a.hit.score || ...)` 遇 NaN 时比较结果恒为 `false` → **该条静默留在原位**, 排序结果不可预期。换成内核版后 NaN → 0, 排序稳定。

→ 结论: **按任务单要求照做（删副本、统一走内核）, 并把差异登记在此**。若认为 ±Infinity 的口径需要保持"非有限数一律当 0", 那应该改**内核**（内核才是口径的归属地）, 而不是让适配层各自保留副本 —— 但那是另一个话题, 本单不动内核逻辑（§5.2 禁止）。

### 3.3 D3: `character-profile.entity.ts` 的 `CharacterNarrativeStyle` **不动**（核实后排除）

- **看起来像**重复声明, 实际是 `NonNullable<CharacterProfile['narrativeStyle']>` —— **派生**写法, 不是另抄一份形状。
- 且 `CharacterProfile` **已在 barrel**（`export type { AttachmentStyle, CharacterProfile, ... }`）→ 没有"深路径 import"的动机。
- → **零改动**。（任务单没提这个符号, 但同类问题会被扫到, 故登记。）

### 3.4 D4: 内核私有 `importance-decay.ts` 的 `clamp01` **不动**（本单范围外）

- 内核**自己内部**还有一份 `clamp01`（`memory/importance-decay.ts:44`, 语义是 NaN 透传）, 与 `domain/emotion.ts` 那份**同名不同语义**。
- 它**没有导出**、内核内部也**没有复用** `domain/emotion.ts` 那份 → 是内核内部的重复, 但**改它要动内核算子逻辑**, 超出本单 §5.2 授权。
- → **零改动, 登记为残留风险 R1**（另开单可收）。
- ✅ **R1 已于 2026-11-08 销号** —— 见独立单 [内核内部 clamp01 统一](engine-kernel-internal-clamp-unify-implementation-2026-11-08.md): 本地副本已删, 内核 clamp01 只剩一份。

### 3.5 D5: `resolveEmotionLabel` **不补导出**（§5.3「不要凑数」）

- 核实: 适配层只在 `builtin-character-registry.ts` 的**注释**里提到它（说明"标签由内核重算"）, **没有任何实际 import / 调用**。
- 它是内核**情绪双轴映射**的实现细节, 适配层用不到 → 补进公开面就是扩公开 API 面（要长期维护的契约）, 而收益是零。
- → **不补**。

### 3.6 D6: 注释里"过期的事实"必须一起改（否则就是假话）

- `memory-config.ts` 原注释: 「⚠️ 返回类型**故意不写成内核的 `RecallPolicyOptions`**: …加导出 = 改 barrel + 改断言白名单 = 动第三个内核文件, **超出本单预批准范围**」—— 本单正是去改 barrel + 改白名单的那一单, 这段话**当场作废**。
- `builtin-character-registry.ts` 原注释: 「本层自带一份是因为内核那个函数**没有从公开 barrel 导出**, 而本期 engine-core **整树零改动**」—— 同样作废。
- 仓库纪律: 注释过期 = 给下一个人的假话。**改了代码就必须改注释**, 否则下一个来的人会照着注释做出错误的判断。

### 3.7 D7: 新增"适配层不得再长出副本"的**机器守卫**

- 断言⑥ 只守**内核公开面**（barrel ↔ 白名单双向）, **守不到"适配层自己抄了一份"**。
- 本单的核心问题恰恰是后者 → 新增 `test/engine-adapters/wp62-kernel-barrel-types.spec.ts` 断言②: 扫描三个适配层文件, 出现 `function clamp01(` / `function clampValence(` 就红。
- 只扫**函数声明**, 不扫调用与注释 —— 调用是应该的, 注释里提到内核 clamp 更是必须的。

---

## 4. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "{src,test,bin}/**/*.ts"` | ✅ **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **全绿**: **134 passed / 1 skipped（135 files）· 2293 passed / 4 skipped（2297 tests）**（本单新增 4 例, 全在 `wp62-kernel-barrel-types.spec.ts`） |
| `boundary.spec.ts`（12 条边界断言） | ✅ 全绿 —— 断言⑥ 公开面白名单同步登记 3 个符号; 断言⑦ 未动（本单无新内核文件） |
| `git diff --stat HEAD -- src/engine-core` | ✅ **1 file changed, 7 insertions(+), 1 deletion(-)** —— **只有 `index.ts`**, 算子逻辑零改动（任务单 §5.2 授权范围内） |
| 适配层 diff | 3 文件 / +60 / -43（**净减 15 行** —— 删副本的方向） |

> 4 例 skipped = 真 Redis 集成用例（不设 `TEST_REDIS_URL` 时整份跳过）—— 与本单无关。

---

## 5. 残留风险与后续

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | ~~内核内部还有第三份 `clamp01`（`memory/importance-decay.ts:44`, NaN 透传）与本单公开的那份**同名不同语义**~~ | 将来有人从内核内部 import 它, 拿到的是**另一套口径**; 名字一样 = 最容易踩 | ✅ **已销号**（2026-11-08 · 独立单「内核内部 clamp01 统一」: 本地副本删除, 复用 `domain/emotion.ts` 那份 → **内核 clamp01 只剩一份**; 顺带发现旧口径下 **NaN 能绕过召回门槛**, 新口径正确拒绝; 新增机器守卫防再长回来） |
| R2 | `±Infinity` 的口径从"非有限数一律当 0"变成"夹到边界" | 只影响病态输入; 已核实**所有可达输入逐字不变**（种子常量 / DB 数值列 / JSON 请求体 —— JSON 无法表达 Infinity） | 若要保持旧口径, 应改**内核**（口径归属地）, 而不是让适配层留副本（见 D2） |
| R3 | `qdrant-memory.store.ts` 的 `point.score` 现在 NaN → 0（旧版透传） | 这是**严格改善**（NaN 会让 `ranked.sort` 比较恒 false, 排序不可预期） | 已在本单收敛, 无需额外处置 |
| R4 | 公开出口又多了 3 个符号 | 公开面是要长期维护的契约, 加了就得一直维护 | 断言⑥ 双向白名单守着 —— 少导出 / 多导出都会红; 且**只有适配层真在用的**才补（§5.3, 见 D5） |
| R5 | 适配层**将来**再写一份 clamp | 两份实现迟早分叉（仓库既有教训） | 已加**机器守卫**（本单新增测试断言②）; 但守卫只覆盖当前这 3 个文件 —— 新文件不在扫描范围内, 属**已知边界**（要全覆盖得改成 AST 扫全 `src/engine-adapters`, 成本更高, 留给真需要时） |
| R6 | 任务单说的"等攒到 3-5 个端口类型要补时一起补" | 本单只补了 3 个符号, 若后面还有第 4、第 5 个, 仍需再走一次"改 barrel + 改白名单" | 本单把**流程**走通了（改 barrel → 改断言⑥ → 删副本 → 加守卫）, 下一单成本更低 |

---

## 6. 怎么用（开发者视角）

- 内核新增公开导出: `clamp01` / `clampValence`（`domain/emotion.ts`）、`RecallPolicyOptions`（`memory/recall-policy.ts`）—— 适配层**一律从 `engine-core/index.js` import**。
- **不要**在适配层深路径 import 内核内部模块（被边界断言 ⑪ 拦）。
- **不要**在适配层重新实现内核的 clamp / 端口类型 —— 新增测试断言②会红。
- 内核端口类型（如 `RecallPolicyOptions`）改字段名 → 适配层**立刻编译报错**（结构化替身做不到这一点）。

---

## 7. 交付后回写

| 项 | 状态 |
|---|---|
| 任务单状态行改 ✅ + 指向本记录 | ✅ |
| 任务单 + 交付记录移入 `completed/phase2/` | ✅ |
| `docs/worklog/README.md` 回写 | ✅ |
| `docs/worklog/pending/phase2-overview-2026-11-03.md` 回写（P2-8 那一行） | ✅ |
| commit message 草稿 | `feat(wp62): 内核端口类型与 clamp 函数补进 barrel, 适配层删掉自写副本` |

---

_本交付记录写于 2026-11-08。_
