# AF-604 交付记录 · 更新协作备忘：小豆编排口径、任务单模板字段与任务执行技能隔离说明

## 1. 任务与授权

- 任务单：`docs/worklog/records/phase3-docs-governance/AF-604/task-sheet.md`
- 执行仓 / 类型：mofang-nestjs-af070 / documentation
- 基线 / 分支：`fe845ffb3b7634fb6f7c7d4971c5bc8b51eb4f9a` / `integrate`
- 授权与前置门禁：任务单登记后提级至 ready；本单由小豆（主会话编排中枢）直接交付，不派发 Flutter / NestJS 会话编码
- 回执：`docs/worklog/records/phase3-docs-governance/AF-604/receipt-RC-AF-604-1.json`

## 2. Scope 与排除项

- 允许改动：`docs/team/agent-orchestration/collaboration-workflow.md`；AF-604 记录包与交付记录
- 排除项：`src/`、测试代码、迁移、种子数据、运行配置、环境启停脚本；PsyGuard Python 服务代码与数据；framework 仓 schema、契约、校验器与 conformance 规则
- 授权交付物：本交付记录与回执
- 开工前并行 / 既有改动：工作区既有 worklog migrate 遗留改动（manifest 刷新与回执迁移件）保持挂起，不纳入本单提交

## 3. 实现摘要

协作备忘按 AF-604 任务单更新：

1. 角色表把主会话职责明确为小豆编排中枢：需求接收、标准化任务单、状态跟踪、阻塞跟进、台账维护、进度汇总；边界为不包揽复杂核心开发、深度架构推敲与大型模块代码评审。
2. 新增轻量 / 核心分流判定：轻量为一次性脚本、只读查询、文案与备考资料整理、笔记结构化、文档规范化、台账只读核对；核心为 Flutter 业务页面与 bloc、NestJS 接口服务与 Qdrant 检索、framework 规范件变更、跨仓评审及涉及数据结构、迁移、权限会员、语音对练、AI 评审链路的功能。
3. 任务单固定字段落备忘：编号、scope 范围、前置门禁、验收清单、依赖任务、截止时间、执行方式、分流依据、台账归属。
4. 执行技能 `xinsu-task-executor` 隔离说明：技能无状态幂等；会话容器隔离；状态落在任务单与 NestJS `docs/worklog` 台账；Flutter 会话只读前端任务单，NestJS 会话只读后端任务单；跨仓依赖任务后端先闭环、前端跟随。
5. 回执回流边界：回执交回小豆复核闸门证据、changedFiles 与 scope 后更新台账；技能不假设自动跨应用通道，不宣称自动通知或自动更新台账。
6. 备忘旧称谓统一对齐为“小豆（编排中枢）”；Framework 评审行标注为小豆与 framework 仓协作，避免后续把编排职责误读为游离的独立主会话。

## 4. 实际改动文件

- 新增：
  - `docs/worklog/records/phase3-docs-governance/AF-604/task-sheet.md`
  - `docs/worklog/records/phase3-docs-governance/AF-604/receipt-RC-AF-604-1.json`
  - `docs/worklog/records/phase3-docs-governance/AF-604/manifest.json`
  - `docs/worklog/completed/phase3-orchestration/af604-collaboration-workflow-update-2026-11-28.md`
- 修改：
  - `docs/team/agent-orchestration/collaboration-workflow.md`
  - `docs/team/agent-orchestration/orchestration-snapshot.json`、`docs/team/agent-orchestration/state/journal.jsonl`、`docs/team/agent-orchestration/task-state-index.json`、`web/orchestration/data.js`（CLI 写入的任务投影与台账快照，非手工状态面编辑）
- 删除：无
- 删除引用核对：不适用

## 5. 验收清单

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 小豆编排职责口径写入备忘 | pass | 备忘 §2 角色表小豆行 |
| 轻量 / 核心分流判定写入备忘 | pass | 备忘 §2.1 分流判定表与边界说明 |
| 任务单固定九字段写入备忘 | pass | 备忘 §2.2 字段清单 |
| 执行技能隔离机制写入备忘 | pass | 备忘 §2.3 会话隔离、状态归属、分流约定 |
| 回执回流边界写入备忘 | pass | 备忘 §2.4 |
| 改动仅落在授权文档文件 | pass | 回执 scopeCheck=in-scope；src / 测试 / 迁移 / 种子 / PsyGuard / framework 规范件零改动 |
| 备忘引用路径真实存在 | pass | 备忘既有锚点路径核对，无新增悬空链接 |

## 6. 闸门证据

| 实际命令 | 退出码 | 错误 | 警告 | 用例 / 文件等关键数字 | 原始证据 |
| --- | ---: | ---: | ---: | --- | --- |
| `node scripts/orchestration/cli.mjs events verify` | 0 | 0 | 0 | 事件日志 2545 条；schema state-event 1.0.0；哈希链与索引投影一致 | CLI stdout |
| `node scripts/orchestration/cli.mjs validate --sheet docs/worklog/pending/phase3-docs-governance-af604-collaboration-workflow-update-2026-11-28.md` | 1（仅历史遗留失败） | 3 | 0 | 任务单元由 register 摄入；状态索引 PASS；既有 FAIL 仅 AF-600 / AF-601 / AF-602 历史回执 schema 缺口，非本单引入 | CLI stdout |

复现说明：先 `events verify` 核对事件链；再跑 `validate` 核对任务单与既有回执。纯文档任务，无测试代码、无迁移、无种子数据、无状态面手工编辑；状态事件由 CLI 登记、提级、领单写入。

## 7. Scope、契约与并行隔离

- `scopeCheck`：`in-scope`；依据：改动文件对照任务单 scope 清单，备忘为唯一修改的规范文档
- 并行产物已排除：`true`；依据：既有 migrate 遗留改动未纳入本单 changedFiles 与提交
- 无越界重构：`true`
- 契约核对：taskId 贯穿任务单、记录包、交付记录与回执；状态写入口仅经后端 CLI；回执六组必填字段齐备
- 字段对齐：任务单 successCriteria 逐条落地到备忘对应小节
- Framework 规范件：未修改
- PsyGuard：未触碰

## 8. 偏差、遗留与人工复核

- 偏差：无；`deviationAbsent=true`
- Backlog：
  - AF604-B1：前端协作备忘（xin_su_app）与 framework 适配层引用对齐本口径，跨仓文档改动在各自任务单授权下执行
  - AF604-B2：AF-600 / AF-601 / AF-602 历史回执 schema 缺口、VPT 报告合同哈希漂移、根目录临时日志清理保持既有遗留战线，不在本单范围
- 未决问题：无
- 人工 / 小豆复核：回执回收后由小豆复核闸门证据与 scope，再更新台账

## 9. 提交、推送与结论

- Commit：随本单任务分支提交；后端 `integrate` 保护分支需走标准 PR，本地提交状态以仓库 git 记录为准
- Push / PR：跨仓同步前端备忘与 framework 引用前，不在本单推送
- `finalStatus`：`completed`
- `reviewVerdict`：`passed`
- 结论依据：备忘五组口径全部落地；事件链 verify PASS；改动限定规范文档，无越界重构、无并行产物混入；遗留项已编号记录。
