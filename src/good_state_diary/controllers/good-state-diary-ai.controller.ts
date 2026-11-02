import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { DiaryAiFeedbackDto, RequestDiaryAiFeedbackDto } from '../dto/good-state-diary.dto';
import { GoodStateDiaryAiService } from '../providers/good-state-diary-ai.service';

/**
 * V2026-09-11 治本 (好状态日记 · AI 反馈 controller):
 *
 *   路由:
 *     POST /ai/diary-feedback  - 生成 AI 反馈 (仅 metadata, 不上传 body — PRD §11.1)
 *
 *   边界 (合规):
 *     - 严格 metadata-only 入参 (themes / moodHint / localSummary / tags), 不接收 body / title
 *     - 服务端校验 entry 所有权 (404 防越权)
 *     - P0 启发式 stub; V3 注入 LlmOrchestratorService 调用真 LLM
 *     - crisisFlag=true 时客户端触发 /crisis/alert (后台, 不打断用户阅读)
 *
 *   路径归属: /ai/* 前缀虽然跟 AIEngineModule 重叠, 但本接口是日记专属,
 *   放在 good_state_diary 模块内聚更紧 (避免 good_state_diary ↔ ai-engine
 *   双向耦合). 路径前缀仅作 HTTP 路由, 不代表模块归属.
 */
@ApiTags('ai/diary-feedback')
@Controller('ai/diary-feedback')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GoodStateDiaryAiController {
  constructor(private readonly aiService: GoodStateDiaryAiService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: '生成 AI 反馈 (仅 metadata, 不上传 body / title)',
    description:
      // V2026-09-11 治本 (max-len): description 拆行, 避免单行 > 140 字符触发 max-len.
      '端侧调用: 详情页用户主动触发, 上传端侧抽取的主题 / moodHint / 摘要 / tag; ' +
      '返回 1-2 句 summary + 3 个 perspectiveQuestions + 主题 + crisisFlag. ' +
      '客户端拿到后 PATCH /diary/entries/:id 写入 ai_feedback 字段.',
  })
  public async generate(@CurrentUser('userId') uid: string, @Body() dto: RequestDiaryAiFeedbackDto): Promise<DiaryAiFeedbackDto> {
    return this.aiService.generateFeedback(uid, dto);
  }
}
