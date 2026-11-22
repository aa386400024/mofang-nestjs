# RESID-1 · runner 状态接口类型导出，清 stagnation-calibration.ts 残留 TS2459（修复）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](resid1-stagnation-state-exports-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md` §2 TD-2 遗留（:102）；`docs/worklog/pending/phase2.5-README.md:91`；`scripts/ops/calibration/stagnation-calibration.ts:25`；`src/auto-practice/practice-runner.service.ts:165, 1070`
> 编号说明：技术债清单 TD-1（husky 钩子）/ TD-2（scripts lint）/ TD-3（commitlint）三条主线均已关闭；本单处理的是 TD-2 收尾登记的 **2 个既有 TS2459 残留**，编号 RESID-1，不与已关闭的 TD-1 混淆。
> 任务性质：bug 修复（类型可见性）
> 改动范围：仅后端 `src/`（两个接口加 `export`）；不改 scripts 逻辑、不加测试之外的文件

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md`
2. `docs/README.md`
3. `docs/team/conventions.md`（§1.1 engine-core 边界、§三 16 条硬约束）
4. 阶段入口：`docs/worklog/pending/phase2.5-README.md` → `phase2.5-wp-list-2026-11-08.md`
5. 唯一事实源：`phase2.5-toolchain-tech-debt-2026-11-11.md` §2 TD-2 遗留（:102）
6. 本任务单

---

## 1. 背景（先读，方向别错）

技术债清单 TD-1 / TD-2 / TD-3 三条主线均已关闭；唯一残留是 TD-2 收尾登记的 2 个既有 `TS2459`（M-4 决策：scripts 不进任何 tsconfig，维持现状）：`scripts/ops/calibration/stagnation-calibration.ts` 顶部 import 了 `CrisisWindowState` 与 `StagnationState` 两个类型，但它们在 `practice-runner.service.ts` 里是**非导出**的 `interface`，脚本侧类型检查报两个 TS2459（类型不存在于导出清单）。

### 关键现状（已核对，别当新问题）

- `scripts/ops/calibration/stagnation-calibration.ts:25`：`import { decideTurn, type CrisisWindowState, type StagnationState } from '../../../src/auto-practice/practice-runner.service.js';`
- `practice-runner.service.ts:165`：`interface CrisisWindowState {`（无 export）；`:1070`：`interface StagnationState {`（无 export）。
- `decideTurn` 函数已导出（`:1129`），两个状态接口是它的入参类型。
- scripts 目录不进后端 `tsconfig.build.json`（M-4 维持现状，已知并接受）；本单不为 scripts 新增 tsconfig 工程。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

- 在 `src/auto-practice/practice-runner.service.ts` 把 `CrisisWindowState`、`StagnationState` 两个接口改为 `export interface`（纯可见性变更，运行时零行为变化）。
- 若 `decideTurn` 的入参类型需要顺带在文件头类型导出清单里对齐（已有 barrel 导出则不动；没有就只加接口 export）。
- 补一条 runner 既有测试文件内的类型引用断言（可选；若既有 spec 已覆盖 `decideTurn` 入参形状，不新增文件）。

**明确不在范围内（禁止顺手做）：**

- 不改两个接口的字段、不改 `decideTurn` 判定逻辑、不改 stagnation / crisis 阈值。
- 不动 `engine-core/`；`boundary.spec.ts` 不许改。
- 不给 scripts 目录新增 tsconfig / 构建脚本（M-4 既有债，另单跟踪）。
- 不重构 runner 文件、不挪动接口位置、不清理其他既有 lint 警告。
- 不碰 DB / migration / prompt / 前端目录 / Flutter。
- 不自动 commit / push。

---

## 3. 目标架构 / 交付物

- **交付物 1：类型导出** —— `practice-runner.service.ts` 中两个状态接口可被脚本 import；接口字段逐字不变。
- **交付物 2：测试** —— 既有 runner 定向测试保持绿；如新增断言，形态为单元纯函数 / 类型投影校验（不起 Nest、不连 DB）。
- **交付物 3：交付记录** —— 见 §6，写明运行脚本侧类型检查时 TS2459 已消除的验证方式。

> **口径真相源**：状态字段的唯一定义在 `practice-runner.service.ts`；脚本只 import 类型，不另抄一份字段表。

---

## 4. 红线（违反即返工）

- 纯可见性改动：不引入任何运行时行为变化；交付记录里用既有测试数字证明 delta 无变化。
- 不碰内核：`git diff --stat HEAD -- src/engine-core` 为空。
- 心理原文不进日志。
- 不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范

- 一律 pnpm，禁止裸 npx。

### 5.1 日常内循环

- 定向：`pnpm exec vitest run test/auto-practice`（或按既有 runner spec 路径）；`pnpm test:related -- src/auto-practice/practice-runner.service.ts`。
- Lint 走缓存：`pnpm lint`。

### 5.2 收尾全量闸门

| 闸门        | 命令                                                                                                                                                                                                                                                                                                             | 要求                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`                                                                                                                                                                                                                                                                  | 0 error                                                |
| Lint        | `pnpm lint`                                                                                                                                                                                                                                                                                                      | 0 error，记 warning 数                                 |
| 测试        | `pnpm test`                                                                                                                                                                                                                                                                                                      | 全绿，记用例总数（基线 2947：2942 passed + 4 skipped） |
| engine-core | `git diff --stat HEAD -- src/engine-core`                                                                                                                                                                                                                                                                        | 空                                                     |
| 任务特有    | 对脚本单跑类型检查：`pnpm exec tsc --noEmit --skipLibCheck --moduleResolution bundler --module ESNext --target ES2022 --strict scripts/ops/calibration/stagnation-calibration.ts`；统计其中指向 `CrisisWindowState` / `StagnationState` 的 TS2459 数量。若命令报出与本单无关的既有错误，单列记录、不计入本单回归 | 两个 TS2459 = 0；无关既有错误单列                      |

---

## 6. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/resid1-stagnation-state-exports-2026-11-11.md`

1. 一句话总结；2. 实际改动 vs 任务单方案及偏差；3. 改动文件清单；4. 闸门表（命令 / exit code / 数字）；5. TS2459 消除证据；6. 回归风险（确认未碰内核 / schema / 阈值 / 内容）；7. 遗留项（scripts tsconfig M-4 仍维持现状）。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 路径
- [ ] 任务单从 `pending/` 移到 `completed/phase2.5/`，状态行改 `✅` 并链接交付记录
- [ ] 回写 `phase2.5-toolchain-tech-debt-2026-11-11.md` §2 TD-2 遗留条目：TS2459 残留标记关闭并补交付记录链接；同步回写 `phase2.5-README.md:91` 遗留句
- [ ] 回写 `phase2.5-wp-list-2026-11-08.md` / `phase2.5-README.md`（如清单引用了本债）
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交分组核对：只含本单文件
- [ ] 给一行 commit message 草稿（不自己 commit/push）

---

## 8. 回复输出约定

1. 「已写入交付记录」+ 路径；2. 闸门真实数字；3. §7 回写进度与遗留；4. 不贴 diff 全文。
