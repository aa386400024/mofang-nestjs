import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

// AF-261 · 单场成本按 provider 分账:
//   钉死「同一场里豆包与 MiniMax 各自单价、各自 token 桶、合计等于分桶之和」。
//   边界: 纯函数单测 + 后端闭环各一; 全 mock, 不连 DB / 不发网络.

import {
  accumulateSessionUsage,
  buildSessionCostSummary,
  emptySessionUsageTotals,
  estimateSessionCost,
  resolveSessionCostPricingTable,
  type SessionCostPricing,
  type SessionCostPricingTable,
  type SessionCostSummary,
  type SessionUsageTotals,
} from '../../src/engine-adapters/observability/session-cost.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import { createEngineStreamBackend } from '../../src/engine-adapters/wiring/engine.providers.js';

vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const FALLBACK: SessionCostPricing = { inputPer1k: 0.0015, outputPer1k: 0.0045 };
const TABLE: SessionCostPricingTable = {
  fallback: FALLBACK,
  byProvider: {
    doubao: { inputPer1k: 0.002, outputPer1k: 0.006 },
    minimax: { inputPer1k: 0.001, outputPer1k: 0.004 },
  },
};

function buildEngineStub(render: TurnRenderResult['render']): EngineTurnService {
  return {
    open: () => ({ handleId: 'handle-1', sessionId: 'session-1' }),
    close: () => {},
    turnStream: async (
      _handleId: string,
      _input: unknown,
      handlers: { readonly onDelta?: (delta: string) => void | Promise<void> },
    ): Promise<TurnRenderResult> => {
      await handlers.onDelta?.('我最近有点睡不着。');
      return {
        reply: '我最近有点睡不着。',
        snapshot: {} as TurnRenderResult['snapshot'],
        turnIndex: 1,
        render,
      };
    },
  } as unknown as EngineTurnService;
}

function captureCostSummary(): SessionCostSummary[] {
  const summaries: SessionCostSummary[] = [];
  vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    const line = typeof message === 'string' ? message : String(message);
    if (!line.includes('session_cost_summary')) return;
    summaries.push(JSON.parse(line.slice(line.indexOf('{'))) as SessionCostSummary);
  });
  return summaries;
}

