# S-1 预研结论 · 探索深度门槛端口化（LOW_DEPTH → AllianceThresholds.openDepth）

> 状态：**【预研结论 · 只读调查】**（2026-11-12）。执行方：MiniMax Code。本文件是 `docs/worklog/pending/phase2.5-s1-open-depth-research-minimax-2026-11-12.md`（预研单）R1–R8 的逐项答复。
> 事实源：`docs/worklog/pending/phase2.5-s1-open-depth-threshold-port-2026-11-12.md`（S-1 任务单）。
> 仓库 / 分支：`mofang-nestjs` / `integrate`。
> **本次调查零代码改动**：未改 `src/**`、未改 `test/**`、未改 `boundary.spec.ts`、未接 env、未跑批次、未 commit。全部结论来自 grep + 读源码（行号以本次读取时的代码为准）。

---

## 1. 总结论

### **有条件可行**

**核心方案（字段名 `openDepth`、种子 0.35、可选字段、不接 env、镜像类型同步）技术上完全成立**，且不需要新增 core 文件、不需要新增公开导出、不需要动 `boundary.spec.ts` —— 这一点已**读源码逐条核实**（见 R4），与任务单 §2.1 口径一致，无出入。

**但任务单 §1 列的三个 core 文件是「必要」而不是「完整」**：真实最小改动面取决于「种子 0.35 放哪」，三种放法对应三种改动面与三处**不同的既有测试后果**：

| 种子放法                                                                                               | 适配层是否改 | 既有适配层 spec 后果                                                                  | 额外改动文件                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **S1（推荐）** `openDepth` 进 `DEFAULT_ALLIANCE_CONFIG.thresholds`，适配层补一行 seed 透传（不接 env） | 改 1 行      | `wp42-alliance-config.spec.ts:75-79` 三键 toEqual **需补一个键**；:37/:95/:107 自动绿 | 适配层 wiring + 适配层 spec（**超出任务单 §3.2 边界，需主控点头**） |
| S2 `openDepth` 进种子对象，适配层不动                                                                  | 不改         | `:37` / `:95` / `:107` **三条全形状 toEqual 直接变红**（种子 4 键 vs 适配层 3 键）    | 适配层 spec（3 行断言）                                             |
| S3 `openDepth` 不进种子对象（另立模块常量 `DEFAULT_OPEN_DEPTH = 0.35`），适配层不动                    | 不改         | **四条全绿，零改动**                                                                  | 无                                                                  |

**条件（必须满足，否则会静默出错）：**

1. **`resolveAllianceThresholds` 的 `!provided` 早退分支（`alliance-config.ts:119`）必须一并改**。现状是 `if (!provided) return seed;` —— 若种子对象里没有 `openDepth`，planner 读到的 `thresholds.openDepth` 是 `undefined`，`depth < undefined` 恒为 `false`，**探索分支永不触发**。这是编译不报错、测试也可能不报错的**静默行为变化**，是本单最危险的单点。
2. **`LOW_DEPTH` 必须删除**（`intention-planner.ts:40`）。`tsconfig.json` 开了 `noUnusedLocals: true`，只改引用不删常量会直接编译报错。
3. **必须补一条断言**：`resolveAllianceThresholds(undefined).openDepth === 0.35`（或等价断言），把上面第 1 条钉死。
4. **S1 需要主控批准突破任务单 §3.2「不改 `engine-adapters/wiring/alliance-config.ts`」** 这一条边界；若不批准，则只能走 S2（改 3 条断言）或 S3（种子拆两处）。

**已确认零风险的部分**：

- `boundary.spec.ts` 断言⑥ / 断言⑦ **不会变红**（R4 已读源码核实）。
- `engine-core` 内**没有**任何对 thresholds 的全形状 `toEqual` 断言，内核 spec 全部是字段级断言 → 解析结果多一个键不会让任何内核用例变红（R2）。
- 门禁盲区一处：`pnpm typecheck` **不覆盖 spec 文件**（`tsconfig.check.json` → `tsconfig.build.json` 的 `exclude` 排除了 `test/**/*` 与 `**/*.spec.ts`）→ 开工单必须补 `pnpm exec tsc -p tsconfig.json --noEmit`（R8 风险 G / §6）。

## 2. 改动面清单

### 2.1 必改（任务单三文件 + spec）

