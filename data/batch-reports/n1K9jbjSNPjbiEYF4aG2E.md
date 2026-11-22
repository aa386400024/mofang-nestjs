# 批次 n1K9jbjSNPjbiEYF4aG2E

- 计算时间: 2026-11-18T06:54:04.362Z
- 配置指纹 combined: `1caeea117101e8d9`
- 纳入/期望: 4/4, 总轮数 37
- intake 验收 (全局 · 基线档 (intake-v1 阈值)): **FAIL**
- 回归结论: regressed (changed: none)

## 指标

| 指标 | 值 |
|---|---|
| `dim.trust.first_avg` | 0.235 |
| `dim.trust.last_avg` | 0.322 |
| `dim.trust.delta_avg` | 0.087 |
| `dim.trust.per_turn_rate` | 0.00725 |
| `dim.trust.p10` | 0.229 |
| `dim.trust.p90` | 0.4294 |
| `dim.safety.first_avg` | 0.25 |
| `dim.safety.last_avg` | 0.25875 |
| `dim.safety.delta_avg` | 0.00875 |
| `dim.safety.per_turn_rate` | 0.000729 |
| `dim.safety.p10` | 0.25 |
| `dim.safety.p90` | 0.2685 |
| `dim.bond.first_avg` | 0.15 |
| `dim.bond.last_avg` | 0.1575 |
| `dim.bond.delta_avg` | 0.0075 |
| `dim.bond.per_turn_rate` | 0.000625 |
| `dim.bond.p10` | 0.106 |
| `dim.bond.p90` | 0.207 |
| `dim.valence.first_avg` | -0.55 |
| `dim.valence.last_avg` | -0.595 |
| `dim.valence.delta_avg` | -0.045 |
| `dim.valence.per_turn_rate` | -0.00375 |
| `dim.valence.p10` | -0.718 |
| `dim.valence.p90` | -0.508 |
| `dim.arousal.first_avg` | 0.3 |
| `dim.arousal.last_avg` | 0.3825 |
| `dim.arousal.delta_avg` | 0.0825 |
| `dim.arousal.per_turn_rate` | 0.006875 |
| `dim.arousal.p10` | 0.268 |
| `dim.arousal.p90` | 0.539 |
| `dim.verbal.first_avg` | 0.525 |
| `dim.verbal.last_avg` | 0.528077 |
| `dim.verbal.delta_avg` | 0.003077 |
| `dim.verbal.per_turn_rate` | 0.000256 |
| `dim.verbal.p10` | 0.503462 |
| `dim.verbal.p90` | 0.550538 |
| `dim.depth.first_avg` | 0.575 |
| `dim.depth.last_avg` | 0.588269 |
| `dim.depth.delta_avg` | 0.013269 |
| `dim.depth.per_turn_rate` | 0.001106 |
| `dim.depth.p10` | 0.478462 |
| `dim.depth.p90` | 0.708692 |
| `dim.style.first_avg` | 0.6 |
| `dim.style.last_avg` | 0.632885 |
| `dim.style.delta_avg` | 0.032885 |
| `dim.style.per_turn_rate` | 0.00274 |
| `dim.style.p10` | 0.489231 |
| `dim.style.p90` | 0.802846 |
| `event.empathy.count` | 5 |
| `event.empathy.rate` | 0.135135 |
| `event.acceptance.count` | 1 |
| `event.acceptance.rate` | 0.027027 |
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
| `event.sensitive_touch.count` | 3 |
| `event.sensitive_touch.rate` | 0.081081 |
| `event.neutral.count` | 29 |
| `event.neutral.rate` | 0.783784 |
| `event.holding_present.count` | 0 |
| `event.holding_present.rate` | 0 |
| `event.cold_absent.count` | 0 |
| `event.cold_absent.rate` | 0 |
| `event.positive.rate` | 0.162162 |
| `strategy.simple_response.count` | 10 |
| `strategy.simple_response.rate` | 0.27027 |
| `strategy.request.count` | 0 |
| `strategy.request.rate` | 0 |
| `strategy.recounting.count` | 6 |
| `strategy.recounting.rate` | 0.162162 |
| `strategy.cognitive_exploration.count` | 0 |
| `strategy.cognitive_exploration.rate` | 0 |
| `strategy.affective_exploration.count` | 0 |
| `strategy.affective_exploration.rate` | 0 |
| `strategy.insight.count` | 0 |
| `strategy.insight.rate` | 0 |
| `strategy.discussing_plans.count` | 0 |
| `strategy.discussing_plans.rate` | 0 |
| `strategy.resistance.count` | 21 |
| `strategy.resistance.rate` | 0.567568 |
| `exploration.rate` | 0 |
| `exploration.character_coverage` | 0 |
| `session.zero_motion` | 2 |
| `session.outcome.completed` | 2 |
| `session.outcome.crisis_ended` | 0 |
| `session.outcome.stagnant` | 2 |
| `session.outcome.failed` | 0 |
| `pipeline.llm_call_ratio` | 1 |
| `pipeline.fallback_ratio` | 0 |
| `text.disfluency.events_per_turn` | 3.351351 |
| `text.disfluency.event_turn_rate` | 0.891892 |
| `text.disfluency.density_per100` | 0.50386 |
| `text.disfluency.filler_per_turn` | 0.648649 |
| `text.disfluency.pause_per_turn` | 1.486486 |
| `text.disfluency.repair_per_turn` | 1 |
| `text.disfluency.repetition_per_turn` | 0.216216 |
| `text.disfluency.trailoff_per_turn` | 0 |

## 未达标项 (全局)

- `dim.safety.delta_avg` (实际 0.00875): 试探性安全, 只小幅涨
- `session.zero_motion` (实际 2): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效

## 按咨询师模式分档判定 (intake-v2)

| 模式 | 档位 | 场次 | 判定 | 未达标项 | 零变化 总/豁免/计入 |
|---|---|---|---|---|---|
| `cold` | cold 负向极端档 (候选阈值 · 待主控复核) | 2 | **PASS** | 0 | 1/0/1 |
| `expert` | 基线档 (intake-v1 阈值) | 2 | **FAIL** | 3 | 1/0/1 |

### `cold` · cold 负向极端档 (候选阈值 · 待主控复核)
- 全部判据通过

### `expert` · 基线档 (intake-v1 阈值)
- `dim.safety.delta_avg` (实际 0.0075): 试探性安全, 只小幅涨
- `dim.style.delta_avg` (实际 0.073462): 人格级表达风格防御稳定
- `session.zero_motion` (实际 1): 零变化场次应为 0; 否则说明冷漠被静默成中性、检测失效
