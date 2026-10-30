import { vi } from 'vitest';
// V2026-10-30 治本 (WP12 · 记忆收尾 + 跨会话 resume 接线单测):
//   覆盖任务单 §3 验收 1-6 与 §3.9 的四种场景:
//     ① resume 成功        → engine.open 收到 resumeFromSessionId
//     ② resume 不存在      → 不报错, 按新会话开, 有 warn
//     ③ 摘要失败           → closeSession 正常完成, 只是不晋升, 有 warn
//     ④ 冲突标记           → 同 visitorId + 同 topicKey 的旧点被标 supersededBy
//   外加: 长时记忆作用域 (学员+角色) / 逐字稿定稿 / 配置化 / 摘要解析 / 落库桥插槽.
//
//   全 mock: 引擎门面用 stub, 记忆仓储用**真实** InMemoryMemoryStore, 向量库用窄接口 stub,
//             LLM 用 stub —— 不起容器、不发网络、不连上游.
//
//   为什么"resume 不存在"要单独测一条而不是并进成功用例:
//     这条是**产品链路最容易炸的地方** —— 内核 `openSession` 遇到不存在的 resumeFromSessionId
//     会抛 INVALID_INPUT, 若适配层不兜住, 学员第二次打开角色就会直接 500 + 断连.
//     断言的是"抛错被吞掉 + 按新会话重开一次 + 第二次不带 resume", 三件事缺一不可.
//
//   验证: npx jest test/engine-adapters/wp12-memory-closeout.spec.ts
//   时间戳: 2026-10-30 GMT+8

import type { TranscriptTurn } from '../../src/agent/supervisor/supervisor.types';
import { DEFAULT_MEMORY_CONFIG, MS_PER_DAY, resolveMemoryConfig } from '../../src/engine-adapters/persistence/memory-config';
import { QdrantMemoryStore, type QdrantMemoryClient } from '../../src/engine-adapters/persistence/qdrant-memory.store';
import {
  DEFAULT_SESSION_SUMMARY_IMPORTANCE,
  SessionCloseoutService,
  type SessionCloseoutInput,
  type SessionSummary,
  type SessionSummaryGenerator,
  type SessionTranscriptSaveInput,
} from '../../src/engine-adapters/persistence/session-closeout.service';
import {
  formatTranscript,
  parseSummaryResponse,
  resolveSummaryModel,
} from '../../src/engine-adapters/persistence/session-summary.generator';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import { MemorySource, MemoryTier, type MemoryEntry, type OpenEngineSessionInput } from '../../src/engine-core';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';
import type { LlmRouterService } from '../../src/llm/registry/llm-router.service';
import {
  VoiceSessionBridgeRegistry,
  type VoiceSessionBridge,
  type VoiceSessionTranscriptInput,
} from '../../src/voice/voice-session-bridge';

const TENANT = 'tenant-1';
const USER = 'user-1';
const PERSONA = 'visitor-1';
const CLOCK = 1_700_000_000_000;

/** 引擎门面 stub: 记录 open 入参 (只看装配, 不跑决策). */
class FakeEngineTurnService {
  readonly openCalls: OpenEngineSessionInput[] = [];
  readonly closed: string[] = [];
  /** 置 true → **每次** open 都抛错 (模拟开场本身失败). */
  failAlways = false;
  /**
   * 置 true → **带 resume 的** open 抛错 (模拟"上一场不存在 / 已过期").
   *
   * 只在带 resume 时失败才贴近真实: 内核是"找不到 resume 目标"才抛, 不带 resume 的
   * 新会话开场是好的 —— 适配层的兜底正是靠这一点重开成功.
   */
  failOnResume = false;

  open(input: OpenEngineSessionInput): { readonly handleId: string; readonly sessionId: string } {
    this.openCalls.push(input);
    if (this.failAlways) throw new Error('开场失败');
    if (this.failOnResume && input.resumeFromSessionId) throw new Error('resume 目标不存在');
    return { handleId: `handle-${this.openCalls.length}`, sessionId: input.sessionId };
  }

