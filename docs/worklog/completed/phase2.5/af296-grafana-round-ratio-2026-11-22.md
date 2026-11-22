# AF-296 · Grafana 比率面板回合口径对齐与逐面板守卫（implementation）

> 交付日期：2026-11-22
> 分支：`task/AF-296-grafana-round-ratio`（自 `integrate` bbc48ee4）
> 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-296/task-sheet.md`
> 来源：AF-292 外审 P0-A1（告警已改 rounds，看板仍用 attempts）

## 1. 落地

一句话：把看板三条比率面板的分母全部换成终局轮次，并让守卫逐面板检查表达式，堵住“新增面板顺手满足全局子串检查”的漏洞。

### 1.1 三条表达式

| 面板 | 旧 expr | 新 expr |
| --- | --- | --- |
| id 10 降级率 | `sum(increase(visitor_render_degraded_total[10m])) / clamp_min(sum(increase(visitor_render_attempts_total{outcome=~"success\|degrade"}[10m])), 0.001)` | `sum(increase(visitor_render_degraded_total{cause!="guard"}[10m])) / clamp_min(sum(increase(visitor_render_rounds_total[10m])), 0.001)` |
| id 10 取消率 | 分子 cancelled，分母 attempts+cancelled | 分子 cancelled，分母 `rounds_total` |
| id 13 回退率 | 分子 fallback，分母 attempts | 分子 fallback，分母 `rounds_total` |

降级率图例同步从“排除 barge-in”改为“排除 guard”：`cancelled` 本来就不在降级分子里，真正需要排除的是安全拦截 `guard`。

### 1.2 逐面板守卫

`af283-render-alerting.spec.ts` 新增一条测试：遍历所有标题含“降级率 / 回退率 / 取消率”的面板，对每个 target 的 expr 逐条检查：

- 必须包含 `visitor_render_rounds_total`；
- 不得出现 `visitor_render_attempts_total`；
- 降级率面板必须包含 `cause!="guard"`。

旧测试只把整个看板所有 expr 拼成一个字符串做 `toContain`，新增 id 18 轮次结局面板后天然满足，无法发现单面板口径漂移。新守卫按面板逐条判，定位信息带面板标题与完整表达式。

### 1.3 反向验证守卫

把回退率表达式的分母临时改成 `attempts_total` 后：

```text
× Grafana 比率面板逐面板使用 rounds 分母, 且降级分子排除 guard
AssertionError: expected '来访者渲染: 候选回退率 (10m): 分母缺 rounds_total …' to be ''
+ 来访者渲染: 候选回退率 (10m): 分母缺 rounds_total -> ...visitor_render_attempts_total[10m]...
+ 来访者渲染: 候选回退率 (10m): 仍用 attempts 作分母 -> ...visitor_render_attempts_total[10m]...
```

恢复正确表达式后 8 条测试全绿。证据：`data/af296-guard-negative2.log`、`data/af296-target3.log`。

### 1.4 Runbook 判读口径

- 比率告警是 `increase[10m] + for:5m`，有 5–10 分钟结构性滞后；突发故障先看 `failure_total` 与 `rounds` 即时增量。
- `cancelled` 只进统一分母，不进降级/回退分子；barge-in 25% 时真实 4% 降级可能显示为 3.0%，判读必须同时看 `rounds` 结局分布。
- `fallback_total` 是切换尝试，不是回退成功；与 `rounds{exhausted}` 联读。

## 2. 证据

### 闸门

| 命令 | exit | 结果 | 备注 |
| --- | --- | --- | --- |
| `pnpm exec vitest run test/config/af283-render-alerting.spec.ts` | 0 | 8 passed | 日志 `data/af296-target4.log` |
| 同一测试（临时改回 attempts 分母） | 1 | 1 failed，断言精确指出面板与 expr | 反向验证；`data/af296-guard-negative2.log` |
| `pnpm typecheck` | 0 | 0 error | 日志 `data/af296-typecheck.log` |
| `pnpm lint`（全量） | 0 | 0 error / 0 warning | 日志 `data/af296-lint-full.log` |
| `pnpm test`（全量） | 0 | 279 passed / 1 skipped files；4358 passed / 4 skipped tests；23.42s | 日志 `data/af296-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 0 | 空 | 内核零改动 |

### 看板表达式取数

`docker/grafana/dashboards/mofang-overview.json` 中三条 expr 已与 `alerts.yml` 的 `VisitorRenderDegradedRateHigh` / `VisitorRenderFallbackRateHigh` 对齐；取消率单独使用 `rounds_total` 分母。

## 3. 偏差与遗留

- **外审 A2（拆 provider 健康度 / 用户可感知失败率 / 取消率三条口径）未采纳**：本轮先保证看板与告警同口径；拆口径会改变告警语义与阈值基线，需要独立任务与灰度数据。已登记 backlog `visitor-render-provider-health-split`。
- **外审 A4（rounds/degraded 恒等式守卫）未做**：需要 Prometheus recording rule 或运行期断言，属于指标层工作，不在本次看板修正范围。
- **硬回滚线 #1 单次 401 即回滚**：外审建议改为 ≥2 次/5m；告警规则本身仍是 >0，改 Runbook 会与规则不一致，留给阈值校准任务。
- 未改告警阈值、未改生产渲染代码、未碰 engine-core。

## 4. 提交

`fix(AF-296): Grafana 比率面板回合口径对齐与逐面板守卫`
