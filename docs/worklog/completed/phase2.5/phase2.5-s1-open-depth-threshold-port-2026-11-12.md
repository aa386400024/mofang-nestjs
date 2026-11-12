# S-1 · 探索深度门槛端口化（LOW_DEPTH 并入同盟门槛端口 · core 纯端口化）

> 状态：✅ 已交付（2026-11-12）—— 交付记录：`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md`（开工单：`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-task-2026-11-12.md`）。§5 四项已按推荐拍板（见 §5 各节"已决"标注）；开工与大炮例外批准见开工单。
> 执行方：待定（可自做，亦可派 MiniMax Code）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md`（结构债评估草案 §4.1 S-1）；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-11
> 任务性质：**core 纯端口化**（把 planner 局部常量并入既有门槛端口；种子值逐字不变，缺省零行为变化）
> 改动范围：仅后端 `src/engine-core/` 两个文件 + core spec；不接 adapter env、不改装配、不碰前端

---

## 0. 【必读入口】开工前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层边界、§二 交付格式）
2. `docs/worklog/pending/phase2.5-README.md` §2 / §3 / §4.1
3. 事实源：结构债评估草案 §4.1（S-1）、台账 I-11（`:269` 起，先 grep `### I-11` 定位）
4. 本任务单

---

## 1. 背景（方向别错）

### 1.1 问题定位

探索策略分支要求同时满足两个条件（`src/engine-core/cognition/intention-planner.ts` `planIntention`）：

```
allianceGate = Math.min(snapshot.trust, snapshot.safety)
allianceGate >= thresholds.open  &&  depth < LOW_DEPTH
```

其中 `open` / `resistanceTrust` / `resistanceSafety` 已走 `AllianceConfig.thresholds` 端口（WP42）；唯独深度上限 `LOW_DEPTH = 0.35` 仍是 planner 文件内局部常量，未进端口。后果：

- 深度门槛无法按角色 / 会话档位配置，adapter 只能覆写已端口化的三个同盟门槛，碰不到它；
- I-11 显示双门槛叠加下 12 轮内 7/8 角色数学不可达；本单解决的是"深度门槛不可配置"这一结构缝，**不调任何种子数值、不调整个门槛结构**。

### 1.2 与既有债的边界（不要混做）

- 本单 = **端口化**（局部常量 → 端口字段，缺省值逐字 0.35）。
- 不做：门槛数值临床复核、"低 depth 是否为探索前提"的结构拆分、可达性批次对账、事件模型拆分（S-2）、时序权重（S-3）。这些见草案 §6 顺序与 §7 待拍板项，另案处理。
- 与 I-12 同范式：端口先通，覆盖来源（env / 按角色解析）后续标定批次再接；缺省永远无覆盖 → 逐字回落内核种子，零行为变化。

### 1.3 为什么必须落在 core 而不是 adapter

深度门槛是意图规划的纯策略比较条件（输入快照数值 → 选策略），属 conventions §1.1 明确归 core 的"阈值比较 / 决策算子"。adapter 拿不到 `planIntention` 的判定过程；把这条阈值比较搬到适配层会造成第二套策略口径，无法单测、临床不可审计（conventions §1.1 反模式）。

---

## 2. 已核现状锚点（2026-11-12 只读复核，行号以代码为准，先 grep 定位）