describe('AF-261 · provider 成本分账', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('累加时按 provider 分桶，全局累计仍守恒', () => {
    let totals = emptySessionUsageTotals();
    totals = accumulateSessionUsage(totals, {
      provider: 'doubao',
      model: 'doubao-seed-character-260628',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    totals = accumulateSessionUsage(totals, {
      provider: 'minimax',
      model: 'MiniMax-M3',
      promptTokens: 200,
      completionTokens: 30,
      totalTokens: 230,
    });

    expect(totals.turnCount).toBe(2);
    expect(totals.promptTokens).toBe(300);
    expect(totals.completionTokens).toBe(50);
    expect(totals.byProvider?.['doubao']).toMatchObject({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      model: 'doubao-seed-character-260628',
    });
    expect(totals.byProvider?.['minimax']).toMatchObject({
      promptTokens: 200,
      completionTokens: 30,
      totalTokens: 230,
      model: 'MiniMax-M3',
    });
  });

  it('两家不同单价分别计价，合计等于分桶之和', () => {
    const totals: SessionUsageTotals = {
      turnCount: 2,
      promptTokens: 2000,
      completionTokens: 2000,
      totalTokens: 4000,
      reasoningTokens: 0,
      promptTokensAvailable: true,
      byProvider: {
        doubao: {
          promptTokens: 1000,
          completionTokens: 1000,
          totalTokens: 2000,
          reasoningTokens: 0,
          promptTokensAvailable: true,
        },
        minimax: {
          promptTokens: 1000,
          completionTokens: 1000,
          totalTokens: 2000,
          reasoningTokens: 0,
          promptTokensAvailable: true,
        },
      },
    };
    const cost = estimateSessionCost(totals, FALLBACK, TABLE);
    expect(cost.costBasis).toBe('full');
    // doubao: 1*0.002 + 1*0.006 = 0.008; minimax: 1*0.001 + 1*0.004 = 0.005
    expect(cost.estimatedCostCny).toBeCloseTo(0.013, 10);
  });

  it('未配置 provider 覆盖价 → 回落 fallback，并如实标注 pricingSource', () => {
    const table: SessionCostPricingTable = { fallback: FALLBACK, byProvider: {} };
    const totals: SessionUsageTotals = {
      turnCount: 1,
      promptTokens: 1000,
      completionTokens: 1000,
      totalTokens: 2000,
      reasoningTokens: 0,
      promptTokensAvailable: true,
      byProvider: {
        doubao: {
          promptTokens: 1000,
          completionTokens: 1000,
          totalTokens: 2000,
          reasoningTokens: 0,
          promptTokensAvailable: true,
        },
      },
    };
    const summary = buildSessionCostSummary({
      sessionId: 's-1',
      totals,
      pricing: FALLBACK,
      pricingTable: table,
      enginePath: 'bdi',
    });
    expect(summary.estimatedCostCny).toBeCloseTo(0.006, 10);
    expect(summary.providerBreakdown?.[0]).toMatchObject({
      provider: 'doubao',
      pricingSource: 'fallback',
      costBasis: 'full',
    });
  });

  it('某个 provider 缺输入侧 → 该桶只计输出侧，整场 costBasis=output_only', () => {
    const totals: SessionUsageTotals = {
      turnCount: 2,
      promptTokens: 1000,
      completionTokens: 2000,
      totalTokens: 3000,
      reasoningTokens: 0,
      promptTokensAvailable: true,
      byProvider: {
        doubao: {
          promptTokens: 1000,
          completionTokens: 1000,
          totalTokens: 2000,
          reasoningTokens: 0,
          promptTokensAvailable: true,
        },
        minimax: {
          promptTokens: 0,
          completionTokens: 1000,
          totalTokens: 1000,
          reasoningTokens: 0,
          promptTokensAvailable: false,
        },
      },
    };
    const cost = estimateSessionCost(totals, FALLBACK, TABLE);
    expect(cost.costBasis).toBe('output_only');
    expect(cost.estimatedCostCny).toBeCloseTo(0.008 + 0.004, 10);
  });

  it('env 解析: provider 覆盖价生效，非法值回落 fallback', () => {
    const table = resolveSessionCostPricingTable({
      inputPer1k: '0.0015',
      outputPer1k: '0.0045',
      providers: {
        doubao: { inputPer1k: '0.002', outputPer1k: '0.006' },
        minimax: { inputPer1k: 'abc', outputPer1k: '-1' },
      },
    });
    expect(table.fallback).toEqual({ inputPer1k: 0.0015, outputPer1k: 0.0045 });
    expect(table.byProvider['doubao']).toEqual({ inputPer1k: 0.002, outputPer1k: 0.006 });
    expect(table.byProvider['minimax']).toEqual({ inputPer1k: 0.0015, outputPer1k: 0.0045 });
  });

  it('后端闭环: render.providerHint 进入分桶，summary 带 providerBreakdown', async () => {
    const summaries = captureCostSummary();
    const backend = createEngineStreamBackend({
      engine: buildEngineStub({
        fallbackUsed: false,
        providerHint: 'doubao',
        model: 'doubao-seed-character-260628',
        usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
      }),
      pricing: FALLBACK,
      pricingTable: TABLE,
    });

    await backend.openSession({
      sessionId: 'sess-af261',
      tenantId: 'tenant-1',
      userId: 'user-1',
      personaId: 'p1',
    });
    const { stream } = await backend.streamTurn({
      sessionId: 'sess-af261',
      tenantId: 'tenant-1',
      userId: 'user-1',
      personaId: 'p1',
      userText: '在吗',
    });
    for await (const _chunk of stream) {
      // 消费完整流，触发 usage 结算
    }
    backend.closeSession('sess-af261');

    expect(summaries).toHaveLength(1);
    expect(summaries[0].estimatedCostCny).toBeCloseTo(0.008, 10);
    expect(summaries[0].providerBreakdown).toEqual([
      expect.objectContaining({
        provider: 'doubao',
        model: 'doubao-seed-character-260628',
        promptTokens: 1000,
        completionTokens: 1000,
        pricingSource: 'provider_override',
        costBasis: 'full',
      }),
    ]);
  });
});