| 文件                                             | 改动内容                                                                                                                                                                                                                                                                                                                                                                                                                              | 依据                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/engine-core/cognition/alliance-config.ts`   | ① `AllianceThresholds`（:59）加 `readonly openDepth?: number`；② 种子 `DEFAULT_ALLIANCE_CONFIG.thresholds`（:91-97）加 `openDepth = 0.35`（S1/S2 放法）；③ `resolveAllianceThresholds`（:116）**两条路径都补** `openDepth`（`:119` 的 `!provided` 早退分支 + 正常分支），复用 `sanitizeThreshold`（:108）回落；④ `resolveSessionAllianceConfig` 的 `merged`（:158-162）加 `openDepth: override.openDepth ?? baseThresholds.openDepth` | R1 / R2 / R5        |
| `src/engine-core/cognition/intention-planner.ts` | ① 删除 `LOW_DEPTH`（:40）；② 探索分支（:66）改 `depth < thresholds.openDepth`；③ `HIGH_RESISTANCE_AGG`（:36）/ `HIGH_VERBAL`（:38）**不动**                                                                                                                                                                                                                                                                                           | R1 / R6 / R8 风险 C |
| `src/engine-core/domain/engine-session.types.ts` | 镜像字段 `allianceThresholds`（:90-94）加 `readonly openDepth?: number`；更新 :76 起「三字段严格 1:1」的注释为四字段                                                                                                                                                                                                                                                                                                                  | R3                  |
| `test/engine-core/` 新增或扩展 spec              | 四类用例：缺省回落 / 非法值回落 / 会话级覆盖透传 / planner 边界两侧策略选择（详见 §5）                                                                                                                                                                                                                                                                                                                                                | R7                  |

### 2.2 条件必改（取决于种子放法，见 §1）

| 文件                                                            | 改动内容                                                                                                                             | 依据      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `src/engine-adapters/wiring/alliance-config.ts`（S1）           | 门槛组装（:153-161）加一行 `openDepth: seed.openDepth`（**不接 env**，只是把种子透传出来，让适配层产出的端口对象形状与内核种子一致） | R2 风险 A |
| `test/engine-adapters/wp42-alliance-config.spec.ts`（S1 或 S2） | S1：:75-79 的三键 `toEqual` 补 `openDepth: 0.35`；S2：:37 / :95 / :107 三条全形状 `toEqual` 需改写                                   | R2 风险 A |

### 2.3 明确不需要改（已核实）

- `src/engine-core/index.ts`（:211 `export type { ... AllianceThresholds }`）—— 导出**名字**不变，断言⑥ 只比名字。
- `src/engine-core/cognition/session-decay.ts` —— `resolveThresholdSubset`（:174-177）经 `resolveAllianceThresholds` 自动补全；`isRupturedState`（:186-189）只读 `resistanceTrust` / `resistanceSafety`，**新字段不进破裂判定**。
- `src/engine-core/in-memory/in-memory-engine-session.ts`（:361 / :427）—— 纯透传，类型跟随。
- `src/engine-adapters/wiring/alliance-threshold-resolver.ts`（:60 / :76）与 `engine-turn.service.ts`（:231 / :250 / :362-363）—— 签名是 `Partial<AllianceThresholds>`，对新增可选字段**天然兼容**。
- `test/engine-core/boundary.spec.ts` —— 不新增导出名、不新增 core `.ts` 文件 → 断言⑥ / ⑦ 均不变红。
- `src/engine-core/cognition/alliance-config.ts` 里的 `sanitizeThreshold`（:108）—— 直接复用，不写第二套校验（反双胞胎）。

### 2.4 任务单三文件是否完整

**不完整**（三文件是下限）。缺口在**适配层镜像**：适配层是「env → AllianceConfig 端口」的唯一装配点（`engine-adapters/wiring/alliance-config.ts:153-161`），内核种子多一个键而适配层不镜像，两侧端口对象形状就会分叉 —— 这正是 S2 让三条既有断言变红的根因，也是 S1 要补那一行的理由。

## 3. R1–R8 逐项答复

### R1 · 全仓消费点穷举

**结论**：消费点共 4 类（类型定义 / 对象字面量构造 / 字段读取 / spec 断言），**必改 3 处 core + 1 处镜像 + 1 处适配层装配（条件）**，其余全部无需改。

**`src/` 侧**：

| 文件 : 行号                                                             | 消费方式                                                                      | 受新字段影响                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- |
| `src/engine-core/index.ts:211`                                          | barrel 具名类型导出（`AllianceThresholds`）                                   | 否 —— 导出**名**不变             |
| `src/engine-core/index.ts:212`                                          | `export { DEFAULT_ALLIANCE_CONFIG }`                                          | 是（种子对象形状变，见 R2）      |
| `src/engine-core/cognition/alliance-config.ts:59`                       | 类型定义                                                                      | **是 · 改动点 1**                |
| `src/engine-core/cognition/alliance-config.ts:82`                       | `AllianceConfig.thresholds: AllianceThresholds`                               | 否（跟随类型）                   |
| `src/engine-core/cognition/alliance-config.ts:91-97`                    | 内核种子对象字面量                                                            | **是 · 改动点 1（风险 A 源头）** |
| `src/engine-core/cognition/alliance-config.ts:108`                      | `sanitizeThreshold` 校验唯一口                                                | 否（复用）                       |
| `src/engine-core/cognition/alliance-config.ts:116-125`                  | `resolveAllianceThresholds`                                                   | **是 · 改动点 1**                |
| `src/engine-core/cognition/alliance-config.ts:151-168`                  | `resolveSessionAllianceConfig`（merged）                                      | **是 · 改动点 1**                |
| `src/engine-core/cognition/intention-planner.ts:40`                     | 局部常量 `LOW_DEPTH = 0.35`                                                   | **是 · 改动点 2（必删）**        |
| `src/engine-core/cognition/intention-planner.ts:51`                     | `resolveAllianceThresholds(alliance)` 取门槛                                  | 否（跟随）                       |
| `src/engine-core/cognition/intention-planner.ts:66`                     | `depth < LOW_DEPTH` 探索分支                                                  | **是 · 改动点 2**                |
| `src/engine-core/cognition/session-decay.ts:75`                         | `import type { AllianceThresholds }`                                          | 否                               |
| `src/engine-core/cognition/session-decay.ts:174-177`                    | `resolveThresholdSubset` → 走解析口                                           | 否（自动补全）                   |
| `src/engine-core/cognition/session-decay.ts:186-189`                    | `isRupturedState` 字段读取                                                    | 否（只读两个 resistance 门槛）   |
| `src/engine-core/cognition/session-decay.ts:241`                        | 形参 `allianceThresholds?: AllianceThresholds`                                | 否（类型跟随）                   |
| `src/engine-core/domain/engine-session.types.ts:76-94`                  | 镜像类型                                                                      | **是 · 改动点 3**                |
| `src/engine-core/in-memory/in-memory-engine-session.ts:361`             | `resolveSessionAllianceConfig(this.allianceConfig, input.allianceThresholds)` | 否（透传）                       |
| `src/engine-core/in-memory/in-memory-engine-session.ts:427`             | `planIntention(provisional, profile, runtime.allianceConfig)`                 | 否                               |
| `src/engine-adapters/wiring/alliance-config.ts:153-161`                 | 适配层门槛组装（三字段 + 三 env 键）                                          | **条件 · 见 R2 风险 A**          |
| `src/engine-adapters/wiring/alliance-threshold-resolver.ts:60, :76`     | `Partial<AllianceThresholds>`                                                 | 否（Partial 天然兼容）           |
| `src/engine-adapters/wiring/engine-turn.service.ts:231, :250, :362-363` | `Partial<AllianceThresholds>` 透传                                            | 否                               |
| `src/auto-practice/config-fingerprint.ts:52`                            | 指纹段 `alliance` → `alliance-config.ts` 文件哈希                             | 间接（见 R8 风险 E）             |

**`test/` 侧**：

| 文件 : 行号                                                                          | 消费方式                                                                                    | 受新字段影响           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------- |
| `test/engine-core/boundary.spec.ts:425`                                              | 断言⑥ 白名单里的导出名 `AllianceThresholds`                                                 | 否（名字不变）         |
| `test/engine-core/boundary.spec.ts:458, :480, :483`                                  | 断言⑦ 文件清单（三个目标文件**已在清单内**）                                                | 否（不新增文件）       |
| `test/engine-core/wp42-alliance-three-dimensions.spec.ts:94, :190, :199, :208, :299` | thresholds 字面量 / 种子引用                                                                | 否（可选字段类型兼容） |
| `test/engine-core/i12-session-alliance-config.spec.ts:32, :69, :117, :132`           | 同上                                                                                        | 否                     |
| `test/engine-core/wp36-session-decay.spec.ts:262`                                    | `const THRESHOLDS: AllianceThresholds = DEFAULT_ALLIANCE_CONFIG.thresholds`                 | 否（类型兼容）         |
| `test/engine-adapters/wp42-alliance-config.spec.ts:37, :75-79, :95, :107`            | **全形状 `toEqual`**                                                                        | **是 · 风险 A**        |
| `test/engine-adapters/i12-session-threshold-plumbing.spec.ts:60, :68-69`             | `toEqual({ open: 0.85 })` —— 断的是**会话入参镜像对象**（adapter 透传值），不是内核解析结果 | 否                     |

**同名不同物的干扰项（已逐个排除，不受影响）**：`src/engine-adapters/eval/eval.service.ts:248-250`、`src/engine-adapters/deliberation-gate/deliberation-gate.{service,evaluator,types}.ts`、`src/engine-adapters/deliberation-gate/deliberation-gate.config.ts:128/:145`、`src/counselor/domain/session-view/session-view.types.ts:145/:167`、`src/counselor/domain/session-core/session-core.types.ts:595/:852/:868` 里的 `thresholds` 分属 `EvalCleaningThresholds` / `GateThresholds` / `EffectiveMaterialThresholds`，与同盟门槛**无任何关系**。

### R2 · 既有对象字面量的类型兼容性

**结论**：**类型层面全部合法**（可选字段缺省合法）；但**断言层面有 3 处全形状 `toEqual` 会因种子形状变化而变红**，必须逐处处理。

**(1) 类型兼容性**：`openDepth?: number` 是可选字段，既有三字段字面量在 TypeScript 下**仍然合法**（可选属性缺省合法）。仓库 `tsconfig.json` **未开启** `exactOptionalPropertyTypes` → 允许把 `undefined` 显式写进可选属性。

字面量清单（全部无需改代码）：

- `test/engine-core/wp42-alliance-three-dimensions.spec.ts:190`（`{ open: 0.2, resistanceTrust: 0.4, resistanceSafety: 0.3 }`）、`:199`、`:208`（含 `Number.NaN` / `5` / `-1`）
- `test/engine-core/i12-session-alliance-config.spec.ts:32`、`:132`
- `src/engine-adapters/wiring/alliance-config.ts:156-160`

**(2) 全形状 `toEqual` 断言 —— 唯一的三处，全在适配层 spec**：

| 断言                                                                                                                                                        | 断的是什么                               | 种子加 `openDepth` 后              | 适配层同步补字段后            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------- | ----------------------------- |
| `test/engine-adapters/wp42-alliance-config.spec.ts:37` `expect(config).toEqual(DEFAULT_ALLIANCE_CONFIG)`                                                    | 适配层组装结果 vs 内核种子（**全对象**） | **红** —— 适配层 3 键 vs 种子 4 键 | 绿（两侧都 4 键）             |
| `test/engine-adapters/wp42-alliance-config.spec.ts:75-79` `expect(config.thresholds).toEqual({ open: 0.5, resistanceTrust: 0.35, resistanceSafety: 0.25 })` | 适配层阈值对象（**精确三键**）           | 绿（适配层仍 3 键）                | **红** —— 多了 `openDepth` 键 |
| `test/engine-adapters/wp42-alliance-config.spec.ts:95` 与 `:107` `expect(config.thresholds).toEqual(DEFAULT_ALLIANCE_CONFIG.thresholds)`                    | 适配层阈值 vs 内核种子阈值               | **红**                             | 绿                            |

Vitest 的 `toEqual` 会忽略**值为 `undefined`** 的属性，但**不会忽略已定义值的缺键 / 多键** → `openDepth: 0.35` 是已定义值，上述判定成立。

**(3) 内核 spec 侧 —— 全部安全**。`resolveAllianceThresholds` / `resolveSessionAllianceConfig` 的既有断言**没有一条**是对解析结果的全形状 `toEqual`：

- 字段级：`i12-session-alliance-config.spec.ts:47`（`thresholds.open`）、`:52`、`:53`、`:58`、`:59`、`:60`、`:65`、`:77`、`:78`
- 引用同一性：`:38` `expect(resolved).toBe(BASE_CONFIG)`、`:71` `expect(resolved?.deltas).toBe(base.deltas)`
- 策略级：`i12:135` / `:138`、`wp42:148-221` 全部断 `intention.strategy` / `intention.rationale`

→ **解析结果对象多一个 `openDepth` 键，不会让任何内核用例变红。**

**(4) 特别注意 `:38` 的同一性断言**：它依赖 `resolveSessionAllianceConfig` 在**无覆盖时原样返回 base 同一引用**（`alliance-config.ts:153` 的 `if (!override) return base;`）。开工时**不得**把这条改成「总是重建对象」，否则该断言与零回归性质一起破。

### R3 · 镜像类型同步必要性

**结论**：**必须同步**。不同步时 TypeScript **不报错**（镜像是独立结构字面量类型、且刻意不 import cognition 类型），但会同时造成两个实质问题。

- **镜像位置**：`src/engine-core/domain/engine-session.types.ts:90-94`，注释（:76 起）明写「形状镜像 `cognition/alliance-config.ts` 的 `AllianceThresholds`（三字段严格 1:1）」。
- **为什么 TS 不报错**：镜像不是 `AllianceThresholds` 的别名，而是手写的结构字面量；注释（:77-81）说明这是刻意为之 —— `domain/` → `cognition/` 的依赖方向至今不存在（既有反向依赖是 `cognition/` → `domain/`），加 import 会破坏依赖方向纪律。
- **不同步的两个实质问题**：
  1. **注释承诺失真**：1:1 变成 3:4，镜像注释变成不实描述。
  2. **会话级覆盖通道只通一半**：会话级覆盖入口是 `engine-session.types.ts:90` 的镜像字段 → `in-memory-engine-session.ts:361` 把它交给 `resolveSessionAllianceConfig(base, override?: Partial<AllianceThresholds>)`。镜像里没有 `openDepth`，adapter 就**传不进**会话级 depth 覆盖 → 端口「通了但只通一半」，`resolveSessionAllianceConfig` 的 `override.openDepth` 分支永远是死代码。
- **同步后依赖方向纪律保持**：`domain/` 仍不 import `cognition/`，只是在自己内部多一个同级可选键；boundary 断言③（零逃出 engine-core 的相对 import）扫的是 import，不受影响。

### R4 · 边界断言真实判定（读源码，不靠推论）

**结论**：任务单 §2.1 口径**正确**，无出入。扩已导出类型的可选字段、**不新增导出名、不新增 `.ts` 文件 → 断言⑥ 与 ⑦ 都不变红**。以下为源码事实。

**断言⑥（`boundary.spec.ts:220` 起，标题：index.ts 只导出公开端口与模型, 内存实现不外露）**：

- 源码用 TypeScript AST 遍历 `src/engine-core/index.ts`，抽出两个数组：`exportedNames`（具名导出的**名字**，来自 `ExportDeclaration` 的 `NamedExports` 元素 `element.name.text`）与 `exportedSpecifiers`（导出语句的模块说明符）。
- 判定：内存实现不得出现在公开出口（`exportedNames` 里含 `InMemory` 的必须为空、`exportedSpecifiers` 里含 `in-memory` 的必须为空）；再与 `expectedPublic`（:249 起）**双向**比对。
- **比对的是导出名，不是类型字段**。`AllianceThresholds` 已在 `expectedPublic` 名单内（:425）→ 扩一个可选字段，导出名集合**完全不变** → **不变红**。

**断言⑦（`boundary.spec.ts:454` 起，标题：目录结构与任务单 §3.1 一致）**：

- `expected` 清单（:455 起）含 `domain/engine-session.types.ts`（:458）、`cognition/alliance-config.ts`（:480）、`cognition/intention-planner.ts`（:483）→ **本单三个目标文件本就在清单内**。
- 判定分两半：`missing` = 清单里的文件必须都存在；`extra`（:518）= 内核树里出现的每个 `.ts` 都必须在清单里登记过，`expect(extra).toEqual([])`。
- 本单**不新增 core `.ts` 文件** → `actual` 集合不变 → `extra` 仍为空 → **不变红**；`missing` 也不变（不删文件）。

**其余断言**：①–⑤ / ⑩ 扫全部内核文件（纯度：零 nestjs import / 零 typeorm / 零逃逸 import / 零外部依赖 / 零装饰器 / 零 env 与全局对象访问）—— 本单改动不新增任何 import、不加装饰器、不碰 `process.env` → 不受影响。⑪ 管 adapter 是否深路径 import engine-core 内部模块 —— 本单 adapter 不新增 import（只加一个字段透传）→ 不受影响。

**口径精确化（供交付记录引用）**：断言⑥ 比「barrel 导出**名**」，断言⑦ 比「core 树**文件路径**」，**两者都与类型字段无关**。

### R5 · 解析口闭环核对

**结论**：三条路径都需要改到位的只有**一个**函数，但**漏改会造成静默行为变化**（见下）。没有绕过解析口直读原始注入对象的路径。

**三条路径**：

1. `resolveAllianceThresholds(config)`（`alliance-config.ts:116`）—— ⚠️ **关键点**：现状 `:119` 是 `if (!provided) return seed;`（**直接返回种子对象引用**）。若种子对象没有 `openDepth`，planner 拿到的 `thresholds.openDepth` 就是 `undefined`，`depth < undefined` 恒 `false` → **探索分支永不触发 = 静默行为变化**（不是编译错、也不一定被现有断言抓到）。必须保证两条路径（早退分支 + 正常分支）都产出**含完整 `openDepth` 数字**的对象。
2. `resolveSessionAllianceConfig(base, override)`（`alliance-config.ts:151`）—— `merged`（:158-162）必须加 `openDepth: override.openDepth ?? baseThresholds.openDepth`；非法值交给 `resolveAllianceThresholds` 里的 `sanitizeThreshold` 回落种子（不写第二套校验）。
3. `cognition/session-decay.ts` 的 `resolveThresholdSubset`（:174-177）—— 经 `resolveAllianceThresholds` → **自动补全**，无需改。`isRupturedState`（:186-189）**只读 `resistanceTrust` / `resistanceSafety`** → **新字段不进入破裂判定** ✔（与任务单口径一致）。

**自愈链验证**（三种 base 形态都落到 0.35）：

- base = 适配层组装对象（S1 下含 `openDepth: 0.35`）→ `baseThresholds.openDepth = 0.35` → merged 0.35 ✔
- base = 内核种子对象（含 0.35）→ merged 0.35 ✔
- base = 手写三键对象（如 `i12-session-alliance-config.spec.ts:32` 的 `BASE_CONFIG`）→ `baseThresholds.openDepth = undefined` → merged `undefined` → `sanitizeThreshold(undefined, 0.35)` → **0.35** ✔

**没有绕过解析口的直读路径** —— 全仓 `thresholds.open` / `thresholds.resistanceTrust` / `thresholds.resistanceSafety` 的**字段读取点只有 3 处**，全部经过解析口：

- `src/engine-core/cognition/session-decay.ts:188`（经 `resolveThresholdSubset` → `resolveAllianceThresholds`）
- `src/engine-core/cognition/intention-planner.ts:55`（经 `resolveAllianceThresholds`）
- `src/engine-core/cognition/intention-planner.ts:66`（经 `resolveAllianceThresholds`）

`src/engine-adapters/wiring/alliance-config.ts:153` 只读**内核种子**（`DEFAULT_ALLIANCE_CONFIG.thresholds`）做 env 兜底，不读注入对象。

**保留项**：`resolveSessionAllianceConfig` 无覆盖时返回 base **同一引用**（:153）—— 这是零回归性质，有既有断言依赖（`i12:38`），不得改成「总是重建对象」。

### R6 · 命名冲突检查

**结论**：**无同名符号，无拼写近似撞车**；但存在一处**语义邻近**，建议注释里点明。

- 全仓 grep `openDepth` / `open_depth` / `depthThreshold` / `maxDepth` / `depthOpen` / `depthLimit` → **0 命中**（`src/` 与 `test/` 全量）。
- `depth` 在 `domain/` 只出现在**阻抗三维**语义：`domain/bdi-snapshot.ts:47` `readonly depth: number`（内容深度阻抗）、`domain/bootstrap.ts:49` `DEFAULT_RESISTANCE.depth`、`domain/bootstrap.ts:64` 的 clamp；`domain/trajectory/script.ts:78/:80` 是**阻抗均值**的上下界字段（不是 depth 字段）。
- `CharacterProfile` 与 `TrajectoryScript` 内**没有**任何 `depth*` 命名字段 → 无近似撞车。
- **语义邻近提示**：`openDepth` 与 `BdiResistance.depth` 处在不同层（一个是门槛端口字段，一个是状态维度），但**比较的是同一个物理量纲**（阻抗维的 depth）。建议在字段注释里写明「本字段比较的是 `BdiResistance.depth`（阻抗维）」，避免后来者把它误解成别的 depth。

### R7 · 零回归基线建议

**结论**：**不需要跑批次**。既有 core spec 已经把「缺省路径逐字不变」和「探索分支确实被走到」两件事都钉住了，开工时只需跑定向测试即可证明零回归。

**已覆盖缺省路径的既有 spec（开工时不用重跑批次，只需全绿）**：

| 文件 : 用例                                                                                                             | 覆盖什么                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-core/wp42-alliance-three-dimensions.spec.ts:215` 「缺省端口 = 内核种子门槛 (逐字不变)」                    | 比较「带 `DEFAULT_ALLIANCE_CONFIG`」与「不带端口」两次 `planIntention` 的 `strategy` **与** `rationale` 逐字相等 → **本单零回归的直接护栏** |
| `wp42:148` / `:156` / `:162` / `:180` 及 `:188` / `:197` / `:206`                                                       | 探索 / 抗拒 / 门槛覆写 / 非法值各分支的策略选择                                                                                             |
| `wp42:44` `OPEN_READY_RESISTANCE = { verbal: 0.1, depth: 0.2, style: 0.2 }`                                             | **depth = 0.2 < 0.35 → 探索分支确实被走到**（不是走过场）；改阈值会立刻变红 → 这是最有价值的回归护栏                                        |
| `test/engine-core/i12-session-alliance-config.spec.ts:36-43` / `:45-78` / `:130-139`                                    | 无覆盖同一引用 / 三条回落规则 / 覆盖真的改变策略                                                                                            |
| `test/engine-core/wp5-rendering.spec.ts:315`、`wp4-safety.spec.ts:334`、`wp3-trajectory.spec.ts:572`                    | 真实管线输出与 `planIntention(expectedSnapshot)` **逐字对比** → 任何 strategy 漂移都会红                                                    |
| `test/engine-core/wp36-session-decay.spec.ts`（:262 取种子门槛做断言）+ `wp51-character-seed-alliance-baseline.spec.ts` | 同盟 / 基线侧护栏                                                                                                                           |
| `test/engine-adapters/wp42-alliance-config.spec.ts`                                                                     | 装配链护栏（风险 A 的落点）                                                                                                                 |

