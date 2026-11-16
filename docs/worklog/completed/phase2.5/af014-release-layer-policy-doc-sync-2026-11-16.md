---
taskId: AF-014
contextId: phase2.5-orchestration-closed-loop
title: 分层发布口径同步（README 角色绑定 / 敏感操作边界与角色卡 limits 对齐 L1–L4 模型）
type: documentation
status: completed
baselineRef: 7b75137
dependsOn: []
policyRefs: [framework/roles.md, framework/autonomous-loop.md, autonomous-team-design.md#release-layers]
createdAt: 2026-11-16
---

# AF-014 · 分层发布口径同步：README 与角色卡

> 状态：✅ 已交付（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）｜交付记录：af014-release-layer-policy-doc-sync-implementation-2026-11-16.md
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `docs/team/agent-orchestration/README.md`、`agent-cards/*.json`
> 唯一事实源：`docs/team/agent-orchestration/autonomous-team-design.md` §6（分层发布与回退）、§10（边界）、§8 P0-6
> 任务性质：文档与声明件口径修订；零代码、零业务源码改动

## 0. 【必读入口】动手前按顺序读完

1. `docs/team/agent-orchestration/autonomous-team-design.md` §6、§10、§8
2. 框架仓 `docs/roles.md`（角色职责、资源域、兼任制衡）
3. 框架仓 `docs/autonomous-loop.md` §3（冻结动作表）
4. 本仓 `docs/team/agent-orchestration/README.md` §2 角色绑定、§4 工具与闸门命令（敏感操作行）
5. 本仓 `docs/team/agent-orchestration/agent-cards/`：`orchestrator.json`、`executor.json`、`human.json` 的 limits / permissions 字段

## 1. 背景

README §2 与 §4 现口径为「git commit / push 绑定 Human 批准；AI 不自动 commit / push」，与定稿的分层发布模型冲突：L1 任务分支提交、L2 推任务分支、L3 squash 合并进 integrate 在闸门与验收通过下可自动；L4（master 合并、tag、release、对外部署）仍为人工冻结动作。角色卡 executor / orchestrator 的 limits 需同步对齐，避免声明件与流程口径漂移。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- README §2 角色绑定：orchestrator / executor / human 各行的提交与推送边界改写为分层口径（L1–L3 自动条件、L4 人工）；
- README §4 敏感操作行：由「AI 不自动 commit / push」改为分层发布表引用（指向设计备忘 §6），保留冻结动作清单；
- 角色卡 limits：executor 维持「不建分支、不提交、不推送」；orchestrator 明确 L1–L3 自动动作的前置条件（闸门绿、验收五类通过、文件域无冲突、可回退）与 L4 冻结边界；
- 口径真相源：分层定义唯一写在设计备忘 §6，README 与角色卡只引用，不复制阈值与流程正文；
- 同步核查：模板 `docs/team/wp-task-template.md` §2 / §4 / §7 中「不自动 commit/push」表述与新口径的衔接（只改口径引用，不改模板结构）。

**明确不在范围内：**

- 不实现分支脚本与派发链路（归 AF-010 / AF-012）；不调整角色职责划分与资源域；
- 不改业务代码、测试、配置；不新增依赖；
- 不在本单执行 `development` 分支退役；不改 CI 工作流。

## 3. 目标架构 / 交付物

- **交付物 1：README 口径修订** —— §2 / §4 分层发布表述 + §7 文件表对设计备忘的指针（若尚未挂）；
- **交付物 2：角色卡 limits 对齐** —— 三份 JSON 的权限 / 限制字段与分层模型一致；schemaVersion 与字段只增不删；
- **交付物 3：一致性核对** —— grep 全仓「不自动 commit」「不自动 push」旧口径残留，逐条核对为已转引用或属历史只读文档；链接可达、无断链。

## 4. 红线（违反即返工）

- L4 冻结动作（master、tag、release、部署、策略例外、跨任务变更、验收分歧、新增依赖）在任何文档与角色卡中不得写成自动；
- 契约字段只增不删；JSON 编码无 BOM、纯 LF、可被现有解析器读取；
- 历史交付记录与已归档文档只读不改；口径修订只落在活文档与声明件；
- 不把过渡方案（无 gh / token、本地闸门替代远端 CI 门禁）写成永久设计，目标态在设计备忘标注。

## 5. 闸门（实施时填真实数字）

JSON 可解析校验（现有索引 / 快照解析）；Markdown 链接可达核对；`pnpm lint:fast`；编码探测。纯文档单不跑全量测试与 typecheck。pnpm 强制。本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af014-release-layer-policy-doc-sync-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 阶段入口同步回写；
- [ ] 旧口径残留 grep 归零或逐条标注为历史只读；
- [ ] 审计链闭合：`taskId` 贯穿任务单 / 交付记录 / commit message。
