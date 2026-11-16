# 内核内部 clamp01 统一 任务单

> **路径**：`docs/worklog/completed/phase2/kernel-internal-clamp-unify-2026-11-08.md`
> **状态**：✅ 已交付
> **交付记录**：[`engine-kernel-internal-clamp-unify-implementation-2026-11-08.md`](engine-kernel-internal-clamp-unify-implementation-2026-11-08.md)
> **创建日期**：2026-11-08
> **交付日期**：2026-11-08
> **关联**：WP62 残留风险 R1
> **前置文档**：先读 `docs/worklog/README.md` 和 `docs/README.md`

---

## 一、背景与目标

### 1.1 背景

WP62 交付时发现：内核内部还有第三份 `clamp01`（`memory/importance-decay.ts:44`，NaN 透传），和公开那份（`domain/emotion.ts`，NaN → 0）同名不同语义。

名字一样 = 最容易踩：将来有人从内核内部 import 它，拿到的是另一套口径。

### 1.2 目标

把内核内部的 clamp01 改成直接复用 `domain/emotion.ts` 那份，删掉自己写的副本。

---

## 二、开工前核实清单（后端开工前先做）

逐条 grep / 读代码核实，不要照任务单写的假设直接实现：

| # | 要核实什么 | 怎么核实 |
|---|---|---|
| 1 | 现在 `domain/emotion.ts` 的 clamp01 是什么样的？ | 读 `src/engine-core/domain/emotion.ts:24` |
| 2 | 现在 `memory/importance-decay.ts` 的 clamp01 是什么样的？ | 读 `src/engine-core/memory/importance-decay.ts:44` |
| 3 | importance-decay.ts 里的 clamp01 用在哪里？ | grep 一下 |
| 4 | 内核里还有没有其他的 clamp 副本？ | grep 全 `src/engine-core` 找 `function clamp*` |

---

## 三、设计方案

### 3.1 改动

**`src/engine-core/memory/importance-decay.ts`：**
1. 删掉自己写的 `clamp01` 函数
2. 改成从 `../domain/emotion.js` import `clamp01`

### 3.2 行为差异

| 实现 | NaN |
|---|---|
| 旧的（importance-decay.ts 本地） | NaN 透传 |
| 新的（domain/emotion.ts 公开那份） | NaN → 0 |

**这个变化是改善**：NaN 会让排序、比较都出问题（和 WP62 里 qdrant-memory.store.ts 的 NaN 透传是同一个问题）。

---

## 四、交付物

### 4.1 后端交付物

| # | 交付物 | 说明 |
|---|---|---|
| 1 | 删掉本地 clamp01 | importance-decay.ts 删掉自己写的 clamp01 函数 |
| 2 | 改成 import | 从 `../domain/emotion.js` import clamp01 |
| 3 | 单测 | 确保全量单测全绿，行为变化（NaN → 0）有单测覆盖 |

---

## 五、边界与注意点

### 5.1 兼容性

- **可达输入行为不变**：importance 来自种子常量 / DB 数值列 / JSON 请求体，JSON 无法表达 NaN，所以所有可达输入逐字不变。
- **病态输入改善**：NaN 从透传改成 → 0，是严格改善。

### 5.2 engine-core 红线

- engine-core 可以改，但只删一个函数 + 加一个 import，不改任何算子逻辑。
- 内核零 env 读取。

### 5.3 不要做的事

- 不要改 domain/emotion.ts 里的 clamp01 实现。
- 不要改任何算子逻辑。
- 不要为了"凑数"而改其他文件。

---

