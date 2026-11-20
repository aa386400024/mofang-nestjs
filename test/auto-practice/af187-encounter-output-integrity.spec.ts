// V2026-11-20 建立 (AF-187 · 场景契约 + 输出完整性 + 风险收束会话级账本):
//   覆盖两类真实故障:
//     ① 场景由模型自由发挥 → 默认面对面 / 线上三通道都必须显式可配、可检测漂移;
//     ② 坏输出直接进逐字稿 → prompt 复述 / 无标签推理 / 外语残片 / 场景漂移必须在落历史前拦掉;
//   以及 ③ 连续风险收束轮重复整套模板 → 只补历史未覆盖的组.
//
//   纯函数 + runner 替身（不起容器 / 不连 DB / 不调 LLM）。
//
//   验证: pnpm exec vitest run test/auto-practice/af187-encounter-output-integrity.spec.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { completeRiskClosingText, RISK_CLOSING_ELEMENT_KEYS } from '../../src/auto-practice/metrics/session-structure-audit.js';
import type { EngineTurnResult, TurnEnginePort } from '../../src/auto-practice/ports/turn-engine.port.js';
import { PracticeRunnerService } from '../../src/auto-practice/practice-runner.service.js';
import type { AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk.js';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import {
  buildEncounterCounselorBlock,
  buildEncounterOpeningHint,
  buildEncounterVisitorBlock,
  detectEncounterDrift,
  resolveEncounter,
  toEncounterColumns,
} from '../../src/shared/encounter/encounter-scene.js';
import { inspectGeneratedOutput, safeOutputFallback } from '../../src/shared/text/output-integrity.js';

vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

type CounselorGenerateSignature = (
  mode: CounselorMode,
  history: readonly CounselorHistoryTurn[],
  options?: CounselorGenerateOptions,
) => Promise<CounselorReply>;

function makeMode(): CounselorMode {
  const mode = new CounselorMode();
  mode.id = 'intermediate';
  mode.name = '中级';
  mode.systemPrompt = '你是咨询师';
  mode.description = '';
  mode.enabled = 1;
  mode.sortOrder = 1;
  return mode;
}

/** 造一份最小渲染规格；只关心场景字段时其余用固定值。 */
function makeRenderSpec(encounter?: { mode?: string; channel?: string }): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: [],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.5,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
    ...(encounter === undefined ? {} : { encounter }),
  };
}

function makeTurn(turnIndex: number, reply: string, crisisCategory: string | null = null): EngineTurnResult {
  const crisis = crisisCategory !== null;
  return {
    reply,
    turnIndex,
    crisisDetected: crisis,
    crisisCategory,
    trace: { turnIndex, crisis: { detected: crisis, category: crisisCategory } } as EngineTurnResult['trace'],
  };
}

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

/** 从网关事件里取 turn 载荷（session_start / session_end 没有这两个字段）。 */
function turnEvent(gateway: { publishToSession: ReturnType<typeof vi.fn> }): {
  counselorText: string;
  visitorText: string;
} {
  const call = gateway.publishToSession.mock.calls.find(
    (args) => args[2] !== undefined && typeof args[2] === 'object' && 'counselorText' in (args[2] as object),
  );
  expect(call).toBeDefined();
  return call![2] as { counselorText: string; visitorText: string };
}

