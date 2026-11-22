# AF-302 交付记录 · 渲染故障矩阵一键自证验收器

> 交付日期：2026-11-22
> 任务类型：implementation（executor）
> 基线：`3aad9884c2c3a7722599003fd56dbbd9d6b42a2d`（AF-301 合并后的 integrate HEAD）
> 分支：`task/AF-302-render-acceptance`

## 1. 做了什么

AF-299 的五条故障回放原本是人工逐条敲命令、逐条读 JSON。本单把它固化成一条可重复执行的验收命令：

```powershell
pnpm exec tsx bin/visitor-render-acceptance.ts
```

- 场景表内置五类故障：双候选 5xx、双候选首包超时、双候选 401、双候选连接失败、单候选首包后停摆。
- 每条场景 spawn 一次真实 `bin/visitor-render-smoke.ts`（带 `--dump-render-metrics`），解析其末尾 JSON 报告，再用声明式期望逐条比对指标。
- 任一场景 smoke 退出码非 0、报告 `ok` 不为 true、报告缺 `renderMetrics`、或任一指标不符 → 该场景 FAIL，打印「期望 X=值，实际 Y」，整体退出码 1。
- 支持 `--only <id,id>` 子集执行、`--keep-going` 失败后继续；未知 id 直接报错。

## 2. 关键设计决策

1. **不改 smoke 行为**：验收器只消费 smoke 已输出的 JSON（`printReport` 本来就是 `JSON.stringify(..., null, 2)`），避免为了测试再改被测对象的判定逻辑。
2. **断言层抽纯函数**：`bin/lib/render-acceptance-checks.ts` 只处理内存里的指标样本、JSON 文本与子进程结果，指标名+标签求和、缺失即 0、`equals/atLeast/atMost` 三档断言全部可单测，不依赖真实网络与 `.env`。
3. **零值也要有样本**：`cooldown_served_total=0`、`failure{other}=0` 这类「不应该出现」的断言用 `equals: 0`；探针区分 `present` 与 `sum`，避免「指标没注册」被误当成「值为 0」。
4. **场景 id 固定**：`double-server / double-timeout / double-auth / double-network / single-midstream`，与 Runbook §5.1 表格一一对应，排障时可只跑一条。
5. **单场景超时 180s**：首包超时约 16s、首包后停摆约 30s，留足进程启动与故障上游收敛余量。

## 3. 真实运行结果

`pnpm exec tsx bin/visitor-render-acceptance.ts`（`data/af302-full2.log`）：

| 场景 | 结果 | 墙钟 |
| --- | --- | --- |
| double-server · 双候选 5xx 全损 | PASS | 0s |
| double-timeout · 双候选首包超时 | PASS | 16s |
| double-auth · 双候选 401 | PASS | 0s |
| double-network · 双候选连接失败 | PASS | 0s |
| single-midstream · 单候选首包后停摆 | PASS | 30s |

汇总 `PASS 5 / FAIL 0 / 未执行 0`，退出码 0。

反向验证（`data/af302-negative.log`）：把 `double-auth` 的 `auth_failure_total` 期望从 2 改成 3，验收器精确输出

```
[FAIL] double-auth · 双候选 401 · 墙钟 0s · exit=0
   - 两候选各记一次鉴权失败：期望 visitor_render_auth_failure_total=3，实际 2
```

并以退出码 1 结束；恢复为 2 后该场景重新 PASS。

## 4. 闸门

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| 定向测试 `test/engine-adapters/af302-render-acceptance-checks.spec.ts` | 7 passed | `data/af302-target2.log` |
| 真实五场景自证 | PASS 5 / FAIL 0，exit 0 | `data/af302-full2.log` |
| 反向验证 | 1 failed，精确报期望/实际值，exit 1 | `data/af302-negative.log` |
| `pnpm typecheck` | 0 error | `data/af302-typecheck2.log` |
| `pnpm lint`（全量） | 0 error / 0 warning | `data/af302-lint-full.log` |
| `pnpm test`（全量） | 282 passed / 1 skipped files；4390 passed / 4 skipped；0 failed（23.47s） | `data/af302-test-full.log` |
| `git diff --stat HEAD -- src/engine-core` | 空 | 内核零改动 |

## 5. 偏差与口径

- 任务单标题写「五类故障」，与实现一致；AF-299 交付记录里曾把首包后停摆单列，这里沿用。
- 指标是**本轮进程内增量**，不是线上累计值；Runbook §5.2 已明确提示不要与 Prometheus `increase()` 做等值比较。
- 验收器当前只覆盖流式渲染主路径，未覆盖聚合路径与 orchestrated 批量；已登记 backlog。

## 6. backlog

- `visitor-render-acceptance-ci`：把验收器接入 CI 或发布前门禁，需要先解决 `.env` 与故障上游在 CI 网络下的可用性。
- `visitor-render-acceptance-aggregate-path`：补聚合路径（`render()` 非流式）的故障场景。
- `visitor-render-acceptance-real-provider`：灰度期补一条真实主候选可用性探针，与故障矩阵分开跑，不混用额度。

## 7. 一行提交

`feat(AF-302): 渲染故障矩阵一键自证验收器`