**开工时的基线做法（建议顺序）**：

1. **改前**跑一次 `pnpm exec vitest run test/engine-core test/engine-adapters`，记录**用例数 / 耗时 / failed 数**作为开工前基线。
2. 改后跑同一命令 → **用例数不减、failed = 0**；再逐条对比 `wp42` 与 `i12` 的用例名清单，确认没有用例被跳过或改写。
3. 若主控要更硬的**逐字**证据：用一个**一次性脚本**（不入库，或产物入 `data/quality/` 由主控定夺）以固定事件序列驱动 `planIntention`，把 `strategy` + `rationale` + 快照序列 `JSON.stringify` 后存基线，改后逐字 diff。**本单不触碰**事件聚合 / delta / cap / 信念演化 / decay 数值路径（decay 只读两个 resistance 门槛），故批次轨迹在缺省路径下**逐字不变**，无需批次复算。
4. 指纹侧提示：`src/auto-practice/config-fingerprint.ts:52` 的 `alliance` 段挂 `alliance-config.ts` 文件哈希 → 本单改动会**改变该段哈希**（任何 core 改动的固有后果）。做批次对比时需知悉旧快照与新快照的 `alliance` 段指纹不可直接相等。

### R8 · 风险与替代方案

**风险表**：

| 编号  | 风险                                                                                                                                       | 影响                                                                                           | 缓解 / 备注                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **A** | 适配层 spec 的三条全形状 `toEqual`（`test/engine-adapters/wp42-alliance-config.spec.ts:37` / `:95` / `:107`，S1 下再加 `:75-79`）          | 种子形状与适配层形状分叉 → 既有用例变红                                                        | 三选一：S1（适配层补 1 行 + spec 补 1 键）/ S2（改 3 条断言）/ S3（种子拆两处）。**推荐 S1**，见下 |
| **B** | `resolveAllianceThresholds` 的 `!provided` 早退分支（`:119`）漏改                                                                          | `depth < undefined` 恒 false → **探索分支永不触发**；编译不报错，可能不被既有断言抓到          | 开工第一步就改；补断言 `resolveAllianceThresholds(undefined).openDepth === 0.35`                   |
| **C** | `LOW_DEPTH` 未删（`intention-planner.ts:40`）                                                                                              | `tsconfig.json` 的 `noUnusedLocals: true` → **编译报错**（良性，会被立刻抓到）                 | 删常量                                                                                             |
| **D** | 适配层不镜像新字段                                                                                                                         | 会话级覆盖通道只通一半（`override.openDepth` 成死代码），端口形同虚设                          | S1 / S2 / S3 任一都要让两侧形状一致                                                                |
| **E** | 配置指纹段 `alliance` 哈希变化（`config-fingerprint.ts:52`）                                                                               | 旧批次快照与新批次指纹不可直接相等                                                             | 固有后果；批次重跑时自动更新；旧快照不删不改                                                       |
| **F** | 临床语义：「低 depth 是探索前提」这条假设本身存疑（I-11 的数学不可达）                                                                     | 端口化**不解决**不可达问题                                                                     | 已拍板另案（任务单 §5.4）；建议交付记录复述该边界，避免被误读为「门槛已修好」                      |
| **G** | 门禁盲区：`pnpm typecheck` = `tsc -b tsconfig.check.json` → extends `tsconfig.build.json` → `exclude` 排除了 `test/**/*` 与 `**/*.spec.ts` | **新增/修改的 spec 文件类型错误不会被 `pnpm typecheck` 抓到**（vitest 只转译、不做类型检查）   | 闸门必须补 `pnpm exec tsc -p tsconfig.json --noEmit`（根 tsconfig 的 `include` 含 `test/**/*`）    |
| **H** | `exactOptionalPropertyTypes` 未开启                                                                                                        | `merged.openDepth = undefined` 合法（不报错），merged 会带一个 `openDepth: undefined` 自有属性 | 无需处理：最终解析对象是完整数字，`undefined` 不外泄                                               |
| **I** | 语义邻近：`openDepth` 与 `BdiResistance.depth` 同量纲                                                                                      | 后来者可能误解字段含义                                                                         | 字段注释点明「比较的是阻抗维 depth」（见 R6）                                                      |