  close(handleId: string): void {
    this.closed.push(handleId);
  }
}

/** 收尾服务 stub: 记录 finalize 入参. */
class FakeCloseout {
  readonly calls: SessionCloseoutInput[] = [];

  async finalize(input: SessionCloseoutInput): Promise<{ transcriptPersisted: boolean; summaryPromoted: boolean }> {
    this.calls.push(input);
    return { transcriptPersisted: true, summaryPromoted: true };
  }
}

/** 逐字稿落库口 stub. */
class FakeSink {
  readonly calls: SessionTranscriptSaveInput[] = [];
  fail = false;

  async saveTranscript(input: SessionTranscriptSaveInput): Promise<void> {
    if (this.fail) throw new Error('写库失败');
    this.calls.push(input);
  }
}

/** 摘要生成器 stub. */
class FakeGenerator implements SessionSummaryGenerator {
  readonly calls: TranscriptTurn[][] = [];
  fail = false;

  async generate(transcript: readonly TranscriptTurn[]): Promise<SessionSummary> {
    this.calls.push([...transcript]);
    if (this.fail) throw new Error('LLM 超时');
    return { content: '来访者核心议题是失眠, 情绪基调偏低, 出现了一次明显的转折。', topicKey: '失眠' };
  }
}

/** Qdrant 窄接口 stub. */
class StubQdrant implements QdrantMemoryClient {
  readonly upserts: { id: string; payload: Record<string, unknown> }[] = [];
  readonly payloadWrites: { id: string; payload: Record<string, unknown> }[] = [];
  readonly scrolls: { filter: Record<string, unknown>; limit?: number }[] = [];
  scrollPoints: { id: string; payload: Record<string, unknown> }[] = [];
  failScroll = false;

  async upsert(_collection: string, id: string, _vector: number[], payload: Record<string, unknown>): Promise<void> {
    this.upserts.push({ id, payload });
  }

  async search(): Promise<{ id: string; score: number; payload: Record<string, unknown> }[]> {
    return [];
  }

  async setPayload(_collection: string, id: string, payload: Record<string, unknown>): Promise<void> {
    this.payloadWrites.push({ id, payload });
  }

  async scroll(
    _collection: string,
    filter: Record<string, unknown>,
    limit?: number,
  ): Promise<{ id: string; payload: Record<string, unknown> }[]> {
    if (this.failScroll) throw new Error('qdrant unreachable');
    this.scrolls.push({ filter, limit });
    return this.scrollPoints;
  }
}

/** 引擎逐字稿夹具 (一问一答两条). */
function turns(): TranscriptTurn[] {
  return [
    { role: 'user', content: '最近睡不好。', at: CLOCK },
    { role: 'assistant', content: '有多久了？', at: CLOCK + 1 },
  ];
}

