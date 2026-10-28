// V2026-10-12 (Phase 8.4 — Preview DTO / SPEC §12.3):
//   跟客户端 7.4 PreviewDialog 协议对齐 — 1 request + 1 response DTO.
//   response 含 3 个 mock user input + 3 个 AI response (visitor agent).
//
//   大厂 spec (跟 ai-effect.dto.ts pattern):
//     - class-validator 字段用 readonly
//     - @ApiProperty swagger 装饰器
//     - V0.x 简化: 不接 persona entity 表, 用 personaId string 区分 (default / anxious / depressed)

import { ApiProperty } from '@nestjs/swagger';

/**
 * Preview 请求体 — POST /admin/knowledge-items/:id/preview.
 */
export class PreviewRequestDto {
  @ApiProperty({
    description: '来访者 persona id (V0.x 简化: default / anxious / depressed)',
    enum: ['default', 'anxious', 'depressed'],
    required: false,
    default: 'default',
  })
  personaId?: string;
}

/**
 * Persona 简版 (V0.x 硬编, V1.x 走 src/agent/persona/).
 */
export class PreviewPersonaDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
}

/**
 * Preview 响应 — 1 个 kb + 1 个 persona + 3 对 (userInput, response) + 1 fallback 标.
 */
export class PreviewResponseDto {
  @ApiProperty({ description: '预览的 KB item 完整信息' })
  knowledgeItem!: {
    id: string;
    title: string;
    content: { format: 'doc'; body: string; preview: string };
    metadata: { tags: string[]; difficulty: number | null; category: string; personaId: string | null; searchKeywords: string[] };
  };

  @ApiProperty({ description: '使用的 persona (跟 user 输入 personaId 对应)' })
  persona!: PreviewPersonaDto;

  @ApiProperty({ type: [String], description: '3 个 mock user input (跟 spec §12.3 一致)' })
  mockUserInputs!: string[];

  @ApiProperty({
    type: [String],
    description: '3 个 AI response (visitor 视角), 跟 mockUserInputs 一一对应',
  })
  responses!: string[];

  @ApiProperty({
    description: 'true = LLM 失败 fallback 走 mock 响应; false = 真 LLM 调用',
    default: false,
  })
  isFallback!: boolean;
}
