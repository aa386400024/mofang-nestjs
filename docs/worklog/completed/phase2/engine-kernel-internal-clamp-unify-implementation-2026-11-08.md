# 内核内部 clamp01 统一 交付记录

> 状态: ✅ 已交付
> 任务单: [`kernel-internal-clamp-unify-2026-11-08.md`](kernel-internal-clamp-unify-2026-11-08.md)
> 日期: 2026-11-08
> 关联: WP62 残留风险 **R1**（"内核树里还有第三份 clamp01"）—— **本单销掉 R1**
> 红线: ✅ **engine-core 只改了 `memory/importance-decay.ts`**（任务单 §5.2 授权:「只删一个函数 + 加一个 import，不改任何算子逻辑」）—— 算子逻辑**一行未动**
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 条断言全过; 断言⑥ 公开面 / 断言⑦ 内核文件清单 **均未动** —— 本单没新增导出、没新增内核文件）
> 配套守卫: 新增 `test/engine-core/kernel-internal-clamp-unify.spec.ts`（4 例）—— **内核树里不得再出现第二份 `function clamp01(`** 的机器守卫

---

## 1. 实际改了哪些文件

### 1.1 内核（engine-core）: 1 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/memory/importance-decay.ts` | **改**（+16 / -7）: ① **删掉本地 `clamp01`**（7 行，含注释）; ② 加 `import { clamp01 } from '../domain/emotion.js'` —— 复用内核**公开出口那份**; ③ 文件头补一段说明块（为什么原先自带、差异在哪、为什么新口径是改善） |

> ⚠️ **引擎算子逻辑零改动**: `decayImportance` / `effectiveImportance` 的函数体**一行未动** —— 只是它们调用的 `clamp01` 从"本地那份"变成"内核那份"。
> `git diff --stat HEAD -- src/engine-core` = **1 file changed, 16 insertions(+), 7 deletions(-)**。
> 净增的 9 行全是**注释**（说明块）—— 删了 7 行代码，加了 15 行注释 + 1 行 import。

