# AF-091 · Phase2.5 长会话档案与出口④临床标注协议 — 交付记录

> **taskId**：AF-091 · **contextId**：phase2.5-exit-remediation · **agentRole**：executor
> **分支**：integrate · **基线**：`af4c0c88eb760daa4533027eaf034f8c696d1c18` · **日期**：2026-11-18
> **状态**：实现 + 自测完成，**未 commit / 未 push / 未改编排状态面**（由主控验收并提交）

---

## 1. 这一单做了什么（两件事）

1. **长会话档案（代码）**：把"会话长度 / 自然收尾轮次 / 停滞阈值 / 危机后置窗"收敛成三档可选档案
   （`legacy` / `standard` / `long`），缺省 `legacy` 与改动前**逐字一致**；
   全链路透传 `sessionProfile`（HTTP body → queue job → runner → 咨询师 prompt）；
   咨询师 prompt 增加长会话收尾纪律（目标 40-50 轮、35 轮前不得自然收尾、不得伪造来访者发言、不得强行拖轮次）。
2. **出口④临床标注协议（文档）**：六维 schema / 双人盲标 + 仲裁 / 一致性门槛 / 评分公式 /
   现有 12 案例覆盖率与缺口 / **明确结论「未通过 / 部分可判」**（不用合成数据冒充 80%）。

**根因复述（只读盘点结论，实现侧已按此对齐）**：`DEFAULT_MAX_TURNS=15` + `MIN_TURNS_BEFORE_CLOSE=5`
+ 停滞阈值字面 2 / 无推进 3 + close-discipline 鼓励"该收就收" → 咨询师第 6 轮提议收尾时**系统允许它收尾**。
本单把"能不能收尾"改成由档案决定（long 档 35 轮前一律不生效），而不是靠模型自觉。

---

## 2. 改动清单

### 2.1 新增

| 文件 | 作用 |
|---|---|
| `src/auto-practice/session-profile.ts` | 三档档案（legacy/standard/long）+ `resolveSessionProfile` / `parseSessionProfile` / `sessionThresholdsOf` / `targetTurnsBandText`（纯函数，零 IO / 零 env / 零 NestJS） |
| `test/auto-practice/session-profile.spec.ts` | 档案纯函数 + `decideTurn` 阈值入参的定向单测（17 例） |

### 2.2 修改

| 文件 | 改动 |
|---|---|
| `src/auto-practice/practice-runner.service.ts` | `RunPracticeInput.sessionProfile`；`decideTurn` 改**显式接收** thresholds（缺省 legacy）；四组老常量改为从 legacy 档案派生（值不变）；循环把 `sessionProfile` + `turnIndex` 传给咨询师 |
| `src/auto-practice/counselor/builder/prompt-sections/close-discipline.ts` | 新增 `sessionCloseDisciplineSection(profile, turnIndex)`：长会话收尾纪律块（**legacy 档 enabled=false**，所以老 prompt 一个字节都不变） |
| `src/auto-practice/counselor/builder/counselor-prompt-builder.ts` | `build(mode, crisisMode, profile?, turnIndex?)`；动态块加入长会话纪律块 |
| `src/auto-practice/counselor-agent.service.ts` | `generate()` 解析档案并透传给 builder；`buildMessages` 增加 profile / turnIndex |
| `src/auto-practice/counselor/dto/counselor-types.ts` | `CounselorGenerateOptions` 增加 `sessionProfile?` 与 `turnIndex?` |
| `src/auto-practice/practice-queue.service.ts` | `AutoPracticeJobData.sessionProfile?`；worker 原样透传给 runner |
| `src/auto-practice/auto-practice.controller.ts` | `StartSessionBody` / `BatchBody` 增加 `sessionProfile?`；非法值当场报错；批次缺省轮数改取自档案；新增 `resolveProfileForRequest` / `enqueueCombinations`（拆复杂度） |
| `src/auto-practice/prompt-fingerprint.ts` | 把 5 个 prompt 纪律块文件登记进 `PROMPT_TEMPLATE_FILES`（见偏差表 D-02） |
| `test/auto-practice/practice-runner.spec.ts` | 新增 `AF-091 长会话档案` describe（6 例）：legacy 逐字不变 / long 35 轮闸门 / long 停滞更宽 / 透传 |
| `test/auto-practice/counselor-agent.spec.ts` | 新增 `AF-091 长会话收尾纪律` describe（6 例）：**legacy prompt 逐字快照** / long 纪律文案 / standard 数字 / 块顺序 |

