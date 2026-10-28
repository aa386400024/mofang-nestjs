// V2026-10-28 WP1 (引擎内核 · 意图规划器):
//   职责: 从迁移后的状态选一个主导行为策略, 组装本轮 Intention (五字段).
//   边界: 纯函数, 无随机. 规则轨只选状态可判定的策略; request / insight /
//   discussing_plans 等依赖来访侧信号的策略本期留类型不主动选出 (模型轨填充).

import type { BdiSnapshot } from '../domain/bdi-snapshot';
import type { CharacterProfile } from '../domain/character-profile';
import type { BehaviorStrategy, Intention } from '../domain/intention';

/** 阻抗聚合阈值: 三维平均达到即视为整体防御. */
const HIGH_RESISTANCE_AGG = 0.6;
/** 话量阻抗阈值: 达到即倾向简短回应. */
const HIGH_VERBAL = 0.55;
/** 开放探索所需信任阈值. */
const OPEN_TRUST = 0.6;
/** 开放探索要求的深度阻抗上限. */
const LOW_DEPTH = 0.35;

/**
 * 规划本轮意图. 阈值为集中常量, 便于后期调参.
 * @param snapshot 迁移后的最新快照
 * @param profile 角色内核 (仅取禁止行为透传)
 */
export function planIntention(snapshot: BdiSnapshot, profile?: CharacterProfile): Intention {
  const { verbal, depth, style } = snapshot.resistance;
  const aggregate = (verbal + depth + style) / 3;

  let strategy: BehaviorStrategy = 'recounting';
  let rationale = '默认叙述事实, 尚未进入探索';

  if (aggregate >= HIGH_RESISTANCE_AGG && snapshot.trust < 0.4) {
    strategy = 'resistance';
    rationale = `整体防御强(agg=${aggregate.toFixed(2)})且信任低(${snapshot.trust.toFixed(2)}), 倾向抗拒`;
  } else if (verbal >= HIGH_VERBAL) {
    strategy = 'simple_response';
    rationale = `话量阻抗高(${verbal.toFixed(2)}), 倾向简短回应`;
  } else if (snapshot.trust >= OPEN_TRUST && depth < LOW_DEPTH) {
    strategy = snapshot.emotion.valence < 0 ? 'affective_exploration' : 'cognitive_exploration';
    rationale = `信任较高(${snapshot.trust.toFixed(2)})且深度阻抗低(${depth.toFixed(2)}), 进入探索`;
  }

  return {
    strategy,
    emotion: snapshot.emotion,
    resistance: snapshot.resistance,
    transference: snapshot.transference,
    forbiddenBehaviors: profile?.forbiddenBehaviors ?? [],
    rationale,
  };
}
