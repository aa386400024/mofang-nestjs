# cap 配置统一 · 审议侧与规则算子同口径

> 状态: ✅ 已交付（2026-11-07）
> 交付记录: [`engine-deliberation-cap-config-unification-implementation-2026-11-07.md`](engine-deliberation-cap-config-unification-implementation-2026-11-07.md)
> 先读 `docs/worklog/README.md` 和 `docs/README.md` 确认后端当前阶段与模块边界。

## 一、为什么做这个（问题与目标）

### 背景

约束校验层（审议输出逐维 delta cap）已经交付，但有一个已知的口径分歧：

- **规则算子**的 capConfig 是从 env 读的（`ENGINE_CAP_*` 键），通过 `resolveDeltaCapConfig(config)` 组装后注入内核
- **审议侧**的 capConfig 硬编码用 `DEFAULT_DELTA_CAP_CONFIG`（内核种子值），不读 env

**后果**：生产若调了 `ENGINE_CAP_*`，规则侧的 cap 边界变了，审议侧还是种子值——两边不一致。

**影子期无害**（只观测，砍幅不影响任何状态），但**切灰度前必须统一**——否则切灰度后审议结果和规则结果用不同的 cap 标准，deltaDiff 的口径就歪了。

### 目标

审议侧改用与规则算子同一份 config（`resolveDeltaCapConfig(config)` 的结果），两边逐字同口径。

---

## 二、开工前核实清单（6 条，开工前逐条自己 grep 确认）

> ⚠️ 这 6 条是大炮扫完代码后整理的，后端开工前必须自己再 grep 一遍核实，不能只凭这份清单。

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | `DeltaCapConfig` 在 engine-core barrel 导出了 | ✅ 已确认（`engine-core/index.ts:160`） |
| 2 | `applyDeliberationDeltaCap` 只有一个调用点 | ✅ 已确认（`llm-deliberation.service.ts:1246`） |
| 3 | 审议 Service 已经注入了 `ConfigService` | ✅ 已确认（constructor 第 2 个参数） |
| 4 | `resolveDeltaCapConfig` 在 `wiring/delta-cap.config.ts` | ✅ 已确认（纯函数，输入 ConfigService，输出 DeltaCapConfig） |
| 5 | 审议层与 wiring 同属 `engine-adapters/`，import 没问题 | ✅ 已确认 |
| 6 | `capEntryDelta` 现在硬编码用 `DEFAULT_DELTA_CAP_CONFIG` | ✅ 已确认（`llm-deliberation.service.ts:907`） |

---

## 三、技术方案

### 核心思路

不用加新依赖——审议 Service 已经注入了 `ConfigService`，直接在 constructor 里调 `resolveDeltaCapConfig(config)`，存成私有字段。

### 改动点

1. **import 加一行**：`resolveDeltaCapConfig` from `../wiring/delta-cap.config.js`
2. **constructor 加一行**：`private readonly capConfig: DeltaCapConfig = resolveDeltaCapConfig(config)`
3. **`applyDeliberationDeltaCap` 加可选参数**：`config?: DeltaCapConfig`，缺省用 `DEFAULT_DELTA_CAP_CONFIG`
4. **`capEntryDelta` 加 config 参数**：透传给 `capTurnDelta`
5. **调用点传 config**：`applyDeliberationDeltaCap(output.deltas, this.capConfig)`

### 为什么 config 参数是可选的

- 现有单测调 `applyDeliberationDeltaCap` 不传 config，缺省用种子值，行为完全不变
- 这样单测不用改，零回归

---

## 四、写入侧（详细设计）

### 4.1 改动 `applyDeliberationDeltaCap` 函数签名

**位置**：`llm-deliberation.service.ts:861`

**改动**：
```typescript
export function applyDeliberationDeltaCap(
  deltas: readonly DeliberationDeltaEntry[],
  config?: DeltaCapConfig,  // 新增，缺省用 DEFAULT_DELTA_CAP_CONFIG
): { ... }
```