describe('WP12 · 跨会话 resume 接线 (EngineStreamBackend.openSession)', () => {
  it('① resume 成功 → engine.open 收到 resumeFromSessionId', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await backend.openSession({
      sessionId: 'session-2',
      tenantId: TENANT,
      userId: USER,
      personaId: PERSONA,
      resumeFromSessionId: 'session-1',
    });

    expect(engine.openCalls).toHaveLength(1);
    expect(engine.openCalls[0]?.resumeFromSessionId).toBe('session-1');
  });

  it('不传 resume → 入参里**没有** resumeFromSessionId 这个键 (零回归)', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await backend.openSession({ sessionId: 'session-1', tenantId: TENANT, userId: USER, personaId: PERSONA });

    expect(engine.openCalls).toHaveLength(1);
    // 断言"键不存在"而不是"值为 undefined": 键存在 (哪怕值是 undefined) 也算形状变了.
    expect('resumeFromSessionId' in (engine.openCalls[0] ?? {})).toBe(false);
  });

  it('空串 resume → 视为没传, 不带这个键 (内核对空串会抛 INVALID_INPUT)', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await backend.openSession({
      sessionId: 'session-1',
      tenantId: TENANT,
      userId: USER,
      personaId: PERSONA,
      resumeFromSessionId: ' '.repeat(3),
    });

    expect('resumeFromSessionId' in (engine.openCalls[0] ?? {})).toBe(false);
  });

  it('② resume 不存在 → 不抛错, 按新会话重开一次 (第二次不带 resume)', async () => {
    const engine = new FakeEngineTurnService();
    engine.failOnResume = true;
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    const persona = await backend.openSession({
      sessionId: 'session-2',
      tenantId: TENANT,
      userId: USER,
      personaId: PERSONA,
      resumeFromSessionId: 'session-not-exists',
    });

    expect(engine.openCalls).toHaveLength(2);
    expect(engine.openCalls[0]?.resumeFromSessionId).toBe('session-not-exists');
    expect('resumeFromSessionId' in (engine.openCalls[1] ?? {})).toBe(false);
    // 会话照常开起来了 (人还在线, 只是当成新的一场).
    expect(persona.id).toBe(PERSONA);
  });

  it('没传 resume 且开场本身失败 → 错误照常抛出 (不吞真实故障)', async () => {
    const engine = new FakeEngineTurnService();
    engine.failAlways = true;
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await expect(backend.openSession({ sessionId: 'session-1', tenantId: TENANT, userId: USER, personaId: PERSONA })).rejects.toThrow(
      '开场失败',
    );
    expect(engine.openCalls).toHaveLength(1);
  });
});

describe('WP12 · 长时记忆作用域 (学员 + 角色)', () => {
  it('visitorId = 学员id:角色key (不同学员互不串场)', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await backend.openSession({
      sessionId: 'session-1',
      tenantId: TENANT,
      userId: 'user-A',
      personaId: PERSONA,
      templateId: 'char-late',
    });

    expect(engine.openCalls[0]?.visitorId).toBe('user-A:char-late');
  });

  it('无 templateId 时角色 key 退到 personaId', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    await backend.openSession({ sessionId: 'session-1', tenantId: TENANT, userId: 'user-A', personaId: PERSONA });

    expect(engine.openCalls[0]?.visitorId).toBe(`user-A:${PERSONA}`);
  });

  it('对外返回的 persona.id 仍是 personaId (身份键不因作用域改造而变)', async () => {
    const engine = new FakeEngineTurnService();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

    const persona = await backend.openSession({
      sessionId: 'session-1',
      tenantId: TENANT,
      userId: 'user-A',
      personaId: PERSONA,
    });

    expect(persona.id).toBe(PERSONA);
  });
});

describe('WP12 · 会话收尾触发 (EngineStreamBackend.closeSession)', () => {
  it('收尾时触发一次收尾编排, 带上落库 id 与逐字稿', async () => {
    const engine = new FakeEngineTurnService();
    const closeout = new FakeCloseout();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, undefined, undefined, undefined, closeout as never);

    await backend.openSession({
      sessionId: 'session-1',
      tenantId: TENANT,
      userId: USER,
      personaId: PERSONA,
      dbSessionId: 'db-1',
    });
    backend.closeSession('session-1');
    await Promise.resolve();

    expect(closeout.calls).toHaveLength(1);
    expect(closeout.calls[0]?.dbSessionId).toBe('db-1');
    expect(closeout.calls[0]?.visitorId).toBe(`${USER}:${PERSONA}`);
    expect(closeout.calls[0]?.userId).toBe(USER);
  });

  it('第二次收尾 (voice 侧会关两次) → 不重复触发, 不用空逐字稿覆盖库', async () => {
    const engine = new FakeEngineTurnService();
    const closeout = new FakeCloseout();
    const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, undefined, undefined, undefined, closeout as never);

    await backend.openSession({
      sessionId: 'session-1',
      tenantId: TENANT,
      userId: USER,
      personaId: PERSONA,
      dbSessionId: 'db-1',
    });
    backend.closeSession('session-1');
    backend.closeSession('session-1');
    await Promise.resolve();

    expect(closeout.calls).toHaveLength(1);
  });
});