**替代方案取舍（三个维度）**：

1. **可选 vs 必填** → **维持可选**。理由：适配层 `Partial<AllianceThresholds>`、镜像类型、全部既有三字段字面量零改动兼容；必填会让 adapter / 镜像 / 所有字面量一起报错，改动面从 2 个 core 文件涨到 6+ 个文件，与「端口先通」的最小切口相悖。
2. **字段归 `AllianceThresholds` vs 独立端口对象** → **维持并入 `AllianceThresholds`**。理由：`openDepth` 与 `open` 同属「探索门槛」，语义成对；独立对象会造出第二套门槛容器，违反反双胞胎，且校验要复制一份 `sanitizeThreshold`。
3. **解析口是否新增** → **不新增**。复用既有 `sanitizeThreshold` + `resolveAllianceThresholds`，保证「门槛校验唯一真相源」不变（`session-decay.ts:168-172` 的注释已明确这条纪律）。

**关键取舍 —— 种子 0.35 的放法（唯一需要主控拍板的技术点）**：

| 方案           | 做法                                                                                                                                                                           | 适配层 spec 后果                       | 额外改动                              | 评价                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1（推荐）** | `openDepth` 进 `DEFAULT_ALLIANCE_CONFIG.thresholds`；适配层 `alliance-config.ts` 补一行 `openDepth: seed.openDepth`（**不接 env**）；适配层 spec `:75-79` 补 `openDepth: 0.35` | :37/:95/:107 自动绿；:75-79 需补一键   | 适配层 wiring 1 行 + 适配层 spec 1 处 | 种子对象保持「全部门槛一处可见」，与另外三个门槛同构；适配层仍是「env → 端口」的唯一装配点；多出的两处改动都是**加法**，不放宽任何既有断言。**代价：需主控批准突破任务单 §3.2「不改 adapter」边界**                                                                   |
| S2             | `openDepth` 进种子对象，适配层不动                                                                                                                                             | :37/:95/:107 **三条变红** → 需改写断言 | 适配层 spec 3 处                      | 「适配层产出的端口对象 ≠ 内核种子对象」长期反直觉；且改的是**别的 WP 的既有断言**，回归护栏被削弱                                                                                                                                                                     |
| S3             | `openDepth` 不进种子对象，另立模块常量 `DEFAULT_OPEN_DEPTH = 0.35`；适配层不动                                                                                                 | **四条全绿、零改动**                   | 无                                    | 零改动，但种子与解析结果**形状不对称**（seed 3 键 / resolved 4 键），且 `resolveAllianceThresholds` 必须**总是新建对象**（`:119` 早退分支也要带 openDepth）→ 与「同一份种子」的直觉相悖；env 扩列时还得回头做 S1 的结构。**只在主控坚持「绝不碰 adapter」时作为退路** |

