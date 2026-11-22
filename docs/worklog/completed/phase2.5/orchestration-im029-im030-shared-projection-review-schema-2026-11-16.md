# IM-029 / IM-030 共享投影收口与 review schema 消费侧接线 — 交付记录

- **状态**：✅ 完成（2026-11-16，adapter 纯函数接线 + 护栏单测；零规则业务代码改动）；IM-029、IM-030 各流转 `candidate → queued → accepted → done`
- **基线 HEAD**：本仓 `2808eff`（== `origin/integrate`，开工前）；框架仓 `016d6b8`（枚举 / review schema 真相源）
- **范围**：`scripts/orchestration/contract-enums.mjs`（新增共享投影模块）；`handover-contract.mjs`、`branch-workflow.mjs`、`acceptance-runner.mjs`、`improvement-log.mjs`、`validator.mjs`、`cli.mjs`、`__tests__/orchestration.spec.mjs`（接线与单测）。`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff；零新增依赖
- **取证来源**：框架仓 `schemas/contract-enums.json`、`schemas/review-handover.schema.json`、`examples/example-review-handover.json`；本仓 `validator.mjs`、`transport.mjs`、台账 `improvement-log.json`

---

## 一、背景

上一批 IM-005 消除了 `handover-contract.mjs` 内的枚举与 taskId 模式手写镜像，但遗留两块：

1. **IM-029**：`branch-workflow.mjs`、`acceptance-runner.mjs`、`improvement-log.mjs` 三处仍各自手写 `^[A-Z0-9]+-[0-9]+$` 校验正则；模式演进时三处需同步，存在漂移风险。
2. **IM-030**：review 交接件结构只经本仓 `handover-contract.mjs` 轻量校验，尚未切读框架 `review-handover.schema.json` 做机读 schema 约束（IM-006 框架标准件落地后的消费侧接线）。

## 二、落地明细

### 2.1 共享投影模块（IM-029）

新增 `scripts/orchestration/contract-enums.mjs`：vendored `contract-enums.json` 的**唯一加载点**，导出 `CONTRACT_ENUMS`、`TASK_TYPES / TASK_STATUSES / FINAL_STATUSES / REVIEW_VERDICTS` 与 `TASK_ID_PATTERN`（派生自投影 `taskIdPattern`）。各消费方统一从该模块导入，不再各自读 JSON 或手写正则 / 枚举字面量。

| 消费方                  | 改动                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handover-contract.mjs` | 删除内联 fs 加载与派生；从共享模块导入四组枚举与 `TASK_ID_PATTERN`，枚举 re-export 保持对外签名不变                                                       |
| `branch-workflow.mjs`   | 删除局部 `TASK_ID_PATTERN` 字面量，导入共享 `TASK_ID_PATTERN`                                                                                             |
| `acceptance-runner.mjs` | 同上                                                                                                                                                      |
| `improvement-log.mjs`   | 删除局部 `RECEIPT_TASK_ID_PATTERN` 字面量，以别名导入共享 `TASK_ID_PATTERN`；正文提取用的两个捕获组正则（frontmatter / 行内标识）属文本提取语义，保留不动 |

> 注：`export ... from` 只做转发、不引入模块局部绑定；`handover-contract.mjs` 采用「先 import 到局部、再 re-export」写法，保证校验函数体内可引用枚举。

### 2.2 review schema 消费侧接线（IM-030）

- `validator.mjs`：`SCHEMA_FILES` 新增 `reviewHandover: 'review-handover.schema.json'`；导出 `validateReviewHandoverSchema(review)`，走既有 `validateObject` 异步 ajv 通道；框架仓目录 / schema 不可用时返回 `skipped`（容错不阻断，与既有四类 schema 口径一致）。
- `cli.mjs`：`validate` 命令扫描 `transport/reviews/*.json`；文件为 transport 包装结构 `{ deliveredAt, payload }`，校验对象取 `record.payload ?? record`；目录不存在时不产生 section（与 Agent Card 目录口径一致）。命令行帮助与模块注释同步补 Review 口径。

