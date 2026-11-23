# AF-400 · 编排健康回执误报修复

- 日期：2026-11-24
- 任务：AF-400
- 分支：`task/AF-400-orchestration-health`
- 基线：`e89b2a2471f5feb0407d5ff9d5440b62eb01b1d0`

## 一、问题

`node scripts/orchestration/cli.mjs status` 的运行健康区长期显示 `回执校验失败=2`，条目为已归档的 AF-382、AF-389。根因：`printOperationalHealth()` 直接遍历 `runtime.tasks`，没有按 `index.tasks` 过滤终态任务，归档任务的陈旧运行态残留被继续计入。

## 二、修复

在 `printOperationalHealth()` 内建立 `activeTaskIds`（来自 `index.tasks`），所有运行态统计改为只遍历 `activeRuntimeEntries`：

- `leaseExpired`
- `receiptErrors`
- `receiptNoDigest`

死信与人工持单原本已基于 `index.tasks`，保持不变。

## 三、闸门

- `node scripts/orchestration/cli.mjs status`：`回执校验失败=0`，AF-382 / AF-389 不再出现；`租约过期释放=0`、`回执无指纹=0`。
- `pnpm lint`：exit 0，0 error。

## 四、影响

只影响编排状态展示，不改任务状态、事件链、回执与验收逻辑。
