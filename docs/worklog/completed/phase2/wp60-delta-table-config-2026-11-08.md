# WP60 · delta 规则表配置化 任务单

> **路径**：`docs/worklog/completed/phase2/wp60-delta-table-config-2026-11-08.md`
> **状态**：✅ 已交付
> **交付记录**：[`engine-wp60-delta-table-config-implementation-2026-11-08.md`](engine-wp60-delta-table-config-implementation-2026-11-08.md)
> **创建日期**：2026-11-08
> **交付日期**：2026-11-08
> **关联 WP**：WP60
> **前置文档**：先读 `docs/worklog/README.md` 和 `docs/README.md`

---

## 一、背景与目标

### 1.1 背景

现在事件→delta 映射硬编码在内核 `state-transition.ts` 的 `DELTA_TABLE` 里，改一个数字要发版。

现在已经有了部分配置化：`AllianceConfig` 端口可以覆写 safety / bond 的系数。但其他维度（trust / valence / arousal / verbal / depth / style / positive / negative / dependency）还是硬编码在 `DELTA_TABLE` 里。

后期运营/心理咨询师要自定义规则时，改一个数字要发版太慢了。

### 1.2 目标

把整个 `DELTA_TABLE` 抽成配置端口 `DeltaTableConfig`，适配层从 env 读，注入内核。

---

## 二、开工前核实清单（后端开工前先做）

逐条 grep / 读代码核实，不要照任务单写的假设直接实现：

| # | 要核实什么 | 怎么核实 |
|---|---|---|
| 1 | 现在 `DELTA_TABLE` 有多少个事件？多少个维度？ | 读 `src/engine-core/cognition/state-transition.ts` 的 `DELTA_TABLE` |
| 2 | 现在 `AllianceConfig` 是怎么覆写的？ | 读 `src/engine-core/cognition/alliance-config.ts` |
| 3 | 现在 `DeltaCapConfig` 是怎么从 env 装配的？ | 读 `src/engine-adapters/wiring/delta-cap.config.ts` |
| 4 | 现在 `aggregateTurnDelta()` 函数签名是什么？ | 读 `state-transition.ts` 的 `aggregateTurnDelta()` |
| 5 | 现在内核的 barrel 导出了哪些类型？ | 读 `src/engine-core/index.ts` |

---

## 三、设计方案

### 3.1 设计原则（和现有范式一致）

**单一真相源**：内核里保留种子值作为默认（`DELTA_TABLE`），端口只做覆写。不传配置 = 用内核种子值，逐字不变，零回归。

**内核零 env**：env 由适配层读，组装成 `DeltaTableConfig` 端口，注入内核。内核零 process.env 读取。

**兼容现有行为**：不传 `DeltaTableConfig` 时，行为与改造前逐字一致。

### 3.2 端口设计

**新增 `DeltaTableConfig` 端口**（放在 `src/engine-core/cognition/delta-table-config.ts`）：

```typescript
export interface DeltaTableConfig {
  /**
   * 每个事件的 delta 覆写。
   * key = 事件类型（CounselorEventKind）
   * value = DeltaVector（只覆写要改的维度，缺项回基础值）
   */
  readonly deltas?: Readonly<Partial<Record<CounselorEventKind, DeltaVector>>>;
}
```

**用法**：
- 不传 `DeltaTableConfig` → 用 `DELTA_TABLE` 的基础值（逐字不变）
- 传了 `DeltaTableConfig` → 有覆写的维度用覆写值，没覆写的维度回基础值

### 3.3 适配层装配

**新增 `src/engine-adapters/wiring/delta-table.config.ts`**：

从 env 装配 `DeltaTableConfig`，和 `DeltaCapConfig` 同范式。

**env 键命名（简化版）**：每个事件一个 env 键，JSON 格式
- 比如：`ENGINE_DELTA_EMPATHY={"trust":0.15,"safety":0.02}` → empathy 事件覆写 trust 和 safety
- 没设的事件 → 用基础值
- 每个事件内部只覆写要改的维度，没写的维度回基础值

