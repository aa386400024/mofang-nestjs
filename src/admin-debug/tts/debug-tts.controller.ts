// AF-395: 调试页 TTS 生成端点。
// 只接受会话 id + 轮次 + provider，文本由服务端从真实记录解析，避免变成通用 TTS 代理。
import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AdminRoleGuard } from '../guards/admin-role.guard.js';
import { DebugTtsRenderDto } from './debug-tts.dto.js';
import { DebugTtsService, type DebugTtsRenderResult } from './debug-tts.service.js';

@Controller('debug/tts')
@UseGuards(AdminRoleGuard)
export class DebugTtsController {
  constructor(private readonly tts: DebugTtsService) {}

  /** 生成或读取该轮该模型的历史音频. */
  @Post('render')
  async render(@Body() dto: DebugTtsRenderDto): Promise<DebugTtsRenderResult> {
    return this.tts.render(dto.source, dto.sessionId, dto.turnIndex, dto.provider);
  }
}
