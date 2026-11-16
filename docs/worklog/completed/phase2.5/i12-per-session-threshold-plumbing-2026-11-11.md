# I-12 · per-session 同盟门槛注入链路打通（交付记录）

> 状态：✅ 已交付（2026-11-11）
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 任务单：[`phase2.5-i12-per-session-threshold-plumbing-2026-11-11.md`](phase2.5-i12-per-session-threshold-plumbing-2026-11-11.md)
> 事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-12（P1 · per-session 阈值注入）

---

## 1. 一句话总结

打通了「会话级同盟门槛覆盖」的注入缝：新增 `SessionAllianceThresholdResolver` 解析端口 + 内核纯函数 `resolveSessionAllianceConfig` + `OpenEngineSessionInput.allianceThresholds` 字段，缺省装配**永远无覆盖** → 门槛逐字回落到模块 env 单例，**零行为变化、零数值改动**；真实来源（按角色档案自动算门槛）留待后续标定批次接一个 provider 即可，四个会话创建入口零改动。

## 2. 审计结论（任务单 §2.1 要求：先画清完整路径）

### 2.1 门槛配置的真实路径

```
engine.module.ts provider 工厂
  └─ resolveAllianceConfig(config)            ← 模块 env 单例，进程内一份
      └─ engine.providers.ts 装配引擎会话选项   （engine.providers.ts:181-263）
          └─ InMemoryEngineSession.allianceConfig  （构造注入，:228 / :302 / :322）
              └─ 消费点 3 处：
                  · aggregateTurnDelta(events, this.allianceConfig, ...)   （:401）
                  · transitionState({ alliance: this.allianceConfig })      （:407）
                  · planIntention(provisional, profile, this.allianceConfig)（:416）
```

### 2.2 实例级单例堵在哪一层

堵在 **`InMemoryEngineSession` 的构造注入**这一层：`allianceConfig` 是 `this.` 上的字段，与会话（handle）无关。因此**同一进程实例内所有会话 / 所有角色共用同一份门槛**——四条会话创建入口（语音对练 / 自动对练 / 调试面板 / engine 调试端点）全部共用这一个会话端口 provider。

### 2.3 per-handle 与 per-session 的口径区别（本单必须讲清）

| 口径                               | 生命周期                         | 本单位置                                                                          |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| **per-instance**（改造前唯一口径） | 进程级；装配期读 env 组装一次    | `InMemoryEngineSession.allianceConfig`（构造注入）                                |
| **per-handle**                     | 一条会话句柄内**恒定**，不逐轮变 | **本单新增**：`EngineSessionRuntime.allianceConfig`，开场解析一次后固定在该句柄上 |
| **per-turn**                       | 每轮可变                         | **本单不做**（不在任务单范围，且会与内核「一场一值」语义冲突）                    |

**关键取舍**：`in-memory-engine-session.ts:224-226` 的既有注释顾虑的是「同一场内部前后两轮门槛不一样」——本单**不引入逐轮可变**语义，覆盖只在**开场**解析一次并固定在句柄上，与实例级配置同为「一场一值」。这样会话内前后两轮的门槛口径仍完全一致（原注释的顾虑不成立）。

### 2.4 实际方案 vs 任务单方案（偏差说明）

任务单 §2.2 给的是**二选一**（「若缺口只在适配层 … 若内核侧必须新增纯类型 / 纯解析函数」）。实际审计结论是：**两侧都要动，且分工明确**——

