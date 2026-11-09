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

    const request = chat.mock.calls[0]?.[0] as { messages: { role: string; content: string }[] };
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

    const request = chat.mock.calls[0]?.[0] as { messages: { role: string; content: string }[] };
    const system = request.messages[0]?.content ?? '';

    expect(system).toContain('出现危机时，这一轮输出 [[STATE:MORE]]（不要收尾）');
  });

  it('危机协议在收尾纪律**之后** (标记先定义, 再引用)', async () => {
    const chat = vi.fn(() => Promise.resolve({ content: '我在听。\n\n[[STATE:MORE]]', finishReason: 'stop' }));
    const service = makeService(chat);

    await service.generate(MODE, []);

    const request = chat.mock.calls[0]?.[0] as { messages: { role: string; content: string }[] };
    const system = request.messages[0]?.content ?? '';

    expect(system.indexOf('## 收尾纪律')).toBeLessThan(system.indexOf('## 危机应对'));
  });
});
