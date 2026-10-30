import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
// V2026-10-30 治本 (WP24 · 单场成本日志):
//   职责: 钉死「每轮用量累加 → closeSession 打一条 session_cost_summary」的闭环,
//         以及成本口径的诚实性 (输入侧不可得时必须落成 output_only, 不能拿 0 冒充).
//   边界: 全 mock; 不起 Nest 容器; 不连 DB / 不发网络.
//
//   为什么口径要单独钉 (而不只钉"有个日志"):
//     上游**流式**路径只给累计 tokenCount, 没有 prompt/completion 拆分 ——
//     输入侧用量在主路径 (voice WS) 上就是**不可得**. 若哪天有人为了"让公式看起来对"
//     把不可得的输入侧按 0 算进全场成本, 成本日志就会**系统性偏低** ——
//     而它的用途恰恰是"防烧额度", 偏低的数字等于没有数字.
//     所以这里断言的是**口径**, 不只是数字.
//
//   反双胞胎 (与本单同款纪律):
//     - 不用 mock 把"输入侧不可得"改成"输入侧有值"来让测试好看: 流式就是不可得.
//     - 不断言"日志里有某个字符串"就完事: 断言解析后的**字段**, 免得格式变了数字还在.
//     - 不给 closeSession 减负: 收尾该做的照做, 本单只在旁边打一条日志.
//
//   验证: npx jest test/engine-adapters/wp24-session-cost-log.spec.ts
//   时间戳: 2026-10-30

import {
  accumulateSessionUsage,
  buildSessionCostSummary,
  DEFAULT_SESSION_COST_PRICING,
  emptySessionUsageTotals,
  estimateSessionCost,
  resolveSessionCostPricing,
  type SessionCostSummary,
  type SessionUsageTotals,
} from '../../src/engine-adapters/observability/session-cost';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import { createEngineStreamBackend } from '../../src/engine-adapters/wiring/engine.providers';

/**
 * 引擎门面 stub: open / close / turnStream 三件套.
 *
 * turnStream 吐出**一个增量**再返回渲染元信息 —— 与真实门面的形状一致
 * (真实链路是 "边吐边收", 这里只吐一句够走完 buildStream 的 happy path).
 */
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

/**
 * 抓 `session_cost_summary` 那条日志并解析出来.
 *
 * 为什么要从日志文本里解析而不是直接读内部字段: 内部累加器是私有的,
 * 真正对外的产物就是这条日志 —— 断言日志才是在断言"运维实际能拿到什么".
 */
function captureCostSummary(): { readonly summaries: SessionCostSummary[]; readonly logs: string[] } {
  const logs: string[] = [];
  vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    logs.push(typeof message === 'string' ? message : String(message));
  });
  return {
    get summaries() {
      return logs
        .filter((line) => line.includes('session_cost_summary'))
        .map((line) => {
          const json = line.slice(line.indexOf('{'));
          return JSON.parse(json) as SessionCostSummary;
        });
    },
    logs,
  };
}