| 层                               | 承担什么                                                                                                                                                                               | 为什么必须在这一层                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 适配层 `engine-adapters/wiring/` | ① 定义解析端口 `SessionAllianceThresholdResolver`；② 在 `EngineTurnService.open` 里解析并**原样转发**；③ 装配缺省 provider                                                             | 端口是**装配期概念**（谁提供覆盖来源），内核零 Nest / 零 IO                                                                                                                                                                                       |
| 内核 `engine-core/cognition/`    | ① `resolveSessionAllianceConfig`（合并 + 回落裁决）；② `OpenEngineSessionInput.allianceThresholds`（会话级覆盖的承载字段）；③ `EngineSessionRuntime.allianceConfig`（per-handle 固定） | ① 覆盖必须**被内核消费**（消费点在 `aggregateTurnDelta` / `transitionState` / `planIntention`，全在内核）；② 门槛**校验的唯一真相源**是内核 `resolveAllianceThresholds`——适配层若自己再校验一遍就是第二套判定，迟早对不上（仓库「反双胞胎」纪律） |

**明确的偏差**：任务单 §2.4 原文「适配层 spec 覆盖『会话覆盖优先 → 缺项回落单例 → 非法值回落种子』三条；内核纯函数测试覆盖新增解析（若有）」。实际把**三条回落规则的断言放在内核 spec**，适配层 spec 只断言「转发 / 异常 / 缺省」——理由同上：规则由内核唯一校验口裁决，在适配层复制一份断言等于把第二套真相源写进测试。**测试覆盖总量不减少**（16 例）。

### 2.5 为什么走端口而不是让四个会话创建入口各改一遍

会话创建有**四处**入口（voice / auto-practice / 调试面板 ×2 / engine 调试端点）。若走「入参传参」，后续标定批次接真实来源时要改四处。走**端口 + DI token**：后续只换**一个 provider**，四个入口零改动。缺省 provider 永远返回无覆盖，因此**本单交付时四个入口的实际行为逐字不变**。

## 3. 改动文件清单

### 3.1 内核（3 个文件 · **属 §4 例外批准范围**，逐条说明见 §6）

| 文件                                                    | 改了什么                                                                                                                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-core/cognition/alliance-config.ts`          | 新增**模块级导出** `resolveSessionAllianceConfig(base?, override?)`：无覆盖 → **原样返回 base（同一引用）**；有覆盖 → 缺项回落单例 → 非法值回落种子，复用既有 `resolveAllianceThresholds` 唯一校验口                                   |
| `src/engine-core/domain/engine-session.types.ts`        | `OpenEngineSessionInput` 新增 `allianceThresholds?: { open?, resistanceTrust?, resistanceSafety? }`（**内联结构类型**，刻意不 import `cognition/`）                                                                                    |
| `src/engine-core/in-memory/in-memory-engine-session.ts` | `EngineSessionRuntime` 新增 `readonly allianceConfig`；`openSession` 里 `resolveSessionAllianceConfig(this.allianceConfig, input.allianceThresholds)` 解析一次并固定；3 处消费点由 `this.allianceConfig` 改为 `runtime.allianceConfig` |

### 3.2 适配层（4 个文件）

| 文件                                                                    | 改了什么                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/alliance-threshold-resolver.ts`（**新增**） | `SessionAllianceThresholdContext` + `SessionAllianceThresholdResolver` 端口 + `NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE`（缺省实现，永远无覆盖）                                               |
| `src/engine-adapters/wiring/engine.tokens.ts`                           | 新增 `ALLIANCE_THRESHOLD_RESOLVER` symbol token                                                                                                                                              |
| `src/engine-adapters/wiring/engine-turn.service.ts`                     | 新增 `@Optional() @Inject(ALLIANCE_THRESHOLD_RESOLVER)` 依赖 + 私有 `resolveThresholdOverride()`；`open()` 里**无覆盖时原样传 input（同一引用）**，有覆盖才 `{...input, allianceThresholds}` |
| `src/engine-adapters/wiring/engine.module.ts`                           | 新增 provider `{ provide: ALLIANCE_THRESHOLD_RESOLVER, useValue: NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE }`                                                                                   |

### 3.3 测试（2 个文件 · 新增）

