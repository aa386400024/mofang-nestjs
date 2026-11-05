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
//   V2026-11-05 治本 (WP30 · 调试器两页切真 API):
//     补 4 个只读端点 (调试器 SPA 的 CharacterDetail / SessionDetail 两页原先
//     拿的是前端 mock —— 现在改成真端点):
//     GET /admin/api/characters/:slug           — 角色详情 (基线 + 5Ps + 表达风格 + 审核态)
//     GET /admin/api/characters/:slug/sessions  — 该角色的最近 N 场会话
//     GET /admin/api/sessions/:id/trajectory    — 本场剧本轨迹 (幕路径 + 已触发节点)
//     GET /admin/api/sessions/:id/memories      — 本场记忆 (当前恒空, 见端点注释)
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
import { buildAdminTrajectoryState } from './trajectory-view.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import { CharacterProfileEntity } from '../engine-adapters/wiring/character/character-profile.entity.js';

/**
 * 角色会话的**扫描窗口** (内存过滤的上限).
 *
 * 为什么要有上限: 角色过滤发生在**内存里** (`training_sessions` 没有角色列),
 * 不设上限就是"把全表拉进内存再筛" —— 调试器点开一个角色就能把库拖垮.
 *
 * 为什么是 500: 够覆盖一个角色在近期的主诉量级, 又不至于把一次调试请求变成全表扫.
 *
 * ⚠️ 因此 `sessionCount` 的口径是"**扫描窗口内**的场次数", 不是全量总数.
 * 登记在 WP30 交付记录 §偏差 B4 —— 真要全量总数, 得先把角色 slug 提成
 * `training_sessions` 的一列 (或加一张角色-会话索引表).
 */
const CHARACTER_SESSION_SCAN_LIMIT = 500;

/**
 * 角色历史会话单次返回的条数 (任务单 §八 Q2: 建议 20, 与会话列表一致).
 */