## 六、闸门（每个 WP 都要）

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 只改了 importance-decay.ts（删一个函数 + 加一个 import）
```

---

## 七、交付后回写

完成后回写：
1. 更新本任务单状态为 ✅
2. 写交付记录到 `docs/worklog/completed/phase2/`
3. 更新 `docs/worklog/README.md`

---

## 八、偏差说明

后端如果发现更合理更专业的方案，可以按照后端来，但要在交付记录里写明偏差和理由。

---

---

## 九、交付后补记（2026-11-08）

> 详细交付记录见 [`engine-kernel-internal-clamp-unify-implementation-2026-11-08.md`](engine-kernel-internal-clamp-unify-implementation-2026-11-08.md)。
> 下表是**与任务单有出入的地方**的摘要, 完整论证见交付记录 §3。

| # | 偏差 | 理由 |
|---|---|---|
| D1 | **内核内部用相对路径 import**（`from '../domain/emotion.js'`）, 不绕道 barrel | 照任务单 §3.1 原文; 且现有内核文件（`state-transition.ts` / `session-decay.ts` / `trajectory-applier.ts` / `bootstrap.ts`）**全都**这么写 —— 跟着现有约定, 不引入第二种写法。边界断言 ⑪ 限制的是**适配层**, 内核内部互引不受限 |
| D2 | 单测直接钉住 **`decayImportance` / `effectiveImportance`** 的 NaN 行为, 不只钉 `clamp01` 本身 | 断言"clamp01 对"只能证明函数本身对了, 证不了**公开导出的算子**真的用上了它 —— 算子内部可能还藏着别的夹取点。钉在调用方看得见的出口上才有价值 |
| D3 | 守卫断言扫**内核树全部 .ts**（不只是被改的那个文件） | 本单的问题就是"同一个名字散在多个文件"。只扫一个文件只能证明"我改干净了", 证不了"别处没有第二份" |
| D4 | ⚠️ **旧口径的病态行为比任务单 §3.2 描述的更糟**: NaN 能**绕过召回门槛** | `recall-policy.ts` 的门槛判定是 `effective < minEffectiveImportance`, 而 **NaN < 0.1 恒为 false** → 旧口径下 `importance=NaN` 的记忆**不被拒绝、直接被召回**, 且带着 `effectiveImportance: NaN` 进排序。**脏数据直接进了召回结果**。新口径 NaN → 0 → `0 < 0.1` 为 true → **被正确拒绝**。这比"排序被污染"严重一档, 是本单的实质收益 |
| D5 | **不挪** `clamp01` 到中性模块（如 `domain/numeric.ts`）, 严格守 §5.2 / §5.3 | 它是通用数值工具却住在"情绪"模块里, 名不副实 —— 但挪位置要改 barrel + 断言⑥白名单 + 断言⑦文件清单 + 4 个已 import 的内核文件, 改动面从 1 个膨胀到 7+ 个, 与"删一份重复实现"的小目标不成比例; 且 `clamp01` 现在是**公开出口**符号, 挪位置 = 动公开 API 面的来源文件, 属另一个量级的变更 → 登记为残留风险 **R2**, 另开单可议 |
| D6 | 注释里**保留"原先自带一份、NaN 透传"这个历史事实** | 只写"现在是什么"不写"为什么变", 下一个人会以为这行 import 是随手加的, 于是"顺手"再写一份本地副本。故意的决定要留下痕迹（同 WP62 D6） |

**核实结论补充**（任务单 §二 第 4 条"内核里还有没有其他的 clamp 副本"）: **没有了**。全 `src/engine-core` 扫 `function clamp\w*` 只有 3 处 —— `domain/emotion.ts` 的 `clamp01` + `clampValence`（公开出口那份）+ `memory/importance-decay.ts` 的 `clamp01`（**本单删掉**）。其余提到 clamp 的内核文件（`bootstrap.ts` / `state-transition.ts` / `session-decay.ts` / `trajectory-applier.ts`）**本来就在用** `domain/emotion.js` 那份。

**行为差异的精确边界**（逐输入实测）: 差异面**只有 NaN**。两版的 ±Infinity 行为完全一致（+Inf → 1, -Inf → 0）—— 与 WP62 那次的三副本三种口径（差异面含 ±Infinity）不同。

**闸门**: eslint 0 error / tsc 0 error / vitest **135 passed | 1 skipped（136 files）· 2297 passed | 4 skipped（2301）**（新增 4 例）/ `git diff --stat HEAD -- src/engine-core` = **1 file changed, +16/-7**（只有 `memory/importance-decay.ts`，算子逻辑零改动）/ 断言⑥⑦ **均未动**。

**commit message 草稿**: `feat(kernel): 内核第三份 clamp01 统一到公开那份, NaN 不再透传`

---
_本任务单创建于 2026-11-08。_