| 文件                                                          | 用例                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `test/engine-core/i12-session-alliance-config.spec.ts`        | 11 例：内核纯函数三条回落规则 8 例 + 装配链 3 例（`vi.mock` spy 验消费点拿到合并后配置 / 意图判定随门槛改变）              |
| `test/engine-adapters/i12-session-threshold-plumbing.spec.ts` | 5 例：无端口 → input 同一引用 / 有端口 → 原样转发 / 抛错 → 按无覆盖 / 返回非对象 → 按无覆盖 / 缺省 provider 返回 undefined |

### 3.4 未触碰

- `boundary.spec.ts`（**未改**）；`src/engine-core/index.ts`（**未改** → 内核公开面零变化）
- `DELTA_TABLE` / `AllianceConfig.deltas` / 人格调节算子；DB / migration / prompt / LLM / 前端 / Flutter
- 任何门槛数值

## 4. 闸门表（真实数字 · 2026-11-11 实测）

| 闸门               | 命令                                                                                                                                                                      | 结果                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型               | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                           | **exit 0 / 0 error**                                                                                                                                         |
| Lint               | `pnpm lint`                                                                                                                                                               | **exit 0 / 0 error / 2 warning**                                                                                                                             |
| 定向测试           | `pnpm exec vitest run test/engine-core/boundary.spec.ts test/engine-core/i12-session-alliance-config.spec.ts test/engine-adapters/i12-session-threshold-plumbing.spec.ts` | **exit 0 / 3 文件 / 28 例全绿**（boundary 12 + I-12 两条 16）                                                                                                |
| 全量测试           | `pnpm test`                                                                                                                                                               | **exit 0 / 183 文件（182 passed + 1 skipped）/ 2965 例（2961 passed + 4 skipped，0 failed，71.48s）**                                                        |
| engine-core diff   | `git diff --stat HEAD -- src/engine-core`                                                                                                                                 | **3 files changed, 80 insertions(+), 4 deletions(-)** —— 非空，属任务单 §5.2「若有内核改动，按 §4 附例外批准说明且 boundary.spec 全绿」分支（批准清单见 §6） |
| 门槛数值 diff 核对 | `git diff HEAD -- src/engine-core                                                                                                                                         | Select-String -Pattern "0\.6                                                                                                                                 | 0\.4 | 0\.3 | 0\.35 | 0\.25"` | **零命中** —— 改动行内无任何阈值字面量 |

### 4.1 与基线的对比

| 项           | 任务单基线                      | 本单实测                            | 说明                                                                                                                             |
| ------------ | ------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 全量用例     | 2947（2942 passed + 4 skipped） | **2965（2961 passed + 4 skipped）** | 净增 **16 例** = 本单两个新 spec（11 + 5）；**0 failed**                                                                         |
| 测试文件     | —                               | 183（182 passed + 1 skipped）       | 净增 2 个新 spec                                                                                                                 |
| Lint warning | —                               | 2                                   | 与基线**逐一致**：均为既有 `src/auto-practice/metrics/batch-metrics.service.ts:23/:25` 的 `import/order`；**本单零新增 warning** |
| tsc          | 0 error                         | 0 error                             | 一致                                                                                                                             |

### 4.2 一处需说明的过程偏差（lint）

中途 `pnpm exec eslint --fix` 对 `engine.module.ts` 的 import 段做了**自动重排**，结果把该文件的 import 顺序改乱，**凭空产生 9 条 `import/order` warning**（HEAD 版该文件实测 0 warning —— 用 `git stash` 对照实验确认：stash 掉本单改动后 lint 该文件 → `warningCount: 0`）。

处置：按 HEAD 原序**逐字恢复** import 段，再把两处新 import 插入到符合字母序的位置，最终该文件 `warningCount: 0`、`git diff --stat` 收敛到 **9 行纯新增**（import 2 行 + provider 7 行）。**教训已登记**：`eslint --fix` 的 `import/order` 自动修复在「新增 import 插到已有 import 段中间」这种场景下会重排全段并引入新告警 —— 本批后续单（I-20 / P1e-3）改 import 段时**不跑 `--fix`**，改完直接 lint 验证。

## 5. 回落路径测试结果（三条回落规则逐条）

