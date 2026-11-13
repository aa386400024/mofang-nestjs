// V2026-11-10 建立 (WP-J P2 · verbal_voice 台词指纹接线 · 单测):
//   为什么新增本文件: P1d 那版只把 verbalVoice 登记进**语音链路**
//   (`engine-stream-backend.adapter`), 而调试面板/自动对练走的是
//   `EngineTurnService.open({...})` 这条 —— 少登一处, 渲染层 `if (spec.verbalVoice)`
//   直接跳过, 库里的文案白落 (实测 1 场冒烟 `你说话的味道：` 命中 0).
//
//   覆盖:
//     ① 渲染层  : spec 带 verbalVoice → 访客 prompt 含「你说话的味道：」块;
//     ② 零回归  : spec 不带 → prompt 逐字不含该块;
//     ③ 编排器  : 会话归属带 verbalVoice → 交给渲染端口的 spec 带它;
//     ④ 装配层  : EngineTurnService.open({verbalVoice}) → 归属登记里有它;
//     ⑤ 端到端  : open → turn → 渲染端口拿到的 spec 带它, 且 prompt 真的出现该块
//        (这条是**接线断了就会红**的那条);
//     ⑥ 生产接线点不丢 (源码扫描): 三条开场路径都必须留着登记
//        (调试面板新建 / 调试面板恢复 / 语音链路), 以及装配层的条件展开.
//        为什么必须扫源码: 前 5 条测的是编排器 + 装配层, 生产链路的登记动作在
//        另外的文件里 —— 那边删了, ①~⑤ 照样绿, 线上却依旧不渲染.
//
//   全 mock, 不起 NestJS, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp-j-p2-verbal-voice-wiring.spec.ts
//   时间戳: 2026-11-10

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler.js';
import {
  TurnRenderOrchestrator,
  buildVisitorMessages,
  type TurnSessionContext,
} from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { EngineSessionRegistry, EngineTurnService } from '../../src/engine-adapters/wiring/engine-turn.service.js';
import {
  createEmptyBdiSnapshot,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryEntry,
  type MemoryHit,
  type MemoryStore,
  type OpenEngineSessionInput,
  type RenderPort,
  type RenderResult,
  type RenderSpec,
  type RenderTokenBudget,
} from '../../src/engine-core/index.js';

const HANDLE_ID = 'handle-1';
const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const SESSION = 'session-1';
const USER_TEXT = '你最近睡得怎么样？';
const REPLY = '有点累，夜里老醒。';

/** 渲染预算 (与门面默认一致). */
const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

/** 台词指纹块在 prompt 里的锚句. */
const VOICE_BLOCK = '你说话的味道：';

/**
 * 测试用**假文案** (不是任何真实角色的台词).
 * 只为证明"登记的字符串被原样渲染进 prompt", 不涉及心理内容.
 */
const VOICE_TEXT = '先自嘲一句, 再把话往回收, 不把话说满。';

/** 构造一个意图. */
function buildIntention(): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
  };
}

/** 构造内核一轮出参. */
function buildOutput(): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    intention: buildIntention(),
  };
}

/** 会话端口 stub. */
class StubSession implements EngineSessionPort {
  openSession(input: OpenEngineSessionInput): { readonly handleId: string; readonly sessionId: string } {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(_handleId: string, _input: EngineTurnInput): Promise<EngineTurnOutput> {
    return buildOutput();
  }

  closeSession(): void {
    /* 门面不调它; 占位以满足端口契约. */
  }
}

/** 渲染端口 stub: 记录每一轮拿到的 spec. */
class StubRenderer implements RenderPort {
  readonly specs: AdaptiveRenderSpec[] = [];

  async render(spec: RenderSpec): Promise<RenderResult> {
    this.specs.push(spec);
    return {
      text: REPLY,
      taskKind: spec.taskKind,
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: false,
    };
  }
}

/** 记忆仓储 stub. */
class StubMemoryStore implements MemoryStore {
  readonly remembered: MemoryEntry[] = [];

  async remember(entry: MemoryEntry): Promise<void> {
    this.remembered.push(entry);
  }

