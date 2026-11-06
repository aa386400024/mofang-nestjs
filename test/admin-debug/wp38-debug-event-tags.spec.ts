// V2026-11-06 治本 (WP38 · 调试 trace 接引擎事件标签 · 单测):
//   覆盖任务单 §2.2 的验收:
//     ① EngineTurnOutput 有 events 可选字段;
//     ② 内核 turn() 真的填了这个字段 (有事件时非空);
//     ③ 适配层透传 (门面把内核出参原样带出);
//     ④ 调试 trace 里有 eventTags (数组) + 中文标签;
//     ⑤ 中文标签映射覆盖内核**全部** 11 类事件 (前端那份映射缺 7 个、多 3 个).
//
//   全 mock: 调试服务用替身 (引擎 / 角色解析 / Redis / 存储 / 标题生成器),
//             内核那一段用真 InMemoryEngineSession (只读出口必须真跑一遍才算数).
//
//   验证: npx vitest run test/admin-debug/wp38-debug-event-tags.spec.ts
//
//   时间戳: 2026-11-06

import { describe, expect, it } from 'vitest';

import type { DebugSessionMessage, DebugSessionRecord, DebugSessionSummary } from '../../src/admin-debug/debug-session-store.js';
import { DebugSessionService } from '../../src/admin-debug/debug-session.service.js';
import { COUNSELOR_EVENT_LABELS, labelCounselorEvent } from '../../src/admin-debug/event-tag-labels.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import type { ResolvedCharacter } from '../../src/engine-adapters/wiring/character/character-profile.resolver.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { createEmptyBdiSnapshot, type BdiSnapshot, type CharacterProfile } from '../../src/engine-core/index.js';

const KNOWN_SLUG = 'vpt_intimate_avoidance_l1';

/**
 * 造一份可控的 BDI 快照.
 */
function makeSnapshot(): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return {
    ...base,
    trust: 0.5,
    safety: 0.4,
    bond: 0.1,
    emotion: { ...base.emotion, valence: 0.5, arousal: 0.5, label: 'neutral' },
    resistance: { verbal: 0.3, depth: 0.3, style: 0.3 },
  };
}

/**
 * 造一份带事件分类的门面结算结果.
 */
function makeTurnResult(events: TurnRenderResult['events']): TurnRenderResult {
  const snapshot = makeSnapshot();
  return {
    reply: '（来访者的回应）',
    snapshot,
    turnIndex: 1,
    ...(events ? { events } : {}),
    intention: {
      strategy: 'simple_response',
      emotion: snapshot.emotion,
      resistance: snapshot.resistance,
      transference: snapshot.transference,
      forbiddenBehaviors: [],
    },
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 120, totalTokens: 300, promptTokens: 180, reasoningTokens: 60 },
      model: 'MiniMax-M3.1-Flash',
      spec: { taskKind: 'chat', promptPreview: '你是一个来访者…', maxCompletionTokens: 1500, reasoningEffort: 'medium' },
      finishReason: 'stop',
      ttftMs: 420,
      promptFull: '你是一个来访者……(完整 system prompt)',
    },
  };
}

/**
 * 引擎门面替身 (按队列返回结算结果).
 */
class StubEngineTurnService {
  readonly queue: TurnRenderResult[] = [];

  open(input: { readonly sessionId: string }): { handleId: string; sessionId: string } {
    return { handleId: `handle-${input.sessionId}`, sessionId: input.sessionId };
  }

  async turnStream(): Promise<TurnRenderResult> {
    const next = this.queue.shift();
    if (!next) throw new Error('测试未预置结算结果');
    return next;
  }

  close(): void {
    // 无状态可清.
  }
}

/**
 * 角色解析端口替身.
 */
class StubCharacterResolver {
  async resolve(): Promise<ResolvedCharacter | null> {
    return { characterProfile: makeCharacterProfile(), seed: 42, displayName: '亲密回避型 L1' };
  }
}

/**
 * 角色内核基线 (只需结构对).
 */
function makeCharacterProfile(): CharacterProfile {
  return { coreBeliefs: [], attachmentStyle: 'avoidant', personalityTraits: { agreeableness: 0.4 } };
}

/**
 * Redis 替身 (只回 get).
 */
class StubRedis {
  async get(): Promise<string | null> {
    return null;
  }
}

/**
 * 内存版调试会话存储 (替身).
 */
class StubDebugSessionStore {
  readonly records = new Map<string, DebugSessionRecord>();

  directory(): string {
    return '(stub)';
  }

  async create(record: DebugSessionRecord): Promise<DebugSessionRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async appendTurn(
    id: string,
    message: DebugSessionMessage,
    reply: DebugSessionMessage,
    trace: unknown,
  ): Promise<DebugSessionRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const updated: DebugSessionRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      turnCount: current.turnCount + 1,
      messages: [...current.messages, message, reply],
      traces: [...current.traces, trace],
    };
    this.records.set(id, updated);
    return updated;
  }

  async updateTitle(id: string, title: string, source: 'llm' | 'manual'): Promise<DebugSessionRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const updated: DebugSessionRecord = { ...current, title, titleSource: source, updatedAt: new Date().toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  async markCompleted(id: string): Promise<DebugSessionRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const updated: DebugSessionRecord = { ...current, status: 'completed', updatedAt: new Date().toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  async list(): Promise<DebugSessionSummary[]> {
    return [...this.records.values()].map((record) => ({
      id: record.id,
      title: record.title,
      characterSlug: record.characterSlug,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      turnCount: record.turnCount,
      status: record.status,
      resumable: record.kernelState !== null,
    }));
  }

  async get(id: string): Promise<DebugSessionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }
}

