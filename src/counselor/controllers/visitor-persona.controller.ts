// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设 controller):
//   原因: v1.2 spec §4.2 视图 A 的交互需要 6 个 HTTP 动作:
//     「随机生成个案」→ 生成全量剧本并返回表层 / 编辑表层字段 / 开启上帝视角后看全量 /
//     转长程时绑定. 现状 0 controller, 前端无从调用.
//   修法: 6 个 endpoint (薄委托, 业务全在 VisitorPersonaService):
//     - POST   /counselor/visitor-personas              「随机生成个案」(LLM 出 7 大块剧本)
//     - GET    /counselor/visitor-personas              我的全部人设 (表层)
//     - GET    /counselor/visitor-personas/:id          表层视图 (视图 A)
//     - GET    /counselor/visitor-personas/:id/full     全量视图 (**上帝视角, 默认 403**)
//     - PATCH  /counselor/visitor-personas/:id/surface  改表层字段 (只改暴露字段)
//     - POST   /counselor/visitor-personas/:id/attach   绑定长程个案 (1:1)
//   反双胞胎:
//     - 不在 controller 里判断上帝视角: 判定 + 403 在 service (唯一真值源, 未来 WS/GraphQL 复用)
//     - 不用 PUT: 跟 counselor 既有 PATCH 局部更新风格一致
//     - DTO 全部**值导入**: 全局 ValidationPipe 开了 transform + whitelist, 靠
//       design:paramtypes 元数据拿 DTO 类; type-only 导入会让元数据退化成 Object → 校验静默失效
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 swagger 确认 6 个 endpoint + DTO 字段
//     3. 端到端 curl 见 docs/progress/v1.2-vs-b1-*.md
//   时间戳: 2026-10-21

import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  GenerateVisitorPersonaDto,
  UpdateVisitorPersonaSurfaceDto,
  VisitorPersonaFullDto,
  VisitorPersonaSurfaceDto,
} from '../dto/visitor-persona.dto';
import { VisitorPersonaService } from '../providers/visitor-persona.service';

/**
 * V2026-10-21 (V1.2 VS-B1 — CounselorVisitorPersonaController):
 *   M1 分层人设 — 视图 A (表层配置) + 上帝视角 (全量) REST controller.
 */
@ApiTags('counselor-visitor-personas')
@Controller('counselor/visitor-personas')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CounselorVisitorPersonaController {
  constructor(private readonly service: VisitorPersonaService) {}

  /**
   * POST /counselor/visitor-personas — 「随机生成个案」.
   */
  @Post()
  @ApiOperation({ summary: '生成一位来访者的完整人生剧本 (LLM), 返回表层视图' })
  async generate(@CurrentUser() user: { userId: string }, @Body() input: GenerateVisitorPersonaDto): Promise<VisitorPersonaSurfaceDto> {
    return this.service.generate(user.userId, input);
  }

  /**
   * GET /counselor/visitor-personas — 我的全部人设.
   */
  @Get()
  @ApiOperation({ summary: '我的来访者人设列表 (表层视图)' })
  async list(@CurrentUser() user: { userId: string }): Promise<VisitorPersonaSurfaceDto[]> {
    return this.service.listByUser(user.userId);
  }

  /**
   * GET /counselor/visitor-personas/:id — 表层视图.
   */
  @Get(':id')
  @ApiOperation({ summary: '来访者人设的表层视图 (视图 A)' })
  async getSurface(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<VisitorPersonaSurfaceDto> {
    return this.service.getSurface(user.userId, id);
  }

  /**
   * GET /counselor/visitor-personas/:id/full — 全量视图 (上帝视角).
   */
  @Get(':id/full')
  @ApiOperation({ summary: '来访者人设的完整剧本 (**需开启上帝视角**, 默认关闭)' })
  async getFull(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<VisitorPersonaFullDto> {
    return this.service.getFull(user.userId, id);
  }

  /**
   * PATCH /counselor/visitor-personas/:id/surface — 改表层字段.
   */
  @Patch(':id/surface')
  @ApiOperation({ summary: '更新来访者人设的表层字段 (深层字段不可改, 保证信息分层)' })
  async updateSurface(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() input: UpdateVisitorPersonaSurfaceDto,
  ): Promise<VisitorPersonaSurfaceDto> {
    return this.service.updateSurface(user.userId, id, input);
  }

  /**
   * POST /counselor/visitor-personas/:id/attach — 绑定长程个案.
   */
  @Post(':id/attach')
  @ApiOperation({ summary: '把全量人设绑定到长程个案 (1:1, 应用层校验)' })
  async attachToCase(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() body: { caseId: string },
  ): Promise<VisitorPersonaSurfaceDto> {
    return this.service.attachToCase(user.userId, id, body.caseId);
  }
}