| 事实                   | 位置                                                                      | 现状                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 门槛端口类型           | `cognition/alliance-config.ts` `AllianceThresholds`                       | `{ open, resistanceTrust, resistanceSafety }`，全必填                                                                |
| 内核种子               | 同文件 `DEFAULT_ALLIANCE_CONFIG.thresholds`                               | open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3                                                                |
| 阈值校验唯一口         | 同文件 `sanitizeThreshold`（模块私有）+ `resolveAllianceThresholds`       | 非法（非有限 / <0 / >1）逐项回落种子                                                                                 |
| 会话级覆盖             | 同文件 `resolveSessionAllianceConfig`（I-12，刻意不进 barrel）            | 覆盖优先 → 缺项回落单例 → 非法回落种子；缺省返回 base 同一引用                                                       |
| **镜像类型**           | `domain/engine-session.types.ts` `allianceThresholds` 字段（`:90-94`）    | 全可选三字段，注释承诺与 `AllianceThresholds` **严格 1:1**；刻意不 import cognition 类型；加端口字段时此镜像必须同步 |
| 深度局部常量           | `cognition/intention-planner.ts` `LOW_DEPTH = 0.35`                       | planner 文件内私有，未进端口；探索分支 `:depth < LOW_DEPTH`                                                          |
| planner 门槛读取       | 同文件 `planIntention`                                                    | `const thresholds = resolveAllianceThresholds(alliance)`；探索分支 `depth < LOW_DEPTH`                               |
| decay 消费点           | `cognition/session-decay.ts` `resolveThresholdSubset` / `isRupturedState` | 只读 `resistanceTrust` / `resistanceSafety`；经 `resolveAllianceThresholds` 校验，新字段不影响此路径                 |
| adapter 会话级解析端口 | `engine-adapters/wiring/alliance-threshold-resolver.ts`                   | `resolve(): Partial<AllianceThresholds>                                                                              | undefined`；缺省实现返回 `undefined`；Partial 签名对新可选字段天然兼容 |
| adapter 门槛组装       | `src/engine-adapters/wiring/alliance-config.ts` `:153-161`                | 三字段 + 三枚 env 键；本单不改此文件                                                                                 |
| barrel 公开面          | `src/engine-core/index.ts`                                                | `AllianceThresholds` 类型已导出；`resolveAllianceThresholds` / `resolveSessionAllianceConfig` 不进 barrel            |
| 其余 planner 常量      | `intention-planner.ts`                                                    | `HIGH_RESISTANCE_AGG=0.6`、`HIGH_VERBAL=0.55` 是策略内阻抗判别阈值，**不属同盟门槛端口**，本单不动                   |

### 2.1 白名单口径（对照 `test/engine-core/boundary.spec.ts`）

- `AllianceThresholds` 类型已在 barrel；给它**加一个可选字段**属"扩已导出类型"，不新增导出名、不新增文件，不触发断言⑥（公开面双向白名单）与断言⑦（文件清单反向检查）。
- 不新增具名导出、不新增 core `.ts` 文件；`boundary.spec.ts` 不需要改、也不许改。

---

## 3. 范围（严格遵守，不越权）

### 3.1 在范围内（开工时才落地）

1. `cognition/alliance-config.ts`：`AllianceThresholds` 增加深度门槛字段（命名 `openDepth`，§5.1 已决）；种子 `DEFAULT_ALLIANCE_CONFIG.thresholds.openDepth = 0.35`；`resolveAllianceThresholds` 用既有 `sanitizeThreshold` 校验回落；`resolveSessionAllianceConfig` 的 merged 构造同步带该字段。
2. `cognition/intention-planner.ts`：删除局部 `LOW_DEPTH`，探索分支改读 `thresholds.openDepth`；`planIntention` 签名与返回形状不变。
3. `domain/engine-session.types.ts`：镜像类型 `allianceThresholds` 同步加 `openDepth?: number`，维持与 `AllianceThresholds` 的 1:1 注释承诺；不 import cognition 类型（依赖方向纪律不变）。
4. core spec：补缺省回落、非法值回落、会话级覆盖透传、planner 边界两侧策略选择四类用例；既有 `wp42` / `i12` spec 不破坏。

### 3.2 明确不在范围内（禁止顺手做）

