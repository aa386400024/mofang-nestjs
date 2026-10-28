// V2026-10-21 治本 (V1.2 VS-C — M3.4 双向移情/阻抗标记 controller):
//   原因: v1.2 spec §6.4 双向移情/阻抗标记系统 —— 咨询师手动标记 (反移情侧):
//     「会谈中用户点按钮『反移情觉察』+ 简短备注」.
//     AI 自动标记 (来访侧) 由每轮分析器内部落库, 不对外暴露写入口.
//   修法: 2 个 endpoint (薄委托, 业务全在 TransferenceMarkService):
//     - POST /counselor/training-sessions/:sessionId/marks  咨询师手动标记
//     - GET  /counselor/training-sessions/:sessionId/marks  查全部标记 (两侧合并, 按时间线)
//   反双胞胎:
//     - **不开放 visitor_auto 的写入口**: 方向由 service 的调用入口决定 (create = 手动),
//       否则用户能伪造"AI 判定来访者有阻抗" —— 那是临床判断, 必须可信
//     - 不在 DTO 里暴露 direction 字段: 暴露了就等于让前端传, 跟 case_profile_entries 的
//       layer 同款问题 (已在那里治本过一次)
//     - 不分 2 个 GET 端点 (手动 / 自动各一个): 前端要的是"一条时间线看全部标记",
//       分开就得前端自己合并, 还得处理排序
//     - DTO **值导入**: ValidationPipe 靠 design:paramtypes 元数据拿 DTO 类
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST 一个手动标记 → GET 能查到, direction=counselor_manual
//   时间戳: 2026-10-21

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CreateTransferenceMarkDto, TransferenceMarkDto } from '../dto/session-core.dto';
import { TransferenceMarkService } from '../providers/transference-mark.service';

/**
 * V2026-10-21 (V1.2 VS-C — CounselorTransferenceMarkController):
 *   M3.4 双向移情/阻抗标记 — 咨询师手动侧写入口 + 两侧合并读.
 */
@ApiTags('counselor-transference-marks')
@Controller('counselor/training-sessions/:sessionId/marks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorTransferenceMarkController {
  constructor(private readonly service: TransferenceMarkService) {}

  /**
   * POST /counselor/training-sessions/:sessionId/marks — 咨询师手动标记.
   */
  @Post()
  @ApiOperation({ summary: '新增 1 条移情/阻抗标记 (咨询师手动侧, 通常是反移情觉察)' })
  async create(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Body() input: CreateTransferenceMarkDto,
  ): Promise<TransferenceMarkDto> {
    return this.service.create(user.userId, sessionId, input);
  }

  /**
   * GET /counselor/training-sessions/:sessionId/marks — 查全部标记.
   */
  @Get()
  @ApiOperation({ summary: '该会话的全部移情/阻抗标记 (AI 自动 + 咨询师手动, 按轮次升序)' })
  async list(@CurrentUser() user: { userId: string }, @Param('sessionId') sessionId: string): Promise<TransferenceMarkDto[]> {
    return this.service.list(user.userId, sessionId);
  }
}
