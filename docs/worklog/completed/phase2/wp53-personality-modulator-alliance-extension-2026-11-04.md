# WP53 任务单 — 人格调节算子扩展到同盟三维（safety / bond）

> **状态**：✅ 已交付（2026-11-04）→ [`engine-wp53-personality-modulator-alliance-extension-implementation-2026-11-04.md`](engine-wp53-personality-modulator-alliance-extension-implementation-2026-11-04.md)
> **路径**：`docs/worklog/completed/phase2/wp53-personality-modulator-alliance-extension-2026-11-04.md`
> **优先级**：🟡 P1
> **引擎内核**：✅ 预批准改 engine-core（人格调节算子内部扩展，与 WP34 / WP42 同文件同范式）
> **前置依赖**：WP34（人格调节算子）、WP42（同盟三维）
> **北极星**：[`../../architecture/engine-endstate-blueprint-v1.0.md`](../../architecture/engine-endstate-blueprint-v1.0.md) §② BDI 推理层

---

## 1. 任务概述

### 1.1 一句话目标

WP34 的人格调节算子只调了 trust 增益和阻抗下降速率，WP42 把同盟拆成了 trust/safety/bond 三维——但依恋系数**只作用在 trust 上**，safety 和 bond 是平的。本期把依恋系数扩展到 safety / bond 两维，让「回避型不敢敞开心」和「焦虑型急于建立连接」真正落到状态变化上。

### 1.2 为什么现在做

- WP42 文件头注释自己登记了缺口：「依恋系数本期只调 trust，safety / bond 不调 —— 任务单没给依恋对安全感 / 纽带的影响系数，不发明临床数字」（`alliance-config.ts:25`）
- 现在同盟三维都有了，人格调节却只调一维 = 同盟建模做了一半，人格差异在 safety/bond 上是休眠的
- 内测时会出现：回避型和安全型收到共情后，trust 涨速不同，但 safety 涨速一样——「不敢说真话」这件事在状态上看不出来

---

## 2. 现状盘查结论（已 grep 全 engine-core 核实）

### 2.1 现有算子结构（`cognition/personality-modulator.ts`）

```ts
// 单个依恋类型的调节系数
export interface AttachmentModulation {
  readonly trustScale: number;      // trust 增益系数（只调 delta.trust > 0）
  readonly resistanceScale: number; // 阻抗水平倍率（只调 delta.verbal/depth/style < 0）
}
```

四种依恋类型的种子值：
| 类型 | trustScale | resistanceScale |
|---|---|---|
| secure | 1.0 | 1.0 |
| avoidant | 0.6 | 1.3 |
| anxious | 1.2 | 0.8 |
| disorganized | 0.8 | 1.2 |

### 2.2 调用位置与管道顺序

`state-transition.ts` 里：
```
事件聚合 delta → 人格调节（modulateByPersonality）→ cap → 落快照 → 信念演化
```

`modulateByPersonality` 在 `transitionState()` 和 `transitionStateDetailed()` 两处都被调用。

`in-memory-engine-session.ts` 里有两处消费点：
- 第 362 行：落库路径的 `eventDelta = modulateDeltaByPersonality(aggregateTurnDelta(...), personality)`
- 第 365 行：临时快照的 `transitionState(..., { personality, ... })`

两处都是调用同一个 `modulateDeltaByPersonality`，算子内部扩展后**调用方不用动**——纯函数扩展的好处。

### 2.3 DeltaVector 维度（11 个）

trust / **safety** / **bond** / verbal / depth / style / valence / arousal / positive / negative / dependency

—— safety 和 bond 已经是 delta 维度了（WP42 加的），人格算子只是**没碰它们**。

### 2.4 DELTA_TABLE 里 safety/bond 的基础值

empathy 事件的基础增量：
- trust +0.10
- safety +0.02
- bond +0.01

这意味着人格调节系数在 safety/bond 上的**绝对影响很小**：
- 比如 avoidant safetyScale = 0.5，safety +0.02 → +0.01，差异只有 0.01
- 这是设计特点（同盟建立本来就慢），不是 bug

### 2.5 现有口径纪律

- **只调增益方向**：delta.trust > 0 时乘 trustScale，受损方向不调（不发明惩罚系数）
- **只调下降方向**：delta.verbal < 0 时除以 resistanceScale，上升方向不调
- 非法值逐项回退内核种子值
- 缺省配置 = 全 1.0（零回归）

### 2.6 适配层现状

