# Agent Card 目录（适配层能力声明）

本目录存放本项目的 **Agent Card**（代理能力声明，机读 JSON），字段口径见框架仓 `schemas/agent-card.schema.json`（`agent-card` 1.1.0）与 `docs/roles.md`，卡片模板见框架仓 `templates/agent-card.template.md`。

## 1. 现有卡片

| 文件                | `agentId` | `role`         | 说明                                       |
| ------------------- | --------- | -------------- | ------------------------------------------ |
| `orchestrator.json` | 主控 AI   | `orchestrator` | 拆解 / 派发 / 验收组织 / 索引回写 / 归档   |
| `executor.json`     | 执行 AI   | `executor`     | 按任务单实现、内循环自测、写交付记录与回执 |

## 2. 为什么没有 `human.json`

框架 2.0.0 的 `roles` 为五值可派发角色（`orchestrator / executor / reviewer / researcher / critic`），`human` 移入 `nonRoutableRoles`——人工是**审批节点**，不参与任务路由，也不产出 Agent Card。

- 人工的角色绑定、审批范围（L4 冻结动作）与兼任制衡声明在 `../README.md` §2 roleBindings；
- 路由与能力匹配只读取本目录 `*.json`，`human` 不出现在候选集里，避免出现"派单给人"的非法记录；
- 历史 `human.json` 已在 2.0.0 迁移中删除，其 `limits` 内容仍保留在 `../README.md` §2 表格中，未丢失。

## 3. 卡片字段口径（本项目取值）

| 字段           | 本项目取值                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId`      | 中性标识（`orchestrator` / `executor`），与路由记录、审计链一致                                                                                            |
| `role`         | 仅取 `roles` 五值之一                                                                                                                                      |
| `availability` | `availabilities` 四值之一（本项目常态 `available`）                                                                                                        |
| `contractRef`  | `urn:agent-collaboration-framework:schema:agent-card:1.1.0`                                                                                                |
| `capabilities` | 能力项 + 资源域（`resources`），供能力路由匹配；未声明资源域视为不可路由                                                                                   |
| `tools`        | 可调用工具面：**有契约的工具填 `toolId`**（与 `tools/<TOOL-ID>.json` 一一对应），**无契约的通用能力填框架 8 值 `toolCategories`**；不得再写 1.x 历史类别名 |
| `limits`       | 边界与禁止项（不写实现细节，只写禁止范围）                                                                                                                 |

## 4. 维护规则

- 新增角色或调整能力域时，先改卡片再改 `../README.md` §2 roleBindings，避免两处口径漂移；
- 卡片变更须过 `node scripts/orchestration/cli.mjs validate`（agent-card schema 校验）；
- 不新增 `human` / `null` 角色卡片；不把项目私有凭据、路径白名单以外的信息写进卡片。
