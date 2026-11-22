# I-20 · valence / arousal 角色级调节系数端口（交付记录）

> 状态：✅ 已交付（2026-11-11）
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 任务单：[`phase2.5-i20-valence-arousal-role-coefficients-2026-11-11.md`](phase2.5-i20-valence-arousal-role-coefficients-2026-11-11.md)
> 事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-20（P2 · 情绪维度补角色级调节）

---

## 1. 一句话总结

给依恋调节算子补上 **valence（情绪效价）/ arousal（唤醒度）两个情绪维度的角色级系数端口**：内核 `AttachmentModulation` 加 `valenceScale` / `arousalScale` 两个必填字段（种子**全 1.0** = 不调节）、`resolveAttachment` 逐项走既有 `sanitizeGainScale` 回落、算子加两行只调正向增量的乘法 —— **运行行为零变化**（乘 1 不改变任何数值），临床差异化倍率待后续标定单落地。

## 2. 实际方案 vs 任务单（偏差说明）

任务单 §2 的方案（内核加两字段 + 种子全 1 + `resolveAttachment` 逐项回落 + 算子两行）**逐条照做，未偏离**。但执行过程暴露了一个任务单没写到的**连带面**，必须说明：

### 2.1 连带面 A：`AttachmentModulation` 是**公开导出类型**，加必填字段会波及下游

`AttachmentModulation` 经 `src/engine-core/index.ts` 公开导出（boundary 断言⑥ 的白名单成员），因此**加必填字段 = 破坏性接口变更**。全仓受影响点实测 **19 处**：

| 位置                                                                               | 性质                                | 处置                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/personality-modulator.config.ts:99`（适配层 env 装配） | **必改**（TS 编译不过）             | 两字段取 `fallback.valenceScale` / `fallback.arousalScale`（= 内核种子 1.0 的透传，**不接 env 键**，符合任务单 §2 "适配层 env 扩列不在本单"） |
| `test/engine-core/wp34-personality-modulator.spec.ts`（7 处构造）                  | **必改**（TS + `toEqual` 精确断言） | 补两字段（值 1）；**断言语义零改动**                                                                                                          |
| `test/engine-core/wp53-personality-alliance-extension.spec.ts`（6 处构造）         | 同上                                | 同上                                                                                                                                          |
| `test/engine-adapters/wp49-character-five-factor-personality.spec.ts`（4 处构造）  | 同上                                | 同上                                                                                                                                          |
| `test/engine-adapters/wp34-personality-modulator-config.spec.ts`（2 处 `toEqual`） | **必改**（精确断言多两键）          | 期望值补两字段（值 1）                                                                                                                        |

**关键判断：为什么用「必填字段」而不是「可选字段」** —— 若做成 `valenceScale?: number`（可选），则适配层与 17 处 spec 全都不必改，看起来更省事；但那样「端口形状」就不再是「每种依恋类型都有完整的六维系数」这一**编译期事实**，缺项只能靠运行时回落兜住。仓库既有纪律（`DELTA_DIMENSIONS` 编译期断言「名单少一维 = 那个维度永远配不上（静默失效）」）要求**结构性缺口在编译期暴露**，故取必填。代价是 19 处连带改动，全部是**补字段而非改语义**。

### 2.2 连带面 B：既有 spec 断言精确失败（2 处）

首次跑定向测试时 **2 个用例失败**（不是实现问题，是断言的精确形状变了）：

- `wp34-personality-modulator.spec.ts:95` —— `expect(SEED.attachment.secure).toEqual({...4 键})` 少了新两键；
- `wp34-personality-modulator-config.spec.ts:68` —— 适配层装配结果多出两键。

两处均**只补期望值**（值 1），断言语义（"种子是恒等" / "env 生效"）**逐字未动**。

### 2.3 连带面 C：新写的 spec 有一条断言**我自己写错了**

`i20-valence-arousal-role-coefficients.spec.ts` 的"系数 0 是合法值"用例初版断言 `expect(modulated.arousal).toBe(0)`，实跑失败（得到 `-0.02`）。**这是用例写错，不是实现错** —— `EMPATHY` 事件的 arousal 是**负向**（-0.02，镇静方向），按"只调正向"口径本就不该被乘 0。已改为分别用 `EMPATHY`（valence 正向 / arousal 负向）与 `JUDGMENT`（valence 负向 / arousal 正向）两事件断言两个方向。

## 3. 改动文件清单

### 3.1 内核（1 个文件 · **属 §4 例外批准范围**）

| 文件                                                 | 改了什么                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-core/cognition/personality-modulator.ts` | ① 文件头追加 I-20 段（说明扩展动机 / 口径 / 为什么不碰 positive·negative·dependency）；② `AttachmentModulation` 加 `valenceScale` / `arousalScale` 两个必填字段；③ 种子表四种依恋类型两列**全 1**；④ `NEUTRAL_ATTACHMENT` 两值 **1**；⑤ `resolveAttachment` 两行走既有 `sanitizeGainScale`；⑥ 算子 `modulateDeltaByPersonality` 加两行 |