### 2.3 文档

| 文件 | 作用 |
|---|---|
| `docs/worklog/completed/phase2.5/af091-exit4-clinical-label-protocol-2026-11-18.md` | 出口④ 临床标注协议（六维 schema / 双人盲标 + 仲裁 / 门槛 / 覆盖率 / 结论） |
| `docs/worklog/completed/phase2.5/af091-phase25-session-realism-2026-11-18.md` | 本交付记录 |
| `docs/worklog/pending/relay-response-AF091-20261118-1745.md` | 回复原文（用户指定落点） |
| `docs/team/agent-orchestration/transport/receipts/AF-091.json` | 机读回执（见偏差表 D-05） |

---

## 3. 三档档案数值（实现的真相源：`src/auto-practice/session-profile.ts`）

| 档位 | maxTurns | 目标轮次 | 最早自然收尾 | 停滞（字面/无推进） | 危机后置窗 | 用途 |
|---|---|---|---|---|---|---|
| `legacy`（缺省） | 15 | — | 5 | 2 / 3 | 4 | **与改动前逐字一致** |
| `standard` | 30 | 20-30 | 20 | 3 / 4 | 4 | 30 轮常规档 |
| `long` | 50 | 40-50（目标值 45） | 35 | 4 / 5 | 6 | 50 分钟咨询档 |

⚠️ 这些数值是**产品决策**（想要多长的咨询），**不是临床标定**（什么算好咨询）—— 临床侧口径见出口④协议。

---

## 4. 关键设计决策

### 4.1 "逐字不变"是怎么保证的（不是靠人肉核对）

三层护栏：

1. **代码层**：长会话纪律块是**动态块**，legacy 档 `enabled=false` → builder 过滤掉 → prompt 字节不变。
2. **快照层**：`counselor-agent.spec.ts` 里存了一份 **legacy prompt 的逐字快照**（改动前采集自 HEAD），
   断言 `toBe(LEGACY_PROMPT_SNAPSHOT)` —— 改一个字就红。
3. **行为层**：`practice-runner.spec.ts` 断言不传档案时咨询师第 5 轮收尾即 `natural_close`（老行为）。

### 4.2 为什么 prompt 纪律块要带"当前轮次"

模型**不知道**自己在第几轮（它只看得到最近 10 轮历史）。只写"35 轮前不许收尾"是空话 ——
所以 runner 把轮次计数器透传进 prompt（"当前是第 12 轮"），纪律块每轮重建。
真正的硬闸门仍在 runner 侧（`turnIndex >= minTurnsBeforeClose` 才认收尾），prompt 只是让模型别老想着收尾。

### 4.3 为什么 `decideTurn` 的阈值是"显式传参 + 可选缺省"

- **显式传参**：`decideTurn` 函数体里不再读模块常量 —— 否则"这一场用的哪一档阈值"只能靠猜。
- **可选缺省（= legacy）**：`scripts/ops/calibration/stagnation-calibration.ts`（**不在本单 scope 内**）
  以 3 参调用它；改成必填会打破该脚本的类型检查。本单不越界改它。

### 4.4 入口为什么不静默兜底

- HTTP 侧 `sessionProfile` 非法值**当场报错**（与 `scenarioType` 同款纪律）：拼错的档名会跑出一批
  "看着像长会话"的普通数据，事后没人查得出来。
- 队列里若混进脏档名，runner 回落 legacy 并**打告警**（不抛异常，不让整场对练崩掉）。
- 非 legacy 档若 `maxTurns < 最早收尾轮次`（例如 long 档却只给 15 轮）→ **当场报错**：
  该组合下自然收尾**不可达**，必然跑满上限。legacy 档**不拦**（老调用方常传 `maxTurns=3` 跑冒烟）。

---

## 5. 真实闸门数字（命令 / exit code / 用例数）

