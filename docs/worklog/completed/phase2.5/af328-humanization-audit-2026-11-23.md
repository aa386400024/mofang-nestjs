# AF-328 · 文字真人度 humanization-v1 真实语料审计报告

- 日期：2026-11-23
- 判据版本：`humanization-v1`
- 语料：`data/debug-sessions` 中 7 场、140 个 visitor 轮（与 AF-326 影子复评同一批场次）
- 审计命令：
  - `pnpm exec tsx bin/visitor-text-humanization-audit.ts --mode audit --ids "<7 ids>" --out data/phase25-exit/af328-humanization/audit-7sessions.json`
  - `pnpm exec tsx bin/visitor-text-humanization-audit.ts --mode active --ids "<7 ids>" --fail-on-violation`
- 性质：**AI 层文本度量与工程护栏**，不是临床结论，不替代真人督导。

## 总体数字

| 指标 | 值 |
| --- | --- |
| 场次 | 7 |
| visitor 轮 | 140 |
| 事件/轮 | 0.528571 |
| 事件轮次率 | 0.407143 |
| 密度/百字 | 1.321901 |
| 自我修正/轮 | 0.035714 |
| filler | 37 |
| pause | 31 |
| repetition | 1 |
| repair | 5 |
| trailoff | 0 |
| elongation | 0 |

## 逐场数字（模式 audit）

| 场次 | 轮 | 事件/轮 | 轮次率 | 密度/百字 | 判据 |
| --- | --- | --- | --- | --- | --- |
| `debug_aV8cenevSHfgmGB2Zkflf` | 20 | 0.550000 | 0.350000 | 1.417526 | not_applicable |
| `debug_PNbYXZIn3MQQt-EOlUVvm` | 20 | 0.400000 | 0.350000 | 1.162791 | not_applicable |
| `debug_PqbSdWdJDumFk6LULjVvv` | 20 | 0.650000 | 0.500000 | 1.581509 | not_applicable |
| `debug_q_VTpzjWZQwWDcAjUuJY0` | 20 | 0.400000 | 0.350000 | 0.807265 | not_applicable |
| `debug_s6HNZ_d_YYBHCLF2PLHNd` | 20 | 0.700000 | 0.500000 | 1.437372 | not_applicable |
| `debug_xw7uAJodsn6o3ln9FGL_Q` | 20 | 0.350000 | 0.250000 | 1.143791 | not_applicable |
| `debug_zenPFZu7VbSAW4LCC0_rN` | 20 | 0.650000 | 0.550000 | 1.768707 | not_applicable |

## 判据表与实测位置

| 判据 | 门槛 | 实测 | audit 结果 |
| --- | --- | --- | --- |
| `text.disfluency.event_turn_rate` | [0.15, 0.60] ± 0.02 | 0.407143 | not_applicable |
| `text.disfluency.events_per_turn` | <= 0.80 ± 0.02 | 0.528571 | not_applicable |
| `text.disfluency.density_per100` | [0.20, 2.50] ± 0.05 | 1.321901 | not_applicable |
| `text.disfluency.repair_per_turn` | <= 0.10 ± 0.01 | 0.035714 | not_applicable |

## 模式门与假设性 active 判定

本批语料是 realism off / audit 下产出的历史文本，按设计：

- `--mode audit`：只测量，判据 `not_applicable`，不产生 PASS/FAIL。
- `--mode off`：同样 `not_applicable`；用于未来历史批次复核时不会把「未开注入」误判为「真人度不合格」。
- `--mode active` 对同一批数字做假设性判定：四条判据全部 `pass`，`--fail-on-violation` 退出码 0。

必须强调：active 假设性判定只证明「这套门槛在真实口语文档上不会假失败」，**不证明 RENDER_REALISM_MODE=active 的注入链路有效**。要证明注入有效，需要同场次 active / off 对照生成，而当前本机 MySQL / Redis / dev 服务未运行，本轮没有该证据。

## 为什么门槛设在实测外侧

- 下界只排除「完全书面化、无任何口语痕迹」的极端；上界只排除「机械堆填充词 / 每轮改口」的极端。
- 中间地带不做临床裁决，避免把风格差异当质量高低。
- 所有数值均为工程种子，后续若做 active 对照批次，应按对照结果校准，而不是继续放宽到「永远通过」。

## 局限与边界

- 无真人督导参与；`humanSupervision=false`、`clinicalAcceptanceEligible=false`。
- 无 active / off 配对生成，本轮不能给出注入增益。
- 语料来自调试场次，不是生产真实咨询师样本；不能外推为产品级真人度结论。
- 报告只含场次 id 与数字，不含任何台词原文。
