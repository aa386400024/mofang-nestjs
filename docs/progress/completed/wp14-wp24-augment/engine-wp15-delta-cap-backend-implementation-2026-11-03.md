# WP15 · 单回合非对称 delta cap + 算子幅度声明 + 边界回归（后端交付记录）

> 日期: 2026-11-03 ｜ 任务单: `engine-wp15-delta-cap-backend-2026-11-03.md`
> 归属: Phase1 稳健性 / M3 内测前护栏
> 状态: **代码已交付并复跑绿（未 commit）**
> 红线: engine-core **只动 `src/engine-core/cognition/state-transition.ts` 一个文件** —— 实测 `git diff --stat HEAD -- src/engine-core` 只有这一行

---

## 1. 一句话

给 BDI 状态迁移加一条**领域不变量**："一回合内 BDI 不该跳太多" ——

- **单回合非对称 cap**：trust / valence 涨最多 **+0.20**、跌最多 **−0.30**（损失厌恶）；arousal 与阻抗三维 ±0.20；移情三维 ±0.15。**砍 delta，不是 clamp 绝对值**（clamp 仍是防越界的最后防线，两道防线都留）；
- **cap 常量 env 可覆写**：`ENGINE_CAP_<DIM>_UP` / `ENGINE_CAP_<DIM>_DOWN`（如 `ENGINE_CAP_TRUST_UP=0.20`），非法值回退种子值；
- **DELTA_TABLE 每个事件加一行幅度声明**（新增算子时对照 cap 看一眼，超 80% 要标 ⚠️）；
- **adapter 侧打 warning**：`[WP15] turn delta capped: trust raw=+0.30 capped=+0.20 events=[empathy,acceptance,affirmation]` —— 内核**零 logger 依赖**，只上报"被砍了多少"。

---

## 2. 改动面（1 个内核文件 + 1 个 adapter 文件 + 1 处装配 + 2 个测试文件）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/engine-core/cognition/state-transition.ts`（**唯一内核改动**） | ① 9 维度 cap 默认值（`defaultCap`）② env 覆写（`readCap`，键名派生自维度名）③ `capAsym` + `capTurnDelta`（导出）④ `DELTA_TABLE` 11 条幅度声明注释 ⑤ `DeltaCapEntry` / `TurnDeltaCapReport` / `DeltaCapObserver` 类型 ⑥ `observeDeltaCaps()` 观察通道（模块级单槽，**内核零 logger 依赖**）⑦ `transitionState` 接入 cap（既有逻辑只改 delta 来源）⑧ `transitionStateDetailed()`（另导出，带 `{ snapshot, capped }`） |
| 2 | `src/engine-adapters/wiring/delta-cap.logger.ts`（**新**） | `DeltaCapLogger`：`onModuleInit` 注册观察者，把 cap 报告打成 warning（逐维度一条，带符号两位小数 + 事件清单） |
| 3 | `src/engine-adapters/wiring/engine.module.ts` | 装配 `DeltaCapLogger` provider（+1 import / +5 行） |
| 4 | `test/engine-core/wp15-delta-cap.spec.ts`（**新**） | **14 例**：任务单 §1.3 四条边界回归 + 9 维 cap 覆盖 + env 覆写 / 收紧 / 放宽 / 非法值回退 + cap 报告通道（详细版 + 观察者） |
| 5 | `test/engine-adapters/wp15-delta-cap-log.spec.ts`（**新**） | **4 例**：日志格式逐字对齐任务单 §1.4；下向负号不丢；没被砍时一条不打；事件清单完整 |

**没动**：`src/engine-core/**` 其余全部文件（`index.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts` / 端口 / 仓储）、`src/voice/**`、`src/counselor/**`、`src/gateway/**`、Flutter 端。

---

## 3. 机制

