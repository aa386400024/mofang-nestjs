# D-3 · I-19 / S-3 时序权重端口 · 开工前协议复核备忘（纯文档，零代码改动）

> **状态**：已交付（待开工单引用） · **日期**：2026-11-13 · **分支**：integrate · **基线 HEAD**：`3dbc237`（D-2 三组提交：`e422264` feat / `a3e953c` docs / `3dbc237` style；本地与远端一致）
> **执行方**：主会话复核（Doubao） · **任务性质**：只读协议复核 / 设计文档 · **代码改动**：**零**（`src/` 与 `admin-dashboard/` 均未改）
> **口径真相源**：状态迁移 = `src/engine-core/cognition/state-transition.ts`；会话层 = `src/engine-core/in-memory/in-memory-engine-session.ts`；事件模型 = `src/engine-core/domain/events/session-event.ts`；本备忘**不另造事件枚举、不另抄 delta 数值**。
> **关联文档**：DOC-2 备忘 B 节（I-19 可行性评估，2026-11-11）；结构债草案 §4.3 S-3（2026-11-12）；D-2 交付记录（2026-11-12）。

---

## 一、一句话总结

D-2 落地后复核：D-3（时序权重端口）的 **P1 / P2 / P3 / P4 前置均已满足**，P5（权重与 cap 裁决顺序）已于 2026-11-13 拍板为 **cap 后折损**。本单范围收敛为 **仅 `none` 端口骨架**：扩已导出的 `TransitionStateOptions` 可选字段 + 既有文件内模块私有纯函数，缺省 `none` 逐字走旧路径、零行为变化；三种非 `none` 形态的纯函数实现与临床参数留标定批次单。可据此起草 D-3 实现开工单。

---

## 二、前置链与本备忘定位

- **编号链**：D-1 模型轨分类器（已闭环推送 `46fa8c3` / `2bf32f0`）→ D-2 事件拆分（已闭环推送 `e422264` / `a3e953c` / `3dbc237`）→ **D-3 时序权重端口（本备忘）** → D-4 cold 先验（DOC-2 不建议单独实施，不复议）。
- **问题定位**：I-19（结构债 S-3）——状态 delta 对轮次位置不敏感：第 1 轮与第 12 轮出现同一事件，聚合贡献相同；早期共情缺席、晚期共情迟到，现有机制都表达不了。
- **DOC-2 B 节遗留**：该备忘写于 D-2 落地之前，当时 P3（`cold_absent` 已落地）未满足，P5 顺序与形态范围留空。本备忘基于 D-2 后现状重做锚点复核，并固化三项口径；**不重复** DOC-2 B.3 已完成的三形态比较与硬伤论证。
- **本备忘不实施代码**：仅复核锚点、登记口径、列改动面与基线方案；D-3 实现开工单在本备忘验收通过后另行起草。

---

## 三、现状锚点复核（HEAD `3dbc237`，行号以现状为准）

### 3.1 core · 状态迁移 `state-transition.ts`

| 锚点                                                 | 行号 | 现状事实                                                                                                                                            |
| ---------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aggregateTurnDelta(events, alliance?, deltaTable?)` | :380 | 纯累加 `kind × clamp01(strength)`；**无轮次号入参**；两条 delta 路径都经此函数                                                                      |
| `TransitionStateOptions`                             | :585 | 8 个可选端口：`capConfig / capContext / observer / personality / alliance / deltaTable / counselorText / beliefConfig`，全为「缺省 = 逐字不变」范式 |
| 人格调节位置注释                                     | :600 | 聚合之后、cap 之前（WP34 口径）                                                                                                                     |
| `capTurnDelta`                                       | :507 | cap 尺子：一回合最多能动多少，与 delta 来源无关                                                                                                     |
| `modulateByPersonality`                              | :641 | 模块私有纯函数先例（不进 `index.ts`）；D-3 权重纯函数照此组织                                                                                       |
| `transitionState`                                    | :930 | 管道：aggregate → modulateByPersonality → capTurnDelta → notifyDeltaCap → applyDeltaVector → applyBeliefEvolution                                   |
| `transitionStateDetailed`                            | :948 | 与 :930 同一管道，两处一致                                                                                                                          |

### 3.2 core · 会话层 `in-memory-engine-session.ts`

| 锚点                           | 行号                      | 现状事实                                                                                                                                               |
| ------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InMemoryEngineSessionOptions` | :182                      | 会话构造选项；可选端口 `capConfig` :208、`allianceConfig` :236、`deltaTableConfig` :245、`sessionDecayConfig` :255；私有字段 :304 / :310 / :312 / :314 |
| `runtime.turnIndex`            | :363 初始 0；:489 每轮 +1 | 会话内轮次号，0 起                                                                                                                                     |
| `MatchContext` 轨迹口径        | :666 / :721 / :793        | `runtime.turnIndex + 1`（1 起）；D-3 权重轮次号沿用此口径                                                                                              |
| 落库前事件 delta               | :421                      | `eventDelta = modulateDeltaByPersonality(aggregateTurnDelta(...), personality)`（落库路径）                                                            |
| 临时快照调用                   | :424                      | `transitionState(base.snapshot, events, {...})`（provisional 路径，供意图规划与轨迹触发判定）                                                          |
| 剧本 delta 合并                | :447                      | `totalDelta = eventDelta + trajectory.delta`                                                                                                           |
| 落库统一 cap                   | :448                      | `cappedTotal = capTurnDelta(totalDelta, this.capConfig)`                                                                                               |

