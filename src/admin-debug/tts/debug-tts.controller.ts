// AF-395: 调试页 TTS 生成端点。
// 只接受会话 id + 轮次 + provider，文本由服务端从真实记录解析，避免变成通用 TTS 代理。
import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { DebugTtsRenderDto } from './debug-tts.dto.js';
import { DebugTtsService, type DebugTtsRenderResult, type DebugTtsSpeechPreview } from './debug-tts.service.js';
import { AdminRoleGuard } from '../guards/admin-role.guard.js';

@Controller('admin/api/debug/tts')
@UseGuards(AdminRoleGuard)
export class DebugTtsController {
  constructor(private readonly tts: DebugTtsService) {}

  /** 生成或读取该轮该模型的历史音频. */
  @Post('render')
  async render(@Body() dto: DebugTtsRenderDto): Promise<DebugTtsRenderResult> {
    return this.tts.render(dto.source, dto.sessionId, dto.turnIndex, dto.provider);
  }

  /**
   * AF-459: 只读预览语音形态（不合成、不计费）.
   *
   * 气泡"语音形态"切换点开时调它：拿到逐句语义标记与事件表，
   * 用户点具体模型后再调 render 出音频。
   */
  @Post('inspect')
  async inspect(@Body() dto: DebugTtsRenderDto): Promise<DebugTtsSpeechPreview> {
    return this.tts.inspect(dto.source, dto.sessionId, dto.turnIndex, dto.provider);
  }
}