`src/engine-adapters/wiring/personality-modulator.config.ts` 已经有完整的 env 接线：
- 现有 10 个 env 键：4 依恋 × 2 系数（trustScale / resistanceScale）+ 宜人性 2 项
- 键名口径：`ENGINE_MOD_<依恋类型>_<TRUST|RESIST>_SCALE`
- 全部留空（继承内核种子值），符合仓库 env 治理约定

---

## 3. 本期做什么

### 3.1 扩展 `AttachmentModulation` 接口

加两个系数：

```ts
export interface AttachmentModulation {
  readonly trustScale: number;     // 已有
  readonly resistanceScale: number; // 已有
  readonly safetyScale: number;    // 新增：safety 增益系数
  readonly bondScale: number;      // 新增：bond 增益系数
}
```

### 3.2 种子值（工程种子值，待校准）

| 类型 | safetyScale | bondScale | 形状的理由 |
|---|---|---|---|
| secure | 1.0 | 1.0 | 基准，正常建立安全感和纽带 |
| avoidant | 0.5 | 0.5 | 回避型不敢敞开心，安全感和纽带都涨得慢 |
| anxious | 0.7 | 1.3 | 焦虑型安全感涨得慢（怕被抛弃，安全感波动大），但纽带涨得快（急于建立连接） |
| disorganized | 0.6 | 0.8 | 混乱型两者都慢，但比回避型略好一点 |

> ⚠️ 全部是**工程种子值，非临床标定**——内测后按真实对练校准。

### 3.3 调节方向

和 trustScale 完全同口径：
- **只调增益方向**：delta.safety > 0 时乘 safetyScale，delta.bond > 0 时乘 bondScale
- **受损方向不调**：delta.safety < 0 / delta.bond < 0 时保持基准速率（不发明惩罚系数）

### 3.4 算子输出

`modulateDeltaByPersonality` 的返回值，在现有 4 个维度（trust / verbal / depth / style）基础上，再加两个：

```ts
return {
  ...delta,
  trust: delta.trust > 0 ? delta.trust * trustScale : delta.trust,
  safety: delta.safety > 0 ? delta.safety * safetyScale : delta.safety,  // 新增
  bond: delta.bond > 0 ? delta.bond * bondScale : delta.bond,             // 新增
  verbal: delta.verbal < 0 ? delta.verbal * resistanceFactor : delta.verbal,
  depth: delta.depth < 0 ? delta.depth * resistanceFactor : delta.depth,
  style: delta.style < 0 ? delta.style * resistanceFactor : delta.style,
};
```

### 3.5 resolveAttachment 同步扩展

`resolveAttachment` 函数要加两个系数的校验和回退：
- `safetyScale`：非负（非法 → 回退种子值）
- `bondScale`：非负（非法 → 回退种子值）

和 trustScale 的校验口径一致。

---

## 4. 边界问题补充

### 4.1 ⚠️ 宜人性调节要不要也扩展到 safety/bond？

**本期不做**。宜人性（agreeableness）只调 trust 增益（共情事件触发），是 WP34 的示例级实现。本期只把依恋系数补完整，宜人性扩展留后续。

### 4.2 ⚠️ safety / bond 的受损方向要不要调？

**本期不调**。和 trustScale 口径一致——只调增益方向，受损方向保持基准速率。理由：任务单没给「依恋对信任受损的影响系数」，不发明临床数字。

### 4.3 ⚠️ 与 WP42 的 AllianceConfig 覆写的关系

`AllianceConfig.deltas` 是**事件级 safety/bond 增量覆写**（改基础系数）。
`AttachmentModulation.safetyScale/bondScale` 是**角色级调节系数**（在基础系数上再乘一刀）。

两者是叠加关系：
```
最终 delta.safety = 事件聚合的基础 safety delta × 角色 safetyScale
```

顺序：先聚合（含 AllianceConfig 覆写）→ 再人格调节。和现有 trust 的处理完全一致。

### 4.4 ⚠️ 跨会话衰减要不要做人格调节？

**不做**。`session-decay.ts` 里同盟三维（trust/safety/bond）用同一个半衰期（30 天）。
人格影响的是**建立速度**，不是**保持时长**——这是合理的，不用改。

---

## 5. 边界约束

### 5.1 engine-core 预批准例外（2 个文件）

1. `src/engine-core/cognition/personality-modulator.ts` —— 算子本体
2. `test/engine-core/wp53-personality-alliance-extension.spec.ts` —— 新增测试

必须通过 `boundary.spec.ts` 的断言：零 @nestjs / 零网络 / 零 env / 零 prompt。

