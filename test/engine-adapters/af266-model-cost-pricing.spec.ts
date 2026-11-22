import { describe, expect, it } from 'vitest';

import {
  accumulateSessionUsage,
  buildProviderBreakdown,
  emptySessionUsageTotals,
  estimateSessionCost,
  OFFICIAL_MODEL_PRICING,
  resolveSessionCostPricingTable,
} from '../../src/engine-adapters/observability/session-cost.js';

const FALLBACK = { inputPer1k: 0.0015, outputPer1k: 0.0045 } as const;

function totalsFor(rounds: readonly { provider: string; model: string; promptTokens: number; completionTokens: number }[]) {
  return rounds.reduce(
    (totals, round) =>
      accumulateSessionUsage(totals, {
        provider: round.provider,
        model: round.model,
        promptTokens: round.promptTokens,
        completionTokens: round.completionTokens,
        totalTokens: round.promptTokens + round.completionTokens,
      }),
    emptySessionUsageTotals(),
  );
}

describe('AF-266 模型维度成本', () => {
  it('角色模型命中官方模型价，不再按全局回落价高估', () => {
    const table = resolveSessionCostPricingTable({});
    const totals = totalsFor([{ provider: 'doubao', model: 'doubao-seed-character-260628', promptTokens: 1000, completionTokens: 1000 }]);
    const cost = estimateSessionCost(totals, FALLBACK, table);
    const breakdown = buildProviderBreakdown(totals, FALLBACK, table);

    // 0.0008 + 0.002 = 0.0028；旧全局价会是 0.0015 + 0.0045 = 0.006。
    expect(cost.estimatedCostCny).toBe(0.0028);
    expect(cost.costBasis).toBe('full');
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.pricingSource).toBe('model');
    expect(breakdown[0]?.estimatedCostCny).toBe(0.0028);
    expect(OFFICIAL_MODEL_PRICING['doubao/doubao-seed-character-260628']).toEqual({
      inputPer1k: 0.0008,
      outputPer1k: 0.002,
    });
  });

  it('未知豆包模型回落 provider 覆盖价，不被角色模型价误伤', () => {
    const table = resolveSessionCostPricingTable({
      providers: { doubao: { inputPer1k: '0.003', outputPer1k: '0.006' } },
    });
    const totals = totalsFor([{ provider: 'doubao', model: 'doubao-seed-2-1-pro-260628', promptTokens: 1000, completionTokens: 1000 }]);
    const cost = estimateSessionCost(totals, FALLBACK, table);
    const breakdown = buildProviderBreakdown(totals, FALLBACK, table);

    expect(cost.estimatedCostCny).toBe(0.009);
    expect(breakdown[0]?.pricingSource).toBe('provider_override');
  });

  it('同场跨 provider 分桶：豆包角色用模型价，MiniMax 用回落价，总价等于明细之和', () => {
    const table = resolveSessionCostPricingTable({});
    const totals = totalsFor([
      { provider: 'doubao', model: 'doubao-seed-character-260628', promptTokens: 1000, completionTokens: 1000 },
      { provider: 'minimax', model: 'MiniMax-M3', promptTokens: 1000, completionTokens: 1000 },
    ]);
    const cost = estimateSessionCost(totals, FALLBACK, table);
    const breakdown = buildProviderBreakdown(totals, FALLBACK, table);

    expect(breakdown.map((item) => item.pricingSource)).toEqual(['model', 'fallback']);
    // 0.0028 + 0.006 = 0.0088。
    expect(cost.estimatedCostCny).toBe(0.0088);
    expect(breakdown.reduce((sum, item) => sum + item.estimatedCostCny, 0)).toBeCloseTo(0.0088, 6);
  });

  it('env 模型覆盖键可按 provider/model 纠偏，并覆盖内置官方价', () => {
    const table = resolveSessionCostPricingTable({
      models: {
        'doubao/doubao-seed-character-260628': { inputPer1k: '0.001', outputPer1k: '0.003' },
      },
    });
    const totals = totalsFor([{ provider: 'doubao', model: 'doubao-seed-character-260628', promptTokens: 1000, completionTokens: 1000 }]);
    const cost = estimateSessionCost(totals, FALLBACK, table);
    const breakdown = buildProviderBreakdown(totals, FALLBACK, table);

    expect(cost.estimatedCostCny).toBe(0.004);
    expect(breakdown[0]?.pricingSource).toBe('model');
  });

  it('模型名缺失时不吃模型价，回落 provider 覆盖价', () => {
    const table = resolveSessionCostPricingTable({
      providers: { doubao: { inputPer1k: '0.003', outputPer1k: '0.006' } },
    });
    const totals = totalsFor([{ provider: 'doubao', model: '', promptTokens: 1000, completionTokens: 1000 }]);
    const breakdown = buildProviderBreakdown(totals, FALLBACK, table);

    expect(breakdown[0]?.model).toBe('');
    expect(breakdown[0]?.pricingSource).toBe('provider_override');
    expect(breakdown[0]?.estimatedCostCny).toBe(0.009);
  });
});
