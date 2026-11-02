// V2026-10-23 治本 (AI 模拟来访池 — 内部管理 controller):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.5 (AI 生成模板) 与 §3.6
//     (管理端读写位) 定义了内部工具能力, §4 明确「普通用户访问一律 403, 不对外开放写入口」.
//
//   修法: 6 个 endpoint (薄委托, 业务全在 VisitorPoolAdminService):
//     - POST   /counselor/admin/visitor-pool/generate     内部 AI 生成 (落草稿)
//     - GET    /counselor/admin/visitor-pool               管理列表 (含草稿/下架)
//     - GET    /counselor/admin/visitor-pool/:id           详情 (**含 7 大块剧本**)
//     - PATCH  /counselor/admin/visitor-pool/:id           编辑表层字段 / 上下架 / 排序
//     - POST   /counselor/admin/visitor-pool/:id/restore   软删恢复
//     - DELETE /counselor/admin/visitor-pool/:id           软删 (下架)
//
//   反双胞胎:
//     - **class 级挂 AdminRoleGuard**: 6 个端点全部是内部能力, 逐个 method 挂 guard
//       漏一个就开天窗; class 级挂一次, 新增端点自动继承 (与 knowledge controller 的
//       class 级 @UseGuards 同款做法).
//     - **不复用公共 controller**: 公共面与内部面分文件, 避免"哪天把 admin 路径
//       挪进公共 controller"时把写入口一起带出去.
//     - **不把生成端点放在公共路径下**: spec §3.5 明确「不面向普通练习用户」.
//     - **DTO 全部值导入**: 全局 ValidationPipe 靠 design:paramtypes 元数据拿 DTO 类;
//       type-only 导入会让校验静默失效.
//     - **不返回任何计数字段**: 管理面也不返回"使用次数/收藏数" —— 零压红线不因
//       "这是内部接口"而破例.
//
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 swagger 确认 6 个 endpoint
//     3. 普通用户 token 调这 6 个端点 → 403
//
//   时间戳: 2026-10-23
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  GenerateVisitorPoolTemplateDto,
  UpdateVisitorPoolTemplateDto,
  VisitorPoolAdminListDto,
  VisitorPoolAdminListQueryDto,
  VisitorPoolAdminTemplateDto,
} from '../dto/visitor-pool.dto';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { VisitorPoolAdminService } from '../providers/visitor-pool-admin.service';

/**
 * V2026-10-23 (AI 模拟来访池 — CounselorVisitorPoolAdminController):
 *   公共模板库的内部治理面 (AI 生成 / 增删改 / 上下架 / 软删恢复).
 */
@ApiTags('counselor-admin-visitor-pool')
@Controller('counselor/admin/visitor-pool')
// class 级鉴权: JwtAuthGuard 判身份, AdminRoleGuard 判内部角色 (users.admin_role).
// 普通练习用户 → 403 (BizCode.VisitorPoolForbidden).
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@ApiBearerAuth()
export class CounselorVisitorPoolAdminController {
  constructor(private readonly service: VisitorPoolAdminService) {}

  /**
   * POST /counselor/admin/visitor-pool/generate — 内部 AI 生成公共人物.
   */
  @Post('generate')
  @ApiOperation({ summary: '内部 AI 生成公共来访人物 (落草稿待审核; 失败直接报错, 不做软降级)' })
  async generate(
    @CurrentUser() user: { userId: string },
    @Body() input: GenerateVisitorPoolTemplateDto,
  ): Promise<VisitorPoolAdminTemplateDto[]> {
    return this.service.generate(user.userId, input);
  }

  /**
   * GET /counselor/admin/visitor-pool — 管理列表.
   */
  @Get()
  @ApiOperation({ summary: '公共来访人物管理列表 (含草稿 / 已下架)' })
  async list(@Query() query: VisitorPoolAdminListQueryDto): Promise<VisitorPoolAdminListDto> {
    return this.service.list(query);
  }

  /**
   * GET /counselor/admin/visitor-pool/:id — 管理端详情 (含剧本).
   */
  @Get(':id')
  @ApiOperation({ summary: '公共来访人物详情 (**含 7 大块剧本**, 仅内部可见)' })
  async get(@Param('id') id: string): Promise<VisitorPoolAdminTemplateDto> {
    return this.service.get(id);
  }

  /**
   * PATCH /counselor/admin/visitor-pool/:id — 编辑.
   */
  @Patch(':id')
  @ApiOperation({ summary: '编辑公共来访人物 (表层字段 / 上下架 / 排序)' })
  async update(@Param('id') id: string, @Body() input: UpdateVisitorPoolTemplateDto): Promise<VisitorPoolAdminTemplateDto> {
    return this.service.update(id, input);
  }

  /**
   * POST /counselor/admin/visitor-pool/:id/restore — 软删恢复.
   */
  @Post(':id/restore')
  @ApiOperation({ summary: '恢复已软删的公共来访人物 (恢复后仍为下架状态, 需另行上架)' })
  async restore(@Param('id') id: string): Promise<VisitorPoolAdminTemplateDto> {
    return this.service.restore(id);
  }

  /**
   * DELETE /counselor/admin/visitor-pool/:id — 软删.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '软删公共来访人物 (不物理删除)' })
  async remove(@Param('id') id: string): Promise<{ templateId: string; deleted: boolean }> {
    await this.service.remove(id);
    return { templateId: id, deleted: true };
  }
}