> 全部在 `D:\work\Project\backend\mofang-nestjs-af070`（分支 integrate，基线 af4c0c8）执行，
> 日期 2026-11-18，命令均按仓库 `package.json`（`pnpm` 优先，无裸 npx）。

| # | 命令 | exit code | 结果 |
|---|---|---|---|
| 1 | `pnpm typecheck` | **0** | 全量类型检查 **0 error** |
| 2 | `pnpm lint` | **0** | **0 error / 0 warning**（`{src,test,bin}/**/*.ts` + `scripts/**/*.{mjs,cjs}` 两段全过） |
| 3 | `pnpm exec vitest run test/engine-core/boundary.spec.ts` | **0** | **1 文件 / 12 例全绿**（内核边界 12/12） |
| 4 | `pnpm exec vitest run test/auto-practice/practice-runner.spec.ts test/auto-practice/counselor-agent.spec.ts` | **0** | **2 文件 / 30 例全绿** |
| 5 | `pnpm exec vitest run test/auto-practice/session-profile.spec.ts`（本单新增文件） | **0** | **1 文件 / 17 例全绿** |
| 6 | `pnpm exec vitest run test/auto-practice`（模块全目录回归） | **0** | **23 文件 / 376 例全绿**，Duration 6.91s |
| 7 | `git diff --stat HEAD -- src/engine-core` | **0** | **输出为空**（engine-core 零 diff） |

> 闸门 3 + 4 合起来就是任务单指定的定向闸门：`Test Files 3 passed (3) / Tests 42 passed (42)`，Duration 1.37s。

**lint 首轮的真实失败与修复轨迹**（不藏）：首轮 13 problems（10 errors / 3 warnings）→
复杂度超限（`enqueueBatch` 25→22→拆成 `enqueueCombinations` + `resolveProfileForRequest`；
`decideTurn` 21→拆出 `decideStagnationStop`）、`import/order` 3 处、`no-useless-undefined` 2 处、
`unicorn/prefer-string-repeat` 1 处、prettier 3 处、`no-misused-promises` 1 处
（vitest mock 未标注签名 → 补 `EngineTurnSignature` 类型）。最终 **0 error / 0 warning**。

---

## 6. 遗留项（不在本单闭环，如实登记）

| # | 遗留 | 影响 | 状态 |
|---|---|---|---|
| AF091-OI-01 | **长会话的实证未做**：需用 long 档实跑一批（50 轮 × N 场）看真实轮数分布、咨询师是否在 35 轮后自然收尾 | 本单只验证了**阈值与 prompt 纪律生效**，未验证**真实轮数** | candidate（用户约束：不跑新批次） |
| AF091-OI-02 | `session_profile` **未落库**（`ap_practice_sessions` 无该列） | 批次对比看不出"这批用的是哪一档" | candidate（需另一张单加列 + migration） |
| AF091-OI-03 | `prompt_version` 指纹清单扩充后**历史批次指纹口径变了** | 旧指纹（不含 prompt-sections 文件）与新指纹**不可直接比较** | candidate（已知且有意，见 D-02） |
| AF091-OI-04 | 出口④ 六维真值仍缺：`verbal` / `depth` / `style` **零真值**；`trust` / `safety` / `bond` 的 signal 轮仅 **49 / 32 / 22**（门槛 100） | 80% 验收仍**不可算**；需外部临床资源按协议 §6.1 试点 | candidate（协议已交付，见出口④文档） |
| AF091-OI-05 | `rubric.json` 缺 `couples-01`，状态仍 `draft-needs-clinical-review` | 断言层未覆盖全部 12 案 | candidate（既有缺口） |
| AF091-OI-06 | 咨询师历史窗口仍是 **10 轮** | 50 轮长会话里的一致性 / 记忆质量**未评估** | candidate |
| AF091-OI-07 | 档案数值（40-50 / 35 / 4·5 / 6）是**产品决策**，非临床标定 | 长会话的临床合理性需临床方复核 | candidate |

---

## 7. 偏差表（任务单 vs 实际）

