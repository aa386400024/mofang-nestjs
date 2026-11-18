---
taskId: AF-069
contextId: phase2.5-orchestration-closed-loop
title: Relay Supervisor：事件驱动回执回收与按档位兜底
type: implementation
status: backlog
baselineRef: 741c3fe30c59ecae72455dc27a1612f34f25798f
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T00:55:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/
    - docs/team/agent-orchestration/
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
    - package.json
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af069-relay-supervisor-implementation-2026-11-18.md
    kind: report
gates:
  - command: node --check scripts/orchestration/relay-supervisor.mjs
    check: supervisor 入口语法检查
    threshold: exit 0
  - command: pnpm exec vitest run scripts/orchestration/__tests__/relay-supervisor.spec.mjs
    check: 回执 supervisor 定向单测全绿
    threshold: 0 failed
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: 0 error
  - command: pnpm lint
    check: lint 0 error
    threshold: 0 error
  - command: pnpm orchestration:validate
    check: 编排索引与契约校验通过
    threshold: exit 0
  - command: pnpm orchestration:events verify
    check: 事件日志哈希链与投影一致
    threshold: exit 0
successCriteria:
  - 新增 relay-supervisor 本地常驻工具，采用文件系统事件优先、按任务档位 10 至 15 分钟兜底扫描的回收方式
  - 任务级账本记录 taskId、精确回执文件、profile、nextCheckAt、attempts、deadline、state 与处理历史，不使用全局通配扫描
  - 单实例锁、原子写、文件稳定判定、命中后归档与通知、超时后报告并停止，均具备可复现单测
  - 不创建永久 Doubao cron，不扫描无关 relay-response 文件，不修改业务代码与 engine-core
  - 回写框架 §8.2、适配层 README §5 与 minimax-code-relay Skill，明确事件优先与兜底扫描口径
  - 交付记录与机读回执六组字段齐全，闸门数字可复现
---

# AF-069 · Relay Supervisor：事件驱动回执回收与按档位兜底

> 状态：📋 待执行（2026-11-18）
> 执行方：自做（orchestrator）
> 仓库：D:\work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：框架仓 `docs/autonomous-loop.md` §8.1 / §8.2；本仓 `docs/team/agent-orchestration/README.md` §5
> 任务性质：本地编排工具链 + 契约回写
> 改动范围：仅后端 scripts / docs / package.json；不碰 src、test、admin-dashboard、engine-core

## 1. 背景

MiniMax Code 的回执回收目前依赖 Doubao 定时任务。实测 Doubao cron 最小间隔为 1 小时，10–15 分钟只能用一次性 `at` 或本地常驻进程。永久 cron 扫目录已被 §8.2 明确禁止，且反复占用调度器与桌面控制权。

本任务落地本地 Relay Supervisor：文件系统事件负责秒级发现，任务级兜底扫描负责补事件丢失与进程重启；不再用永久通配 cron。

## 2. 范围

**在范围内：**

- `scripts/orchestration/relay-supervisor.mjs`：本地 supervisor 入口、任务账本、watch/tick/register/list/inbox/ack/cancel。
- `scripts/orchestration/__tests__/relay-supervisor.spec.mjs`：纯函数与临时目录集成测试。
- `package.json`：新增 `orchestration:relay` 脚本。
- `docs/team/agent-orchestration/README.md` §5：把“分钟级自适应间隔暂不实现”改为现行口径。
- `docs/team/agent-orchestration/tools/TOOL-RELAY-SUPERVISOR.json`：工具契约声明。
- 任务单、交付记录、durable 回执。
- 框架仓 `docs/autonomous-loop.md` §8.2、`docs/reliability.md` §3、`docs/evolution.md` §3.1、`CHANGELOG.md`、`conformance/normative-anchors.json`。
- `minimax-code-relay` Skill §9.2：改为注册 relay job + 本地 supervisor，保留 `at` 降级。

**明确不在范围内：**

- 不改 `src/`、`test/`、`engine-core/`、`admin-dashboard/`、数据库、Redis、LLM 调用。
- 不创建永久 Doubao cron；不扫描 `relay-response-*.md` 全目录。
- 不把心理对话原文写入日志或通知；只记录路径、大小、状态与计数。
- 不顺手重构既有编排 CLI / scheduler。

## 3. 目标架构

- **事件优先**：`createWatcher` 监听 `docs/worklog/pending/`，只对已注册任务的精确文件名触发。
- **兜底扫描**：每个 job 按 profile 计算 `nextCheckAt`；watch 内定时器只检查到期 job，不扫描目录。
- **档位**：
  - S：10 / 10 / 15 分钟，deadline 45 分钟。
  - M：10 / 15 / 15 / 20 分钟，deadline 90 分钟。
  - L：15 / 15 / 20 / 30 / 30 分钟，deadline 180 分钟。
  - XL：15 / 20 / 30 / 45 / 60 分钟，deadline 240 分钟。
- **账本**：`docs/team/agent-orchestration/transport/relay-jobs.json`（gitignored）。
- **通知**：`transport/relay-notifications/<taskId>.json|md`，命中后写入；`inbox` 读取未读通知。
- **归档**：命中后把回执文件移入 `docs/worklog/pending/archive/`；通知与审计只留指针。
- **可靠性**：单实例锁、原子写、文件稳定判定（size>0 且 mtime 稳定）、崩溃后重启对账、超时停止。

## 4. 红线

- 不把“事件到达”当成“文件写完”：必须等大小非零且修改时间稳定。
- 不把“通知”当成“验收”：回执原文归档后由主控读取并摘要，验收仍走既有回执链。
- 不创建永久任务；job 命中或超时后停止，`ack` 清理。
- 不记录对话正文；通知只含路径、大小、时间、状态。
- 不修改 `engine-core`；不改业务代码。

## 5. 闸门

| 目的     | 命令                                                                             | 要求     |
| -------- | -------------------------------------------------------------------------------- | -------- |
| 语法     | `node --check scripts/orchestration/relay-supervisor.mjs`                        | exit 0   |
| 定向单测 | `pnpm exec vitest run scripts/orchestration/__tests__/relay-supervisor.spec.mjs` | 0 failed |
| 类型     | `pnpm typecheck`                                                                 | 0 error  |
| Lint     | `pnpm lint`                                                                      | 0 error  |
| 编排契约 | `pnpm orchestration:validate`                                                    | exit 0   |
| 事件链   | `pnpm orchestration:events verify`                                               | exit 0   |
| 边界     | `git diff --stat HEAD -- src/engine-core`                                        | 空       |

## 6. 交付物

1. `relay-supervisor.mjs` 与测试。
2. `package.json` 脚本 `orchestration:relay`。
3. 适配层 README §5、工具契约 JSON。
4. 框架仓 §8.2 回写（事件优先 + 兜底扫描）。
5. Skill §9.2 回写。
6. 交付记录 + 机读回执 + durable 副本。

## 7. 回写清单

- [ ] 任务单归档到 `docs/worklog/completed/phase2.5/`
- [ ] 交付记录写入固定路径
- [ ] 机读回执六组字段齐全
- [ ] durable 回执副本进 `docs/worklog/pending/archive/`
- [ ] 状态索引经 CLI 更新
- [ ] 框架仓提交/推送
- [ ] 事件链 `events verify` 通过

## 8. 回复输出约定

完成后在对话里报告：交付记录路径、闸门真实数字、状态面是否闭合、框架仓与 Skill 是否已回写。