describe('AF-187 · 场景契约', () => {
  it('缺省 = 面对面；线上缺省视频；文字通道可显式选', () => {
    expect(resolveEncounter()).toEqual({ mode: 'in_person', label: '面对面咨询' });
    expect(resolveEncounter({ mode: 'online' })).toMatchObject({ mode: 'online', channel: 'video' });
    expect(resolveEncounter({ mode: 'online', channel: 'text' })).toMatchObject({
      mode: 'online',
      channel: 'text',
      label: '线上文字咨询',
    });
    expect(toEncounterColumns({ mode: 'online', channel: 'voice' })).toEqual({
      encounterMode: 'online',
      encounterChannel: 'voice',
    });
    expect(toEncounterColumns()).toEqual({ encounterMode: 'in_person', encounterChannel: null });
  });

  it('非法值回落默认，不把脏字符串写进会话', () => {
    expect(resolveEncounter({ mode: 'home_visit', channel: 'pigeon' })).toEqual({
      mode: 'in_person',
      label: '面对面咨询',
    });
    expect(toEncounterColumns({ mode: 'online', channel: 'fax' })).toEqual({
      encounterMode: 'online',
      encounterChannel: 'video',
    });
  });

  it('legacy 调用（不传场景）逐字不追加契约块', () => {
    expect(buildEncounterVisitorBlock()).toBe('');
    expect(buildEncounterCounselorBlock()).toBe('');
    expect(buildEncounterOpeningHint()).toContain('面对面');
  });

  it('面对面契约禁止线上媒介词，线上文字契约放开文字消息但禁止现场动作', () => {
    const inPerson = buildEncounterVisitorBlock({ mode: 'in_person' });
    expect(inPerson).toContain('同一个咨询室');
    expect(inPerson).toContain('不是发消息');
    expect(inPerson).toContain('语速变化');

    const text = buildEncounterVisitorBlock({ mode: 'online', channel: 'text' });
    expect(text).toContain('线上咨询');
    expect(text).toContain('文字消息');
    expect(text).toContain('可以出现「消息');
    expect(text).not.toContain('线上视频');

    expect(buildEncounterOpeningHint({ mode: 'online', channel: 'voice' })).toContain('电话那头');
  });

  it('来访者说话方式随场景切换：线上不得被“咨询室里面对面”带偏', () => {
    const inPersonPrompt = (buildVisitorMessages(makeRenderSpec({ mode: 'in_person' }))[0]?.content ?? '') as string;
    expect(inPersonPrompt).toContain('咨询室里面对面说话');

    const onlinePrompt = (buildVisitorMessages(makeRenderSpec({ mode: 'online', channel: 'text' }))[0]?.content ?? '') as string;
    expect(onlinePrompt).toContain('远程咨询里说话');
    expect(onlinePrompt).not.toContain('咨询室里面对面说话');
  });

  it('漂移检测只抓当前场景不该出现的媒介词', () => {
    expect(detectEncounterDrift('我刚发给你了，你看到了吗', { mode: 'in_person' })).toContain('发给你');
    expect(detectEncounterDrift('我这边网络不好，信号卡', { mode: 'in_person' })).toContain('网络不好');
    expect(detectEncounterDrift('我刚给你发消息了', { mode: 'online', channel: 'text' })).toEqual([]);
  });
});

