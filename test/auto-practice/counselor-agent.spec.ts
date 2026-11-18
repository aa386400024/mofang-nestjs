// V2026-11-09 治本 (Phase2.5 WP-G · 咨询师侧对话质量单测):
//   覆盖任务单 §改动 1 与 §改动 5:
//     ① 兜底台词不再只有一句 —— LLM 连续失败 10 次, 输出不能全是同一句;
//     ② system prompt 含危机应对四要素 (关心/重视 / 评估安全性 / 建议专业帮助 / 不轻视回避),
//        且危机轮明确要求继续 (输出 [[STATE:MORE]], 不收尾).
//
//   全 mock: router.chat 是替身, 不发网络.
//
//   验证: npx vitest run test/auto-practice/counselor-agent.spec.ts

import { describe, expect, it, vi } from 'vitest';

import { CounselorAgentService } from '../../src/auto-practice/counselor-agent.service.js';
import type { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';

const MODE = {
  id: 'expert',
  name: '专家咨询师',
  systemPrompt: '你是一名有十年经验的心理咨询师.',
  description: '',
  enabled: 1,
  sortOrder: 10,
} as unknown as CounselorMode;

/**
 * 取 chat 第 0 次调用的请求体.
 *
 * chat 是**零参**替身 (实现不读入参), 但 vi.fn 照样记录调用实参 ——
 * 这里读的是"记录下来的实参", 不是替身实现里的形参.
 */
function firstRequest(chat: ReturnType<typeof vi.fn>): { messages: { role: string; content: string }[] } {
  // ⚠️ chat 的类型是 `Mock<Procedure>` (mock.calls 是 any[][]) —— 用**类型标注**收窄,
  //   不用 as 断言 (从 any 断言会被 @typescript-eslint/no-unnecessary-type-assertion 判成"等于没断言").
  const calls: { messages: { role: string; content: string }[] }[][] = chat.mock.calls;
  return calls[0][0];
}

/** 造一个只关心 chat 的假 router. */
function makeService(chat: ReturnType<typeof vi.fn>): CounselorAgentService {
  const router = {
    chat,
    getDefaultModelForTier: vi.fn(() => 'test-model'),
  };
  const config = {
    get: vi.fn(() => {}),
  };
  return new CounselorAgentService(router as never, config as never);
}

describe('CounselorAgentService · 兜底台词池 (WP-G 改动 1)', () => {
  it('LLM 连续失败 10 次 → 兜底台词不会全是同一句', async () => {
    const chat = vi.fn(() => Promise.reject(new Error('upstream 429')));
    const service = makeService(chat);

    const texts: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const reply = await service.generate(MODE, []);
      expect(reply.degraded).toBe(true);
      expect(reply.closeRequested).toBe(false);
      expect(reply.text.length).toBeGreaterThan(0);
      texts.push(reply.text);
    }

    expect(new Set(texts).size).toBeGreaterThan(1);
    expect(chat).toHaveBeenCalledTimes(10);
  });

  it('空回复 (LLM 通了但没内容) 也走兜底', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: ' '.repeat(3), finishReason: 'stop' }));
    const service = makeService(chat);

    const reply = await service.generate(MODE, []);

    expect(reply.degraded).toBe(true);
    expect(reply.text.length).toBeGreaterThan(0);
  });
});

describe('CounselorAgentService · 危机应对协议 (WP-G 改动 5)', () => {
  it('system prompt 含危机应对四要素', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, []);

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system).toContain('危机应对');
    expect(system).toContain('表达关心和重视');
    expect(system).toContain('评估安全性');
    expect(system).toContain('建议寻求专业帮助');
    expect(system).toContain('不要轻视或回避');
  });

  it('危机轮要求继续 (输出 [[STATE:MORE]]), 不在危机里收尾', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, []);

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system).toContain('出现危机时，这一轮输出 [[STATE:MORE]]（不要收尾）');
  });

  it('危机协议在收尾纪律**之后** (标记先定义, 再引用)', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, []);

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system.indexOf('## 收尾纪律')).toBeLessThan(system.indexOf('## 危机应对'));
  });
});

/**
 * V2026-11-18 建立 (AF-091 · 长会话收尾纪律).
 *
 * 三条断言:
 *   ① **legacy 档 prompt 逐字不变** —— 快照锁死 (改一个字就红);
 *   ② long 档 prompt 含长会话纪律 (目标 40-50 轮 / 35 轮前不许收尾 / 不许伪造 / 不许拖轮次);
 *   ③ standard 档按自己的数字说话 (不是照抄 long 的 40-50).
 */
