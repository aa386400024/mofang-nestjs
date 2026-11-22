# WP60 · delta 规则表配置化 交付记录

> 状态: ✅ 已交付
> 任务单: [`wp60-delta-table-config-2026-11-08.md`](wp60-delta-table-config-2026-11-08.md)
> 日期: 2026-11-08
> 红线: ⚠️ **engine-core 改了 3 个文件**（任务单 §5.3 明确授权:「只加端口类型和函数参数, 不改算子逻辑」）—— 基础系数表 `DELTA_TABLE` **一个数字未动**
> 边界断言: ✅ `boundary.spec.ts` 全绿（12 例; 断言⑥ 公开面白名单 + 断言⑦ 内核文件清单 已同步登记）
> 承接: WP26 P2-14（DeltaCapConfig 注入）/ WP34（PersonalityModulatorConfig）/ WP42（AllianceConfig）/ WP36（SessionDecayConfig）—— 同一范式
> 前提: 与 cap / 人格 / 同盟 / 衰减族同一治本 —— **env → (适配层) → 端口 → (内核)**，内核零 `process.env`
> ⚠️ 系数是**工程种子值, 非临床标定** —— 待真实对练校准

---

## 1. 实际改了哪些文件

### 1.1 内核（engine-core）: 1 增 2 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-core/cognition/delta-table-config.ts` | **新增**（本单主文件 · 208 行）: ① `DELTA_DIMENSIONS`（11 个维度名单 · **唯一一份**）+ `DeltaDimension`; ② `DeltaDimensionOverride`（维度级 Partial）+ `DeltaTableOverrides` + `DeltaTableConfig`（端口）+ `DEFAULT_DELTA_TABLE_CONFIG`（空覆写）; ③ `resolveDeltaVector(kind, base, table?, alliance?)` —— **逐维度优先级裁决只在这一处**; ④ `DeltaDimensionsMatch` + `DELTA_DIMENSIONS_MATCH` —— 编译期断言（维度名单与 `DeltaVector` 少一维/多一维都编译期报错）; ⑤ `pickOverride()` —— 非法值（非有限数）逐项回退基础值; ⑥ 文件头说明块（为什么要有这一层 / 反双胞胎纪律 / 优先级口径） |
| `src/engine-core/cognition/state-transition.ts` | **改**（+32 / -25）: ① `aggregateTurnDelta(events, alliance?, deltaTable?)` —— **第三个位置**加可选参数（现有调用点零改动）; ② 聚合循环改为**统一走 `resolveDeltaVector`**（原来 safety / bond 单独取 alliance 值、其余维度直接取基础值 —— 现在 11 维统一, 优先级在一处裁决）; ③ `TransitionStateOptions` 加 `deltaTable?`; ④ `transitionState()` / `transitionStateDetailed()` 两处透传; ⑤ `CAP_DIMS` **不再另列一份** —— 改为 `DELTA_DIMENSIONS` 的别名（cap 报告顺序不变）; ⑥ 文件头补本单说明块 |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | **改**（+17 / -1）: ① `InMemoryEngineSessionOptions` 加 `deltaTableConfig?`; ② 字段 + 构造赋值; ③ 落库路径 `aggregateTurnDelta(events, this.allianceConfig, this.deltaTableConfig)`; ④ 临时快照路径 `transitionState(..., { deltaTable: this.deltaTableConfig })` —— **两条路径同一份配置**（否则临时快照与落库快照会漂） |
| `src/engine-core/index.ts` | **改**（+8 / -0）: barrel 导出 `DeltaTableConfig` / `DeltaTableOverrides` / `DeltaDimensionOverride` / `DeltaDimension` + `DELTA_DIMENSIONS` / `DEFAULT_DELTA_TABLE_CONFIG` / `resolveDeltaVector` —— 适配层只能走 barrel（boundary 断言⑪ 守着深路径 import） |

