# S-1 · 探索深度门槛端口化开工单（LOW_DEPTH → AllianceThresholds.openDepth · S1 方案）

> 状态：✅ 已交付（2026-11-12）—— 交付记录：`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-2026-11-12.md`
> 执行方：MiniMax Code。
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 事实源：`docs/worklog/pending/phase2.5-s1-open-depth-threshold-port-2026-11-12.md`（S-1 任务单）；预研结论 `docs/worklog/pending/phase2.5-s1-research-result-2026-11-12.md`（R1–R8 已验收通过）
> 任务性质：core 纯端口化 + 适配层一行透传；种子值逐字不变，缺省零行为变化
> 改动范围：后端 `src/engine-core/` 三文件 + `src/engine-adapters/wiring/` 一文件 + core/adapter spec；不接 env、不改装配、不碰前端

## 例外批准声明（conventions §1.1）

本单经大炮明确授权，允许改动下列 core 文件。改动性质是**纯决策阈值的端口化**（阈值比较属 core 职责，见 conventions §1.1），不引入任何副作用：

- `src/engine-core/cognition/alliance-config.ts`
- `src/engine-core/cognition/intention-planner.ts`
- `src/engine-core/domain/engine-session.types.ts`

另授权适配层一行透传：`src/engine-adapters/wiring/alliance-config.ts`（不接 env，仅把内核种子值透传到端口对象）。`boundary.spec.ts` 不许改。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）
2. S-1 任务单（事实源）+ 预研结论（R1–R8 证据与风险表 A–I）
3. `docs/worklog/pending/phase2.5-README.md` §2 / §3 / §4.1
4. 本开工单

---

## 1. 背景与已决项

`intention-planner` 探索分支：`allianceGate >= thresholds.open && depth < LOW_DEPTH`。三个同盟门槛已走 `AllianceConfig.thresholds` 端口，唯独深度上限 `LOW_DEPTH = 0.35` 是 planner 局部常量。本单把它并入端口，使深度门槛可随角色 / 会话配置，与其余门槛同构。

**已决（不再复议）：**

- 字段 `openDepth?: number`，并入 `AllianceThresholds`；种子 **0.35**；可选字段。
- **种子放法 S1**：`openDepth` 进 `DEFAULT_ALLIANCE_CONFIG.thresholds`；适配层 wiring 补一行种子透传（**不接 env**）；适配层 spec 补一键。
- 不接 adapter env；临床结构复核与可达性对账另案（任务单 §5.4）。
- `HIGH_RESISTANCE_AGG` / `HIGH_VERBAL` 是策略内阻抗阈值，不进同盟门槛端口，本单不动。

## 2. 已核现状锚点（行号以代码为准，先 grep 函数名 / 常量定位）

