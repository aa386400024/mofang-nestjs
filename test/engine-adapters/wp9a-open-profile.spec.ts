// V2026-10-29 治本 (WP9-A · B 层 · 开场注入与中性回退单测):
//   覆盖任务单 §10 清单 7-11:
//     7. 有角色 → engine.open 收到非空 characterProfile, persona 快照名为角色名
//     8. 无角色 / resolver 未装配 → engine.open 不带 characterProfile, 回退中性, 不抛
//     9. 同一角色两次开场初始快照基线一致; 换角色基线不同
//     10. resume 接续不覆盖上一场状态 (沿用内核契约)
//     11. 灰度关 / 名单外不触发 resolver (旧链路完全不受影响)
//
//   全 mock: 引擎门面用 stub, 内核用**真实** InMemoryEngineSession (内存实现, 不连 DB),
//             voice 侧用 stub —— 不起容器、不发网络、不连上游.
//
//   为什么第 9/10 条要用真实内核而不是直接断言入参:
//     "注入生效"不等于"内核真的按这个角色开场". 只有让真实内核跑一轮, 断言**初始快照**
//     里的信任 / 阻抗 / 信念, 才说明角色基线真的进了决策层 —— 而且用一条**中性**咨询师
//     文本 (不命中规则词典 → 事件 delta 全零), 快照就不会被状态迁移改写, 于是断言的是
//     "开场基线"而不是"跑完一轮之后的基线".
//
//   验证: npx jest test/engine-adapters/wp9a-open-profile.spec.ts
//   时间戳: 2026-10-29 GMT+8

import type { ConfigService } from '@nestjs/config';

