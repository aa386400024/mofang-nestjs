# cap 配置统一 交付记录 — 审议侧与规则算子同口径

> 状态: ✅ 已交付
> 任务单: [`deliberation-cap-config-unification-2026-11-07.md`](deliberation-cap-config-unification-2026-11-07.md)
> 日期: 2026-11-07
> 红线: ✅ **engine-core 零改动** —— `git diff --stat HEAD -- src/engine-core` = **空**（直接用内核现有 `capTurnDelta(raw, config?)` + `DeltaCapConfig` 端口，**不碰内核代码**）
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 例，零改动即零影响）
> 北极星: [`../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md`](../../../architecture/hybrid-bdi-agent-blueprint-v1.0.md) §2.3 约束校验层 + 切灰度前置
> 承接: 约束校验层（delta cap）/ 过期判定与丢弃
> ⚠️ **影子模式不变** —— 审议结果照旧**不写** BDI 快照；本单只是让"两边的 cap 边界"用**同一份配置**，切灰度后才不会因为口径不一致把 `deltaDiff` 算歪

---

## 1. 实际改了哪些文件

### 1.1 生产代码：1 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/deliberation/llm-deliberation.service.ts` | **改**（+59 行 / -7 行）：① import 加 `resolveDeltaCapConfig`（from `../wiring/delta-cap.config.js`）+ `type DeltaCapConfig`；② `applyDeliberationDeltaCap(deltas, config?)` 加**可选**第二参并透传给 `capEntryDelta`；③ `capEntryDelta(dim, value, config?)` 加**可选**第三参，`capTurnDelta(probe, config ?? DEFAULT_DELTA_CAP_CONFIG)`；④ `LlmDeliberationService` 新增私有字段 `capConfig: DeltaCapConfig`，在**构造函数体内** `this.capConfig = resolveDeltaCapConfig(config)`；⑤ 调用点 `applyDeliberationDeltaCap(output.deltas, this.capConfig)`；⑥ 文件头补本单说明块 |

### 1.2 测试：1 增 0 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-adapters/wp-deliberation-cap-config.spec.ts` | **新增 8 例**（本单主测试）：① 传 config 时按 config 砍 2 例 ② 缺省行为逐字不变 2 例 ③ env 覆写后审议侧跟着变 2 例 ④ 两侧口径一致 2 例 |
| `test/engine-adapters/wp-deliberation-delta-cap.spec.ts` | **零改动** —— 任务单闸门 6「现有单测零改动」的直接证据（该文件 20 例一行未改） |
| 其余 6 个审议 spec（wp64 / wp65 ×2 / wp66 / wp68 / wp58-debug） | **零改动** —— 本单没动 service 的**依赖签名**（只多了一个内部字段），构造方式一字不变 |

