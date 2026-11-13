// V2026-11-08 建立 / 2026-11-10 WP-J 重写 (自动对练 runner 单测):
//   覆盖核心循环的结束条件:
//     ① 跑满 maxTurns → status=completed
//     ② 危机披露 → **不终止**, 进后置练习窗; 只有强度上升才 crisis_ended
//     ③ 来访字面复读 / 来回打转(无新信息) → status=stagnant, 提前停
//     ④ 咨询师重复措辞 → **不再**判停滞, 只记 counselorSemanticEchoTurns 指标
//     ⑤ LLM/引擎抛错 → status=failed
//   全 mock: TurnEnginePort / CounselorAgentService / repo 全是替身, 不起容器不连 DB.
//
//   验证: npx vitest run test/auto-practice/practice-runner.spec.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from '../../src/auto-practice/counselor-agent.service.js';
import { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import type { EngineTurnResult, TurnEnginePort } from '../../src/auto-practice/ports/turn-engine.port.js';
import {
  decideTurn,
  PracticeRunnerService,
  DEFAULT_MAX_TURNS,
  type CrisisWindowState,
  type StagnationState,
} from '../../src/auto-practice/practice-runner.service.js';

/**
 * 咨询师 generate 的真实签名 (显式标注给 vi.fn, 让 mockImplementation 的回调类型
 * 与线上一致 —— 否则 mock 会被当成"返回 void 的回调", 触发 no-misused-promises).
 */
type CounselorGenerateSignature = (
  mode: CounselorMode,
  history: readonly CounselorHistoryTurn[],
  options?: CounselorGenerateOptions,
) => Promise<CounselorReply>;

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

/** 造一轮引擎结果. */
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

/** 咨询师逐轮轮换的话 (彼此不近似, 避免误触发复读检测). */
const COUNSELOR_LINES = ['我先把这句接住。', '你愿意再多说一点吗？', '刚才那点我们停一下。', '我听到的是工作那部分。', '这里我们慢慢来。'];

describe('PracticeRunnerService', () => {
  let counselorTurn = 0;
  let engine: { open: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let counselor: { generate: ReturnType<typeof vi.fn<CounselorGenerateSignature>> };
  let repo: ReturnType<typeof stubRepo>;
  let runner: PracticeRunnerService;

  beforeEach(() => {
    counselorTurn = 0;
    engine = { open: vi.fn(), turn: vi.fn(), close: vi.fn() };
    counselor = { generate: vi.fn<CounselorGenerateSignature>() };
    repo = stubRepo();
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
    runner = new PracticeRunnerService(
      engine as unknown as TurnEnginePort,
      counselor as never,
      fingerprint as never,
      repo as never,
      undefined, // gateway optional, 单测不给
    );
    engine.open.mockResolvedValue({ debugSessionId: 'ds_test' });
    // 咨询师**逐轮换话** —— 原来每轮都是同一句"咨询师话".
    // WP-G 加了咨询师复读检测之后, 那样会让每一场都在第 3 轮被判停滞
    // (那是新逻辑的**正确**行为, 但不是这些用例想测的东西).
    counselor.generate.mockImplementation(() => {
      counselorTurn += 1;
      // ⚠️ closeRequested 是 CounselorReply 的必填字段, 这里**故意不填** (缺省 = 不收尾) ——
      //   用类型断言保住运行时形状 (补 false 与 undefined 语义等价, 但仍不改形状).
      return Promise.resolve({
        text: COUNSELOR_LINES[counselorTurn % COUNSELOR_LINES.length],
        model: 'test-model',
        degraded: false,
      } as CounselorReply);
    });
  });

  it('跑满 maxTurns → completed', async () => {
    // 每次 turn 返回不同回复 (不复读), 跑 3 轮.
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '来访说第一句'))
      .mockResolvedValueOnce(makeTurn(2, '来访说第二句'))
      .mockResolvedValueOnce(makeTurn(3, '来访说第三句'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 3,
    });

    expect(result.status).toBe('completed');
    expect(result.exitReason).toBe('max_turns');
    expect(result.turnCount).toBe(3);
    expect(result.crisisEnded).toBe(false);
    expect(engine.turn).toHaveBeenCalledTimes(3);
    expect(engine.close).toHaveBeenCalledWith('ds_test');
  });

  // ── WP-J 改动 B: 危机后置练习窗 ────────────────────────────────────────────
  //   旧行为 (crisisDetected → 立刻 crisis_ended) 已废除: 它把"危机"当"会话中断",
  //   24 场里 3 场停在来访者刚说出危机那一句, 咨询师一个字都没回.
  it('危机披露 → 不终止, 继续练满后置练习窗 → crisis_practice_max', async () => {
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '今晚我一个人在家，没什么人'))
      .mockResolvedValueOnce(makeTurn(4, '试了呼吸，稍微能坐住了'))
      .mockResolvedValueOnce(makeTurn(5, '我姐可以过来陪我'))
      .mockResolvedValueOnce(makeTurn(6, '明天我打算去找医生聊一聊'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 8,
    });

    expect(result.status).toBe('completed');
    expect(result.exitReason).toBe('crisis_practice_max');
    // 危机没有终止对话: 披露后继续跑了 4 轮.
    expect(engine.turn).toHaveBeenCalledTimes(6);
    expect(result.metrics.crisisPracticed).toBe(true);
    expect(result.metrics.crisisFirstTurn).toBe(2);
    expect(result.metrics.crisisPostTurns).toBe(4);
    expect(result.metrics.crisisPeakLevel).toBe(1);
    expect(result.crisisEnded).toBe(false);
  });

  it('危机强度上升 (二次升级) → 才交回 crisis_ended', async () => {
    engine.turn
      .mockResolvedValueOnce(makeTurn(1, '我最近状态还算稳'))
      .mockResolvedValueOnce(makeTurn(2, '有时候真的觉得活着没意思', 'passive_ideation'))
      .mockResolvedValueOnce(makeTurn(3, '我已经想好了，今晚就动手', 'suicide_plan'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 10,
    });

    expect(result.status).toBe('crisis_ended');
    expect(result.exitReason).toBe('crisis_escalated');
    expect(result.crisisEnded).toBe(true);
    expect(result.metrics.crisisEscalated).toBe(true);
    expect(result.metrics.crisisPeakLevel).toBe(3);
    expect(engine.turn).toHaveBeenCalledTimes(3);
  });

  it('危机轮咨询师请求收尾 → 强制继续 (至少走完 1 轮稳定化)', async () => {
    // 第 2 轮 (危机披露轮) 咨询师就想收尾 —— 必须被挡一次.
    counselor.generate
      .mockResolvedValueOnce({ text: '你最近怎么样？', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '今天就到这里吧。', model: 'm', degraded: false, closeRequested: true })
      .mockResolvedValue({ text: '我先确认一下你此刻的安全。', model: 'm', degraded: false, closeRequested: false });
    for (let i = 1; i <= 4; i += 1) {
      engine.turn.mockResolvedValueOnce(
        makeTurn(i, i === 2 ? '有时候觉得活着没意思' : `来访第${i}句不同内容`, i === 2 ? 'passive_ideation' : null),
      );
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 4,
    });

    // 没有在第 2 轮收尾 (那条 closeRequested 被挡掉), 一路跑到 maxTurns.
    expect(result.exitReason).toBe('max_turns');
    expect(engine.turn).toHaveBeenCalledTimes(4);
    expect(result.metrics.crisisPracticed).toBe(true);
  });

  it('来访连续复读 → stagnant 提前停', async () => {
    // 三轮完全相同的短回复 (命中复读检测).
    engine.turn.mockResolvedValueOnce(makeTurn(1, '嗯')).mockResolvedValueOnce(makeTurn(2, '嗯')).mockResolvedValueOnce(makeTurn(3, '嗯'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 10,
    });

    expect(result.status).toBe('stagnant');
    expect(result.exitReason).toBe('stagnant');
  });

  // ★ WP-J 的判定对象变更: 来访者**来回打转**(A→B→A′→B′→A″), 每一对相邻都不同,
  //   但每一轮都与**历史某一条**高度相似 → 这是真正的"聊了没新东西", 必须判停滞.
  //   旧口径(只跟上一轮比)对这种形态完全漏判, 会一路跑到 maxTurns.
  it('来访者来回打转 (相邻不同但与历史高度重合) → 判无推进停滞', async () => {
    const lines = [
      '我最近一直睡不好，晚上躺在床上就开始想白天工作上的事',
      '我妈上周打电话来，我们聊了很久也没聊明白',
      '我最近一直睡不好，晚上躺在床上就开始想白天工作上的那些事',
      '我妈上周打电话来，我们聊了很久也没聊清楚',
      '我最近一直睡不好，晚上躺在床上就开始想白天工作上的那些事情',
    ];
    for (const [index, line] of lines.entries()) {
      engine.turn.mockResolvedValueOnce(makeTurn(index + 1, line));
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 8,
    });

    expect(result.status).toBe('stagnant');
    expect(result.exitReason).toBe('stagnant');
    // 连续 3 轮无新信息 → 第 5 轮终止.
    expect(engine.turn).toHaveBeenCalledTimes(5);
  });

  // ★ 旧行为 (WP-G 改动 3): 咨询师连续复读 → stagnant. 该行为已废除:
  //   金丝雀 5 场误判全部由它触发, 而触发文本的字符相似度只有 0.00~0.04 ——
  //   真正命中的是语义层, 反映式复述本来就会"连续两轮谈同一件事".
  it('咨询师连续说同一句 → 不再判停滞, 只记语义回响指标 (WP-J 改动 A-③)', async () => {
    counselor.generate.mockResolvedValue({ text: '我听到你很难受。', model: 'm', degraded: false, closeRequested: false });
    for (let i = 1; i <= 5; i += 1) {
      engine.turn.mockResolvedValueOnce(
        makeTurn(i, `来访第${i}句不同内容，${['说的是工作', '说的是父母', '说的是睡眠', '说的是健康', '说的是朋友'][i - 1]}`),
      );
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 5,
    });

    // 对话没有被掐断: 跑满 maxTurns 正常结束.
    expect(result.status).toBe('completed');
    expect(result.exitReason).toBe('max_turns');
    expect(engine.turn).toHaveBeenCalledTimes(5);
    // 但"咨询师一直在同一状态上打转"这件事被记下来了.
    expect(result.metrics.counselorSemanticEchoTurns).toBeGreaterThanOrEqual(2);
  });

  it('咨询师判断可收尾 → natural_close 提前停 (且不超过最小轮数保护)', async () => {
    // 咨询师第 6 轮给出收尾标记.
    counselor.generate
      .mockResolvedValueOnce({ text: '开场', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '澄清', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '共情', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '方向', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '再确认', model: 'm', degraded: false, closeRequested: false })
      .mockResolvedValueOnce({ text: '收尾总结，约定下次', model: 'm', degraded: false, closeRequested: true });
    // 来访者按调用序号返回 (用 Once 序列, 避开 mockImplementation 返回 Promise 引发的
    // @typescript-eslint/no-misused-promises).
    for (let i = 1; i <= 6; i += 1) {
      engine.turn.mockResolvedValueOnce(makeTurn(i, `来访第${i}句内容`));
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 15,
    });

    expect(result.status).toBe('completed');
    expect(result.exitReason).toBe('natural_close');
    expect(result.turnCount).toBe(6);
    expect(engine.turn).toHaveBeenCalledTimes(6);
  });

  it('收尾标记出现太早 (未到最小轮数) 不生效', async () => {
    // 每轮换一句 (同一句会被新增的咨询师复读检测判成停滞).
    let closeTurn = 0;
    counselor.generate.mockImplementation(() => {
      closeTurn += 1;
      return Promise.resolve({ text: `想说收尾第${closeTurn}轮`, model: 'm', degraded: false, closeRequested: true });
    });
    for (let i = 1; i <= 4; i += 1) {
      engine.turn.mockResolvedValueOnce(makeTurn(i, `来访第${i}句内容`));
    }

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 4,
    });

    expect(result.exitReason).toBe('max_turns');
    expect(engine.turn).toHaveBeenCalledTimes(4);
  });

  it('引擎抛错 → failed', async () => {
    engine.turn.mockRejectedValue(new Error('engine exploded'));

    const result = await runner.run({
      characterSlug: 'vpt_test',
      counselorMode: makeMode(),
      maxTurns: 5,
    });

    expect(result.status).toBe('failed');
    expect(result.exitReason).toBe('error');
    // close 仍然被调用 (finally 块).
    expect(engine.close).toHaveBeenCalledWith('ds_test');
  });

  it('默认 maxTurns = 15', async () => {
    // 不传 maxTurns 时, 应该用 DEFAULT_MAX_TURNS.
    expect(DEFAULT_MAX_TURNS).toBe(15);
  });
});

