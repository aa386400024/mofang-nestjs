// V2026-10-21 治本 (V1.2 VS-B1 — M1 动态解锁档案 controller):
//   原因: v1.2 spec §4.2 视图 B 需要前端能 (1) 拉取"已解锁档案"渲染时间线,
//     (2) 随时补一条咨询师观察. 现状 0 controller.
//   修法: 3 个 endpoint (薄委托, 业务全在 CaseProfileEntryService):
//     - GET    /counselor/long-term-cases/:caseId/profile-entries  列档案 (两层分区)
//     - POST   /counselor/long-term-cases/:caseId/profile-entries  咨询师手写观察
//     - DELETE /counselor/long-term-cases/:caseId/profile-entries/:entryId  软删 (纠正误记)
//   反双胞胎:
//     - 路径挂在 /counselor/long-term-cases 下 (而不是 /counselor/profile-entries):
//       档案是**长程个案卷宗**的子资源, 天然从属个案; 另起一级路径会让人误以为档案
//       能脱离个案存在 (实际必带 case_id)
//     - 不开放"来访披露"写入口给前端: 层级由调用入口决定 (手写 / AI 抽取分两个 service method),
//       前端只能写 therapist_note, 否则用户能伪造"来访者说过的话"
//     - 不用 hard delete: 走软删 deletedAt (跟 counselor 其它 entity 一致)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 swagger 确认 3 个 endpoint
//     3. POST 后 GET 能看到 therapistNotes 分组
//   时间戳: 2026-10-21

import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CaseProfileEntriesDto, CaseProfileEntryDto, CreateCaseProfileEntryDto } from '../dto/visitor-persona.dto';
import { CaseProfileEntryService } from '../providers/case-profile-entry.service';

/**
 * V2026-10-21 (V1.2 VS-B1 — CounselorCaseProfileEntryController):
 *   M1 视图 B — 长程卷宗动态解锁档案 REST controller.
 */
@ApiTags('counselor-case-profile-entries')
@Controller('counselor/long-term-cases/:caseId/profile-entries')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorCaseProfileEntryController {
  constructor(private readonly service: CaseProfileEntryService) {}

  /**
   * GET /counselor/long-term-cases/:caseId/profile-entries — 列档案.
   */
  @Get()
  @ApiOperation({ summary: '长程个案的动态解锁档案 (来访披露 / 咨询师手写, 两层分区)' })
  async list(@CurrentUser() user: { userId: string }, @Param('caseId') caseId: string): Promise<CaseProfileEntriesDto> {
    return this.service.list(user.userId, caseId);
  }

  /**
   * POST /counselor/long-term-cases/:caseId/profile-entries — 咨询师手写观察.
   */
  @Post()
  @ApiOperation({ summary: '新增一条咨询师观察 / 假设 (来访披露由系统抽取, 前端不可伪造)' })
  async create(
    @CurrentUser() user: { userId: string },
    @Param('caseId') caseId: string,
    @Body() input: CreateCaseProfileEntryDto,
  ): Promise<CaseProfileEntryDto> {
    return this.service.create(user.userId, caseId, input);
  }

  /**
   * DELETE /counselor/long-term-cases/:caseId/profile-entries/:entryId — 软删.
   */
  @Delete(':entryId')
  @ApiOperation({ summary: '软删 1 条档案条目 (纠正误记)' })
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('caseId') caseId: string,
    @Param('entryId') entryId: string,
  ): Promise<{ success: boolean }> {
    await this.service.remove(user.userId, caseId, entryId);
    return { success: true };
  }
}
