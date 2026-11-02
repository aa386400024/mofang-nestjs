// V2026-10-12 (Phase 8.4 — Preview service / SPEC §12.3):
//   LLM proxy 调 LlmService.streamChat 3 次, 拿当前 KB content + persona
//   生成 3 个 mock 对话. V0.x dev fallback: LLM 失败返 mock 响应 + isFallback=true.
//
//   大厂 spec (跟 src/ai-engine/providers/llm-orchestrator.service.ts 同 pattern):
//     - 单个 LlmService 注入, 不新建 LLM client
//     - 失败 fallback 静默 log, 不 throw (preview 是辅助功能, 不阻塞主流程)
//     - 不缓存 (预览是单次操作, cache 收益小)
//
//   治本:
//     - 不接 src/agent/persona/ (V0.x 硬编 3 persona, V1.x 真接 visitor agent
//       + supervisor agent, 跟 spec §11.1 完整 visitor prompt 对齐)
//     - mock user input 3 句硬编 (跟 spec §12.3 "模拟用户问 3 句" 一致)
//     - LLM 调用 V0.x 失败返 canned response (跟 spec §5.3 "可降级" 原则)

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LlmService } from '../../agent/llm/llm.service';
// V2026-10-12 治本 (Phase 8.4 — Preview import path):
//   LlmMessage 在 llm.types.ts, llm.service.ts 只 import 不 re-export.
//   治本: 拆 2 个 import, 类型从 types 取 (跟 7.x 客户端 dartz show Either 同 pattern,
//   显式 import 类型不走 value path).
import { LlmMessage } from '../../agent/llm/llm.types';
import { PreviewPersonaDto, PreviewRequestDto, PreviewResponseDto } from '../dto/preview.dto';
import { KnowledgeItem } from '../entities/knowledge-item.entity';

@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  /**
   * 3 个 mock user input (跟 spec §12.3 完全一致).
   * 治本: 硬编字符串不放 config (业务常量, 跟 persona prompt 一起是
   * domain 知识, 跟 3.3 节 "运营可调" 区别).
   */
  private static readonly MOCK_USER_INPUTS: readonly string[] = ['你好, 我最近睡不好', '能具体说说吗', '我该怎么办'];

  /**
   * Visitor system prompt 简化版 (V0.x). V1.x 走 src/agent/visitor/visitor.prompts.ts
   * 完整版 (spec §11.1), 含 age / complaint / personality / emotionBaseline /
   * defenseLevel / difficulty 6 维配置.
   */
  private static readonly VISITOR_SYSTEM_PROMPT = `你是一个心理咨询模拟训练系统中的"来访者"角色. 知识库内容是培训材料, 用户是"咨询师"在练习.
请以"来访者"身份自然回复: 1-2 句口语化, 不书面, 不主动给建议 (你是来访者不是咨询师).`;

  constructor(
    @InjectRepository(KnowledgeItem)
    private readonly items: Repository<KnowledgeItem>,
    private readonly llm: LlmService,
  ) {}

  /**
   * 主入口 — POST /admin/knowledge-items/:id/preview.
   * 3 个 mock user input → 3 个 LLM response (或 fallback mock 响应).
   */
  async preview(tenantId: string, itemId: string, userId: string, request: PreviewRequestDto): Promise<PreviewResponseDto> {
    const item = await this.items.findOne({ where: { id: itemId, tenantId } });
    if (!item) {
      throw new NotFoundException(`KB 不存在: id=${itemId}`);
    }

    const persona = this.resolvePersona(request.personaId ?? 'default');
    const responses: string[] = [];
    let isFallback = false;

    for (const userInput of PreviewService.MOCK_USER_INPUTS) {
      try {
        const response = await this.callLlm(item, userInput, persona, tenantId, userId);
        responses.push(response);
      } catch (e) {
        // V0.x dev fallback (跟 spec §5.3 "可降级" + §12.3 "V0.x 后端未建
        // 失败路径" 一致). LLM 失败不影响主流程, 标 isFallback 让前端 UI
        // 提示 "preview 不可用, 真实训练时再试".
        this.logger.warn(`preview LLM call failed: itemId=${itemId} userInput=${userInput.slice(0, 30)} err=${(e as Error).message}`);
        responses.push(this.mockFallbackResponse(userInput));
        isFallback = true;
      }
    }

    return {
      knowledgeItem: {
        id: item.id,
        title: item.title,
        content: item.content,
        metadata: item.metadata,
      },
      persona,
      mockUserInputs: [...PreviewService.MOCK_USER_INPUTS],
      responses,
      isFallback,
    };
  }

  // ─── 内部 ───

  /**
   * 单条 LLM 调用 — visitor 视角, system prompt + user prompt, 累积 content chunks.
   */
  private async callLlm(
    item: KnowledgeItem,
    userInput: string,
    persona: PreviewPersonaDto,
    tenantId: string,
    userId: string,
  ): Promise<string> {
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: `${PreviewService.VISITOR_SYSTEM_PROMPT}\n\n角色: ${persona.name} (${persona.description})`,
      },
      {
        role: 'user',
        content: `知识库内容 (前 500 字):\n${item.content.body.slice(0, 500)}\n\n用户 (咨询师) 说: ${userInput}\n\n请以"${persona.name}"身份回复:`,
      },
    ];

    let content = '';
    const stream = this.llm.streamChat(messages, {
      tenantId,
      userId,
      temperature: 0.7,
      maxTokens: 150,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content' && chunk.content) {
        content += chunk.content;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error.message);
      }
      // chunk.type === 'done' 时自然结束, 不再 yield, for-await 退出
    }
    return content.trim() || '...';
  }

  /**
   * V0.x persona 简版 — 硬编 3 种. V1.x 走 src/agent/persona/ entity 完整版.
   * 跟 client 7.4 PreviewDialog 的 personaId 字段对齐.
   */
  private resolvePersona(personaId: string): PreviewPersonaDto {
    const personas: Record<string, PreviewPersonaDto> = {
      default: { id: 'default', name: '通用来访者', description: '中等难度, 标准心理咨询训练场景' },
      anxious: { id: 'anxious', name: '焦虑来访者', description: '主诉失眠和紧张, 性格内敛, 防御等级 3' },
      depressed: { id: 'depressed', name: '抑郁来访者', description: '情绪低落, 兴趣减退, 自我评价低, 防御等级 4' },
    };
    return personas[personaId] ?? personas['default'];
  }

  /**
   * LLM 失败 fallback 响应 — V0.x 跟 client 7.4 PreviewDialog 失败 UX 一致
   * (显示 "preview 不可用, 真实训练时再试" banner).
   */
  private mockFallbackResponse(userInput: string): string {
    const fallbacks: Record<string, string> = {
      '你好, 我最近睡不好': '嗯...我也不知道为什么, 就是躺下脑子就停不下来。',
      能具体说说吗: '就是工作上的事, 还有家里的事, 各种事吧。',
      我该怎么办: '我不知道, 才会来找你的啊...',
    };
    return fallbacks[userInput] ?? '...';
  }
}
