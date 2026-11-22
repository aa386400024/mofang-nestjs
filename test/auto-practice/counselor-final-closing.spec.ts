// AF-143 · 最终收束独立通道单测
//   覆盖：① 多轮收束判定保留轮次索引；② 确定性补全补齐三件套；
//   ③ generateFinalClosing 只喂最近 2 轮摘要，且 system 含最高优先级收束块。

import { describe, expect, it, vi } from 'vitest';

import { CounselorAgentService } from '../../src/auto-practice/counselor-agent.service.js';
import type { CounselorMode } from '../../src/auto-practice/entities/counselor-mode.entity.js';
import { completeRoutineClosingText, evaluateRoutineClosingTurns } from '../../src/auto-practice/metrics/session-structure-audit.js';

const MODE = {
  id: 'expert',
  name: '专家咨询师',
  systemPrompt: '你是一名有十年经验的心理咨询师.',
  description: '',
  enabled: 1,
  sortOrder: 10,
} as unknown as CounselorMode;

function makeService(chat: ReturnType<typeof vi.fn>): CounselorAgentService {
  const router = { chat, getDefaultModelForTier: vi.fn(() => 'test-model') };
  const config = { get: vi.fn(() => {}) };
  return new CounselorAgentService(router as never, config as never);
}

describe('AF-143 · 收束判定与确定性补全', () => {
  it('多轮判定不会把第 1 轮的总结和第 9 轮的我听到拼成同一轮', () => {
    const turns = [
      '我们今天先到这里，我最后总结一下。',
      ...Array.from({ length: 7 }, (_, index) => `第 ${index + 2} 轮继续探索。`),
      '我听到你提到，等待被看见对你很重要。',
    ];
    const result = evaluateRoutineClosingTurns(turns);
    expect(result.missing).toContain('summary');
  });

  it('缺失三件套时确定性补齐，且补全后判定为完整', () => {
    const text = '我听到你提到，你一直在等一个回应。';
    const completed = completeRoutineClosingText(text, '我不是随口等等，我是真的等了很久。');
    expect(completed).toContain('我总结一下今天的谈话。我听到你提到');
    expect(completed).toContain('你可以带走一句话');
    expect(completed).toContain('下次我们再见面之前，你可以试试');
    expect(completeRoutineClosingText(completed, '').trim()).toBe(completed.trim());
  });
});

describe('AF-143 · generateFinalClosing 独立通道', () => {
  it('只喂最近 6 轮摘要，作为单条指令而不是连续对话', async () => {
    const chat = vi.fn(() =>
      Promise.resolve({
        content: '我总结一下今天的谈话。我听到你提到，你一直在等。\n你可以带走一句话。\n下次我们再见面之前，你可以试试。\n[[STATE:END]]',
        finishReason: 'stop',
      }),
    );
    const service = makeService(chat);
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ('visitor' as const) : ('counselor' as const),
      text: `第 ${index + 1} 轮很长的历史内容，`.repeat(4),
    }));

    const reply = await service.generateFinalClosing(MODE, history, {
      sessionProfile: 'long',
      turnIndex: 50,
      finalClosing: true,
    });

    const calls: { messages: { role: string; content: string }[] }[][] = chat.mock.calls;
    const request = calls[0][0];
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0].content).toContain('最终收束（本场最后一次发言');
    expect(request.messages[1].content).toContain('来访者：第 7 轮');
    expect(request.messages[1].content).not.toContain('第 1 轮');
    expect(reply.closeRequested).toBe(true);
  });
});
