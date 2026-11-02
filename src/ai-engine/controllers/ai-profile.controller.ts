// V2026-09-04 治本 (V6.0 §3.1):
//   AI 用户画像 controller.
//   端点:
//     GET    /ai/profile              - 拉 7 维度
//     POST   /ai/profile/dimensions   - 单维度 upsert
//     POST   /ai/profile/batch        - 批量 upsert (冷启动 / 周同步)
//     PUT    /ai/profile/dimensions/:dimension/override - 用户偏好面板改完

import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { AIProfileDimensionDto, AIProfileDto } from '../dto/ai-profile.dto';
// V2026-09-04 治本 (smoke 修): 必须真 import, 不用 `import type`.
//   `import type` 编译时擦除, runtime 拿不到 DTO class 引用, NestJS design:paramtypes
//   metadata 退化成 `Function`, ValidationPipe 不会调 plainToClass, dto 永远 {}.
//   上一轮加的 @IsEnum/@IsObject 装饰器在 dist 里, 但因没转换不会触发, service 拿 undefined.
import { UpsertAIProfileDimensionDto } from '../dto/ai-profile.dto';
import { AIProfileService } from '../providers/ai-profile.service';

@ApiTags('ai-profile')
@Controller('ai/profile')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AIProfileController {
  constructor(private readonly service: AIProfileService) {}

  @Get()
  @ApiOperation({ summary: '拉取当前用户 7 维度画像' })
  public async getProfile(@CurrentUser('userId') uid: string): Promise<AIProfileDto> {
    return this.service.getProfile(uid);
  }

  @Post('dimensions')
  @ApiOperation({ summary: '单维度 upsert (来源 cloud/local/user_override)' })
  public async upsert(@CurrentUser('userId') uid: string, @Body() dto: UpsertAIProfileDimensionDto): Promise<AIProfileDimensionDto> {
    return this.service.upsertDimension(uid, dto);
  }

  @Post('batch')
  @ApiOperation({ summary: '批量 upsert 7 维度' })
  public async batch(@CurrentUser('userId') uid: string, @Body() dtos: UpsertAIProfileDimensionDto[]): Promise<AIProfileDto> {
    return this.service.batchUpsert(uid, dtos);
  }

  @Put('dimensions/:dimension/override')
  @ApiOperation({ summary: '用户在偏好面板改完触发 user_override 写' })
  public async override(
    @CurrentUser('userId') uid: string,
    @Param('dimension') dimension: UpsertAIProfileDimensionDto['dimension'],
    @Body() payload: Record<string, unknown>,
  ): Promise<AIProfileDimensionDto> {
    return this.service.setUserOverride(uid, dimension, payload);
  }
}