```
一轮咨询师输入
  → 内核分类器出标准事件 (RuleBasedClassifier)
  → aggregate(events)            本轮各维度**总 delta** (事件 delta × strength 求和)
  → capTurnDelta(raw)            逐维度砍幅: 正 delta 砍到上向 cap, 负 delta 砍到下向 cap
  → buildCapReport(raw, capped)  有维度被砍 → TurnDeltaCapReport (含被砍维度 + 事件清单)
  → observeDeltaCaps 回调         同步触发 → adapter 的 DeltaCapLogger 打 warning
  → clamp01 / clampValence        最后一道防线: 结果不越 [0,1] / [-1,1]
  → 新快照落库
```

**cap 与 clamp 的分工**（两条都要留）：

| | 管什么 | 位置 |
|---|---|---|
| `capTurnDelta` | 一回合**最多允许动多少**（速率限制） | 新增 |
| `clamp01` / `clampValence` | 结果**不能超出值域**（绝对值兜底） | 既有，未动 |

---

## 4. 与任务单的偏差（11 条，都有理由）

### 4.1 测试文件放 `test/engine-core/`，**不**放任务单 §1.3 指定的 `src/engine-core/cognition/__tests__/state-transition.cap.test.ts`

三条硬理由，任一条都足以否掉那个路径：

1. **验收 #6 要求 engine-core 只改一个文件** —— 在 `src/engine-core/` 下新建测试文件 = 内核多出第二个文件；
2. **仓库现状是 100% 测试在 `test/`**（`src/` 下 0 个测试文件），eslint 的"测试文件放宽"规则（`max-len` / 浮点比较 / `complexity` 等）也只对 `test/**` 生效；
3. **技术硬约束**：`tsconfig.build.json` 只排除 `**/*.spec.ts` 与 `test/**/*` —— 任务单给的 `*.test.ts` 命名会被 `pnpm build` **编进 `dist/` 产物**，而且 `tsconfig.json` 是 `"types": ["node"]`（vitest 全局无类型）→ 直接 TS2304；而若改成 `import { describe } from 'vitest'` 显式导入，`boundary.spec.ts` ④ 的"外部依赖白名单 = `{ nanoid }` + `node:*`"会当场变红。

文件名另按仓库惯例取 `wp15-delta-cap.spec.ts`（与 `wp1-bdi` / `wp3-trajectory` / `wp4-safety` 同款命名）。

### 4.2 cap 报告走**观察者回调**，不改内核出参 DTO —— 这是"只动一个内核文件"与"adapter 打日志"同时成立的唯一解

任务单 §1.4 的理想形态是"把信息作为返回值带出来"，但内核 → adapter 现成的通道只有内核出参 DTO（`engine-session.types.ts`）—— 那是**第二个内核文件**，改了就是改已发布契约（且 `in-memory-engine-session.ts` 也得跟着透传，第三个）。

**我的解法**：`state-transition.ts` 里挂一个**模块级单槽** `capObserver`，`transitionState` 同步调用它：

- 内核**不 import logger**（§1.4 的核心要求达成）；
- 不改任何已发布契约（`transitionState` 签名与返回类型逐字不变）；
- 单槽 + **同步调用** = 报告与触发它的那一轮严格对应（不留存、不跨轮串台）。

**代价（如实记录）**：内核里第一次出现模块级可变状态 —— 这是"纯层"的一处破例，写在文件头注释里。**替代方案**（Phase2 想换随时可换）：给 `EngineTurnOutput` 加**可选** `deltaCap?` 字段 + `in-memory-engine-session.ts` 透传 → 纯度归零，代价是再动 2 个内核文件。两条路的取舍留给后续拍板。

### 4.3 `transitionState` 签名与返回类型**逐字不变**，另导出 `transitionStateDetailed()`

`transitionState` 是内核会话端口既有调用点（`in-memory-engine-session.ts:246`）与 3 个既有测试（`wp3-trajectory` / `wp4-safety` / `wp5-rendering`）的公共契约 —— 改返回形状 = 改已发布契约（验收 #5 的 1115 例零回归也会当场红）。故另导出详细版，返回 `{ snapshot, capped }`（任务单 §1.4 建议的形状），当前**无生产调用方**，是给"需要 cap 观测的调用方"留的公开出口。

### 4.4 内核 diff **193 行**（+191 / −2），超过验收 #6 的 "< 80 行"

