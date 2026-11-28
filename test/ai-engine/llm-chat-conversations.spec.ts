import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';

import { LlmChatController } from '../../src/ai-engine/controllers/llm-chat.controller.js';
import { ChatHistoryQueryDto } from '../../src/ai-engine/dto/llm-chat.dto.js';
import { LlmOrchestratorService } from '../../src/ai-engine/providers/llm-orchestrator.service.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import { LLMTier } from '../../src/llm/common/enums/llm.enums.js';

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    uid: 'u-1',
    tier: LLMTier.RAG,
    providerId: 'doubao',
    model: 'doubao-pro',
    title: '焦虑对话',
    promptTokens: 128,
    completionTokens: 64,
    crisisEventId: 'crisis-secret',
    startedAt: new Date('2026-11-28T00:00:00Z'),
    endedAt: new Date('2026-11-28T00:01:00Z'),
    ...overrides,
  };
}

function makeController() {
  const orchestrator = {
    listConversations: vi.fn().mockResolvedValue([conversationRow()]),
    getConversation: vi.fn().mockResolvedValue(conversationRow()),
  };
  return { controller: new LlmChatController(orchestrator as never), orchestrator };
}

describe('LLM 会话历史接口 · 安全投影', () => {
  it('列表只返回用户可见字段，不泄露 token / crisis / provider', async () => {
    const { controller } = makeController();
    const rows = await controller.listConversations('u-1', { limit: 25 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 'conv-1',
      tier: LLMTier.RAG,
      title: '焦虑对话',
      startedAt: new Date('2026-11-28T00:00:00Z'),
      endedAt: new Date('2026-11-28T00:01:00Z'),
    });
    expect(Object.keys(rows[0])).toEqual(['id', 'tier', 'title', 'startedAt', 'endedAt']);
    expect(rows[0]).not.toHaveProperty('promptTokens');
    expect(rows[0]).not.toHaveProperty('completionTokens');
    expect(rows[0]).not.toHaveProperty('crisisEventId');
    expect(rows[0]).not.toHaveProperty('providerId');
    expect(rows[0]).not.toHaveProperty('model');
  });

  it('列表把 limit 透传给编排器，缺省为 50', async () => {
    const { controller, orchestrator } = makeController();
    await controller.listConversations('u-1', { limit: 25 });
    expect(orchestrator.listConversations).toHaveBeenCalledWith('u-1', 25);
    await controller.listConversations('u-1', {});
    expect(orchestrator.listConversations).toHaveBeenLastCalledWith('u-1', 50);
  });

  it('详情使用同一套安全投影', async () => {
    const { controller } = makeController();
    const row = await controller.getConversation('u-1', 'conv-1');
    expect(Object.keys(row)).toEqual(['id', 'tier', 'title', 'startedAt', 'endedAt']);
    expect(row).not.toHaveProperty('crisisEventId');
  });
});

describe('ChatHistoryQueryDto · limit 边界', () => {
  async function errorsFor(input: Record<string, unknown>) {
    const dto = plainToInstance(ChatHistoryQueryDto, input);
    const errors = await validate(dto, { whitelist: true });
    return errors.map((e) => e.property);
  }

  it('接受 1 / 50 / 100，并把 query 字符串转成数字', async () => {
    expect(await errorsFor({ limit: '50' })).toEqual([]);
    expect(plainToInstance(ChatHistoryQueryDto, { limit: '50' }).limit).toBe(50);
    expect(await errorsFor({ limit: 1 })).toEqual([]);
    expect(await errorsFor({ limit: 100 })).toEqual([]);
  });

  it('拒绝 0 / 101 / 非数字 / 小数', async () => {
    expect(await errorsFor({ limit: 0 })).toEqual(['limit']);
    expect(await errorsFor({ limit: 101 })).toEqual(['limit']);
    expect(await errorsFor({ limit: 'abc' })).toEqual(['limit']);
    expect(await errorsFor({ limit: 2.5 })).toEqual(['limit']);
  });
});

describe('会话不存在 · 404 业务码', () => {
  it('getConversation 抛 LlmConversationNotFound 且 HTTP 404', async () => {
    const repo = { findOne: vi.fn().mockResolvedValue(null) };
    const service = new LlmOrchestratorService({} as never, {} as never, repo as never, {} as never, {} as never, {} as never, {} as never);

    const error = await service.getConversation('u-1', 'missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BizException);
    expect((error as BizException).code).toBe(BizCode.LlmConversationNotFound);
    expect((error as BizException).getStatus()).toBe(404);
  });

  it('ChatSessionNotFound 也映射为 404', () => {
    const error = new BizException(BizCode.ChatSessionNotFound);
    expect(error.getStatus()).toBe(404);
  });
});

describe('流式对话结束 · 落会话元数据', () => {
  function buildOrchestrator(crisisLevel: 'none' | 'high') {
    const conversationRepo = {
      findOne: vi.fn().mockResolvedValue({ id: 'conv-1', uid: 'u-1' }),
      create: vi.fn((value: unknown) => value),
      save: vi.fn(async (value: unknown) => value),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const crisisRepo = {
      create: vi.fn((value: unknown) => value),
      save: vi.fn(async (value: unknown) => ({ ...(value as object), id: 'crisis-1' })),
    };
    const router = {
      streamChat: vi.fn(async function* () {
        yield { delta: '你好', tokenCount: 1, isFinal: false, finishReason: null };
        yield { delta: '', tokenCount: 2, isFinal: true, finishReason: 'stop' };
      }),
    };
    const detector = {
      detect: vi.fn().mockReturnValue({
        level: crisisLevel,
        keywords: [],
        suggestedResource: '热线',
      }),
    };
    const recorder = { record: vi.fn().mockResolvedValue(true) };
    const service = new LlmOrchestratorService(
      router as never,
      detector as never,
      conversationRepo as never,
      crisisRepo as never,
      { assertAccepted: vi.fn().mockResolvedValue(null) } as never,
      { get: vi.fn().mockReturnValue({ enforceAiChat: true }) } as never,
      recorder as never,
    );
    return { service, recorder, conversationRepo };
  }

  const dto = {
    tier: LLMTier.RAG,
    messages: [
      { role: 'user', content: '今天很焦虑' },
      { role: 'assistant', content: '先做呼吸' },
    ],
    stream: true,
    useRag: false,
    conversationId: 'conv-1',
  };

  it('正常流结束后按 uid + conversationId 写会话', async () => {
    const { service, recorder, conversationRepo } = buildOrchestrator('none');
    for await (const _chunk of service.streamChat('u-1', dto as never)) {
      // drain
    }
    expect(recorder.record).toHaveBeenCalledWith({
      uid: 'u-1',
      conversationId: 'conv-1',
      messages: dto.messages,
    });

    // AF-594: 续聊不重复 INSERT 整行; token 走一条 UPDATE 原子累加.
    expect(conversationRepo.save).not.toHaveBeenCalled();
    expect(conversationRepo.update).toHaveBeenCalledWith(
      { id: 'conv-1', uid: 'u-1' },
      expect.objectContaining({
        promptTokens: expect.any(Function),
        completionTokens: expect.any(Function),
      }),
    );
  });

  it('高危危机直出路径同样写会话', async () => {
    const { service, recorder } = buildOrchestrator('high');
    for await (const _chunk of service.streamChat('u-1', dto as never)) {
      // drain
    }
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u-1', conversationId: 'conv-1' }));
  });
});
