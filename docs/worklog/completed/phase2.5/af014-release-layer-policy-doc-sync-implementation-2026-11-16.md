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

# AF-014 · 分层发布口径同步 — 交付记录

- **状态**：✅ 已交付（2026-11-16，纯文档 / 声明件；零业务源码改动）
- **基线 HEAD**：`7b75137`（与 `origin/integrate` 一致）
- **编排**：主控 Doubao（orchestrator 自做）｜**任务性质**：活文档与 Agent Card 口径修订；不实现分支脚本与派发链路
- **方案契约**：`docs/team/agent-orchestration/autonomous-team-design.md` §6（分层发布与回退，§6.1 分层表 / §6.2 L3 过渡口径 / §6.3 回退五道保障）、§10（边界与不做项）、§8 P0-6；框架仓 `docs/roles.md`、`docs/autonomous-loop.md` §3（冻结动作表）

---

## 一、本单做了什么（一句话）

把 README §2 角色绑定、§4 敏感操作行与三份 Agent Card 的 limits 从旧口径「git commit / push 绑定 Human 批准；AI 不自动 commit / push」改为引用设计备忘 §6.1 的 L1–L4 分层模型：L1 任务分支提交、L2 推任务分支、L3 合并进 integrate 在闸门绿 + 验收五类通过等前置条件下由 orchestrator 自动，L4（master 合并、tag、release、对外部署等）保留人工冻结；分层定义唯一真相源留在设计备忘 §6，README / 角色卡 / 任务单模板只引用、不复制阈值与流程正文。

## 二、改动文件清单

| 文件                                                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/team/agent-orchestration/README.md`                                                | §2 角色绑定三行改写：Human 改为「审批 L4 冻结动作；L1–L3 不依赖 Human 批准」；orchestrator 补「验收后执行 L1 提交 / L2 推任务分支 / L3 合并进 integrate（前置条件见 §6.1/§6.2）；L4 转人工」；executor 明确「不建分支、不提交、不推送（提交归 orchestrator，见 §6.1 L1）」。§4 敏感操作行由「AI 不自动 commit / push」改为分层引用 §6.1，保留 L4 冻结清单，engine-core 例外改动仍需人工批准 |
| `agent-cards/orchestrator.json`                                                          | `canDo` 增 L1–L3 自动动作及前置条件（收尾闸门绿、验收五类通过、分支命名合规、无文件域冲突、提交可回退）；`cannotDo` 增 L4 冻结边界清单；`requiresApproval` 的「git push」细化为 L4 冻结动作清单；`note` 补发布分层说明。既有字段与条目只增不删                                                                                                                                              |
| `agent-cards/executor.json`                                                              | `cannotDo` 由「不自动 commit / push」改为「不建分支、不提交 commit、不推送（提交归 orchestrator，见 §6.1 L1）」；`requiresApproval` 的提交 / 推送条目细化为「executor 一律不提交；提交与推送由 orchestrator 按 §6.1 分层执行」；`note` 补本角色不进入分支与提交链路                                                                                                                         |
| `agent-cards/human.json`                                                                 | `canDo` 的「决定 git commit / push」替换为「审批 L4 冻结动作：master 合并、tag、release、对外部署、策略例外、路线选型、跨任务变更、验收分歧、新增未声明依赖」；`note` 补 L1–L3 不依赖本角色批准。`cannotDo` / `requiresApproval` 字段保留                                                                                                                                                   |
| `docs/team/wp-task-template.md`                                                          | §2（不在范围内）、§4（红线）、§7（交付回写清单）三处旧「不自动 commit/push」表述改为引用 §6.1 分层口径；模板结构、字段骨架与其余条目未改                                                                                                                                                                                                                                                    |
| `docs/team/agent-orchestration/autonomous-team-design.md`                                | §3 问题台账 G6 行补「已闭环（AF-014）」标注；§6.4 由「既有口径待同步」改为「既有口径同步记录」，写明 AF-014 落地范围与 SSOT 口径（定义留 §6.1，引用件不复制正文）                                                                                                                                                                                                                           |
| `docs/team/agent-orchestration/improvement-log.json`                                     | 登记候选 IM-016（见 §五）                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/team/agent-orchestration/orchestration-snapshot.json`、`web/orchestration/data.js` | CLI 双写刷新（台账条目与队列快照同步）                                                                                                                                                                                                                                                                                                                                                      |