> 注：`boundary.spec.ts` 白名单已有 `AttachmentModulation` / `PersonalityModulatorConfig` / `modulateDeltaByPersonality` 三个符号，接口内部加字段不需要新增白名单条目。

### 5.2 适配层同步改（3 个文件，编译必须）

接口加了字段后，TypeScript 编译会报错，适配层必须跟着改：

3. `src/engine-adapters/wiring/personality-modulator.config.ts` —— `resolveAttachment` 函数加两个参数（safetyRaw / bondRaw），组装成新的 4 系数
4. `.env.example` —— 加 8 个新键，全部留空（继承内核种子值）
5. `test/engine-adapters/wp34-personality-modulator-config.spec.ts` —— 适配层测试覆盖新系数

### 5.3 env 键清单（新增 8 个）

```
ENGINE_MOD_SECURE_SAFETY_SCALE=
ENGINE_MOD_SECURE_BOND_SCALE=
ENGINE_MOD_AVOIDANT_SAFETY_SCALE=
ENGINE_MOD_AVOIDANT_BOND_SCALE=
ENGINE_MOD_ANXIOUS_SAFETY_SCALE=
ENGINE_MOD_ANXIOUS_BOND_SCALE=
ENGINE_MOD_DISORGANIZED_SAFETY_SCALE=
ENGINE_MOD_DISORGANIZED_BOND_SCALE=
```

全部留空，不写默认值——符合仓库 env 治理约定（代码是唯一真相源）。

### 5.4 不碰的地方

- ❌ 不改 `DeltaVector` 接口（safety / bond 已是现有维度）
- ❌ 不改 `AllianceConfig` 端口（那是事件级覆写，本期不动）
- ❌ 不改调用位置（管道顺序不变，只改算子内部）
- ❌ 不做宜人性扩展到 safety/bond（留后续）
- ❌ 不做受损方向的调节（不发明临床数字）
- ❌ 不碰 `session-decay.ts`（跨会话衰减不做人格调节）
- ❌ 不碰 `in-memory-engine-session.ts`（调用方自动跟着改）
- ❌ 不碰 `state-transition.ts`（`modulateByPersonality` 包装函数不用动）

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 回避型收到共情后，safety 增量只有安全型的一半
- [ ] 焦虑型的 bond 增量比安全型大 30%
- [ ] 只调增益方向：safety 下降时，四种依恋类型的下降速率相同
- [ ] 只调增益方向：bond 下降时，四种依恋类型的下降速率相同
- [ ] 缺省配置（无 attachmentStyle）时，safety/bond delta 逐字不变（零回归）
- [ ] 非法系数（负数 / NaN / Infinity）逐项回退种子值
- [ ] 与 trustScale / resistanceScale 叠加正确（同一条 delta 同时受三个系数影响）
- [ ] 与 AllianceConfig 覆写叠加正确（先覆写再调节）

### 6.2 闸门验收

- [ ] `npx eslint "src/**/*.ts" "test/**/*.ts"` → 0 error
- [ ] `npx tsc -p tsconfig.build.json --noEmit` → 0 error
- [ ] `npx vitest run` → 全绿（零回归）
- [ ] `git diff --stat HEAD -- src/engine-core` → 只有 `personality-modulator.ts` + 测试文件

### 6.3 内核测试用例要求

新增测试文件：`test/engine-core/wp53-personality-alliance-extension.spec.ts`

至少覆盖：
1. 四种依恋类型 safety 增益不同（avoidant 最慢，secure 基准）
2. 四种依恋类型 bond 增益不同（anxious 最快，avoidant 最慢）
3. 只调增益方向：safety 受损时，各依恋类型下降速率一致
4. 只调增益方向：bond 受损时，各依恋类型下降速率一致
5. 与 trustScale / resistanceScale 叠加正确（同一条 delta 同时受三个系数影响）
6. 非法 safetyScale / bondScale 逐项回退种子值
7. 缺省配置零回归（无 attachmentStyle → delta 逐字不变）

### 6.4 适配层测试用例要求

更新文件：`test/engine-adapters/wp34-personality-modulator-config.spec.ts`

至少补充：
1. 新系数（safetyScale / bondScale）env 组装正确
2. 非法新系数逐项回退内核种子值

---

## 7. 本期没做的（明确留给后续）

