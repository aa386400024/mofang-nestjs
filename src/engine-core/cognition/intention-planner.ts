// V2026-10-28 WP1 (引擎内核 · 意图规划器):
//   职责: 从迁移后的状态选一个主导行为策略, 组装本轮 Intention (五字段).
//   边界: 纯函数, 无随机. 规则轨只选状态可判定的策略; request / insight /
//         discussing_plans 等依赖来访侧信号的策略本期留类型不主动选出 (模型轨填充).
//
// V2026-11-03 WP42 (咨询同盟三维):
//   决策从"只看 trust"改成"看同盟三维".
//
//   为什么:
//     旧口径把"信任" / "安全感" / "纽带感"混成一个 trust —— 于是"相信你专业但
//     不敢说真话"这种来访, 与"真的信任你"被当成同一种状态, 一律进探索模式.
//     临床上前者需要的是"降低压力", 不是"追问到底".
//
//   两个口径的落点:
//     · 探索门槛: `min(trust, safety) >= open` —— 信任与安全感**都**够才敢探索.
//       纽带感 (bond) 不进门槛: 纽带是"关系深度"的刻度, 不是"敢不敢说话"的刻度 ——
//       一个来访完全可以还没产生情感连接, 但已经足够安全 (这正是安全型来访的路径).
//     · 抗拒触发: `trust < resistanceTrust || safety < resistanceSafety` ——
//       任一维度塌到低位即倾向抗拒.
//
//   ⚠️ 抗拒分支**保留了原有的整体防御聚合前提** (`aggregate >= HIGH_RESISTANCE_AGG`):
//     那一项管的是"阻抗三维整体是不是很高", 与信任无关, 是三维化之外的独立条件.
//     去掉它, 默认基线 (trust=0.3 < 0.4) 的全新会话会**每轮都进抗拒模式** ——
//     那是把"三维化"变成"行为大改", 不是本 WP 要做的事.
//
//   门槛值走**端口** (AllianceConfig.thresholds, 见 cognition/alliance-config.ts):
//     门槛是部署形态的决定 (内测期按真实对练校准), 不该写死在算子里.
//     缺省 = 内核种子值 (open 0.6 / resistanceTrust 0.4 / resistanceSafety 0.3).

import { resolveAllianceThresholds, type AllianceConfig } from './alliance-config.js';
import type { BdiSnapshot } from '../domain/bdi-snapshot.js';
import type { CharacterProfile } from '../domain/character-profile.js';
import type { BehaviorStrategy, Intention } from '../domain/intention.js';

/** 阻抗聚合阈值: 三维平均达到即视为整体防御. */
const HIGH_RESISTANCE_AGG = 0.6;
/** 话量阻抗阈值: 达到即倾向简短回应. */
const HIGH_VERBAL = 0.55;
/** 开放探索要求的深度阻抗上限. */
const LOW_DEPTH = 0.35;

/**
 * 规划本轮意图. 阈值为集中常量, 便于后期调参.
 * @param snapshot 迁移后的最新快照
 * @param profile 角色内核 (仅取禁止行为透传)
 * @param alliance 同盟三维端口 (缺省 = 内核种子门槛)
 */
export function planIntention(snapshot: BdiSnapshot, profile?: CharacterProfile, alliance?: AllianceConfig): Intention {
  const { verbal, depth, style } = snapshot.resistance;
  const aggregate = (verbal + depth + style) / 3;
  const thresholds = resolveAllianceThresholds(alliance);
  // WP42: 探索门槛取信任与安全感的**较小者** —— 短板决定能不能探索.
  const allianceGate = Math.min(snapshot.trust, snapshot.safety);
  // WP42: 抗拒触发 —— 信任或安全感任一塌到低位即算.
  const allianceLow = snapshot.trust < thresholds.resistanceTrust || snapshot.safety < thresholds.resistanceSafety;

  let strategy: BehaviorStrategy = 'recounting';
  let rationale = '默认叙述事实, 尚未进入探索';

  if (aggregate >= HIGH_RESISTANCE_AGG && allianceLow) {
    strategy = 'resistance';
    rationale = `整体防御强(agg=${aggregate.toFixed(2)})且信任/安全感偏低(trust=${snapshot.trust.toFixed(2)}, safety=${snapshot.safety.toFixed(2)}), 倾向抗拒`;
  } else if (verbal >= HIGH_VERBAL) {
    strategy = 'simple_response';
    rationale = `话量阻抗高(${verbal.toFixed(2)}), 倾向简短回应`;
  } else if (allianceGate >= thresholds.open && depth < LOW_DEPTH) {
    strategy = snapshot.emotion.valence < 0 ? 'affective_exploration' : 'cognitive_exploration';
    rationale = `信任与安全感均达探索门槛(min=${allianceGate.toFixed(2)}, trust=${snapshot.trust.toFixed(2)}, safety=${snapshot.safety.toFixed(2)})且深度阻抗低(${depth.toFixed(2)}), 进入探索`;
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
