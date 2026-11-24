# AF-470 交付记录 · 扩展 executor 资源域覆盖 scripts/eval/

- 任务：`AF-470`（`contextId=phase2.5-orchestration-closed-loop`）
- 类型：`implementation`（编排资源域配置）
- 基线：`28aa06c1dbfe9f35acda47fb62c18c0c25a08f01`
- 角色：`orchestrator`
- 前置：AF-469 因任务单 scope 漏 docs 工件路径、未提交任何实现即取消；本单为修正后的重登。

## 改了什么

`docs/team/agent-orchestration/agent-cards/executor.json` 的 `resources` 增加 `scripts/eval/`，其余字段未动：

```diff
- "resources": ["src/", "bin/", "test/", "admin-dashboard/", ...]
+ "resources": ["src/", "bin/", "test/", "scripts/eval/", "admin-dashboard/", ...]
```

只放开 `scripts/eval/`，不放整个 `scripts/`，避免 executor 触达 `scripts/orchestration/` 等主控域。

## 为什么改

AF-466 的 scope 同时包含 `src/engine-adapters/`、`bin/`、`test/` 与 `scripts/eval/visitor-register-stability/`；executor 资源域缺 `scripts/eval/` 时，`run-once` 报 `scope-domain-conflict AF-466`，任务无法领单。AF-465 的 harness 与 11 条单测也在同一目录，这是重复缺口。

## 闸门

| 闸门                                          | 结果                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `node scripts/orchestration/cli.mjs validate` | Agent Card executor.json / orchestrator.json PASS；索引投影一致 |
| `node scripts/orchestration/cli.mjs run-once` | AF-466 领单成功，证明资源域缺口已解除                           |
| 资源域影响面                                  | executor 仅新增 `scripts/eval/`；orchestrator 未动              |

全量 `validate` 仍有 AF-384 / AF-465 两条历史回执 schema 失败，与本次无关，不跨任务修改。

## 状态面例外

任务分支上单独提交状态面时使用 `ORCH_ALLOW_STATE_COMMIT=1`，原因是 PR 阶段 Orchestration Gate 需要读取 AF-466 / AF-470 的当前状态投影；实现文件不在该状态提交内，不与状态面混提。
