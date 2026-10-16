// V2026-10-15 治本 (V3.6 — ability.controller.ts, 3 endpoint 1:1 wire):
//   原因: counselor-mode-v1.0 §6.3 拍板 7 维度 28 子指标 + user 聚合, V0.3 §13 baseline
//     0 子指标 controller, 1:1 wire 0 破坏. V0.5 已有 7 counselor controller (含 W1-2
//     + W3-4); 本 V1.x W5-6 改造, ability controller 真接 AbilityService.
//
//   修法 (跟 W1-2 + W3-4 controller 风格一致):
//     - @UseGuards(JwtAuthGuard) + @CurrentUser() 注入 uid (V0.5 已有, 复用)
//     - 3 endpoint: GET list dimensions / GET profile / POST upsert score
//     - @ApiBearerAuth() + @ApiTags('counselor-ability') 跟 V0.5 风格一致
//     - controller thin delegate to AbilityService (跟 W1-2 + W3-4 风格一致,
//       不在 controller 写业务逻辑, 全部在 service, 大厂 Clean Arch)
//
//   3 endpoint (跟 counselor-mode-v1.0 §6.3 + handoff §7 W5-6 1:1):
//     - GET  /counselor/ability/dimensions[?parentDimension=] - 28 子指标 list (可选按 7 维度过滤)
//     - GET  /counselor/ability/profile                     - user 聚合 (28 子指标 + 7 维度平均分 + 总体平均分)
//     - POST /counselor/ability/score                       - 手动 upsert 1 子指标 score (V0.5 阶段, V1.x 接 W3-4 自动累加)
//
//   反双胞胎:
//     - 不在 controller 写业务逻辑: 全部 service, 跟 V0.5 7 controller 风格一致
//     - 不复用 W1-2/W3-4 service: 业务正交 (能力画像 vs 长程 vs 督导), 跟 V0.5 culture
//       "1 module 8 service 独立" 一致
//     - 不引 GraphQL: V0.5 REST 风格, 跟 client Dio 风格一致
//     - 不暴露 score 累加算法给 client: V0.5 走简单算术平均 (service 内部), V2.x 升级 LLM
//       推理时改 service 内部
//
//   验证:
//     1. tsc 0 错 (3 endpoint 字段 type 严格)
//     2. 大炮跑 pnpm migration:run + curl 验 3 endpoint 端到端
//     3. integration: 28 子指标 list / 详情含 description / 手动 upsert / 聚合 profile
//
//   时间戳: 2026-10-15

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  type AbilityDimensionDetailDto,
  type AbilityDimensionListItemDto,
  type AbilityProfileDto,
  type UpsertAbilityScoreDto,
} from '../dto/ability.dto';
import { type AbilityParentDimension } from '../enums/ability-parent-dimension.enum';
import { AbilityService } from '../providers/ability.service';

/**
 * V2026-10-15 (V1.x counselor-mode W5-6 — CounselorAbilityController):
 *   7 维度 28 子指标 + user 聚合 score REST controller.
 *
 *   跟 xin_su_app AbilityBloc + AbilityRepository 端到端 1:1 对应.
 *   V1.x 真接库, V0.5 内存 mock 阶段已过.
 */
@ApiTags('counselor-ability')
@Controller('counselor/ability')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorAbilityController {
  constructor(private readonly service: AbilityService) {}

  /**
   * GET /counselor/ability/dimensions[?parentDimension=]
   *
   * 28 子指标 list (从 DB 读, isActive=1, 软删过滤, 按 displayOrder 升序).
   * 可选 parentDimension query 过滤 7 维度.
   */
  @Get('dimensions')
  @ApiOperation({ summary: '7 维度 28 子指标 list (可选按 7 维度 enum 过滤, UI 雷达图 28 标签)' })
  async listDimensions(@Query('parentDimension') parentDimension?: string): Promise<AbilityDimensionListItemDto[]> {
    return this.service.listDimensions(parentDimension as AbilityParentDimension);
  }

  /**
   * GET /counselor/ability/dimensions/:code
   *
   * 单子指标详情 (含 description, UI 详情用).
   */
  @Get('dimensions/:code')
  @ApiOperation({ summary: '单子指标详情 (含 description, UI 详情 / 督导报告用)' })
  async findDimensionByCode(@Param('code') code: string): Promise<AbilityDimensionDetailDto> {
    return this.service.findDimensionByCode(code);
  }

  /**
   * GET /counselor/ability/profile
   *
   * user 聚合 profile (28 子指标 score + 7 维度平均分 + 总体平均分, UI 雷达图 3 视图).
   */
  @Get('profile')
  @ApiOperation({ summary: 'user 聚合 profile (28 子指标 + 7 维度平均分 + 总体平均分, UI 雷达图)' })
  async getUserProfile(@CurrentUser() user: { userId: string }): Promise<AbilityProfileDto> {
    return this.service.getUserProfile(user.userId);
  }

  /**
   * POST /counselor/ability/score
   *
   * 手动 upsert 1 子指标 score (V0.5 阶段, V1.x 续做时 W3-4 supervision.service
   * 自动累加回调本 endpoint).
   */
  @Post('score')
  @ApiOperation({ summary: '手动 upsert 1 子指标 score (V0.5 阶段, V1.x 接 W3-4 supervision_feedback 自动累加)' })
  async upsertScore(
    @CurrentUser() user: { userId: string },
    @Body() input: UpsertAbilityScoreDto,
  ): Promise<{ dimensionId: string; score: number; source: string }> {
    return this.service.upsertScore(user.userId, input);
  }
}