describe('WP12 · 收尾编排 (SessionCloseoutService)', () => {
  const baseInput = (overrides: Partial<SessionCloseoutInput> = {}): SessionCloseoutInput => ({
    tenantId: TENANT,
    sessionId: 'session-1',
    visitorId: `${USER}:${PERSONA}`,
    userId: USER,
    dbSessionId: 'db-1',
    transcript: turns(),
    ...overrides,
  });

  it('摘要成功 → 晋升为长时记忆 (tier/visitorId/重要度都对)', async () => {
    const memories = new InMemoryMemoryStore({ now: () => CLOCK });
    const generator = new FakeGenerator();
    const sink = new FakeSink();
    const service = new SessionCloseoutService({
      memories,
      generator,
      sink,
      now: () => CLOCK,
      makeId: (() => {
        let seq = 0;
        return () => {
          seq += 1;
          return `id-${seq}`;
        };
      })(),
    });

    const result = await service.finalize(baseInput());

    expect(result.transcriptPersisted).toBe(true);
    expect(result.summaryPromoted).toBe(true);
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.dbSessionId).toBe('db-1');
    expect(sink.calls[0]?.userId).toBe(USER);

    const hits = await memories.recall({
      tenantId: TENANT,
      sessionId: 'session-1',
      query: '失眠',
      scope: 'visitor',
      visitorId: `${USER}:${PERSONA}`,
    });
    expect(hits).toHaveLength(1);
    const entry = hits[0]?.entry;
    expect(entry.tier).toBe(MemoryTier.LONG_TERM);
    expect(entry.source).toBe(MemorySource.SUMMARY);
    expect(entry.visitorId).toBe(`${USER}:${PERSONA}`);
    expect(entry.importance).toBe(DEFAULT_SESSION_SUMMARY_IMPORTANCE);
    expect(entry.content).toContain('失眠');
  });

  it('③ 摘要失败 → 不晋升但不阻断, 逐字稿照样落库', async () => {
    const memories = new InMemoryMemoryStore({ now: () => CLOCK });
    const generator = new FakeGenerator();
    generator.fail = true;
    const sink = new FakeSink();
    const service = new SessionCloseoutService({ memories, generator, sink, now: () => CLOCK });

    const result = await service.finalize(baseInput());

    expect(result.summaryPromoted).toBe(false);
    expect(result.transcriptPersisted).toBe(true);
    expect(sink.calls).toHaveLength(1);
    const hits = await memories.recall({
      tenantId: TENANT,
      sessionId: 'session-1',
      query: '失眠',
      scope: 'visitor',
      visitorId: `${USER}:${PERSONA}`,
    });
    expect(hits).toHaveLength(0);
  });

  it('逐字稿落库失败 → 记失败但不抛 (收尾路径不能把清理失败升级成主流程失败)', async () => {
    const memories = new InMemoryMemoryStore({ now: () => CLOCK });
    const sink = new FakeSink();
    sink.fail = true;
    const service = new SessionCloseoutService({ memories, generator: new FakeGenerator(), sink, now: () => CLOCK });

    const result = await service.finalize(baseInput());

    expect(result.transcriptPersisted).toBe(false);
    // 逐字稿挂了不影响摘要晋升 (两者各自降级).
    expect(result.summaryPromoted).toBe(true);
  });

  it('空逐字稿 → 不生摘要 (没内容可摘)', async () => {
    const memories = new InMemoryMemoryStore({ now: () => CLOCK });
    const generator = new FakeGenerator();
    const service = new SessionCloseoutService({ memories, generator, now: () => CLOCK });

    const result = await service.finalize(baseInput({ transcript: [] }));

    expect(result.summaryPromoted).toBe(false);
    expect(generator.calls).toHaveLength(0);
  });

  it('无归属作用域 (没有学员身份) → 不写长时记忆', async () => {
    const memories = new InMemoryMemoryStore({ now: () => CLOCK });
    const generator = new FakeGenerator();
    const service = new SessionCloseoutService({ memories, generator, now: () => CLOCK });

    const result = await service.finalize(baseInput({ visitorId: undefined }));

    expect(result.summaryPromoted).toBe(false);
    expect(generator.calls).toHaveLength(0);
  });

  it('本场没落库 (无 dbSessionId) → 不调落库口', async () => {
    const sink = new FakeSink();
    const service = new SessionCloseoutService({
      memories: new InMemoryMemoryStore({ now: () => CLOCK }),
      generator: new FakeGenerator(),
      sink,
      now: () => CLOCK,
    });

    const result = await service.finalize(baseInput({ dbSessionId: undefined }));

    expect(result.transcriptPersisted).toBe(false);
    expect(sink.calls).toHaveLength(0);
  });
});

