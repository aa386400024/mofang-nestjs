---
taskId: AF-060
contextId: phase2.5-export-evidence
title: Phase2.5 出口条件取证基线重定与 8 场失败归因
type: verification
status: backlog
baselineRef: 66c186f7176ffaac010113eabdaae50566bd7566
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-17T20:34:47+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - docs/worklog/README.md
    - docs/worklog/pending/phase2.5-README.md
    - docs/worklog/pending/phase2.5-wp-list-2026-11-08.md
    - docs/worklog/pending/af060-phase25-exit-evidence-task-2026-11-17.md
    - docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md
    - docs/worklog/pending/archive/
    - data/batch-reports/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md
    kind: report
gates:
  - command: pnpm typecheck
    check: 0 error
    threshold: 0 error
  - command: pnpm lint
    check: 0 error；记录既有 warning
    threshold: 0 error
  - command: pnpm exec vitest run test/engine-core/boundary.spec.ts
    check: boundary 全绿
    threshold: 0 failed
  - command: node scripts/orchestration/cli.mjs events verify
    check: schema / 哈希链 / 索引投影一致
    threshold: exit 0
successCriteria:
  - 用真实数据库和本地产物核对 g3ONzlqSGMVJqkFMF9Lwh 是否仍存在，明确旧 96 场证据能否复用，不以 README 历史记录代替数据事实
  - 用当前代码重算 uJHgP8uQGeM8Z6HbZY7M5 的批次快照，记录四态判定是否可产出；只有单批时不得伪造 improved/neutral/regressed/incomparable
  - 对 8 场 intake FAIL 给出可复算归因：expert 档 safety delta 偏低由哪些场次贡献，cold 档 zero_motion 是哪一个 debug session，是否属于 idle 而非合理封闭
  - 逐条核对出口条件 ①–⑤ 的可判定证据、缺口和外前置，不把代码保证、历史记录或单批烟雾结果冒充出口达标
  - 回写 phase2.5-README §3.2、wp-list 状态行与 worklog 导航；交付记录给出下一步可执行取证任务清单
  - 全程不新跑 LLM 批次、不改业务源码、不改任务状态面以外的手写文件
---

# AF-060 · Phase2.5 出口条件取证基线重定与 8 场失败归因（纯验证）

> 状态：📋 待执行（2026-11-17）
> 执行方：自做
> 仓库：`D:\work\Project\backend\mofang-nestjs`，分支 `integrate`
> 唯一事实源：`docs/worklog/pending/phase2.5-README.md` §3.2、`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`、远程 MySQL `ap_practice_batches` / `ap_practice_sessions`、`data/batch-reports/uJHgP8uQGeM8Z6HbZY7M5.json`
> 任务性质：纯验证与口径收口，不新增功能、不新跑 LLM
> 改动范围：纯文档与批次报告目录

---

## 0. 【必读入口】动手前按顺序读完