### 1.2 测试: 1 增

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/kernel-internal-clamp-unify.spec.ts` | **新增**（4 例）: ① 内核公开那份 `clamp01` 的口径逐字钉死（NaN → 0 / ±Infinity → 边界）; ② `decayImportance` 对 NaN **不再产出 NaN**（旧口径是透传），且非 NaN 边界值逐字不变; ③ `effectiveImportance` 对 NaN importance 产出 0 而不是 NaN（**排序不再被 NaN 污染**）; ④ **机器守卫**: 递归扫内核树全部 `.ts`，出现 `function clamp01(` 的文件必须**恰好只有** `domain/emotion.ts` 一个 |

### 1.3 **零改动**（逐条核实过）

- `src/engine-core/domain/emotion.ts` —— **零改动**（任务单 §5.3 明确"不要改 domain/emotion.ts 里的 clamp01 实现"）
- `src/engine-core/index.ts` —— **零改动**（`clamp01` / `clampValence` 在 WP62 时已进 barrel, 本单无需再加导出）
- `src/engine-core/memory/recall-policy.ts` —— **零改动**
- 其余内核文件（`domain/bootstrap.ts` / `cognition/state-transition.ts` / `cognition/session-decay.ts` / `cognition/trajectory/trajectory-applier.ts`）—— **零改动**（它们**本来就在用** `domain/emotion.js` 那份，本单让 `importance-decay.ts` 与它们对齐）
- 无适配层改动 / 无 migration / 无 entity / 无新表 / 无新列 / 无 env 键 / 无 `.env.example` 改动 / 无 `typings/global.d.ts` 改动
- `admin-dashboard/` —— 零改动
- 断言⑥ / 断言⑦ —— **均未动**（本单无新导出、无新内核文件）

---

## 2. 任务单 §二 核实清单 · 逐条结论

| # | 任务单问什么 | 核实结论 |
|---|---|---|
| 1 | `domain/emotion.ts` 的 clamp01 是什么样的？ | `if (Number.isNaN(value)) return 0; return Math.min(1, Math.max(0, value));` —— **NaN → 0**, ±Infinity → 边界（+Inf → 1, -Inf → 0）。已由 WP62 补进公开出口 |
| 2 | `memory/importance-decay.ts` 的 clamp01 是什么样的？ | `if (value < 0) return 0; if (value > 1) return 1; return value;` —— **NaN 透传**（NaN < 0 与 NaN > 1 都是 false → 原样返回 NaN） |
| 3 | importance-decay.ts 里的 clamp01 用在哪里？ | **2 处**: ① `decayImportance` 里 `const base = clamp01(importance)`; ② 同一函数末尾 `return clamp01(base * factor)`。⚠️ **没有第三处** —— 这意味着改动的影响面**完全封在 `decayImportance` 内部** |
| 4 | 内核里还有没有其他的 clamp 副本？ | **没有了**。全 `src/engine-core` 扫 `function clamp\w*` 只有 **3 处**: ① `domain/emotion.ts` 的 `clamp01`（公开出口那份，本单统一到它）② `domain/emotion.ts` 的 `clampValence`（公开出口那份，同源同族）③ `memory/importance-decay.ts` 的 `clamp01`（**本单删掉**）。其余提到 clamp 的地方（`bootstrap.ts` / `state-transition.ts` / `session-decay.ts` / `trajectory-applier.ts`）**全都是从 `domain/emotion.js` import**，本来就是同一份 |

### 2.1 补充扫描（全内核 `Math.min/max` + `Number.isFinite/isNaN`）

逐条核实过内核里其他数值夹取/兜底逻辑, **没有第二份 clamp01 同义实现**:

| 位置 | 写法 | 是不是 clamp 副本 |
|---|---|---|
| `cognition/session-decay.ts:199` | `Math.max(value, floor)` | ❌ 不是 —— 是"阻抗**下限**"（只抬不降, 且 floor 是配置项）, 语义与"夹到 [0,1]"无关 |
| `cognition/intention-planner.ts:53` | `Math.min(snapshot.trust, snapshot.safety)` | ❌ 不是 —— 是"取两者的较小值"（同盟门槛取低的那个）, 不是夹取 |
| `domain/ports/memory.store.ts:240` | `Math.min(Math.floor(limit), MAX_MEMORY_RECALL_LIMIT)` | ❌ 不是 —— 是"召回条数上限"（整数上限, 域是条数不是比率） |
| `cognition/rendering/token-budget.ts:110` | `Math.max(0, Math.floor(...))` | ❌ 不是 —— token 预算, 域完全不同 |
| `cognition/alliance-config.ts:109` / `personality-modulator.ts:197` 等 | `!Number.isFinite(value) → fallback` | ❌ 不是 —— 是**端口值回退**（非法配置值回落种子值）, 不是数值夹取; 各端口的合法域与回退值各不相同, 强行合并反而会改语义 |

→ **内核里 clamp01 只有一份了**（本单之后）。

### 2.2 行为差异的**精确**边界（逐输入实测）

任务单 §3.2 只说"NaN 从透传改成 → 0"。逐输入实测确认**差异面只有 NaN**:

| 输入 | 旧（本地那份） | 新（内核那份） | 相同? |
|---|---|---|---|
| `NaN` | `NaN`（透传） | `0` | ❌ **唯一差异** |
| `+Infinity` | `1` | `1` | ✅ |
| `-Infinity` | `0` | `0` | ✅ |
| `0.5` / `0` / `1` / `-1` / `2` | 各自夹取 | 各自夹取 | ✅ |

⚠️ **注意与 WP62 的差异**: WP62 里适配层那份副本的差异面是 **±Infinity + NaN**（三处副本三种口径）; 本单这两份的差异面**只有 NaN** —— 因为 `importance-decay.ts` 那份本地实现用的是 `if (value < 0) / if (value > 1)` 写法, ±Infinity 恰好与内核一致。

### 2.3 可达性核实（"所有可达输入逐字不变"逐条验证）

`decayImportance(importance, ...)` 的 `importance` 来源:

1. **`effectiveImportance(entry, ...)`** → `entry.importance` ← `MemoryEntry` 对象 ← 写入侧 `assertValidMemoryEntry` **先卡一道** `!Number.isFinite(entry.importance) → 抛 INVALID_INPUT`（`domain/ports/memory.store.ts:259`）→ **NaN 进不来**
2. **`decayImportance` 直接被调用**（内核公开导出的函数）→ 调用方传入的 `importance`

→ 任务单 §5.1 的说法**成立但可以更强**: 不只是"JSON 无法表达 NaN"，而是**内核入口就有一道 `assertValidMemoryEntry` 把非有限数挡在门外**（那条断言本来就为"importance 必须落在 [0,1]"而写）。

⚠️ 但 `decayImportance` 是**公开导出**的函数, 外部可以直接调 —— 所以病态值在 API 层面**可达**, 单测必须钉住（D2）。

---

## 3. 关键设计决策与偏差（与任务单有出入的地方 + 为什么）

### 3.1 D1: 用**内核内部相对路径** import, 不走 barrel

- **任务单 §3.1** 写「改成从 `../domain/emotion.js` import `clamp01`」—— **照做**。
- **为什么不绕道 barrel**（`import { clamp01 } from '../index.js'`）: barrel 是**跨层**公开出口（给适配层用）; 内核**内部**模块之间一律用相对路径 —— 现有内核文件就是这么干的（`state-transition.ts` / `session-decay.ts` / `trajectory-applier.ts` / `bootstrap.ts` **全都**是 `from '../domain/emotion.js'`）。跟着现有约定走, 不引入第二种写法。
- ⚠️ 内核内部**允许**相对路径 import: 边界断言 ⑪ 限制的是**适配层**（`src/engine-adapters/`）不得深路径 import 内核内部模块; 内核内部模块之间互引不受限, 且断言③ 只管"不得逃出 engine-core 目录"。

### 3.2 D2: 单测直接钉住 `decayImportance` 的 NaN 行为（不只是钉 clamp01）

- **任务单 §四 交付物 3** 写「行为变化（NaN → 0）有单测覆盖」。
- **本单做法**: 不只测 `clamp01(NaN) === 0`, 还直接测**公开 API 层**的行为: `decayImportance(NaN, 0) === 0`、`effectiveImportance(NaN importance) === 0`。
- **理由**: 断言 ①（clamp01 的口径）只能证明"函数本身对了", 证明不了"**公开导出的算子**真的用上了它" —— 算子内部完全可能还藏着另一个夹取点。单测钉在**调用方看得见的出口**上, 才有价值。

### 3.3 D3: 守卫断言扫的是**内核树全部 .ts**, 不是只扫这一个文件

- 任务单没提要加守卫（本单自加）。
- 做法: 递归扫 `src/engine-core` 下所有 `.ts`, 收集出现 `function clamp01(` 的文件, 断言**恰好等于** `['domain/emotion.ts']`。
- **理由**: 本单的问题本身就是"**同一个名字散在多个文件**"。只扫被改的那一个文件 = 只能证明"我改干净了", 证不了"别处没有第二份"。扫全树才能把"内核里只有一份 clamp01"钉成**可执行契约**。
- ⚠️ 守卫**只看函数声明**（`function clamp01(`）—— 不看调用、不看注释（内核多处注释里提到 clamp01 是**应该**的）。

### 3.4 D4: ⚠️ 旧口径的病态行为比任务单描述的更糟 —— **NaN 能绕过召回门槛**

这是本单挖出的、任务单 §3.2 **没提到的**问题, 值得单列:

- 任务单说旧口径的问题是"NaN 透传"（排序被污染）。
- **实际还有更严重的一层**: `recall-policy.ts` 的门槛判定是
  ```ts
  const effective = query.scope === 'visitor' ? effectiveImportance(entry, now, ...) : entry.importance;
  if (query.scope === 'visitor' && effective < policy.minEffectiveImportance) return REJECTED;
  ```
  —— **`NaN < 0.1` 恒为 `false`**!
- 所以旧口径下, 一条 `importance = NaN` 的记忆: `effectiveImportance` 返回 NaN → `NaN < 0.1` 为 false → **不被拒绝** → **被召回**, 并且带着一个 `effectiveImportance: NaN` 的返回值进入排序。
- 换句话说: 旧口径下, **重要度坏掉等于"永远合格"** —— 门槛判定被 NaN 完全绕过。这比"排序被污染"严重一档: 它是一条**脏数据直接进入召回结果**的路径。
- **新口径**: NaN → 0 → `0 < 0.1` 为 true → **被正确拒绝**（长时召回里 importance 坏掉的条目不再混进来）。
- → 这是本单的**实质收益**, 远大于"排序不再被污染"。已写进 §1 文件头注释与本记录。

### 3.5 D5: 不动 `domain/emotion.ts`、不新增内核文件（严格遵守 §5.2 / §5.3）

- 一个"更专业"的方案是: 把 `clamp01` / `clampValence` 从 `domain/emotion.ts` 挪到某个中性位置（如 `domain/numeric.ts`）—— 因为它们是通用数值工具, 放在"情绪"模块里其实**名不副实**（`emotion.ts` 装的是情绪标签与双轴）。
- **本单不做**, 理由: ① 任务单 §5.3 明确"不要改 domain/emotion.ts 里的 clamp01 实现"、"不要为了凑数而改其他文件"; ② 挪文件要同步改 **barrel** + **边界断言⑥ 白名单** + **断言⑦ 内核文件清单** + **4 个已 import 它的内核文件** —— 改动面从 1 个文件膨胀到 7+ 个, 与本单"删一份重复实现"的小目标完全不成比例; ③ `clamp01` 现在是**公开出口**符号, 挪位置 = 动公开 API 面的来源文件, 属于另一个量级的变更。
- → **登记为残留风险 R2**（另开单可议）: 若将来 `domain/emotion.ts` 里堆了更多通用数值工具, 再考虑拆出中性模块。

### 3.6 D6: 注释里"旧口径是透传"这个事实要**留在代码里**

`importance-decay.ts` 的新说明块**明确写出**了"本文件原先自带一份 clamp01（NaN 透传）"以及差异 —— 而不是只写"现在改成 import"。理由同 WP62 D6: **只写"现在是什么"不写"为什么变"**, 下一个人会以为这行 import 是随手加的, 于是"顺手"再写一份本地副本。故意的决定要留下痕迹。

---

## 4. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "{src,test,bin}/**/*.ts"` | ✅ **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **全绿**: **135 passed / 1 skipped（136 files）· 2297 passed / 4 skipped（2301 tests）**（本单新增 4 例, 全在 `kernel-internal-clamp-unify.spec.ts`） |
| `boundary.spec.ts`（12 条边界断言） | ✅ 全绿 —— 断言⑥ / 断言⑦ **均未动**（本单无新导出、无新内核文件） |
| 定点回归（boundary + wp2-memory + wp12-memory-closeout + wp62-barrel） | ✅ **100 例全绿** |
| `git diff --stat HEAD -- src/engine-core` | ✅ **1 file changed, 16 insertions(+), 7 deletions(-)** —— **只有 `memory/importance-decay.ts`**, 算子逻辑零改动（任务单 §6 授权范围内） |

> 4 例 skipped = 真 Redis 集成用例（不设 `TEST_REDIS_URL` 时整份跳过）—— 与本单无关。

---

## 5. 残留风险与后续

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | ~~内核树里还有第三份 clamp01~~ | —— | ✅ **本单销掉**（删本地副本 + 新增机器守卫断言 ④, 防止再长回来） |
| R2 | `clamp01` / `clampValence` 是**通用数值工具**, 却住在 `domain/emotion.ts`（情绪模块）里 —— 名不副实 | 将来 `domain/emotion.ts` 若继续堆通用工具, 模块职责会散 | 本单**不动**（D5: 挪位置要改 barrel + 断言⑥⑦ + 4 个 import 点, 改动面与收益不成比例）→ **另开单可议** |
| R3 | 内核还有其它"同义不同写"的数值兜底（端口值回退 helper: `alliance-config` / `personality-modulator` / `session-decay` / `state-transition` 各一份 `!isFinite → fallback`） | 各端口合法域与回退值**本来就不同**, 合并会改语义; 但"分散在 4 处"本身是维护成本 | **有意保持分散** —— 它们是**端口契约**的一部分（回退值 = 各自的种子值）, 不是通用数值工具。已逐条核实（§2.1） |
| R4 | 守卫断言只覆盖**当前内核树**的文件 | 将来新增文件里再写一份 clamp01, 守卫会红 —— **这正是它的用途**; 但如果有人**故意**绕过（比如用 `const clamp01 = (v) => ...` 箭头函数写法), 正则扫不到 | 正则只匹配 `function clamp01(`; 箭头函数写法漏网。属**已知边界**（要全覆盖得改 AST 解析, 成本更高）—— 但内核现有代码风格统一用 `function` 声明, 实践中够用 |
| R5 | `decayImportance` 是**公开导出**函数, 外部可直调 | 病态输入在 API 层可达 | 本单已用单测钉住（②③）, 且新口径是**更安全**的一侧（NaN → 0 而不是透传） |
| R6 | 旧口径下"importance 为 NaN 的记忆会绕过召回门槛"这个 bug **在线上可能已存在** | 若历史数据里有 NaN importance 的长时记忆, 旧口径下它们会被召回 | 本单修掉的是**代码路径**; **历史脏数据本身仍在库里**（本单不碰数据）→ 若关心, 需另开单做数据体检。⚠️ 写入侧 `assertValidMemoryEntry` 一直拦着非有限数, 所以脏数据大概率进不来 —— 除非是绕过写入路径直接改的库 |

---

## 6. 怎么用（开发者视角）

- 内核里 `clamp01` **只有一份**（`domain/emotion.ts`, 已进 barrel）。内核内部模块要用它, 直接 `import { clamp01 } from '../domain/emotion.js'`。
- **不要**在内存核任何位置重新实现 `clamp01` —— 新增测试断言 ④ 会红。
- 内核**公开出口**的 `clamp01` 口径: NaN → 0, ±Infinity → 边界, 越界夹取, 结果恒在 [0,1]。
- `decayImportance` / `effectiveImportance` 现在**保证结果恒在 [0,1]**（旧口径下 NaN 会漏出去）。

---

## 7. 交付后回写

| 项 | 状态 |
|---|---|
| 任务单状态行改 ✅ + 指向本记录 | ✅ |
| 任务单 + 交付记录移入 `completed/phase2/` | ✅ |
| `docs/worklog/README.md` 回写 | ✅ |
| `docs/worklog/pending/phase2-overview-2026-11-03.md` 回写（P2-8 那一行的 ⚠️ 残留项消解） | ✅ |
| WP62 交付记录 §5 残留风险 R1 标注销号 | ✅ |
| commit message 草稿 | `feat(kernel): 内核第三份 clamp01 统一到公开那份, NaN 不再透传` |

---

_本交付记录写于 2026-11-08。_