| # | 项 | 任务单说 | 实际 | 处理 | 为什么 |
|---|---|---|---|---|---|
| D-01 | Ground Truth 覆盖数字 | "trust 461 / **bond 9 / safety 2**" | 只读复算：**trust 461 / bond 22 / safety 32**（另有 resistance 16 / emotionValence 5）；`verbal` / `depth` / `style` = **0** | 协议文档写**实测值**并附复现命令 | 结论方向不变（三维有真值 / 三维无真值），但 bond / safety 的具体数字任务单**偏低**；不跟着抄（AGENTS.md §2.6：任务单与事实不符时按实测写并说明） |
| D-02 | prompt 指纹覆盖 | 未要求改 `prompt-fingerprint.ts` | 把 5 个 prompt 纪律块文件登记进 `PROMPT_TEMPLATE_FILES` | 有意变更，已在交付记录写清 | 新纪律文案住在 `prompt-sections/*.ts`，而清单里只有门面层 `counselor-agent.service` —— 不登记则"文案变了指纹不动"，指纹漏报 |
| D-03 | `decideTurn` 签名 | "显式接收这些阈值" | 第 4 参 `thresholds` **可选**（缺省 legacy 档） | 做成可选而非必填 | `scripts/ops/calibration/stagnation-calibration.ts`（不在本单 scope）以 3 参调用；必填会打破它的类型检查，而本单不越界改它 |
| D-04 | prompt 需要"当前轮次" | 未提 | `CounselorGenerateOptions` 增加 `turnIndex`，runner 每轮透传 | 有意扩展接口 | 模型看不到轮次，"35 轮前不许收尾"就是空话；硬闸门仍在 runner 侧 |
| D-05 | 机读回执 | 未列 | 按 AF-088 既有格式写 `transport/receipts/AF-091.json` | 已写 + 登记 | AGENTS.md §0.5 要求"交付记录 + 机读回执"；该路径不在任务单 `scope.files` 内（属编排收件箱） |
| D-06 | 任务单搬移 | conventions §六要求任务单同移 `completed/` | **未搬移**（仍在 `docs/worklog/pending/`） | 留给编排归档步骤 | 与 AF-088 同款处理：不与编排器的归档动作抢写同一目录 |
| D-07 | 批次缺省轮数 | 未提 | 从"写死 15"改为"取自档案"（legacy = 15 → 逐字不变） | 有意变更 | 档案必须真正决定会话长度，否则 long 档只是改了收尾闸门 |
| D-08 | 批次响应字段 | 未提 | 返回体增加 `sessionProfile` | 纯增量 | 老字段 `batchId` / `enqueued` 不变；admin-dashboard 只读这两个字段，不受影响（未改前端） |
| D-09 | 新增"maxTurns 与档案冲突"校验 | 未提 | 非 legacy 档下 `maxTurns < 最早收尾轮次` → HTTP 当场报错 | 有意新增 | 该组合下自然收尾**不可达**，必然跑满上限；静默跑出会产出一批"看着像长会话"的 `max_turns` 数据 |
| D-10 | 新增 `prompt-fingerprint` 清单 | 见 D-02 | 扩充后**历史批次指纹不可直接比** | 已登记 AF091-OI-03 | 指纹口径变了是"有意变更"的代价，只能明说 |

---

## 8. 硬约束核对

| 约束 | 结果 |
|---|---|
| 不改 `src/engine-core` | ✅ `git diff --stat HEAD -- src/engine-core` 输出为空 |
| 不改 DB / Redis / `.env` | ✅ 未改 migration / entity / env；只读脚本只读仓库内 JSON |
| 不跑新 LLM 批次 | ✅ 本单零 LLM 调用（单测全部 mock） |
| 不新增角色、不改来访池模板 | ✅ 未触碰 `seeds/` 与角色卡 |
| 不 commit / 不 push / 不 `--no-verify` | ✅ 未执行任何 git 写操作 |
| 不手改 `task-state-index` / journal | ✅ 未触碰 `docs/team/agent-orchestration/state/*`（工作区里那些改动是编排器自己产生的，非本单） |
| pnpm 优先、禁裸 npx | ✅ 全部 `pnpm` / `pnpm exec` |
| 真实记录命令 / exit code / 用例数 | ✅ 见 §5（含首轮 lint 失败轨迹） |
| 跑不起来要写报错原因 | ✅ 无跳过项；首轮 lint 失败已逐条修复并复跑 |