**预研建议：S1**。若主控明确拒绝一切 adapter 改动，则退 S3（零改动、零测试影响），并接受「种子拆两处」这一取舍写进交付记录。

## 4. 风险表（汇总索引）

见 R8 的风险表（A–I）。其中 **A / B / G** 是必须在开工单里写死的三条：**A** 决定改动面（需主控拍板种子放法），**B** 是静默行为变化的唯一来源，**G** 是门禁盲区（会让人误以为类型闸门覆盖了新增 spec）。

## 5. 建议开工步骤

0. **先拍板种子放法**（S1 / S2 / S3）—— 唯一需要主控点头的技术决策（见 R8）。
1. **固化开工前基线**：`pnpm exec vitest run test/engine-core test/engine-adapters`，记录用例数 / 耗时 / failed 数；把 `wp42` 与 `i12` 的用例名清单存档（用于开工后逐条比对）。
2. **改 `src/engine-core/cognition/alliance-config.ts`**：类型加可选字段 → 种子加 0.35 → `resolveAllianceThresholds` 两条路径都补 `openDepth`（含 `:119` 早退分支）→ `merged` 加 `override.openDepth ?? baseThresholds.openDepth`。
3. **改 `src/engine-core/cognition/intention-planner.ts`**：删 `LOW_DEPTH`（:40）→ `:66` 改 `depth < thresholds.openDepth`。
4. **改 `src/engine-core/domain/engine-session.types.ts`**：镜像加 `openDepth?: number` + 更新 1:1 注释。
5. **（S1）改适配层**：`src/engine-adapters/wiring/alliance-config.ts` 加 `openDepth: seed.openDepth`；`test/engine-adapters/wp42-alliance-config.spec.ts:75-79` 补 `openDepth: 0.35`。
6. **补 core spec**（建议新建 `test/engine-core/s1-open-depth-threshold.spec.ts`，与既有 spec 解耦；**新建 test 文件不受 boundary 断言⑦ 约束** —— 断言⑦ 只管 `src/engine-core` 树）：
   - 用例 1 · 缺省回落：`resolveAllianceThresholds(undefined).openDepth === 0.35`；`resolveAllianceThresholds({ deltas: {}, thresholds: { open: 0.6, resistanceTrust: 0.4, resistanceSafety: 0.3 } }).openDepth === 0.35`（**直接钉死风险 B**）。
   - 用例 2 · 非法值回落：`openDepth` 给 `NaN` / `Infinity` / `-0.1` / `1.5` → 一律回落 0.35。
   - 用例 3 · 会话级覆盖：`resolveSessionAllianceConfig(base, { openDepth: 0.2 })` → 覆盖生效；缺项回落单例；非法回落种子；**且 `resolveSessionAllianceConfig(base)` 仍返回 base 同一引用**（保护零回归性质）。
   - 用例 4 · planner 边界两侧：`depth` 恰在 `openDepth` 上下两侧（如 0.34 / 0.35 / 0.36 对 0.35）→ 策略选择符合预期；并验证「同盟门槛与深度门槛的 AND 关系」不被破坏（同盟不过 → 无论 depth 多低都不进探索）。
   - 用例 5 · 镜像 1:1：`engine-session.types.ts` 的 `allianceThresholds` 与 `AllianceThresholds` 字段集合一致（新字段在镜像侧为可选）。
