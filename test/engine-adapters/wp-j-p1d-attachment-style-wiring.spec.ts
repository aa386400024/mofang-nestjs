// V2026-11-10 建立 (WP-J P1d · 依恋风格接线 · 单测):
//   覆盖交付记录 §8 #1 的验收:
//     ① 渲染层  : spec 带 attachmentStyle='anxious' → 访客 prompt 含依恋行为指引块;
//     ② 零回归  : spec 不带 attachmentStyle → prompt **不含**该块 (其余逐字不变);
//     ③ 编排器  : 会话归属带 attachmentStyle → 交给渲染端口的 spec 带它;
//     ④ 装配层  : EngineTurnService.open({attachmentStyle}) → 归属登记里有它;
//     ⑤ 端到端  : open → turn → 渲染端口拿到的 spec.attachmentStyle === 'anxious'
//        (这条是**接线断了就会红**的那条 —— ①②③④ 都是它的分解);
//     ⑥ 生产接线点不丢: 两个真实开场路径 (自动对练/调试面板 + 语音链路)
//        的源码里必须留着 attachmentStyle 登记 (防"以后被人顺手删掉").
//
//   为什么要有 ⑥ (源码扫描): 前 5 条测的是"编排器 + 装配层"这条链;
//   而**生产链路** (debug-session.service / engine-stream-backend.adapter) 是另外两个
//   文件里的登记动作 —— 它们断了, ①②③④⑤ 照样绿, 但线上还是不会渲染.
//   源码扫描是这里唯一能覆盖"别人改了另一个文件"的手段.
//
//   全 mock, 不起 NestJS, 不发网络.
//
//   验证: npx vitest run test/engine-adapters/wp-j-p1d-attachment-style-wiring.spec.ts
//   时间戳: 2026-11-10

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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

/** 依恋行为指引块在 prompt 里的锚句 (只断言**指令文案**, 不涉及任何心理内容). */
const BEHAVIOR_BLOCK = '依恋模式带来的行为习惯';
const ANXIOUS_EXCERPT = '你不会觉得我很麻烦吧';

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
  readonly specs: RenderSpec[] = [];

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
    if (message.role === 'system') return message.content;
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

describe('WP-J P1d · 依恋风格接线 (anxious 行为通道)', () => {
  describe('① 渲染层', () => {
    it('spec 带 attachmentStyle=anxious → 访客 prompt 含依恋行为指引块', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
        attachmentStyle: 'anxious',
      });
      const prompt = systemPromptOf(spec);
      expect(prompt).toContain(BEHAVIOR_BLOCK);
      expect(prompt).toContain(ANXIOUS_EXCERPT);
    });

    it('spec 带 attachmentStyle=secure/avoidant → 渲染层不渲染该块 (只有 anxious 有文案)', () => {
      for (const style of ['secure', 'avoidant', 'disorganized'] as const) {
        const spec = buildRenderSpec({
          output: buildOutput(),
          recentTurns: [],
          tokenBudget: BUDGET,
          attachmentStyle: style,
        });
        expect(systemPromptOf(spec)).not.toContain(BEHAVIOR_BLOCK);
      }
    });
  });

  describe('② 零回归', () => {
    it('spec 不带 attachmentStyle → prompt 逐字不含该块, 且与"带一个非 anxious 风格"等价', () => {
      const withoutStyle = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
      });
      const promptWithout = systemPromptOf(withoutStyle);
      expect(promptWithout).not.toContain(BEHAVIOR_BLOCK);
      // 缺省与"有值但该风格无文案"必须**逐字相同** —— 证明条件渲染只多这一块, 别处没动.
      const withSecure = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [],
        tokenBudget: BUDGET,
        attachmentStyle: 'secure',
      });
      expect(systemPromptOf(withSecure)).toBe(promptWithout);
    });
  });

  describe('③ 编排器透传', () => {
    it('会话归属带 attachmentStyle → 交给渲染端口的 spec 带它', async () => {
      const context: TurnSessionContext = {
        tenantId: TENANT,
        visitorId: VISITOR,
        sessionId: SESSION,
        attachmentStyle: 'anxious',
      };
      const { orchestrator, renderer } = buildOrchestrator(context);
      await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });
      expect(renderer.specs).toHaveLength(1);
      expect(renderer.specs[0]?.attachmentStyle).toBe('anxious');
    });

    it('会话归属不带 attachmentStyle → spec 不带 (缺省不渲染)', async () => {
      const context: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };
      const { orchestrator, renderer } = buildOrchestrator(context);
      await orchestrator.turn(HANDLE_ID, { userText: USER_TEXT });
      expect(renderer.specs[0]?.attachmentStyle).toBeUndefined();
    });
  });

  describe('④ 装配层登记', () => {
    it('open 带 attachmentStyle → 归属登记里有它', () => {
      const registry = new EngineSessionRegistry();
      const { orchestrator } = buildOrchestrator({ tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION });
      const service = new EngineTurnService(new StubSession(), orchestrator, registry);
      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR }, { attachmentStyle: 'anxious' });
      expect(registry.resolve(opened.handleId)?.attachmentStyle).toBe('anxious');
    });

    it('open 不带 attachmentStyle → 归属里没有这个键 (零回归)', () => {
      const registry = new EngineSessionRegistry();
      const { orchestrator } = buildOrchestrator({ tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION });
      const service = new EngineTurnService(new StubSession(), orchestrator, registry);
      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR });
      expect(registry.resolve(opened.handleId)?.attachmentStyle).toBeUndefined();
    });
  });

  describe('⑤ 端到端 (接线断了就会红)', () => {
    it('装配层 open(attachmentStyle) → 一轮之后渲染端口拿到的 spec 带它', async () => {
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
      const opened = service.open({ sessionId: SESSION, tenantId: TENANT, visitorId: VISITOR }, { attachmentStyle: 'anxious' });
      await service.turn(opened.handleId, { userText: USER_TEXT });
      expect(renderer.specs[0]?.attachmentStyle).toBe('anxious');
      // 而且 prompt 里**真的出现了**那段指引 —— 这是"接线是否生效"的最终判据.
      expect(systemPromptOf(renderer.specs[0])).toContain(BEHAVIOR_BLOCK);
    });
  });

  describe('⑥ 生产接线点不丢 (源码扫描)', () => {
    const root = path.resolve(__dirname, '..', '..');

    it('自动对练/调试面板开场路径登记了 attachmentStyle', () => {
      const source = readFileSync(path.join(root, 'src/admin-debug/debug-session.service.ts'), 'utf8');
      expect(source).toContain('attachmentStyle: resolved.characterProfile.attachmentStyle');
    });

    it('语音链路开场路径登记了 attachmentStyle', () => {
      const source = readFileSync(path.join(root, 'src/engine-adapters/wiring/engine-stream-backend.adapter.ts'), 'utf8');
      expect(source).toContain('attachmentStyleOption(profile)');
    });
  });
});
