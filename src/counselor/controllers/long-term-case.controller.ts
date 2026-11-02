// V2026-10-15 治本 (V1.5 — long-term-case.controller.ts, 3 endpoint 1:1 wire):
//   原因: counselor-mode-v1.0 §6.1 + §4.3 拍板长程 4-12 次会话 + 跨会话 memory, V0.3
//     §13 baseline 0 长程, 1:1 wire 0 破坏. V0.5 已有 5 controller 是内存 mock (走 @UseGuards
//     + thin delegate); 本 V1.x 改造, 长程 controller 真接 LongTermCaseService.
//
//   修法 (跟 counselor-home.controller.ts V0.5 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid (V0.5 已有, 复用)
//     - 3 endpoint: GET list / POST create / GET detail
//     - @ApiBearerAuth() + @ApiTags('counselor-long-term-case') 跟 V0.5 风格一致
//     - controller thin delegate to LongTermCaseService (跟 counselor-training 风格一致,
//       不在 controller 写业务逻辑, 全部在 service, 大厂 Clean Arch)
//
//   3 endpoint (跟 counselor-mode-v1.0 §6.1 + handoff prompt §7 W1-2 1:1):
//     - GET  /counselor/long-term-cases           - 列表 (当前用户所有长程, 倒序)
//     - POST /counselor/long-term-cases           - 从 5 预设创 user instance
//     - GET  /counselor/long-term-cases/:id       - 详情 (含 sessions + visitorPersona +
//                                                   nextSessionContext 🆕 跨会话 memory +
//                                                   abandonmentSuggestion 脱落建议)
//
//   反双胞胎:
//     - 不在 controller 写业务逻辑: 全部 service, 跟 V0.5 5 controller 风格一致
//     - 不复用 counselor-home service: 业务正交 (长程 vs 全流程), 跟 V0.5 culture
//       "1 module 容纳 5 Tab, 5 service 独立" 一致
//     - 不引 GraphQL: V0.5 REST 风格, 跟 client Dio 风格一致
//     - 不暴露 listTemplates 给 client: V1.x 阶段 client 走硬编码 5 类型 enum, V2.x
//       真正允许用户自定义模板时再开放
//
//   验证:
//     1. tsc 0 错 (3 endpoint 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 3 endpoint 端到端
//     3. 大炮跑 integration: GET 返 0 长程 / POST 创 1 / GET 详情含 sessions 列表
//
//   时间戳: 2026-10-15

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { type CreateLongTermCaseDto, type LongTermCaseDetailDto, type LongTermCaseListItemDto } from '../dto/long-term-case.dto';
import { LongTermCaseService } from '../providers/long-term-case.service';

/**
 * V2026-10-15 (V1.x counselor-mode W1-2 — CounselorLongTermCaseController):
 *   长程个案 4-12 次会话 + 跨会话 agent memory REST controller.
 *
 *   跟 xin_su_app LongTermCaseBloc + LongTermCaseRepository 端到端 1:1 对应.
 *   V1.x 真接库, V0.5 内存 mock 阶段已过.
 */
@ApiTags('counselor-long-term-case')
@Controller('counselor/long-term-cases')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorLongTermCaseController {
  constructor(private readonly service: LongTermCaseService) {}

  /**
   * GET /counselor/long-term-cases
   *
   * 返当前用户所有长程列表 (active 优先, abandoned 末, 倒序).
   * 不暴露 5 预设模板 (走 client 硬编码 5 caseType enum).
   */
  @Get()
  @ApiOperation({ summary: '心理咨询师学员端「长程个案」列表 (4-12 次会话, active 优先倒序)' })
  async list(@CurrentUser() user: { userId: string }): Promise<LongTermCaseListItemDto[]> {
    return this.service.list(user.userId);
  }

  /**
   * POST /counselor/long-term-cases
   *
   * 从 5 预设 (workplace/relationship/parenting/grief/anxiety) 创 user instance.
   * input.caseType 走 class-validator @IsEnum 校验, 非法直接 400.
   */
  @Post()
  @ApiOperation({ summary: '从 5 预设长程个案创 user instance (workplace/relationship/parenting/grief/anxiety)' })
  async create(@CurrentUser() user: { userId: string }, @Body() input: CreateLongTermCaseDto): Promise<LongTermCaseListItemDto> {
    return this.service.createFromPreset(user.userId, input);
  }

  /**
   * GET /counselor/long-term-cases/:id
   *
   * 详情含 sessions 列表 + visitorPersona + nextSessionContext (V1.2 🆕 跨会话 memory)
   * + abandonmentSuggestion (V1.4 脱落建议, dropoutRiskScore > 0.7 触发).
   *
   * 跨用户访问: 走 service 内部 userId 校验, 不存在或不属于当前用户抛 NotFoundException.
   */
  @Get(':id')
  @ApiOperation({ summary: '长程个案详情 (含 sessions 列表 + 跨会话 memory nextSessionContext + 脱落建议)' })
  async findOne(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<LongTermCaseDetailDto> {
    return this.service.findDetail(user.userId, id);
  }
}
