// V2026-10-29 (WP19 · AdminDebugModule 只读 API):
//   职责: 给调试器 SPA (admin-dashboard) 提供只读数据.
//   边界: 全部 GET, 无写操作; 不直接暴露 TypeORM entity, 走 DTO.
//
//   端点:
//     GET /admin/api/sessions?limit=20   — 最近会话列表
//     GET /admin/api/sessions/:id         — 会话详情 (trace + 逐字稿 + 报告)
//     GET /admin/api/characters           — 角色池列表
//     GET /admin/api/health               — 引擎状态
//
//   V2026-10-30 治本 (WP19-R · admin/api 收口):
//     ① `characters` 改查 **`character_profiles`** (引擎角色池), 不再查
//        `visitor_pool_templates` (速查卡表) —— 调试器看到的角色基线必须与
//        引擎 openSession 实际注入的是**同一份** (audit D3).
//     ② sessions 列表**按请求用户隔离**: 学员只看自己的, 管理员 (basic auth)
//        不过滤 (audit D29).
//     ③ 会话不存在 → **404** (原来返 200 + {error:'not_found'}, audit D27).
//     ④ 列表补齐 WP19 原单 §1.2 的 `characterSlug` / `totalTokens`
//        (原来 totalTokens 恒 0、且缺 characterSlug, audit D28).
//
//   鉴权在**中间件**层 (`AdminBasicAuthMiddleware`): 本 controller 只读
//   "这次请求是谁" (req.adminBasicAuth / req.user), 不自己解析凭据.
//
//   V2026-11-03 治本 (WP26 §1 P2-4 · 加角色校验):
//     中间件只判**身份** (是运维 basic 还是学员 JWT), 不判**角色** —— 学员凭自己的
//     token 就能进调试器. 现在 class 级挂 `AdminRoleGuard` 判"是不是管理员"
//     (查 DB 真值 `users.admin_role` = 'admin'), 非 admin → 403.
//     为什么 class 级挂: 4 个端点全是内部能力, 逐个 method 挂 guard 漏一个就开天窗;
//     class 级挂一次, 新增端点自动继承 (与仓库既有 admin controller 同款做法).
//     为什么不再挂 JwtAuthGuard: 身份已由中间件解析 (basic 或 JWT 都可能),
//     再挂一次会把 basic 运维入口打成 401.

import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import type { AdminDebugRequest } from './admin-basic-auth.middleware.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import type { TurnTrace } from './trace-recorder.service.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import { CharacterProfileEntity } from '../engine-adapters/wiring/character/character-profile.entity.js';