规则定义（顺序即优先级，内核 `resolveSessionAllianceConfig` 一处裁决）：

1. **会话覆盖优先** —— 覆盖里给了且合法 → 用覆盖值；
2. **缺项回落单例** —— 覆盖里没给 → 用实例级配置（模块 env 单例）的值；
3. **非法值回落种子** —— 覆盖里给了但越界（非有限 / <0 / >1）→ 回落内核种子值。

| #   | 场景                                    | 输入                                                               | 期望                                                        | 实测    |
| --- | --------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- | ------- |
| 1   | 无覆盖 → 原样返回实例级配置（同一引用） | `resolveSessionAllianceConfig(BASE)`                               | `toBe(BASE)`（同一引用）                                    | ✅ 通过 |
| 2   | 无覆盖 + 无实例级配置                   | `resolveSessionAllianceConfig()`                                   | `undefined`                                                 | ✅ 通过 |
| 3   | 覆盖优先                                | `override { open: 0.85 }`                                          | `thresholds.open === 0.85`                                  | ✅ 通过 |
| 4   | 缺项回落单例                            | `override { open: 0.85 }`                                          | `resistanceTrust === 0.4`、`resistanceSafety === 0.3`       | ✅ 通过 |
| 5   | 非法值回落种子                          | `override { open: 5, resistanceTrust: -1, resistanceSafety: NaN }` | 逐项回落 `0.6 / 0.4 / 0.3`                                  | ✅ 通过 |
| 6   | 显式传 `undefined` ≡ 缺项               | `override { open: undefined }`                                     | `open === 0.6`（不能被覆盖成 undefined）                    | ✅ 通过 |
| 7   | `deltas` 沿用实例级配置                 | `override { open: 0.7 }`                                           | `deltas` 同一引用（本单只管门槛）                           | ✅ 通过 |
| 8   | 数值冻结                                | 内核种子仍 `0.6 / 0.4 / 0.3`                                       | 零改动                                                      | ✅ 通过 |
| 9   | 装配链 · 无覆盖                         | 开场 → 消费点 `planIntention`                                      | 拿到**实例级配置本身**（同一引用）                          | ✅ 通过 |
| 10  | 装配链 · 有覆盖                         | `allianceThresholds { open: 0.85 }`                                | 消费点拿到合并后配置（`open 0.85` + `resistanceTrust 0.4`） | ✅ 通过 |
| 11  | 门槛真的生效                            | 实例级 `open 0.6` → 覆盖 `open 0.9`，同样快照                      | 意图由 `cognitive_exploration` 变为 `recounting`            | ✅ 通过 |

适配层侧（忠实转发，不复算）：

| #   | 场景              | 实测                                                                                                                |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| A   | 无解析端口        | `openSession` 收到**同一引用**的 `input`，且 `Object.keys` **不含** `allianceThresholds`（连字段都不多）            |
| B   | 有端口 → 返回覆盖 | 原样转发 `{ open: 0.85 }`；端口收到的上下文含 `sessionId / tenantId / visitorId / characterLabel / attachmentStyle` |
| C   | 端口抛错          | `service.open` **不抛**；按无覆盖处理（input 同一引用）                                                             |
| D   | 端口返回非对象    | 按无覆盖处理                                                                                                        |
| E   | 缺省 provider     | `NO_SESSION_ALLIANCE_THRESHOLD_OVERRIDE.resolve(...)` → `undefined`                                                 |

## 6. 内核改动例外批准清单（任务单 §4 要求的逐条说明）

任务单 §4：「本单若改 `src/engine-core/`，交付记录必须逐条写明『改哪个文件、改什么、为什么必须在内核而不是适配层能解决』」。逐条如下：

### 6.1 `src/engine-core/cognition/alliance-config.ts`