### 1.3 文档

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/pending/deliberation-cap-config-unification-2026-11-07.md` | 状态行改 ✅ + 指向交付记录；追加「§十二 交付后补记」偏差表 → 移入 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 「切灰度前置」小结块补一条 ✅（cap 配置统一）；同步修正「约束校验层 · delta cap」那条的口径（见 §2.5） |
| `docs/worklog/README.md` | Phase2 已开工列表加一条（cap 配置统一） |

### 1.4 **零改动**（逐条核实过）

- `src/engine-core/**` —— **一行未动**（`git diff --stat HEAD -- src/engine-core` = 空）
- `src/engine-adapters/wiring/delta-cap.config.ts` —— **一行未动**（`resolveDeltaCapConfig` 本来就是纯函数，审议侧**复用**它，不另写一份）
- `src/engine-adapters/wiring/engine.module.ts` —— **一行未动**（规则侧的装配点 `capConfig: resolveDeltaCapConfig(config)` 一字未动）
- 内核 `capTurnDelta` / `resolveBounds` / `capAsym` / `DEFAULT_DELTA_CAP_CONFIG` —— **零改动**（`capTurnDelta(raw, config?)` 本来就支持可选 config）
- 无 migration / 无 entity / 无新表 / 无新列
- **不新增 env 键** —— 复用既有的 22 个 `ENGINE_CAP_*`（与规则算子同一套）
- **不新增 provider / token** —— 构造函数里直接调纯函数
- **不新增 admin 接口 / trace 字段** —— `capEntries` 已经有了，capConfig 的值在 env 里（debug 面板本来就能看 env）
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）

---

## 2. 关键设计决策（与任务单有出入的地方 + 为什么）

> 任务单与代码不符的地方按 `team/conventions.md` §2.5 处理：**先 grep 核实 → 找企业级最佳方案 → 在交付记录里写明偏差**。
> 任务单 §二的 6 条核实清单**逐条自己 grep 核实过 —— 全部属实**，无一写错。

### 2.1 决策 D1（最重要）：任务单 §三 改动点 2 与 §4.3 **自相矛盾** —— 只能用 §4.3 的写法

**任务单两处写法冲突**：

- §三 改动点 2：`private readonly capConfig: DeltaCapConfig = resolveDeltaCapConfig(config)` —— **字段初始化器**；
- §4.3：字段只声明，`this.capConfig = resolveDeltaCapConfig(config)` 放**构造函数体内**。

**为什么必须选 §4.3**（字段初始化器形式在本仓库会**直接抛**）：

- `tsconfig` 的 `target` 是 `es2024`，`useDefineForClassFields` **未显式设置** → 默认 **true**；
- `useDefineForClassFields: true` 下，**字段初始化器在类字段定义阶段就执行** —— 那时构造参数 `config` **还没赋值**（TypeScript 的参数属性赋值发生在**构造函数体内**）；
- 于是初始化器里的 `config` 是 `undefined` → `resolveDeltaCapConfig(undefined)` → 访问 `config.get` 时**抛 TypeError**；
- 症状是**服务一被实例化就崩**（不是静默失效，比静默失效好，但一样不能上）。

**落法**（= 任务单 §4.3）：字段 `private readonly capConfig: DeltaCapConfig;` 只声明，赋值放构造函数体。

**为什么这类"字段初始化器引用构造参数"的坑值得写进交付记录**：仓库里 `LlmDeliberationService` 已有 `private readonly logger = new Logger(...)` 这类字段初始化器，**看起来**"字段初始化器可用"—— 但那个初始化器不依赖构造参数。**规则不同**：不依赖构造参数的字段初始化器随便用，依赖构造参数的**必须**进构造函数体。

**并且**：本单**不需要**为这个坑加单测 —— 它在 `new LlmDeliberationService(...)` 的第一行就会炸，**8 个新增用例全部要过这个构造**（用例 ③-1 / ③-2 / ④-1 都是端到端跑真 service）。字段初始化器写法会在**用例 ③-1 就红**。

### 2.2 决策 D2：任务单 §八 5 关于「热更新」的描述**与代码事实相反** —— 本单**不做**热更新，但理由要改

**任务单原文**（§八 反双胞胎第 5 条）：

> **不做热更新** —— 运维中途改 env，规则算子的新 session 会用新配置，审议侧还是旧的。影子期无所谓，切灰度时如果需要热更新再做

**核实结果**（grep 实证，不是照抄任务单）：

| 侧 | 求值位置 | 语义 |
|---|---|---|
| 规则算子 | `engine.module.ts:308` —— `ENGINE_SESSION_PORT` provider 的 `useFactory` 里 `capConfig: resolveDeltaCapConfig(config)`，结果传给 `InMemoryEngineSession`（`engine.providers.ts:234`） | Nest 默认 scope = **singleton** → **启动期求值一次**，之后所有 session 共用同一份 |
| 审议侧（本单） | `LlmDeliberationService` 构造函数体（service 是单例） | **启动期求值一次** |

**结论**：任务单说的"规则侧会用新配置、审议侧还是旧的"**在当前代码里不成立** —— **两侧都在启动期读一次 env**，运维中途改 env **两侧都不变**。

**为什么这条偏差重要**（不是文字游戏）：任务单原本描述的正是"**本单要消灭的那个分歧**"—— 但那个分歧的成因被写错了。真实的分歧不是"热更新不对称"，而是"**审议侧压根不读 env**"（一直用硬编码种子值）。本单修的是后者。

**顺带的收益**：本单落地后，两侧**都是**启动期求值 → **口径真正恒等**（不会出现"规则侧改了、审议侧没改"的时间窗）。任务单 §八 5 的"不做热更新"这条**约束照办**（不引入任何热更新机制），但**理由**从"两侧不对称"更正为"**两侧对称地不热更新**"。

### 2.3 决策 D3：`config` 参数**可选** —— 照办，且已有代码事实支撑

- 任务单 §三 / §4.1 / §八 的方向**正确**，照办：`config?: DeltaCapConfig`，缺省 `config ?? DEFAULT_DELTA_CAP_CONFIG`；
- **代码事实支撑**（不是"应该安全"，是"内核已经保证"）：内核 `resolveBounds(dim, config)`（`state-transition.ts:456-464`）对**缺项**（`!provided` → 整维回退种子值）和**非法值**（`sanitizeBound` → 逐项回退）都有兜底 → 传一份 config 进去**不可能**把"砍幅"变成"放大幅度"；
- **实测证据**：闸门 6 由 `wp-deliberation-delta-cap.spec.ts` **零改动 20 例全绿** + 新增用例 ②-1（`不传 config` 与 `显式传种子值` 的结果 `toEqual` 逐字一致）共同钉死。

### 2.4 决策 D4：调用点**仍留在 `buildSuccessRecord` 内部** —— 沿用 delta-cap 那单的结构性决策

任务单 §4.4 只说"调用点传 config"，没说挪位置。本单**不挪** —— 沿用 delta-cap 交付时的结构性理由："进 trace 的 delta 必然过了约束校验层"，杜绝"换个调用点忘了砍"这类静默失效。

### 2.5 决策 D5：wp-list 的回写点 —— 任务单 §十 说"切灰度前置剩余清单里那条"，但清单里**没有独立条目**

**核实**：`phase2-wp-list-2026-11-03.md` 里**没有**"cap 配置统一"这个条目 —— 切灰度前置的几项（delta cap / 过期判定 / 临床合理性）都写在**叙述性小结块**里（`:125` / `:129` / `:135` / `:137`），不是表格行。

**落法**（按"不降级交付质量"处理）：

- 在小结块**补一条 ✅**（紧跟"过期判定与丢弃"那条之后），把"cap 配置统一"这条切灰度前置项**销掉**；
- **同时修正 `:125` 那条的口径** —— 它写的是"直接复用内核 `capTurnDelta` + `DEFAULT_DELTA_CAP_CONFIG`，**与规则算子同一口径**"。这句在 2026-11-06 当时**不准确**（审议侧读的是硬编码种子值，规则侧读 env —— 那时两边**不同**口径），本单之后才真正成立。不改这一行，文档会**长期撒谎**。

---

## 3. 闸门数字（本单实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error / 0 warning** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| 本单新增单测 | `npx vitest run test/engine-adapters/wp-deliberation-cap-config.spec.ts` | **8 例全绿** ✅ |
| cap 组回归 | `npx vitest run`（3 个 cap 相关 spec） | **36 例全绿** ✅ |
| 全量单测 | `npx vitest run --exclude "**/e2e/**/*.ts"` | **127 文件 / 2160 例全绿** ✅ |
| 边界断言 | `npx vitest run test/engine-core/boundary.spec.ts` | **12 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空**（零改动） ✅ |