/**
 * V2026-11-11 RESID-1 (状态接口类型导出 · 回归护栏).
 *
 * 为什么需要这条: `scripts/ops/calibration/stagnation-calibration.ts` 要 import
 * `CrisisWindowState` / `StagnationState` 两个类型, 而它们原先在 runner 里是**非导出**的
 * interface —— 脚本侧类型检查报 2 个 TS2459 (类型不存在于导出清单).
 *
 * 这条断言的作用是**让「导出」这件事本身可测**: 只要下面这两行编译得过,
 * 就证明两个类型确实在 runner 的导出清单里 —— 谁再把 export 去掉, 这里立刻红.
 *
 * 形态: 静态投影校验 (纯类型 + 零 IO / 不起 Nest / 不连 DB).
 */
describe('RESID-1 · runner 状态接口类型导出', () => {
  it('CrisisWindowState / StagnationState 可被外部 import (TS2459 护栏)', () => {
    // 编译期即断言: 这两个 import 能解析, 说明确实在导出清单里.
    const crisisWindow: Partial<CrisisWindowState> = {};
    const stagnation: Partial<StagnationState> = {};

    expect(crisisWindow).toEqual({});
    expect(stagnation).toEqual({});
  });

  it('decideTurn 仍是导出的纯函数 (入参形状未变)', () => {
    expect(typeof decideTurn).toBe('function');
  });
});