describe('CounselorAgentService · AF-091 长会话收尾纪律', () => {
  /**
   * legacy 档 prompt 的**逐字快照** (2026-11-18 改动前采集自 HEAD).
   *
   * ⚠️ 这是本单最硬的一条护栏: 长会话纪律块对 legacy 是**关闭**的,
   *   所以 legacy 的 prompt 必须一个字节都不变 —— 快照就是那个"一个字节".
   */
  const LEGACY_PROMPT_SNAPSHOT = [
    '你是一名有十年经验的心理咨询师.',
    '',
    '## 输出纪律',
    '你只输出咨询师本人说的话，不要写旁白、括号注释、动作描写、心理活动或任何解释；',
    '也不要使用 markdown 符号（**、#、>、- 列表等），这是当面说话，不是写文档。',
    '',
    '## 一致性要求',
    '你要记住自己之前说过的话和来访者提到的关键事实，不要前后矛盾。',
    '- 如果来访者提到的细节跟你之前说的不一样，要指出来确认，而不是假装记得或重新编造；',
    '- 不要主动编造来访者没提过的背景信息（比如他的工作、家庭、爱好）——除非他自己说了；',
    '- 重复确认事实时要稳，不要每次都换一种说法。',
    '',
    '## 收尾纪律',
    '每一轮回复的**最后一行**都必须只写一个状态标记（正文与标记之间空一行）：',
    '- [[STATE:MORE]] —— 议题还在展开，本轮结束后还要继续；',
    '- [[STATE:END]] —— 本轮你说的话就是这次咨询的收尾：已经做了总结、给了方向或约定了下一步，',
    '  来访者的主要议题已经落地，再来一轮就是没必要的拖长。',
    '判断标准偏向"该收就收"：真人在这种情况会说"今天先到这里"，而不是继续追问细节。',
    '标记只能出现在最后一行，正文里不要解释它、不要复述它。',
    '',
    '## 危机应对',
    '如果来访者提到自伤、自杀念头、伤害他人的想法或严重的心理危机，你必须按标准危机干预流程回应：',
    '① 表达关心和重视 —— 让来访者感到你听到了、你在意他的安全，而不是在处理一件普通的事；',
    '② 评估安全性 —— 直接、平静地询问他此刻有没有伤害自己的打算、有没有具体计划、身边有没有人；',
    '③ 建议寻求专业帮助 —— 明确建议联系心理援助热线、寻求专业医疗帮助，或请可信赖的人陪着他；',
    '④ 不要轻视或回避 —— 不评判、不说"想开点""别想太多"，也不因为对方提到危机就草草结束这次咨询。',
    '出现危机时，这一轮输出 [[STATE:MORE]]（不要收尾）—— 你还要继续跟来访者在一起。',
  ].join('\n');

  it('① legacy 档 prompt 逐字不变 (快照锁死)', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, []);

    const request = firstRequest(chat);
    expect(request.messages[0]?.content ?? '').toBe(LEGACY_PROMPT_SNAPSHOT);
  });

  it('① legacy 档 prompt 里没有长会话纪律块', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, [], { sessionProfile: 'legacy' });

    const request = firstRequest(chat);
    expect(request.messages[0]?.content ?? '').not.toContain('长会话收尾纪律');
  });

  it('② long 档 prompt 含长会话纪律: 目标 40-50 轮 / 35 轮前不许收尾', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, [], { sessionProfile: 'long', turnIndex: 12 });

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system).toContain('长会话收尾纪律');
    expect(system).toContain('目标 40-50 轮');
    expect(system).toContain('第 35 轮之前不得输出 [[STATE:END]]');
    expect(system).toContain('当前是第 12 轮');
  });

  it('② long 档 prompt: 不得伪造来访者发言, 也不得强行拖轮次', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, [], { sessionProfile: 'long', turnIndex: 3 });

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system).toContain('不得伪造来访者的发言');
    expect(system).toContain('不得强行拖轮次');
  });

  it('③ standard 档按自己的数字说话 (20-30 轮 / 20 轮前不许收尾)', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, [], { sessionProfile: 'standard', turnIndex: 4 });

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system).toContain('目标 20-30 轮');
    expect(system).toContain('第 20 轮之前不得输出 [[STATE:END]]');
    expect(system).not.toContain('40-50 轮');
  });

  it('长会话纪律块排在收尾纪律之后 (标记先定义, 再引用)', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, [], { sessionProfile: 'long' });

    const request = firstRequest(chat);
    const system = request.messages[0]?.content ?? '';

    expect(system.indexOf('## 收尾纪律')).toBeLessThan(system.indexOf('## 长会话收尾纪律'));
  });
});
