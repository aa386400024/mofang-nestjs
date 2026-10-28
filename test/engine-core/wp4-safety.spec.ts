// V2026-10-28 治本 (WP4 · 引擎内核 · 伦理安全单测):
//   覆盖任务单 §8 单测清单 1-14:
//     1. 咨询师规则命中分级 (block 五类 / warn 两类 / 干净 → pass)
//     2. 多规则取最高 (等级最高 + 类别并集 + 规则 id 并集)
//     3. 规则纯函数无探测 (source='rule'; 无命中 pass/空集合)
//     4. 探测成功合并 (等级取高 + 类别并集 + source=rule+probe / probe)
//     5. 探测超时降级 (回落规则, turn 正常返回不抛)
//     6. 探测抛错降级 (回落规则, 不炸穿)
//     7. 规则 block 不等探测 (probe 根本不被调用)
//     8. PsyGUARD 11 类归一映射
//     9. 零回归 (无 probe + 干净对话 → 出参无 safety, 与 WP3 路径逐字一致)
//    10. 事件累计与报告 (maxLevel / blockCount / warnCount / events, pass 轮不计数)
//    11. 报告返回副本 (改动返回值不回写内部)
//    12. 未知句柄取报告 (空报告, 不抛)
//    13. 来访侧路径存在但 turn 内不被调用
//    14. 非法 probe 返回 (未知 level / 未知类别 → 归一/忽略, 回落规则)
//
//   反依赖污染:
//     本文件**不 import 任何 @nestjs/* / typeorm / qdrant** —— 它是内核边界的一部分.
//     probe 全部是内存 fake, 不发网络, 不起服务.
//
//   验证: npx jest test/engine-core/wp4-safety.spec.ts
//   时间戳: 2026-10-28 GMT+8

import {
  DEFAULT_PROBE_TIMEOUT_MS,
  PSYGUARD_LEVEL_MAP,
  assessSafety,
  createEmptyBdiSnapshot,
  evaluateSafety,
  type EngineTurnOutput,
  type RiskProbePort,
  type RiskProbeResult,
  type SafetyEvent,
  type SafetyLevel,
  type SafetySide,
  type VisitorRiskCategory,
} from '../../src/engine-core';
import { planIntention } from '../../src/engine-core/cognition/intention-planner';
import { RuleBasedClassifier } from '../../src/engine-core/cognition/rule-based-classifier';
import { transitionState } from '../../src/engine-core/cognition/state-transition';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store';

const TENANT = 'default';
const VISITOR = 'visitor-1';

/** 未命中任何规则的干净文本 (走中性事件, BDI 侧 delta = 0). */
const CLEAN_TEXT = '听起来你最近挺辛苦的';

/** probe 桩: 记录调用, 可注入各种行为. */
interface ProbeStub {
  readonly port: RiskProbePort;
  readonly calls: { readonly text: string; readonly side: SafetySide }[];
}

/** 构造 probe 桩. */
function probeStub(
  behavior: 'ok' | 'throw' | 'hang' | 'dirty',
  overrides: Partial<RiskProbeResult> = {},
): ProbeStub {
  const calls: { text: string; side: SafetySide }[] = [];
  const port: RiskProbePort = {
    probe: async (text: string, side: SafetySide): Promise<RiskProbeResult> => {
      calls.push({ text, side });
      if (behavior === 'throw') throw new Error('probe down');
      if (behavior === 'hang') return new Promise<RiskProbeResult>(() => {});
      if (behavior === 'dirty') {
        return {
          level: 'bogus' as SafetyLevel,
          categories: ['not_a_real_category' as VisitorRiskCategory],
        };
      }
      return { level: 'warn', categories: ['passive_ideation'], ...overrides };
    },
  };
  return { port, calls };
}

// ── 测试台 ──────────────────────────────────────────────────────────

/** 测试台: 内存实现 + 确定性 id / 共享时钟. */
interface Harness {
  readonly session: InMemoryEngineSession;
  readonly memories: InMemoryMemoryStore;
}