> **两条路径一致性**：落库路径（:421）与临时快照（:424 → :931）都经 `aggregateTurnDelta`。权重折损落在 cap 之后的两条路径接入点上（见 §6），可保证临时快照与落库快照口径一致——与 WP42 / WP60 既有纪律相同。

### 3.3 core · 事件模型 `session-event.ts`

- `CounselorEventKind` 13 类联合 :22–37，含 `holding_present` :35、`cold_absent` :37（D-2 已落地）。
- `SessionEvent` :40 = `kind` :41 / `matchedTerms` :43 / `strength` :45（+ 可选 `sensitiveTopics` :58、`sessionId` :60）；**无位置 / 轮次字段**。
- 结论：时序权重的轮次号由会话层传入，**不改事件形状**（符合 P1）。

### 3.4 adapter 透传链

| 锚点                                | 行号                      | 现状事实                                                                                                                             |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `EngineSessionTuningDeps`           | `engine.providers.ts:182` | 适配层调参依赖接口，各配置可选                                                                                                       |
| `EngineSessionOptions` 反推类型     | :242                      | `ConstructorParameters<typeof InMemoryEngineSession>[0]`，**不新增 core 导出**                                                       |
| `resolveEngineSessionTuningOptions` | :256                      | 每个可选项「有才传」三元；缺省返回空对象 → 内核走默认值（逐字零回归）                                                                |
| `createEngineSessionPort`           | :287                      | 会话工厂，接收 tuning                                                                                                                |
| 装配段                              | `engine.module.ts:404`    | `createEngineSessionPort(..., { capConfig: resolveDeltaCapConfig(config), ... })`；env 由适配层读，内核零 `process.env`（:408–:425） |

### 3.5 配置指纹 `config-fingerprint.ts`

- `ConfigSegment` :30；`stateTransition` 段文件映射 :50 = `['../engine-core/cognition/state-transition']`（文件级哈希）。
- `hashSegment` :84；`compareFingerprints` :159。
- 指纹口径：全部用 **dist 文件级哈希**（:17）；同文件内非配置改动也会改变该段（保守方向，宁可多报）。
- 结论：权重载体落在既有 core 文件 `state-transition.ts` 内即自动被 `stateTransition` 段覆盖，**无需扩段映射**。env 覆写值不进文件哈希，与 cap / 同盟 / 规则表 / 衰减既有范式一致。

### 3.6 boundary 护栏 `test/engine-core/boundary.spec.ts`

| 断言                                     | 行号                                         | 机制                      | D-3 约束                                                                  |
| ---------------------------------------- | -------------------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| ⑥ index.ts 公开面双向白名单              | :220 / `expectedPublic` :249 / 双向匹配 :449 | 导出名必须双向匹配        | 不新增具名导出；权重配置用 `TransitionStateOptions` 扩字段 + 内联结构类型 |
| ⑦ 目录结构 + 反向检查                    | :454 / `expected` :455 / extra 断言 :519     | 内核树不得出现未登记文件  | 不新增 core `.ts` 文件；权重纯函数放进既有文件                            |
| ⑩ 内核零 `process.env` / 零 `globalThis` | :551                                         | 全内核文件扫描            | 权重配置走注入端口；env 读取留在适配层                                    |
| ⑪ adapter 不得深路径 import 内核内部     | :562                                         | 仅 barrel 或 `in-memory/` | 内联结构类型让 adapter 无需 import 具名类型即可传值                       |

