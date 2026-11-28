# AF-603 · 五仓协作规范文档缺口补齐 · 交付记录

> 任务单：`docs/worklog/records/phase3-docs-governance/AF-603/task-sheet.md`
> 基线：`68cdd6c33800d032ba9755d0fba3bc7aba679834`（integrate）
> 类型：documentation（R0，纯规范文档与指令文件，零运行时代码改动）

## 1. 交付范围

| 编号 | 仓库 | 文件 | 动作 |
| --- | --- | --- | --- |
| A1 | xinsu-coordination | `README.md` | 补目录职责表（config / contracts / features / runtime / templates / tests）与 CLI 子命令速查表 |
| A4 | xinsu-coordination | `README.md` | 补前后端两份 `collaboration-workflow.md` 相对路径指针；协调仓不复制会话分工与进度状态 |
| A2 | mofang-psyguard | `AGENTS.md` | 新增冻结期 AI 指令入口：只读边界、架构位置、跨仓关系与会话纪律 |
| A3 | agent-collaboration-framework | `CHANGELOG.md` | `[Unreleased]` 修订号段收录 `docs/state-machine.md` §8.1 状态面存储锚点条款与锚点同步说明 |
| A3 | agent-collaboration-framework | `conformance/normative-anchors.json` | 为 state-machine §8.1 增列锚点条目：状态面存储锚点 / 本机持久目录 / 退役台账 |

## 2. 闸门证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 后端事件链 | `node scripts/orchestration/cli.mjs events verify` | PASS：事件日志 2541 条，哈希链与索引投影一致 |
| Framework 契约面 | `python conformance/run.py` | PASS：568 检查项，失败 0；锚点一致 29 项，fixtures 41/41 |
| 协调仓单测 | `python -m unittest discover -s tests` | PASS：8 tests OK |
| 协调仓工件校验 | `python cli.py validate` | 仅遗留 FEAT-VPT-REPORT-HISTORY 合同哈希漂移（旧战线，不在本单范围）；无新增失败 |

## 3. 边界与未做事项

- 未改任何 `src/`、测试代码、迁移、种子数据；PsyGuard Python 服务代码与部署文件零改动。
- NestJS / Flutter 根目录临时日志与排查脚本归档清理（B1）、AF-600 / AF-601 / AF-602 历史回执 schema 修复（B2）均为独立任务，需另行登记并授权。
- VPT 报告合同哈希漂移阻塞项保持原状，待对应任务单接单处理。

## 4. 编码口径

任务单、交付记录与新增指令文件统一 UTF-8 无 BOM + LF；跨仓路径在协调仓 README 中使用相对路径，链接目标已核实存在。