**为什么不用每个维度一个键**：
- 如果每个事件每个维度一个键，那就是几十上百个 env 键，太多了
- 每个事件一个 JSON 键，既灵活又不会太多

**为什么用 env 而不是 JSON 文件**：
- 现在是单人开发阶段，env 配置就够了
- JSON 配置文件是后期运营要自定义规则时再做（另开单）

### 3.4 内核改动

**`aggregateTurnDelta()` 函数加一个可选参数 `deltaTable?: DeltaTableConfig`**：
- 不传 → 用 `DELTA_TABLE`（逐字不变）
- 传了 → 有覆写的维度用覆写值

**和 `AllianceConfig` 的关系**：
- `AllianceConfig` 现在只覆写 safety / bond
- `DeltaTableConfig` 覆写所有维度
- 两者叠加时：`DeltaTableConfig` 优先，`AllianceConfig` 次之，基础值兜底

---

## 四、交付物

### 4.1 后端交付物

| # | 交付物 | 说明 |
|---|---|---|
| 1 | `DeltaTableConfig` 端口 | 内核新增，纯类型 + 纯函数 |
| 2 | `aggregateTurnDelta()` 加参数 | 加可选参数 `deltaTable?: DeltaTableConfig` |
| 3 | 适配层装配 | `resolveDeltaTableConfig(config)` 从 env 读 |
| 4 | 注入到会话 | 会话创建时把配置传进去 |
| 5 | 单测 | 覆盖覆写逻辑、兼容现有行为、env 装配 |
| 6 | barrel 导出 | `DeltaTableConfig` 类型进 barrel（如果边界断言允许的话；如果不允许，用结构化类型，和 WP62 同范式） |

---

## 五、边界与注意点

### 5.1 兼容性

- **不传配置时**：行为与改造前逐字一致，零回归。
- **env 没设时**：回基础值，不抛错。
- **非法值**：回基础值（和 `DeltaCapConfig` 同范式）。

### 5.2 配置优先级

**优先级从高到低（逐维度叠加）**：
1. `DeltaTableConfig`（env 覆写的特定维度）
2. `AllianceConfig`（同盟三维 safety / bond 的覆写）
3. `DELTA_TABLE`（内核种子值）

**叠加规则（重要）**：
- 按**单个维度**逐优先级取值，不是按整个事件整体覆盖
- 例子：如果 `DeltaTableConfig` 覆写了 empathy 的 trust，`AllianceConfig` 覆写了 empathy 的 safety / bond，那 empathy 的最终 delta 是：
  - trust = DeltaTableConfig 的覆写值
  - safety = AllianceConfig 的覆写值
  - bond = AllianceConfig 的覆写值
  - 其他维度（valence / arousal 等）= DELTA_TABLE 的基础值
- 这样设计的好处：`DeltaTableConfig` 和 `AllianceConfig` 各管各的维度，不互相打架

### 5.3 engine-core 红线

- engine-core 可以改，但只加端口类型和函数参数，不改算子逻辑。
- 内核零 env 读取。

### 5.4 不要做的事

- 不要把 `DELTA_TABLE` 从内核里删掉（它是种子值，是默认值）。
- 不要改成 JSON 配置文件（本期只做 env 配置化，JSON 是后期的事）。
- 不要改 `AllianceConfig` 的现有行为（它还是只覆写 safety / bond）。
- 不要给 `DELTA_TABLE` 里没列的事件加配置支持（没列的事件 delta 就是 0，配置化也没意义）。

---

## 六、闸门（每个 WP 都要）