1. **宜人性扩展到 safety/bond** —— 本期只补依恋系数，宜人性调节留后续
2. **受损方向调节** —— 「被否定时，回避型信任下降更快」这类，不发明临床数字
3. **依恋类型对记忆召回的影响** —— 回避型可能更难形成记忆，那是记忆层的事
4. **env 键的实际值** —— 端口已就位，env 留空继承内核种子值，内测后再调

---

## 8. 转述给后端的话术

> 开工前先读 `docs/README.md` 和 `docs/worklog/README.md` 入口，确认红线和交付格式。
>
> 这个 WP 预批准改 engine-core，只改 `cognition/personality-modulator.ts` 一个内核文件。
>
> 任务单里写的所有函数名 / 类型名 / 文件路径都是 grep 核实过的，不是凭印象写的。
>
> 适配层的 3 个文件（config.ts / .env.example / 适配层测试）是编译必须跟着改的，不是额外工作。
>
> 如果真的有必要改 engine-core 的其他地方，先和我确认，不要自己拍板。
>
> 交付时按 `team/conventions.md` §二的格式写交付记录：改了哪些文件、关键设计决策（跟任务单有出入要说明）、闸门数字。

---

## 9. 交付后补记（2026-11-04）

按 `team/conventions.md` §2.5 记录**任务单与实际交付的偏差**，详细论证见交付记录。

| # | 任务单写的 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | §5.2 适配层只改 **3 个文件**（config.ts / .env.example / 适配层测试） | 实际改了 **7 个文件**，多出 3 个：`typings/global.d.ts` / `test/config/wp25-env-example-coverage.spec.ts` / `test/engine-core/wp34-personality-modulator.spec.ts` | 多出的 3 个都是**机器断言逼出来的**：① 仓库 env 治理约定要求每个 env 键显式声明到 `ProcessEnv`；② 断言③c 把 `ENGINE_MOD_*` 键**硬编码成 10 条清单**，适配层多读 8 个键就红；③ 新字段必填 → WP34 既有测试里 7 处 `PersonalityModulatorConfig` 字面量**编译不过**，另有 4 条种子值 `toEqual` 断言失配。⚠️ 这 3 个都**不在 `src/engine-core/**`** —— 不触碰「只改 personality-modulator.ts 一个内核文件」的约束 |
| 2 | §3.1 新字段 `safetyScale` / `bondScale` | **一致**（必填） | 必填 = 编译期兜底：每个构造点都被编译器盯着，不会漏改一处而悄悄变成 `undefined`。选填会让「漏配 = 不调节」变成静默行为 |
| 3 | 任务单未提 | `sanitizeTrustScale` **改名** `sanitizeGainScale` | 该私有函数现在同时管 trust / safety / bond 三个**增益型**倍率，沿用「信任系数」的名字会让后来人以为它只服务 trust —— 名字会骗人。按**极性**命名（增益型 vs 水平型）与 `sanitizeResistanceScale` 的命名轴一致。零行为变化、零公开 API 变化 |
| 4 | §3.5 `resolveAttachment` 加两项校验回退 | **一致**（复用增益型校验器，逐项回退） | 与 trustScale 校验口径完全一致（≥ 0 的乘数）。系数 **0 是合法值**（该维度本轮完全不涨），不是非法值 —— 这一点单独有用例钉住 |
| 5 | §3.4 算子输出加 safety / bond | **一致** | 但补一条实现约束：受损方向必须是**逐维度**独立（safety 受损不牵连 bond 的增益）。测试用 `sensitive_touch` 事件（safety 受损、trust/bond 不动）专门钉住 |
| 6 | §5.4 不碰 `state-transition.ts` / `in-memory-engine-session.ts` | **一致**（一行未改） | 算子是纯函数，扩展发生在**内部** → 两处调用点自动受益。用例验证「落库路径真的带上调节」且「与内核 transitionState 路径逐字一致」 |
| 7 | §6.2 `git diff --stat HEAD -- src/engine-core` 只含 `personality-modulator.ts` + 测试文件 | **一致**（实测只有 1 个文件：87 insertions / 11 deletions） | 闸门实测通过 |
| 8 | 头部写 🟡 **P1** | 母版 `phase2-wp-list-2026-11-03.md` 仍是 🟢 **P2**，**未改** | 改优先级分桶会连带 P1 / P2 统计数字（17→18 / 10→9）与批次计划 —— 属规划口径，需大炮拍板，不在本单顺手改。仅登记 |

> 本期**没做**的（宜人性扩展到 safety/bond / 受损方向调节 / 依恋类型对记忆召回的影响 / env 键的实际值 / WP49 大五人格数据源）已在交付记录 §4 逐条留档。