| 位置                                                            | 现状                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cognition/alliance-config.ts` `AllianceThresholds`（:59）      | `{ open, resistanceTrust, resistanceSafety }`                                                                                                                  |
| 同文件 `DEFAULT_ALLIANCE_CONFIG.thresholds`（:91-97）           | open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3                                                                                                          |
| 同文件 `sanitizeThreshold`（:108，模块私有）                    | [0,1] 校验，非法回落种子；唯一校验口，直接复用                                                                                                                 |
| 同文件 `resolveAllianceThresholds`（:116-125）                  | **两条路径都要补 `openDepth`**：`:119` 的 `!provided` 早退分支 + 正常分支（风险 B，见 §4）                                                                     |
| 同文件 `resolveSessionAllianceConfig`（:151-168）               | `merged`（:158-162）加 `openDepth: override.openDepth ?? baseThresholds.openDepth`；无覆盖时返回 base **同一引用**（既有断言 `i12:38` 依赖，不得改成重建对象） |
| `cognition/intention-planner.ts` `LOW_DEPTH`（:40）             | 局部常量，**必须删除**；探索分支（:66）改 `depth < thresholds.openDepth`                                                                                       |
| `domain/engine-session.types.ts` `allianceThresholds`（:90-94） | 全可选三字段镜像；加 `openDepth?: number`；更新 :76 起「三字段 1:1」注释为四字段；`domain/` 仍不 import `cognition/`                                           |
| `engine-adapters/wiring/alliance-config.ts`（:153-161）         | 门槛组装；S1 下加一行 `openDepth: seed.openDepth`（不读 env）                                                                                                  |
| `test/engine-adapters/wp42-alliance-config.spec.ts`             | :37 / :95 / :107 全对象 toEqual（S1 下自动绿）；**:75-79 三键 toEqual 需补 `openDepth: 0.35`**                                                                 |
| `src/auto-practice/config-fingerprint.ts`（:52）                | `alliance` 段挂 alliance-config.ts 文件哈希；本单改动会改变该段哈希（固有后果，知悉即可，不改映射）                                                            |

## 3. 范围

### 3.1 在范围内

1. `cognition/alliance-config.ts`：
   - 类型加 `readonly openDepth?: number`（注释点明本字段比较的是 `BdiResistance.depth` 阻抗维）；
   - 种子 `thresholds.openDepth = 0.35`；
   - `resolveAllianceThresholds` 早退分支与正常分支都产出含完整 `openDepth` 的对象，复用 `sanitizeThreshold` 回落；
   - `resolveSessionAllianceConfig` 的 `merged` 带 `openDepth`。
2. `cognition/intention-planner.ts`：删 `LOW_DEPTH`；探索分支改读 `thresholds.openDepth`；签名与 `Intention` 返回形状不变。
3. `domain/engine-session.types.ts`：镜像加 `openDepth?: number`；同步注释；依赖方向纪律不变。
4. `engine-adapters/wiring/alliance-config.ts`：门槛组装加 `openDepth: seed.openDepth`（种子透传，不读 env、不加 env 键）。
5. 新增 `test/engine-core/s1-open-depth-threshold.spec.ts`（用例见 §5）。
6. `test/engine-adapters/wp42-alliance-config.spec.ts`：:75-79 断言对象补 `openDepth: 0.35`。

### 3.2 明确不在范围内

- 不改种子数值（除新增 `openDepth = 0.35`）；不改 `open` / `resistanceTrust` / `resistanceSafety`。
- 不改 `DELTA_TABLE`、人格调节、session-decay、事件词表 / 判定器、cap、信念演化。
- 不接 env、不改 `.env.example`、不改 resolver / engine-turn.service / module 装配 / migration / DB。
- 不新增 core `.ts` 文件、不新增 core 公开导出、不改 `boundary.spec.ts`。
- 不跑批次、不调 LLM；不碰前端目录；不自动 commit / push。

## 4. 必须钉死的风险点（预研 R8 A / B / G）

- **B · 静默行为变化单点**：`resolveAllianceThresholds` 的 `!provided` 早退分支若漏补 `openDepth`，planner 读到 `undefined`，`depth < undefined` 恒 false → 探索分支永不触发；编译不报错、既有断言未必抓到。开工第一步改此文件，并由用例 1 钉死。
- **A · 断言形状一致**：S1 下适配层产出对象与内核种子同为四键；:75-79 断言补一键，:37 / :95 / :107 自动绿。不得放宽既有不等式断言。
- **G · 类型闸门盲区**：`pnpm typecheck` 继承 `tsconfig.build.json` 的 `exclude`（排 `test/**/*` 与 `**/*.spec.ts`），不覆盖新增 spec；闸门必须另跑 `pnpm exec tsc -p tsconfig.json --noEmit`（根 tsconfig include 含 `test/**/*`）。
- **保护项**：`resolveSessionAllianceConfig` 无覆盖时返回 base 同一引用（`i12:38` 断言依赖）；`isRupturedState` 只读两个 resistance 门槛，新字段不进破裂判定。

## 5. 新增 core spec 用例（`test/engine-core/s1-open-depth-threshold.spec.ts`）

1. **缺省回落**：`resolveAllianceThresholds(undefined).openDepth === 0.35`；三键 base（无 openDepth）解析后 `openDepth === 0.35`。直接钉死风险 B。
2. **非法值回落**：`openDepth` 给 `NaN` / `Infinity` / `-0.1` / `1.5` → 一律回落 0.35。
3. **会话级覆盖**：`resolveSessionAllianceConfig(base, { openDepth: 0.2 })` 覆盖生效；缺项回落单例；非法回落种子；无覆盖调用仍返回 base 同一引用。
4. **planner 边界两侧**：`depth` 在 0.35 上下（0.34 / 0.35 / 0.36）策略选择符合预期；同盟门槛不过时，无论 depth 多低都不进探索（AND 关系不被破坏）。
5. **镜像 1:1**：`engine-session.types.ts` 的 `allianceThresholds` 与 `AllianceThresholds` 字段集合一致（新字段镜像侧为可选）。

既有 `wp42-alliance-three-dimensions.spec.ts`、`i12-session-alliance-config.spec.ts` 全绿，断言不放宽；复核其 thresholds 字面量在可选字段下类型兼容。

## 6. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

> 跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；`pnpm doctor:fs` 读税体检。

0. **开工基线**：先跑 `pnpm exec vitest run test/engine-core test/engine-adapters`，记录用例数 / 耗时 / failed；存档 `wp42`、`i12` 用例名清单。

| 闸门            | 命令                                                                    | 判据                                                                    |
| --------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 类型（src）     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                 |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit`                               | 0 error（风险 G，必跑）                                                 |
| Lint            | `pnpm lint`                                                             | 0 error，记 warning 数                                                  |
| 定向测试        | `pnpm exec vitest run test/engine-core test/engine-adapters`            | 全绿；用例数 ≥ 开工基线；无跳过 / 改写                                  |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 全绿；本单不改该文件                                                    |
| 全量            | `pnpm test`                                                             | 全绿，记总数 / skipped / failed / 墙钟 + 机器状态（常驻进程、盘读延迟） |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                               | 仅限 §3.1 的三个 core 文件                                              |
| adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                           | 仅限 `wiring/alliance-config.ts` 一文件                                 |
| 零回归          | `wp42` 缺省逐字护栏（:215 带 / 不带端口 strategy + rationale 逐字相等） | 不跑批次；固定事件序列 diff 可选（产物入 `data/quality/`）              |

