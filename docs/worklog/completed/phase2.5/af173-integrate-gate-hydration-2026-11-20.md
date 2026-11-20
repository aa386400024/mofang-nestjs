# AF-173 交付记录 · integrate 编排门历史任务单容错

- 日期：2026-11-20
- 任务：AF-173
- 角色：orchestrator（主 AI 自做）
- 分支：task/AF-173-integrate-gate-hydration
- 关联：integrate cb262d6 Orchestration Gate 失败日志、AF-172

## 1. 问题

AF-172 squash 提交 cb262d6 把 464 份 record bundle 一次性入库。push 到 integrate 后，
`ci-task-gate` 的 squash hydration 遍历所有“任务单在本次提交中变化”的归档任务，
把早于 1.1.0 契约、缺 frontmatter 的历史任务单当主任务解析，抛出
`任务单 frontmatter 缺失`，导致 integrate 的 Orchestration Gate 失败。

## 2. 改动

- `scripts/orchestration/ci-task-gate.mjs`
  - 新增 `tryParseTaskSheetScopeForGate`：次要任务容错解析，无法解析返回 null。
  - squash hydration 改为：文件不存在或解析失败的历史任务单跳过，不贡献 scope；
    主任务仍走 `readTaskSheetAt` 严格解析，失败立即阻断。
- `scripts/orchestration/__tests__/orchestration.spec.mjs`
  - 新增 AF-173 单测：缺 frontmatter、taskId 不匹配返回 null；合法任务单正常解析。

## 3. gateResults

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs` | 258 tests passed |
| `pnpm lint` | exit 0 |
| `node scripts/orchestration/ci-task-gate.mjs --base bb46bf4 --head cb262d6` | PASS total=1 passed=1 |
| `node scripts/orchestration/cli.mjs worklog verify --strict` | PASS 活跃=1 归档=186 记录包=187 |

## 4. scopeCheck

改动仅 `scripts/orchestration/` 与 `docs/worklog/`、`docs/team/agent-orchestration/`。
未改 `src/`、`bin/`、`admin-dashboard/`。

## 5. contractChecks

- taskId：AF-173，与任务单一致。
- 主任务严格解析：保留 `parseTaskSheetScopeForGate`，不降级。
- 次要任务容错：只跳过、不放宽 scope 判定。
- 事件链与记录包：`worklog verify --strict` 通过。

## 6. backlogItems

无新增遗留。建议后续把历史任务单批量补齐 1.1.0 frontmatter，消除容错分支的长期依赖。

## 7. deviationTable

无偏差。修复面与任务单一致。

## 8. reviewVerdict

passed。integrate squash 提交门本地复跑通过，新增单测覆盖容错分支。