如实记录，不粉饰。§1.1（cap + env）/ §1.2（11 条幅度声明）/ §1.4（报告通道）三项功能叠在一起，最小可读实现就超 80；其中**约 120 行是中文说明注释**（与本仓"每个决策解释为什么、文件头大段治本说明"同款），纯逻辑约 73 行，**既有代码只改了 2 行**（`transitionState` 的 delta 来源 + `neutral` 的注释位）。

要压到 80 以内，只能删注释或砍功能 —— 前者与仓库风格冲突、后者直接破验收 #1/#2/#8。**是否接受这个偏差，需要用户拍板**（要么接受现状，要么授权"以压行数为先"重写一版紧凑实现）。

### 4.5 内核读 `process.env` —— 这是内核第一处读 env

取舍写在文件头：M3 内测要按真实对话调 cap 参数，改代码重发版太慢；代价是内核不再"完全可复现"，但 env **只影响 cap 参数、不影响迁移逻辑** —— 同 env + 同输入仍逐字同输出。

### 4.6 env 键名**派生**（`ENGINE_CAP_<DIM>_UP/DOWN`），未在 `typings/global.d.ts` 逐个声明

18 个键是**派生族**（9 维度 × 2 方向）。静态声明 18 行必然与维度表漂移（加了维度忘了加声明 = 静默失效）。用计算键 + 维度表作单一真相源，非法值一律回退默认。**未走 `typings/global.d.ts` 的显式声明**是本单与仓库既有 env 治理口径的一处例外，理由同上（声明了就变成两份真相）。

### 4.7 非法 env 值的口径：未设 / 空串 / 非数字 / **符号与方向不符** → 回退默认；**允许 0**（= 冻结该方向）

`ENGINE_CAP_TRUST_UP=0.2` / `ENGINE_CAP_TRUST_DOWN=-0.3` 是正常形态；`DOWN=0.5`（正数配下向）判非法回退；`UP=0` 视为"冻结信任上涨"这一合法配置。

### 4.8 任务单 cap 表里的 `resistance.*` / `transference.*` 落到 9 个 **delta 维度**上

任务单表格按快照结构写（resistance 三维 / transference 三维），实现按 delta 向量的 9 个键写（`verbal` / `depth` / `style` / `positive` / `negative` / `dependency`）—— 同一组维度，两种叫法。arousal 上下同为 ±0.20（任务单表里写了两行同值）。

### 4.9 `⚠️ 接近 cap` 标记**一个都没加**

规则是"单事件某维度 |delta| 超过该维度 cap 的 80%"。现有 11 个算子的**最高比值是 75%**（`boundary_cross.style` +0.15 / `sensitive_touch.arousal` +0.15，对上向 cap 0.20）—— 都没到 80% 警戒线。规则本身写在 `DELTA_TABLE` 的文档注释里，新增算子时照着办。

### 4.10 adapter 侧新增一个 provider（`DeltaCapLogger`），挂进 `EngineWiringModule`

任务单 §2 明确允许"改 adapter 层（除了接收 capped 信息打日志）"。放在独立 provider 而不是塞进 `EngineTurnService` 构造函数：职责单一、可单独单测、不给门面服务塞副作用。装配缺席 = 不打日志，**但内核照常砍幅**（观测是增强，不是会话能力）。

### 4.11 没做 Phase2 四项：状态衰减 / 同方向边际递减曲线 / 饱和效应 / Prometheus 溢出告警

任务单 §2 明确划到 Phase2，本单**没顺手做**。另：DELTA_TABLE 的**种子值本身一个没改**（只加注释）。

---

## 5. 能力边界（做完了什么 / 没做什么）

**做完了**：

- 单回合非对称 cap 生效，9 个维度全有上下向 cap，env 可调；
- DELTA_TABLE 11 个事件全有幅度声明注释；
- adapter 侧逐维度 warning（格式与任务单示例逐字对齐）；
- 边界回归 18 例新测试（内核 14 + adapter 4）。

**没做 / 不能做**：