**算子两行（逐字）**：

```ts
valence: delta.valence > 0 ? delta.valence * attachment.valenceScale : delta.valence,
arousal: delta.arousal > 0 ? delta.arousal * attachment.arousalScale : delta.arousal,
```

### 3.2 适配层（1 个文件）

| 文件                                                         | 改了什么                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine-adapters/wiring/personality-modulator.config.ts` | `resolveAttachment` 补两字段：`valenceScale: fallback.valenceScale` / `arousalScale: fallback.arousalScale` —— **跟随内核种子的透传，不接 env 键**（任务单 §2 明确 "适配层 env 扩列不在本单"） |

### 3.3 测试（5 个文件）

| 文件                                                                         | 用例                      | 性质                                          |
| ---------------------------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| `test/engine-core/i20-valence-arousal-role-coefficients.spec.ts`（**新增**） | 12 例                     | 任务单 §2.4 三条要求的完整覆盖                |
| `test/engine-core/wp34-personality-modulator.spec.ts`                        | 7 处构造 + 4 处 `toEqual` | **既有**用例同步（补字段/补期望值，语义未动） |
| `test/engine-core/wp53-personality-alliance-extension.spec.ts`               | 6 处构造                  | 同上                                          |
| `test/engine-adapters/wp49-character-five-factor-personality.spec.ts`        | 4 处构造                  | 同上                                          |
| `test/engine-adapters/wp34-personality-modulator-config.spec.ts`             | 2 处 `toEqual`            | 同上                                          |

### 3.4 未触碰

- `src/engine-core/index.ts`（**未改** → 内核公开面零变化，boundary 断言⑥ 不受影响）
- `boundary.spec.ts`（**未改**）；`DELTA_TABLE` / cap / 阻抗系数 / agreeableness / 跨会话衰减
- DB / migration / prompt / LLM / **前端** / Flutter
- 任何既有系数数值

## 4. 例外批准说明（任务单 §4 要求的「文件 / 内容 / 纯计算理由」）

### 4.1 `src/engine-core/cognition/personality-modulator.ts`

- **改什么**：`AttachmentModulation` 加两个必填字段 + 种子全 1 + 中性回落 + 解析回落 + 算子两行。
- **为什么必须在内核（而不能在适配层解决）**：
  ① **调节发生在内核**：`modulateDeltaByPersonality` 是内核纯函数，delta 的聚合→调节→cap 整条管道在内核里（`state-transition.ts:638` 与 `in-memory-engine-session.ts:412` 两处调用）。适配层能做的只是"把系数塞进端口"，**改不了调节行为** —— 字段若不进内核端口类型，就没有任何通道把角色级系数送到消费点。
  ② **校验的唯一真相源在内核**：`sanitizeGainScale` 是内核既有的增益系数校验口（非有限 / 负 → 回落种子）。新系数走同一个口，才不会长出第二套判定。
  ③ **纯计算**：新增内容全是纯函数 / 纯类型 —— 零 env、零 IO、零随机、零 NestJS 装饰器、零 prompt、零模型名。
- **公开面**：`AttachmentModulation` **早已在** `index.ts` 的导出白名单里（boundary 断言⑥），本单**未新增任何公开导出名** → 断言⑥ 保持绿。
- **数值冻结**：种子全 1.0，既有 4 列系数**一字未动**（diff 见 §5.2）。

## 5. 闸门表（真实数字 · 2026-11-11 实测）

| 闸门             | 命令                                                                                                                                                                                                                                                                                                                                                                        | 结果                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型             | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                                                                                                                                                                                                             | **exit 0 / 0 error**                                                                                                                                                                                                                                             |
| Lint             | `pnpm lint`                                                                                                                                                                                                                                                                                                                                                                 | **exit 0 / 0 error / 2 warning**（与基线逐一致，均为既有 `batch-metrics.service.ts:23/:25` 的 `import/order`；**本单零新增 warning**）                                                                                                                           |
| 定向测试         | `pnpm exec vitest run test/engine-core/i20-valence-arousal-role-coefficients.spec.ts test/engine-core/boundary.spec.ts test/engine-core/wp34-personality-modulator.spec.ts test/engine-core/wp53-personality-alliance-extension.spec.ts test/engine-adapters/wp34-personality-modulator-config.spec.ts test/engine-adapters/wp49-character-five-factor-personality.spec.ts` | **exit 0 / 6 文件 / 96 例全绿**（含 boundary 12 例全绿）                                                                                                                                                                                                         |
| 全量测试         | `pnpm test`                                                                                                                                                                                                                                                                                                                                                                 | **exit 0 / 184 文件（183 passed + 1 skipped）/ 2979 例（2975 passed + 4 skipped，0 failed，119.41s）**                                                                                                                                                           |
| engine-core diff | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                                                                                                                                                                                                   | **4 files changed, 139 insertions(+), 10 deletions(-)** —— 其中本单（I-20）只占 `personality-modulator.ts` **1 个文件 / 65 行**；另 3 个文件（`alliance-config.ts` / `engine-session.types.ts` / `in-memory-engine-session.ts`）属 **I-12** 单，两单改动互不重叠 |
| 种子值核对       | `git diff HEAD -- src/engine-core` 扫数字行                                                                                                                                                                                                                                                                                                                                 | **新系数字面量全为 `1`**；既有 `trustScale / resistanceScale / safetyScale / bondScale` 四列**数值零改动**（diff 只在行尾追加 `, valenceScale: 1, arousalScale: 1`）                                                                                             |

### 5.1 与基线的对比

| 项           | I-12 交付后                     | I-20 交付后                         | 说明                                                                                             |
| ------------ | ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| 全量用例     | 2965（2961 passed + 4 skipped） | **2979（2975 passed + 4 skipped）** | 净增 **14 例** = I-20 新 spec 12 例 + wp34/wp53 既有 spec 各 +1（种子表断言改为 6 键后行数变化） |
| 测试文件     | 183                             | **184**                             | 净增 1 个新 spec                                                                                 |
| tsc          | 0 error                         | 0 error                             | 一致                                                                                             |
| Lint warning | 2                               | 2                                   | 一致（既有债）                                                                                   |

### 5.2 种子值核对的 diff 证据（逐字）

```diff
-    secure: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1 },
+    secure: { trustScale: 1, resistanceScale: 1, safetyScale: 1, bondScale: 1, valenceScale: 1, arousalScale: 1 },
-    avoidant: { trustScale: 0.6, resistanceScale: 1.3, safetyScale: 0.5, bondScale: 0.5 },
+    avoidant: { trustScale: 0.6, resistanceScale: 1.3, safetyScale: 0.5, bondScale: 0.5, valenceScale: 1, arousalScale: 1 },
```

既有四列数值 **0.6 / 1.3 / 0.5 / 0.5** 等**逐字未动**；新增两列**恒为 1**。

## 6. 零行为变化证据

| 证据                  | 内容                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **数学等价**          | 种子全 1.0 → `delta.valence * 1 === delta.valence`（IEEE754 下 `x * 1 === x` 对所有有限 x 恒成立；`x > 0` 为假时走原值分支）→ 输出**逐字不变** |
| **新 spec ①（5 例）** | 四种依恋类型 × valence/arousal 增益逐字等于原始 delta；种子两系数全 1.0；无依恋类型 → 整个 delta `toEqual(base)`；受损方向事件逐字不动         |
| **既有 spec 未削弱**  | WP34（种子表 4 断言 + 差异化 3 断言）、WP53（同盟三维 9 组断言）、WP49、适配层 env 装配 spec **全部仍绿**，断言语义未改                        |
| **全量回归**          | 2979 例全绿（0 failed），与 I-12 交付后的 2965 例相比**只增不减**                                                                              |
| **数值 diff**         | 既有系数零改动（见 §5.2）                                                                                                                      |

## 7. 回落路径测试结果

| #   | 场景                       | 期望                                         | 实测                     |
| --- | -------------------------- | -------------------------------------------- | ------------------------ |
| 1   | 种子全 1.0                 | valence/arousal 逐字不变                     | ✅                       |
| 2   | valenceScale > 1           | 正向 valence ×N，负向不动                    | ✅                       |
| 3   | valenceScale < 1           | 正向 valence ×N（缩小），负向不动            | ✅                       |
| 4   | arousalScale > 1           | 正向 arousal ×N，负向不动                    | ✅                       |
| 5   | arousalScale < 1           | 正向 arousal ×N（缩小），负向不动            | ✅                       |
| 6   | 两系数互相独立             | 改 valenceScale 不动 arousal                 | ✅                       |
| 7   | 与 trust/safety/bond 隔离  | 情绪系数不动同盟三维                         | ✅                       |
| 8   | 端口缺字段                 | 回落 1.0（不是 undefined / 不是中性）        | ✅                       |
| 9   | 非法值（NaN / 负 / 无穷）  | 逐项回落 1.0，无 NaN / Infinity              | ✅                       |
| 10  | 系数 0                     | 合法值（该维度本轮完全不涨），不当非法值回退 | ✅                       |
| 11  | 无依恋类型                 | 中性回落全 1.0 → delta 逐字不变              | ✅                       |
| 12  | 未知依恋类型（运行时脏值） | 回落 ×1.0                                    | ✅（既有 WP34 断言覆盖） |

## 8. 回归风险确认

| 风险项               | 结论         | 证据                                                                 |
| -------------------- | ------------ | -------------------------------------------------------------------- |
| 既有系数被改         | **零改动**   | §5.2 diff 逐字                                                       |
| 算子行为变化         | **零变化**   | §6 数学等价 + 新 spec ① + 全量 2979 绿                               |
| 公开面破坏           | **无新破坏** | `index.ts` 未改（无新增导出名）→ boundary 断言⑥ 绿（12 例）          |
| 适配层漂移           | **无漂移**   | 适配层两字段 = 内核种子透传，未引入第二套真相源                      |
| 引入第二套系数真相源 | **没有**     | 种子仍只在 `DEFAULT_PERSONALITY_MODULATOR_CONFIG` 一处；适配层只透传 |
| 心理原文进日志       | **没有**     | 本单零日志改动                                                       |
| 内核纯度被破坏       | **没有**     | 新增内容零 env / 零 IO / 零随机 / 零 NestJS                          |

## 9. 遗留项

| #   | 遗留                                                                                                                                                                                                                             | 性质                     | 归属           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------- |
| L-1 | **临床差异化倍率未填** —— 四种依恋 × valence/arousal 的真实倍率**全 1.0**。任务单 §2 明确本单只搭端口；差异化值待真实批次标定后另单落地                                                                                          | 后续标定单               | 后续           |
| L-2 | **适配层 env 键未扩** —— `ENGINE_MOD_*_VALENCE_SCALE` / `_AROUSAL_SCALE` 未加（任务单 §2 明确不在本单）；适配层当前取内核种子透传                                                                                                | 后续                     | 后续           |
| L-3 | **`positive` / `negative` / `dependency` 三维未扩** —— 它们是情绪分解的伴随量，与 valence/arousal 不同源；顺手扩会发明无依据口径                                                                                                 | 设计决定                 | 保持现状       |
| L-4 | **前端 `ParamCalibrator.vue` 的镜像实现未同步** —— 该文件自带一份 `AttachmentModulation` **前端本地副本**（4 字段）与人格调节镜像逻辑，**不读后端类型**，故本单不影响它编译；但它现在与后端差两列                                | 前端边界（本单不含前端） | 建议另立前端单 |
| L-5 | **既有 spec 的形状断言会随端口扩列反复破裂** —— 本单 19 处连带改动说明：`AttachmentModulation` 这类"公开必填接口"每扩一列，下游全部 `toEqual` 精确断言都要跟改。建议后续扩列时优先考虑**新增可选列**或**一次性把六维抽成子结构** | 工程经验                 | 待评估         |

## 10. 提交分组核对（**不自动 commit / push**）

本单**只含**以下文件（与 I-12 改动不重叠）：

```
src/engine-core/cognition/personality-modulator.ts                    (M)  ← 本单唯一内核文件
src/engine-adapters/wiring/personality-modulator.config.ts           (M)
test/engine-core/i20-valence-arousal-role-coefficients.spec.ts      (A)
test/engine-core/wp34-personality-modulator.spec.ts                  (M)
test/engine-core/wp53-personality-alliance-extension.spec.ts         (M)
test/engine-adapters/wp34-personality-modulator-config.spec.ts       (M)
test/engine-adapters/wp49-character-five-factor-personality.spec.ts  (M)
```

**commit message 草稿**（由用户手动提交）：

```
feat(i20): 补 valence/arousal 角色级调节系数端口（种子全 1.0，零行为变化）
```

---

_交付于 2026-11-11。闸门数字均为本机实测，未留空项。_