describe('WP12 · Qdrant 写侧冲突标记 (supersededBy)', () => {
  const entryOf = (overrides: Partial<MemoryEntry>): MemoryEntry => ({
    tenantId: TENANT,
    id: 'lt-old',
    sessionId: 'session-1',
    visitorId: `${USER}:${PERSONA}`,
    tier: MemoryTier.LONG_TERM,
    source: MemorySource.SUMMARY,
    content: '来访者提到失眠',
    importance: 0.8,
    occurredAt: CLOCK,
    topicKey: '失眠',
    ttlMs: null,
    ...overrides,
  });

  const embedder = { embed: vi.fn(async () => [0.1, 0.2]) };

  it('④ 新条目更晚 → 旧点被标 supersededBy (不物理删除)', async () => {
    const qdrant = new StubQdrant();
    qdrant.scrollPoints = [{ id: 'lt-old', payload: entryOf({}) as unknown as Record<string, unknown> }];
    const store = new QdrantMemoryStore({ qdrant, embedder, now: () => CLOCK });

    await store.remember(entryOf({ id: 'lt-new', occurredAt: CLOCK + 1000, content: '来访者提到持续失眠' }));

    // 冲突扫描按 tenant + visitor + topicKey 走 (跨会话, 不带 sessionId).
    expect(qdrant.scrolls).toHaveLength(1);
    expect(qdrant.scrolls[0]?.filter).toEqual({
      must: [
        { key: 'tenantId', match: { value: TENANT } },
        { key: 'visitorId', match: { value: `${USER}:${PERSONA}` } },
        { key: 'topicKey', match: { value: '失眠' } },
      ],
    });
    // 旧点被标记, 旧点**没有**被删.
    expect(qdrant.payloadWrites).toEqual([{ id: 'lt-old', payload: { supersededBy: 'lt-new' } }]);
    expect(qdrant.upserts.map((item) => item.id)).toEqual(['lt-new']);
  });

  it('旧条目更晚 (旧存活) → 新条目带着 supersededBy 一起落库', async () => {
    const qdrant = new StubQdrant();
    qdrant.scrollPoints = [{ id: 'lt-old', payload: entryOf({ occurredAt: CLOCK + 5000 }) as unknown as Record<string, unknown> }];
    const store = new QdrantMemoryStore({ qdrant, embedder, now: () => CLOCK });

    await store.remember(entryOf({ id: 'lt-new', occurredAt: CLOCK }));

    expect(qdrant.payloadWrites).toHaveLength(0);
    expect(qdrant.upserts[0]?.id).toBe('lt-new');
    expect(qdrant.upserts[0]?.payload['supersededBy']).toBe('lt-old');
  });

  it('冲突扫描失败 → 不阻断写入 (失败方向安全: 少标记, 不误标)', async () => {
    const qdrant = new StubQdrant();
    qdrant.failScroll = true;
    const store = new QdrantMemoryStore({ qdrant, embedder, now: () => CLOCK });

    await expect(store.remember(entryOf({ id: 'lt-new' }))).resolves.toBeUndefined();

    expect(qdrant.upserts).toHaveLength(1);
    expect(qdrant.payloadWrites).toHaveLength(0);
  });

  it('无 topicKey → 不构成冲突组, 不扫描', async () => {
    const qdrant = new StubQdrant();
    const store = new QdrantMemoryStore({ qdrant, embedder, now: () => CLOCK });

    await store.remember(entryOf({ id: 'lt-new', topicKey: undefined }));

    expect(qdrant.scrolls).toHaveLength(0);
    expect(qdrant.upserts).toHaveLength(1);
  });
});