import type { VisitorService } from '../../src/agent/visitor/visitor.service';
import {
  BUILTIN_ANXIOUS_LOW_MOOD_L1,
  BUILTIN_AVOIDANT_L1,
  BuiltinCharacterProfileResolver,
  type CharacterProfileResolver,
  type CharacterResolveRequest,
  type ResolvedCharacter,
} from '../../src/engine-adapters/wiring/character';
import { EngineStreamBackend } from '../../src/engine-adapters/wiring/engine-stream-backend.adapter';
import type { EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service';
import type { BdiSnapshot, OpenEngineSessionInput } from '../../src/engine-core';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';
import { VoiceService } from '../../src/voice/voice.service';
import type { VoiceSessionMeta } from '../../src/voice/voice.types';

const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const CLOCK = 1_700_000_000_000;

/**
 * 中性咨询师文本.
 *
 * 必须不命中规则词典 (empathy/acceptance/... ) 也不命中角色敏感议题 —— 否则事件 delta
 * 会改动信任/阻抗/情绪, 断言到的就不是"开场基线"了.
 */
const NEUTRAL_TEXT = '我们开始吧。';

/** 引擎门面 stub: 记录 open 入参 (只看装配, 不跑决策). */
class FakeEngineTurnService {
  readonly openCalls: OpenEngineSessionInput[] = [];
  readonly closed: string[] = [];

  open(input: OpenEngineSessionInput): { readonly handleId: string; readonly sessionId: string } {
    this.openCalls.push(input);
    return { handleId: `handle-${this.openCalls.length}`, sessionId: input.sessionId };
  }

  close(handleId: string): void {
    this.closed.push(handleId);
  }
}

/** 记录调用的解析器 (用于断言"灰度关时一次都没被碰"). */
class RecordingResolver implements CharacterProfileResolver {
  readonly requests: CharacterResolveRequest[] = [];

  async resolve(request: CharacterResolveRequest): Promise<ResolvedCharacter | null> {
    this.requests.push(request);
    return null;
  }
}

/** 真实内核会话 (内存实现) + 确定性 id / 时钟. */
function buildKernelSession(): {
  readonly session: InMemoryEngineSession;
  readonly bdiStates: InMemoryBdiStateRepository;
} {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  const session = new InMemoryEngineSession({
    bdiStates,
    memories: new InMemoryMemoryStore({ now: () => CLOCK }),
    idFactory: () => {
      idSeq += 1;
      return `wp9a-id-${idSeq}`;
    },
    now: () => CLOCK,
  });
  return { session, bdiStates };
}

/** 假配置. */
function stubConfig(env: Readonly<Record<string, string>>): ConfigService {
  return { get: (key: string): string | undefined => env[key] } as unknown as ConfigService;
}

/** 旧链路 visitor stub (灰度关时走它). */
class FakeVisitor {
  readonly openCalls: { sessionId: string; tenantId: string; personaId?: string }[] = [];

  async openSession(opts: { sessionId: string; tenantId: string; personaId?: string }): Promise<{
    id: string;
    name: string;
    voiceId: string;
    difficulty: string;
  }> {
    this.openCalls.push(opts);
    return { id: 'voice_visitor', name: '来访者', voiceId: '', difficulty: 'L1' };
  }
}

/** 语音会话元数据 (带公共人物模板 id → 角色解析的 key). */
const META: VoiceSessionMeta = {
  sessionId: 'session-1',
  userId: 'user-1',
  tenantId: TENANT,
  traceId: 'trace-1',
  mode: 'text',
  preset: {
    difficulty: 'L1',
    style: 'mixed',
    emotionBaseline: 0.3,
    defenseLevel: 0.2,
    visitorMode: 'fullyReal',
  },
  visitor: {
    templateId: BUILTIN_AVOIDANT_L1.key,
    codename: '晚晴',
    ageRange: '28-35',
    ageLowerBound: 28,
    occupation: '编辑',
    presentingComplaint: '最近总是睡不着。',
    riskTags: [],
  },
};

describe('WP9-A · 开场角色注入与中性回退', () => {
  describe('⑦ 有角色 → 注入 characterProfile, persona 用角色名', () => {
    it('engine.open 收到非空 characterProfile 与确定性 seed', async () => {
      const engine = new FakeEngineTurnService();
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, new BuiltinCharacterProfileResolver());

      await backend.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        personaId: VISITOR,
        templateId: BUILTIN_AVOIDANT_L1.key,
        preset: { difficulty: 'L2', style: 'mixed', emotionBaseline: 0.4, defenseLevel: 0.3 },
      });

      const input = engine.openCalls[0];
      expect(input).toBeDefined();
      expect(input?.characterProfile).toBeDefined();
      expect(input?.characterProfile?.coreBeliefs.length ?? 0).toBeGreaterThan(0);
      expect(input?.characterProfile?.forbiddenBehaviors.length ?? 0).toBeGreaterThan(0);
      expect(input?.characterProfile?.sensitiveTopics.length ?? 0).toBeGreaterThan(0);
      // seed 由角色 key 稳定派生 (可复现性入口).
      expect(typeof input?.seed).toBe('number');
    });

    it('persona 快照的名字是角色名 (不再是中性"来访者")', async () => {
      const engine = new FakeEngineTurnService();
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, new BuiltinCharacterProfileResolver());

      const persona = await backend.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        personaId: VISITOR,
        templateId: BUILTIN_AVOIDANT_L1.key,
      });

      expect(persona.name).toBe(BUILTIN_AVOIDANT_L1.displayName);
      // 快照的 id 仍沿用 personaId (身份键不因角色而变).
      expect(persona.id).toBe(VISITOR);
    });
  });

  describe('⑧ 无角色 / 未装配 → 中性基线, 不抛不阻断', () => {
    it('未知 templateId → 不带 characterProfile, 走中性基线', async () => {
      const engine = new FakeEngineTurnService();
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, new BuiltinCharacterProfileResolver());

      const persona = await backend.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        personaId: VISITOR,
        templateId: 'vpt_not_exists',
      });

      expect(engine.openCalls[0]?.characterProfile).toBeUndefined();
      expect(engine.openCalls[0]?.seed).toBeUndefined();
      expect(persona.name).toBe('来访者');
    });

    it('resolver 未装配 (@Optional 缺省) → 等同无角色, 不抛', async () => {
      const engine = new FakeEngineTurnService();
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService);

      const persona = await backend.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        personaId: VISITOR,
        templateId: BUILTIN_AVOIDANT_L1.key,
      });

      expect(engine.openCalls[0]?.characterProfile).toBeUndefined();
      expect(persona.name).toBe('来访者');
    });

    it('resolver 抛错 → 回退中性, 不把异常冒泡给会话', async () => {
      const engine = new FakeEngineTurnService();
      const brokenResolver: CharacterProfileResolver = {
        resolve: async () => {
          throw new Error('角色池炸了');
        },
      };
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, brokenResolver);

      const persona = await backend.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        personaId: VISITOR,
        templateId: BUILTIN_AVOIDANT_L1.key,
      });

      expect(engine.openCalls[0]?.characterProfile).toBeUndefined();
      expect(persona.name).toBe('来访者');
    });
  });

  describe('⑨ 初始快照基线: 同角色可复现, 换角色可区分', () => {
    it('同一角色两次开场 → 初始快照基线完全一致', async () => {
      const resolver = new BuiltinCharacterProfileResolver();

      const snapshotOf = async (sessionId: string): Promise<BdiSnapshot> => {
        const { session } = buildKernelSession();
        const resolved = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });
        const handle = session.openSession({
          sessionId,
          tenantId: TENANT,
          visitorId: VISITOR,
          characterProfile: resolved?.characterProfile,
          seed: resolved?.seed,
        });
        const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });
        return output.snapshot;
      };

      const first = await snapshotOf('session-a');
      const second = await snapshotOf('session-b');

      // 两场独立开场 (各自的会话 / 各自的句柄) → 快照逐字一致.
      expect(second).toEqual(first);
    });

    it('真实内核的初始快照带该角色的信念与非中性基线', async () => {
      const resolver = new BuiltinCharacterProfileResolver();
      const { session } = buildKernelSession();
      const resolved = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });

      const handle = session.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        visitorId: VISITOR,
        characterProfile: resolved?.characterProfile,
        seed: resolved?.seed,
      });
      const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });

      // 信念是**注入即固定**的部分 (内核不改写) —— 逐字对上角色种子.
      expect(output.snapshot.coreBeliefs.map((belief) => belief.statement)).toEqual(
        resolved?.characterProfile.coreBeliefs.map((belief) => belief.statement),
      );
      // 底层愿望同样来自角色种子.
      expect(output.snapshot.underlyingDesires.map((desire) => desire.key)).toEqual(
        resolved?.characterProfile.underlyingDesires?.map((desire) => desire.key),
      );
      // 基线数值 = 角色种子的数值 (中性默认是 trust 0.3 / resistance 0.4·0.4·0.35).
      expect(output.snapshot.trust).toBe(BUILTIN_AVOIDANT_L1.baseline.trust);
      expect(output.snapshot.resistance).toEqual(BUILTIN_AVOIDANT_L1.baseline.resistance);
      expect(output.snapshot.emotion.valence).toBe(BUILTIN_AVOIDANT_L1.baseline.emotion.valence);
      expect(output.snapshot.emotion.arousal).toBe(BUILTIN_AVOIDANT_L1.baseline.emotion.arousal);
      // 情绪标签由内核按双轴重算 (适配层不手填).
      expect(output.snapshot.emotion.label).not.toBe('neutral');
    });

    it('换角色 → 初始快照基线明显不同', async () => {
      const resolver = new BuiltinCharacterProfileResolver();

      const snapshotOf = async (
        templateId: string,
      ): Promise<{
        readonly trust: number;
        readonly resistance: { readonly verbal: number; readonly depth: number; readonly style: number };
        readonly beliefs: readonly string[];
      }> => {
        const { session } = buildKernelSession();
        const resolved = await resolver.resolve({ templateId });
        const handle = session.openSession({
          sessionId: `session-${templateId}`,
          tenantId: TENANT,
          visitorId: VISITOR,
          characterProfile: resolved?.characterProfile,
          seed: resolved?.seed,
        });
        const output = await session.turn(handle.handleId, { userText: NEUTRAL_TEXT });
        return {
          trust: output.snapshot.trust,
          resistance: output.snapshot.resistance,
          beliefs: output.snapshot.coreBeliefs.map((belief) => belief.statement),
        };
      };

      const avoidant = await snapshotOf(BUILTIN_AVOIDANT_L1.key);
      const anxious = await snapshotOf(BUILTIN_ANXIOUS_LOW_MOOD_L1.key);

      expect(avoidant.trust).not.toBe(anxious.trust);
      expect(avoidant.resistance).not.toEqual(anxious.resistance);
      expect(avoidant.beliefs).not.toEqual(anxious.beliefs);
    });
  });

  describe('⑩ resume 接续不覆盖上一场状态', () => {
    it('resume 会话的首轮沿用上一场快照, 不被新角色 profile 覆盖', async () => {
      const resolver = new BuiltinCharacterProfileResolver();
      const { session } = buildKernelSession();

      // 第一场: 回避型角色, 跑一轮 (状态落库).
      const firstProfile = await resolver.resolve({ templateId: BUILTIN_AVOIDANT_L1.key });
      const firstHandle = session.openSession({
        sessionId: 'session-1',
        tenantId: TENANT,
        visitorId: VISITOR,
        characterProfile: firstProfile?.characterProfile,
        seed: firstProfile?.seed,
      });
      await session.turn(firstHandle.handleId, { userText: NEUTRAL_TEXT });

      // 第二场: 接续上一场, 但**带另一个角色** —— 内核契约要求不覆盖.
      const secondProfile = await resolver.resolve({ templateId: BUILTIN_ANXIOUS_LOW_MOOD_L1.key });
      const secondHandle = session.openSession({
        sessionId: 'session-2',
        tenantId: TENANT,
        visitorId: VISITOR,
        resumeFromSessionId: 'session-1',
        characterProfile: secondProfile?.characterProfile,
        seed: secondProfile?.seed,
      });
      const output = await session.turn(secondHandle.handleId, { userText: NEUTRAL_TEXT });

      // 沿用的是上一场的快照 (回避型的信任与信念), 而不是新角色的.
      expect(output.snapshot.trust).toBe(BUILTIN_AVOIDANT_L1.baseline.trust);
      expect(output.snapshot.trust).not.toBe(BUILTIN_ANXIOUS_LOW_MOOD_L1.baseline.trust);
      expect(output.snapshot.coreBeliefs.map((belief) => belief.statement)).toEqual(
        BUILTIN_AVOIDANT_L1.coreBeliefs.map((belief) => belief.statement),
      );
    });
  });

  describe('⑪ 灰度关 / 名单外 → 角色解析完全不参与', () => {
    /** 装一个 voice 服务: 引擎后端是真的 EngineStreamBackend, 但灰度决定走不走它. */
    const buildVoiceService = (
      env: Readonly<Record<string, string>>,
    ): {
      readonly service: VoiceService;
      readonly visitor: FakeVisitor;
      readonly resolver: RecordingResolver;
      readonly engine: FakeEngineTurnService;
    } => {
      const visitor = new FakeVisitor();
      const resolver = new RecordingResolver();
      const engine = new FakeEngineTurnService();
      const backend = new EngineStreamBackend(engine as unknown as EngineTurnService, resolver);
      const supervisor = { enqueue: async () => true, processSync: async () => {} };
      const bridges = { appendTurn: async () => {}, close: async () => null };
      const tts = { startSession: async () => null };
      const service = new VoiceService(
        visitor as unknown as VisitorService,
        supervisor as never,
        tts as never,
        bridges as never,
        stubConfig(env),
        backend,
      );
      return { service, visitor, resolver, engine };
    };

    it('总开关关 → 走旧链路, resolver 一次都没被调用', async () => {
      const { service, visitor, resolver, engine } = buildVoiceService({});

      await service.startSession(META);

      expect(visitor.openCalls).toHaveLength(1);
      expect(resolver.requests).toHaveLength(0);
      expect(engine.openCalls).toHaveLength(0);
    });

    it('灰度名单外的会话 → 走旧链路, resolver 一次都没被调用', async () => {
      const { service, visitor, resolver, engine } = buildVoiceService({
        ENGINE_VOICE_ENABLED: 'true',
        ENGINE_STREAM_GRAYSCALE_SESSIONS: 'other-session',
      });

      await service.startSession(META);

      expect(visitor.openCalls).toHaveLength(1);
      expect(resolver.requests).toHaveLength(0);
      expect(engine.openCalls).toHaveLength(0);
    });

    it('灰度开且命中名单 → 走引擎链路, resolver 被调用且拿到握手透传的角色参数', async () => {
      const { service, visitor, resolver } = buildVoiceService({ ENGINE_VOICE_ENABLED: 'true' });

      await service.startSession(META);

      expect(visitor.openCalls).toHaveLength(0);
      expect(resolver.requests).toHaveLength(1);
      expect(resolver.requests[0]?.templateId).toBe(BUILTIN_AVOIDANT_L1.key);
      expect(resolver.requests[0]?.preset?.difficulty).toBe('L1');
      expect(resolver.requests[0]?.preset?.style).toBe('mixed');
      expect(resolver.requests[0]?.preset?.emotionBaseline).toBe(0.3);
      expect(resolver.requests[0]?.preset?.defenseLevel).toBe(0.2);
    });
  });
});