**内部**：把 config 透传给 `capEntryDelta`。

### 4.2 改动 `capEntryDelta` 函数签名

**位置**：`llm-deliberation.service.ts:904`

**改动**：
```typescript
function capEntryDelta(
  dim: DeliberationDim,
  value: number,
  config?: DeltaCapConfig,  // 新增
): number {
  const probe: MutableDeltaVector = { ...ZERO_DELTA_VECTOR };
  probe[dim] = value;
  return capTurnDelta(probe, config ?? DEFAULT_DELTA_CAP_CONFIG)[dim];
}
```

### 4.3 审议 Service constructor 加 capConfig

**位置**：`LlmDeliberationService` 的 constructor

**改动**：加一行私有字段：
```typescript
constructor(
  private readonly llmJson: CounselorLlmJsonClient,
  private readonly config: ConfigService,
  private readonly redis: RedisService,
  @Inject(ENGINE_BDI_STATE_REPOSITORY) private readonly bdiStates: BdiStateRepository,
) {
  // 新增：与规则算子同一份 cap config
  this.capConfig = resolveDeltaCapConfig(config);
}

private readonly capConfig: DeltaCapConfig;
```

### 4.4 调用点传 config

**位置**：`llm-deliberation.service.ts:1246`

**改动**：
```typescript
const { cappedDeltas, capEntries } = applyDeliberationDeltaCap(output.deltas, this.capConfig);
```

---

## 五、读取侧（详细设计）

本期**不新增 admin 查询接口**——capConfig 的值在 env 里，debug 面板本来就能看 env。trace 里的 `capEntries` 已经有了，不用加新字段。

---

## 六、开关与配置

### 6.1 现有开关复用

- 不需要新增 env 键——复用现有的 `ENGINE_CAP_*` 键（与规则算子同一套）
- 不需要新增 env 开关——审议总开关关着就啥都不跑

---

## 七、隐私与安全

1. **capConfig 里只有数字**——边界值，不是心理内容
2. **日志只出定位信息**——配置是正常观测，不打对话原文

---

## 八、反双胞胎（刻意不做的事）

1. **不新增 env 键**——复用现有的 `ENGINE_CAP_*` 键
2. **不新增 provider / token**——直接在 constructor 里调 `resolveDeltaCapConfig(config)`，与规则算子用同一份函数
3. **不改内核**——直接 import 现有的 `capTurnDelta` + `DeltaCapConfig` 类型
4. **不替换现有的缺省行为**——config 参数可选，缺省用 `DEFAULT_DELTA_CAP_CONFIG`，现有单测零改动
5. **不做热更新**——运维中途改 env，规则算子的新 session 会用新配置，审议侧还是旧的。影子期无所谓，切灰度时如果需要热更新再做
6. **不改 admin 前端**——trace 里的 `capEntries` 已经有了，不用加新字段

---

## 九、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动 |
| 5 | 口径一致 | 审议侧与规则算子用同一份 `resolveDeltaCapConfig(config)` 的结果 |
| 6 | 缺省行为 | `applyDeliberationDeltaCap` 不传 config 时，行为与之前完全一致 |
| 7 | 环境变量生效 | 改 `ENGINE_CAP_POSITIVE_UP=0.1`，审议侧的移情三维 cap 跟着变 |

---

## 十、交付物清单

1. **import 加一行**：`resolveDeltaCapConfig`
2. **`applyDeliberationDeltaCap` 加可选 config 参数**
3. **`capEntryDelta` 加 config 参数**
4. **审议 Service constructor 加 `capConfig` 私有字段**
5. **调用点传 `this.capConfig`**
6. **单测**：补 2-3 例验证传 config 时的行为

### 交付后回写文档（与之前 WP 同款）

| 文件 | 改什么 |
|---|---|
| `docs/worklog/pending/deliberation-cap-config-unification-2026-11-07.md` | 状态行改 ✅ + 指向交付记录，然后移到 `completed/phase2/` |
| `docs/worklog/pending/phase2-wp-list-2026-11-03.md` | 切灰度前置剩余清单里，"cap 配置统一"那条打 ✅ |
| `docs/worklog/README.md` | Phase2 已开工列表加一条 |