### 2.1 口径对齐（SSOT 与框架锚点）

- **分层真相源唯一**：L1–L4 定义、前置条件与冻结清单只写在设计备忘 §6.1；README、角色卡、模板均以相对链接或文字引用指向 §6.1，不复制层内流程与阈值数值。
- **L1**：任务分支提交，验收后由 orchestrator 提交，executor 不提交；前置 = pre-commit 钩子 + 收尾闸门绿。
- **L2**：推送任务分支到 origin，可自动；前置 = 闸门绿、验收五类通过、分支命名合规。
- **L3**：squash merge 进 integrate + 推送 integrate，可自动；前置 = 本地等价闸门全绿、无文件域冲突、提交可回退。L3 过渡口径（本机无 gh / token、本地闸门替代远端 CI 门禁）沿用 §6.2，**未写成永久设计**；目标态为接入 token / gh 后以 CI 状态作为自动合并门禁（§8 P2）。
- **L4**：master 合并、tag、release、对外部署，人工冻结；对齐框架 `autonomous-loop.md` §3.2 冻结动作表（对外发布 / 策略例外 / 路线选型 / 跨任务变更 / 验收分歧 / 依赖变更）。
- **角色隔离不变**：executor 维持「不建分支、不提交、不推送」；orchestrator 的 L1–L3 自动不解除验收前置——五类核对与抽跑复现仍是 L3 前置条件，执行侧「已通过」自述不作为验收依据（§10 末条）。
- **框架通用层关系**：框架 §3.2 把 `git push` 整体列作「对外发布」冻结项；本适配层在不违反通用层的前提下细化——任务分支与 integrate 推送属内部集成分支（非对外发布），满足前置条件可自动；对外发布（master / tag / release / 部署）仍冻结。该细化关系在 README §4 与角色卡 note 中以 §6.1 引用承载。

### 2.2 零改动确认

- `src/engine-core/`、`src/migration/`、`src/**/*.ts` 业务代码、整个 `test/`、`bin/`、`scripts/orchestration/` —— **零 diff**（`git diff --stat HEAD -- src test` 为空；本单未触碰编排脚本，AF-013 脚本改动另见 AF-013 交付记录）。
- **未新增第三方依赖**；未改动 `package.json` / lockfile / CI 工作流；未执行 `development` 分支退役。
- Agent Card schema：`limits` 下 `canDo` / `cannotDo` / `requiresApproval` 三个字段保留，未删键；新增内容均为字符串条目；JSON 可被现有解析器读取（schema `additionalProperties: true`，未引入新字段组）。

## 三、关键决策与偏差

1. **引用而非复制**：分层表、前置条件、过渡口径全部留在设计备忘 §6；引用件只写角色边界结论 + 锚点链接，避免口径多份副本漂移（docs-governance SSOT 原则）。
2. **executor 边界保持不变**：旧口径「executor 不提交」在新模型下仍然成立（§6.1 L1 明确 executor 不提交），本单只把措辞从笼统的「不自动 commit/push」细化为「不建分支、不提交、不推送」，并指向 orchestrator 提交链路。
3. **Human 边界收窄到 L4**：旧口径把所有 commit / push 归 Human 批准；新模型下 L1–L3 在前置条件满足时自动，Human 只保留 L4 冻结动作与策略 / 路线 / 跨任务 / 分歧 / 依赖变更审批。
4. **遗留活规范未就地改（范围纪律）**：`conventions.md` §132 与 `relay-receipt-template.md` §68 两处仍为旧口径，但不在任务单 §2 列明范围内；按「不顺手越界」原则登记 IM-016 另案，本单不改（见 §五）。
5. **偏差**：无。任务单 §2 范围内落地；未调整角色职责划分与资源域，未实现分支脚本或派发链路（归 AF-010 / AF-012）。

