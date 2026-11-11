# DOC-2 · I-18 neutral 拆分评估 + I-19 时序权重可行性评估（纯文档，不改代码）

> 状态：✅ 已交付（2026-11-11）→ [交付记录](doc2-neutral-split-timing-weight-assessment-2026-11-11.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/pending/phase2.5-p1d-known-issues-2026-11-11.md` I-18 / I-19 / §5 未知项 6；`src/engine-core/cognition/state-transition.ts:349-351`；`src/engine-core/domain/events/event-lexicon.ts:22-59`；`src/auto-practice/seeds/counselor-modes.seed.ts:70-79`；`test/engine-core/boundary.spec.ts`
> 任务性质：纯验证 / 设计文档（协议变更可行性论证；本单零代码改动）
> 改动范围：纯文档（两份评估备忘落 `docs/worklog/completed/phase2.5/`）；不含前端、不碰 DB

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `README.md`；2. `docs/README.md`；3. `docs/team/conventions.md`（§1.1 纯/副作用分层、灰度期冻结、§三 硬约束）
2. 阶段入口：`phase2.5-README.md`；事实源 p1d-known-issues I-18 / I-19 与 §5 未知项 6
3. 本任务单

---

## 1. 背景（先读，方向别错）

- **I-18**：`neutral` 事件吞掉「冷漠缺席」——规则词表把咨询师简短 / 无温度回应归为 neutral，neutral 算子是 `ZERO`（state-transition.ts:350），既不产生 holding 增益，也不记 cold_absent 代价；cold 模式（counselor-modes.seed.ts:70-79）下该区分尤其失真。完整拆成 `holding_present` / `cold_absent` 需要判定器能识别「在场回应 vs 缺席回应」，规则词轨做不到（词表仅 9 条共情句式，event-lexicon.ts:22-59）。
- **I-19**：状态 delta 是纯累加模型，对时序不敏感（早晚期事件等权）；候选改进是给增量加早 / 晚期权重。已知风险（§5 未知项 6）：时序权重是否破坏 `boundary.spec.ts` 守着的纯函数契约，需单独评估，不能直接改。

### 关键现状（已核对，别当新问题）

- 事件类型与词表在 `event-lexicon.ts`；delta 基础表 `DELTA_TABLE` 在 `state-transition.ts`；neutral 行 = `ZERO`。
- `boundary.spec.ts` 11 条 AST 断言：零 @nestjs、零 typeorm、零逃逸相对 import、依赖白名单 {nanoid, node:*}、零装饰器、index 导出约束、五件套目录结构、内核根无散落文件、B 层落内核外、零 process.env / globalThis、adapter 不得深路径 import 内部模块。
- 内核算子全部纯函数：给定快照 + 事件列表 → 输出 delta；会话内顺序由 runtime 提供（turnIndex 已是入参可见字段）。

---

## 2. 范围（严格遵守，不越权）

**在范围内：**

### 备忘 A · I-18 neutral 拆分评估

1. 现状论证：neutral 事件从词表命中 → 归类 → ZERO delta 的完整链路（文件:行）；说明 holding 增益与 cold_absent 代价当前分别在哪条事件 / 哪个算子体现。
2. 拆分方案分级：
   - **方案 1（规则轨可达的最小步）**：模式先验——cold 模式整体不享 holding 增益（把「模式 → 是否计 holding」作为纯规则前置判定）。论证它能消掉哪部分失真、消不掉哪部分。
   - **方案 2（事件级拆分）**：新增 `holding_present` / `cold_absent` 事件 kind，各自 delta 行；论证判定器需要什么输入（发言长度 / 回应是否共情词命中 / 回应与来访问题的相关性），规则词轨为何不够、模型轨分类器或 LLM 辅助判定的接入位置。
3. 对每个方案给出：涉及的内核纯类型 / 算子清单、适配层接入点、对既有 spec 与批次口径的影响、灰度期风险；结论标明「哪些可在本阶段做、哪些必须等判定器升级」。**不在本单实现任何方案。**

### 备忘 B · I-19 时序权重可行性评估

1. 现状论证：累加链路（事件 delta 聚合 → 人格调节 → cap）何处等权；turnIndex / 轮次顺序当前在哪些入参可见。
2. 契约核对：逐条对照 `boundary.spec.ts` 11 条断言，论证「按轮次位置给 delta 加权重」是否仍属纯函数（权重只依赖入参 turnIndex / 事件顺序，不引入时间随机 / env / IO）；标出哪些断言需要新 spec 守护、是否存在必须挪到适配层的部分。
3. 候选形态比较（只论证不实现）：轮次衰减权重 / 近期加权 / 事件时序窗口；各自对可复现性（同 seed 同序列）、cap 语义、既有批次轨迹可比性的影响。
4. 结论：可行 / 有条件可行（列出前置条件）/ 不可行；若可行，给出内核纯端口设计草案（权重配置走注入端口，不读 env）与后续任务单建议。

**明确不在范围内（禁止顺手做）：**

- 不改 `state-transition.ts` / `event-lexicon.ts` / 任何内核或适配层代码；不加新事件 kind、不加权重算子。
- 不跑批次、不调阈值 / 系数、不动 seed。
- 不碰 DB / migration / prompt / 前端 / Flutter；`boundary.spec.ts` 不许改。
- 不自动 commit / push。

---

## 3. 目标架构 / 交付物

- **交付物 1：I-18 评估备忘** —— 并入交付记录 §A：链路证据、方案分级表、可达性结论、后续任务单建议。
- **交付物 2：I-19 可行性评估备忘** —— 并入交付记录 §B：纯函数契约逐条核对表、候选形态比较、可行性结论与设计草案（若可行）。
- **交付物 3：测试** —— 本单无代码改动，不新增测试；内循环仅类型闸门确认工作树未被误改。

> **口径真相源**：事件定义唯一真相源 = `event-lexicon.ts` + `state-transition.ts`；备忘不另造事件枚举或 delta 数值。

---

## 4. 红线（违反即返工）

- 纯文档：`git diff --stat HEAD -- src/engine-core` 与 `src/` 均应为空；工作树改动只含交付记录 md。
- 评估结论必须挂文件:行证据；不可行 / 有条件可行的理由写清楚，不替后续实现拍板临床数值。
- 不借评估之名改代码；发现的实现需求写成后续任务单条目。
- 心理原文不进文档；不自动 commit/push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 命令规范：一律 pnpm，禁止裸 npx。

### 5.1 日常内循环

- 无代码改动；`git status --short` 确认仅文档变更即可。

### 5.2 收尾全量闸门

| 闸门              | 命令                                                                 | 要求                                                   |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| 类型              | `pnpm exec tsc -p tsconfig.build.json --noEmit`                      | 0 error（确认工作树无 src 改动）                       |
| Lint              | `pnpm lint`                                                          | 0 error，记 warning 数                                 |
| 测试              | `pnpm test`                                                          | 全绿，记用例总数（基线 2947：2942 passed + 4 skipped） |
| engine-core / src | `git diff --stat HEAD -- src/engine-core`；`git status --short src/` | 均为空                                                 |
| 任务特有          | 备忘内引用的文件:行逐一存在                                          | 通过                                                   |

---

## 6. 交付记录（路径固定）

`docs/worklog/completed/phase2.5/doc2-neutral-split-timing-weight-assessment-2026-11-11.md`

1. 一句话总结；2. §A I-18 链路证据 + 方案分级 + 可达性结论；3. §B I-19 契约核对表 + 形态比较 + 可行性结论；4. 改动文件清单（预期仅本记录 md）；5. 闸门表真实数字；6. 后续任务单建议清单；7. 遗留项。

---

## 7. 【交付回写清单】做完逐项勾选

- [ ] 交付记录已写到 §6 路径
- [ ] 任务单移到 `completed/phase2.5/`，状态 `✅` 并链接记录
- [ ] 回写 p1d-known-issues I-18 / I-19 状态指针（未实现则保留未处理状态，结论挂备忘链接）
- [ ] 回写 wp-list / README 阶段表
- [ ] `git diff --stat HEAD -- src/engine-core` 为空；`src/` 无改动
- [ ] 提交分组核对：只含本单 md
- [ ] commit message 草稿（不自己 commit/push）

---

## 8. 回复输出约定

1. 「已写入交付记录」+ 路径；2. 闸门真实数字；3. §7 进度与遗留；4. 不贴 diff 全文。