### 1.2 适配层（engine-adapters）: 1 增 3 改

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/wiring/delta-table.config.ts` | **新增**（本单主装配层 · 172 行）: `resolveDeltaTableConfig(config: ConfigService, onWarn?)` —— **11 个键逐个字面量读**（`ENGINE_DELTA_<事件大写>`），每键一个 JSON 对象 → 维度级覆写; 非法值（JSON 语法错 / 非对象 / 未知维度名 / 值不是有限数）**逐项忽略**且**逐条告警**; 端口里只放真正生效的覆写（不留空壳条目） |
| `src/engine-adapters/wiring/engine.providers.ts` | **改**（+8 / -0）: `EngineSessionTuningDeps` 加 `deltaTableConfig?` + 透传给内核会话 |
| `src/engine-adapters/wiring/engine.module.ts` | **改**（+12 / -1）: 装配 `deltaTableConfig: resolveDeltaTableConfig(config, (message) => wiringLogger.warn(message))` + 模块级 `Logger('EngineWiring')`（装配期告警用） |
| `src/engine-adapters/wiring/turn-delta-audit/turn-delta-audit.service.ts` | **改**（+11 / -1）: **同步注入** deltaTable 端口 —— 审计记的 raw_delta 必须与内核实际施加的**对得上**（见 §3 D6） |

### 1.3 配置登记: 2 改

| 文件 | 改了什么 |
|---|---|
| `typings/global.d.ts` | **改**（+21 / -0）: 11 个 `ENGINE_DELTA_*` 键**显式声明到 ProcessEnv**（仓库 env 治理约定: 不用 bracket / 计算键绕过） |
| `.env.example` | **改**（+28 / -0）: 新增「delta 规则表 (WP60 · 11 个键)」段 —— 键名口径 + JSON 形状 + 合法维度名单 + 优先级说明 + **11 行故意留空**（真相源只留内核一份） |

### 1.4 测试: 2 增 3 改

| 文件 | 改了什么 |
|---|---|
| `test/engine-core/wp60-delta-table-config.spec.ts` | **新增**（18 例）: ① 零回归（不传端口 = 种子值逐字一致; 空端口 = 不传）② 覆写按维度（只配 trust → 其余 10 维走基础值; 单事件隔离; 强度乘法仍作用）③ 逐维度优先级（deltaTable > alliance > 基础值; 同维度撞车时 deltaTable 赢）④ 非法值回退（NaN / Infinity; 0 是合法值; 非法值回退到 **alliance 的值**而不是直接跳基础值）⑤ `transitionState` 路径 ⑥ **会话注入路径**（构造注入 → 落库快照跟着变; 不注入 = 逐字一致）⑦ 11 种事件穷举（覆写是**替换**不是叠加） |
| `test/engine-adapters/wp60-delta-table-config.spec.ts` | **新增**（11 例）: 没配 env = 与内核种子值逐字一致 / JSON 生效 / 只写一维 / 负数合法 / 空串不告警 / 非法 JSON / 非对象（数组·数字·字符串·null）/ 未知维度名 / 值不是有限数 / 全被丢弃不留空壳 / 11 个键穷举 |
| `test/config/wp25-env-example-coverage.spec.ts` | **改**（+43 / -0）: 新增断言③g —— 11 个 `ENGINE_DELTA_*` 键**逐个字面量**读（漏一个立刻红）+ 内核树里**不许**出现任何 `ENGINE_DELTA_` 字符串（内核零 env 读取） |
| `test/engine-core/boundary.spec.ts` | **改**（+11 / -0）: 断言⑥ 公开面白名单加 7 个符号 + 断言⑦ 内核文件清单加 `cognition/delta-table-config.ts`（**新增内核文件必须登记** —— 这条断言是双向的, 不登记就红） |

### 1.5 **零改动**（逐条核实过）

- `src/engine-core/cognition/alliance-config.ts` —— **零改动**（`AllianceConfig` 仍然只覆写 safety / bond, 任务单 §5.4 明确要求）
- `src/engine-core/cognition/state-transition.ts` 里的 **`DELTA_TABLE` 基础系数表** —— **一个数字未动**（11 事件 × 11 维全部原样; 任务单 §5.4「不要把 DELTA_TABLE 删掉」照做）
- `src/shared/infra/redis/redis.service.ts` / `src/engine-core/domain/**` / `src/engine-core/memory/**` —— 零改动
- `src/engine-adapters/wiring/engine.tokens.ts` —— 零改动（端口走既有 `EngineSessionTuningDeps` 通道, 不新增 token）
- 无 migration / 无 entity / 无新表 / 无新列
- `admin-dashboard/` —— 零改动（前端另一个 AI 的活）
- **不改任何判定逻辑** —— 系数来源换了, 算子链路（聚合 → 人格调节 → cap → 落快照）一字未动

---

## 2. 任务单 §二 核实清单 · 逐条结论

| # | 任务单问什么 | 核实结论 |
|---|---|---|
| 1 | `DELTA_TABLE` 有多少事件 / 多少维度 | **11 事件 × 11 维度**。事件: empathy / acceptance / normalization / open_probe / affirmation / judgment / preaching / minimizing / boundary_cross / sensitive_touch / neutral; 维度: trust / safety / bond / verbal / depth / style / valence / arousal / positive / negative / dependency。⚠️ **基础表本身没有导出**（模块私有 `const`）—— 任务单没提这一点: 覆写只能走端口, 外部无法直接 import 那张表（也就不存在"绕过端口改基础值"的口子） |
| 2 | `AllianceConfig` 怎么覆写 | `deltas: Partial<Record<CounselorEventKind, AllianceDeltaOverride>>`, 而 `AllianceDeltaOverride` **只有 safety / bond 两个可选字段**; 覆写经 `resolveAllianceDelta(kind, base, overrides)` 逐维度回落。→ 任务单 §5.2 说的"两者各管各的维度"**已经被两个端口的类型定死了**（不是本单临时定的规矩） |
| 3 | `DeltaCapConfig` 怎么从 env 装配 | `src/engine-adapters/wiring/delta-cap.config.ts` → `resolveDeltaCapConfig(config: ConfigService)`: **22 个键逐个字面量读**, 非法值回退内核种子值不抛错, 内核零 env。本单**完全照抄这一范式**（含 env 治理与 env 覆盖断言） |
| 4 | `aggregateTurnDelta()` 签名 | `(events: readonly SessionEvent[], alliance?: AllianceConfig): DeltaVector` —— 第二个位置**已经是** alliance 端口（任务单没提这层既有注入） |
| 5 | 内核 barrel 导出了哪些类型 | `src/engine-core/index.ts` 导出**类型 + 纯函数 + 默认常量**（`AllianceConfig` / `DEFAULT_ALLIANCE_CONFIG` 同款）。⚠️ 新增符号必须**同步** boundary 断言⑥ 白名单, 否则"漏导出"与"多导出"双向都会红 |

---

## 3. 关键设计决策与偏差（与任务单有出入的地方 + 为什么）

### 3.1 D1（任务单 §3.2 的端口类型**写不出来**）: 维度级 Partial, 不是事件级 Partial

- **任务单 §3.2** 写: `readonly deltas?: Readonly<Partial<Record<CounselorEventKind, DeltaVector>>>`
- **问题**: `DeltaVector` 的 11 个字段**全是必填**。`Partial<Record<...>>` 只解开了"事件"那一层, 解不开"维度"那一层 —— 于是"只配 trust、其余回基础值"在任务单给的类型里**根本表达不了**（要配就得 11 维全填）。
- **本单改法**: `DeltaDimensionOverride = Readonly<Partial<DeltaVector>>`（**维度级** Partial）→ 任务单 §5.2 的逐维度叠加语义才成立。
- **顺带**: 端口字段改成**必填** `deltas`（不是 `deltas?`）—— 与 `AllianceConfig.deltas` 形状一致, 且"空覆写"有明确表达（`DEFAULT_DELTA_TABLE_CONFIG = { deltas: {} }`）。

### 3.2 D2: `aggregateTurnDelta` 的新参数放**第三位**, 不改成 options 对象

- **任务单 §3.4** 只说"加一个可选参数 `deltaTable?`", 没指定位置。
- **本单改法**: `(events, alliance?, deltaTable?)` —— **既有调用点一个不改**（内核 2 处 + 适配层 1 处 + 5 个既有测试文件）。
- **为什么不改成 options 对象**: 改成 `{ alliance?, deltaTable? }` 要动既有公开 API 的形状（`aggregateTurnDelta(events, alliance)` 会变成类型错误）→ 那是**改已发布契约**, 而本单要的是"只加一个可选参数, 零回归"。

### 3.3 D3: 维度名单**只留一份**（内核原有 `CAP_DIMS` 改为别名）

- 内核原本在 `state-transition.ts` 里有一份 11 维名单 `CAP_DIMS`。WP60 之后维度名单有了**第二处用途**（覆写表索引 + 适配层校验 env 的 JSON 键）→ 两份名单 = 两张会漂的清单（仓库既有纪律:「两处各算一遍 = 两张会漂的定价表」）。
- **本单改法**: 名单上移到 `delta-table-config.ts` 的 `DELTA_DIMENSIONS`, `CAP_DIMS` 改为它的别名 —— **cap 报告的维度顺序不变**（`CapDim` 类型不变, barrel 白名单不变）。

### 3.4 D4: 加**编译期断言**（维度名单 ↔ `DeltaVector` 必须逐字一致）

- 少一维 = 那个维度永远配不上（静默失效）; 多一维 = 覆写值被存下来却**没有任何地方消费**（同样静默失效）。两者都不会报错。
- **本单改法**: `DeltaDimensionsMatch`（类型）+ `DELTA_DIMENSIONS_MATCH`（常量, 强制类型被求值）→ 对不上时**编译期直接报错**。
- **为什么要有这个死常量**: 类型别名是**惰性**的 —— 没人引用就不会求值, 断言也就不会真的报错。给它一个值位置（`const` 标注）, 类型就必须求值。

### 3.5 D5: 非法值**照回退基础值, 但必须喊一声**（任务单只说"回基础值"）

- **任务单 §5.1**: "非法值: 回基础值（和 `DeltaCapConfig` 同范式）" —— 照做。
- **本单加的一层**: 每条被丢弃的覆写都**告警一次**（`onWarn` 回调 → 装配层 `Logger('EngineWiring')`）。理由: 本仓最贵的 bug 是"配了不生效却什么提示都没有"（WP48 那一整套 env 守卫都是冲这个去的）; 纯静默回退 = 把用户最想改的那一维悄悄丢掉。
- **不破坏纯函数性**: `onWarn` **可选**（缺省 = 静默）, 装配层单测可捕获告警。

### 3.6 D6（任务单没提, 但不做就错）: 审计观测面**必须同步接线**

- `turn-delta-audit.service.ts` 之前只注入 `alliance`, 算 raw_delta 用 `aggregateTurnDelta(merged, this.alliance)`。
- **本单同步注入 deltaTable** —— 否则审计记的 raw_delta 与内核**实际施加的**对不上（差的就是 env 覆写的那部分）。WP58 交付记录 D3 的同款纪律: 观测一旦与内核漂移, 它记的数就是**骗人的数**。

### 3.7 D7: env 键按**事件**不按维度（采纳任务单 §3.3）

- 11 事件 × 11 维度 = **121 个**维度级 env 键 —— 那是没法维护的清单。
- 每事件一个 JSON 键: **11 个**键, 且只写要改的维度。

### 3.8 D8: 覆写是**替换**基础值, 不是叠加

- 任务单 §3.3 的例子「`DeltaTableConfig` 覆写了 empathy 的 trust」没说清是替换还是叠加。本单定为**替换**（覆写值 = 该维度的最终系数）—— 否则"把 trust 从 0.10 调到 0.15"得写成 0.05, 太反直觉。测试里钉死（⑦ 组: 覆写 trust=0.02 → 结果就是 0.02, 不是 0.12）。

### 3.9 无关的 1 处格式改动（登记在案）

- `engine.module.ts` 的 `resolveSessionDecayConfig` import 位置被 `eslint --fix` 归位（2 行移动）—— 加了新 import 后 import 分组边界变了, eslint 要求的顺序随之变化。**与本单逻辑无关**, 但它进了 diff, 故登记。

---

## 4. 闸门数字

| 闸门 | 结果 |
|---|---|
| `npx eslint "{src,test,bin}/**/*.ts"` | ✅ **0 error**（exit 0） |
| `npx tsc -p tsconfig.build.json --noEmit` | ✅ **0 error**（exit 0） |
| `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **全绿**: **133 passed / 1 skipped（134 files）· 2289 passed / 4 skipped（2293 tests）**，65.07s（本单新增 29 例: 内核 18 + 适配层 11; 另 env 覆盖断言 ③g 1 例） |
| `boundary.spec.ts`（12 条边界断言） | ✅ 全绿 —— 断言⑥ 公开面白名单 + 断言⑦ 内核文件清单 同步登记 |
| env 覆盖断言（`wp25-env-example-coverage.spec.ts`） | ✅ 全绿（11 例, 含新增 ③g） |
| `git diff --stat HEAD -- src/engine-core` | ⚠️ **3 个文件 / +57 / -26** —— **本单授权的内核改动**（任务单 §5.3）: 只加端口类型 + 函数参数 + 接线, **基础系数表一行未动** |

> 4 例 skipped = 真 Redis 集成用例（上一单, 不设 `TEST_REDIS_URL` 时整份跳过）—— 与本单无关。

---

## 5. 残留风险与后续

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | **维度名拼错** → 该维度不生效 | 运维改了半天只有一部分生效 | 已被丢弃的维度**逐条 warn**（D5）; 合法维度名单在 `.env.example` / 本记录 / 单测三处各列一份。⚠️ 告警只在启动期打一次 —— 配错的键要**重启**才看得到 |
| R2 | 覆写值**无量纲约束** | 可以配 `{"trust":5}` | 单回合 cap 是最后一道防线（trust 上向 +0.20）—— 离谱值会被砍, 但"事件系数被 cap 吃光"是运营自己选的。**不发明量纲校验**（那是临床决定, 不是工程决定） |
| R3 | **两处装配**（内核会话 + 审计服务）各自读 env | 同一份 env → 同一结果; 但若将来 env 支持热更新, 两处会不同步 | 与 alliance 现状**同款**（现状也是两处各读一次）。热更新不在本期范围 |
| R4 | env 值里带 `#` 会被 dotenv 当注释 | 该键静默取不到值 | 现有 env 家族的通用坑, 不为本单单独处理; 维度值都是数字, 用不到 `#` |
| R5 | 任务单 §3.4 提的**事件级权重 / 条件规则** | 本期**没做** | 本期只做"逐维度常数覆写"。要做条件规则（例如"仅当 X 时才放大 Y"）得另开单 —— 那已经不是配置表, 是规则引擎 |
| R6 | 后期运营要**自定义规则** → JSON 配置文件 | 本期**没做**（任务单 §3.3 明确本期只做 env） | env 这层将来退化成"默认 + 覆盖", JSON 文件做主源。**另开单** |

