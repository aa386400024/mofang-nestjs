// V2026-11-05 治本 (Admin Dashboard · 定价 env 的唯一映射):
//   职责: 把 **env 键 → 成本单价** 这层映射收在一处.
//
//   为什么单独一个文件 (而不是两个控制器各写一个私有方法):
//     定价 env 是 **WP24 就有的** 两个键 (`LLM_PRICE_INPUT_PER_1K` /
//     `LLM_PRICE_OUTPUT_PER_1K`) —— 同一份单价只有一份 env. WP31 的成本看板
//     (`AdminDebugController`) 与本单的仪表盘 (`AdminInsightsController`) 都要读它;
//     两处各抄一遍键名 = 迟早有一天改了一处忘了另一处 → **看板上的数和单场成本
//     日志里的数对不上**, 而这种漂移极难排查 (数字差一点点, 像数据问题不像配置问题).
//
//   为什么不放进 `cost-view.ts`:
//     那个模块是**纯函数层** (零 @nestjs / 零 env 读取 / 定价由调用方注入),
//     别把 env 读取塞进去 —— 保持它可单测.
//
//   为什么参数是个普通函数而不是 `ConfigService`:
//     本模块不依赖 Nest —— 谁读 env 怎么读, 由调用方给一个 `get` 就行.
//     于是这个文件依然可以脱离框架单测.
//
//   验证: npx vitest run test/admin-debug/admin-insights.spec.ts
//   时间戳: 2026-11-05 GMT+8

import { resolveSessionCostPricing, type SessionCostPricing } from '../engine-adapters/observability/session-cost.js';

/**
 * 定价 env 键 (WP24 加的, 单场成本日志与两个看板共用).
 *
 * ⚠️ 别新增 `LLM_COST_*` 之类的平行键 —— 那就是**两张定价表**.
 */
export const COST_PRICE_ENV_KEYS = {
  inputPer1k: 'LLM_PRICE_INPUT_PER_1K',
  outputPer1k: 'LLM_PRICE_OUTPUT_PER_1K',
} as const;

/**
 * 从 env 读成本单价.
 *
 * 非法值 (空串 / 非数字 / 负数) 一律**回退默认, 不抛** —— 口径在
 * `resolveSessionCostPricing` (与单场成本日志同一个函数, 同一个默认价).
 *
 * @param get 读 env 的函数 (通常是 `ConfigService.get` 的薄包装)
 * @returns 单价 (元 / 千 token)
 */
export function resolveCostPricingFromEnv(get: (key: string) => string | undefined): SessionCostPricing {
  return resolveSessionCostPricing({
    inputPer1k: get(COST_PRICE_ENV_KEYS.inputPer1k),
    outputPer1k: get(COST_PRICE_ENV_KEYS.outputPer1k),
  });
}