---

## 四、P1~P5 满足度复核表

| 前置 | DOC-2 要求                                  | D-2 后现状证据                                                             | 结论               |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| P1   | 不新增内核公开导出名、不新增内核 `.ts` 文件 | 扩 `TransitionStateOptions` 可选字段 + 同文件模块私有纯函数；⑥⑦ 白名单不动 | 设计空间存在，满足 |
| P2   | 权重配置走注入端口、内核零 env              | cap / 人格 / 同盟 / 规则表 / 衰减五条同款注入链齐备（§3.4）；⑩ 护栏在案    | 满足               |
| P3   | `cold_absent` 先落地                        | D-2 已推送（13 类联合 + 种子 ZERO，`session-event.ts:37`）                 | 满足               |
| P4   | 权重配置进指纹 `stateTransition` 段         | 段挂 `state-transition` 文件哈希（§3.5）；载体在既有文件内自动覆盖         | 满足               |
| P5   | 权重与 cap 裁决顺序定案                     | 2026-11-13 拍板：**cap 后折损**（§5.2）                                    | 口径已定           |

---

## 五、本单口径拍板（2026-11-13 用户确认「按推荐走」）

### 5.1 形态范围：仅 `none` 端口骨架

- Options 留 `kind` 联合位与模块私有纯函数骨架；缺省 `none` 逐字走旧路径。
- `linear_decay / recency / window` 三种形态的纯函数实现、`slope` 与 `windowTurns` 标定值，**留标定批次单**（与 D-2 种子 ZERO 范式一致：首单交付契约 / 端口 / 护栏测试，零行为变化）。
- 本单不落地任何非 `none` 的实际折损行为。

### 5.2 P5 裁决顺序：cap 后折损

- 顺序：事件聚合 → 人格调节 → `capTurnDelta` → **轮次权重折损** → `applyDeltaVector` → 信念演化。
- 权重作用于 **cap 后的最终 delta**：`cappedDelta × weight(turnIndex)`。
- 理由：cap 这把「一回合最多动多少」的尺子不被权重绕过，砍幅判定与旧模型一致；权重语义为事后折损，不减少早期 / 晚期被 cap 砍掉的事件。
- `none` 形态下 `weight ≡ 1.0`，此顺序不产生分支差异；本节登记的是未来形态的默认口径。
- 明确不采用：cap 前聚合后缩放、cap 前事件级缩放。DOC-2 B.3 已论证：cap 前缩放会让「同一事件第 2 轮与第 12 轮是否撞 cap」的结论翻转，影响既有批次轨迹可比性。

### 5.3 缺省语义与灰度纪律

- 不传 `timingWeight`（或缺省 `kind: 'none'`）= 内核决策链里没有折损这一步，落库 delta 与改造前**逐字相同**（不是「结果一样」，是「根本没走那条路」）。
- 新算子缺省关闭；灰度期不默认启用；不注入即回退旧路径。
- 权重轮次号口径：会话层传 `runtime.turnIndex + 1`（1 起，同 `MatchContext:793`）。

### 5.4 env 覆写通道：本单不开

- 与 D-2 L-4 同款：本单不新增 env 键；适配层 `resolveTimingWeightConfig` 是否留位，由实现开工单按既有 `resolve*Config` 范式决定，但**默认不接 env 覆写**。
- env 覆写通道留标定批次单；内核始终零 `process.env`（⑩ 护栏）。

---

## 六、内核纯端口设计草案（只画不实现，P1 合规）

> 以下类型签名与函数组织为开工单设计依据；本备忘不写实现代码。

**6.1 Options 扩字段**（`state-transition.ts` 的 `TransitionStateOptions`，内联结构类型，非具名导出）：

```text
timingWeight?: {
  readonly kind: 'none' | 'linear_decay' | 'recency' | 'window';
  readonly slope?: number;
  readonly windowTurns?: number;
}
```

**6.2 模块私有纯函数**（`state-transition.ts` 内，不进 `index.ts`，先例 `modulateByPersonality:641`）：

- `resolveTimingWeight(kind, turnIndex, options): number` —— `none` 返回 `1.0`；其余形态本单返回骨架占位（实现留标定批次）。
- 折损为纯计算，不读 env、不摸全局对象、无第三方依赖。

**6.3 两条路径接入点**（均在 cap 之后）：