describe('AF-187 · 输出完整性闸门（两场真实导出样本）', () => {
  it('复述渲染 prompt（#99）判非法', () => {
    const verdict = inspectGeneratedOutput('硬规则：这一轮怎么说？上一轮咨询师说……你心里坚信……', 'visitor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('prompt_marker');
  });

  it('无标签英文推理开头（#100）判非法', () => {
    const verdict = inspectGeneratedOutput('We need respond in Chinese and keep the visitor tone.', 'counselor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('reasoning_prefix');
  });

  it('韩文/英文残片（#44）判非法', () => {
    const verdict = inspectGeneratedOutput('我那时候……잠깐만，passation，然后就断了。', 'visitor');
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('hangul');
    expect(verdict.reasons).toContain('foreign_word');
  });

  it('mild / staying safe / NAC? 三个已知英文残片都判非法', () => {
    for (const sample of ['我觉得还好，mild 那种。', '就是 staying safe 吧。', 'NAC?']) {
      expect(inspectGeneratedOutput(sample, 'visitor').invalid).toBe(true);
    }
  });

  it('正常中文台词与约定缩写不误伤', () => {
    expect(inspectGeneratedOutput('……嗯，我有点说不出来。', 'visitor').invalid).toBe(false);
    expect(inspectGeneratedOutput('你之前做过 CBT 吗？我们可以试试。', 'counselor').invalid).toBe(false);
    expect(inspectGeneratedOutput('这次量表 PHQ 的分数我们先不谈。', 'counselor').invalid).toBe(false);
  });

  it('语义标记 [sigh] / 控制标记 [[STATE:MORE]] 是协议内容，不误判成外语泄漏', () => {
    expect(inspectGeneratedOutput('[sigh]我最近有点累。', 'visitor').invalid).toBe(false);
    expect(inspectGeneratedOutput('测试可见输出。\n\n[[STATE:MORE]]', 'counselor').invalid).toBe(false);
  });

  it('场景漂移判非法，兜底句自身不违反面对面契约', () => {
    const verdict = inspectGeneratedOutput('我先在聊天框里发给你。', 'counselor', { mode: 'in_person' });
    expect(verdict.invalid).toBe(true);
    expect(verdict.reasons).toContain('scene_drift');

    expect(detectEncounterDrift(safeOutputFallback('visitor'), { mode: 'in_person' })).toEqual([]);
    expect(detectEncounterDrift(safeOutputFallback('counselor'), { mode: 'in_person' })).toEqual([]);
  });
});

describe('AF-187 · 风险收束会话级账本', () => {
  const allCovered = [...RISK_CLOSING_ELEMENT_KEYS];

  it('历史已覆盖的组不再重复追加', () => {
    const original = '我听到你今晚很难受。';
    const completed = completeRiskClosingText(original, allCovered.slice(0, 2));
    expect(completed).toContain(original);
    const riskLines = completed.split('\n').filter((line) => line !== original);
    const fullLines = completeRiskClosingText('', []).split('\n');
    expect(riskLines).toEqual(fullLines.slice(2));
  });

  it('五组全已覆盖时原文不动（连续收束轮不再整套重贴）', () => {
    const original = '好，我们按刚才说好的做。';
    expect(completeRiskClosingText(original, allCovered)).toBe(original);
  });
});

describe('AF-187 · runner 接线', () => {
  let engine: { open: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let counselor: { generate: ReturnType<typeof vi.fn<CounselorGenerateSignature>> };
  let repo: ReturnType<typeof stubRepo>;
  let gateway: { publishToSession: ReturnType<typeof vi.fn> };
  let runner: PracticeRunnerService;

  beforeEach(() => {
    engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
    counselor = { generate: vi.fn<CounselorGenerateSignature>() };
    repo = stubRepo();
    gateway = { publishToSession: vi.fn() };
    const fingerprint = {
      build: vi.fn(async () => ({
        model: 'MiniMax-M3.1-Flash',
        characterSlug: 'vpt_test',
        characterVersion: '1.0.0',
        counselorModeId: 'intermediate',
        deliberationMode: 'rule_only',
        scenarioType: 'full_simulation',
        engineVersion: 'test',
        sessionSeed: 'single/test',
      })),
    };
    runner = new PracticeRunnerService(
      engine as unknown as TurnEnginePort,
      counselor as never,
      fingerprint as never,
      repo as never,
      gateway as never,
    );
    engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
    counselor.generate.mockResolvedValue({
      text: '我们先慢一点，你愿意说说刚才那一刻吗？',
      model: 'test-model',
      degraded: false,
    } as CounselorReply);
  });

  it('缺省场景以 in_person 落库，并把 scene 契约传给引擎会话', async () => {
    engine.turn.mockResolvedValueOnce(makeTurn(1, '……嗯。'));

    const result = await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    expect(result.status).toBe('completed');
    const row = repo.created[0] as Record<string, unknown>;
    expect(row['encounterMode']).toBe('in_person');
    expect(row['encounterChannel']).toBeNull();
  });

  it('线上文字场景透传 channel，且来访者台词不得写现场动作', async () => {
    engine.turn.mockResolvedValueOnce(makeTurn(1, '……嗯。'));

    await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 1,
      encounter: { mode: 'online', channel: 'text' },
    });

    const row = repo.created[0] as Record<string, unknown>;
    expect(row['encounterMode']).toBe('online');
    expect(row['encounterChannel']).toBe('text');
  });

  it('咨询师复述 prompt → 换安全句并标降级，坏文本不进事件', async () => {
    counselor.generate.mockResolvedValueOnce({
      text: '硬规则：这一轮怎么说？上一轮咨询师说……',
      model: 'test-model',
      degraded: false,
    } as CounselorReply);
    engine.turn.mockResolvedValueOnce(makeTurn(1, '……嗯。'));

    const result = await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const event = turnEvent(gateway);
    expect(event.counselorText).toBe(safeOutputFallback('counselor'));
    expect(event.counselorText).not.toContain('硬规则');
    expect(result.metrics).toBeDefined();
  });

  it('来访者复述 prompt / 场景漂移 → 落库前换安全句', async () => {
    engine.turn.mockResolvedValueOnce(makeTurn(1, '硬规则：我是来访者，这一轮怎么说？'));

    await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const event = turnEvent(gateway);
    expect(event.visitorText).toBe(safeOutputFallback('visitor'));
    expect(event.visitorText).not.toContain('硬规则');
  });

  it('合法台词里夹带已闭合推理块 → 只剥推理块，正文照常落库', async () => {
    counselor.generate.mockResolvedValueOnce({
      text: '<think>先确认安全，再问感受。</think>我们先慢一点。你愿意说说刚才那一刻吗？',
      model: 'test-model',
      degraded: false,
    } as CounselorReply);
    engine.turn.mockResolvedValueOnce(makeTurn(1, '<think>他在问我的感受。</think>……嗯。'));

    await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 1 });

    const event = turnEvent(gateway);
    expect(event.counselorText).toContain('你愿意说说刚才那一刻吗？');
    expect(event.visitorText).toContain('……嗯。');
    expect(JSON.stringify(event)).not.toContain('think');
  });

  it('危机窗跑满：crisisOutcome 给出可读结论，不再与 crisisEnded 读感打架', async () => {
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家，没什么人'))
      .mockResolvedValueOnce(makeTurn(4, '试了呼吸，稍微能坐住了'))
      .mockResolvedValueOnce(makeTurn(5, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(6, '明天我打算去找医生聊一聊'));

    const result = await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 8 });

    expect(result.exitReason).toBe('crisis_practice_max');
    expect(result.crisisEnded).toBe(false);
    // 收束轮会确定性补齐五组，本场实际完成了安全计划 —— 这正是可读结论的价值：
    // 不再让 `crisis_practice_max + crisisEnded=false` 被误读成"危机没处理"。
    expect(result.crisisOutcome).toBe('safety_plan_completed');
  });

  it('危机披露前就提过安全计划，不算本次收束覆盖', async () => {
    counselor.generate
      .mockResolvedValueOnce({
        text: '先把药和刀移开；打热线12356；联系家人来陪你；今晚不要独处；我们一起做安全计划，你答应我不伤害自己。',
        model: 'test-model',
        degraded: false,
      } as CounselorReply)
      .mockResolvedValue({
        text: '我先确认一下你此刻的安全。',
        model: 'test-model',
        degraded: false,
      } as CounselorReply);
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家，没什么人'))
      .mockResolvedValueOnce(makeTurn(4, '试了呼吸，稍微能坐住了'))
      .mockResolvedValueOnce(makeTurn(5, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(6, '明天我打算去找医生聊一聊'));

    const result = await runner.run({ characterSlug: 'vpt_test', counselorMode: makeMode(), maxTurns: 8 });

    // 第 1 轮那句全齐的台词发生在危机披露之前，不能充作本次危机收束覆盖；
    // 因此收束轮仍必须把五组补齐（而不是沿用披露前的话直接放过）。
    const lastTurn = gateway.publishToSession.mock.calls
      .map((args) => args[2] as { counselorText?: string } | undefined)
      .findLast((payload) => typeof payload?.counselorText === 'string');
    expect(lastTurn?.counselorText).toContain('12356');
    expect(result.crisisOutcome).toBe('safety_plan_completed');
  });
});