@Controller('admin/api')
// 角色校验 (WP26 P2-4): 非 admin 角色 → 403 (BizCode.Forbidden).
@UseGuards(AdminRoleGuard)
export class AdminDebugController {
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    @InjectRepository(CharacterProfileEntity)
    private readonly characterRepo: Repository<CharacterProfileEntity>,
    private readonly config: ConfigService,
  ) {}

  /** 最近会话列表. */
  @Get('sessions')
  async sessions(@Req() req: AdminDebugRequest, @Query('limit') limit?: string) {
    const n = Math.min(Number(limit ?? 20), 50);
    const rows = await this.sessionRepo.find({
      // 学员只看自己的 (管理员不过滤) —— 隔离口径与"长时记忆归属"同款.
      where: { deletedAt: IsNull(), ...this.ownerFilter(req) },
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
        userId: true,
        turnDebugTrace: true,
      },
    });
    return rows.map((r) => {
      const traces = readTraces(r.turnDebugTrace);
      return {
        sessionId: r.id,
        characterSlug: traces.at(-1)?.characterSlug ?? '',
        visitorAlias: r.personaName,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSec: r.startedAt && r.endedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : 0,
        status: r.status,
        totalTokens: sumTokens(traces),
      };
    });
  }

  /** 会话详情: 元信息 + trace + 逐字稿 + 报告. */
  @Get('sessions/:id')
  async sessionDetail(@Req() req: AdminDebugRequest, @Param('id') id: string) {
    const session = await this.sessionRepo.findOne({
      where: { id, deletedAt: IsNull(), ...this.ownerFilter(req) },
    });
    // 不存在 (或不属于该学员) → 404.
    // 为什么"不存在"与"不是你的"都返 404: 返 403 等于告诉对方"这个 id 存在" ——
    // 那就是泄露会话是否存在. 统一 404, 调试器侧无差别.
    if (!session) {
      throw new BizException(BizCode.ResourceNotFound, '会话不存在');
    }

    return {
      sessionId: session.id,
      characterSlug: readTraces(session.turnDebugTrace)[0]?.characterSlug ?? '',
      visitorAlias: session.personaName,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      transcript: session.transcript ?? [],
      traces: readTraces(session.turnDebugTrace),
      report: {
        status: session.techStats ? 'completed' : 'pending',
        techStats: session.techStats,
      },
    };
  }

  /**
   * 角色池列表 (引擎角色基线 `character_profiles`).
   *
   * 为什么改查这张表 (WP19-R §1.2):
   *   调试器要看的"角色" = **引擎实际注入的那份基线** = `character_profiles`
   *   (trust / resist / valence / arousal / 上下架 / 审核态).
   *   原来查的 `visitor_pool_templates` 是**速查卡表** (对外的人设简介),
   *   两者不是同一份数据 —— 调试器看到的角色与引擎注入的基线对不上.
   *
   * 口径与 resolver 一致: 只列未软删的行, 并把**审核态 / 上下架**一并返回
   * (调试器要能看出"这个角色引擎现在根本命中不了").
   */
  @Get('characters')
  async characters() {
    const rows = await this.characterRepo.find({
      where: { deletedAt: IsNull() },
      order: { templateId: 'ASC' },
      select: {
        templateId: true,
        displayName: true,
        attachmentStyle: true,
        baselineTrust: true,
        baselineResistanceVerbal: true,
        baselineResistanceDepth: true,
        baselineResistanceStyle: true,
        baselineEmotionValence: true,
        baselineEmotionArousal: true,
        enabled: true,
        auditStatus: true,
      },
    });
    return rows.map((r) => ({
      slug: r.templateId,
      codename: r.displayName,
      attachmentStyle: r.attachmentStyle,
      baseline: {
        trust: r.baselineTrust,
        resist: r.baselineResistanceVerbal,
        valence: r.baselineEmotionValence,
        arousal: r.baselineEmotionArousal,
      },
      resistance: {
        verbal: r.baselineResistanceVerbal,
        depth: r.baselineResistanceDepth,
        style: r.baselineResistanceStyle,
      },
      enabled: r.enabled,
      auditStatus: r.auditStatus,
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

  /**
   * 请求归属过滤条件 (学员隔离; 管理员不过滤).
   *
   * 口径:
   *   · 带管理员 basic 凭据 → 不加条件 (调试器要看全场);
   *   · 学员 (有身份) → 只看 `user_id = 自己`;
   *   · 匿名 (dev 裸奔) → 不加条件.
   *
   * @param req 请求
   * @returns where 片段 (空 = 不过滤)
   */
  private ownerFilter(req: AdminDebugRequest): { readonly userId?: string } {
    if (req.adminBasicAuth === true) return {};
    const userId = (req.user?.userId ?? '').trim();
    return userId.length > 0 ? { userId } : {};
  }
}

/**
 * 读调试快照数组 (DB 里是 JSON 列, 可能为空 / 形状不对).
 *
 * @param raw 原始列值
 * @returns 快照数组 (读不出来就给空数组)
 */
function readTraces(raw: unknown): TurnTrace[] {
  return Array.isArray(raw) ? (raw as TurnTrace[]) : [];
}

/**
 * 汇总本场 token 用量 (输入 + 输出两侧).
 *
 * 为什么用 trace 汇总而不是 tech_stats: 调试器要的"这场烧了多少 token"与
 * 留痕快照是同一份口径; 没留痕的会话 (没开留痕开关) 就是 0, 不编.
 *
 * @param traces 本场快照
 * @returns token 合计
 */
function sumTokens(traces: readonly TurnTrace[]): number {
  return traces.reduce((sum, trace) => {
    const usage = trace.llmUsage;
    if (!usage) return sum;
    return sum + (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  }, 0);
}
