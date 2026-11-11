# I-20 · valence / arousal 角色级调节系数端口（种子 1.0 零行为变化）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](i20-valence-arousal-role-coefficients-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-20；`src/engine-core/cognition/personality-modulator.ts:82-123, 153-170, 221-238, 294-315`
> 任务性质：内核纯算子端口扩展（纯类型 + 纯计算；**种子全 1.0，运行行为零变化**）
> 改动范围：后端 `src/engine-core/`（纯层）+ 内核测试；适配层 env 扩列不在本单；不含前端

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md`；2. `docs/README.md`；3. `docs/team/conventions.md`（§1.1 分层边界 + 例外批准格式、灰度期数值冻结、boundary.spec 不可改）
2. 阶段入口：`phase2.5-README.md`；事实源 p1d-known-issues I-20
3. 本任务单

---

## 1. 背景（先读，方向别错）

I-20 现状：人格调节算子 `modulateDeltaByPersonality` 只对 trust / safety / bond（增益）与 verbal / depth / style（阻抗下降）套角色系数；`valence`（情绪效价）与 `arousal`（唤醒度）两个情绪维度在算子里原样透传，没有角色级调节通道。

### 关键现状（已核对，别当新问题）

- `AttachmentModulation`（personality-modulator.ts:82-123）现有四系数：`trustScale` / `resistanceScale` / `safetyScale` / `bondScale`。
- 种子表 `DEFAULT_PERSONALITY_MODULATOR_CONFIG.attachment`（:154-159）与中性回落 `NEUTRAL_ATTACHMENT`（:169）；解析 `resolveAttachment`（:221-238）逐项校验回落；算子 :303-314 按极性方向乘系数。
- 极性口径（沿用既有，不发明新方向）：增益型倍率只作用于正向增量（`delta.x > 0`），受损方向保持基准速率；校验函数 `sanitizeGainScale`（:196-199，非负）。
- **灰度期纪律**：本单只搭系数端口与算子通道，种子值全部 1.0（= 不调节）；临床差异化系数值待真实批次标定后另单落地。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

1. `AttachmentModulation` 新增两个纯字段：`valenceScale: number`、`arousalScale: number`（≥0，增益型口径，与 safetyScale / bondScale 同极性）。
2. 种子表四种依恋类型的两个新系数一律 `1`；`NEUTRAL_ATTACHMENT` 两值 `1`；`resolveAttachment` 逐项走 `sanitizeGainScale` 回落种子 1.0（端口缺该项 / 非法值都回落，不破坏无依恋类型角色）。
3. 算子 `modulateDeltaByPersonality` 新增两行：`valence > 0 ? valence * valenceScale : valence`；`arousal > 0 ? arousal * arousalScale : arousal`；受损方向不调，与既有同盟三维口径逐字对齐。
4. 内核 spec：覆盖①种子全 1.0 时输出与改动前逐字相同；②新系数 >1 / <1 只放大正向增量、负向增量不动；③端口缺字段 / 非法值回落 1.0。

**明确不在范围内（禁止顺手做）：**

- 不填任何临床差异化系数（四种依恋 × 两维的真实倍率留待标定单）；不调 DELTA_TABLE 任何基础增量。
- 适配层 `src/engine-adapters/wiring/personality-modulator.config.ts` 的 env 键扩列不在本单；新字段在 env 未提供时由内核种子 1.0 回落，行为不变。
- 不动 agreeableness 调节、不动阻抗系数、不动跨会话衰减。
- 不碰 DB / migration / prompt / LLM / 前端 / Flutter；`boundary.spec.ts` 不许改。
- 不自动 commit / push。

---

## 3. 目标架构 / 交付物

- **交付物 1：内核端口与算子** —— `personality-modulator.ts` 两字段 + 种子 + 解析回落 + 算子两行；全部纯函数，零 env / IO / 随机 / NestJS 装饰器。
- **交付物 2：内核测试** —— `test/engine-core/` 下既有 modulator spec 扩用例（或新增 spec 文件）；形态：单元纯函数，不起 Nest、不连 DB。
- **交付物 3：例外批准记录** —— 交付记录 §4 逐条写明：改动文件、新增内容、为什么属纯计算必须在内核而非适配层（conventions §1.1 例外批准格式）。

> **口径真相源**：系数表唯一真相源 = 内核 `DEFAULT_PERSONALITY_MODULATOR_CONFIG`；适配层 / 消费端只读取端口，不另抄系数。

---

## 4. 红线（违反即返工）

- **engine-core 例外批准**：本单改动落在纯层，属 §1.1 允许的「纯决策算子 / 纯类型」；交付记录必须附例外说明。`git diff --stat HEAD -- src/engine-core` 不为空时，`boundary.spec.ts` 必须全绿（11 条断言），且 diff 中无 `@nestjs` / typeorm / env / prompt / 模型名 / console 心理原文。
- **零行为变化证据**：种子 1.0 下既有黄金样本 / 既有 spec 输出逐字不变；交付记录附既有测试全绿数字。
- 极性口径不发明：增益只调正向，受损方向保持基准；校验复用既有 `sanitizeGainScale`。
- 心理原文不进日志；不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范：一律 pnpm，禁止裸 npx。

### 5.1 日常内循环

- `pnpm exec vitest run test/engine-core`；`pnpm test:related -- src/engine-core/cognition/personality-modulator.ts`；lint：`pnpm lint`。

### 5.2 收尾全量闸门

| 闸门        | 命令                                                    | 要求                                                   |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------ |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`         | 0 error                                                |
| Lint        | `pnpm lint`                                             | 0 error，记 warning 数                                 |
| 测试        | `pnpm test`                                             | 全绿，记用例总数（基线 2947：2942 passed + 4 skipped） |
| engine-core | `git diff --stat HEAD -- src/engine-core`               | 有改动时附 §3 例外批准说明；`boundary.spec.ts` 全绿    |
| 任务特有    | 种子值核对：diff 中新系数字面量全为 `1`；无其他数值改动 | 通过                                                   |

---

## 6. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/i20-valence-arousal-role-coefficients-2026-11-11.md`

1. 一句话总结；2. 实际方案 vs 任务单偏差；3. 改动文件清单；4. 闸门表真实数字；5. 零行为变化证据（种子 1.0 + 既有 spec 数字）；6. 例外批准说明（文件 / 内容 / 纯计算理由）；7. 遗留项：临床系数标定与适配层 env 扩列另单跟踪。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 路径
- [ ] 任务单移到 `completed/phase2.5/`，状态 `✅` 并链接记录
- [ ] 回写 wp-list / README；回写 p1d-known-issues I-20 状态与结论指针
- [ ] `boundary.spec.ts` 全绿；内核 diff 例外说明已附
- [ ] 提交分组核对：只含本单文件
- [ ] commit message 草稿（不自己 commit/push）

---

## 8. 回复输出约定

1. 「已写入交付记录」+ 路径；2. 闸门真实数字；3. §7 进度与遗留；4. 不贴 diff 全文。