const CHARACTER_SESSION_PAGE_SIZE = 20;

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

  /**
   * 角色详情 (引擎角色基线 `character_profiles` 的**单行**视图).
   *
   * 为什么与列表端点同表同口径 (任务单 D3):
   *   调试器要看的"角色" = **引擎实际注入的那份基线** = `character_profiles`.
   *   详情端点若查别的表 (如 `visitor_pool_templates` 速查卡表), 页面上的基线
   *   就与引擎真正注入的基线对不上 —— 那比 mock 更糟 (mock 至少明说是假的).
   *
   * 为什么必须带 `auditStatus`:
   *   审核态决定这个角色**引擎现在命不命中** (只有 `approved` 可被 resolver 命中).
   *   调试器看不到它 = 会把"角色根本没生效"误判成"角色效果不对".
   *
   * 5Ps 命名映射 (登记在 WP30 交付记录 §偏差 B3):
   *   DB 五名 (presenting / vulnerability / precipitating / maintaining / protective)
   *   → 前端五名 (presenting / predisposing / precipitating / perpetuating / protecting).
   *   依据是临床 5Ps 的标准对应: 易感 = predisposing, 维持 = perpetuating.
   *
   * @param slug 角色 slug (`template_id`)
   * @returns 角色详情
   */
  @Get('characters/:slug')
  async character(@Req() req: AdminDebugRequest, @Param('slug') slug: string) {
    const row = await this.characterRepo.findOne({
      where: { templateId: slug, deletedAt: IsNull() },
    });
    if (!row) {
      throw new BizException(BizCode.ResourceNotFound, '角色不存在');
    }

    const sessions = await this.findCharacterSessions(req, slug);
    return {
      slug: row.templateId,
      codename: row.displayName,
      attachmentStyle: row.attachmentStyle,
      baseline: {
        trust: row.baselineTrust,
        resist: row.baselineResistanceVerbal,
        valence: row.baselineEmotionValence,
        arousal: row.baselineEmotionArousal,
      },
      resistance: {
        verbal: row.baselineResistanceVerbal,
        depth: row.baselineResistanceDepth,
        style: row.baselineResistanceStyle,
      },
      enabled: row.enabled,
      auditStatus: row.auditStatus,
      fivePs: {
        presenting: row.fivePs?.presenting ?? '',
        predisposing: row.fivePs?.vulnerability ?? '',
        precipitating: row.fivePs?.precipitating ?? '',
        perpetuating: row.fivePs?.maintaining ?? '',
        protecting: row.fivePs?.protective ?? '',
      },
      expressionStyle: {
        speechVolumeBaseline: row.speechVolumeBaseline,
        narrativeStyle: row.narrativeStyle,
        expressionTone: row.expressionTone,
      },
      // 扫描窗口内命中该角色的场次数 (不是全量总数, 见 CHARACTER_SESSION_SCAN_LIMIT).
      sessionCount: sessions.length,
    };
  }

  /**
   * 该角色的最近 N 场会话.
   *
   * 为什么过滤要**在内存里做**:
   *   `training_sessions` **没有角色列** —— 角色只存在于 `turn_debug_trace` 的 JSON 里
   *   (留痕快照的 `characterSlug`). SQL 侧过滤一个 JSON 列里的嵌套字段既慢又不可移植,
   *   于是口径是"按时间倒序取一段 → 逐场读留痕 → 挑出角色匹配的那些".
   *
   * 为什么扫窗口有上限:
   *   见 CHARACTER_SESSION_SCAN_LIMIT 的说明 (内存过滤不能无界扫).
   *
   * @param req 请求 (身份用于学员隔离)
   * @param slug 角色 slug
   * @returns 最近 20 场会话摘要
   */
  @Get('characters/:slug/sessions')
  async characterSessions(@Req() req: AdminDebugRequest, @Param('slug') slug: string) {
    const sessions = await this.findCharacterSessions(req, slug);
    return sessions.slice(0, CHARACTER_SESSION_PAGE_SIZE).map((row) => {
      const traces = readTraces(row.turnDebugTrace);
      return {
        sessionId: row.id,
        visitorAlias: row.personaName,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSec: row.startedAt && row.endedAt ? Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000) : 0,
        status: row.status,
        totalTokens: sumTokens(traces),
      };
    });
  }

  /**
   * 本场剧本轨迹 (幕路径 + 已触发节点).
   *
   * 为什么返 `null` 而不是空数组:
   *   "这场根本没有剧本"与"有剧本但一个节点都没触发"是两件事 ——
   *   前者前端不渲染轨迹面板 (面板本身是剧本专属), 后者要渲染一个空面板.
   *   返 `null` 才能把两者分开; 返空数组会让"没有剧本"看起来像"剧本卡住了".
   *
   * @param req 请求 (身份用于学员隔离)
   * @param id 会话 id
   * @returns 轨迹视图; 本场无剧本 → null
   */
  @Get('sessions/:id/trajectory')
  async sessionTrajectory(@Req() req: AdminDebugRequest, @Param('id') id: string) {
    const session = await this.sessionRepo.findOne({
      where: { id, deletedAt: IsNull(), ...this.ownerFilter(req) },
    });
    if (!session) {
      throw new BizException(BizCode.ResourceNotFound, '会话不存在');
    }
    return buildAdminTrajectoryState(readTraces(session.turnDebugTrace));
  }

  /**
   * 本场记忆.
   *
   * 为什么现在恒返空数组 (任务单 D6 + §八 Q1 的答案):
   *   `training_sessions` **没有 memories 列** —— 逐字核过表结构 (2026-11-05):
   *   留痕在 `turn_debug_trace`, 逐字稿在 `transcript`, 技术统计在 `tech_stats`, 没有记忆列.
   *   而引擎的长时记忆落在 **Qdrant** (`qdrant-memory.store.ts`), 不是 MySQL ——
   *   它按 (学员, 角色) 作用域召回, **没有"按会话列全量"的口径**.
   *
   * 为什么不用引擎的 `MemoryStore` 端口凑一个:
   *   ① 端口只有 `remember` / `recall` —— `recall` 是**语义召回** (按查询取 top-k),
   *      不是"列出会话产生的所有记忆条目"; 拿它冒充"本场记忆"会给运维一个**看起来有、
   *      实际是另一回事**的接口.
   *   ② 把记忆存储接进 `AdminDebugModule` 会重现 WP58 刚解决的模块循环依赖.
   *   所以: 端点先立住 (前端契约稳定), 数据源等记忆落 MySQL 后再接 (登记缺口).
   *
   * @param req 请求 (身份用于学员隔离)
   * @param id 会话 id
   * @returns 记忆条目数组 (当前恒空)
   */
  @Get('sessions/:id/memories')
  async sessionMemories(@Req() req: AdminDebugRequest, @Param('id') id: string) {
    const session = await this.sessionRepo.findOne({
      where: { id, deletedAt: IsNull(), ...this.ownerFilter(req) },
    });
    if (!session) {
      throw new BizException(BizCode.ResourceNotFound, '会话不存在');
    }
    return [];
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
   * 找出一个角色在**扫描窗口内**的全部会话 (按时间倒序).
   *
   * 口径与 `GET /admin/api/sessions` 同源: 角色来自留痕快照的 `characterSlug`.
   * 两处共用这一个方法 —— 角色过滤口径只允许有一份, 两份实现迟早会漂.
   *
   * @param req 请求 (身份用于学员隔离)
   * @param slug 角色 slug
   * @returns 命中的会话行 (按 startedAt 倒序)
   */
  private async findCharacterSessions(req: AdminDebugRequest, slug: string) {
    const rows = await this.sessionRepo.find({
      where: { deletedAt: IsNull(), ...this.ownerFilter(req) },
      order: { startedAt: 'DESC' },
      take: CHARACTER_SESSION_SCAN_LIMIT,
      select: {
        id: true,
        personaName: true,
        startedAt: true,
        endedAt: true,
        status: true,
        turnDebugTrace: true,
      },
    });
    return rows.filter((row) => readTraces(row.turnDebugTrace).some((trace) => trace.characterSlug === slug));
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
