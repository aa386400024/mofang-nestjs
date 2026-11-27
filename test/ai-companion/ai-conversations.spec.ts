import { describe, expect, it, vi } from 'vitest';

import { ChatSession } from '../../src/ai-companion/entities/chat-session.entity.js';
import { AiConversationsService } from '../../src/ai-companion/providers/ai-conversations.service.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';

function makeRow(overrides: Partial<ChatSession> = {}): ChatSession {
  const row = new ChatSession();
  row.id = 'sess-1';
  row.uid = 'u-1';
  row.mode = 'normal';
  row.summaryTitle = '开会前很焦虑';
  row.summaryText = '识别灾难化思维';
  row.emotionEmoji = '🌧️';
  row.roundCount = 8;
  row.archived = false;
  row.createdAt = new Date('2026-11-27T13:12:00.000Z');
  row.updatedAt = row.createdAt;
  return Object.assign(row, overrides);
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
}

function makeService(repo: ReturnType<typeof makeRepo>) {
  return new AiConversationsService(repo as never);
}

describe('AiConversationsService', () => {
  it('按 uid 倒序查询真实会话，最多 100 条，并映射 DTO', async () => {
    const repo = makeRepo({ find: vi.fn().mockResolvedValue([makeRow()]) });
    const res = await makeService(repo).listConversations('u-1');

    expect(repo.find).toHaveBeenCalledWith({
      where: { uid: 'u-1' },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    expect(res.items).toEqual([
      {
        id: 'sess-1',
        timestamp: '2026-11-27T13:12:00.000Z',
        emoji: '🌧️',
        title: '开会前很焦虑',
        summary: '识别灾难化思维',
        rounds: 8,
        mode: 'normal',
      },
    ]);
  });

  it('真实表没有数据时返回空列表，不回退任何 sample', async () => {
    const repo = makeRepo();
    const res = await makeService(repo).listConversations('u-empty');

    expect(repo.find).toHaveBeenCalledOnce();
    expect(res.items).toEqual([]);
  });

  it('摘字段缺失时使用稳定兜底文案，不抛错', async () => {
    const repo = makeRepo({
      find: vi.fn().mockResolvedValue([makeRow({ summaryTitle: null, summaryText: null, emotionEmoji: null })]),
    });
    const [item] = (await makeService(repo).listConversations('u-1')).items;

    expect(item.title).toBe('对话记录');
    expect(item.summary).toBe('');
    expect(item.emoji).toBe('💬');
  });

  it('详情查询带 uid，本人会话返回 DTO', async () => {
    const repo = makeRepo({ findOne: vi.fn().mockResolvedValue(makeRow()) });
    const dto = await makeService(repo).getConversation('u-1', 'sess-1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'sess-1', uid: 'u-1' } });
    expect(dto.id).toBe('sess-1');
    expect(dto.rounds).toBe(8);
  });

  it('详情不存在或不属于本人时抛 ChatSessionNotFound', async () => {
    const repo = makeRepo();
    await expect(makeService(repo).getConversation('u-2', 'sess-1')).rejects.toBeInstanceOf(BizException);
  });

  it('删除已归档会话被拒绝，不执行删除', async () => {
    const repo = makeRepo({ findOne: vi.fn().mockResolvedValue(makeRow({ archived: true })) });
    await expect(makeService(repo).deleteConversation('u-1', 'sess-1')).rejects.toBeInstanceOf(BizException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('删除本人未归档会话成功，删除条件带 uid', async () => {
    const repo = makeRepo({ findOne: vi.fn().mockResolvedValue(makeRow()) });
    const res = await makeService(repo).deleteConversation('u-1', 'sess-1');

    expect(repo.delete).toHaveBeenCalledWith({ id: 'sess-1', uid: 'u-1' });
    expect(res).toEqual({ deleted: true, id: 'sess-1' });
  });
});