function createHarness(riskProbe?: RiskProbePort): Harness {
  const bdiStates = new InMemoryBdiStateRepository();
  let idSeq = 0;
  const clock = 1_700_000_000_000;
  const now = (): number => clock;
  const memories = new InMemoryMemoryStore({ now });
  const session = new InMemoryEngineSession({
    bdiStates,
    memories,
    idFactory: () => {
      idSeq += 1;
      return `wp4-id-${idSeq}`;
    },
    now,
    ...(riskProbe ? { riskProbe } : {}),
  });
  return { session, memories };
}

/** 跑一轮或多轮对话 (可注入 probe). */
async function runTurns(
  riskProbe: RiskProbePort | undefined,
  texts: readonly string[],
): Promise<{
  readonly outputs: readonly EngineTurnOutput[];
  readonly harness: Harness;
  readonly handleId: string;
}> {
  const harness = createHarness(riskProbe);
  const handle = harness.session.openSession({ sessionId: 'session-1', tenantId: TENANT, visitorId: VISITOR, seed: 7 });
  const outputs: EngineTurnOutput[] = [];
  for (const text of texts) {
    outputs.push(await harness.session.turn(handle.handleId, { userText: text }));
  }
  return { outputs, harness, handleId: handle.handleId };
}

describe('WP4 · 伦理安全引擎', () => {
  describe('① 咨询师规则命中分级', () => {
    it('block 五类: 承诺治愈 / 双重关系 / 违法指导 / 自杀自残指导 / 歧视', () => {
      const cases: { readonly text: string; readonly category: string }[] = [
        { text: '我保证你能治好，肯定能好', category: 'promise_cure' },
        { text: '我们加我微信私下联系吧', category: 'double_relationship' },
        { text: '我帮你弄到处方药', category: 'illegal_guidance' },
        { text: '我可以教你自杀', category: 'suicide_coaching' },
        { text: '你们乡下人就是见识少', category: 'discrimination' },
      ];
      for (const item of cases) {
        const verdict = evaluateSafety(item.text, 'counselor_input');
        expect(verdict.level).toBe('block');
        expect(verdict.categories).toContain(item.category);
        expect(verdict.matchedRules.length).toBeGreaterThan(0);
      }
    });

    it('warn 两类: 价值审判 / 过早给诊断建议', () => {
      const judgment = evaluateSafety('你就是太矫情了', 'counselor_input');
      expect(judgment.level).toBe('warn');
      expect(judgment.categories).toContain('value_judgment');

      const advice = evaluateSafety('你这就是抑郁症，按我说的吃', 'counselor_input');
      expect(advice.level).toBe('warn');
      expect(advice.categories).toContain('premature_advice');
    });

    it('干净对话 → pass 且类别/规则为空', () => {
      const verdict = evaluateSafety(CLEAN_TEXT, 'counselor_input');
      expect(verdict.level).toBe('pass');
      expect(verdict.categories).toEqual([]);
      expect(verdict.matchedRules).toEqual([]);
      expect(verdict.side).toBe('counselor_input');
    });

    it('全空白文本 → pass, 不抛', () => {
      expect(evaluateSafety('   ', 'counselor_input').level).toBe('pass');
    });

    it('大小写无关 (统一小写子串匹配)', () => {
      expect(evaluateSafety('我保证你能治好', 'counselor_input').level).toBe('block');
      expect(evaluateSafety('TRANSFER 转账给我', 'counselor_input').level).toBe('block');
    });
  });

  describe('② 多规则取最高', () => {
    it('同时命中 warn 与 block → level=block, 类别与规则 id 并集去重', () => {
      const verdict = evaluateSafety('你就是太矫情了，但我保证你能治好', 'counselor_input');
      expect(verdict.level).toBe('block');
      expect(verdict.categories).toEqual(expect.arrayContaining(['value_judgment', 'promise_cure']));
      expect(verdict.matchedRules).toHaveLength(2);
      expect(new Set(verdict.matchedRules).size).toBe(2);
    });
  });

  describe('③ 规则纯函数无探测', () => {
    it('evaluateSafety 直接返回, source=rule', () => {
      const verdict = evaluateSafety('你就是太矫情了', 'counselor_input');
      expect(verdict.source).toBe('rule');
    });

    it('无命中 → pass / 空集合 / source=rule', () => {
      const verdict = evaluateSafety(CLEAN_TEXT, 'counselor_input');
      expect(verdict).toEqual({
        level: 'pass',
        side: 'counselor_input',
        categories: [],
        matchedRules: [],
        source: 'rule',
      });
    });
  });

  describe('④ 探测成功合并', () => {
    it('规则 pass + 探测命中 → source=probe, 等级取探测', async () => {
      const stub = probeStub('ok');
      const verdict = await assessSafety({ text: CLEAN_TEXT, side: 'counselor_input', probe: stub.port });

      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toContain('passive_ideation');
      expect(verdict.source).toBe('probe');
      expect(verdict.matchedRules).toEqual([]);
    });

    it('规则命中 + 探测命中 → source=rule+probe, 类别并集', async () => {
      const stub = probeStub('ok');
      const verdict = await assessSafety({ text: '你就是太矫情了', side: 'counselor_input', probe: stub.port });

      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toEqual(expect.arrayContaining(['value_judgment', 'passive_ideation']));
      expect(verdict.source).toBe('rule+probe');
      expect(verdict.matchedRules).toHaveLength(1);
    });

    it('探测返回 block 类别 → 等级按 PsyGUARD 映射归一为 block', async () => {
      const stub = probeStub('ok', { level: 'pass', categories: ['suicide_plan'] });
      const verdict = await assessSafety({ text: CLEAN_TEXT, side: 'counselor_input', probe: stub.port });

      expect(verdict.level).toBe('block');
      expect(verdict.categories).toContain('suicide_plan');
    });
  });

  describe('⑤ 探测超时降级', () => {
    it('probe 永不 resolve → 到超时回落规则结果, 不抛', async () => {
      const stub = probeStub('hang');
      const verdict = await assessSafety({
        text: '你就是太矫情了',
        side: 'counselor_input',
        probe: stub.port,
        timeoutMs: 20,
      });

      expect(verdict.level).toBe('warn');
      expect(verdict.source).toBe('rule');
      expect(verdict.categories).toEqual(['value_judgment']);
    });

    it('turn 内探测超时 → turn 照常返回, 判定回落规则', async () => {
      const stub = probeStub('hang');
      const { outputs } = await runTurns(stub.port, ['你就是太矫情了']);

      expect(outputs[0]?.safety?.level).toBe('warn');
      expect(outputs[0]?.safety?.source).toBe('rule');
      expect(outputs[0]?.reply).toBe('');
    });

    it('timeoutMs 越界 → 回落默认超时, 不抛', async () => {
      const stub = probeStub('hang');
      const verdict = await assessSafety({
        text: CLEAN_TEXT,
        side: 'counselor_input',
        probe: stub.port,
        timeoutMs: 0,
      });
      expect(verdict.level).toBe('pass');
      expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(150);
    });
  });

  describe('⑥ 探测抛错降级', () => {
    it('probe reject → 回落规则, 不炸穿 turn', async () => {
      const stub = probeStub('throw');
      const verdict = await assessSafety({ text: '你就是太矫情了', side: 'counselor_input', probe: stub.port });

      expect(verdict.level).toBe('warn');
      expect(verdict.source).toBe('rule');

      const { outputs } = await runTurns(stub.port, ['你就是太矫情了']);
      expect(outputs[0]?.safety?.level).toBe('warn');
      expect(outputs[0]?.snapshot).toBeDefined();
    });
  });

  describe('⑦ 规则 block 不等探测', () => {
    it('规则命中 block → probe 根本不被调用', async () => {
      const stub = probeStub('hang');
      const verdict = await assessSafety({
        text: '我保证你能治好',
        side: 'counselor_input',
        probe: stub.port,
        timeoutMs: 20,
      });

      expect(verdict.level).toBe('block');
      expect(verdict.source).toBe('rule');
      expect(stub.calls).toHaveLength(0);
    });

    it('turn 内规则 block → 不发起探测', async () => {
      const stub = probeStub('ok');
      const { outputs } = await runTurns(stub.port, ['我保证你能治好']);

      expect(outputs[0]?.safety?.level).toBe('block');
      expect(stub.calls).toHaveLength(0);
    });
  });

  describe('⑧ PsyGUARD 归一映射', () => {
    it('行动层 → block, 意念/探索层 → warn, neutral → pass', () => {
      const blockCategories: VisitorRiskCategory[] = [
        'suicide_attempt',
        'suicide_plan',
        'suicide_preparation',
        'active_ideation',
        'self_harm_behavior',
        'aggression_others',
      ];
      const warnCategories: VisitorRiskCategory[] = [
        'passive_ideation',
        'suicide_exploration',
        'self_harm_ideation',
        'aggression_self',
      ];

      for (const category of blockCategories) {
        expect(PSYGUARD_LEVEL_MAP[category]).toBe('block');
      }
      for (const category of warnCategories) {
        expect(PSYGUARD_LEVEL_MAP[category]).toBe('warn');
      }
      expect(PSYGUARD_LEVEL_MAP.neutral).toBe('pass');
    });
  });

  describe('⑨ 零回归', () => {
    it('未注入 probe + 干净对话 → 出参无 safety, 快照/意图与 WP1 路径逐字一致', async () => {
      const { outputs } = await runTurns(undefined, [CLEAN_TEXT]);

      const classifier = new RuleBasedClassifier();
      const events = classifier.classify(CLEAN_TEXT);
      const expectedSnapshot = transitionState(createEmptyBdiSnapshot(), events);
      const expectedIntention = planIntention(expectedSnapshot);

      expect(outputs[0]?.safety).toBeUndefined();
      expect(outputs[0]?.snapshot).toEqual(expectedSnapshot);
      expect(outputs[0]?.intention).toEqual(expectedIntention);
      expect(outputs[0]?.turnIndex).toBe(1);
      expect(outputs[0]?.trajectoryTrace).toBeUndefined();
    });

    it('安全步只读: block 判定不改快照 / 意图', async () => {
      const { outputs } = await runTurns(undefined, ['我保证你能治好']);

      const classifier = new RuleBasedClassifier();
      const events = classifier.classify('我保证你能治好');
      const expectedSnapshot = transitionState(createEmptyBdiSnapshot(), events);

      expect(outputs[0]?.safety?.level).toBe('block');
      expect(outputs[0]?.snapshot).toEqual(expectedSnapshot);
    });
  });

  describe('⑩ 事件累计与报告', () => {
    it('多轮 warn/block 累计正确, pass 轮不计数', async () => {
      const { outputs, harness, handleId } = await runTurns(undefined, [
        CLEAN_TEXT,
        '你就是太矫情了',
        '我保证你能治好',
        CLEAN_TEXT,
      ]);
      void outputs;

      const report = harness.session.getSafetyReport(handleId);
      expect(report.maxLevel).toBe('block');
      expect(report.warnCount).toBe(1);
      expect(report.blockCount).toBe(1);
      expect(report.events).toHaveLength(2);
      expect(report.events[0]?.verdict.level).toBe('warn');
      expect(report.events[0]?.turnIndex).toBe(2);
      expect(report.events[1]?.verdict.level).toBe('block');
      expect(report.events[1]?.turnIndex).toBe(3);
      expect(report.events[0]?.snippet).toContain('矫情');
    });

    it('本场无事件时报告为空 (maxLevel=pass, 计数 0)', async () => {
      const { harness, handleId } = await runTurns(undefined, [CLEAN_TEXT]);
      const report = harness.session.getSafetyReport(handleId);
      expect(report.maxLevel).toBe('pass');
      expect(report.blockCount).toBe(0);
      expect(report.warnCount).toBe(0);
      expect(report.events).toEqual([]);
    });
  });

  describe('⑪ 报告返回副本', () => {
    it('改动返回的 events 数组, 再次取数不受影响', async () => {
      const { harness, handleId } = await runTurns(undefined, ['你就是太矫情了']);

      const first = harness.session.getSafetyReport(handleId);
      const mutable = first.events as unknown as SafetyEvent[];
      mutable.push({ turnIndex: 99, at: 0, verdict: first.events[0]!.verdict, snippet: 'x' });

      const second = harness.session.getSafetyReport(handleId);
      expect(second.events).toHaveLength(1);
      expect(second.warnCount).toBe(1);
    });
  });

  describe('⑫ 未知句柄取报告', () => {
    it('返回空报告, 不抛', () => {
      const harness = createHarness();
      const report = harness.session.getSafetyReport('不存在的句柄');
      expect(report.maxLevel).toBe('pass');
      expect(report.blockCount).toBe(0);
      expect(report.warnCount).toBe(0);
      expect(report.events).toEqual([]);
      expect(report.sessionId).toBe('');
    });
  });

  describe('⑬ 来访侧路径存在但不被调用', () => {
    it('evaluateSafety 可独立判定来访侧 (供 WP5)', () => {
      const verdict = evaluateSafety('我不想活了', 'visitor_output');
      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toContain('passive_ideation');
      expect(verdict.side).toBe('visitor_output');
    });

    it('turn 内只对咨询师侧发起探测 (reply 恒空, 不检来访侧)', async () => {
      const stub = probeStub('ok');
      const { outputs } = await runTurns(stub.port, [CLEAN_TEXT]);

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.side).toBe('counselor_input');
      expect(outputs[0]?.reply).toBe('');
    });
  });

  describe('⑭ 非法 probe 返回', () => {
    it('未知 level → 整体回落规则, 不抛', async () => {
      const stub = probeStub('dirty');
      const verdict = await assessSafety({ text: '你就是太矫情了', side: 'counselor_input', probe: stub.port });

      expect(verdict.level).toBe('warn');
      expect(verdict.source).toBe('rule');
      expect(verdict.categories).toEqual(['value_judgment']);
    });

    it('未知类别 → 忽略, 不炸合并', async () => {
      const stub = probeStub('ok', { level: 'warn', categories: ['not_a_real_category' as VisitorRiskCategory] });
      const verdict = await assessSafety({ text: CLEAN_TEXT, side: 'counselor_input', probe: stub.port });

      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toEqual([]);
      expect(verdict.source).toBe('probe');
    });

    it('probe 返回 neutral 且规则 pass → 仍 pass (出参省略 safety)', async () => {
      const stub = probeStub('ok', { level: 'pass', categories: ['neutral'] });
      const { outputs } = await runTurns(stub.port, [CLEAN_TEXT]);

      expect(outputs[0]?.safety).toBeUndefined();
    });
  });

  describe('会话隔离', () => {
    it('安全事件随句柄实例持有, 不跨会话共享', async () => {
      const harness = createHarness();
      const first = harness.session.openSession({ sessionId: 's-1', tenantId: TENANT, visitorId: VISITOR });
      const second = harness.session.openSession({ sessionId: 's-2', tenantId: TENANT, visitorId: VISITOR });

      await harness.session.turn(first.handleId, { userText: '你就是太矫情了' });

      expect(harness.session.getSafetyReport(first.handleId).warnCount).toBe(1);
      expect(harness.session.getSafetyReport(second.handleId).warnCount).toBe(0);
    });
  });
});