describe('WP24 · 单场成本日志', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('用量累加 (纯函数)', () => {
    it('空起点: 一切归零, 输入侧标记为"不可得"', () => {
      const totals = emptySessionUsageTotals();
      expect(totals).toEqual({
        turnCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        promptTokensAvailable: false,
      });
    });

    it('上游报了输入侧 → 累加进去, 且标记为可得', () => {
      let totals = emptySessionUsageTotals();
      totals = accumulateSessionUsage(totals, { promptTokens: 100, completionTokens: 20, totalTokens: 120 });
      totals = accumulateSessionUsage(totals, { promptTokens: 150, completionTokens: 30, totalTokens: 180 });

      expect(totals.turnCount).toBe(2);
      expect(totals.promptTokens).toBe(250);
      expect(totals.completionTokens).toBe(50);
      expect(totals.totalTokens).toBe(300);
      expect(totals.promptTokensAvailable).toBe(true);
    });

    it('上游没报输入侧 (流式路径的常态) → 累加值仍是 0, 但标记保持"不可得"', () => {
      let totals = emptySessionUsageTotals();
      totals = accumulateSessionUsage(totals, { completionTokens: 40, totalTokens: 40 });

      expect(totals.promptTokens).toBe(0);
      expect(totals.promptTokensAvailable).toBe(false);
    });

    it('混合: 只要有一轮报了输入侧, 本场就算"可得"', () => {
      let totals = emptySessionUsageTotals();
      totals = accumulateSessionUsage(totals, { completionTokens: 40, totalTokens: 40 });
      totals = accumulateSessionUsage(totals, { promptTokens: 80, completionTokens: 10, totalTokens: 90 });

      expect(totals.promptTokensAvailable).toBe(true);
      expect(totals.promptTokens).toBe(80);
    });

    it('模型名: 后一轮覆盖前一轮; 后一轮没报则保留前一轮的', () => {
      let totals = emptySessionUsageTotals();
      totals = accumulateSessionUsage(totals, { completionTokens: 1, totalTokens: 1, model: 'model-a' });
      totals = accumulateSessionUsage(totals, { completionTokens: 1, totalTokens: 1, model: 'model-b' });
      expect(totals.model).toBe('model-b');

      totals = accumulateSessionUsage(totals, { completionTokens: 1, totalTokens: 1 });
      expect(totals.model).toBe('model-b');
    });
  });

  describe('成本折算与口径 (纯函数)', () => {
    const pricing = { inputPer1k: 0.0015, outputPer1k: 0.0045 };

    it('输入侧可得 → costBasis=full, 两侧都计', () => {
      const totals: SessionUsageTotals = {
        turnCount: 1,
        promptTokens: 1000,
        completionTokens: 1000,
        totalTokens: 2000,
        reasoningTokens: 0,
        promptTokensAvailable: true,
      };
      const cost = estimateSessionCost(totals, pricing);
      expect(cost.costBasis).toBe('full');
      expect(cost.estimatedCostCny).toBeCloseTo(0.0015 + 0.0045, 10);
    });

    it('输入侧不可得 → costBasis=output_only, 成本只含输出侧 (是下界, 不是全场)', () => {
      const totals: SessionUsageTotals = {
        turnCount: 1,
        promptTokens: 0,
        completionTokens: 1000,
        totalTokens: 1000,
        reasoningTokens: 0,
        promptTokensAvailable: false,
      };
      const cost = estimateSessionCost(totals, pricing);
      expect(cost.costBasis).toBe('output_only');
      expect(cost.estimatedCostCny).toBeCloseTo(0.0045, 10);
      // 关键: 不可得 ≠ 0 元. 口径必须落在数据里, 不能只靠"看文档的人记得".
      expect(cost.estimatedCostCny).toBeLessThan(0.0045 + 0.0015);
    });

    it('定价走参数: 换单价, 成本跟着变 (env 可配的前提)', () => {
      const totals: SessionUsageTotals = {
        turnCount: 1,
        promptTokens: 0,
        completionTokens: 1000,
        totalTokens: 1000,
        reasoningTokens: 0,
        promptTokensAvailable: false,
      };
      const cheap = estimateSessionCost(totals, { inputPer1k: 0.0015, outputPer1k: 0.001 });
      const pricey = estimateSessionCost(totals, { inputPer1k: 0.0015, outputPer1k: 0.009 });
      expect(cheap.estimatedCostCny).toBeCloseTo(0.001, 10);
      expect(pricey.estimatedCostCny).toBeCloseTo(0.009, 10);
    });

    it('汇总字段齐全: totalTokens = prompt + completion', () => {
      const totals: SessionUsageTotals = {
        turnCount: 3,
        promptTokens: 1200,
        completionTokens: 800,
        totalTokens: 2000,
        reasoningTokens: 64,
        promptTokensAvailable: true,
        model: 'abab6.5s-chat',
      };
      const summary = buildSessionCostSummary({
        sessionId: 'sess-1',
        totals,
        pricing,
        enginePath: 'bdi',
      });

      expect(summary.event).toBe('session_cost_summary');
      expect(summary.sessionId).toBe('sess-1');
      expect(summary.model).toBe('abab6.5s-chat');
      expect(summary.totalPromptTokens).toBe(1200);
      expect(summary.totalCompletionTokens).toBe(800);
      expect(summary.totalTokens).toBe(2000);
      expect(summary.totalTokens).toBe(summary.totalPromptTokens + summary.totalCompletionTokens);
      expect(summary.turnCount).toBe(3);
      expect(summary.enginePath).toBe('bdi');
      expect(summary.costBasis).toBe('full');
    });

    it('模型没报 → model 为 null (而不是空串 / undefined)', () => {
      const summary = buildSessionCostSummary({
        sessionId: 'sess-1',
        totals: emptySessionUsageTotals(),
        pricing,
        enginePath: 'bdi',
      });
      expect(summary.model).toBeNull();
    });
  });

  describe('env 定价解析 (纯函数)', () => {
    it('合法值 → 原样生效', () => {
      const pricing = resolveSessionCostPricing({ inputPer1k: '0.002', outputPer1k: '0.006' });
      expect(pricing.inputPer1k).toBe(0.002);
      expect(pricing.outputPer1k).toBe(0.006);
    });

    it('缺省 → 走默认值', () => {
      const pricing = resolveSessionCostPricing({});
      expect(pricing.inputPer1k).toBe(DEFAULT_SESSION_COST_PRICING.inputPer1k);
      expect(pricing.outputPer1k).toBe(DEFAULT_SESSION_COST_PRICING.outputPer1k);
    });

    it('非法值 (空串 / 非数字 / 负数) → 回退默认, 不抛 (填错 env 不该让服务起不来)', () => {
      const pricing = resolveSessionCostPricing({ inputPer1k: '  ', outputPer1k: 'abc' });
      expect(pricing.inputPer1k).toBe(DEFAULT_SESSION_COST_PRICING.inputPer1k);
      expect(pricing.outputPer1k).toBe(DEFAULT_SESSION_COST_PRICING.outputPer1k);

      const negative = resolveSessionCostPricing({ inputPer1k: '-1' });
      expect(negative.inputPer1k).toBe(DEFAULT_SESSION_COST_PRICING.inputPer1k);
    });
  });

  describe('引擎后端闭环 (装配层 + 后端)', () => {
    it('一场会话结束 → 打一条 session_cost_summary, 数字对得上', async () => {
      const captured = captureCostSummary();

      const backend = createEngineStreamBackend({
        engine: buildEngineStub({
          fallbackUsed: false,
          usage: { promptTokens: 180, completionTokens: 120, totalTokens: 300 },
          model: 'abab6.5s-chat',
        }),
      });

      await backend.openSession({
        sessionId: 'sess-cost-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        templateId: 'vpt_intimate_avoidance_l1',
      });

      const { stream } = await backend.streamTurn({
        sessionId: 'sess-cost-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        userText: '我最近有点睡不着。',
      });

      for await (const _chunk of stream) {
        // 消费掉整条流 (buildStream 要跑完才会结算 usage)
      }

      backend.closeSession('sess-cost-1');

      expect(captured.summaries).toHaveLength(1);
      const summary = captured.summaries[0];
      expect(summary).toMatchObject({
        event: 'session_cost_summary',
        sessionId: 'sess-cost-1',
        model: 'abab6.5s-chat',
        totalPromptTokens: 180,
        totalCompletionTokens: 120,
        totalTokens: 300,
        turnCount: 1,
        enginePath: 'bdi',
        costBasis: 'full',
      });
      expect(summary.estimatedCostCny).toBeCloseTo(0.0015 * 0.18 + 0.0045 * 0.12, 10);
    });

    it('流式路径 (上游没给输入侧拆分) → costBasis 如实落成 output_only', async () => {
      const captured = captureCostSummary();

      const backend = createEngineStreamBackend({
        engine: buildEngineStub({
          fallbackUsed: false,
          // 流式的真实形状: 只有累计 tokenCount, 没有 promptTokens.
          usage: { completionTokens: 200, totalTokens: 200 },
        }),
      });

      await backend.openSession({
        sessionId: 'sess-cost-2',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
      });
      const { stream } = await backend.streamTurn({
        sessionId: 'sess-cost-2',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        userText: '在吗',
      });

      for await (const _chunk of stream) {
        // 消费整条流
      }
      backend.closeSession('sess-cost-2');

      expect(captured.summaries).toHaveLength(1);
      expect(captured.summaries[0]).toMatchObject({
        costBasis: 'output_only',
        totalPromptTokens: 0,
        totalCompletionTokens: 200,
      });
      expect(captured.summaries[0].model).toBeNull();
    });

    it('closeSession 被调两次 (voice 侧会各关一次) → 只打一条汇总', async () => {
      const captured = captureCostSummary();

      const backend = createEngineStreamBackend({
        engine: buildEngineStub({
          fallbackUsed: false,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        }),
      });

      await backend.openSession({
        sessionId: 'sess-cost-3',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
      });
      const { stream } = await backend.streamTurn({
        sessionId: 'sess-cost-3',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        userText: '在吗',
      });

      for await (const _chunk of stream) {
        // 消费整条流
      }

      backend.closeSession('sess-cost-3');
      backend.closeSession('sess-cost-3');

      expect(captured.summaries).toHaveLength(1);
    });

    it('定价走注入的 env 值 → 改单价, 日志里的成本跟着变', async () => {
      const captured = captureCostSummary();

      const backend = createEngineStreamBackend({
        engine: buildEngineStub({
          fallbackUsed: false,
          usage: { completionTokens: 1000, totalTokens: 1000 },
        }),
        pricing: { inputPer1k: 0.0015, outputPer1k: 0.01 },
      });

      await backend.openSession({
        sessionId: 'sess-cost-4',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
      });
      const { stream } = await backend.streamTurn({
        sessionId: 'sess-cost-4',
        tenantId: 'tenant-1',
        userId: 'user-1',
        personaId: 'p1',
        userText: '在吗',
      });

      for await (const _chunk of stream) {
        // 消费整条流
      }
      backend.closeSession('sess-cost-4');

      expect(captured.summaries[0].estimatedCostCny).toBeCloseTo(0.01, 10);
    });

    it('这场没走过引擎 (旧链路会话) → 不打汇总 (不是"花了 0 元", 是"不归引擎管")', () => {
      const captured = captureCostSummary();
      const backend = createEngineStreamBackend({
        engine: buildEngineStub({ fallbackUsed: false, usage: { completionTokens: 0, totalTokens: 0 } }),
      });

      backend.closeSession('never-opened-session');

      expect(captured.summaries).toHaveLength(0);
    });
  });
});
