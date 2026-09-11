import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  CreateDiaryEntryDto,
  DiaryEntryDto,
  DiaryPageDto,
  DiaryPurgeResultDto,
  ListDiaryEntriesQueryDto,
  SearchDiaryEntriesQueryDto,
  UpdateDiaryEntryDto,
} from '../dto/good-state-diary.dto';
import { GoodStateDiaryService } from '../providers/good-state-diary.service';

/**
 * V2026-09-11 治本 (好状态日记 · 控制器):
 *
 *   路由 (路径对齐前端 GoodStateDiaryApi 契约):
 *     POST   /diary/entries                - 创建
 *     GET    /diary/entries                - 列表 (游标分页)
 *     GET    /diary/entries/drafts         - 草稿箱 (无分页, 防御性 cap 200)
 *     GET    /diary/entries/search         - 搜索 (LIKE 模糊)
 *     POST   /diary/entries/purge-expired  - 物理擦除到期软删
 *     DELETE /diary/entries/all            - 一键清除本人所有日记
 *     GET    /diary/entries/:id            - 单条详情 (含 AI feedback)
 *     PUT    /diary/entries/:id            - 更新
 *     DELETE /diary/entries/:id            - 软删除
 *     POST   /diary/entries/:id/restore    - 恢复软删除
 *
 *   反双胞胎:
 *     - AI 反馈走 /ai/diary-feedback (独立 controller, 路径前缀 /ai/).
 *     - 不复用 inner-world/reconciliation (日记流水不参与碎片统计).
 *
 *   路由顺序: Express 匹配按声明顺序, 静态路径必须在 :id 之前, 否则会被吞掉.
 */
@ApiTags('good-state-diary')
@Controller('diary/entries')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GoodStateDiaryController {
  constructor(private readonly service: GoodStateDiaryService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '创建一条好状态日记' })
  public async create(@CurrentUser('userId') uid: string, @Body() dto: CreateDiaryEntryDto): Promise<DiaryEntryDto> {
    return this.service.create(uid, dto);
  }

  @Get()
  @ApiOperation({ summary: '游标分页拉取最近日记 (按 createdAt DESC, 默认 finalized)' })
  public async list(@CurrentUser('userId') uid: string, @Query() query: ListDiaryEntriesQueryDto): Promise<DiaryPageDto> {
    return this.service.getRecent(uid, query);
  }

  // ─── 静态路径必须在 :id 之前 ───

  @Get('drafts')
  @ApiOperation({ summary: '草稿箱 (所有 draft 状态, 防御性 cap 200)' })
  public async drafts(@CurrentUser('userId') uid: string): Promise<DiaryEntryDto[]> {
    return this.service.getDrafts(uid);
  }

  @Get('search')
  @ApiOperation({ summary: '全文检索 (LIKE 模糊匹配 body + title, 可选 tag AND 过滤)' })
  public async search(@CurrentUser('userId') uid: string, @Query() query: SearchDiaryEntriesQueryDto): Promise<DiaryPageDto> {
    return this.service.search(uid, query);
  }

  @Post('purge-expired')
  @HttpCode(200)
  @ApiOperation({ summary: '物理擦除到期软删 (默认 30 天) — 由 bootstrap 启动期调用' })
  public async purgeExpired(@CurrentUser('userId') _uid: string, @Query('cutoffDays') cutoffDays?: string): Promise<DiaryPurgeResultDto> {
    if (cutoffDays !== undefined) {
      const days = Number.parseInt(cutoffDays, 10);
      if (Number.isNaN(days) || days < 1 || days > 365) {
        throw new BizException(BizCode.InvalidParameter, 'cutoffDays 必须为 1-365 之间的整数');
      }
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return this.service.purgeExpiredSoftDeletes(cutoff);
    }
    return this.service.purgeExpiredSoftDeletes();
  }

  @Delete('all')
  @HttpCode(200)
  @ApiOperation({ summary: '一键清除本人所有日记 — 「彻底删除」入口, 不可恢复' })
  public async purgeAll(@CurrentUser('userId') uid: string): Promise<DiaryPurgeResultDto> {
    return this.service.purgeAll(uid);
  }

  // ─── :id 路由必须放最后 ───

  @Get(':id')
  @ApiOperation({ summary: '单条详情 (含 AI feedback)' })
  public async getOne(@CurrentUser('userId') uid: string, @Param('id') id: string): Promise<DiaryEntryDto> {
    const entry = await this.service.getById(uid, id);
    if (!entry) {
      throw new BizException(BizCode.ResourceNotFound, `日记不存在或不属于当前用户`);
    }
    return entry;
  }

  @Put(':id')
  @ApiOperation({ summary: '更新日记 (id / authorId / createdAt 不可改)' })
  public async update(
    @CurrentUser('userId') uid: string,
    @Param('id') id: string,
    @Body() dto: UpdateDiaryEntryDto,
  ): Promise<DiaryEntryDto> {
    return this.service.update(uid, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '软删除 (30 天内可恢复)' })
  public async softDelete(@CurrentUser('userId') uid: string, @Param('id') id: string): Promise<void> {
    await this.service.softDelete(uid, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: '恢复软删除的日记' })
  public async restore(@CurrentUser('userId') uid: string, @Param('id') id: string): Promise<DiaryEntryDto> {
    return this.service.restore(uid, id);
  }
}