7. **跑闸门**（见 §6）。
8. **写交付记录**（路径按任务单 §7.1）+ 按 §7.2 回写任务单状态行 / 台账 I-11 / 草案 / wp-list / README。

## 6. 闸门建议

沿用仓库 pnpm 规范，**禁裸 npx**；跑 vitest 前 PATH 补 `D:\Apps\Git\cmd`（避免 vitest 内部调 git ENOENT 假失败）。

| 闸门                | 命令                                                         | 判据                                                                                                                                                     | 备注                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型（src）         | `pnpm exec tsc -p tsconfig.build.json --noEmit`              | 0 error                                                                                                                                                  | 等价 `pnpm typecheck:full`                                                                                                                                       |
| **类型（含 spec）** | `pnpm exec tsc -p tsconfig.json --noEmit`                    | 0 error                                                                                                                                                  | **必须加这条**：`pnpm typecheck` / `typecheck:full` 都继承 `tsconfig.build.json` 的 `exclude`（排 `test/**/*` 与 `**/*.spec.ts`），**不覆盖新增 spec**（风险 G） |
| Lint                | `pnpm lint`                                                  | 0 error，记 warning 数                                                                                                                                   |                                                                                                                                                                  |
| 定向测试            | `pnpm exec vitest run test/engine-core test/engine-adapters` | 全绿，用例数 **≥ 开工前基线**                                                                                                                            | 与 §5 步骤 1 的基线对比                                                                                                                                          |
| 边界护栏            | `pnpm exec vitest run test/engine-core/boundary.spec.ts`     | 全绿                                                                                                                                                     | **不改该文件**；本单不改断言⑥ / ⑦ 也不变红（R4）                                                                                                                 |
| 全量                | `pnpm test`                                                  | 全绿，记用例总数 / skipped / failed / **墙钟 + 机器状态**                                                                                                | 机器状态要写清有无 `nest start --watch` / `vite dev` 常驻进程与盘读延迟（`pnpm doctor:fs`）                                                                      |
| core 变更面         | `git diff --stat HEAD -- src/engine-core`                    | **本单属大炮明确批准的例外范围**，须限定为 `cognition/alliance-config.ts` + `cognition/intention-planner.ts` + `domain/engine-session.types.ts` 三个文件 | AGENTS.md 红线：engine-core 零改动是默认态，**开工前须拿到大炮在任务单里的明确例外批准**                                                                         |
| 适配层变更面（S1）  | `git diff --stat HEAD -- src/engine-adapters`                | 限定 `wiring/alliance-config.ts` 一个文件                                                                                                                | 需主控在开工单里显式授权                                                                                                                                         |
| 零回归              | 固定事件序列 → `strategy` / `rationale` / 快照序列逐字 diff  | 逐字一致                                                                                                                                                 | 见 R7；**不跑批次**                                                                                                                                              |

---

_本次预研零代码改动：未改 `src/**`、未改 `test/**`、未改 `boundary.spec.ts`、未接 env、未跑批次、未 commit / push。全部结论附文件 :行号证据，核对时以代码当时状态为准。_
