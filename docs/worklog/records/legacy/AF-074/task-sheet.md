---
taskId: AF-074
contextId: phase2.5-orchestration-closed-loop
title: 框架收口：GUI 自动送达确认、验收字段标记与版本锚点
type: implementation
status: backlog
baselineRef: fbe2470ff9c421c84232d3f317636bbd49c71afc
dependsOn: []
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.3]
createdAt: 2026-11-18T03:25:37.268Z
deadline: null
agentRole: orchestrator
scope:
  files:
    - scripts/orchestration/acceptance-runner.mjs
    - scripts/orchestration/gui-dispatch.mjs
    - scripts/orchestration/gui-relay-send.ps1
    - scripts/orchestration/cli.mjs
    - scripts/orchestration/scheduler.mjs
    - scripts/orchestration/__tests__/orchestration.spec.mjs
    - scripts/orchestration/README.md
    - package.json
    - docs/team/wp-task-template.md
    - docs/team/agent-orchestration/README.md
    - docs/team/agent-orchestration/acceptance-checklist.md
    - docs/team/agent-orchestration/framework-version-anchor.md
    - docs/worklog/pending/
    - docs/worklog/completed/phase2.5/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase2.5/af074-framework-closeout-2026-11-18.md
    kind: report
gates:
  - command: corepack pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs
    check: 编排单测全绿
    threshold: 0 failed
  - command: corepack pnpm lint
    check: lint 全绿且 scripts 覆盖生效
    threshold: 0 error 0 warning
  - command: node scripts/orchestration/cli.mjs validate
    check: 状态索引、任务单、回执与契约目录全部 PASS
    threshold: exit 0
  - command: node scripts/orchestration/cli.mjs events verify
    check: 事件链与索引投影一致
    threshold: exit 0
successCriteria:
  - GUI 派发生成可执行 brief，含投递确认协议与 executor 禁止状态写命令
  - channel send 可驱动 MiniMax 窗口并在 dry-run/真实发送后写证据，不长期占用桌面
  - 只有 executor 写出 transport/acks/<taskId>.json 后才自动 confirm，缺失时按租约回滚
  - 验收 runner 识别交付记录六组机读标记及中文别名，模板同步更新且单测覆盖
  - 适配层文档明确 tag 对象与 commit 的区别、框架 main HEAD 锚点与契约包版本
  - 不新跑 LLM 批次、不改业务 src，定向闸门全绿
---

# AF-074 · 框架收口任务单

## 背景

AF-070…AF-073 已把编排 CLI、回执摄入、受保护 PR 与出口条件④判定跑通。当前剩余缺口集中在三处：

1. GUI 派发只到 `delivery.state=pending`，实际送达仍靠人工 `channel confirm`，无人值守场景会在投递租约后回滚。
2. `acceptance-runner` 按六个英文标记做文本字面匹配，而 GUI brief 写的是七组字段，口径漂移导致 AF-073 被判 `conditional-pass`。
3. 适配层文档把框架 `v2.0.0` 的 annotated tag object 写成 commit，且 tag 之后已有未发版规范提交；需要把“框架 release、contract bundle、main HEAD”三件事分开锚定。

## 范围

- 只改编排脚本、编排文档、任务模板与本任务交付记录。
- 不改 `src/`、`test/` 业务代码，不新跑 LLM 批次，不改数据库/Redis。
- 不新增框架仓 tag/release；框架版本口径只做适配层文档锚定，L4 冻结动作留给 Human 批准。
- MiniMax 自动化只走主桌面焦点窗口，不使用虚拟桌面/PiP，不代输凭据。

## 方案

### 1. GUI 送达与确认

- `gui-dispatch.mjs` 增加投递确认协议：brief 第 6 段要求 executor 收到后先写 `transport/acks/<taskId>.json`，并明确禁止执行 `task/run-once/archive/improvements transition` 等状态写命令。
- 新增 `gui-relay-send.ps1`：定位 MiniMax Code 主窗口，保存/恢复剪贴板，粘贴 brief 并发送，截取前后证据；支持 `-DryRun` 只验证定位与证据链、不发送。
- `cli.mjs channel send --taskId` 调用该脚本；`channel auto-confirm` 扫描 pending 投递的 ack 文件，只有 ack 存在且 taskId 匹配时才 confirm。
- `scheduler.mjs` 在每轮调度里先做 auto-confirm，再走失败/租约回滚；ack 缺失时不伪造送达。

### 2. 验收字段标记

- `acceptance-runner.mjs` 提取 `findMissingDeliveryMarkers(text)` 纯函数，支持六组英文标记与中文别名；保留“缺一即人工复核”的硬约束。
- 任务模板与验收清单补“机读字段标记”块，确保后续交付记录有稳定锚点。

### 3. 版本锚点

- 新增 `framework-version-anchor.md`，写清：
  - `v2.0.0` annotated tag object `c507188` 指向 commit `67d3290`；
  - 适配层 vendored contract bundle 仍为 `2.0.0`（14 文件哈希一致）；
  - tag 之后 relay §8.1/§8.2 等规范提交以 `main` HEAD `7395748` 为锚点，未发版；
  - 复现口径 = contract bundle + adapter code + framework main HEAD，而不是只写 tag。

### 4. 边界与不做的部分

- `IM-044` HTTP transport、`IM-046` 跨仓 commits schema、`IM-047` 生产收口清单不在本单实现；前两项涉及框架契约版本与 L3/L4，后一项用户已明确暂缓生产。
- `IM-043` 已由 `package.json` 的 scripts lint 配置实际闭环，本单只复核并在台账流转。
- `IM-052` 通过 brief 红线 + ack 确认降低越权面；CLI 角色硬隔离需要独立契约设计，登记为后续框架条目。

## 验证

- `gui-relay-send.ps1 -DryRun` 对当前 MiniMax 窗口返回窗口标题、证据路径与前后哈希。
- 单测覆盖 ack 缺失/存在、六组标记缺失/中文别名、brief 包含 ack 路径。
- `corepack pnpm lint`、编排单测、`cli validate`、`events verify` 全绿。
- 交付记录逐条写明实际命令、退出码与数字；不写“待用户执行”。
