# IM-005 交接枚举镜像消除（vendored 投影接线）— 交付记录

- **状态**：✅ 完成（2026-11-16，adapter 纯函数接线 + 护栏单测；零规则业务代码改动）；IM-005 流转 `candidate → queued → accepted → done`
- **基线 HEAD**：本仓 `f2918af`（== `origin/integrate`，开工前）；框架仓 `016d6b8`（枚举 / 模式真相源，已在框架仓 1.4.0 落地）
- **范围**：`scripts/orchestration/contract-enums.json`（新增 vendored 副本）、`scripts/orchestration/handover-contract.mjs`（枚举与模式派生接线）、`scripts/orchestration/__tests__/orchestration.spec.mjs`（对账护栏用例）。`src/engine-core`、`src/migration`、业务 `src/**/*.ts`、`test/` 零 diff；零新增依赖
- **取证来源**：框架仓 `schemas/contract-enums.json`；本仓 `handover-contract.mjs`、`validator.mjs`（跨仓定位模式参照）、台账 `improvement-log.json`

---

## 一、背景

IM-005 记录：交接契约校验的任务类型 / 状态 / 终态 / 验收结论枚举与 taskId 模式，在 `handover-contract.mjs` 内手写为字面量镜像，与框架 ajv schema 构成双源；框架枚举或模式演进时两处需同步，存在口径漂移风险。框架侧真相源 `contract-enums.json` 已在框架仓 1.4.0（commit `016d6b8`）就位；本批完成 adapter 侧接线，消除本仓手写镜像。

## 二、选型（为什么是 vendored 副本，而非运行时跨仓读取）

- **否决运行时读框架仓目录**：枚举是校验逻辑的输入参数，缺失不可 skip（与 schema 模板不同，schema 缺失可降级 skip）；运行时依赖平级外部目录布局会使部署不自洽，并在模块加载期引入 fs IO 耦合、缺乏版本锁定。
- **采用 vendored 副本进本仓**：`contract-enums.json` 作为编排工具链静态资产随本仓 git 评审与锁定；模块从副本派生导出枚举，运行时零跨仓路径依赖。副本不是"回到手写镜像"：它是 JSON 数据资产（非散落代码字面量），由护栏单测对账锁定取值集合，并保留 `schemaVersion` 版本锚点。
- **演进路径**：未来框架仓发布版本化契约制品（契约包）后，副本可平滑替换为依赖包 import，校验函数无需改动。

## 三、落地明细

### 3.1 新增 vendored 副本

`scripts/orchestration/contract-enums.json`：框架仓 `schemas/contract-enums.json` 的本仓投影，保留 `fileKind` / `schemaVersion: 1.0.0` / `description` 与五组取值（`taskTypes` 6、`taskStatuses` 10、`finalStatuses` 3、`reviewVerdicts` 3、`taskIdPattern`）。description 标注真相源在框架仓、取值以框架权威源为准。

### 3.2 handover-contract.mjs 派生接线

| 原手写常量                   | 接线后                           |
| ---------------------------- | -------------------------------- |
| `TASK_TYPES` 字面量数组      | 派生自副本 `taskTypes`           |
| `TASK_STATUSES` 字面量数组   | 派生自副本 `taskStatuses`        |
| `FINAL_STATUSES` 字面量数组  | 派生自副本 `finalStatuses`       |
| `REVIEW_VERDICTS` 字面量数组 | 派生自副本 `reviewVerdicts`      |
| `TASK_ID_PATTERN` 字面量正则 | `new RegExp(副本 taskIdPattern)` |

模块顶部经 `import.meta.url` 定位同目录副本并 `JSON.parse`；副本损坏在模块加载期 fail-fast（CI 立即暴露）。对外导出签名（`TASK_TYPES / TASK_STATUSES / FINAL_STATUSES / REVIEW_VERDICTS`）与三个 `validate*Handover` / 三个 `build*Handover` 函数逻辑不变；`includes` 与正则校验行为保持不变。`RECEIPT_GROUPS` / `RECEIPT_HEADERS` 未改动。

### 3.3 护栏单测（spec 新增 describe 3 条用例）

