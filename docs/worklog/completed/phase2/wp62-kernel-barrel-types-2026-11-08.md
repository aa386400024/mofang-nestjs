# WP62 · 内核端口类型 barrel 收口 任务单

> **路径**：`docs/worklog/completed/phase2/wp62-kernel-barrel-types-2026-11-08.md`
> **状态**：✅ 已交付
> **交付记录**：[`engine-wp62-kernel-barrel-types-implementation-2026-11-08.md`](engine-wp62-kernel-barrel-types-implementation-2026-11-08.md)
> **创建日期**：2026-11-08
> **交付日期**：2026-11-08
> **关联 WP**：WP62
> **前置文档**：先读 `docs/worklog/README.md` 和 `docs/README.md`

---

## 一、背景与目标

### 1.1 背景

WP59 交付时发现：有些端口类型/函数没进 barrel，适配层不能深路径 import（会被边界断言拦下），只能用结构化类型代替（自己写一份形状一样的类型）。

现在攒了 2 个要补的，一起补进 barrel + 同步边界断言白名单，一次搞定。

### 1.2 目标

把适配层需要、但没进 barrel 的端口类型/函数补进内核公开出口，同步更新边界断言白名单。

---

## 二、开工前核实清单（后端开工前先做）

逐条 grep / 读代码核实，不要照任务单写的假设直接实现：

| # | 要核实什么 | 怎么核实 |
|---|---|---|
| 1 | 现在有哪些端口类型/函数没进 barrel，但适配层在用？ | 读适配层里的注释（memory-config.ts / builtin-character-registry.ts 等），找"故意不写成内核的某个类型"这类注释 |
| 2 | 现在边界断言 boundary.spec.ts 的断言⑥（公开面白名单）和断言⑦（内核文件清单）是什么样的？ | 读 `test/engine-core/boundary.spec.ts` |
| 3 | 现在内核 barrel（index.ts）导出了哪些类型/函数？ | 读 `src/engine-core/index.ts` |
| 4 | RecallPolicyOptions 在哪个文件里？ | 读 `src/engine-core/memory/recall-policy.ts` |
| 5 | clamp01 在哪个文件里？ | 读 `src/engine-core/domain/emotion.ts` |

---

## 三、设计方案

### 3.1 要补进 barrel 的符号

**已知的 2 个：**

| # | 符号 | 类型 | 所在文件 | 为什么要进 barrel |
|---|---|---|---|---|
| 1 | `RecallPolicyOptions` | 类型 | `memory/recall-policy.ts` | 适配层 memory-config.ts 用结构化类型代替，要改成直接 import |
| 2 | `clamp01` | 函数 | `domain/emotion.ts` | 适配层 builtin-character-registry.ts 自己写了一份，要改成直接 import |

**后端开工时再扫描一下，看看还有没有其他的。**

### 3.2 同步更新边界断言

补进 barrel 的符号，要同步登记到 boundary.spec.ts 的：
- 断言⑥：公开面白名单（加这些新导出的符号）
- 断言⑦：内核文件清单（如果有新的内核文件要导出的话）

**注意：边界断言是双向的**——一边是"barrel 里导出的符号都在白名单里"，另一边是"白名单里的符号都在 barrel 里导出了"。补导出后必须同步加白名单，否则断言会红。

### 3.3 适配层改动

适配层里用结构化类型/自己写一份的地方，改成直接从 barrel import。

---

## 四、交付物

### 4.1 后端交付物

| # | 交付物 | 说明 |
|---|---|---|
| 1 | barrel 补导出 | 把 RecallPolicyOptions / clamp01 / 其他扫描出来的符号补进 `src/engine-core/index.ts` |
| 2 | 边界断言同步 | boundary.spec.ts 的断言⑥白名单加这些新导出的符号 |
| 3 | 适配层改动 | memory-config.ts / builtin-character-registry.ts 改成直接从 barrel import，删掉自己写的结构化类型/自己写的函数 |
| 4 | 单测 | 确保边界断言全绿，全量单测全绿 |

---

## 五、边界与注意点

### 5.1 兼容性