## 四、闸门证据

| 命令                                                         | 退出码 | 结果                                                                                                                                             |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| JSON 可解析校验（`Test-Json` × 5：三份角色卡 + 索引 + 台账） | 0      | 5 / 5 `jsonValid=True`                                                                                                                           |
| 编码探测（BOM / CR）                                         | —      | 5 个 JSON 均 `bom=False`、`cr=0`（纯 LF）                                                                                                        |
| `pnpm lint:fast`（`oxlint src test bin`）                    | 0      | 0 warning / 0 error，1350 文件                                                                                                                   |
| Markdown 链接核对                                            | —      | README §6.1 锚点同目录 `autonomous-team-design.md` 存在；模板引用 `agent-orchestration/autonomous-team-design.md` 相对 `docs/team/` 存在；无断链 |
| 旧口径残留 grep                                              | —      | 活文档内 README / 三份角色卡 / 模板旧口径已清零；剩余命中逐条归类见 §五                                                                          |

- **未跑全量测试与 typecheck**：纯文档单（任务单 §5），改动不进入 `src/test` 运行时；`lint:fast` 范围仅 `src/test/bin`，docs JSON / MD 不经 oxlint，跑取证确认既有代码面未退化。

## 五、遗留与未决

- **IM-016（candidate · adapter · standard · review · related AF-014）**：`docs/team/conventions.md` §132 与 `docs/team/agent-orchestration/relay-receipt-template.md` §68 仍保留旧「不自动 commit/push」口径，未对齐 §6.1。建议另开规范同步单：两处改为引用 §6.1 分层口径；executor 不提交口径保留，L1–L3 自动前置条件与 L4 冻结清单指向 §6.1。
- **历史只读豁免（不改，仅归类）**：`docs/worklog/archive/`、`docs/worklog/pending/archive/` 回执、`docs/worklog/audits/`、`docs/archive/`、`docs/reference/`、`docs/architecture/` 三份留档（`multi-agent-collaboration-loop-design`、`multi-agent-baseline-profile`、`orchestration-l1-l3-evolution-plan`）与 `docs/team/gate-performance-remediation-2026-11-11.md` §532 中的旧表述均为历史记录或架构留档，按只读纪律不就地改写。
- **L3 过渡口径未固化为目标态**：本机无 gh CLI、无 GITHUB_TOKEN，远端 CI 状态本机不可读；当前以本地等价闸门替代远端 CI 门禁（§6.2）。接入 token / gh 后改为 CI 状态门禁，归 §8 P2 演进。
- **后续未决口径（沿用 AF-013 台账 IM-014 / IM-015）**：通道层重试预算、失败权威终态出口、熔断阈值归属、失败定性三分法字段，待跨两仓文档修订时统一。

## 六、审计链与回写清单

- [x] 交付记录落固定路径；任务单与交付记录成对归档 `completed/phase2.5/`
- [x] 索引状态迁移追加 `history`，工件指针（任务单 / 交付记录）填全；AF-014 为纯文档单，无回执工件
- [x] 快照与看板 data.js 经 CLI 双写刷新
- [x] `taskId`（AF-014）贯穿任务单 / 交付记录 / 台账 IM-016 关联 / commit message
- [x] 并行线产物 `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 未混入本单 stage；运行态 `transport/`、`orchestration-store.sqlite`、`tool-audit-log.json` gitignore 不入库
- [x] 旧口径残留 grep 归零（活文档）或逐条标注为历史只读（§五）
