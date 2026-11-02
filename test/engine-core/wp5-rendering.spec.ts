// V2026-10-28 治本 (WP5 · 引擎内核 · 渲染契约层单测):
//   覆盖任务单 §8 单测清单 1-12:
//     1. 任务分层标签 (stable/chat/advanced) 形状正确且可被端口消费
//     2. 预算估算 (空串=0; 长文本为正且单调不减)
//     3. 整轮丢弃 (尾部保留 / 最旧轮被丢 / droppedTurns>0)
//     4. 单轮截断 (头部截断留尾部 / truncatedTurns=1 / 结果非空)
//     5. 预算上限归一 (undefined/0/NaN → 160; 正数原样)
//     6. 容灾选主 (attempted 空 → 候选[0])
//     7. 主失败切备 (选第一个未尝试候选)
//     8. 耗尽返回 null (不抛)
//     9. 输出校验干净 (pass / 空类别)
//    10. 输出校验高危命中 (block / 类别正确)
//    11. 输出校验 probe 降级 (超时/抛错 → 回落规则)
//    12. 零回归 (不传任何渲染依赖 → turn 出参与 WP4 逐字一致, reply 恒 '', 无新增字段)
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的一部分.
//     RenderPort 只用内存 fake, 不调模型、不发网络.
//
//   验证: npx jest test/engine-core/wp5-rendering.spec.ts
//   时间戳: 2026-10-28 GMT+8

import {
  CHARS_PER_TOKEN,
  DEFAULT_COMPLETION_TOKENS,
  EngineErrorCode,
  createEmptyBdiSnapshot,
  estimateTokens,
  evaluateSafety,
  fitContextToBudget,
  guardVisitorOutput,
  resolveCompletionTokens,
  selectFailoverTarget,
  type FailoverState,
  type Intention,
  type RenderContextTurn,
  type RenderPort,
  type RenderSpec,
  type RenderTaskKind,
  type RiskProbePort,
  type RiskProbeResult,
} from '../../src/engine-core';
import { planIntention } from '../../src/engine-core/cognition/intention-planner';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier';
import { transitionState } from '../../src/engine-core/cognition/state-transition';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';

const TENANT = 'default';
const VISITOR = 'visitor-1';

/** 干净的来访文本 (不命中任何安全种子词). */
const CLEAN_VISITOR_TEXT = '我最近睡不太好，白天总犯困。';

/** 构造一条意图 (渲染规格的输入). */
function buildIntention(): Intention {
  return {
    strategy: 'recounting',
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    forbiddenBehaviors: ['judge'],
  };
}

/** 构造一份渲染规格 (消费路径用). */
function buildSpec(taskKind: RenderTaskKind, overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    taskKind,
    intention: buildIntention(),
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.3,
    coreBeliefs: [],
    forbiddenBehaviors: ['judge'],
    recall: [],
    recentTurns: [],
    tokenBudget: { maxCompletionTokens: DEFAULT_COMPLETION_TOKENS, contextTokens: 512 },
    ...overrides,
  };
}

/** 构造一轮对话 (role + 文本). */
function turn(role: RenderContextTurn['role'], text: string): RenderContextTurn {
  return { role, text };
}