- **补导出是纯增量**：只加导出，不改任何现有导出，零回归。
- **补导出前先核实有没有重复**：先看看 RecallPolicyOptions / clamp01 有没有已经在 barrel 里导出了，避免重复导出。
- **适配层改成直接 import 后，行为逐字不变**：结构化类型和内核类型是结构性兼容的，改成直接 import 后编译期校验更严格，但行为不变。
- **适配层要删掉自己写的实现**：builtin-character-registry.ts 里自己写了一份 clamp01，改成直接 import 后，要删掉自己写的那份，避免两份实现漂移。

### 5.2 engine-core 红线

- engine-core 只改 `index.ts`（加导出），不改任何算子逻辑、不改任何现有代码。
- 内核零 env 读取。

### 5.3 不要做的事

- 不要改任何现有导出的符号。
- 不要改任何算子逻辑。
- 不要为了"凑数"而补没必要的符号——只补适配层真的在用的。

---

## 六、闸门（每个 WP 都要）

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 只改了 index.ts（加导出），没改其他文件
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

> 详细交付记录见 [`engine-wp62-kernel-barrel-types-implementation-2026-11-08.md`](engine-wp62-kernel-barrel-types-implementation-2026-11-08.md)。
> 下表是**与任务单有出入的地方**的摘要, 完整论证见交付记录 §3。

| # | 偏差 | 理由 |
|---|---|---|
| D1 | **补了 3 个符号**（不是 §3.1 列的 2 个）: 多补了 `clampValence` | §3.1 明写「开工时再扫描一下」; 扫描发现 `builtin-character-registry.ts` 自带 **两份** 副本（`clamp01` + `clampValence`）—— 只补一个的话 §5.1「适配层要删掉自己写的实现」的目标**没达成** |
| D2 | §5.1「行为逐字不变」**只在所有可达输入上成立**; 病态值（±Infinity / NaN）上三份副本口径本就不一致 | 已核实所有可达输入（种子常量 / DB 数值列 / JSON 请求体 —— JSON 无法表达 Infinity / NaN）**逐字不变**; 差异只在病态值。其中 `qdrant-memory.store.ts` 的「NaN 透传 → 内核 NaN → 0」是**严格改善**（NaN 会让 `ranked.sort` 比较恒 false, 排序不可预期） |
| D3 | `character-profile.entity.ts` 的 `CharacterNarrativeStyle` **零改动** | 核实后是 `NonNullable<CharacterProfile['narrativeStyle']>` **派生**写法, 不是重复声明, 且 `CharacterProfile` 已在 barrel —— 无需动 |
| D4 | 内核私有 `importance-decay.ts` 的第三份 `clamp01`（NaN 透传）**不动** | 改它要动内核算子逻辑, 超出 §5.2 授权（`engine-core` 只改 `index.ts`）→ 登记为残留风险, 另开单 |
| D5 | `resolveEmotionLabel` **不补导出** | 适配层只在**注释**里提到它, **没有任何实际 import / 调用** → 按 §5.3「不要凑数」 |
| D6 | 两处**过期注释**一并重写 | `memory-config.ts` 那段「⚠️ 返回类型**故意不写成内核的 `RecallPolicyOptions`**…超出本单预批准范围」与 `builtin-character-registry.ts` 那段「内核 clamp01 没从公开 barrel 导出」在本单当场作废 —— 留着就是给下一个人的假话 |
| D7 | **新增**一条机器守卫测试（任务单 §4.1 只要求"全绿"） | 断言⑥ 只守**内核公开面**, 守不到"适配层自己抄了一份" —— 而后者正是本单的核心问题。新增 `test/engine-adapters/wp62-kernel-barrel-types.spec.ts` 断言②: 适配层再出现 `function clamp01(` / `function clampValence(` 就红 |

**闸门**: eslint 0 error / tsc 0 error / vitest **134 passed | 1 skipped（135 files）· 2293 passed | 4 skipped（2297）**（新增 4 例）/ `git diff --stat HEAD -- src/engine-core` = **1 file changed, +7/-1**（只有 `index.ts`）/ 断言⑦ **未动**（本单无新内核文件）。

**commit message 草稿**: `feat(wp62): 内核端口类型与 clamp 函数补进 barrel, 适配层删掉自写副本`

---

_本任务单创建于 2026-11-08。_
