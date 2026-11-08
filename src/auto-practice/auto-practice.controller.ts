// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 HTTP 接口):
//   职责: admin 面板的写操作入口 —— 启动单场实时对练 / 批量入队 / 查场次 / CRUD 咨询师模式.
//
//   端点:
//     POST   /admin/api/auto-practice/sessions         —— 跑一场实时对练 (同步等它跑完)
//     POST   /admin/api/auto-practice/batch            —— 批量入队 (立即返回 batchId)
//     GET    /admin/api/auto-practice/sessions         —— 列场次 (按 batchId/status 筛)
//     GET    /admin/api/auto-practice/sessions/:id    —— 查单场
//     GET    /admin/api/auto-practice/batches/:id    —— 批量进度汇总
//     GET    /admin/api/auto-practice/modes           —— 列咨询师模式
//     POST   /admin/api/auto-practice/modes           —— 新建模式
//     PUT    /admin/api/auto-practice/modes/:id       —— 改模式
//     DELETE /admin/api/auto-practice/modes/:id       —— 删模式
//
//   鉴权: 与 debug-session.controller 同款 —— AdminRoleGuard (class 级).

import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { Repository } from 'typeorm';

import { CounselorMode } from './entities/counselor-mode.entity.js';
import { PracticeSession } from './entities/practice-session.entity.js';
import { PracticeQueueService } from './practice-queue.service.js';
import { PracticeRunnerService } from './practice-runner.service.js';
import { AdminRoleGuard } from '../admin-debug/guards/admin-role.guard.js';

/** 启动单场对练的入参. */
interface StartSessionBody {
  /** 来访者角色 slug. */
  readonly characterSlug?: string;
  /** 咨询师模式 id. */
  readonly counselorModeId?: string;
  /** 最大轮数 (缺省 15). */
  readonly maxTurns?: number;
}

/** 批量入队的入参. */
interface BatchBody {
  /** 来访者角色 slug 列表 (笛卡尔积: 每个角色 × 每个模式). */
  readonly characterSlugs?: readonly string[];
  /** 咨询师模式 id 列表. */
  readonly counselorModeIds?: readonly string[];
  /** 最大轮数. */
  readonly maxTurns?: number;
  /** 每个组合重复几场 (默认 1). */
  readonly repeats?: number;
}

/** 模式 CRUD 的入参. */
interface UpsertModeBody {
  readonly name?: string;
  readonly systemPrompt?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly sortOrder?: number;
}

@Controller('admin/api/auto-practice')
@UseGuards(AdminRoleGuard)
export class AutoPracticeController {
  constructor(
    private readonly runner: PracticeRunnerService,
    private readonly queue: PracticeQueueService,
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
    @InjectRepository(CounselorMode) private readonly modeRepo: Repository<CounselorMode>,
  ) {}

  /**
   * 启动一场实时对练 (立即返回 practiceSessionId, 后台跑循环).
   *
   * 前端连上 WS /auto-practice 并 subscribe 这个 practiceSessionId 后,
   * 会实时收到每轮对话 (ap:turn / ap:session_end).
   */
  @Post('sessions')
  async startSession(@Body() body: StartSessionBody) {
    const characterSlug = (body?.characterSlug ?? '').trim();
    const counselorModeId = (body?.counselorModeId ?? '').trim();
    if (!characterSlug || !counselorModeId) {
      return { error: 'characterSlug 与 counselorModeId 必填' };
    }
    const mode = await this.modeRepo.findOne({ where: { id: counselorModeId, enabled: 1 } });
    if (!mode) {
      return { error: `咨询师模式不存在或未启用: ${counselorModeId}` };
    }
    // 预生成 ID, 立即返回给前端连 WS; 循环在后台跑.
    const practiceSessionId = nanoid();
    void this.runner.run({
      characterSlug,
      counselorMode: mode,
      maxTurns: body?.maxTurns,
      batchId: null,
      practiceSessionId,
    });
    return { practiceSessionId, characterSlug, counselorModeId };
  }

  /**
   * 批量入队 (立即返回 batchId, 不等跑完).
   */
  @Post('batch')
  async enqueueBatch(@Body() body: BatchBody) {
    const characterSlugs = (body?.characterSlugs ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    const counselorModeIds = (body?.counselorModeIds ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    const repeats = Math.max(1, body?.repeats ?? 1);
    if (characterSlugs.length === 0 || counselorModeIds.length === 0) {
      return { error: 'characterSlugs 与 counselorModeIds 不能为空' };
    }
    const batchId = nanoid();
    let enqueued = 0;
    for (const slug of characterSlugs) {
      for (const modeId of counselorModeIds) {
        for (let r = 0; r < repeats; r += 1) {
          await this.queue.enqueue({
            characterSlug: slug,
            counselorModeId: modeId,
            maxTurns: body?.maxTurns ?? 15,
            batchId,
          });
          enqueued += 1;
        }
      }
    }
    return { batchId, enqueued };
  }

  /** 列场次 (按 batchId / status 筛). */
  @Get('sessions')
  async listSessions(@Query('batchId') batchId?: string, @Query('status') status?: string) {
    const where: Record<string, unknown> = {};
    if (batchId) where['batchId'] = batchId;
    if (status) where['status'] = status;
    return this.sessionRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /** 查单场. */
  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    const row = await this.sessionRepo.findOne({ where: { id } });
    return row ?? { error: '场次不存在' };
  }

  /** 批量进度汇总. */
  @Get('batches/:id')
  async batchProgress(@Param('id') batchId: string) {
    const rows = await this.sessionRepo.find({ where: { batchId } });
    const byStatus = new Map<string, number>();
    for (const row of rows) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    }
    return {
      batchId,
      total: rows.length,
      byStatus: Object.fromEntries(byStatus),
      sessions: rows.map((r) => ({
        id: r.id,
        characterSlug: r.characterSlug,
        counselorModeId: r.counselorModeId,
        status: r.status,
        turnCount: r.turnCount,
        exitReason: r.exitReason,
      })),
    };
  }

  /** 列咨询师模式. */
  @Get('modes')
  async listModes() {
    return this.modeRepo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  /** 新建咨询师模式. */
  @Post('modes')
  async createMode(@Body() body: UpsertModeBody) {
    const id = (body.name ?? '').trim().toLowerCase().replaceAll(/\s+/g, '-');
    if (!id) return { error: 'name 必填' };
    const row = this.modeRepo.create({
      id,
      name: body.name!,
      systemPrompt: body.systemPrompt ?? '',
      description: body.description ?? '',
      enabled: body.enabled === false ? 0 : 1,
      sortOrder: body.sortOrder ?? 0,
    });
    return this.modeRepo.save(row);
  }

  /** 改咨询师模式. */
  @Put('modes/:id')
  async updateMode(@Param('id') id: string, @Body() body: UpsertModeBody) {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch['name'] = body.name;
    if (body.systemPrompt !== undefined) patch['systemPrompt'] = body.systemPrompt;
    if (body.description !== undefined) patch['description'] = body.description;
    if (body.enabled !== undefined) patch['enabled'] = body.enabled ? 1 : 0;
    if (body.sortOrder !== undefined) patch['sortOrder'] = body.sortOrder;
    await this.modeRepo.update(id, patch);
    return this.modeRepo.findOne({ where: { id } });
  }

  /** 删咨询师模式. */
  @Delete('modes/:id')
  async deleteMode(@Param('id') id: string) {
    await this.modeRepo.delete(id);
    return { deleted: true };
  }
}