- 不改 `open` / `resistanceTrust` / `resistanceSafety` 种子值；新字段种子维持 0.35。
- 不改 `DELTA_TABLE` 任何系数；不改 `HIGH_RESISTANCE_AGG` / `HIGH_VERBAL`。
- 不接 adapter env 键、不改 `engine-adapters/wiring/alliance-config.ts`、不改 module provider 装配。
- 不新增 core 文件、不新增公开导出、不改 `boundary.spec.ts`。
- 不做门槛结构临床复核（"低 depth 是否为探索前提"）、不做可达性批次对账、不拆事件模型、不加时序权重。
- 不碰 DB / migration / prompt / 前端 / Flutter；不自动 commit / push。

---

## 4. 方案设计（开工前须经 §5 拍板）

### 4.1 端口形状（推荐）

```ts
export interface AllianceThresholds {
  readonly open: number;
  readonly resistanceTrust: number;
  readonly resistanceSafety: number;
  /**
   * 探索允许的深度阻抗上限：`depth < openDepth` 才与同盟门槛一起满足探索条件。
   * 可选字段；解析口 `resolveAllianceThresholds` 补全为 [0,1] 内完整数字。
   */
  readonly openDepth?: number;
}
```

- 字段设为**可选**：adapter 既有三字段 `AllianceConfig` 对象类型上仍兼容（缺可选字段合法），无需本单改适配层；解析后内部对象为完整数字。
- 校验复用既有 `sanitizeThreshold`（[0,1]，非法回落种子），不新写第二套校验（反双胞胎纪律）。
- 种子：`DEFAULT_ALLIANCE_CONFIG.thresholds.openDepth = 0.35`，与现状局部常量逐字一致。

### 4.2 planner 读取

```ts
// 旧: depth < LOW_DEPTH
// 新: depth < thresholds.openDepth
```

`planIntention` 入参 `alliance?: AllianceConfig` 不变；无端口时 `resolveAllianceThresholds(undefined)` 返回种子，`openDepth = 0.35`，判定与改造前逐字一致。

### 4.3 零回归证明口径

- 缺省路径（无 `alliance` 覆盖）：`openDepth` 回落种子 0.35，探索分支条件等价于现状 `depth < 0.35`。
- 既有批次轨迹不变：本单不触碰事件聚合、delta、cap、信念演化；快照形状与 `Intention` 返回形状不变。
- 开工前先固化旧模型逐字基线（固定事件序列 → 快照序列 + intention 序列），交付时对比逐字一致。

### 4.4 与配置指纹的关系

`stateTransition` 指纹段挂 `state-transition.ts` 文件哈希；本单改动落在 `alliance-config.ts` 与 `intention-planner.ts`，对应指纹段为 `alliance`（挂 `alliance-config.ts`）。若后续新增独立配置载体文件，才需扩段映射；本单不新增文件，指纹段映射无需变更。

---

## 5. 待拍板决策项（本单不替大炮批准）

### 5.1 字段命名 —— 已决：`openDepth`

- 采用 `openDepth`（与 `open` 对仗，语义"探索通道的深度上限"）。备选 `maxDepthForOpen` 弃用。
- 命名一旦落进类型，后续改动属公开面变更；开工单不再复议。

### 5.2 种子值 —— 已决：维持 0.35

- 维持 0.35（本单只做端口化，灰度期默认不调阈值）。
- 若临床复核要求调整深度门槛数值，须另案标定 + 批次复验，不混入本单。

### 5.3 adapter env 键 —— 已决：本单不接

- 不接 env。与 I-12 / I-20 同款"端口先通、覆盖来源后接"；env 键扩列（如 `ENGINE_ALLIANCE_OPEN_DEPTH_THRESHOLD`）留到标定批次，随按角色门槛解析一并落地。
- 若后续批次确认要接 env，须在该批任务单显式追加 adapter wiring 改动与 `.env.example` 登记（env 键扩列契约：新增 ConfigService env 键必须同步 `.env.example`）。

### 5.4 门槛结构复核 —— 已决：另案，不属本单

"低 depth 作为探索前提"这条临床假设是否成立（草案 §4.1 候选方向 2），以及可达性对账（候选方向 3），均不属本单；是否立项由大炮在 S-1 端口化交付后决定。

---