1. 临时快照路径：`transitionState` / `transitionStateDetailed` 内部，`capTurnDelta` 之后、`applyDeltaVector` 之前折损。
2. 落库路径：会话层 `cappedTotal`（:448）之后折损，再进 `applyDeltaVector`。
3. 轮次号由会话层以 `runtime.turnIndex + 1` 传入；两条路径同一配置、同一口径。

**6.4 adapter 透传**（沿用 §3.4 既有链）：

- `EngineSessionTuningDeps` 加 `timingWeight?`；`resolveEngineSessionTuningOptions` 加对应三元；`engine.module.ts` 装配段接 `resolveTimingWeightConfig(config)`（适配层读 env，内核只认端口）。

---

## 七、改动面清单与不动边界

### 7.1 实现单拟改动面（备忘登记，开工单授权后实施）

| 层      | 文件                                    | 拟改动                                                                                      |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| core    | `cognition/state-transition.ts`         | Options 扩 `timingWeight?`；私有 `resolveTimingWeight`；两处管道 cap 后接入折损；轮次号透传 |
| core    | `in-memory/in-memory-engine-session.ts` | Options 字段接收；落库路径 cap 后接入折损；`turnIndex + 1` 传入                             |
| adapter | `wiring/engine.providers.ts`            | Deps 加可选字段；resolve 三元透传                                                           |
| adapter | `wiring/engine.module.ts`               | 装配段接配置解析（env 读取留在适配层）                                                      |
| test    | 新增 D-3 spec                           | `none` 缺省逐字不变（固定 seed + 序列快照基线）；Options 类型；两条路径口径一致             |

### 7.2 不动边界

- `test/engine-core/boundary.spec.ts` **不改**（⑥⑦⑩ 维持）；不新增 core 文件 / 具名导出。
- `SessionEvent` 形状不加位置字段；`event-lexicon.ts` 规则轨词表不动。
- `DELTA_TABLE` 不加新行——时序权重不是事件 delta，不进规则表。
- 不碰 DB schema、prompt 模板、前端看板；不清理 D-2 遗留 L-1～L-10。
- 指纹段映射不扩（§3.5 自动覆盖）。

---

## 八、旧模型逐字复现基线方案

> 结构债草案 §4.3 要求：先产出旧模型逐字可复现基线（固定事件序列 → 快照序列）。以下为实现单内护栏方案，本备忘不落地 harness。

1. **固定 harness**：固定 `seed`（参照既有 spec 用 `seed: 7`）+ 固定规则轨事件序列，离线推进 N 轮；不依赖 LLM，保证可复现。序列覆盖：中性 / 正向 / 负向事件、跨轮 `turnIndex` 递增、同盟三维（trust / safety / bond）。
2. **基线表**：逐轮记录快照各维向量（trust / safety / bond、resistance 三维、coreBeliefs 等）作为旧模型基线。
3. **零回归断言**：接入 `timingWeight` 端口后，缺省（不传端口）复跑同一序列，快照向量逐字 `toEqual` 基线；既有零回归范式参照 `i12-session-alliance-config.spec.ts`（无覆盖逐字返回）与 `i20-valence-arousal-role-coefficients.spec.ts`（种子全 1.0 逐字相同）。
4. **确定性前提**：同 seed + 同配置 + 同事件序列 → 同序列逐字同输出（§3.4 :409 既有口径）；harness 不得引入时钟、随机数或网络依赖。

---

## 九、boundary 契约逐条影响复核

沿用 DOC-2 B.2 表，结合 HEAD `3dbc237` 现状复核：

| #   | 断言                                   | 是否受影响 | 复核结论                                                  |
| --- | -------------------------------------- | ---------- | --------------------------------------------------------- |
| ①   | 零 `@nestjs/*` import                  | 不受影响   | 权重是纯计算                                              |
| ②   | 零 typeorm import                      | 不受影响   | —                                                         |
| ③   | 零逃出 engine-core 的相对 import       | 不受影响   | 新代码放在既有文件内                                      |
| ④   | 外部依赖白名单 = { nanoid } + `node:*` | 不受影响   | 权重不需要新依赖                                          |
| ⑤   | 零 NestJS 装饰器                       | 不受影响   | —                                                         |
| ⑥   | index.ts 公开面双向白名单              | 约束项     | 不新增导出名；扩 `TransitionStateOptions` 字段 + 内联类型 |
| ⑦   | 目录结构（含反向检查）                 | 约束项     | 不新增 core `.ts` 文件；纯函数进既有文件                  |
| ⑧   | 内核根目录无散落文件                   | 不受影响   | 放 `cognition/` 下既有文件                                |
| ⑨   | B 层实现在内核包之外                   | 不受影响   | —                                                         |
| ⑩   | 零 `process.env` / 零 `globalThis`     | 不受影响   | 权重走注入端口，env 读取在适配层                          |
| ⑪   | adapter 不得深路径 import 内核内部     | 间接约束   | 内联结构类型；adapter 无需 import 新具名类型              |

