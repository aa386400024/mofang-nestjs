# 验收核对清单（mofang 适配层 · 项目命令与仓库边界）

> 五类核对口径、三级结论条件、静默缺口排查的通用规则以框架仓 `docs/acceptance.md` 为准，本文件不复制；这里只记录本项目特定的命令、仓库边界与证据落点。
> 闸门命令规范：`docs/team/conventions.md` §1.3 与 `docs/team/wp-task-template.md` §5。
> 通用原则（框架 `docs/acceptance.md`）：验收结论基于工件证据与抽跑复现，不接受执行侧「已通过」的自述；验收阶段不改代码，发现新问题另开任务。

---

## 1. 五类核对（框架口径 · 本项目证据落点）

| 核对类                           | 框架规则位置                    | 本项目证据落点                                                                                                                                                                                                |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 落地（Artifact Presence）        | 框架 `docs/acceptance.md` §落地 | 任务单交付物清单逐条 `Test-Path` + 大小 > 0，读回关键片段确认非占位；`git status --short` / `git diff --stat HEAD` 与交付记录落地组逐条比对；区分新增 / 修改 / 删除；构建产物、锁文件、本地临时配置未进变更集 |
| 证据（Gate Evidence）            | 框架 `docs/acceptance.md` §证据 | 交付记录闸门表每条含命令、exit code、error / warning、用例数 / 文件数；1–2 条关键 spec 单文件复现；失败项区分确定性缺陷与偶发 flake；既有债基线与本任务新增改动分开记录；数字必须能由命令重新跑出             |
| 范围与隔离（Scope Isolation）    | 框架 `docs/acceptance.md` §范围 | `git diff --name-only HEAD` 对照任务单切片；engine-core 边界核对；并行进程产物未混入；未顺手重构相邻旧文件                                                                                                    |
| 契约与口径（Contract Alignment） | 框架 `docs/acceptance.md` §契约 | 端口 / DTO / 字段 / 可空性与任务单契约逐条比对；指标 / 阈值 / 枚举 / 版本号只引唯一真相源，消费端不复算；schema 版本号随数据下发；相近概念口径不混写                                                          |
| 遗留登记（Backlog & Readback）   | 框架 `docs/acceptance.md` §遗留 | 既有债已登记台账并标注影响面与排期，本任务不就地清理；openQuestions、manualReviewList 完整；任务单 + 交付记录成对归档，状态索引更新且 `history` 追加，台账 / wp-list / 阶段入口已回写                         |

## 2. 可脚本化命令清单（L0 由主控执行；L1 封装为工具）

```powershell
# 2.1 变更文件清单（对照任务单授权范围）
git -C <repo> status --short
git -C <repo> diff --name-status HEAD

# 2.2 engine-core 边界（应为空；非空须有例外批准记录）
git -C <repo> diff --stat HEAD -- src/engine-core

# 2.3 预期工件存在性 + 非空（路径来自任务单交付物清单）
Test-Path -LiteralPath <path>; (Get-Item -LiteralPath <path>).Length -gt 0

# 2.4 关键路径抽跑（单文件复现，用例数对照交付记录）
pnpm exec vitest run <key.spec.ts>

# 2.5 类型 / lint 快速复查（改动面未退化）
pnpm lint:fast
pnpm typecheck

# 2.6 状态索引一致性（taskId 存在、终态 history 闭合、工件指针路径存在）
# 由主控按 task-state-index.json 逐条核对；机读校验护栏 V1–V6 见框架 docs/tools.md §8；L2 可由脚本校验 schema 与指针
```

## 3. 本仓库特定核对项

- **engine-core 边界**：`git diff --stat HEAD -- src/engine-core` 为空，或有任务单内写明的例外批准记录；`boundary.spec.ts`（AST 护栏）未被修改。
- **前端边界**：`admin-dashboard/**` 不进后端 `tsconfig` 与 lint-staged；授权前端任务在前端目录跑前端脚本（`pnpm type-check` / `pnpm build-only`），不套用后端分号 / 折行风格（`conventions.md` §1.2）。
- **并行产物排除**：变更集不含其他 AI / 脚本的未提交产物；后端目录、前端文件、文档各自成组，不混进同一提交。
- **命令口径**：pnpm，禁裸 npx；前端既有类型债基线与本单新增改动分开记录，不把既有债误记为本单引入，也不在本单清理。
- **既有债基线**：性能基线与既有技术债口径见 `docs/team/gate-performance-remediation-2026-11-11.md`。

## 4. 结论分级（框架口径）

三级结论的判定条件见框架仓 `docs/acceptance.md`；本项目索引状态映射如下：

| 结论               | 条件                                                            | 索引状态                                      |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| `passed`           | 五类全清                                                        | `completed`                                   |
| `conditional-pass` | 主体合格，遗留显式登记且不阻塞当前交付                          | `completed`，遗留入 backlog                   |
| `rejected`         | 落地缺口 / 证据不实 / 越界改动 / 契约未对齐；写明原因与待补动作 | `rejected`，返修在同一 `contextId` 下新开任务 |

## 5. 仍由人工 / 主控判断、不脚本化的项

契约语义对齐、口径真相源是否唯一、偏差是否合理、失败项 flake 定性、范围外重构识别、验收分歧仲裁。
