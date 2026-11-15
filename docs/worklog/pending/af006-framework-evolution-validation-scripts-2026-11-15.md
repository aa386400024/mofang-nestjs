---
taskId: AF-006
contextId: framework-evolution
title: 框架机读校验工具固化（索引 / 任务单 schema 校验、工件指针与链接 / 编码一致性校验）
type: implementation
status: backlog
baselineRef: 3a28da6
dependsOn: []
policyRefs: [framework/acceptance.md, framework/task-contract.md]
createdAt: 2026-11-15
---

# AF-006 · 框架机读校验工具固化（backlog · 触发后立项实施）

> 状态：📋 backlog（2026-11-15）｜编排：主控 Doubao｜执行方：待定（触发时派发）
> 仓库：本仓 `E:\Work\Project\backend\mofang-nestjs`（adapter 侧登记）；工具落点预期为框架仓 `E:\Work\Project\agent-collaboration-framework`
> 任务性质：框架工具链演进；本单当前**不实现**，仅立项登记；引入时机随框架演进档评估后另开 ready 子单。

## 0. 【必读入口】动手前按顺序读完

1. 框架仓 `docs/acceptance.md`（五类核对、脚本化项与人工判断分界）
2. 框架仓 `docs/task-contract.md`（任务单字段组、工件模型、归档字段口径）
3. 框架仓 `schemas/`（`task-sheet.schema.json`、`task-state-index.schema.json`）
4. 框架仓 `docs/evolution.md`（工具 / CI 引入所处的演进档位约束）
5. 本仓适配层 `docs/team/agent-orchestration/README.md`

## 1. 背景

AF-003 / AF-004 回收验收以临时 node 命令现场实跑：JSON 双解析器交叉解析、ajv 8.20.0 对 schema 做 Draft 2020-12 校验、归档 / 在途工件指针存在性与非空核对、Markdown 相对链接可达性、BOM / CR 编码探测。这些临时脚本未入库、不可复用，验收口径只留在交付记录里。AF-004 交付记录遗留 AF-004-L3 已明确：机读校验脚本固化属框架 L1 以上演进项，L0 任务单不落脚本。

本单登记将上述校验固化为框架自带可复用工具（脚本或 CI 校验项），使契约校验从「验收现场临时命令」成为框架护栏，与 `docs/acceptance.md` 的五类口径对齐。

## 2. 范围（严格遵守，不越权）

**触发后在范围内（预期）：**

- 状态索引 schema 校验（`task-state-index.schema.json`）：结构、归档条目轻量指针、semver version 模式；
- 任务单 schema 校验（`task-sheet.schema.json`）：必填字段与正文字段组；
- 工件指针存在性与非空校验（`artifacts.taskSheet` / `deliveryRecord` / `reply`）；
- Markdown 相对链接可达性、md / json 编码一致性（无 BOM、纯 LF）校验；
- 校验工具的调用入口与自检样例；校验规则与框架 `docs/acceptance.md` 五类口径一一对应。

**明确不在范围内：**

- 不改框架 schema 字段集合与语义；
- 不实现业务层专用脚本；
- 不改变验收中需人工判断的边界（结论分级、口径 SSOT 复核仍由人工 / 验收代理负责）；
- 不旁路 L0 既有文件 + cron 闭环；通用层不出现项目取值。

## 3. 目标架构 / 交付物（触发后立项时细化）

> 进度备注（2026-11-15）：校验规则口径已成文进框架仓 `docs/tools.md` §8（机读校验护栏 V1–V6，与 `docs/acceptance.md` §3 分界对齐）；可复用脚本 / CI 校验入口仍未固化，留本单 backlog。
>
> 进度备注（2026-11-15 第二轮）：机读护栏已固化为本仓 adapter 工具 `scripts/orchestration/acceptance-runner.mjs`，覆盖工件存在非空、指针可达、Markdown 相对链接可达、编码（无 BOM / CR）、索引结构断言；输出三级结论（passed / conditional-pass / rejected）与人工复核清单。规则真相源仍在框架 schema 与 `docs/acceptance.md`，工具不另抄口径。**剩余仍留本单 backlog**：框架仓自带可复用校验工具 / CI 校验入口；任务单 schema 的 ajv 机读校验尚未进工具链。

- 固化校验工具与可复用调用入口；
- 覆盖上述四类校验规则的自检样例（中性占位，不含业务实体与真实任务标识）；
- 工具自身的可复现运行说明；校验失败输出可定位到具体任务 / 字段。

## 4. 红线（违反即返工）

- 校验只做机读可判定项；人工判断项不伪装成机器结论；
- 规则唯一真相源在框架 schema 与 `docs/acceptance.md`，工具不另抄口径阈值；
- 契约字段只增不删；通用层零业务耦合；
- 实施阶段不自动 commit / push；提交分组与闸门按交付标准执行。

## 5. 闸门（触发后实施时填真实数字）

实施子单按框架 `docs/acceptance.md` 五类核对 + 框架仓 / 本仓既有闸门执行；本 backlog 单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af006-framework-evolution-validation-scripts-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单归档成对；wp-list / 阶段入口 / 索引同步回写；
- [ ] 索引状态迁移追加 `history`，工件指针填全；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 交付记录 / 回执 / commit message。