```powershell
npx eslint "src/**/*.ts"          # → 0 error
npx tsc -p tsconfig.build.json --noEmit  # → 0 error
npx vitest run                    # → 全绿
git diff --stat HEAD -- src/engine-core   # → 只加了端口类型和函数参数，没改算子逻辑
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

_本任务单创建于 2026-11-08。_

---

## 九、交付后补记（2026-11-08 · 后端偏差表）

> 完整理由见交付记录 [`engine-wp60-delta-table-config-implementation-2026-11-08.md`](engine-wp60-delta-table-config-implementation-2026-11-08.md) §3。

| # | 任务单原文 | 后端改法 | 为什么 |
|---|---|---|---|
| D1 | §3.2 端口形状 `deltas?: Readonly<Partial<Record<CounselorEventKind, DeltaVector>>>` | 改成**维度级** Partial: `DeltaDimensionOverride = Readonly<Partial<DeltaVector>>` | `DeltaVector` 11 个字段**全必填**，事件级 `Partial` 只解开"事件"那层，解不开"维度"那层 —— 任务单 §5.2 要的"只配 trust、其余回基础值"在原类型里**根本表达不了**（要配就得 11 维全填） |
| D2 | §3.4「`aggregateTurnDelta()` 加一个可选参数 `deltaTable?`」（未指定位置） | 加在**第三位**: `(events, alliance?, deltaTable?)` | 既有调用点零改动；改成 options 对象会让 `aggregateTurnDelta(events, alliance)` 类型报错 = 改已发布契约，而本单要的是"只加一个可选参数, 零回归" |
| D3 | （未提） | 维度名单**只留一份**：内核原有 `CAP_DIMS` 改为 `DELTA_DIMENSIONS` 的别名 | WP60 之后维度名单有第二处用途（覆写索引 + 适配层校验 env 的 JSON 键）→ 两份名单 = 两张会漂的清单。cap 报告顺序不变 |
| D4 | （未提） | 加**编译期断言** `DeltaDimensionsMatch` + `DELTA_DIMENSIONS_MATCH` | 少一维 = 那个维度永远配不上；多一维 = 覆写值存下来没人消费 —— 两者都是静默失效。断言让它们变成**编译期报错**。常量是死代码，只为逼类型被求值（类型别名是惰性的） |
| D5 | §5.1「非法值：回基础值」 | 照做，**再加一条：每条被丢弃的覆写都 warn 一声**（`onWarn` → 装配层 `Logger`） | 本仓最贵的 bug 是"配了不生效却什么提示都没有"（WP48 整套 env 守卫都冲这个去）。`onWarn` 可选 → 装配层仍是纯函数，单测可捕获告警 |
| D6 | （未提） | 审计面 `turn-delta-audit.service.ts` **同步注入** deltaTable | 否则审计记的 raw_delta 与内核**实际施加的**对不上 —— 观测一旦与内核漂移，它记的数就是骗人的数（WP58 交付记录 D3 同款纪律） |
| D7 | §3.3 每事件一个 JSON 键 | ✅ 采纳 | 维度级 = 121 个 env 键，没法维护；事件级 = 11 个 |
| D8 | §3.3 没说清覆写是**替换**还是叠加 | 定为**替换**（覆写值 = 该维度最终系数） | 否则"把 trust 从 0.10 调到 0.15"得写成 0.05，太反直觉。测试里钉死 |

### 本单**没做**的

- **事件级权重 / 条件规则**（§3.4 提到）—— 本期只做"逐维度常数覆写"；条件规则不是配置表，是规则引擎，另开单。
- **JSON 配置文件**（§3.3 明确本期不做）—— env 这层将来退化成"默认 + 覆盖"。
- **导出 `DELTA_TABLE` 基础表**—— 基础表仍私有（外部无法绕过端口改基础值）。

### 闸门数字

- eslint 0 error · tsc 0 error · vitest **2289 passed / 4 skipped（2293）** · boundary 12 例全绿
- engine-core: **3 文件 / +57 / -26** —— 本单授权（§5.3），**基础系数表一行未动**