- **改什么**：新增模块级导出函数 `resolveSessionAllianceConfig(base?, override?)`（**不进 `index.ts` barrel**）。
- **为什么必须在内核**：门槛**校验的唯一真相源**是本文件的 `resolveAllianceThresholds`（既有唯一校验口）。会话级覆盖必须复用它，否则适配层要么另写一套校验（第二套真相源，迟早对不上），要么把校验丢给调用方（调用方散落 N 处）。同时「三条回落规则」本身就是内核口径 —— 消费点 `aggregateTurnDelta` / `transitionState` / `planIntention` 都在内核，覆盖若不在内核裁决，就不可能保证三条路径同口径。**适配层能做的只是「把覆盖原样传下去」**。
- **纯度**：零 env、零 IO、零随机、零 Nest；纯函数（无副作用），可确定性测试。
- **公开面**：`resolveSessionAllianceConfig` 是**模块级导出**，**刻意不进 `index.ts`** —— `boundary.spec.ts` 断言⑥（index.ts 公开面**双向**白名单）不允许新增公开导出名，本批禁止改那份测试。适配层因此**不需要**引用本函数（它只忠实转发），内核内部直接相对路径 import 即可。**boundary.spec.ts 实测 12 例全绿**。

### 6.2 `src/engine-core/domain/engine-session.types.ts`

- **改什么**：`OpenEngineSessionInput` 新增可选字段 `allianceThresholds?: { open?, resistanceTrust?, resistanceSafety? }`。
- **为什么必须在内核**：这个接口**本身就在内核**（`engine-core/domain/`），是「会话开场入参」的契约本体。覆盖要随开场入参进内核，字段只能加在这里 —— 加在适配层就得把覆盖从适配层一路手工搬到内核入参，多一层无意义的搬运。**扩已导出类型的字段不新增公开导出名** → 不触碰 `boundary.spec.ts` 断言⑥。
- **类型选择**：用**内联结构类型**，**刻意不 import** `cognition/alliance-config.js` 的 `AllianceThresholds` —— 全仓至今**不存在** `domain/` → `cognition/` 的依赖方向（既成事实是反向：`cognition/` → `domain/`），不为单单调转分层。两处形状**严格 1:1**（三字段），注释里写明「形状镜像，校验与回落仍由 `alliance-config.ts` 一处裁决」。

### 6.3 `src/engine-core/in-memory/in-memory-engine-session.ts`

- **改什么**：`EngineSessionRuntime` 新增 `readonly allianceConfig`；`openSession` 里解析一次并固定；3 处消费点改读 `runtime.allianceConfig`。
- **为什么必须在内核**：这 3 个消费点（`aggregateTurnDelta` / `transitionState` / `planIntention`）**全在内核**，会话级门槛要真正生效就必须在这里被读到 —— 适配层无法让内核消费一份它不认识的配置。这是「per-handle 固定」的落点，与实例级字段（`this.allianceConfig`）构成两级。
- **零回归证明**：无覆盖时 `resolveSessionAllianceConfig` **原样返回 `this.allianceConfig`（同一引用）** → `runtime.allianceConfig === this.allianceConfig` → 3 处消费点读到的对象与改造前**完全同一**。

### 6.4 例外批准结论

本单内核改动 = **3 文件、80 行新增、4 行删除**，全部为「扩字段 / 加纯函数 / 改读同一份配置」性质；**未新增内核公开导出名、未新增内核文件、未改 `boundary.spec.ts`** → `boundary.spec.ts` 12 例全绿。符合任务单 §4 与 §5.2 的例外分支。

## 7. 回归风险确认