1. 导出枚举与 vendored 投影取值与顺序一致（`toEqual` 四组枚举）。
2. taskId 模式与投影一致；正反例匹配正确（正例 `TASK-001 / AF-009 / REVIEW-001`；反例 `task-001 / TASK-001-X / TASK / TASK-abc / 空串`）。
3. vendored 投影与框架仓权威枚举一致；框架仓目录不可达时跳过跨仓对账（副本内部对账由前两条覆盖）。

## 四、台账变更

| 台账   | 层 / 类型           | 流转                                   | 说明                                                                                                                                               |
| ------ | ------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| IM-005 | adapter / tech-debt | `candidate → queued → accepted → done` | resolutionNote：五组枚举与 taskId 模式改读 vendored `contract-enums.json`；119 用例绿、validate 5/5；本仓投影由护栏单测对账；`linkedTaskId=AF-009` |

台账终态：**done 13、accepted 1、candidate 14**（total 28）。

## 五、闸门证据

| 命令 / 校验                                                                   | 结果                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 1 file passed；**119 passed**（116 既有 + 3 护栏新增）；Duration 1.52s；EXIT=0                 |
| `node scripts/orchestration/cli.mjs validate`                                 | **5/5 PASS**（状态索引、工具契约、三角色 Agent Card）；EXIT=0                                  |
| `contract-enums.json` JSON 合法性                                             | `JSON.parse` OK                                                                                |
| 编码探测                                                                      | `contract-enums.json` / `handover-contract.mjs` / `orchestration.spec.mjs` 全部 **no-BOM、LF** |
| 业务源码隔离                                                                  | `git diff --stat HEAD -- src/engine-core src/migration test` 为空；本批无 `src` 改动           |

> 本批无 `scripts/*.mjs` 规则逻辑改动以外的业务代码，未重跑 `pnpm lint:fast`（沿用 AF-017 0 warning / 0 error 基线）；未跑全量 typecheck（编排 `.mjs` / 台账 JSON 不进入 `src/test` 运行时，同 IM-021 / IM-022 / 框架批次口径）。

## 六、遗留条目与保留理由（本批未闭环，维持 backlog）

| 台账 / 范围                                                           | 类型                           | 保留理由                                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三处独立 taskId 正则镜像                                              | 另立小条目                     | `branch-workflow.mjs`、`acceptance-runner.mjs`、`improvement-log.mjs` 各自手写 `^[A-Z0-9]+-[0-9]+$`；本批范围只限 `handover-contract.mjs`，避免范围蔓延，待另行收敛 |
| review 校验切读框架 schema                                            | IM-006 遗留另批                | 协商轮 review 交接件的结构校验尚未切读框架 `review-handover.schema.json`；属标准件消费侧接线，另批处理                                                              |
| IM-017                                                                | review / guardrail / framework | 熔断阈值数值与计数实现归适配层 P2，框架口径槽位已固化（框架 §5.1）                                                                                                  |
| IM-002 / IM-003 / IM-007 / IM-011 / IM-012 / IM-018 / IM-019 / IM-020 | adapter 各类型                 | 既有技术债与跨仓大项，随对应批次处理，非本批纯函数 / adapter 接线范围                                                                                               |
| IM-023 / IM-024 / IM-025 / IM-026 / IM-027                            | acceptance / gap / adapter     | 开放问题，待框架 reliability.md 定调后回填；IM-025 与 IM-017 近义，评审时评估合并                                                                                   |
| IM-028                                                                | implementation / gap / adapter | 派发决策链运行时接线；依赖真实桌面通道激活（P2）                                                                                                                    |

## 七、审计链

- 台账 `improvement-log.json`：IM-005 done（四级 history + resolution）；快照 `orchestration-snapshot.json` 与看板 `web/orchestration/data.js` 由 CLI `refreshSnapshotArtifacts` 双写刷新。
- 本记录为 adapter 接线类单份交付记录（无独立 AF 任务单落索引归档段，同 IM-004 / IM-021 / IM-022 / 框架批次先例）。
- 框架仓产物已在提交 `016d6b8`；本仓改动于本批分组提交并推送 `integrate`。