1. `README.md`
2. `docs/README.md`
3. `docs/team/conventions.md`
4. `docs/worklog/README.md` → `docs/worklog/pending/phase2.5-README.md` → `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 现有证据：`docs/worklog/completed/phase2.5/phase2.5-verification-batch-96-implementation-2026-11-12.md`、`data/batch-reports/uJHgP8uQGeM8Z6HbZY7M5.json` / `.md`
6. 本任务单

---

## 1. 背景

2026-11-17 环境迁移后，数据库经过一次清空重建。只读探针已确认：

- 远程 MySQL / Redis 可达，`mofang_dev` 中存在批次 `uJHgP8uQGeM8Z6HbZY7M5`：8 场 / 94 轮，创建于 `2026-11-17T08:36:28Z`，`engine_version=v2026.11.16-6cfb46e-59-ga27aba5-dirty`。
- 原 96 场批次 `g3ONzlqSGMVJqkFMF9Lwh` 的 `ap_practice_sessions` 计数为 **0**，当前数据库仅保留 8 场批次。
- 工作树中 `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json/.md` 等旧报告处于 deleted 状态，`uJHgP8uQGeM8Z6HbZY7M5.json/.md` 为未跟踪新产物；这些是环境重置后的并行状态，不得为了“干净”删除、还原或提交。

8 场批次当前 `intake` 全局判定为 FAIL：`expert` 档 `dim.safety.delta_avg=0.0095` 低于 0.015 下限；`cold` 档出现 1 场 `zero_motion`（计入 idle）。因此原计划“直接对 96 场跑 WP-K 四态判读并回写 §3.2”在数据层已不成立，必须先确认可用证据边界，再给出正式判定。

本任务只做取证与口径重定，不新跑 LLM 批次、不改业务源码。若发现需要代码修复或新批次，另立任务，不在本单顺手做。

---

## 2. 范围

**在范围内：**

- 只读核对远程数据库批次行、场次行、轮次计数、配置指纹与 engine / prompt 版本。
- 只读解析 `data/batch-reports/uJHgP8uQGeM8Z6HbZY7M5.json` 与逐字稿数值轨迹，输出聚合/场次级归因，不输出任何对话原文。
- 在临时输出目录运行 `pnpm exec tsx bin/batch-report.ts --batch uJHgP8uQGeM8Z6HbZY7M5 --format both`，验证 WP-K CLI 在当前 HEAD 可复算；临时产物不写入仓库。
- 更新 `docs/worklog/README.md`、`phase2.5-README.md` §3.2 与 §3.3、`phase2.5-wp-list-2026-11-08.md` 的当前状态，不重写历史交付记录。
- 写交付记录与机读回执，按编排 CLI 归档。

**明确不在范围内：**

- 不新跑任何 LLM 批次，不启动或重启应用、不跑 migration、不写数据库。
- 不改 `src/` / `test/` / `scripts/` / `bin/`，不修 exam 生产入口，不补督导语料解析器。
- 不删除、不还原、不提交 `admin-dashboard/pnpm-lock.yaml`、`data/batch-reports/**` 的旧文件删除、`web/orchestration/data.js`、`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`。
- 不改 `docs/team/agent-orchestration/task-state-index.json`、`state/journal.jsonl`、`improvement-log.json`；状态面只经 CLI。

---

## 3. 交付物

1. **出口条件取证矩阵**：逐条列出 ①–⑤ 的判定证据、当前结论（达标 / 部分 / 未达标 / 无法判定）、缺口类型（代码 / 数据 / 外部前置）与下一步任务建议。
2. **8 场失败归因表**：`expert` safety delta 的场次贡献；`cold` 的 `zero_motion` 具体 debug session、该场八维变化、事件计数与 idle / closure 归类；只写数值、id、枚举，不写台词。
3. **WP-K 可复算记录**：CLI 命令、exit code、单批是否能产四态、若不能产出的原因；明确“单批 ≠ 四态结论”。
4. **文档回写**：`phase2.5-README.md` §3.2 与 §3.3、`phase2.5-wp-list-2026-11-08.md`、`docs/worklog/README.md` 的当前状态与下一步。
5. **交付记录**：`docs/worklog/completed/phase2.5/phase2.5-exit-evidence-2026-11-17.md`，含闸门数字、scopeCheck、偏差表、遗留项。
6. **机读回执**：`docs/team/agent-orchestration/transport/receipts/AF-060.json`，六组字段齐全；durable 副本进 `docs/worklog/pending/archive/`。

---

## 4. 红线

- 心理对话原文禁止进日志、console、交付记录或回执；只允许 debug session id、角色 slug、模式 id、维度名、数值、事件枚举。
- 旧 96 场报告只可作历史记录引用，不得写成“当前可判读”或“质量已达标”；数据库计数为 0 就是不可复用。
- 不得把单批 WP-K 输出冒充四态结论；没有 baseline + candidate 时只能声明“无法判定”。
- 不得把 `intake` 的 8 条判据与出口 ④ 的“审议建议准确率 ≥80%”混为同一件事。
- 不得把“代码构造保证已交付”写成“出口 ② 已达标”；exam 无生产 HTTP 入口仍是活缺口。
- 不新跑 LLM、不写库、不动并行产物；提交按 scope 分组。

---

## 5. 闸门

| 闸门   | 命令                                                                                             | 要求                                   |
| ------ | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 类型   | `pnpm typecheck`                                                                                 | 0 error                                |
| Lint   | `pnpm lint`                                                                                      | 0 error，记录既有 warning 数           |
| 边界   | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                                         | 全绿，内核零改动                       |
| 状态链 | `node scripts/orchestration/cli.mjs events verify`                                               | schema / 哈希链 / 索引投影一致         |
| 取证   | `pnpm exec tsx bin/batch-report.ts --batch uJHgP8uQGeM8Z6HbZY7M5 --format both --out <临时目录>` | exit 0；单批只产快照，不产四态         |
| 范围   | `git diff --name-only HEAD`                                                                      | 仅本单文档与批次报告；并行产物不入提交 |

---

## 6. 完成判据

- [ ] 数据库与本地报告双源核对完成，旧 96 场是否可用有明确结论。
- [ ] 8 场 FAIL 两条判据均有场次级数值归因，且无原文泄漏。
- [ ] WP-K CLI 在当前 HEAD 真实执行并记录 exit code；四态结论的可得性有明确说明。
- [ ] ①–⑤ 取证矩阵逐条有证据、有结论、有缺口类型。
- [ ] §3.2 / §3.3 / wp-list / worklog 导航已按事实回写，历史记录未被改写。
- [ ] 交付记录、回执、归档、PR、merge 后 push 证据完整。

### 交付回写清单

- [ ] 交付记录已写到固定路径
- [ ] 任务单从 `pending/` 移到 `completed/phase2.5/`
- [ ] WP 登记表与阶段入口已回写
- [ ] 状态索引经 CLI 迁移，工件指针齐全
- [ ] 回执六组字段齐全并摄入
- [ ] `git diff --stat HEAD -- src/engine-core` 为空
- [ ] 提交只含本单文档，不含并行产物