describe('WP12 · 记忆衰减/召回配置 (memory-config)', () => {
  it('缺省 = 30 天半衰期 + 0.1 阈值 (与内核常量同值)', () => {
    const config = resolveMemoryConfig();
    expect(config.decayHalfLifeMs).toBe(30 * MS_PER_DAY);
    expect(config.recallThreshold).toBe(0.1);
    expect(config).toEqual(DEFAULT_MEMORY_CONFIG);
  });

  it('env 覆盖生效', () => {
    const config = resolveMemoryConfig({ decayHalfLifeDays: '7', recallThreshold: '0.4' });
    expect(config.decayHalfLifeMs).toBe(7 * MS_PER_DAY);
    expect(config.recallThreshold).toBe(0.4);
  });

  it('非法值一律回退默认 (不抛错: 填错 env 不该让服务起不来)', () => {
    expect(resolveMemoryConfig({ decayHalfLifeDays: 'abc' })).toEqual(DEFAULT_MEMORY_CONFIG);
    expect(resolveMemoryConfig({ decayHalfLifeDays: '-1' })).toEqual(DEFAULT_MEMORY_CONFIG);
    expect(resolveMemoryConfig({ recallThreshold: '2' })).toEqual(DEFAULT_MEMORY_CONFIG);
    expect(resolveMemoryConfig({ recallThreshold: 'x' })).toEqual(DEFAULT_MEMORY_CONFIG);
  });
});

describe('WP12 · 摘要生成 (解析与提示词)', () => {
  it('标准 JSON → 取 summary 与 topicKey', () => {
    expect(parseSummaryResponse('{"summary": "议题是失眠", "topicKey": "失眠"}')).toEqual({
      content: '议题是失眠',
      topicKey: '失眠',
    });
  });

  it('带代码块围栏 → 照样解析', () => {
    expect(parseSummaryResponse('```json\n{"summary": "议题是失眠"}\n```')).toEqual({ content: '议题是失眠' });
  });

  it('模型没按 JSON 回 → 整段当摘要 (总比没有强)', () => {
    expect(parseSummaryResponse('来访者主要在聊失眠。')).toEqual({ content: '来访者主要在聊失眠。' });
  });

  it('空输出 → 空摘要', () => {
    expect(parseSummaryResponse(' '.repeat(3))).toEqual({ content: '' });
  });

  it('提示词显式标注咨询师/来访者 (角色读反 = 整条记忆从根上错)', () => {
    const text = formatTranscript(turns());
    expect(text).toContain('咨询师: 最近睡不好。');
    expect(text).toContain('来访者: 有多久了？');
  });

  it('模型名 env 优先, 否则问 router 的 RAG 分层', () => {
    const router = {
      getDefaultModelForTier: vi.fn(() => 'deepseek-chat'),
    } as unknown as LlmRouterService;
    expect(resolveSummaryModel(' my-model ', router)).toBe('my-model');
    expect(resolveSummaryModel(undefined, router)).toBe('deepseek-chat');
  });
});