---

## 9. 建议 commit message

```
feat(auto-practice): AF-091 长会话档案 (legacy/standard/long) + 出口④临床标注协议
```

---

## 10. 溯源

| 事实 | 位置 |
|---|---|
| 任务契约 | `docs/team/agent-orchestration/transport/tasks/AF-091.json` |
| 任务单 | `docs/worklog/pending/af091-phase25-session-realism-exit4-protocol-task-2026-11-18.md` |
| 出口④协议 | `docs/worklog/completed/phase2.5/af091-exit4-clinical-label-protocol-2026-11-18.md` |
| 出口④ 既有证据 | `data/phase25-exit/af088-exit345-evidence-2026-11-18.json` |
| 案例卡真源 | `docs/reference/psych-dataset/cases/*.json`（12 案 / 496 轮） |
| 六维口径 | `src/engine-adapters/eval/eval.types.ts` → `EVAL_DIMENSIONS` |
| 回复原文 | `docs/worklog/pending/relay-response-AF091-20261118-1745.md` |

---

## 11. 主控独立验收（2026-11-18 18:07–18:11 CST）

> 本节由主控在 MiniMax 回交后独立复跑，不复用下游自报数字。

### 11.1 落地核对

| 产物 | 实测 | 结论 |
|---|---|---|
| `relay-response-AF091-20261118-1745.md` | 9735 字节，mtime 18:04:35 | 存在且非空 |
| `af091-exit4-clinical-label-protocol-2026-11-18.md` | 存在，六维 schema / 盲标 / 仲裁 / 门槛 / 覆盖率齐备 | 存在 |
| `af091-phase25-session-realism-2026-11-18.md` | 存在 | 存在 |
| `transport/receipts/AF-091.json` | 17362 字节，mtime 18:04:18，七组字段齐备 | 存在 |
| 代码 / 测试 | `src/auto-practice` 10 文件 + `test/auto-practice` 2 文件，均在任务单 scope | 未越界 |
| `src/engine-core` | `git diff --stat HEAD -- src/engine-core` 输出为空 | 零 diff |

### 11.2 闸门复跑（主控实测）

| 命令 | 退出码 | 实测结果 |
|---|---|---|
| `corepack pnpm typecheck` | 0 | 0 error |
| `corepack pnpm lint` | 0 | 0 error / 0 warning |
| `corepack pnpm exec vitest run test/engine-core/boundary.spec.ts test/auto-practice/session-profile.spec.ts` | 0 | 2 文件 / 29 例通过（boundary 12 + session-profile 17） |
| `corepack pnpm exec vitest run test/auto-practice/practice-runner.spec.ts test/auto-practice/counselor-agent.spec.ts` | 0 | 2 文件 / 30 例通过 |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 |

### 11.3 出口④数字复核

主控按协议 §4 的复现命令独立重算：

```text
cases 12 turns 496 {"trust":461,"bond":22,"resistance":16,"safety":32,"emotionValence":5}
```

确认 MiniMax 的偏差 D-01 成立：任务单写的 `bond 9 / safety 2` 与仓库事实不符，实测为 `bond 22 / safety 32`；`trust` 461 轮中仅 49 轮为非平坦信号；`verbal / depth / style` 零真值。**出口④仍判「未通过 / 部分可判」**，本单交付的是可执行协议，不是 80% 达标。

### 11.4 编排闭环

`run-once` 实际动作：`delivery-released` → `receipt-ingested` → `late-receipt-recovered` → `archive-completed`；活跃任务归零，归档 108；`events verify` 392 条 PASS。AF-091 的 `reviewVerdict` 按“实现通过、出口④未通过”落为 `conditional-pass`，不以 conditional-pass 冒充出口④通过。

### 11.5 验收结论

- **AF-091 交付本身：通过**（落地、闸门、scope、engine-core、契约口径均核过；D-01 偏差已如实修正）。
- **出口④：未通过 / 部分可判**（真实六维真值不足，需按协议做双人盲标 + 仲裁）。
- **出口⑤：未达标**（库内 62 场 / 592 轮，距 1000 场仍差 938 场）。
- AF091-OI-01 ~ OI-07 保留为后续任务，不在本单顺手扩大修复。