---

## 十一、commit message 草稿

```
feat(deliberation): cap 配置统一 - 审议侧与规则算子同口径

审议侧改用 resolveDeltaCapConfig(config) 的结果,
与规则算子逐字同口径. config 参数可选, 缺省用种子值,
现有单测零改动. 切灰度前置.
```

---

## 十二、交付后补记（偏差表）

> 交付记录: [`engine-deliberation-cap-config-unification-implementation-2026-11-07.md`](engine-deliberation-cap-config-unification-implementation-2026-11-07.md)
> 本单**任务单 §二 的 6 条核实清单已逐条自己 grep 核实** —— **全部属实**，无一写错。

| # | 偏差 | 任务单怎么写的 | 代码实际是什么 | 怎么改的 | 为什么 |
|---|---|---|---|---|---|
| B1 | **capConfig 的赋值写法**（最重要） | §三 改动点 2：`private readonly capConfig: DeltaCapConfig = resolveDeltaCapConfig(config)`（**字段初始化器**）；但 §4.3 又写：字段只声明、`this.capConfig = resolveDeltaCapConfig(config)` 放**构造函数体内** —— **任务单两处自相矛盾** | `tsconfig` 的 `target` 是 `es2024`，`useDefineForClassFields` **未显式设置** → 默认 **true**。该模式下**字段初始化器在类字段定义阶段就执行**，那时构造参数 `config` 还没赋值（参数属性的赋值发生在构造函数体内） | **采用 §4.3**：字段只声明，赋值放构造函数体 | 字段初始化器里的 `config` 是 `undefined` → `resolveDeltaCapConfig(undefined)` → **服务一被实例化就抛 TypeError**。§4.3 是对的，§三 改动点 2 漏了 `useDefineForClassFields` 的语义 |
| B2 | **热更新的描述与代码事实相反** | §八 反双胞胎第 5 条："不做热更新 —— 运维中途改 env，**规则算子的新 session 会用新配置，审议侧还是旧的**" | **两侧都在启动期求值**：规则侧在 `ENGINE_SESSION_PORT` 的 `useFactory`（`engine.module.ts:308`，Nest 默认 singleton）里求值一次；审议侧在本单加的构造函数里求值一次（service 是单例） | **约束照办**（不引入任何热更新机制），但**理由更正**：不是"两侧不对称"，而是"**两侧对称地不热更新**" | 任务单说的"规则侧新、审议侧旧"**在当前代码里不成立**。真实的分歧不是"热更新不对称"，而是"**审议侧压根不读 env**"（一直硬编码种子值）—— 那才是本单修掉的东西。本单落地后两侧口径**真正恒等**，不存在时间窗 |
| B3 | **文档回写点** | §十："切灰度前置剩余清单里，'cap 配置统一'那条打 ✅" | `phase2-wp-list-2026-11-03.md` 里**没有**独立的"cap 配置统一"条目 —— 切灰度前置几项（delta cap / 过期判定 / 临床合理性）都写在**叙述性小结块**里（`:125` / `:129` / `:135` / `:137`） | 在小结块**补一条 ✅**；并**同时修正 `:125` 那条的口径**（它写"与规则算子同一口径"—— 2026-11-06 当时**不成立**，审议侧读的是硬编码种子值，本单之后才真正成立） | 不改 `:125` 那行，文档会**长期撒谎**；只补条目不修口径，两处自相矛盾 |

**闸门实跑**：lint **0 error / 0 warning** / `tsc -p tsconfig.build.json --noEmit` **0 error** / 全量单测 **127 文件 2160 例全绿**（基线 126 文件 2152 例，+1 文件 +8 例，既有零失败）/ `boundary.spec.ts` **12 例全绿** / `git diff --stat HEAD -- src/engine-core` **空**。