**全量单测对比**：改动前 **126 文件 / 2152 例**，改动后 **127 文件 / 2160 例**（+1 文件 = 本单新测试；+8 例 = 本单新增用例；**既有 2152 例零失败、零改动**）。

**根 `npx tsc --noEmit`（含 `test/`）**：基线既有 2 个报错（`wp58-debug-session.spec.ts:227` / `:456`）依旧存在，**本单未新增**（本单只碰了 1 个生产文件 + 新增 1 个测试文件，两者根 tsc 均零报错）。

---

## 4. 验收逐条（任务单 §九）

| # | 闸门 | 要求 | 结果 |
|---|---|---|---|
| 1 | ESLint | 0 problem | ✅ **0 error / 0 warning** |
| 2 | TypeScript | 0 error | ✅ **0 error** |
| 3 | 单测 | 全量跑通，不新增失败 | ✅ **127 文件 / 2160 例全绿** |
| 4 | engine-core | 零改动 | ✅ **`git diff --stat HEAD -- src/engine-core` = 空** |
| 5 | 口径一致 | 审议侧与规则算子用同一份 `resolveDeltaCapConfig(config)` 的结果 | ✅ 用例 ④-1（同一份 env → 规则侧 config 的边界 == 审议侧砍出的值）；实现上是**同一个纯函数** |
| 6 | 缺省行为 | 不传 config 时行为与之前完全一致 | ✅ 用例 ②-1（`toEqual` 逐字一致）/ ②-2（±0.15）；且 `wp-deliberation-delta-cap.spec.ts` **零改动 20 例全绿** |
| 7 | 环境变量生效 | 改 `ENGINE_CAP_POSITIVE_UP=0.1`，审议侧移情三维 cap 跟着变 | ✅ 用例 ③-1（端到端 trace 里 `deliberationDelta.positive === 0.1`、`capEntries` 记 `{raw:0.18, capped:0.1}`） |

**额外覆盖**（任务单未列，本单补的）：

- ④-2 非法 env 值两边**一起**回退种子值（`ENGINE_CAP_POSITIVE_UP=abc` → 规则侧 config 回退 → 审议侧砍幅仍是 0.15）—— 钉死"配错不会让两边分叉"；
- ①-2 整份 config 透传（不止某一维生效）—— 钉死"不是只对移情三维特殊处理"。

---

## 5. 切灰度时必须知道的一件事（**本单不写进代码**，留给 Phase3A）

**两侧口径一致，但"一致"的时效边界是"启动期"** —— 运维改 `ENGINE_CAP_*` env 后需要**重启进程**才生效（规则侧是 `ENGINE_SESSION_PORT` provider 的 useFactory，审议侧是 service 单例的构造函数）。**不会出现"规则侧新、审议侧旧"的时间窗**，但也不会自动热更新 —— 真要切灰度且需要动态调 cap，得另开单做热更新机制（任务单 §八 5 已明确本期不做）。
