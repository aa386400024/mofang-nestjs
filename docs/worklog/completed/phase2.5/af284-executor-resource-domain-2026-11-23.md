# AF-284 · 扩展 executor 资源域（docker/、docs/runbooks/）

## 一、结论

executor Agent Card 的 `resources` 已补上 `docker/` 与 `docs/runbooks/`，AF-283 不再被 `scope-domain-conflict` 拦截。资源域只是“可讨论的可写边界”，实际写入仍以任务单 scope 切片为准；`limits` 未放宽。

## 二、改了什么

`docs/team/agent-orchestration/agent-cards/executor.json`：

```json
"resources": ["src/", "bin/", "test/", "admin-dashboard/", "docker/", "docs/runbooks/", ...]
```

新增两项：`docker/`（Prometheus 规则、Grafana 面板、compose 配置）与 `docs/runbooks/`（部署/运维手册）。

## 三、为什么

Phase2.5 生产化交付面已经包括“指标 → 告警 → 看板 → 回滚 runbook”。这些资产天然落在 `docker/` 与 `docs/runbooks/`，而 executor 域原本只覆盖代码、测试与 worklog。结果是每一条生产化切片都只能由 orchestrator 手工代写，违背“执行与验收分离”。

## 四、边界

- executor 仍不能写 `src/engine-core/`、Flutter、`.github/`、`scripts/`、部署执行动作。
- 写权限仍受任务单 `scope.files` 与 `orchestration:preflight` 双重约束。
- 未改调度器逻辑、orchestrator card 与任何业务代码。

## 五、闸门

| 闸门 | 结果 |
| --- | --- |
| `node scripts/orchestration/cli.mjs validate --sheet .../AF-284/task-sheet.md` | 全 PASS |
| `node scripts/orchestration/cli.mjs status` | 投影一致 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 六、机读标记

### gateResults

- validate 全 PASS（任务单 / 事件日志 / 索引投影）。
- status 与事件链一致。
- engine-core diff 为空。

### scopeCheck

仅改 `docs/team/agent-orchestration/agent-cards/executor.json` 与 worklog 记录，符合任务单 scope。

### contractChecks

- taskId：分支 `task/AF-284-executor-resource-domain`。
- state-write：register / promote / branch / run-once 均经 CLI。
- engine-boundary：`src/engine-core` 零改动。

### backlogItems

无。

### deviationTable

无。

### reviewVerdict

passed。
