// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池内部管理端点):
//   职责: 角色基线的 CRUD / 上下架 / 过审 (内部 admin, **非 UGC**).
//   边界: 薄委托 (业务全在 CharacterProfileAdminService); 不碰引擎注入点,
//         不碰内核, 不改前端 WS 帧协议.
//
//   为什么挂在 /engine/admin 而不是 /counselor/admin:
//     这张表是**引擎侧**资产 (引擎是它的消费者), 实体与 resolver 都在 engine-adapters.
//     端点路径跟着**表的归属**走, 而不是跟着"谁在运营"走 —— 否则将来角色池并入
//     单一角色注册中心 (任务单 §11.1) 时要搬一次路由.
//
//   反双胞胎:
//     - **class 级挂守卫**: 5 个端点全是内部能力, 逐个 method 挂守卫漏一个就开天窗;
//       class 级挂一次, 新增端点自动继承 (跟 visitor-pool-admin 同款做法).
//     - **不复用公共 controller**: 公共面与内部面分文件, 防"哪天把 admin 路径挪进
//       公共 controller"时把写入口一起带出去.
//     - **守卫直接用仓库既有实现**: 身份走 `JwtAuthGuard` (cookie/Bearer + 黑名单),
//       内部角色走 `AdminRoleGuard` (直读 users.admin_role).
//       不新造第三套鉴权 —— 仓库已有 3 套"内部能力"口径, 造第 4 套只会更乱.
//     - **DTO 全部值导入**: 全局 ValidationPipe 靠 design:paramtypes 元数据拿 DTO 类;
//       type-only 导入会让校验静默失效.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. 普通用户 token 调这 5 个端点 → 403; admin_role='admin' → 200
//     3. swagger 页 /engine/admin/character-profiles 可见 5 个端点
//
//   时间戳: 2026-10-29
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CharacterProfileAdminService } from './character-profile.admin.service.js';
import {
  CharacterProfileAdminDto,
  CharacterProfileAdminListDto,
  CharacterProfileAdminListQueryDto,
  CharacterProfileVersionDetailDto,
  CharacterProfileVersionListDto,
  CreateCharacterProfileDto,
  UpdateCharacterProfileDto,
} from './character-profile.dto.js';
import { BizCode } from '../../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../../common/exceptions/biz.exception.js';
import { AdminRoleGuard } from '../../../counselor/guards/admin-role.guard.js';
import { CurrentUser } from '../../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../user/guards/jwt-auth.guard.js';

/**
 * 角色资产池内部管理端点.
 */
@ApiTags('engine-admin-character-profiles')
@Controller('engine/admin/character-profiles')
// class 级鉴权: JwtAuthGuard 判身份, AdminRoleGuard 判内部角色 (users.admin_role).
// 普通用户 → 403.
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@ApiBearerAuth()
export class CharacterProfileAdminController {
  constructor(private readonly service: CharacterProfileAdminService) {}

  /**
   * GET /engine/admin/character-profiles — 管理列表 (含未过审 / 已下架).
   */
  @Get()
  @ApiOperation({ summary: '角色基线管理列表 (含未过审 / 已下架 / 已软删)' })
  async list(@Query() query: CharacterProfileAdminListQueryDto): Promise<CharacterProfileAdminListDto> {
    return this.service.list(query);
  }

  /**
   * GET /engine/admin/character-profiles/:templateId — 详情.
   */
  @Get(':templateId')
  @ApiOperation({ summary: '角色基线详情 (含 5Ps 专业材料)' })
  async get(@Param('templateId') templateId: string): Promise<CharacterProfileAdminDto> {
    return this.service.get(templateId);
  }

  /**
   * POST /engine/admin/character-profiles — 新建.
   */
  @Post()
  @ApiOperation({ summary: '新建角色基线 (缺省 draft —— 需显式过审才被引擎命中)' })
  async create(@Body() input: CreateCharacterProfileDto): Promise<CharacterProfileAdminDto> {
    return this.service.create(input);
  }

  /**
   * PATCH /engine/admin/character-profiles/:templateId — 编辑 / 上下架 / 过审.
   */
  @Patch(':templateId')
  @ApiOperation({ summary: '编辑角色基线 (内容字段 / 上下架 / 审核状态 / 版本递增档位)' })
  async update(
    @Param('templateId') templateId: string,
    @Body() input: UpdateCharacterProfileDto,
    @CurrentUser('userId') userId?: string,
  ): Promise<CharacterProfileAdminDto> {
    // WP38: 变更人 id 记进历史版本快照 (谁改的 —— 回溯时要看得见).
    return this.service.update(templateId, input, userId ?? null);
  }

  /**
   * GET /engine/admin/character-profiles/:templateId/versions — 历史版本列表 (WP38).
   */
  @Get(':templateId/versions')
  @ApiOperation({ summary: '角色历史版本列表 (按版本号从新到旧)' })
  async listVersions(@Param('templateId') templateId: string): Promise<CharacterProfileVersionListDto> {
    return this.service.listVersions(templateId);
  }

  /**
   * GET /engine/admin/character-profiles/:templateId/versions/:major/:minor/:patch — 某一版快照 (WP38).
   */
  @Get(':templateId/versions/:major/:minor/:patch')
  @ApiOperation({ summary: '角色某版历史快照 (含完整内容, 可回溯当时怎么配的)' })
  async getVersion(
    @Param('templateId') templateId: string,
    @Param('major') major: string,
    @Param('minor') minor: string,
    @Param('patch') patch: string,
  ): Promise<CharacterProfileVersionDetailDto> {
    return this.service.getVersion(templateId, parseVersionPart(major), parseVersionPart(minor), parseVersionPart(patch));
  }

  /**
   * DELETE /engine/admin/character-profiles/:templateId — 软删 (并下架).
   */
  @Delete(':templateId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '软删角色基线 (同时下架; 不物理删除)' })
  async remove(@Param('templateId') templateId: string): Promise<{ templateId: string; deleted: boolean }> {
    return this.service.remove(templateId);
  }
}

/**
 * 版本号分段 → 非负整数 (WP38).
 *
 * 路径参数是字符串: "1" 转 1, "abc" / "-1" / "1.5" 一律拒 ——
 * 宁可 400 也不把 NaN 带进 where 条件 (那会静默查不到, 让人以为"这版不存在").
 *
 * @param raw 路径参数原文
 * @returns 非负整数
 * @throws BizException(InvalidParameter) 不是合法版本号分段
 */
function parseVersionPart(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new BizException(BizCode.InvalidParameter, `版本号分段不合法: ${raw}`);
  }
  return value;
}