  async recall(): Promise<readonly MemoryHit[]> {
    return [];
  }
}

/** 取 prompt 的 system 段. */
function systemPromptOf(spec: RenderSpec): string {
  for (const message of buildVisitorMessages(spec)) {
    if (message.role === 'system') return message.content as string;
  }
  return '';
}

/** 构造编排器 (全注入, 无全局状态). */
function buildOrchestrator(context: TurnSessionContext): {
  readonly orchestrator: TurnRenderOrchestrator;
  readonly renderer: StubRenderer;
} {
  const session = new StubSession();
  const renderer = new StubRenderer();
  const orchestrator = new TurnRenderOrchestrator({
    session,
    renderer,
    memories: new StubMemoryStore(),
    resolveSession: () => context,
    now: () => 1_700_000_000_000,
    idFactory: () => 'memory-visitor-1',
  });
  return { orchestrator, renderer };
}

describe('WP-J P2 · verbal_voice 台词指纹接线', () => {
  describe('① 渲染层', () => {
    it('spec 带 verbalVoice → 访客 prompt 含「你说话的味道」块且文案原样出现', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
        verbalVoice: VOICE_TEXT,
      });
      const prompt = systemPromptOf(spec);
      expect(prompt).toContain(VOICE_BLOCK);
      expect(prompt).toContain(VOICE_TEXT);
    });

    it('spec 带空串 → 不渲染该块 (空文案不得渲染出半句话)', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
        verbalVoice: '',
      });
      expect(systemPromptOf(spec)).not.toContain(VOICE_BLOCK);
    });
  });

  describe('② 零回归', () => {
    it('spec 不带 verbalVoice → prompt 逐字不含该块', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
      });
      const prompt = systemPromptOf(spec);
      expect(prompt).not.toContain(VOICE_BLOCK);
      expect(prompt).not.toContain(VOICE_TEXT);
    });
  });

  describe('③ 编排器透传', () => {
    it('会话归属带 verbalVoice → 交给渲染端口的 spec 带它', async () => {
      const context: TurnSessionContext = {
        tenantId: TENANT,
        visitorId: VISITOR,
        sessionId: SESSION,
        verbalVoice: VOICE_TEXT,
      };
      const { orchestrator, renderer } = buildOrchestrator(context);
      await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });
      expect(renderer.specs).toHaveLength(1);
      expect(renderer.specs[0]?.verbalVoice).toBe(VOICE_TEXT);
    });

    it('会话归属不带 verbalVoice → spec 不带 (缺省不渲染)', async () => {
      const context: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };
      const { orchestrator, renderer } = buildOrchestrator(context);
      await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });
      expect(renderer.specs[0]?.verbalVoice).toBeUndefined();
    });
  });

  describe('④ 装配层登记', () => {
    it('open 带 verbalVoice → 归属登记里有它', () => {
      const registry = new EngineSessionRegistry();
      const { orchestrator } = buildOrchestrator({ tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION });
      const service = new EngineTurnService(new StubSession(), orchestrator, registry);
      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR }, { verbalVoice: VOICE_TEXT });
      expect(registry.resolve(opened.handleId)?.verbalVoice).toBe(VOICE_TEXT);
    });

    it('open 不带 verbalVoice → 归属里没有这个键 (零回归)', () => {
      const registry = new EngineSessionRegistry();
      const { orchestrator } = buildOrchestrator({ tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION });
      const service = new EngineTurnService(new StubSession(), orchestrator, registry);
      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });
      expect(registry.resolve(opened.handleId)?.verbalVoice).toBeUndefined();
    });
  });

  describe('⑤ 端到端 (接线断了就会红)', () => {
    it('装配层 open(verbalVoice) → 一轮之后渲染端口拿到的 spec 带它, 且 prompt 真出现该块', async () => {
      const registry = new EngineSessionRegistry();
      const session = new StubSession();
      const renderer = new StubRenderer();
      const orchestrator = new TurnRenderOrchestrator({
        session,
        renderer,
        memories: new StubMemoryStore(),
        // 装配层登记 → 编排器按 handleId 解析 (真实链路的缝).
        resolveSession: (handleId: string) => registry.resolve(handleId),
        now: () => 1_700_000_000_000,
        idFactory: () => 'memory-visitor-1',
      });
      const service = new EngineTurnService(session, orchestrator, registry);
      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR }, { verbalVoice: VOICE_TEXT });
      await service.turn(opened.handleId, { userText: USER_TEXT });
      expect(renderer.specs[0]?.verbalVoice).toBe(VOICE_TEXT);
      expect(systemPromptOf(renderer.specs[0])).toContain(VOICE_BLOCK);
    });
  });

  describe('⑥ 生产接线点不丢 (源码扫描)', () => {
    const root = path.resolve(__dirname, '..', '..');

    it('装配层把 verbalVoice 从 options 条件展开进归属登记', () => {
      const source = readFileSync(path.join(root, 'src/engine-adapters/wiring/engine-turn.service.ts'), 'utf8');
      expect(source).toContain('verbalVoice?: TurnSessionContext');
      expect(source).toContain('{ verbalVoice: options.verbalVoice }');
    });

    it('自动对练/调试面板的**新建**与**恢复**两条开场路径都登记了 verbalVoice', () => {
      const source = readFileSync(path.join(root, 'src/admin-debug/debug-session.service.ts'), 'utf8');
      const registrations = source.match(/\.\.\.\(resolved\.verbalVoice === undefined/g) ?? [];
      // 新建 (:456 附近) 与恢复 (:688 附近) 各一处 —— 少一处恢复路径就还会静默丢.
      expect(registrations).toHaveLength(2);
    });

    it('语音链路开场路径仍登记 verbalVoice (P1d 那处不得被改回)', () => {
      const source = readFileSync(path.join(root, 'src/engine-adapters/wiring/engine-stream-backend.adapter.ts'), 'utf8');
      expect(source).toContain('character?.verbalVoice ? { verbalVoice: character.verbalVoice }');
    });
  });
});