describe('WP12 · 逐字稿落库桥插槽 (VoiceSessionBridgeRegistry)', () => {
  const bridgeWithout = (): VoiceSessionBridge => ({
    name: 'legacy',
    open: async () => ({ persisted: false, dbSessionId: null }),
    appendTurn: async () => {},
    close: async () => ({ persisted: false, reportStatus: null }),
  });

  it('没有桥实现覆盖写 → 返回 false, 不抛 (老实现照常跑)', async () => {
    const registry = new VoiceSessionBridgeRegistry();
    registry.register(bridgeWithout());

    const input: VoiceSessionTranscriptInput = { dbSessionId: 'db-1', turns: turns() };
    await expect(registry.replaceTranscript(input)).resolves.toBe(false);
  });

  it('桥实现且写成功 → 返回 true', async () => {
    const registry = new VoiceSessionBridgeRegistry();
    const seen: VoiceSessionTranscriptInput[] = [];
    registry.register({
      ...bridgeWithout(),
      name: 'vpt',
      replaceTranscript: async (input) => {
        seen.push(input);
      },
    });

    const input: VoiceSessionTranscriptInput = { dbSessionId: 'db-1', userId: USER, turns: turns() };
    await expect(registry.replaceTranscript(input)).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.userId).toBe(USER);
  });

  it('桥写失败 → 抛错 (不落库就报错, 不静默)', async () => {
    const registry = new VoiceSessionBridgeRegistry();
    registry.register({
      ...bridgeWithout(),
      name: 'vpt',
      replaceTranscript: async () => {
        throw new Error('写库失败');
      },
    });

    await expect(registry.replaceTranscript({ dbSessionId: 'db-1', turns: turns() })).rejects.toThrow('写库失败');
  });
});

describe('WP12 · 逐字稿定稿写入 (业务侧桥)', () => {
  it('覆盖写 → 逐字稿表拿到引擎副本的全量 (咨询师/来访者角色映射正确)', async () => {
    const { VptSessionBridgeService } = await import('../../src/counselor/providers/vpt-session-bridge.service');
    const { ChatRole } = await import('../../src/counselor/enums/chat-role.enum');

    const saved: { transcript: unknown[] }[] = [];
    const repo = {
      findOne: vi.fn(async () => ({
        id: 'db-1',
        userId: USER,
        status: 'listening',
        transcript: [{ id: 'old', role: ChatRole.COUNSELOR, text: '旧的一轮', timestamp: 1 }],
      })),
      save: vi.fn(async (row: { transcript: unknown[] }) => {
        saved.push(row);
        return row;
      }),
    };

    const service = new VptSessionBridgeService(
      repo as never,
      { enqueue: async () => true } as never,
      { enqueue: async () => true } as never,
      new VoiceSessionBridgeRegistry(),
      { get: () => {} } as never,
    );

    await service.replaceTranscript({ dbSessionId: 'db-1', userId: USER, turns: turns() });

    expect(saved).toHaveLength(1);
    const transcript = saved[0]?.transcript as { role: string; text: string }[];
    expect(transcript).toHaveLength(2);
    expect(transcript[0]?.role).toBe(ChatRole.COUNSELOR);
    expect(transcript[0]?.text).toBe('最近睡不好。');
    expect(transcript[1]?.role).toBe(ChatRole.VISITOR);
    expect(transcript[1]?.text).toBe('有多久了？');
  });

  it('引擎副本为空 → 不覆盖 (拿空去覆盖会抹掉已落库的逐字稿)', async () => {
    const { VptSessionBridgeService } = await import('../../src/counselor/providers/vpt-session-bridge.service');

    const repo = {
      findOne: vi.fn(async () => ({ id: 'db-1', userId: USER, status: 'finished', transcript: [{ id: 'old' }] })),
      save: vi.fn(async (row: unknown) => row),
    };

    const service = new VptSessionBridgeService(
      repo as never,
      { enqueue: async () => true } as never,
      { enqueue: async () => true } as never,
      new VoiceSessionBridgeRegistry(),
      { get: () => {} } as never,
    );

    await service.replaceTranscript({ dbSessionId: 'db-1', userId: USER, turns: [] });

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('落库会话不存在 → 抛错 (不静默)', async () => {
    const { VptSessionBridgeService } = await import('../../src/counselor/providers/vpt-session-bridge.service');

    const repo = {
      findOne: vi.fn(async () => null),
      save: vi.fn(async (row: unknown) => row),
    };

    const service = new VptSessionBridgeService(
      repo as never,
      { enqueue: async () => true } as never,
      { enqueue: async () => true } as never,
      new VoiceSessionBridgeRegistry(),
      { get: () => {} } as never,
    );

    await expect(service.replaceTranscript({ dbSessionId: 'db-x', userId: USER, turns: turns() })).rejects.toThrow('落库会话不存在');
  });
});

