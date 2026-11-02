// V2026-10-29 (WP19 · AdminDebugModule 只读 API):
//   职责: 给调试器 SPA (admin-dashboard) 提供只读数据.
//   边界: 全部 GET, 无写操作; 不暴露 TypeORM entity, 走 DTO.
//
//   端点:
//     GET /admin/api/sessions?limit=20   — 最近会话列表
//     GET /admin/api/sessions/:id         — 会话详情 (trace + 逐字稿 + 报告)
//     GET /admin/api/characters           — 角色池列表
//     GET /admin/api/health               — 引擎状态

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type { TurnTrace } from './trace-recorder.service';
import { TrainingSession } from '../counselor/entities/training-session.entity';
import { VisitorPoolTemplate } from '../counselor/entities/visitor-pool-template.entity';

@Controller('admin/api')
export class AdminDebugController {
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    @InjectRepository(VisitorPoolTemplate)
    private readonly characterRepo: Repository<VisitorPoolTemplate>,
    private readonly config: ConfigService,
  ) {}

  /** 最近会话列表. */
  @Get('sessions')
  async sessions(@Query('limit') limit?: string) {
    const n = Math.min(Number(limit ?? 20), 50);
    const rows = await this.sessionRepo.find({
      where: { deletedAt: IsNull() },
      order: { startedAt: 'DESC' },
      take: n,
      select: {
        id: true,
        personaName: true,
        startedAt: true,
        endedAt: true,
        status: true,
        scenarioId: true,
        techStats: true,
      },
    });
    return rows.map((r) => ({
      sessionId: r.id,
      visitorAlias: r.personaName,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationSec: r.startedAt && r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : 0,
      status: r.status,
      totalTokens: 0,
    }));
  }

  /** 会话详情: 元信息 + trace + 逐字稿 + 报告. */
  @Get('sessions/:id')
  async sessionDetail(@Param('id') id: string) {
    const session = await this.sessionRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!session) return { error: 'not_found' };

    return {
      sessionId: session.id,
      visitorAlias: session.personaName,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      transcript: session.transcript ?? [],
      traces: (session.turnDebugTrace as TurnTrace[]) ?? [],
      report: {
        status: session.techStats ? 'completed' : 'pending',
        techStats: session.techStats,
      },
    };
  }

  /** 角色池列表 (公共模板). */
  @Get('characters')
  async characters() {
    const rows = await this.characterRepo.find({
      where: { enabled: true },
      select: {
        id: true,
        codename: true,
        ageRange: true,
        presentingComplaint: true,
        defenseType: true,
        issueDomain: true,
        difficulty: true,
        emotionBaselineDefault: true,
        defenseLevelDefault: true,
      },
    });
    return rows.map((r) => ({
      slug: r.id,
      codename: r.codename,
      ageRange: r.ageRange,
      presentingComplaint: r.presentingComplaint,
      defenseType: r.defenseType,
      issueDomain: r.issueDomain,
      difficulty: r.difficulty,
      emotionBaseline: r.emotionBaselineDefault,
      defenseLevel: r.defenseLevelDefault,
    }));
  }

  /** 引擎健康状态. */
  @Get('health')
  health() {
    return {
      status: 'ok',
      engineVoiceEnabled: this.config.get<string>('ENGINE_VOICE_ENABLED') === 'true',
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