## 6. 测试与闸门要求（开工执行方照跑，填真实数字）

### 6.1 core spec 用例清单

1. 缺省（无 alliance）→ `openDepth` 回落种子 0.35。
2. 非法值（NaN / Infinity / <0 / >1）→ 回落种子，不生效。
3. 会话级覆盖（`resolveSessionAllianceConfig`）→ 新字段覆盖优先、缺项回落单例、非法回落种子。
4. planner 边界：`depth` 恰在 `openDepth` 上下两侧的策略选择；同盟门槛与深度门槛的 AND 关系不被破坏。
5. 镜像类型：`engine-session.types.ts` 的 `allianceThresholds` 与 `AllianceThresholds` 字段集合保持 1:1（新字段在镜像侧同步为可选）。
6. 既有 `wp42-alliance-three-dimensions.spec.ts`、`i12-session-alliance-config.spec.ts` 全绿，断言不放宽；复核其 thresholds 对象字面量在新可选字段下类型兼容，且无对 thresholds 对象做 `toEqual` 全形状断言（若有，需同步）。

### 6.2 分层闸门（命令以仓 `package.json` 为准，一律 pnpm，禁裸 npx）

| 闸门      | 命令                                                     | 要求                                                                                             |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 类型      | `pnpm typecheck`                                         | 0 error                                                                                          |
| Lint      | `pnpm lint`                                              | 0 error，记 warning 数                                                                           |
| 测试      | `pnpm test`                                              | 全绿，记用例总数 / skipped / failed 与墙钟（带机器状态：有无长驻进程、盘读延迟）                 |
| core 变更 | `git diff --stat HEAD -- src/engine-core`                | 非空属预期（本单例外批准范围），但仅限 `alliance-config.ts` + `intention-planner.ts` + core spec |
| 边界护栏  | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | 全绿；本单不改该文件                                                                             |
| 零回归    | 旧模型基线 vs 改后                                       | 缺省路径 intention 序列与快照序列逐字一致                                                        |

> 跑闸门前：补 PATH（`D:\Apps\Git\cmd`，避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；`pnpm doctor:fs` 读税体检。

---

## 7. 交付记录与回写清单

### 7.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-YYYY-MM-DD.md`，内容按 conventions §2.1：一句话总结、方案 vs 任务单偏差、改动文件清单、闸门真实数字、零回归基线对比、风险与遗留。

### 7.2 交付回写（开工交付后逐项勾选）

- [x] 交付记录写到 §7.1 路径
- [x] 本任务单从 `pending/` 移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 I-11 备注更新"深度门槛已端口化；种子值未变；覆盖来源待标定批次"
- [x] 草案 §3 I-11 / §4.1 现状列同步更新
- [x] `phase2.5-wp-list-2026-11-08.md` §四独立单登记本单状态
- [x] `phase2.5-README.md` §3 当前活清单登记
- [x] `git diff --stat HEAD -- src/engine-core` 限定在 §3.1 的三个 core 文件（`alliance-config.ts` / `intention-planner.ts` / `engine-session.types.ts`）+ spec；adapter 变更面限定 `wiring/alliance-config.ts` 一文件
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

---

## 附录 A · 与 S-2 / S-3 的依赖关系（草案 §6）

- S-1（本单）：与模型轨解耦，可先行；只动门槛端口，不依赖事件模型变更。
- S-2（I-10 / I-18 neutral 拆分，D-1 模型轨 → D-2 事件拆分）：在 S-1 之后，互不改动对方文件。
- S-3（I-19 时序权重，D-3）：依赖 S-2 的 `cold_absent` 先落地；本单不涉及。

## 附录 B · 复核取证

本单锚点经 2026-11-12 二次只读复核；core 文件清单见 `data/quality/verify-core-tree-2026-11-12.log`（gitignore 隐藏，不入库）。文中事件率、可达轮次等数字均来自台账或已归档交付记录，属批次 / 历史口径；开工单阶段须当场复跑复算，不沿用本单数字。
