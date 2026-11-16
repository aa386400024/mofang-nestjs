# S-1 预研 · 探索深度门槛端口化（MiniMax Code 只读调查 · 零代码改动）

> 状态：**【预研任务单】**（2026-11-12）。执行方：MiniMax Code。本单是**只读代码调查**：不改任何 `src/` / `test/` 文件，不改 `boundary.spec.ts`，不接 env，不跑批次；输出可行性结论与完整改动面，供主 AI 复核后再决定是否派开工单。
> 仓库：`E:\Work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-s1-open-depth-threshold-port-2026-11-12.md`（S-1 任务单，§5 四项已拍板）；背景见 `docs/worklog/pending/phase2.5-engine-core-structural-debt-assessment-2026-11-12.md` §4.1；台账 `docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-11
> 任务性质：只读静态调查（grep + 读码 + 类型契约核对）
> 改动范围：**无**。仅写一份回复结论 md（路径见 §4）。

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `docs/team/conventions.md` §1.1（纯层 / 禁层边界）、§二（交付格式）
2. S-1 任务单（事实源，全文）
3. 结构债评估草案 §4.1（S-1 定位与边界）
4. 本预研任务单

---

## 1. 背景与已决方案（不要复议 §5 已决项）

现状：`src/engine-core/cognition/intention-planner.ts` 的探索分支要求
`allianceGate >= thresholds.open && depth < LOW_DEPTH`；其中 `open` / `resistanceTrust` / `resistanceSafety` 已走 `AllianceConfig.thresholds` 端口，唯独深度上限 `LOW_DEPTH = 0.35` 是 planner 局部常量，未进端口。

已拍板结论（预研只核实可行性，不推翻）：

- 字段命名：`openDepth`（并入 `AllianceThresholds`，可选字段）。
- 种子值：维持 **0.35**，缺省零行为变化；本单不调任何阈值。
- 不接 adapter env 键；env 扩列留后续标定批次。
- "低 depth 是否为探索前提"的临床结构复核与可达性对账，另案，不在本预研范围。

任务单拟改动的 core 文件（待你核实是否完整、有无遗漏）：

1. `cognition/alliance-config.ts`：类型加 `openDepth?: number`；种子加 `openDepth = 0.35`；`resolveAllianceThresholds` 与 `resolveSessionAllianceConfig` 同步该字段。
2. `cognition/intention-planner.ts`：删 `LOW_DEPTH`，探索分支改 `depth < thresholds.openDepth`。
3. `domain/engine-session.types.ts`：镜像类型 `allianceThresholds` 同步 `openDepth?: number`。
4. core spec：补回落 / 非法值 / 会话覆盖 / 边界两侧策略选择用例。

---

## 2. 预研调查项（逐项给结论 + 代码证据：文件、行号、片段）

### R1 全仓消费点穷举

grep 全仓（`src/` + `test/`，排除本预研 md）：`AllianceThresholds`、`LOW_DEPTH`、`thresholds.open`、`resistanceTrust`、`resistanceSafety`、`allianceThresholds`。

输出一张表：文件 | 行号 | 消费方式（类型引用 / 对象字面量构造 / 字段读取 / spec 断言） | 是否受新字段影响。确认除 §1 三文件 + spec 外，是否还有必须同步的改动点（含 adapter wiring、resolver、service、decay、报告 / eval 代码）。

### R2 既有对象字面量的类型兼容性

新字段为**可选**。逐个核对现有 thresholds 对象字面量（wp42 / i12 spec、`engine-adapters/wiring/alliance-config.ts`、`alliance-threshold-resolver.ts`、`engine-turn.service.ts`）在缺省三字段写法下 TypeScript 是否仍合法；**重点找**：有没有对 thresholds 对象做 `toEqual` / `toMatchObject` 全形状断言——若有，缺可选字段不会让 `toEqual` 变红（对象字面量无该键即缺），但要在结论里逐处注明。

### R3 镜像类型同步必要性

读 `domain/engine-session.types.ts` `allianceThresholds` 字段及其注释（承诺与 `AllianceThresholds` 严格 1:1）。回答：不同步 `openDepth` 时，TS 是否报错？注释承诺是否失真？同步后依赖方向纪律（`domain/` 不 import `cognition/`）是否保持？

### R4 边界断言真实判定（读源码，不靠推论）

读 `test/engine-core/boundary.spec.ts` 断言⑥（barrel 导出白名单双向比对）与断言⑦（core 文件清单反向检查 `extra`）源码。基于源码回答：

- 扩**已导出类型**的可选字段、不新增导出名、不新增 `.ts` 文件，是否确实不触发断言⑥⑦变红？
- 断言⑥比对的是导出名还是类型字段？白名单清单在文件哪一段？
- 断言⑦的文件清单是否含 `engine-session.types.ts` 与 `intention-planner.ts`（即两文件本就在白名单内）？
- 若结论与 S-1 任务单 §2.1 口径有出入，指出真实口径。

### R5 解析口闭环核对

核对 `resolveAllianceThresholds`、`resolveSessionAllianceConfig`、`cognition/session-decay.ts` 的 `resolveThresholdSubset` 三条路径：注入对象经解析口后，`openDepth` 是否都被补全为 [0,1] 内完整数字？有无消费路径绕过解析口、直接读原始注入对象的字段？decay 的 `isRupturedState` 只读 `resistanceTrust / resistanceSafety`，确认新字段不进入破裂判定。

### R6 命名冲突检查

全仓 grep `openDepth`，确认无既有同名符号；核对新字段与 `CharacterProfile`、`TrajectoryScript`、其他端口对象字段名无歧义、无拼写近似撞车。

### R7 零回归基线建议

给出开工时可执行的缺省路径对比方法：固定事件序列 → `planIntention` 的 `strategy` / `Intention` 序列 + 快照序列逐字对比；指出哪些既有 spec 已覆盖缺省无端口路径（列文件与用例名），开工时哪些基线不需要重跑批次即可证明零回归。

### R8 风险与替代方案

从四个角度列风险：类型契约、工程纪律（反双胞胎 / 依赖方向）、临床语义、测试覆盖。若存在更优替代（必填 vs 可选字段、字段归 `AllianceThresholds` vs 独立端口对象、解析口是否需新增），给出方案取舍与理由；否则明确写"维持任务单方案"。

---

## 3. 明确禁止（违反即打回）

- 不改 `src/engine-core/**`、`src/engine-adapters/**`、`src/**` 任何源码；不改 `test/**`；不改 `boundary.spec.ts`。
- 不接 env、不改 `.env.example`、不改 module 装配 / migration / DB。
- 不跑全量批次、不调 LLM；类型 / lint / 测试闸门本预研不需要跑（如确需静态类型核对，只用 `pnpm exec tsc` 只读检查，禁止裸 `npx`）。
- 不碰前端目录；不自动 commit / push。
- 不复议 §1 已拍板四项；发现其与代码冲突时，写进 R8 风险项供主 AI 判断。

---

## 4. 输出要求

把完整预研结论写入：

`E:\Work\Project\backend\mofang-nestjs\docs\worklog\pending\phase2.5-s1-research-result-2026-11-12.md`

结构：

1. **总结论**：可行 / 有条件可行（列条件）/ 不可行（列阻断原因）。
2. **改动面清单**：文件 | 改动内容 | 依据（R 编号 + 行号）；标注任务单 §1 三文件是否完整。
3. **R1–R8 逐项答复**：每项给结论 + 代码证据（文件 :行号 + 片段）。
4. **风险表**：风险 | 影响 | 缓解 / 备注。
5. **建议开工步骤**：顺序化的最小实施路径 + 应补的 spec 用例清单。
6. **闸门建议**：开工单收尾应跑的命令与判据（沿用仓库 pnpm 规范，禁裸 npx；全量测试墙钟需带机器状态）。

写完在对话里说一句"已写入文件"即可，不贴全文。结论只出码、计数与机制描述，不复制心理对话原文。
