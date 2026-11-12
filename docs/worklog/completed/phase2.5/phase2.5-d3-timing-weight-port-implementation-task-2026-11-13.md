# D-3 开工单 · 时序权重端口骨架（I-19 / S-3 · 仅 `none` 形态 · 零行为变化）

> 状态：✅ **已交付**（2026-11-13，MiniMax Code）→ [交付记录](phase2.5-d3-timing-weight-port-implementation-2026-11-13.md)（本单已归档至 `docs/worklog/completed/phase2.5/`）
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`，基线 HEAD `960adbc`（D-1 / D-2 / D-3 复核备忘已推送，工作区除 `data/quality/*.diff` 未跟踪诊断产物外干净）。
> 任务性质：时序权重**端口骨架**单。把轮次位置权重的配置形状、模块私有算子与管道接入点留在内核；缺省 `none` 逐字走旧纯累加路径，**零行为变化**。`linear_decay / recency / window` 三种形态的纯函数实现与临床斜率 / 窗口参数留标定批次单。
> 改动范围：core 纯层 2 个既有文件、adapter 1 个既有文件、测试 1 个新增 spec；不碰前端、不接 DB migration、不新增 core 文件或具名导出、不跑批次、不调真模型做离线批量。
> 前置文档：[D-3 复核备忘](../completed/phase2.5/phase2.5-d3-timing-weight-protocol-review-2026-11-13.md)（锚点复核、P1~P5 满足度、口径拍板、基线方案、风险登记）；DOC-2 备忘 B 节（三形态比较与硬伤论证）；结构债草案 §4.3 S-3、§9 D-3 表行。

---

## 例外批准声明

本单**有限授权**改动 `src/engine-core/**`，且仅限以下 2 个**既有**文件、以下改动内容：

| #   | core 文件                                               | 允许的改动                                                                                                                                                                                                                                  | 不允许                                                                                                                                                                             |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/engine-core/cognition/state-transition.ts`         | `TransitionStateOptions` 追加两个可选字段（`timingWeight?` 内联结构类型、`turnIndex?`）；模块私有纯函数 `resolveTimingWeight` 与 `scaleDeltaVector`；`transitionState` / `transitionStateDetailed` 两处管道在 `capTurnDelta` 之后接入折损点 | 不改 `aggregateTurnDelta` 聚合逻辑、`capTurnDelta`、`applyDeltaVector`、`applyBeliefEvolution`、`addDeltaVectors`；不新增具名导出；不新增 `.ts` 文件；不改既有字段与既有 kind 表行 |
| 2   | `src/engine-core/in-memory/in-memory-engine-session.ts` | `InMemoryEngineSessionOptions` 追加 `timingWeightConfig?` 可选字段 + 同名私有字段 + 构造赋值；临时快照路径（`transitionState` 调用）options 内传入 `turnIndex` 与 `timingWeightConfig`                                                      | 不改落库路径的事件 / 剧本合并与统一 cap 逻辑；不改跨轮状态、分类调用、人格调节、同盟、规则表、衰减任何既有逻辑；不新增具名导出                                                     |

adapter 与测试授权见 §3.1。其余 core 文件**一律不动**。`test/engine-core/boundary.spec.ts` 不许改；不新增 core 文件与具名导出（断言⑥⑦ 须保持绿）。除上表外，任何 `src/engine-core/**` 改动在交付时打回。

> 边界断言核对：断言⑥（barrel 导出白名单双向比对）只在新增具名导出时撞红；断言⑦（目录五件套反向检查）只在新增 core `.ts` 文件时撞红；断言⑩（零 `process.env` / `globalThis`）由配置走注入端口保证。本单改动均落在既有文件、既有类型可选字段上，不触发⑥⑦⑩。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md` → `docs/README.md` → `docs/team/conventions.md`（§1.1 分层、§二 交付格式）→ `AGENTS.md`（§5.1 隐私）。
2. D-3 复核备忘全文（§3 锚点、§4 P1~P5、§5 口径拍板、§6 设计草案、§8 基线方案、§10 风险、§11 闸门基线）。
3. D-2 交付记录全文（既有注入端口范式、缺省零回归写法、闸门表格式、遗留清单）。
4. 结构债草案 §4.3（S-3 时序 / 节奏不敏感）、§6 第 5 步（D-3 顺序）、§9 D-3 表行；台账 I-19 节。
5. 本开工单。

---

## 1. 背景与已决项

### 1.1 背景

I-19（结构债 S-3）：状态演化是纯累加，对事件发生在第几轮不敏感——第 1 轮与第 12 轮出现同一事件，聚合贡献相同；早期共情缺席、晚期共情迟到，现有机制表达不了。DOC-2 B 节论证：三种候选形态（轮次衰减 / 近期加权 / 事件时序窗口）都表达不了「缺席」，且都受 cap 裁决顺序与批次可比性约束；有条件可行，硬前置 5 条（P1 不新增导出 / 文件、P2 注入端口、P3 `cold_absent` 先落地、P4 进指纹段、P5 裁决顺序定案）。

D-1（模型轨分类器）、D-2（事件拆分，`cold_absent` 已进 core 联合）已闭环推送；D-3 复核备忘已交付，P1 / P2 / P3 / P4 满足，P5 已定案。本单落地端口骨架。

### 1.2 已拍板（不再复议）

1. **形态范围**：仅 `none` 端口骨架。Options 留 `kind` 联合位与私有纯函数骨架；缺省 `none` 逐字不变；`linear_decay / recency / window` 的纯函数实现、`slope` / `windowTurns` 标定值留标定批次单。
2. **P5 裁决顺序：cap 后折损**。管道顺序：事件聚合 → 人格调节 → `capTurnDelta` → **轮次权重折损** → `applyDeltaVector` → 信念演化。权重作用于 cap 后的最终 delta；cap 尺子不被权重绕过，砍幅判定与旧模型一致。`none` 下 `weight ≡ 1.0`，此顺序不产生分支差异；本节登记的是未来形态口径。
3. **轮次号口径**：会话层传 `runtime.turnIndex + 1`（1 起，与 `MatchContext` 既有口径一致）。
4. **缺省语义**：不传 `timingWeight`（或缺省 `kind: 'none'`）= 内核决策链里没有折损这一步，落库 delta 与改造前**逐字相同**（不是「结果一样」，是「根本没走那条路」）。
5. **env 通道本单不开**：适配层透传链留位，但 `engine.module.ts` 不新增 env 解析；权重配置只能由构造注入。env 覆写通道留标定批次单（同 D-2 L-4 范式）。内核始终零 `process.env`。

### 1.3 工程纪律（D-1 / D-2 已证，延续）

- 一个提交一个意图；分组暂存；不跳 pre-commit 钩子（禁 `--no-verify`）；提交后 `git show --stat` 核对收录文件。
- 后端走 pnpm，禁裸 npx；lint 走 `pnpm lint`；测试 `pnpm test` / `pnpm exec vitest`。
- 既有技术债不在本单清理；新发现问题写进交付记录风险节，不静默改写、不顺手重构相邻旧文件。
- 发现任务单与代码冲突时，写进交付记录风险节，不静默改写。

---

## 2. 已核现状锚点（行号以代码为准，先 grep 符号名定位）

| 锚点                                                 | 文件 · 行号                                                                | 现状事实                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `aggregateTurnDelta(events, alliance?, deltaTable?)` | `state-transition.ts:380`                                                  | 纯累加 `kind × clamp01(strength)`；无轮次号入参；两条 delta 路径都经此函数                               |
| `TransitionStateOptions`                             | `state-transition.ts:585`                                                  | 8 个可选端口，全「缺省 = 逐字不变」范式；已由 `index.ts:172` 导出（扩字段不新增导出）                    |
| `modulateByPersonality`（私有薄封装先例）            | `state-transition.ts:641`                                                  | 模块私有函数先例，不进 `index.ts`；D-3 权重纯函数照此组织                                                |
| `capTurnDelta`                                       | `state-transition.ts:507`                                                  | cap 尺子：一回合最多能动多少                                                                             |
| `transitionState`                                    | `state-transition.ts:930`                                                  | 管道 :931 aggregate → :932 personality → :933 cap → :934 notify → :937 applyDeltaVector → 信念演化       |
| `transitionStateDetailed`                            | `state-transition.ts:948`                                                  | :953–:959 与 :930 同一管道，两处一致                                                                     |
| `InMemoryEngineSessionOptions`                       | `in-memory-engine-session.ts:182`                                          | 可选端口 `capConfig` :208、`allianceConfig` :236、`deltaTableConfig` :245、`sessionDecayConfig` :255     |
| 私有字段 / 构造赋值                                  | `in-memory-engine-session.ts:304–314` / `:327–332`                         | Options 字段 → 私有字段 → 构造赋值同款范式                                                               |
| `runtime.turnIndex`                                  | `in-memory-engine-session.ts:363`（初始 0）/ `:489`（每轮 +1）             | 会话内轮次号，0 起                                                                                       |
| `MatchContext` 口径                                  | `in-memory-engine-session.ts:666 / :721 / :793`                            | `runtime.turnIndex + 1`（1 起）                                                                          |
| 临时快照调用                                         | `in-memory-engine-session.ts:424`                                          | `transitionState(base.snapshot, events, {...})`；本单唯一外部调用点                                      |
| 落库路径                                             | `in-memory-engine-session.ts:447–448`                                      | `totalDelta = eventDelta + trajectory.delta`；`cappedTotal = capTurnDelta(totalDelta, this.capConfig)`   |
| `EngineSessionTuningDeps`                            | `engine.providers.ts:182`                                                  | 适配层调参依赖接口，各配置可选                                                                           |
| `EngineSessionOptions` 反推类型                      | `engine.providers.ts:242`                                                  | `ConstructorParameters<typeof InMemoryEngineSession>[0]`，不新增 core 导出                               |
| `resolveEngineSessionTuningOptions`                  | `engine.providers.ts:256`                                                  | 每个可选项「有才传」三元；缺省返回空对象 → 内核默认值                                                    |
| `createEngineSessionPort`                            | `engine.providers.ts:287`                                                  | 会话工厂，接收 tuning                                                                                    |
| 指纹 `stateTransition` 段                            | `config-fingerprint.ts:50`                                                 | 挂 `state-transition` 文件级哈希；载体在既有文件内自动覆盖，无需扩段映射                                 |
| boundary ⑥ / ⑦ / ⑩ / ⑪                               | `boundary.spec.ts:220 / :249 / :449`；`:454 / :455 / :519`；`:551`；`:562` | 公开面白名单双向匹配；目录清单 + extra 反向检查；零 env / globalThis；adapter 不得深路径 import 内核内部 |

---

## 3. 范围

### 3.1 在范围内

**A. core · `state-transition.ts`**

1. `TransitionStateOptions` 追加两个可选字段（内联结构类型，非具名导出）：

   ```text
   /**
    * 时序权重配置 (D-3; 缺省 = 不折损, delta 逐字不变).
    *
    * 折损发生在 cap 之后 —— cap 是"一回合最多动多少"的最后一道尺子,
    * 权重不得绕过它 (与人格调节同款纪律, 但位置在 cap 之后).
    * 本单仅 `none` 形态落地; 其余形态纯函数实现留标定批次.
    */
   readonly timingWeight?: {
     readonly kind: 'none' | 'linear_decay' | 'recency' | 'window';
     readonly slope?: number;
     readonly windowTurns?: number;
   };
   /** 本轮轮次号 (1 起; 会话层传 runtime.turnIndex + 1). 缺省 = 权重算子取不到位置, 回落等权. */
   readonly turnIndex?: number;
   ```

2. 模块私有纯函数（不进 `index.ts`）：
   - `resolveTimingWeight(config, turnIndex): number` —— 缺省 / `kind === 'none'` / `turnIndex` 缺省 → 返回 `1.0`；非 `none` kind 在本单**回退 `1.0`**（骨架未实现，注释标明实现留标定批次；未实现形态不得改变行为）。
   - `scaleDeltaVector(delta, weight): DeltaVector` —— `weight === 1` 时返回原引用（恒等短路，数值逐字相同；引用同一性不作为 spec 断言）；否则逐维乘 `weight`，返回新向量（不原地改入参）。
3. 两处管道（`transitionState:930`、`transitionStateDetailed:948`）在 `capTurnDelta` 之后接入：

   ```text
   const capped = capTurnDelta(raw, options?.capConfig);
   const delta = scaleDeltaVector(capped, resolveTimingWeight(options?.timingWeight, options?.turnIndex));
   ```

   - cap 报告口径不变：`buildDeltaCapReport(raw, capped, events, options?.capContext)` 仍按 `raw → capped` 砍幅构造（第二参用折损前的 `capped`，不是加权后的 `delta`）；折损在 cap 之后，不改变 cap 报告。
   - 下游 `applyDeltaVector` / 信念演化保持现状。

**B. core · `in-memory-engine-session.ts`**

1. `InMemoryEngineSessionOptions` 追加 `readonly timingWeightConfig?: <同 A.1 内联结构>`；同名私有字段；构造函数赋值（照 :327–332 范式）。
2. 临时快照路径 :424 调用 `transitionState` 时，options 内追加：
   - `turnIndex: runtime.turnIndex + 1`；
   - `timingWeight: this.timingWeightConfig`。
3. 落库路径 :447–:448 **本单不接入折损分支**（见 §6 R2 取舍说明）；接入点在本单登记预留。

**C. adapter · `engine.providers.ts`**

1. `EngineSessionTuningDeps` 追加 `readonly timingWeightConfig?: <同 A.1 内联结构>`。
2. `resolveEngineSessionTuningOptions` 追加对应「有才传」三元（照 :259–:268 范式）。
3. `engine.module.ts` **不改**：本单不新增 `resolveTimingWeightConfig` env 解析；装配项不传 `timingWeightConfig` → 内核走缺省 `none`。

**D. 测试 · 新增 `test/engine-core/d3-timing-weight-port.spec.ts`**

1. 缺省 options → 固定 snapshot + 固定 events 序列的输出与基线逐字相同（快照各维向量 `toEqual`）。
2. 显式 `{ timingWeight: { kind: 'none' } }` → delta 逐字不变。
3. 非 `none` kind（如 `{ kind: 'recency', slope: 0.5 }`）本单回退等权 → delta 与缺省逐字相同（骨架护栏：未实现形态不得改变行为）。
4. 传入 `turnIndex` 不改变 `none` 输出。
5. 多轮会话推进：缺省下 `turnIndex` 递增，快照序列与既有 `engine-core.spec.ts` 多轮断言一致（复用既有基线，不新造跨轮快照）。
6. 既有 `boundary.spec.ts` 12 例保持绿（本单不改该文件；⑥⑦⑩ 未触发由既有断言守护）。

### 3.2 明确不在范围内

- 不实现 `linear_decay / recency / window` 任何一种形态的权重曲线；不填 `slope` / `windowTurns` 临床标定值。
- 不新增 env 键；不改 `engine.module.ts` 装配；不接 DB migration；不跑批次；不调真模型做离线批量；不做吞吐 / 429 实测。
- 不改 `SessionEvent` 形状（不加位置 / 轮次字段）；不改 `event-lexicon.ts` 规则轨词表；不改 `DELTA_TABLE`；不改审计实体 JSON 列结构。
- 不新增 core `.ts` 文件、不新增具名导出；不改 `boundary.spec.ts`。
- 不碰前端；不清理 D-2 遗留 L-1～L-10；不复议 D-4 cold 模式先验（DOC-2 不建议单独实施）。
- 落库路径折损算子复用、非 `none` 形态落地，归标定批次单（届时若需跨文件复用纯函数，走 D-6 白名单授权：独立 cognition 文件 + 导出）。

---

## 4. 契约与类型形状

### 4.1 配置类型（内联，非具名导出）

- 权重配置形状见 §3.1 A.1；`slope` / `windowTurns` 为可选数值，本单不消费（骨架留位）。
- 类型经 `TransitionStateOptions`（已导出）与 `InMemoryEngineSessionOptions`（已导出）承载；adapter 经 `ConstructorParameters<...>[0]` 反推类型即可传值，无需 import 新具名类型（断言⑪ 合规）。

### 4.2 算子纯函数契约

- `resolveTimingWeight`：纯函数，无 env、无全局对象、无随机数、无时钟；输入相同 → 输出相同。
- `scaleDeltaVector`：纯函数；`weight === 1` 返回原引用（恒等短路，数值与入参逐字相同；引用同一性不作为 spec 断言，既有 `toEqual` 数值比较即可）；其余情况返回新向量（不原地改入参）。
- 权重取值域：本单只返回 `1.0`；标定批次落地形态时再约束 `[0, 1]` 区间与边界。

### 4.3 两条路径口径

- **临时快照路径**（:424 → `transitionState`）：本单接入折损点，cap 后折损。
- **落库路径**（:447–:448）：本单不接入；`none` 恒等下接入与否逐字不变，两路径口径一致（见 §6 R2）。
- 轮次号：两条路径同一口径 `runtime.turnIndex + 1`；落库路径预留时沿用此口径。

### 4.4 缺省语义与隐私口径

- 不传 `timingWeight` → 不构造权重配置、不调用折损分支；落库 delta 与改造前逐字相同。
- 权重配置是部署形态决定（构造注入），不是会话参数；一场会话内口径恒定（同 cap / 人格 / 同盟范式）。
- 观测 / 日志不得含来访原话、prompt 全文、`kernelState`、展示名；权重算子不产出事件级观测。

---

## 5. 并发、中断与回落纪律

- 权重算子无状态、无共享可变量；会话实例间配置隔离（构造注入，换配置 = 换实例）。
- 回落链：配置缺省 → `none` → `1.0`；非 `none` 未实现形态 → 回退 `1.0`；`turnIndex` 缺省 → 回落等权。任何分支都不抛错到主流程。
- 算子失败（标定批次落地后）不得阻断状态迁移；本单骨架无外部依赖，不存在失败分支。

---

## 6. 风险点登记（本单相关）

| #   | 风险                                                               | 级别                 | 缓解 / 处置                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 状态可复现性契约、落库快照、轨迹回放受影响                         | 高                   | 缺省 `none` 逐字走旧路径；§3.1 D.1/D.2 基线快照护栏；不传端口即回退；交付记录附缺省下快照逐字不变证据                                                                                               |
| R2  | 落库路径未接入折损点，与临时快照路径在未来非 `none` 形态下口径漂移 | 中（本单无行为影响） | 本单 `none` 恒等，两路径一致；接入点与口径（cap 后、`turnIndex + 1`）在备忘 §6.3 与本单 §4.3 登记；标定批次落地非 `none` 时，须在两条路径接入同一算子（复用方式走 D-6 授权），并补两路径一致性 spec |
| R3  | cap 前缩放翻转砍幅结论                                             | 中                   | 本单定 cap 后折损（§1.2-2）；权重不进 cap 判定；管道顺序由 spec 与代码注释固定                                                                                                                      |
| R4  | 既有批次轨迹可比性（加权改变早期 / 晚期 delta）                    | 中                   | `none` 缺省不触发；非 `none` 上线前须全量批次重跑并比对 `stateTransition` 指纹段；本单不启用任何非等权行为                                                                                          |
| R5  | 新增导出 / 文件撞 boundary ⑥⑦                                      | 中                   | 纯函数模块私有；类型内联；`index.ts` 公开面零变化；既有 12 例 boundary spec 守护                                                                                                                    |
| R6  | 非 `none` 形态临床方向未标定                                       | 中                   | 纯函数实现与参数留标定批次；本单联合位留空、不填种子斜率；交付记录风险节显式登记                                                                                                                    |

---

## 7. 闸门（执行方跑，填真实数字；pnpm，禁裸 npx）

跑前：PATH 补 `D:\Apps\Git\cmd`（避免 vitest 调 git ENOENT 假失败）；确认无 `nest start --watch` / `vite dev` 常驻；记录机器状态（CPU / 内存 / Node 版本 / 常驻进程 / 盘读延迟）。

基线（2026-11-12，D-2 交付实测；类型债 401 条 / 87 文件基线 HEAD `2bf32f0`）：定向 `test/quality test/engine-core test/engine-adapters` = 101 文件 / 1866 例；全量 3201 passed + 4 skipped（3205 例 / 192 文件），Duration 81.10s / 墙钟 83.33s；lint 0 error / 0 warning；boundary 12 例全绿。机器：Node v26.13.0 / pnpm 9.15.0 / 8 核 / 无 watch 常驻。

| 闸门            | 命令                                                                      | 判据                                                                            |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 类型（build）   | `pnpm exec tsc -p tsconfig.build.json --noEmit`                           | 0 error                                                                         |
| 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 本单相关文件 0 error；既有类型债 401 条 / 87 文件不新增（stash 差分法对照基线） |
| Lint            | `pnpm lint`                                                               | 0 error，记 warning 数                                                          |
| 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 12 例全绿；本单不改该文件                                                       |
| 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 全绿；用例数 ≥ 101 文件 / 1866 例，零丢失 / 零改写（新增 spec 用例单列）        |
| 全量            | `pnpm test`                                                               | 全绿，记总数 / skipped / failed / 墙钟 + 机器状态                               |
| core 变更面     | `git diff --stat HEAD -- src/engine-core`                                 | 恰好 §例外声明表 2 个既有文件；多出任何一行即打回；无新增 core 文件 / 具名导出  |
| adapter 变更面  | `git diff --stat HEAD -- src/engine-adapters`                             | 只含 `engine.providers.ts`；`engine.module.ts` 为空                             |
| 前端变更面      | `git diff --stat HEAD -- src/admin-dashboard`                             | 为空                                                                            |
| 隐私自检        | 新增 spec / 算子注释人工过一遍                                            | 无原话、无 prompt 全文、无 `kernelState`、无展示名                              |

---

## 8. 交付记录与回写

### 8.1 交付记录路径

`docs/worklog/completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-YYYY-MM-DD.md`，含：一句话总结；实际方案 vs 任务单偏差（conventions §2.5）；改动文件清单（core / adapter / 测试分组）；闸门表（命令 / exit code / 真实数字 / 机器状态）；§6 风险逐条处置确认；缺省零回归证据（固定序列快照向量逐字相同）；非 `none` 形态回退等权证据；遗留项（三种形态纯函数、`slope` / `windowTurns` 标定、env 通道、落库路径折损接入）。

### 8.2 交付回写清单

- [x] 交付记录写到 §8.1 路径 → `completed/phase2.5/phase2.5-d3-timing-weight-port-implementation-2026-11-13.md`
- [x] 本任务单移入 `completed/phase2.5/`，状态行改完成标记并链接交付记录
- [x] 台账 I-19 行备注：时序权重端口骨架已落地（仅 `none`，零行为变化）；非 `none` 形态与标定参数留标定批次
- [x] 结构债草案 §4.3 S-3 进度列、§9 D-3 表行同步
- [x] 活清单 `phase2.5-README.md` 登记（`phase2.5-wp-list-2026-11-08.md` 为冻结快照，不回写）
- [x] `git diff --stat HEAD -- src/engine-core` 与 `src/engine-adapters` 实测记录进交付记录
- [x] 提交分组隔离：本单文件不混入并行产物；给一行 commit message 草稿，不自行 commit / push

---

## 附录 · D-3 边界与遗留

**本单遗留到标定批次单**：

- `linear_decay / recency / window` 纯函数实现；`slope` / `windowTurns` 标定值；权重取值域约束。
- 权重 env 覆写通道（适配层 `resolveTimingWeightConfig` 接 env，参照 D-2 L-4）。
- 落库路径折损点接入与两路径同算子复用（若需跨文件复用，走 D-6 白名单授权：独立 cognition 文件 + 导出）。
- 非 `none` 形态上线前的全量批次重跑与指纹段比对。

**本单不涉及（既有债另案）**：

- D-2 遗留 L-1～L-10（临床 delta 幅度 / 缺席阈值 / `POSITIVE_EVENTS` 归属 / env 通道 / `llm_active` 生效轨 / 词表在场标记 / 前端看板映射 / `hasNonNeutralEvent` 语义 / cold 先验）。
- D-4 cold 模式先验：DOC-2 不建议单独实施，不复议。
