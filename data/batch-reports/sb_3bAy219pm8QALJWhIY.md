# 批次 sb_3bAy219pm8QALJWhIY

- 计算时间: 2026-11-18T06:54:04.418Z
- 配置指纹 combined: `1caeea117101e8d9`
- 纳入/期望: 4/4, 总轮数 48
- intake 验收 (全局 · 基线档 (intake-v1 阈值)): **FAIL**
- 回归结论: neutral (changed: none)

## 指标

| 指标 | 值 |
|---|---|
| `dim.trust.first_avg` | 0.235 |
| `dim.trust.last_avg` | 0.28 |
| `dim.trust.delta_avg` | 0.045 |
| `dim.trust.per_turn_rate` | 0.00375 |
| `dim.trust.p10` | 0.229 |
| `dim.trust.p90` | 0.343 |
| `dim.safety.first_avg` | 0.25 |
| `dim.safety.last_avg` | 0.2575 |
| `dim.safety.delta_avg` | 0.0075 |
| `dim.safety.per_turn_rate` | 0.000625 |
| `dim.safety.p10` | 0.25 |
| `dim.safety.p90` | 0.267 |
| `dim.bond.first_avg` | 0.15 |
| `dim.bond.last_avg` | 0.15125 |
| `dim.bond.delta_avg` | 0.00125 |
| `dim.bond.per_turn_rate` | 0.000104 |
| `dim.bond.p10` | 0.1015 |
| `dim.bond.p90` | 0.2 |
| `dim.valence.first_avg` | -0.55 |
| `dim.valence.last_avg` | -0.55 |
| `dim.valence.delta_avg` | 0 |
| `dim.valence.per_turn_rate` | 0 |
| `dim.valence.p10` | -0.571 |
| `dim.valence.p90` | -0.529 |
| `dim.arousal.first_avg` | 0.3 |
| `dim.arousal.last_avg` | 0.29 |
| `dim.arousal.delta_avg` | -0.01 |
| `dim.arousal.per_turn_rate` | -0.000833 |
| `dim.arousal.p10` | 0.236 |
| `dim.arousal.p90` | 0.344 |
| `dim.verbal.first_avg` | 0.525 |
| `dim.verbal.last_avg` | 0.512692 |
| `dim.verbal.delta_avg` | -0.012308 |
| `dim.verbal.per_turn_rate` | -0.001026 |
| `dim.verbal.p10` | 0.483846 |
| `dim.verbal.p90` | 0.542154 |
| `dim.depth.first_avg` | 0.575 |
| `dim.depth.last_avg` | 0.583462 |
| `dim.depth.delta_avg` | 0.008462 |
| `dim.depth.per_turn_rate` | 0.000705 |
| `dim.depth.p10` | 0.514769 |
| `dim.depth.p90` | 0.645385 |
| `dim.style.first_avg` | 0.6 |
| `dim.style.last_avg` | 0.604231 |
| `dim.style.delta_avg` | 0.004231 |
| `dim.style.per_turn_rate` | 0.000353 |
| `dim.style.p10` | 0.507385 |
| `dim.style.p90` | 0.697692 |
| `event.empathy.count` | 4 |
| `event.empathy.rate` | 0.083333 |
| `event.acceptance.count` | 0 |
| `event.acceptance.rate` | 0 |
| `event.normalization.count` | 0 |
| `event.normalization.rate` | 0 |
| `event.open_probe.count` | 0 |
| `event.open_probe.rate` | 0 |
| `event.affirmation.count` | 0 |
| `event.affirmation.rate` | 0 |
| `event.judgment.count` | 0 |
| `event.judgment.rate` | 0 |
| `event.preaching.count` | 0 |
| `event.preaching.rate` | 0 |
| `event.minimizing.count` | 1 |
| `event.minimizing.rate` | 0.020833 |
| `event.boundary_cross.count` | 0 |
| `event.boundary_cross.rate` | 0 |
| `event.sensitive_touch.count` | 0 |
| `event.sensitive_touch.rate` | 0 |
| `event.neutral.count` | 44 |
| `event.neutral.rate` | 0.916667 |
| `event.holding_present.count` | 0 |
| `event.holding_present.rate` | 0 |
| `event.cold_absent.count` | 0 |
| `event.cold_absent.rate` | 0 |
| `event.positive.rate` | 0.083333 |
| `strategy.simple_response.count` | 14 |
| `strategy.simple_response.rate` | 0.291667 |
| `strategy.request.count` | 0 |
| `strategy.request.rate` | 0 |
| `strategy.recounting.count` | 10 |
| `strategy.recounting.rate` | 0.208333 |
| `strategy.cognitive_exploration.count` | 0 |
| `strategy.cognitive_exploration.rate` | 0 |
| `strategy.affective_exploration.count` | 0 |
| `strategy.affective_exploration.rate` | 0 |
| `strategy.insight.count` | 0 |
| `strategy.insight.rate` | 0 |
| `strategy.discussing_plans.count` | 0 |
| `strategy.discussing_plans.rate` | 0 |
| `strategy.resistance.count` | 24 |
| `strategy.resistance.rate` | 0.5 |
| `exploration.rate` | 0 |
| `exploration.character_coverage` | 0 |
| `session.zero_motion` | 2 |
| `session.outcome.completed` | 4 |
| `session.outcome.crisis_ended` | 0 |
| `session.outcome.stagnant` | 0 |
| `session.outcome.failed` | 0 |
| `pipeline.llm_call_ratio` | 1 |
| `pipeline.fallback_ratio` | 0 |
| `text.disfluency.events_per_turn` | 2.770833 |
| `text.disfluency.event_turn_rate` | 0.604167 |
| `text.disfluency.density_per100` | 0.393654 |
| `text.disfluency.filler_per_turn` | 0.6875 |
| `text.disfluency.pause_per_turn` | 1.4375 |
| `text.disfluency.repair_per_turn` | 0.604167 |
| `text.disfluency.repetition_per_turn` | 0.041667 |
| `text.disfluency.trailoff_per_turn` | 0 |

## 未达标项 (全局)

- `dim.trust.delta_avg` (实际 0.045): 首次会谈信任温和上升; 焦虑型快速理想化
- `dim.safety.delta_avg` (实际 0.0075): 试探性安全, 只小幅涨
- `session.zero_motion` (实际 2): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效

## 按咨询师模式分档判定 (intake-v2)

| 模式 | 档位 | 场次 | 判定 | 未达标项 | 零变化 总/豁免/计入 |
|---|---|---|---|---|---|
| `cold` | cold 负向极端档 (候选阈值 · 待主控复核) | 2 | **FAIL** | 2 | 2/0/2 |
| `expert` | 基线档 (intake-v1 阈值) | 2 | **PASS** | 0 | 0/0/0 |

### `cold` · cold 负向极端档 (候选阈值 · 待主控复核)
- `dim.trust.delta_avg` (实际 0): 【候选 · 待主控复核】cold 冷漠输入下信任建立显著慢 (实测 0.0297, expert 0.1386); 下限 0.01 保住"完全无响应即不合格"的底线, 上限 0.08 允许明显建立
- `session.zero_motion` (实际 1 [2/2]): 【候选 · 待主控复核】I-22: 只计"纯 neutral 空转"的零变化场次 (事件层无任何非 neutral 事件); 该档不要求为 0, 但空转率过高说明"冷漠被静默成中性"的失效面过大 (cold 实测 31/48 = 0.6458)

### `expert` · 基线档 (intake-v1 阈值)
- 全部判据通过
