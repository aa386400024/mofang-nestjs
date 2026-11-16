---
taskId: AF-018
contextId: phase2.5-orchestration-closed-loop
title: 协作适配层迁移到框架 v2.0.0（契约 / 工具声明 / 交付包 / 角色卡 / 运行态）
type: implementation
status: completed
baselineRef: 1aa12fe
dependsOn: [AF-016, AF-017]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#2.4, autonomous-team-design.md#framework-2.0.0]
createdAt: 2026-11-16T20:00:00+08:00
---

# AF-018 · 协作适配层迁移到框架 v2.0.0

> 状态：已交付（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）｜交付记录：af018-framework-v2-adapter-migration-implementation-2026-11-16.md
> 仓库：`D:\work\Project\backend\mofang-nestjs`；落点 `docs/team/agent-orchestration/`、`scripts/orchestration/`、`AGENTS.md`、运行态 transport
> 上游：框架仓 `D:\work\Project\agent-collaboration-framework` tag `v2.0.0`（commit `c507188`，已 push）
> 唯一事实源：框架 `schemas/` 与 `contract-enums.json`、`versions.json`；本仓适配层 README 与 `scripts/orchestration/contract-enums.mjs`

## 1. 背景

框架仓发布 2.0.0（契约版本整体升位：任务单/状态索引/工具契约/角色卡 1.1.0，交付包/审计事件 1.0.0；角色枚举移除 `human`、工具类别收为 8 值、`terminalStatuses` 更名、归档条目关闭附加字段）。本仓协作适配层仍按 1.x 口径声明与实现，实测 26 条 schema 违规、4 例单测失败。本单把数据、代码、文档三层一次性迁移到 2.0.0，并保留既有进度（34 条归档、9 条归档说明、改进台账、运行态任务单 DR-001）。

## 2. 范围

**在范围内：**

- 数据：状态索引升 1.1.0（`tasks: []`、34 条归档、归档说明外移 `archivedNotes`）；六个工具契约拆为一工具一文件；交付包改 `delivery-package` 1.0.0（旧结构整体留 `legacy`）；角色卡改 `contractRef`、删除 `human.json`；`DR-001` 升 1.1.0（`agentRole` / `artifact` / `reference` 对象）。
- 代码：`contract-enums.mjs` 全量重写；`state-store` / `tool-registry` / `validator` / `delivery-pack` / `cli` / `acceptance-runner` / `handover-contract` / `protocol-mapper` 适配；恢复并重生成审计日志与快照。
- 测试：fixtures 升 1.1.0；新增 2.0.0 合规用例（真实工件只读校验、契约版本漂移拦截、交付包生成器、归档说明外移、tolerant 未知状态）。
- 文档：适配层 README（版本表 / 角色 / 目录 / 工具类别映射 / 交付包口径 / 文件表 / 通用层指针）、角色卡 README、任务单模板、AGENTS.md、docs/README、4 篇架构备忘边界与字段名、验收清单与回执模板。
- 运行态：游离在 gitignore 之外的仓库根 `transport/` 归位到配置声明目录。

**明确不在范围内：**

- 不改 `src/engine-core` 与业务源码；不新增依赖；不启用事件溯源（无 `projection`，索引 `note` 声明）。
- 不迁移历史交付记录里的 `E:\` 旧路径（只读历史纪律）；不改用户未跟踪设计稿 `phase3-judge-layer-ai-review-design-2026-11-15.md`。
- 不重写 `improvement-log.json` 条目内容（仅保持原样）；不自动 commit / push。

## 3. 交付物

1. 2.0.0 口径的状态索引、六个工具契约文件、交付包、两张角色卡、运行态任务单。
2. 九个编排脚本的 2.0.0 适配 + 枚举单一来源。
3. 129 例编排层单测全绿；`cli validate` 六项 PASS。
4. 适配层 README 与相关活文档口径收口；AF-018 交付记录（本单）。

## 4. 红线

- 归档 34 条的状态与工件指针不得改写；9 条归档说明内容不得改写。
- `DR-001` 内容字段零差异（仅结构升级）。
- 校验器不注入 `$defs`（框架 schema 自带）；不把过渡口径写成永久设计。
- 本仓禁止自动 commit / push，只留 commit message 草稿。

## 5. 交付回写清单

- [x] 状态索引升位并保留归档与说明
- [x] 工具契约一工具一文件
- [x] 交付包 1.0.0 + legacy 保留
- [x] 角色卡 contractRef / human 不产卡
- [x] 运行态任务单 DR-001 升位
- [x] 编排脚本与枚举单一来源
- [x] 单测 129 passed、`cli validate` 六项 PASS
- [x] 活文档口径收口（README / 模板 / AGENTS / 架构备忘 / 清单 / 回执模板）
- [x] 审计日志与快照重生成
- [x] AF-018 交付记录