1. **cap 参数是工程种子值，未标定** —— M3 内测拿到真实对话日志后按 env 调（信任涨得是不是太快，真实语料说了算）；
2. **cap 只管单回合总 delta，不管跨回合累积速度** —— 连续 10 回合每回合都涨满 0.20，信任照样一路涨到 1（这是 Phase2 的衰减 / 边际递减）；
3. **cap warning 不带 sessionId / turnIndex** —— 观察者在内核纯层里同步触发，拿不到外层的句柄上下文（任务单示例日志同样没有）；要按会话归因，得等 cap 报告挂进出参 DTO（见 §4.2 的替代方案）；
4. **没有 Prometheus 指标**（Phase2），只有文本 warning；
5. **观察者是进程级单槽** —— 多实例部署时每个进程各打各的日志，没有跨进程汇总（也不该有：内核会话本来就是进程内状态）；
6. **env 生效范围是整个进程** —— 改 env 需要重启，不支持热调；
7. **内核"完全可复现"这条自述已被 env 破例**（见 §4.5）：同 env 同输入仍逐字同输出。

---

## 6. 闸门

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | ✅ 0 error |
| Lint | `npx eslint "src/**/*.ts" "test/**/*.ts"` | ✅ 0 error / **0 warning** |
| 全量测试 | `npx vitest run --exclude '**/e2e/**/*.ts'` | ✅ **74 文件 / 1133 例全通过**（基线 72 文件 / 1115 例 → +2 文件 / +18 例） |
| 内核改动面 | `git diff --stat HEAD -- src/engine-core` | ✅ 只有 `src/engine-core/cognition/state-transition.ts` 一个文件 |
| 既有内核套件 | `npx vitest run test/engine-core` | ✅ 7 文件 / 177 例（含既有 wp1–wp5 + boundary 断言）全绿 |
| 引擎侧套件 | `npx vitest run test/engine-core test/engine-adapters` | ✅ 32 文件 / 583 例全绿 |

**边界断言专项**（`test/engine-core/boundary.spec.ts`，机器断言）：① 零 @nestjs ✅ ② 零 typeorm ✅ ③ 零逃出目录 import ✅ ④ 外部依赖白名单（内核新增 0 个外部依赖；`process.env` 是全局不是 import）✅ ⑤ 零 NestJS 装饰器 ✅ ⑥ `index.ts` 双向白名单（**没往 barrel 加导出**，未触发白名单变更）✅ ⑦ 目录结构清单 ✅ ⑧ 内核根目录无散落文件 ✅ ⑨ B 层实现在内核包外 ✅。

---

## 7. 回写清单

- [x] 任务单 `engine-wp15-delta-cap-backend-2026-11-03.md` 状态行 → ✅ 已交付并复跑绿
- [x] 本交付记录 → `completed/wp14-wp24-augment/engine-wp15-delta-cap-backend-implementation-2026-11-03.md`
- [x] backlog 母版 §WP15 小节 → ✅ 已交付
- [x] backlog 母版 顶部状态行 → WP15 从"剩余"里划掉
- [x] backlog 母版 优先级表 WP15 行 → 划掉
- [x] backlog 母版 §0.2 交付表 → 加 WP15 行
- [x] `docs/progress/README.md` 速查 → 加 WP15 行

---

## 8. 复跑方式

```bash
cd E:\Work\Project\backend\mofang-nestjs

# 新增测试（内核 14 例 + adapter 4 例）
npx vitest run test/engine-core/wp15-delta-cap.spec.ts test/engine-adapters/wp15-delta-cap-log.spec.ts

# 全量闸门
npx tsc -p tsconfig.build.json --noEmit
npx eslint "src/**/*.ts" "test/**/*.ts"
npx vitest run --exclude '**/e2e/**/*.ts'

# 内核改动面（应只输出 state-transition.ts 一行）
git diff --stat HEAD -- src/engine-core

# 看 cap 是不是真的在砍（内测时可直接改 env 试）
#   ENGINE_CAP_TRUST_UP=0.05   → 收紧：3 次共情只涨 0.05
#   ENGINE_CAP_TRUST_UP=0.30   → 放宽：3 次共情涨满 0.30
```
