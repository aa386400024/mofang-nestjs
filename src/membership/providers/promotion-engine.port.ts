import type { PromotionDecision, PromotionEvaluationInput } from '../domain/membership.types.js';

/**
 * 活动规则端口 — 只做“命中哪个活动、折扣多少、赠多少、规则版本是什么”。
 *
 * 红线：端口不写订单、不改配额、不碰支付。金额最终仍由 PricingService 和订单服务计算。
 * 这样 flex-rules-engine / 自研规则表 / 运营后台都能替换，领域契约不变。
 */
export interface PromotionEnginePort {
  evaluate(input: PromotionEvaluationInput): PromotionDecision;
}

export const PROMOTION_ENGINE = 'PROMOTION_ENGINE';