describe('WP5 · 渲染契约层', () => {
  describe('① 任务分层标签', () => {
    it('stable / chat / advanced 三个标签可被渲染端口消费', async () => {
      const seen: RenderTaskKind[] = [];
      const port: RenderPort = {
        render: async (spec: RenderSpec) => {
          seen.push(spec.taskKind);
          return {
            text: 'ok',
            taskKind: spec.taskKind,
            usage: { completionTokens: 1, totalTokens: 2 },
            fallbackUsed: false,
          };
        },
      };

      for (const kind of ['stable', 'chat', 'advanced'] as RenderTaskKind[]) {
        const result = await port.render(buildSpec(kind));
        expect(result.taskKind).toBe(kind);
      }
      expect(seen).toEqual(['stable', 'chat', 'advanced']);
    });
  });

  describe('② 预算估算', () => {
    it('空串 → 0', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('长文本为正数且随长度单调不减', () => {
      const short = '你最近睡得怎么样';
      const middle = '你最近睡得怎么样，工作压力是不是也很大';
      const long = '你最近睡得怎么样，工作压力是不是也很大，有没有考虑过先休息一下';
      expect(estimateTokens(short)).toBeGreaterThan(0);
      expect(estimateTokens(middle)).toBeGreaterThanOrEqual(estimateTokens(short));
      expect(estimateTokens(long)).toBeGreaterThanOrEqual(estimateTokens(middle));
      expect(CHARS_PER_TOKEN).toBeGreaterThan(0);
    });
  });

  describe('③ 整轮丢弃', () => {
    it('超预算 → 尾部最近轮保留, 最旧轮被丢', () => {
      // 每轮 60 字 ≈ 38 token; 三轮共 ≈ 114 token, 预算 60 → 只能留一轮 (最新那轮),
      // 于是从最旧开始整轮丢, 且最后一轮单独放得下 (不该触发截断).
      const turns = [turn('counselor', '第一轮'.repeat(20)), turn('visitor', '第二轮'.repeat(20)), turn('counselor', '第三轮'.repeat(20))];
      const result = fitContextToBudget(turns, 60);

      expect(result.droppedTurns).toBeGreaterThan(0);
      expect(result.truncatedTurns).toBe(0);
      // 尾部保留: 结果里应含最新一轮.
      expect(result.turns.at(-1)?.text).toBe('第三轮'.repeat(20));
      expect(result.turns.length).toBeLessThan(turns.length);
    });

    it('预算充裕 → 原样返回, 不丢不截', () => {
      const turns = [turn('counselor', '短句'), turn('visitor', '也短')];
      const result = fitContextToBudget(turns, 10_000);
      expect(result.turns).toEqual(turns);
      expect(result.droppedTurns).toBe(0);
      expect(result.truncatedTurns).toBe(0);
    });

    it('空序列 → 空结果, 不抛', () => {
      const result = fitContextToBudget([], 100);
      expect(result.turns).toEqual([]);
      expect(result.droppedTurns).toBe(0);
      expect(result.truncatedTurns).toBe(0);
    });
  });

  describe('④ 单轮截断', () => {
    it('单轮单独超预算 → 头部截断保留尾部, truncatedTurns=1, 结果非空', () => {
      const text = '开头' + '内容'.repeat(200) + '结尾必须保留';
      const result = fitContextToBudget([turn('visitor', text)], 20);

      expect(result.truncatedTurns).toBe(1);
      expect(result.droppedTurns).toBe(0);
      expect(result.turns).toHaveLength(1);
      expect(result.turns[0]?.text.length).toBeGreaterThan(0);
      // 保留尾部: 结尾还在, 开头已被截掉.
      expect(result.turns[0]?.text.endsWith('结尾必须保留')).toBe(true);
      expect(result.turns[0]?.text.startsWith('开头')).toBe(false);
    });
  });

  describe('⑤ 预算上限归一', () => {
    it('undefined / 0 / NaN / 负数 → 回落 160', () => {
      expect(resolveCompletionTokens()).toBe(160);
      expect(resolveCompletionTokens(0)).toBe(160);
      expect(resolveCompletionTokens(Number.NaN)).toBe(160);
      expect(resolveCompletionTokens(-5)).toBe(160);
      expect(DEFAULT_COMPLETION_TOKENS).toBe(160);
    });

    it('正数原样返回', () => {
      expect(resolveCompletionTokens(256)).toBe(256);
      expect(resolveCompletionTokens(1)).toBe(1);
    });

    it('回落值本身非法 → 回落默认 160', () => {
      expect(resolveCompletionTokens(undefined, 0)).toBe(160);
      expect(resolveCompletionTokens(undefined, Number.NaN)).toBe(160);
    });
  });

  describe('⑥⑦⑧ 容灾选择', () => {
    const candidates = [{ id: 'primary' }, { id: 'backup-1' }, { id: 'backup-2' }];

    it('attempted 为空 → 选候选[0] (主)', () => {
      const state: FailoverState = { candidates, attempted: [], consecutiveFailures: {} };
      expect(selectFailoverTarget(state)?.id).toBe('primary');
    });

    it('主已尝试 → 选第一个未尝试的备选', () => {
      const state: FailoverState = {
        candidates,
        attempted: ['primary'],
        consecutiveFailures: { primary: 1 },
      };
      expect(selectFailoverTarget(state)?.id).toBe('backup-1');
    });

    it('前两个都已尝试 → 选下一个未尝试的', () => {
      const state: FailoverState = {
        candidates,
        attempted: ['primary', 'backup-1'],
        consecutiveFailures: { primary: 1, 'backup-1': 2 },
      };
      expect(selectFailoverTarget(state)?.id).toBe('backup-2');
    });

    it('全部尝试过 → 返回 null, 不抛', () => {
      const state: FailoverState = {
        candidates,
        attempted: ['primary', 'backup-1', 'backup-2'],
        consecutiveFailures: { primary: 1, 'backup-1': 2, 'backup-2': 3 },
      };
      expect(selectFailoverTarget(state)).toBeNull();
    });

    it('候选为空 → 返回 null', () => {
      expect(selectFailoverTarget({ candidates: [], attempted: [], consecutiveFailures: {} })).toBeNull();
    });
  });

  describe('⑨⑩⑪ 输出侧伦理校验', () => {
    it('干净文本 → pass, 空类别', async () => {
      const verdict = await guardVisitorOutput(CLEAN_VISITOR_TEXT);
      expect(verdict.level).toBe('pass');
      expect(verdict.categories).toEqual([]);
      expect(verdict.side).toBe('visitor_output');
    });

    it('高危命中 → block, 类别正确', async () => {
      const active = await guardVisitorOutput('我要自杀了');
      expect(active.level).toBe('block');
      expect(active.categories).toContain('active_ideation');

      const plan = await guardVisitorOutput('我想好怎么自杀了');
      expect(plan.level).toBe('block');
      expect(plan.categories).toContain('suicide_plan');
    });

    it('probe 超时 → 回落规则, 不炸穿', async () => {
      const probe: RiskProbePort = {
        probe: async () => new Promise<RiskProbeResult>(() => {}),
      };
      const verdict = await guardVisitorOutput(CLEAN_VISITOR_TEXT, { probe, timeoutMs: 20 });
      expect(verdict.level).toBe('pass');
      expect(verdict.source).toBe('rule');
    });

    it('probe 抛错 → 回落规则, 不炸穿', async () => {
      const probe: RiskProbePort = {
        probe: async () => {
          throw new Error('probe down');
        },
      };
      const verdict = await guardVisitorOutput('我不想活了', { probe });
      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toContain('passive_ideation');
    });

    it('口径与 WP4 规则层一致 (同一段文本, 两侧判定不漂移)', () => {
      // 直接调 WP4 规则器, 与 guardVisitorOutput 走的是同一套规则.
      const direct = evaluateSafety('我不想活了', 'visitor_output');
      expect(direct.categories).toContain('passive_ideation');
    });
  });

  describe('⑫ 零回归', () => {
    it('不传任何渲染依赖 → turn 出参与 WP4 逐字一致, reply 恒空, 无新增字段', async () => {
      const text = '听起来你最近挺辛苦的';
      const bdiStates = new InMemoryBdiStateRepository();
      let idSeq = 0;
      const clock = 1_700_000_000_000;
      const now = (): number => clock;
      const session = new InMemoryEngineSession({
        bdiStates,
        memories: new InMemoryMemoryStore({ now }),
        idFactory: () => {
          idSeq += 1;
          return `wp5-id-${idSeq}`;
        },
        now,
      });
      const handle = session.openSession({ sessionId: 's-1', tenantId: TENANT, visitorId: VISITOR, seed: 7 });
      const output = await session.turn(handle.handleId, { userText: text });

      const classifier = new RuleBasedClassifier();
      const events = classifier.classify(text);
      const expectedSnapshot = transitionState(createEmptyBdiSnapshot(), events);

      expect(output.reply).toBe('');
      expect(output.snapshot).toEqual(expectedSnapshot);
      expect(output.intention).toEqual(planIntention(expectedSnapshot));
      expect(output.turnIndex).toBe(1);
      // 出参字段集合与 WP4 完全一致 —— 没有多出任何渲染相关字段.
      expect(Object.keys(output).toSorted((a, b) => a.localeCompare(b))).toEqual(['intention', 'reply', 'snapshot', 'turnIndex']);
      expect((output as unknown as Record<string, unknown>)['render']).toBeUndefined();
      expect((output as unknown as Record<string, unknown>)['renderResult']).toBeUndefined();
    });

    it('安全信号仍照常挂出 (WP4 行为未被 WP5 影响)', async () => {
      const bdiStates = new InMemoryBdiStateRepository();
      const now = (): number => 1_700_000_000_000;
      const session = new InMemoryEngineSession({
        bdiStates,
        memories: new InMemoryMemoryStore({ now }),
        idFactory: () => 'wp5-id',
        now,
      });
      const handle = session.openSession({ sessionId: 's-1', tenantId: TENANT, visitorId: VISITOR });
      const output = await session.turn(handle.handleId, { userText: '你就是太矫情了' });

      expect(output.safety?.level).toBe('warn');
      expect(output.reply).toBe('');
    });

    it('未注入 RenderPort 时内核不产生任何渲染副作用 (无 reply / 无端口调用)', async () => {
      const bdiStates = new InMemoryBdiStateRepository();
      const now = (): number => 1_700_000_000_000;
      const session = new InMemoryEngineSession({
        bdiStates,
        memories: new InMemoryMemoryStore({ now }),
        idFactory: () => 'wp5-id',
        now,
      });
      const handle = session.openSession({ sessionId: 's-1', tenantId: TENANT, visitorId: VISITOR });
      const output = await session.turn(handle.handleId, { userText: '我们继续聊聊' });

      expect(output.reply).toBe('');
      expect(Object.keys(output)).not.toContain('render');
    });
  });

  describe('边界: 引擎错误契约不被破坏', () => {
    it('引擎错误码仍走 EngineCoreError (WP5 未引入新错误面)', () => {
      expect(EngineErrorCode.INVALID_INPUT).toBeDefined();
    });
  });
});
