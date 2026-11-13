// V2026-11-09 治本 (Phase2.5 WP-F · Step 0 — 自动对练成本/token 落库 · 单测):
//   覆盖任务单 §7 验收 ① 与 Step 0 的关键口径:
//     ① 结算时 token / 成本 / 成本口径写进 ap_practice_sessions
//     ② 成本走**同一张定价表** (LLM_PRICE_*) + 同一个 `estimateSessionCost()` → 单位是元
//     ③ failed 的场次**也落库** (已经花的钱不能因为异常就不记)
//     ④ 没有用量记录 → 0 token / 0 成本 / 口径 output_only (不编造)
//   全 mock: TurnEnginePort / CounselorAgentService / repo 全是替身, 不起容器不连 DB.
//
//   验证: npx vitest run test/auto-practice/practice-runner-cost.spec.ts
//   时间戳: 2026-11-09 GMT+8

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import type { EngineTurnResult, TurnEnginePort } from '../../src/auto-practice/ports/turn-engine.port.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';
import { DEFAULT_SESSION_COST_PRICING } from '../../src/engine-adapters/observability/session-cost.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 造一个 CounselorMode 替身. */
function makeMode(): CounselorMode {
  const m = new CounselorMode();
  m.id = 'expert';
  m.name = '专家';
  m.systemPrompt = '你是专家';
  m.description = '';
  m.enabled = 1;
  m.sortOrder = 1;
  return m;
}

/**
 * 造一轮引擎结果.
 *
 * ⚠️ `usage` 缺省 = 这一轮**没有**用量记录 (老数据 / 没留痕) —— 落库必须是 0, 不是编造.
 */
function makeTurn(turnIndex: number, reply: string, usage?: { promptTokens: number; completionTokens: number }): EngineTurnResult {
  return {
    reply,
    turnIndex,
    crisisDetected: false,
    crisisCategory: null,
    trace: {
      turnIndex,
      crisis: { detected: false, category: null },
      ...(usage
        ? {
            llmUsage: {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              reasoningTokens: 0,
              ttftMs: 10,
              finishReason: 'stop',
            },
          }
        : {}),
    } as EngineTurnResult['trace'],
  };
}

/** 假 repo: 记录 create/update 调用. */
function stubRepo() {
  const created: unknown[] = [];
  return {
    created,
    create: (fields: unknown) => fields,
    save: vi.fn(async (row: unknown) => {
      created.push(row);
      return row;
    }),
    update: vi.fn(async () => {}),
    find: vi.fn(async () => []),
  };
}

/** 假配置服务 (只回 env 字典). */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

describe('PracticeRunnerService · WP-F 成本落库', () => {
  let engine: { open: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let counselor: { generate: ReturnType<typeof vi.fn> };
  let repo: ReturnType<typeof stubRepo>;

  /** 装一个 runner (第 6 个构造参数 = ConfigService, 单价从它读). */
  function buildRunner(env: Record<string, string> = {}): PracticeRunnerService {
    const fingerprint = {
      build: vi.fn(async () => ({
        model: 'MiniMax-M3.1-Flash',
        characterSlug: 'vpt_test',
        characterVersion: '1.0.0',
        counselorModeId: 'expert',
        deliberationMode: 'rule_only',
        scenarioType: 'full_simulation',
        engineVersion: 'test',
        sessionSeed: 'single/test',
      })),
    };
    return new PracticeRunnerService(
      engine as unknown as TurnEnginePort,
      counselor as never,
      fingerprint as never,
      repo as never,
      undefined, // gateway optional, 单测不给
      stubConfig(env) as never,
    );
  }

  /** 取最后一次 update 的落库字段. */
  function lastUpdate(): Record<string, unknown> {
    const calls = repo.update.mock.calls as unknown as [unknown, Record<string, unknown>][];
    return calls.at(-1)?.[1] ?? {};
  }

  beforeEach(() => {
    engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
    counselor = { generate: vi.fn() };
    repo = stubRepo();
    engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
    counselor.generate.mockResolvedValue({ text: '咨询师话', model: 'test-model', degraded: false });
  });

  it('结算时把 token / 成本 / 成本口径落库 (单位: 元)', async () => {
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '来访第一句内容', { promptTokens: 1000, completionTokens: 500 }))
      .mockResolvedValueOnce(makeTurn(2, '来访第二句内容', { promptTokens: 1000, completionTokens: 500 }));

    const runner = buildRunner();
    const result = await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 2 });

    expect(result.status).toBe('completed');
    const row = lastUpdate();
    expect(row['promptTokens']).toBe(2000);
    expect(row['completionTokens']).toBe(1000);
    expect(row['totalTokens']).toBe(3000);
    // 2k 输入 + 1k 输出, 按默认单价 (元 / 千 token).
    const expected = 2 * DEFAULT_SESSION_COST_PRICING.inputPer1k + 1 * DEFAULT_SESSION_COST_PRICING.outputPer1k;
    expect(row['totalCostCny']).toBeCloseTo(expected, 6);
    expect(row['costBasis']).toBe('full');
  });

  it('单价走 LLM_PRICE_* (与正式训练看板同一张定价表)', async () => {
    engine.turn.mockResolvedValueOnce(makeTurn(1, '来访第一句内容', { promptTokens: 1000, completionTokens: 1000 }));

    const runner = buildRunner({ LLM_PRICE_INPUT_PER_1K: '0.002', LLM_PRICE_OUTPUT_PER_1K: '0.006' });
    await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const row = lastUpdate();
    expect(row['totalCostCny']).toBeCloseTo(0.008, 6);
  });

  it('failed 的场次也落库已经花掉的 token (钱不能因为异常就不记)', async () => {
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '来访第一句内容', { promptTokens: 1000, completionTokens: 500 }))
      .mockRejectedValueOnce(new Error('engine exploded'));

    const runner = buildRunner();
    const result = await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 5 });

    expect(result.status).toBe('failed');
    const row = lastUpdate();
    expect(row['promptTokens']).toBe(1000);
    expect(row['completionTokens']).toBe(500);
    expect(row['totalTokens']).toBe(1500);
    expect(row['totalCostCny']).toBeGreaterThan(0);
  });

  it('没有用量记录 → 0 token / 0 成本, 口径 output_only (不编造)', async () => {
    engine.turn.mockResolvedValueOnce(makeTurn(1, '来访第一句内容'));

    const runner = buildRunner();
    await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const row = lastUpdate();
    expect(row['promptTokens']).toBe(0);
    expect(row['completionTokens']).toBe(0);
    expect(row['totalTokens']).toBe(0);
    expect(row['totalCostCny']).toBe(0);
    expect(row['costBasis']).toBe('output_only');
  });
});
