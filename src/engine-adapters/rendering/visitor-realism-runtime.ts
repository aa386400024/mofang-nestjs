// V2026-11-20 建立 (AF-208 · R2 生成侧真人度):
//   渲染适配器与 prompt 拼装共用的真人度运行态解析。
//
//   为什么单独成文件:
//     · prompt 层和生成层必须看到**同一份** profile / 事件计划，否则审计与注入会漂移；
//     · adapter 不应 import 巨大的 turn-render-orchestrator（会把 prompt 模板拖进生成路径）；
//     · 纯计算，不写日志、不读额外 env（只读 RENDER_REALISM_MODE）。

import type { AdaptiveRenderSpec } from './render-risk.js';
import {
  buildRealismEventPlan,
  buildVisitorRealismProfile,
  parseRealismMode,
  type RealismEventPlan,
  type RealismMode,
  type VisitorRealismProfile,
} from '../../shared/realism/index.js';

export interface VisitorRealismRuntime {
  readonly mode: RealismMode;
  readonly profile: VisitorRealismProfile;
  readonly eventPlan: RealismEventPlan;
}

/**
 * 从渲染规格解析本轮真人度运行态。
 *
 * 场景缺省与 R1 一致：不传 encounter 就是面对面咨询室。
 */
export function resolveVisitorRealismRuntime(spec: AdaptiveRenderSpec): VisitorRealismRuntime {
  const encounter = spec.encounter ?? { mode: 'in_person' };
  const mode = parseRealismMode(process.env['RENDER_REALISM_MODE']);
  const profile = buildVisitorRealismProfile(
    {
      attachmentStyle: spec.attachmentStyle,
      narrativeStyle: spec.narrativeStyle,
      expressionTone: spec.expressionTone,
      trust: spec.trust,
      arousal: spec.emotion.arousal,
      verbalResistance: spec.resistance.verbal,
      depthResistance: spec.resistance.depth,
      styleResistance: spec.resistance.style,
      bond: spec.bond,
      riskLevel: spec.riskSignal?.level,
      encounter,
    },
    mode,
  );
  return {
    mode,
    profile,
    eventPlan: buildRealismEventPlan({
      role: profile.role,
      state: profile.state,
      scene: profile.scene,
      quotas: profile.quotas,
    }),
  };
}