/**
 * 标题生成器替身.
 */
class StubTitleGenerator {
  async generate(): Promise<string> {
    return '来访者初始访谈';
  }
}

/**
 * 造一套调试服务 (替身全注入).
 */
function buildService(): DebugSessionService {
  const config = {
    get<T>(key: string): T | undefined {
      const env: Record<string, string> = { ENGINE_DEBUG_CHAT_ENABLED: '1' };
      return env[key] as T | undefined;
    },
  };
  return new DebugSessionService(
    new StubEngineTurnService() as unknown as ConstructorParameters<typeof DebugSessionService>[0],
    new StubCharacterResolver(),
    new StubRedis() as unknown as ConstructorParameters<typeof DebugSessionService>[2],
    config as unknown as ConstructorParameters<typeof DebugSessionService>[3],
    new StubDebugSessionStore() as unknown as ConstructorParameters<typeof DebugSessionService>[4],
    new StubTitleGenerator(),
    {
      restoreBdiState: async () => 'restored' as const,
      restoreMemories: async () => 0,
    } as unknown as ConstructorParameters<typeof DebugSessionService>[6],
  );
}

describe('WP38 · 调试 trace 接引擎事件标签', () => {
  describe('① 内核只读出口', () => {
    it('turn() 出参带 events (咨询师说了共情 → 命中共情类)', async () => {
      const session = new InMemoryEngineSession({
        bdiStates: new InMemoryBdiStateRepository(),
        memories: new InMemoryMemoryStore(),
      });
      const handle = session.openSession({ sessionId: 's1', tenantId: 't1', visitorId: 'v1' });

      const output = await session.turn(handle.handleId, { userText: '我理解你的感受，这种情绪我能理解。' });

      expect(output.events).toBeDefined();
      expect(output.events?.length).toBeGreaterThan(0);
      expect(output.events).toContain('empathy');
    });

    it('没命中任何类别时挂 neutral (内核始终给得出一个结论)', async () => {
      const session = new InMemoryEngineSession({
        bdiStates: new InMemoryBdiStateRepository(),
        memories: new InMemoryMemoryStore(),
      });
      const handle = session.openSession({ sessionId: 's2', tenantId: 't1', visitorId: 'v1' });

      const output = await session.turn(handle.handleId, { userText: '……' });

      expect(output.events).toContain('neutral');
    });
  });

  describe('② 中文标签映射 (后端唯一真相)', () => {
    it('覆盖内核全部 11 类事件', () => {
      expect(Object.keys(COUNSELOR_EVENT_LABELS)).toHaveLength(11);
      for (const label of Object.values(COUNSELOR_EVENT_LABELS)) {
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it('前端那份映射缺的 7 个, 后端全都有', () => {
      expect(COUNSELOR_EVENT_LABELS.acceptance).toBeTruthy();
      expect(COUNSELOR_EVENT_LABELS.affirmation).toBeTruthy();
      expect(COUNSELOR_EVENT_LABELS.judgment).toBeTruthy();
      expect(COUNSELOR_EVENT_LABELS.preaching).toBeTruthy();
      expect(COUNSELOR_EVENT_LABELS.minimizing).toBeTruthy();
      expect(COUNSELOR_EVENT_LABELS.boundary_cross).toBeTruthy();
      expect(COUNSELOR_EVENT_LABELS.sensitive_touch).toBeTruthy();
    });

    it('未知 kind → 原样返回 (要看得见, 不静默兜底)', () => {
      expect(labelCounselorEvent('micro_expression')).toBe('micro_expression');
    });
  });

  describe('③ 调试 trace 读进事件标签', () => {
    it('trace 带 eventTags (数组) + 同序中文标签', async () => {
      const service = buildService();
      const created = await service.createSession(KNOWN_SLUG);

      // 预置一轮带事件的结算结果.
      const engine = (service as unknown as { engine: StubEngineTurnService }).engine;
      engine.queue.push(makeTurnResult(['empathy', 'open_probe']));

      const { trace } = await service.runTurn(created.debugSessionId, '我理解你的感受');

      expect(trace.eventTags).toEqual(['empathy', 'open_probe']);
      expect(trace.eventTagLabels).toEqual(['共情回应', '开放提问']);
    });

    it('本轮无事件 → 空数组 (前端不用分支)', async () => {
      const service = buildService();
      const created = await service.createSession(KNOWN_SLUG);

      const engine = (service as unknown as { engine: StubEngineTurnService }).engine;
      engine.queue.push(makeTurnResult());

      const { trace } = await service.runTurn(created.debugSessionId, '……');

      expect(trace.eventTags).toEqual([]);
      expect(trace.eventTagLabels).toEqual([]);
    });

    it('deltaDetail.events 填真值 (此前恒为空数组)', async () => {
      const service = buildService();
      const created = await service.createSession(KNOWN_SLUG);

      const engine = (service as unknown as { engine: StubEngineTurnService }).engine;
      // 第 1 轮没有上一轮快照 → 没有 delta; 第 2 轮才有.
      engine.queue.push(makeTurnResult(['empathy']), makeTurnResult(['affirmation']));

      const first = await service.runTurn(created.debugSessionId, '我理解你的感受');
      expect(first.trace.deltaDetail).toBeNull();

      const second = await service.runTurn(created.debugSessionId, '你能做到已经很不容易了');
      expect(second.trace.deltaDetail?.events).toEqual(['affirmation']);
    });
  });
});
