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
//   V2026-11-05 治本 (WP31 · 成本看板切真 API):
//     补 2 个只读端点 (admin-dashboard 的 CostBoard 页原先拿的是前端 mock):
//     GET /admin/api/cost/trend?days=7    — 成本趋势 (按天聚合: tokens / costCny / sessions)
//     GET /admin/api/cost/sessions?limit=20 — 会话成本列表 (含成本口径 costBasis)
//     定价走 WP24 已有的两个 env (LLM_PRICE_INPUT_PER_1K / LLM_PRICE_OUTPUT_PER_1K),
//     口径复用 `session-cost.ts` 的 `estimateSessionCost` —— 看板与单场成本日志
//     用**同一张定价表**, 不另造一份.
//     ⚠️ 成本数据来自**留痕快照**: 留痕关着时 (生产缺省关) 看板的 tokens / costCny
//     恒 0, 但 sessions 仍来自会话表 → "有场次但 0 token" 正是"留痕关了"的信号.
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
//
//   V2026-11-07 治本 (影子模式数据统计面板 · 后端接口):
//     GET /admin/api/deliberation/stats — 审议统计 (切灰度决策要看的那些数)
//     数据源是**一个 Redis hash 计数器** (`deliberation_stats:global`) —— 每轮审议
//     写 trace 时**同步累加**, 所以这里是 **O(1) 读**; **不扫全量 trace**
//     (扫 = N 次 Redis 读 + 一份聚合逻辑, KEYS 在生产还是阻塞命令).
//     ⚠️ 只出**聚合数字** —— 不含任何心理内容 (隐私红线 AGENTS.md §5.4).
//     ⚠️ Redis 读失败**不兜底成 0** —— 直接抛错. 兜底成 0 会让看板显示
//     "零失败零耗时", 那是**误导**; 看板宁可报错, 也不能装作一切正常.
//
//   V2026-11-08 治本 (影子模式统计面板 · 时间窗口扩展):
//     GET /admin/api/deliberation/stats[?days=7 | ?from=YYYY-MM-DD&to=YYYY-MM-DD]
//     切灰度前要看**最近 N 天**的趋势, 累计值看不出趋势.
//     · 不传窗口参数 → **全局累计值** (与改造前行为完全一致, 现有前端不受影响);
//     · 带窗口参数 → 读 N 个日 key 聚合成窗口值 (pipeline 批量读, 一次往返).
//     日 key: `deliberation_stats:global:YYYY-MM-DD` (Asia/Shanghai, TTL 90 天).

import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, type Repository } from 'typeorm';

import type { AdminDebugRequest } from './admin-basic-auth.middleware.js';
import { buildOwnerFilter } from './admin-scope.js';
import { resolveCostPricingFromEnv } from './cost-pricing.js';
import { aggregateSessionCost, buildCostTrend, shanghaiDayStartUtc } from './cost-view.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import type { TurnTrace } from './trace-recorder.service.js';
import { buildAdminTrajectoryState } from './trajectory-view.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import {
  aggregateDeliberationStatsHashes,
  buildDeliberationStatsDateKeys,
  buildDeliberationStatsDateKeysBetween,
  buildDeliberationStatsDayKeys,
  buildDeliberationStatsKey,
  buildDeliberationStatsResponse,
  parseDeliberationStatsWindow,
  type DeliberationStatsResponse,
  type DeliberationStatsWindow,
  type DeliberationStatsWindowQuery,
  type DeliberationStatsWindowRequest,
} from '../engine-adapters/deliberation/deliberation-stats.js';
import type { SessionCostPricing } from '../engine-adapters/observability/session-cost.js';
import { CharacterProfileEntity } from '../engine-adapters/wiring/character/character-profile.entity.js';
import { RedisService } from '../shared/infra/redis/redis.service.js';

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

/**
 * 成本趋势的默认窗口天数 (任务单 §八 Q2: 建议 7).
 */
const DEFAULT_COST_TREND_DAYS = 7;