### 2.3 单测

- 护栏 describe 新增「共享模块导出的 taskId 模式与投影一致」：断言 `TASK_ID_PATTERN.source` 与投影一致，正反例匹配正确。
- validator describe 新增两条：框架样例 `example-review-handover.json` 通过 schema 校验；缺必填字段（删除 `proposal`）的 review 被拒绝；框架仓不可达时按既有 `skipped` 容错口径跳过。

## 三、台账变更

| 台账   | 层 / 类型           | 流转                                   | 说明                                                                                      |
| ------ | ------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| IM-029 | adapter / tech-debt | `candidate → queued → accepted → done` | 三处手写 taskId 正则镜像消除，收口到 `contract-enums.mjs` 共享投影；`linkedTaskId=AF-009` |
| IM-030 | adapter / standard  | `candidate → queued → accepted → done` | review 交接件接入框架 schema 机读校验；`linkedTaskId=AF-009`                              |

台账终态：**done 15、accepted 1、candidate 14**（total 30）。

## 四、闸门证据

| 命令 / 校验                                                                   | 结果                                                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**122 passed**（119 既有 + 3 新增）；Duration 1.76s；EXIT=0                                |
| `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**（状态索引、工具契约、三角色 Agent Card）；EXIT=0；仓内无 reviews 工件，未产生 review section |
| 编码探测                                                                      | 本批 8 个 `.mjs` / `.spec.mjs` 文件全部 **no-BOM、LF**                                                    |
| 业务源码隔离                                                                  | `git diff --stat HEAD -- src/engine-core src/migration test` 为空；本批无 `src` 改动                      |
| 依赖变更                                                                      | `package.json` / 锁文件 diff 为空；零新增依赖                                                             |

> 本批无 `scripts/*.mjs` 规则逻辑改动以外的业务代码，未重跑 `pnpm lint:fast`（沿用 AF-017 0 warning / 0 error 基线）；未跑全量 typecheck（编排 `.mjs` / 台账 JSON 不进入 `src/test` 运行时，同 IM-005 / IM-021 / IM-022 口径）。

## 五、遗留条目与保留理由（本批未闭环，维持 backlog）

| 台账 / 范围                                                           | 类型                           | 保留理由                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| IM-017 / IM-025                                                       | review / guardrail / adapter   | 熔断阈值数值、观察窗口、试探次数与通道独立计数归适配层 P2，待真实通道接入时声明；IM-025 与 IM-017 近义，评审时评估合并 |
| IM-002 / IM-003 / IM-007 / IM-011 / IM-012 / IM-018 / IM-019 / IM-020 | adapter 各类型                 | 既有技术债与跨仓大项，随对应批次处理，非本批纯函数 / adapter 接线范围                                                  |
| IM-023 / IM-024 / IM-026 / IM-027                                     | acceptance / gap / adapter     | 开放问题，待框架 reliability.md 定调后回填                                                                             |
| IM-028                                                                | implementation / gap / adapter | 派发决策链运行时接线；依赖真实桌面通道激活（P2）                                                                       |
| 框架样例重复 `note` 键                                                | 框架仓既有                     | `example-review-handover.json` 含两个 `note` 键（JSON.parse 取后者），非本批引入；留框架仓样例整理批次核对             |

## 六、审计链

- 台账 `improvement-log.json`：IM-029 / IM-030 done（四级 history + resolution）；快照 `orchestration-snapshot.json` 与看板 `web/orchestration/data.js` 由 CLI `refreshSnapshotArtifacts` 双写刷新。
- 本记录为 adapter 接线类单份交付记录（无独立 AF 任务单落索引归档段，同 IM-005 / IM-021 / IM-022 / 框架批次先例）。
- 框架仓产物已在提交 `016d6b8`；本仓改动于本批分组提交并推送 `integrate`。