---

## 6. 怎么用（运维视角）

```bash
# .env —— 每个事件一个 JSON 键, 只写要改的维度
ENGINE_DELTA_EMPATHY={"trust":0.15,"safety":0.02}
ENGINE_DELTA_JUDGMENT={"trust":-0.2}
```

- **合法维度（11 个）**: trust / safety / bond / verbal / depth / style / valence / arousal / positive / negative / dependency
- **优先级（逐维度）**: `ENGINE_DELTA_*` > `ENGINE_ALLIANCE_*`（只管 safety / bond）> 内核基础系数（`DELTA_TABLE`）
- **改完要重启**（装配期解析一次, 不是每轮读）
- **非法值**: JSON 语法错 / 不是对象 / 维度名不认识 / 值不是有限数 → **逐项忽略 + 启动日志 warn 一声**
- **没配 = 内核基础系数**, 逐字等同改造前（零回归）

---

## 7. 交付后回写

| 项 | 状态 |
|---|---|
| 任务单状态行改 ✅ + 指向本记录 | ✅ |
| 任务单 + 交付记录移入 `completed/phase2/` | ✅ |
| `docs/worklog/README.md` 回写 | ✅ |
| `docs/worklog/pending/phase2-overview-2026-11-03.md` 回写（P2-7 那一行） | ✅ |
| commit message 草稿 | `feat(wp60): delta 规则表抽成配置端口, 改系数不用发版` |

---

_本交付记录写于 2026-11-08。_
