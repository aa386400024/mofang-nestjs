---
taskId: AF-015
contextId: phase2.5-orchestration-closed-loop
title: 通道可靠性口径锚定与补全（终态出口 / 任务级重试预算 / 退避序列 / 失败定性三分法 / 逐次留痕）
type: implementation
status: completed
baselineRef: f6f69b1
dependsOn: [AF-013, AF-014]
policyRefs: [framework/reliability.md, autonomous-team-design.md#gui-channel]
createdAt: 2026-11-16
---

# AF-015 · 通道可靠性口径锚定与补全

> 状态：✅ 已交付（2026-11-16）｜编排：主控 Doubao（orchestrator 自做）｜交付记录：af015-channel-reliability-policy-anchor-implementation-2026-11-16.md
> 仓库：`E:\Work\Project\backend\mofang-nestjs`；落点 `scripts/orchestration/dispatch-channel.mjs`、`__tests__/orchestration.spec.mjs`、设计备忘 §3、`conventions.md`、回执模板、改进台账
> 唯一事实源：框架仓 `docs/reliability.md` §3 / §4 / §5（通用重试、失败定性、熔断死信预留位）；本仓 `autonomous-team-design.md` §3（通道落地口径）、§6.1（发布分层）
> 任务性质：adapter 层纯规则 + 单测 + 活文档口径修订；零业务源码改动、零进程 / 剪贴板 IO、零新增依赖

## 0. 【必读入口】动手前按顺序读完

1. 框架仓 `docs/reliability.md` §3（租约超时与重派）、§4.1（可恢复 / 不可恢复四类）、§4.2（失败定性三分法 + 基线当场复核）、§5（熔断 / 死信预留位）、§7（终态不重启）
2. 本仓 `docs/team/agent-orchestration/autonomous-team-design.md` §3（派发通道）、§6.1（发布分层）、§8（P0 / P2 台账）
3. 回执 `docs/worklog/pending/archive/relay-response-af013-drill-20261116.md`：12 条差异 / 缺口（D-1~D-12）与 5 个开放问题（OQ1~OQ5）
4. `scripts/orchestration/dispatch-channel.mjs` 既有纯函数签名与 `__tests__/orchestration.spec.mjs` AF-013 测试段

## 1. 背景

AF-013 演练回执核对出通道设计备忘 §3 与框架 `reliability.md` §4 在方向上 6 项一致，但存在 12 条差异 / 缺口：通道两条重试规则未锚定框架 §4（共同根因，D-10）、失败终态出口双轨（D-5）、确定性缺陷无终止规则（D-7）、无指数退避（D-2）、无任务级统一预算（D-4）、缺定性三分法字段（D-1）、审计无逐次留痕载体（D-3）、基线分栏无载体（D-11）、重派策略无依据（D-6）、熔断 / 死信成熟度标注不一致（D-9）、演练基线概念缺失（D-8）、不可恢复无枚举映射（D-12）。本单在 adapter 层把上述口径锚定框架并补全枚举、预算、审计字段；框架通用规则正文留在框架仓，本仓只引用不复制（SSOT）。

## 2. 范围（严格遵守，不越权）

**在范围内：**

- `dispatch-channel.mjs`：新增任务级总尝试预算 `MAX_TOTAL_ATTEMPTS`、指数退避序列 `BACKOFF_MS` 与 `nextBackoff`、不可恢复四类枚举 `IRRECOVERABLE_CAUSES` 与 `isIrrecoverable`、定性三分法 `FAILURE_CLASSIFICATIONS`；决策补终态出口（登录门 → 人工；不可恢复 → `failed`；预算耗尽 → `held-ready` 升级；其余动作 `result: null`）；审计补 `classification`、`baseline{legacyDebt,changeIntroduced}`、`attempts` 逐次留痕数组及枚举校验；预留位常量 `CIRCUIT_BREAKER_RESERVED` / `DEAD_LETTER_RESERVED`；聚合把 `held-ready` 计入未成功；既有导出签名向后兼容。
- 单测：覆盖不可恢复短路与登录门优先、任务级预算封顶、退避序列、审计定性 / 基线 / 逐次留痕校验、路径聚合与预留位常量。
- 设计备忘 §3：锚定 §4，补任务级预算与降级计次、退避口径、终态出口映射、定性三分法与基线分栏、逐次留痕、重派策略、熔断 / 死信预留位、通道演练基线；§6.4 追加 AF-015 同步记录。
- IM-016 两处活规范对齐 §6.1：`conventions.md` §132、`relay-receipt-template.md` §68。
- 台账：IM-004 / IM-014 / IM-015 / IM-016 流转终态；受环境 / 高风险约束的未决项登记 IM-017 / IM-018 / IM-019。

**明确不在范围内：**

- 不改框架仓 `reliability.md`（通用层已完备，本仓只锚定引用）；不实现通道侧独立熔断计数、隔离区或阈值参数化（归 P2，IM-017）；
- 不接入远端 CI 状态门禁（本机无 gh CLI / token，IM-018）；不执行 `development` 分支退役删除（待人工拍板，IM-019）；
- 不清算既有历史技术债 IM-001 / 002 / 003 / 005~013；不改业务代码、测试、配置，不新增依赖；进程 / 窗口 / 剪贴板 IO 仍留 relay 层注入接口位，模块内零 IO。

## 3. 目标架构 / 交付物

- **交付物 1：通道纯规则扩展** —— `dispatch-channel.mjs` 枚举、预算、退避、终态出口、审计字段与预留位；纯函数可替身单测。
- **交付物 2：单测覆盖** —— 编排层 vitest 全绿，新增分支与枚举均有用例。
- **交付物 3：备忘与活规范口径** —— §3 锚定 §4 并补落地口径；两处规范对齐 §6.1；台账闭环与未决登记。

## 4. 红线（违反即返工）

- 框架通用规则正文不复制进本仓；本仓只写通道侧枚举、预算数值与审计字段，并以相对 / 文字锚点指向 `reliability.md` §4 / §5。
- 审计载体仍不含消息正文；`attempts` 每项只留路径 / 层 / 原因 / 退避 / 结果 / 时间戳。
- 既有导出签名与行为保持向后兼容；JSON 无 BOM、纯 LF；历史交付记录与已归档文档只读不改。
- 不把过渡方案（无 gh / token、本地闸门替代远端 CI）写成永久设计；目标态在备忘 §6.2 与台账标注。

## 5. 闸门（实施时填真实数字）

编排层定向 vitest；`pnpm lint:fast`；CLI `validate`（索引 / 工具契约 / 三角色卡 schema）；JSON `Test-Json`；编码探测（BOM / CR）；`git diff --stat HEAD -- src test` 为空。纯规则 / 文档单不跑全量 typecheck（改动不进入 `src/test` 运行时），在交付记录注明。pnpm 强制；本立项单不跑闸门。

## 6. 交付记录路径（实施完成后）

`docs/worklog/completed/phase2.5/af015-channel-reliability-policy-anchor-implementation-{{YYYY-MM-DD}}.md`

## 7. 回写清单（实施完成后）

- [ ] 交付记录落固定路径；任务单与交付记录成对归档；索引 / 快照 / 看板 data.js / 阶段入口 README 同步回写；
- [ ] 回执 12 条 D 差异逐条映射到落地或保留口径；5 个开放问题结论写入交付记录；
- [ ] 审计链闭合：`taskId`（AF-015）贯穿任务单 / 交付记录 / 台账关联 / commit message。