## 7. 交付记录与回写

### 7.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-s1-open-depth-threshold-port-implementation-YYYY-MM-DD.md`，含：一句话总结、实际方案 vs 任务单偏差（conventions §2.5）、改动文件清单、闸门表（命令 / exit code / 真实数字）、风险 A / B / G 处理确认、零回归基线对比、遗留项。

### 7.2 交付回写清单

- [x] 交付记录写到 §7.1 路径
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 `phase2.5-p1d-known-issues-2026-11-11.md` I-11 备注：深度门槛已端口化，种子未变，覆盖来源待标定批次
- [x] 结构债草案 §3 I-11 / §4.1 现状列同步
- [x] `phase2.5-wp-list-2026-11-08.md` §四独立单登记状态
- [x] `phase2.5-README.md` §3 当前活清单登记
- [x] `git diff --stat HEAD -- src/engine-core` 与 adapter 变更面符合 §3.1（实测 core 3 文件 / adapter 1 文件）
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

## 附录 · 依赖与边界

- S-1 与模型轨解耦，先行；S-2（neutral 拆分，D-1 → D-2）、S-3（时序权重，D-3，依赖 D-2）在其后，互不改动对方文件。
- 本单不解决 I-11 双门槛叠加的数学不可达；该临床结构复核另案，交付记录须复述此边界，避免误读为"门槛已修好"。
