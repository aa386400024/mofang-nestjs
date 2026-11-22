# AF-303 交付记录：渲染验收器补齐回退成功路径

- 日期：2026-11-22
- 基线：`d6243222f6c7eb2cb3ccc48b71184714118c2922`（AF-302 合并后的 `integrate`）
- 分支：`task/AF-303-acceptance-fallback`
- 类型：implementation（收口型，小改动）

## 改了什么

1. `bin/visitor-render-acceptance.ts` 新增第 6 条场景 `single-fallback`：
   `--fail-primary --fail-primary-mode server-error --expect-fallback`，并声明 10 条期望——`rounds{success}=1`、`rounds{degrade}=0`、`rounds{exhausted}=0`、`attempts{doubao,retry}=1`、`attempts{minimax,success}=1`、`failure{doubao,server}=1`、`failure{candidate=minimax}=0`、`fallback{from=doubao,to=minimax,cause=server}=1`、`degraded_total=0`、`cooldown_served_total=0`。
2. `test/engine-adapters/af302-render-acceptance-checks.spec.ts` 增 1 例（共 8 例）：用回退成功的真实样本形态断言通过；再注入一条 `degraded_total{cause=degrade}=1` 证明「健康路径混入降级」会被精确拦下。
3. `docs/runbooks/render-telemetry-alerting.md`：§5.1 故障矩阵补第 6 行（主候选 5xx → 备候选成功，含 wall≈2s 与「degraded 未注册即 0」的口径提醒）；§5.2 场景数由五条改六条、id 清单补 `single-fallback`、耗时说明补 5 条秒级。

## 关键设计决策

- 为什么补这条：AF-302 的六条里 5 条是失败结局，唯一「用户仍拿到内容」的健康路径只在 AF-299 人工跑过一次，指标记错不会被自动拦住。回退成功是灰度期最常见形态，必须进自证器。
- 为什么断言 `failure{candidate=minimax}=0`：回退成功时备候选不能留失败计数，否则「备候选可用性」会被主候选的故障污染。
- 为什么 `degraded_total` 用不带标签的 `equals: 0`：该指标在健康路径上根本不注册 label，探针缺失返 0；这条同时防止未来误把回退成功记成降级。

## 真实取证

单场景：`--only single-fallback` → PASS，墙钟 2s。
全量：`pnpm exec tsx bin/visitor-render-acceptance.ts` → PASS 6 / FAIL 0 / 未执行 0，exit 0（`data/af303-accept-full.log`）。
反向验证：把 `rounds{success}` 期望临时改 0 → `[FAIL]` 精确输出「期望 visitor_render_rounds_total{outcome=success}=0，实际 1」，exit 1（`data/af303-negative.log`），恢复后通过。

## 闸门

| 闸门 | 结果 | 证据 |
| --- | --- | --- |
| 定向单测 | 8 passed / 0 failed | `data/af303-test-target2.log` |
| typecheck | 0 error | `data/af303-typecheck.log` |
| scoped ESLint | 0 error | `data/af303-eslint2.log` |
| 全量 lint | 0 error | `data/af303-lint-full.log` |
| 全量测试 | 282 passed / 1 skipped files，4391 passed / 4 skipped / 0 failed，24.18s | `data/af303-test-full.log` |
| 六场景自证 | PASS 6 / FAIL 0 | `data/af303-accept-full.log` |
| engine-core | 零改动 | `git diff --stat HEAD -- src/engine-core` 为空 |

## 偏差

任务单写「六条场景」，实际为「原五条 + 新增一条 = 六条」，一致，无偏差。
唯一过程偏差：测试文件首次编辑把既有 `it('atLeast / atMost 边界')` 头部覆盖掉导致解析失败，已恢复并复跑通过；属编辑事故，不影响交付内容。

## commit message

`feat(af303): 渲染验收器补回退成功路径场景`
