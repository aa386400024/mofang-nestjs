# 候选改进闭环（经验沉淀 · adapter 层口径）

> 本文件是 mofang-nestjs 适配层的改进台账口径；通用记忆分层、受控写入与撤回留痕规则以框架仓 `docs/context-and-memory.md` §2 为准，本文件只记录本项目的字段、状态机、命令与闸门边界，不复制通用规则正文。
>
> 这里的"自动学习"指**经验沉淀闭环**：发现缺口 → 结构化登记 → 评审立项 → 实现 → 沉淀为规范 / 护栏 / 测试基线 → 度量复发率；不是模型权重自更新，系统不自动改写自身实现。

## 1. 闭环环节

| 环节     | 状态               | 动作                                                                         | 执行方                                           | 落点                           |
| -------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| 发现     | —                  | 实现、验收复核、返修根因、死信复盘、评审巡检中识别缺口或架构提升点           | executor / orchestrator / reviewer               | 回执遗留组、交付包、快照遗留项 |
| 登记     | `candidate`        | 结构化为台账条目；抽取通道与 CLI 登记只产生候选                              | orchestrator-cli（自动抽取）/ 编排者（手工登记） | `improvement-log.json`         |
| 评审立项 | `queued`           | 编排者 / 人工定级、排期、关联演进任务单；候选退回 `candidate` 或判 `wontfix` | Human / orchestrator（闸门）                     | 台账 + 状态索引演进任务单      |
| 实现     | `accepted`         | 按立项任务单落地；同类问题二次出现时升级为护栏规则或测试基线                 | executor / orchestrator                          | 工件 + 任务单 + 交付记录       |
| 归档     | `done` / `wontfix` | 终态留痕：落地条目关联任务单；不采纳条目记录理由；终态不可再迁移             | Human / orchestrator（闸门）                     | 台账 `resolution` 字段         |

## 2. 台账字段（`improvement-log.json`）

| 字段                                    | 口径                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `improvementId`                         | `IM-001` 起递增，台账内唯一                                                                                                                    |
| `title`                                 | 一句话标题；标题归一化后参与去重                                                                                                               |
| `source`                                | `implementation`（实现中）/ `acceptance`（验收复核）/ `rework`（返修根因）/ `dead-letter`（死信复盘）/ `review`（评审巡检）                    |
| `type`                                  | `gap`（能力 / 工件缺口）/ `guardrail`（护栏补强）/ `tool`（工具改进）/ `standard`（规范 / 口径）/ `performance`（性能）/ `tech-debt`（技术债） |
| `layer`                                 | `adapter`（本仓适配层取值）/ `framework`（通用层候选，须人工评审后回写框架仓）                                                                 |
| `status`                                | `candidate` / `queued` / `accepted` / `done` / `wontfix`（见 §3）                                                                              |
| `relatedTaskId`                         | 关联任务标识；无则 `null`                                                                                                                      |
| `evidence`                              | 证据指针数组（任务单 / 交付记录 / 快照条目 / 文件路径），只存指针不复制正文                                                                    |
| `impact` / `suggestion`                 | 影响面与建议方向；可空                                                                                                                         |
| `createdBy` / `createdAt` / `updatedAt` | 写入者与时间；对齐共享记忆受控写入的来源标识要求                                                                                               |
| `history`                               | 每次状态变更留痕 `{at, from, to, by, note}`；撤回与退回同样记录，不直接删除条目                                                                |
| `resolution`                            | 终态字段：`resolvedAt`、`resolutionNote`、`linkedTaskId`（落地后的演进任务单）                                                                 |

## 3. 状态机与迁移

```
candidate ──→ queued ──→ accepted ──→ done
   │            │            │
   │            └──→ candidate（退回）
   └──→ wontfix ←────────── queued
```

- `candidate → queued / wontfix`
- `queued → accepted / candidate / wontfix`
- `accepted → done / queued`
- `done`、`wontfix` 为终态，不可再迁移。

## 4. 自动化边界（闸门）

**可自动**：候选登记、台账汇总、从快照遗留项抽取候选、同类项去重、到期提醒、汇总计数。

**必须人工 / 编排者闸门**：

1. `queued`（立项）、`accepted`、终态 `done` / `wontfix` 的状态流转；
2. 优先级与排期；
3. `layer=framework` 的通用层改动——台账只作候选标记，不自动改动框架仓，待人工评审后回写；
4. 破坏性 schema 升级、跨任务架构变更（对齐配置 `frozenActions`）。

抽取通道只生成 `candidate`，不自动立项、不自动落地；闭环论证不能由系统自己发现、自己立项、自己验收固化。

## 5. 与既有工件的衔接

- **回执遗留组**：`backlogItems` / `openQuestions` / `manualReviewList` 是候选改进的来源之一；回收回执时由 `--extract` 通道汇总进台账，去重后登记。
- **快照**：`orchestration-snapshot.json` 的 `improvements` 段携带台账汇总（按状态 / 类型 / 来源计数），不复制条目正文；网页只读该汇总。
- **交付包**：`meta.improvementSummary` 携带同一汇总，夜间交付包列出活跃候选规模。
- **状态索引**：立项后的落地工作走既有任务状态机（backlog → ready → … → completed）；台账 `resolution.linkedTaskId` 反指演进任务单。

## 6. 度量与收敛

- 台账汇总：总数、活跃数、按状态 / 类型 / 来源分布（CLI `--summary`、快照、交付包同源读取）。
- 收敛判据：同类 `type=guardrail` / `gap` 条目第二次出现时，应评估升级为机读护栏或测试基线，而非重复人工复核；返修 / 死信根因应反哺护栏规则或 backlog。
- 复发率跟踪：`relatedTaskId` 与 `priorTasks` 关联同一 `contextId` 下的反复失败，用于判断闭环是否真正收敛。

## 7. 命令口径（pnpm，禁裸 npx）

| 命令                                                                                                                                                     | 作用                                             | 副作用                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| `pnpm orchestration:improvements`                                                                                                                        | 打印台账汇总与非终态条目                         | 只读                          |
| `pnpm orchestration:improvements --summary`                                                                                                              | 只打印汇总计数                                   | 只读                          |
| `pnpm orchestration:improvements --extract`                                                                                                              | 从当前快照遗留项抽取候选并登记（仅 `candidate`） | 台账写                        |
| `pnpm orchestration:improvements --add --title .. --source .. --type .. --layer .. [--related-task ..] [--evidence a,b] [--impact ..] [--suggestion ..]` | 手工登记候选                                     | 台账写                        |
| `pnpm orchestration:improvements --transition <IM-001> <queued\|accepted\|done\|wontfix> [--note ..] [--linked-task ..]`                                 | 闸门状态流转                                     | 台账写（须人工 / 编排者执行） |

## 8. 不做什么

- 不自动修改通用框架仓；不自动立项、不自动改业务实现。
- 不在台账里写对话原文、心理内容或未经审定的推断（对齐框架 `docs/context-and-memory.md` §2「不写什么」）。
- 不复制任务单 / 交付记录正文；台账只存指针、状态与汇总。
- 既有技术债不就地清理，登记进台账或既有债台账跟踪（对齐验收清单遗留登记口径）。