---

## 十、风险与回归策略

| 风险                                            | 级别                 | 隔离 / 缓解                                                             |
| ----------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| 状态可复现性契约、落库快照、轨迹回放受影响      | 高（草案 §4.3 标注） | 缺省 `none` 逐字走旧路径；§8 固定基线 harness 护栏；不传端口即回退      |
| cap 前缩放翻转砍幅结论                          | 中                   | 本单定 cap 后折损（§5.2），权重不进 cap 判定                            |
| 既有批次轨迹不可比（加权改变早期 / 晚期 delta） | 中                   | `none` 缺省不触发；非 `none` 形态上线前须全量批次重跑并比对指纹段       |
| 时序权重表达不了「缺席」                        | 已知硬伤             | DOC-2 B.3 共同硬伤；缺席语义归 D-4 cold 先验另案，本单不补              |
| 非 `none` 形态临床方向未标定                    | 中                   | 纯函数实现与 `slope` / `windowTurns` 参数留标定批次单；本单不填临床数值 |

**回退策略**：移除 `timingWeight` 注入即回到旧路径；代码层无 env 默认开启；spec 基线复跑为最终回归判据。

---

## 十一、闸门基线（D-2 交付记录实测，D-3 开工单引用）

> 来源：`phase2.5-d2-event-kind-split-implementation-2026-11-12.md` §4。机器状态：Node v26.13.0 / pnpm 9.15.0 / 8 核 / 无 watch 常驻；PowerShell 5.1；PATH 补 `D:\Apps\Git\cmd`；命令均走 `pnpm` / `pnpm exec`，未用裸 npx。

| 闸门                  | 命令                                                                      | exit | D-2 交付态实测                                                                                     |
| --------------------- | ------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| GATE2 类型（含 spec） | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`   | 0    | `TOTAL_ERRORS=401` / `AFFECTED_FILES=87`，与 HEAD `2bf32f0` 实测基线逐字一致，本单相关文件 0 error |
| GATE3 Lint            | `pnpm lint`                                                               | 0    | 0 error / 0 warning                                                                                |
| GATE4 边界护栏        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                  | 0    | 12 例全绿                                                                                          |
| GATE5 定向测试        | `pnpm exec vitest run test/quality test/engine-core test/engine-adapters` | 0    | 101 文件 / 1866 例全绿，Duration 27.92s                                                            |
| GATE6 全量            | `pnpm test`                                                               | 0    | 3201 passed + 4 skipped（3205 例，192 文件），Duration 81.10s / 墙钟 83.33s                        |

D-3 开工单要求：类型债基线在提交时用 stash 差分法重测，与 401 条 / 87 文件对照；既有债与本单新增改动分开记录；GATE4 断言⑥⑦ 不得被触发。

---

## 十二、遗留项与后续任务单建议

| 编号            | 条目                                                                         | 归属                         |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| L-D3-1          | `linear_decay / recency / window` 纯函数实现、`slope` / `windowTurns` 标定值 | 标定批次单                   |
| L-D3-2          | 权重 env 覆写通道（适配层 `resolveTimingWeightConfig` 接 env）               | 标定批次单（参照 D-2 L-4）   |
| L-D3-3          | 非 `none` 形态上线前的全量批次重跑与指纹段比对                               | 形态上线单前置               |
| L-5（D-2 遗留） | `llm_active` 生效轨接线                                                      | 独立单，不在 D-3 范围        |
| D-4             | cold 模式先验                                                                | DOC-2 不建议单独实施，不复议 |

---

## 十三、commit message 草稿（**不自动提交**）

```text
docs(phase2.5): D-3 I-19/S-3 时序权重端口开工前协议复核备忘（纯文档，锚点复核 + 口径固化）
```

> 本备忘为纯文档交付；提交分组、钩子纪律与推送由后续交付流程按 `delivery-gating-commits` 规范执行，push 由用户决定。