| 风险项               | 结论       | 证据                                                                                                                                                                                  |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 门槛数值被改         | **零改动** | `git diff HEAD -- src/engine-core` 内 grep `0.6/0.4/0.3/0.35/0.25` **零命中**；内核种子 `DEFAULT_ALLIANCE_CONFIG` 一字未动；§5 第 8 条断言守住                                        |
| env 覆写值口径变化   | **零变化** | 适配层 env 单例 `resolveAllianceConfig(config)` 的读法未动；覆盖为空时逐字回落该单例                                                                                                  |
| 无覆盖时行为变化     | **零变化** | 适配层 spec A：传给内核的是**同一引用**的 `input`，且不带 `allianceThresholds` 字段；内核 spec 1/9：消费点拿到实例级配置本身                                                          |
| 覆盖来源坏掉炸会话   | **不会**   | 适配层 spec C/D：抛错与返回非对象都按无覆盖处理；实跑日志 `会话级同盟门槛覆盖解析失败 (按无覆盖处理): session=s-1 source exploded`（只出 sessionId 与错误信息，**不含心理对话原文**） |
| 引入第二套阈值真相源 | **没有**   | 校验与回落唯一口 = 内核 `resolveAllianceThresholds`；适配层只转发                                                                                                                     |
| 内核纯度被破坏       | **没有**   | 新增内核代码零 env / 零 IO / 零随机 / 零 Nest                                                                                                                                         |
| 内核公开面变化       | **零变化** | `src/engine-core/index.ts` 未改；`resolveSessionAllianceConfig` 刻意不进 barrel；boundary 12 绿                                                                                       |

## 8. 遗留项

| #   | 遗留                                                                                                                                                                                                                                                                                                                         | 性质                       | 归属             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------- |
| L-1 | **真实 per-session 覆盖来源未接** —— 缺省 provider 永远返回无覆盖；「按角色档案自动算门槛」的临床逻辑属后续标定批次（任务单 §2 明确不在本单范围）                                                                                                                                                                            | 后续标定单                 | 后续             |
| L-2 | **接来源时只需换 `ALLIANCE_THRESHOLD_RESOLVER` 一个 provider**，四个会话创建入口零改动 —— 但真实来源需要哪些维度（角色 slug？批次？档位？）尚未拍板，`SessionAllianceThresholdContext` 目前只放**当前入口拿得到**的事实（sessionId / tenantId / visitorId / characterLabel / attachmentStyle），不够时扩接口即可、不用改内核 | 待定                       | 后续             |
| L-3 | **`applySessionDecay` 调用点未传 `allianceThresholds`** —— 跨会话间隔自然衰减的「破裂态阻抗衰减下限」在会话路径上**未启用**（该调用点走的是另一条参数路径）。本单**未修**：不在任务单范围，且改动会触及数值语义                                                                                                              | 既有缺口（审计中顺带发现） | 建议登记 backlog |
| L-4 | **`eslint --fix` 在「往已有 import 段中间插 import」场景会重排全段并引入新 `import/order` 告警**（本单实测 9 条）—— 后续单改 import 段时不跑 `--fix`，改完直接 lint 验                                                                                                                                                       | 流程经验                   | 本批后续         |
| L-5 | `SessionAllianceThresholdResolver` 端口的 `resolve` 约定「不得抛」写进了注释，但**类型层面无法强制** —— 靠适配层 try/catch 兜住（已实现且有断言）                                                                                                                                                                            | 已知限制                   | 保持现状         |

## 9. 提交分组核对（**不自动 commit / push**）

本单**只含**以下文件（与其它单严格隔离）：

```
src/engine-core/cognition/alliance-config.ts                     (M)
src/engine-core/domain/engine-session.types.ts                   (M)
src/engine-core/in-memory/in-memory-engine-session.ts           (M)
src/engine-adapters/wiring/alliance-threshold-resolver.ts       (A)
src/engine-adapters/wiring/engine.tokens.ts                      (M)
src/engine-adapters/wiring/engine-turn.service.ts                (M)
src/engine-adapters/wiring/engine.module.ts                      (M)
test/engine-core/i12-session-alliance-config.spec.ts             (A)
test/engine-adapters/i12-session-threshold-plumbing.spec.ts      (A)
```

**commit message 草稿**（由用户手动提交）：

```
feat(i12): 打通会话级同盟门槛注入缝（数值冻结，零行为变化）
```

---

_交付于 2026-11-11。闸门数字均为本机实测，未留空项。_
