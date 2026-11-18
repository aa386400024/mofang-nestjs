# 批次 bpCkaFlA3YGI95qlJZ9Yn

- 计算时间: 2026-11-18T13:54:49.754Z
- 配置指纹 combined: `e1d4b3118bf55fa2`
- 纳入/期望: 4/4, 总轮数 173
- intake 验收 (全局 · 基线档 (intake-v1 阈值)): **FAIL**
- 回归结论: incomparable — 两批验收判据 (acceptance) 不同; 两批 counselorModeId 集合不同; 两批 characterSlug 集合不同

## 指标

| 指标 | 值 |
|---|---|
| `dim.trust.first_avg` | 0.2725 |
| `dim.trust.last_avg` | 0.5155 |
| `dim.trust.delta_avg` | 0.243 |
| `dim.trust.per_turn_rate` | 0.005876 |
| `dim.trust.p10` | 0.3358 |
| `dim.trust.p90` | 0.7148 |
| `dim.safety.first_avg` | 0.3 |
| `dim.safety.last_avg` | 0.3285 |
| `dim.safety.delta_avg` | 0.0285 |
| `dim.safety.per_turn_rate` | 0.000665 |
| `dim.safety.p10` | 0.263 |
| `dim.safety.p90` | 0.3976 |
| `dim.bond.first_avg` | 0.375 |
| `dim.bond.last_avg` | 0.40075 |
| `dim.bond.delta_avg` | 0.02575 |
| `dim.bond.per_turn_rate` | 0.000609 |
| `dim.bond.p10` | 0.1395 |
| `dim.bond.p90` | 0.6642 |
| `dim.valence.first_avg` | -0.5075 |
| `dim.valence.last_avg` | -0.485 |
| `dim.valence.delta_avg` | 0.0225 |
| `dim.valence.per_turn_rate` | -0.000094 |
| `dim.valence.p10` | -0.625 |
| `dim.valence.p90` | -0.357 |
| `dim.arousal.first_avg` | 0.4125 |
| `dim.arousal.last_avg` | 0.4325 |
| `dim.arousal.delta_avg` | 0.02 |
| `dim.arousal.per_turn_rate` | 0.001409 |
| `dim.arousal.p10` | 0.299 |
| `dim.arousal.p90` | 0.54 |
| `dim.verbal.first_avg` | 0.475 |
| `dim.verbal.last_avg` | 0.421875 |
| `dim.verbal.delta_avg` | -0.053125 |
| `dim.verbal.per_turn_rate` | -0.000963 |
| `dim.verbal.p10` | 0.31125 |
| `dim.verbal.p90` | 0.544231 |
| `dim.depth.first_avg` | 0.525 |
| `dim.depth.last_avg` | 0.493269 |
| `dim.depth.delta_avg` | -0.031731 |
| `dim.depth.per_turn_rate` | -0.000462 |
| `dim.depth.p10` | 0.36 |
| `dim.depth.p90` | 0.605769 |
| `dim.style.first_avg` | 0.55 |
| `dim.style.last_avg` | 0.551635 |
| `dim.style.delta_avg` | 0.001635 |
| `dim.style.per_turn_rate` | 0.000442 |
| `dim.style.p10` | 0.386769 |
| `dim.style.p90` | 0.672115 |
| `event.empathy.count` | 8 |
| `event.empathy.rate` | 0.046243 |
| `event.acceptance.count` | 3 |
| `event.acceptance.rate` | 0.017341 |
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
| `event.minimizing.count` | 0 |
| `event.minimizing.rate` | 0 |
| `event.boundary_cross.count` | 0 |
| `event.boundary_cross.rate` | 0 |
| `event.sensitive_touch.count` | 2 |
| `event.sensitive_touch.rate` | 0.011561 |
| `event.neutral.count` | 160 |
| `event.neutral.rate` | 0.924855 |
| `event.holding_present.count` | 0 |
| `event.holding_present.rate` | 0 |
| `event.cold_absent.count` | 0 |
| `event.cold_absent.rate` | 0 |
| `event.positive.rate` | 0.063584 |
| `strategy.simple_response.count` | 18 |
| `strategy.simple_response.rate` | 0.104046 |
| `strategy.request.count` | 0 |
| `strategy.request.rate` | 0 |
| `strategy.recounting.count` | 108 |
| `strategy.recounting.rate` | 0.624277 |
| `strategy.cognitive_exploration.count` | 0 |
| `strategy.cognitive_exploration.rate` | 0 |
| `strategy.affective_exploration.count` | 0 |
| `strategy.affective_exploration.rate` | 0 |
| `strategy.insight.count` | 0 |
| `strategy.insight.rate` | 0 |
| `strategy.discussing_plans.count` | 0 |
| `strategy.discussing_plans.rate` | 0 |
| `strategy.resistance.count` | 47 |
| `strategy.resistance.rate` | 0.271676 |
| `exploration.rate` | 0 |
| `exploration.character_coverage` | 0 |
| `session.zero_motion` | 0 |
| `session.outcome.completed` | 4 |
| `session.outcome.crisis_ended` | 0 |
| `session.outcome.stagnant` | 0 |
| `session.outcome.failed` | 0 |
| `pipeline.llm_call_ratio` | 1 |
| `pipeline.fallback_ratio` | 0 |
| `text.disfluency.events_per_turn` | 2.479769 |
| `text.disfluency.event_turn_rate` | 0.606936 |
| `text.disfluency.density_per100` | 0.51513 |
| `text.disfluency.filler_per_turn` | 0.514451 |
| `text.disfluency.pause_per_turn` | 1.132948 |
| `text.disfluency.repair_per_turn` | 0.780347 |
| `text.disfluency.repetition_per_turn` | 0.052023 |
| `text.disfluency.trailoff_per_turn` | 0 |

## 未达标项 (全局)

- `dim.trust.delta_avg` (实际 0.243): 首次会谈信任温和上升; 焦虑型快速理想化

## 按咨询师模式分档判定 (intake-v2)

| 模式 | 档位 | 场次 | 判定 | 未达标项 | 零变化 总/豁免/计入 |
|---|---|---|---|---|---|
| `expert` | 基线档 (intake-v1 阈值) | 4 | **FAIL** | 1 | 0/0/0 |

### `expert` · 基线档 (intake-v1 阈值)
- `dim.trust.delta_avg` (实际 0.243): 首次会谈信任温和上升; 焦虑型快速理想化