/**
 * 成本趋势的最大窗口天数.
 *
 * 为什么有上限: 窗口越长, 要扫的会话越多 (窗口内的每一场都要读留痕 JSON).
 * 90 天已经覆盖一个季度 —— 再长对"看板"没有意义, 那是数据仓库的事.
 */
const MAX_COST_TREND_DAYS = 90;

/**
 * 成本趋势一次最多扫多少场会话.
 *
 * ⚠️ 这是**扫描窗口**, 不是"只看最近 N 场" —— 窗口内超出上限的会话不计入趋势.
 * 上限存在的原因是: 每场都要读 `turn_debug_trace` (JSON 列, 单场可能几 KB),
 * 无上限地扫 = 一个看板请求把库拖垮. 超限时按 startedAt 倒序取 (最近的优先),
 * 并在交付记录里登记这是"扫描窗口内的口径".
 */
const COST_TREND_SCAN_LIMIT = 2000;

/**
 * 会话成本列表默认条数.
 */
const DEFAULT_COST_SESSION_LIMIT = 20;

/**
 * 会话成本列表最大条数 (与既有 `GET /sessions` 的 50 上限同款).
 */
const MAX_COST_SESSION_LIMIT = 50;

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
    private readonly redis: RedisService,
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

  /**
   * 成本趋势 (按天聚合).
   *
   * 数据源: **留痕快照** (`turn_debug_trace[].llmUsage`) —— grep 核实过,
   *   `training_sessions.tech_stats` 里**没有** token 统计 (只有提问类型 /
   *   干预技术 / 行为指标 / 督导点评), 全仓唯一带 token 的地方就是留痕.
   *
   * ⚠️ **留痕关着的时候, 这个看板是空的** —— `ENGINE_DEBUG_TRACE_ENABLED` 在生产
   *   环境缺省关, 于是 `tokens` / `costCny` 恒 0. 但 `sessions` 仍来自会话表
   *   (它不受留痕开关影响) → 运营会看到 "有场次但 0 token", 那正是留痕关了的信号.
   *   要让生产看板有数, 得在 `tech_stats` 里补 token 统计 (缺口 G1).
   *
   * @param req 请求 (身份用于学员隔离)
   * @param days 窗口天数 (含今天; 缺省 7, 上限 90)
   * @returns 按天聚合的成本趋势 (行数恒等于 days, 缺数据的天补 0)
   */
  @Get('cost/trend')
  async costTrend(@Req() req: AdminDebugRequest, @Query('days') days?: string) {
    const span = clampInt(Number(days ?? DEFAULT_COST_TREND_DAYS), DEFAULT_COST_TREND_DAYS, 1, MAX_COST_TREND_DAYS);
    const now = new Date();
    // 窗口起点 = 上海时区"今天往前推 span-1 天"的 00:00.
    const cutoff = shanghaiDayStartUtc(now, span - 1);
    const rows = await this.sessionRepo.find({
      where: { deletedAt: IsNull(), startedAt: MoreThanOrEqual(cutoff), ...this.ownerFilter(req) },
      order: { startedAt: 'DESC' },
      take: COST_TREND_SCAN_LIMIT,
      select: { id: true, personaName: true, startedAt: true, status: true, turnDebugTrace: true },
    });
    return buildCostTrend(
      rows.map((row) => ({ startedAt: row.startedAt, traces: readTraces(row.turnDebugTrace) })),
      this.resolveCostPricing(),
      span,
      now,
    );
  }

  /**
   * 会话成本列表 (最近 N 场).
   *
   * 每行带 `costBasis` (成本口径):
   *   `full` = 输入输出都计; `output_only` = 上游没报输入侧用量, 成本是**下界**.
   *   不带这个字段的话, 读表的人会把"只算了输出侧"当成"全场就这么多" —— 与 WP24 的
   *   纪律同款: 口径要写在数据里, 不能只靠"看文档的人记得".
   *
   * @param req 请求 (身份用于学员隔离)
   * @param limit 条数 (缺省 20, 上限 50)
   * @returns 会话成本列表
   */
  @Get('cost/sessions')
  async sessionCosts(@Req() req: AdminDebugRequest, @Query('limit') limit?: string) {
    const n = clampInt(Number(limit ?? DEFAULT_COST_SESSION_LIMIT), DEFAULT_COST_SESSION_LIMIT, 1, MAX_COST_SESSION_LIMIT);
    const pricing = this.resolveCostPricing();
    const rows = await this.sessionRepo.find({
      where: { deletedAt: IsNull(), ...this.ownerFilter(req) },
      order: { startedAt: 'DESC' },
      take: n,
      select: { id: true, personaName: true, startedAt: true, turnDebugTrace: true },
    });
    return rows.map((row) => {
      const aggregate = aggregateSessionCost(readTraces(row.turnDebugTrace), pricing);
      return {
        sessionId: row.id,
        visitorAlias: row.personaName,
        startedAt: row.startedAt,
        totalTokens: aggregate.totalTokens,
        costCny: aggregate.costCny,
        costBasis: aggregate.costBasis,
      };
    });
  }

  /**
   * 审议统计 (影子模式指标看板的数据源).
   *
   * ⚠️ **O(1) 读** —— 数据来自**一个** Redis hash 计数器, 每轮审议写 trace 时同步累加
   *   (写入侧在 `LlmDeliberationService.writeTrace` 内); **不扫全量 trace**.
   *
   * ⚠️ **只出聚合数字** —— 计数器里只有计数 / 耗时 / token 数 / 维度名 / 规则名,
   *   没有一句原话 (隐私红线 AGENTS.md §5.4).
   *
   * ⚠️ **Redis 读失败不兜底成 0** —— 直接抛错 (全局过滤器 → 500).
   *   理由: 兜底成 0 会让看板显示"零失败零耗时", 那是**误导**;
   *   看板宁可报错, 也不能装出一份看起来正常、其实是空的数据.
   *
   * ⚠️ **时间窗口** (V2026-11-08): 切灰度前要看的是**最近 N 天**的趋势, 不是累计值.
   *   · `?days=7`     → 最近 7 天 (含今天) 的聚合;
   *   · `?from=&to=`  → 自定义日期区间 (闭区间, Asia/Shanghai);
   *   · **不传**        → **全局累计值** (兼容现有前端, 行为不变).
   *   窗口值与累计值语义完全不同, 所以响应里带 `window` 说明这批数是哪段时间的
   *   (含 `daysCovered` —— 日 key 从 2026-11-08 才有, 头几天的窗口天然不满窗).
   *
   * @param days 窗口天数 (含今天; 上限 90 天 = 日 key 保留期)
   * @param from 自定义区间起始日 (`YYYY-MM-DD`, 含)
   * @param to 自定义区间结束日 (`YYYY-MM-DD`, 含)
   * @returns 统计指标 (字段口径见 `DeliberationStatsResponse`)
   */
  @Get('deliberation/stats')
  async deliberationStats(
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<DeliberationStatsResponse> {
    const request = this.parseStatsWindow({ days, from, to });

    // 不带窗口参数 → 全局累计 (O(1) 读一个 key, 与改造前完全一致).
    if (request.kind === 'all') {
      const hash = await this.redis.hgetall(buildDeliberationStatsKey());
      return buildDeliberationStatsResponse(hash);
    }

    const now = new Date();
    const dateKeys =
      request.kind === 'days'
        ? buildDeliberationStatsDateKeys(request.days, now)
        : buildDeliberationStatsDateKeysBetween(request.from, request.to);
    const dayKeys = buildDeliberationStatsDayKeys(dateKeys);

    // ⚠️ **pipeline 批量读** —— 30 个日 key 就是 30 次往返, 批量读只 1 次.
    const hashes = await this.readDeliberationStatsHashes(dayKeys);
    const merged = aggregateDeliberationStatsHashes(hashes);
    const window: DeliberationStatsWindow = {
      mode: request.kind === 'days' ? 'days' : 'range',
      days: request.kind === 'days' ? request.days : null,
      from: dateKeys.at(0) ?? null,
      to: dateKeys.at(-1) ?? null,
      // 窗口内**有日 key 的天数** —— 日 key 从 2026-11-08 才有, 头几天不满窗.
      daysCovered: hashes.filter((hash) => Object.keys(hash).length > 0).length,
    };
    return buildDeliberationStatsResponse(merged, window);
  }

  /**
   * 解析统计窗口参数 (非法参数 → 400).
   *
   * ⚠️ **非法参数不静默兜底**: `days=abc` 静默退回"全局累计"的话, 看板会把
   *   累计值当"最近 7 天"显示 —— 那比报错危险得多 (看板宁可报错, 也不能装作正常).
   */
  private parseStatsWindow(query: DeliberationStatsWindowQuery): DeliberationStatsWindowRequest {
    try {
      return parseDeliberationStatsWindow(query);
    } catch (error) {
      throw new BizException(BizCode.InvalidParameter, error instanceof Error ? error.message : '统计窗口参数不合法');
    }
  }

  /**
   * 批量读多个日 key (**一次 pipeline 往返**).
   *
   * ⚠️ **读失败直接抛** —— 跟全局累计那条路径同款纪律: 不兜底成 0.
   */
  private async readDeliberationStatsHashes(dayKeys: readonly string[]): Promise<Record<string, string>[]> {
    if (dayKeys.length === 0) return [];
    const pipeline = this.redis.getClient().pipeline();
    for (const key of dayKeys) pipeline.hgetall(key);
    const results = await pipeline.exec();
    // ⚠️ ioredis 的 exec() 在 pipeline 被中断时返回 **null** —— 那不是"没有数据", 是"没读成".
    if (!results) throw new Error('统计日 key 批量读取失败 (pipeline 返回空)');
    return results.map(([error, value]) => {
      if (error) throw error;
      return (value ?? {}) as Record<string, string>;
    });
  }

  /**
   * 成本单价 (元 / 千 token).
   *
   * 走 **WP24 已有的两个 env** (`LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`)
   * —— 与单场成本日志用的是**同一张定价表**: 看板上的数与日志里的数必须对得上,
   * 两处各配一套 env = 迟早漂. 非法值回退默认, 不抛 (口径在 `resolveSessionCostPricing`).
   *
   * ⚠️ env 键 → 单价的映射收在 `cost-pricing.ts` —— 仪表盘 (`AdminInsightsController`)
   *   也读同一份, 两边不允许各写一份键名.
   *
   * @returns 单价
   */
  private resolveCostPricing(): SessionCostPricing {
    return resolveCostPricingFromEnv((key) => this.config.get<string>(key));
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
   * 口径与 `GET /admin/api/sessions` 同源, 且**只有一份实现** ——
   * 见 `admin-scope.ts` 的说明: 三处各写一份, 迟早漂成越权.
   *
   * @param req 请求
   * @returns where 片段 (空 = 不过滤)
   */
  private ownerFilter(req: AdminDebugRequest): { readonly userId?: string } {
    return buildOwnerFilter(req);
  }
}

/**
 * 把 query 参数夹到合法区间.
 *
 * 为什么不用 `Math.min(Number(x), max)` 就完事:
 *   `Number('abc')` = NaN → `Math.min(NaN, max)` = NaN → `take: NaN` 会让驱动层炸掉,
 *   `days: NaN` 会让"最近 N 天"变成 NaN 天. 非法参数必须**回退默认值**, 不能把 NaN
 *   传下去 (与仓库既有 `resolveSessionCostPricing` 的"非法值回退, 不抛"同纪律).
 *
 * @param raw 解析后的原始值
 * @param fallback 非法时的缺省值
 * @param min 下界
 * @param max 上界
 * @returns 夹好的整数
 */
function clampInt(raw: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
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
