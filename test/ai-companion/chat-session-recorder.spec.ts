import { describe, expect, it, vi } from 'vitest';

import { ChatSession } from '../../src/ai-companion/entities/chat-session.entity.js';
import { ChatSessionRecorder } from '../../src/ai-companion/providers/chat-session-recorder.js';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn((value: Partial<ChatSession>) => value),
    save: vi.fn(async (value: unknown) => value),
    ...overrides,
  };
}

function makeRecorder(repo: ReturnType<typeof makeRepo>) {
  return new ChatSessionRecorder(repo as never);
}

function input(messages: { role: string; content: string }[]) {
  return { uid: 'u-1', conversationId: 'conv-1', messages };
}

describe('ChatSessionRecorder', () => {
  it('首写只落标题与轮数，不落消息原文或 assistant 回复', async () => {
    const repo = makeRepo();
    const recorder = makeRecorder(repo);

    const ok = await recorder.record(
      input([
        { role: 'user', content: '  今天开会前\n突然很焦虑  ' },
        { role: 'assistant', content: '听起来很难受，我们先做三次呼吸。' },
        { role: 'user', content: '好' },
      ]),
    );

    expect(ok).toBe(true);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conv-1',
        uid: 'u-1',
        mode: 'normal',
        summaryTitle: '今天开会前 突然很焦虑',
        summaryText: null,
        emotionEmoji: null,
        roundCount: 2,
        archived: false,
      }),
    );
    const saved = repo.save.mock.calls[0]?.[0] as ChatSession;
    expect(saved).not.toHaveProperty('messages');
    expect(JSON.stringify(saved)).not.toContain('三次呼吸');
  });

  it('标题截断到 80 字', async () => {
    const repo = makeRepo();
    const recorder = makeRecorder(repo);
    await recorder.record(input([{ role: 'user', content: '焦'.repeat(100) }]));
    const created = repo.create.mock.calls[0]?.[0] as ChatSession;
    expect(created.summaryTitle).toHaveLength(80);
  });

  it('续聊更新保留原标题与创建时间，roundCount 取最大值', async () => {
    const existing = Object.assign(new ChatSession(), {
      id: 'conv-1',
      uid: 'u-1',
      summaryTitle: '第一次的标题',
      roundCount: 6,
      createdAt: new Date('2026-11-27T00:00:00Z'),
    });
    const repo = makeRepo({ findOne: vi.fn().mockResolvedValue(existing) });
    const recorder = makeRecorder(repo);

    const ok = await recorder.record(input([{ role: 'user', content: '新的一轮' }]));

    expect(ok).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conv-1',
        summaryTitle: '第一次的标题',
        roundCount: 6,
        createdAt: existing.createdAt,
      }),
    );
  });

  it('已有会话标题为空时补标题', async () => {
    const existing = Object.assign(new ChatSession(), { id: 'conv-1', uid: 'u-1', summaryTitle: null, roundCount: 0 });
    const repo = makeRepo({ findOne: vi.fn().mockResolvedValue(existing) });
    await makeRecorder(repo).record(input([{ role: 'user', content: '补标题' }]));
    expect(repo.save.mock.calls[0]?.[0]).toMatchObject({ summaryTitle: '补标题' });
  });

  it('没有有效 user 消息时不写库', async () => {
    const repo = makeRepo();
    const ok = await makeRecorder(repo).record(input([{ role: 'assistant', content: '你好' }]));
    expect(ok).toBe(false);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('写入失败只返回 false，不向上抛', async () => {
    const repo = makeRepo({ findOne: vi.fn().mockRejectedValue(new Error('db down')) });
    const ok = await makeRecorder(repo).record(input([{ role: 'user', content: '焦虑' }]));
    expect(ok).toBe(false);
  });
});
