// V2026-11-05 治本 (Admin Dashboard 剩余三页切真 API · 洞察控制器):
//   职责: 给 admin-dashboard 的三个页面提供**真数据** ——
//         ① Dashboard 页      → GET /admin/api/dashboard
//                             → GET /admin/api/dashboard/weekly-sessions
//         ② MemoryBrowser 页  → GET /admin/api/memories
//         ③ PsyGuardMonitor 页→ GET /admin/api/psyguard
//                             → GET /admin/api/psyguard/trend
//   边界: 只做「取数 → 调聚合 → 包装返回」; 口径判定在 `insights-view.ts` (纯函数).
//
//   为什么**单独一个 controller** (而不是塞进 `AdminDebugController`):
//     `AdminDebugController` 是"会话 / 角色"两件事的只读面, 它的构造依赖只有
//     两个仓储 + 配置. 本控制器要多依赖一个**向量库** (`QdrantService`) ——
//     那是 `AIEngineModule` 的 provider. 塞进 `AdminDebugModule` 就得让
//     `AdminDebugModule` import `AIEngineModule`, 而 `AdminDebugModule` 恰恰是
//     被引擎装配层 import 的那一块 (为了 `TraceRecorder`) —— 依赖方向会变浑.
//     拆开: 洞察面自带模块 (`AdminInsightsModule`), 只依赖它真正要的三样东西.
//
//   鉴权 (与既有 admin 接口同款):
//     · 中间件 `AdminBasicAuthMiddleware` —— 判"这次请求是谁" (运维 basic / 学员 JWT);
//     · class 级 `@UseGuards(AdminRoleGuard)` —— 判"是不是管理员" (DB 真值 admin_role).
//     class 级挂一次 = 新增端点自动继承, 不会漏.
//
//   ⚠️ **心理内容出口** (`/memories`):
//     这个端点会把**所有来访者的长时记忆正文**吐给 admin. 它与既有的
//     `/admin/api/sessions/:id` (返完整逐字稿) 是**同一档**的内部调试能力,
//     不是新的暴露面 —— 但必须留在 admin 鉴权后面, 且永远不进普通日志.
//
//   反双胞胎:
//     - 不自己算成本: 复用 WP24 的 `resolveSessionCostPricing` / `estimateSessionCost`
//       (看板与成本日志同一张定价表).
//     - 不自己分桶: 复用 WP31 的 `shanghaiDateKey` (Asia/Shanghai 固定 UTC+8).
//     - 不自己探活: 复用 `PsyGuardHealthChecker` (引擎装配层同一个实例).
//     - 不编指标: PsyGUARD 的延迟 / 请求量后端**没有采集** → 如实标 `metricsAvailable: false`,
//       绝不拿 0 冒充"调用了 0 次" (见交付记录 §缺口 G1).
//
//   验证: npx vitest run test/admin-debug/admin-insights.spec.ts
//   时间戳: 2026-11-05 GMT+8

import { Controller, Get, Logger, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, type Repository } from 'typeorm';

import type { AdminDebugRequest } from './admin-basic-auth.middleware.js';
import { buildOwnerFilter } from './admin-scope.js';
import { resolveCostPricingFromEnv } from './cost-pricing.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import {
  buildDashboardAggregate,
  buildPsyGuardStats,
  buildPsyGuardTrend,
  buildWeeklySessions,
  DASHBOARD_SCAN_LIMIT,
  mapMemoryPoint,
  MEMORY_LIST_LIMIT,
  PSYGUARD_TREND_DAYS,
  WEEKLY_SESSIONS_DAYS,
  type AdminMemoryEntry,
} from './insights-view.js';
import type { TurnTrace } from './trace-recorder.service.js';
import { QdrantService } from '../ai-engine/providers/qdrant.service.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import type { SessionCostPricing } from '../engine-adapters/observability/session-cost.js';
import { VISITOR_LONG_MEMORY_COLLECTION } from '../engine-adapters/persistence/qdrant-memory.store.js';
import { PsyGuardHealthChecker } from '../engine-adapters/wiring/risk/psyguard-health.checker.js';
import { shanghaiDayStartUtc } from '../shared/time/shanghai-date.js';

@Controller('admin/api')
// 角色校验 (WP26 同款): 非 admin 角色 → 403 (BizCode.Forbidden).
@UseGuards(AdminRoleGuard)
export class AdminInsightsController {
  private readonly logger = new Logger(AdminInsightsController.name);

  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly qdrant: QdrantService,
    private readonly psyGuardHealth: PsyGuardHealthChecker,
    private readonly config: ConfigService,
  ) {}

  /**
   * 仪表盘总览.
   *
   * 口径分层 (**来源不同, 必须分开看**):
   *   · `totalSessions` / `todaySessions` → 来自**会话表** (`count`),
   *     不受留痕开关影响, 是**全量** (不受扫描窗口限制);
   *   · `totalTokens` / `avgTurnsPerSession` / `crisisHits` / `estimatedCostCny`
   *     → 来自**留痕快照**, 受 `DASHBOARD_SCAN_LIMIT` 扫描窗口约束.
   *   于是"有场次但 0 token" = **留痕关着** (生产缺省), 不是 bug.
   *
   * @param req 请求 (身份用于学员隔离)
   * @returns 总览统计
   */
  @Get('dashboard')
  async dashboard(@Req() req: AdminDebugRequest) {
    const now = new Date();
    const owner = buildOwnerFilter(req);
    const todayStart = shanghaiDayStartUtc(now, 0);

    const [totalSessions, todaySessions, rows] = await Promise.all([
      this.sessionRepo.count({ where: { deletedAt: IsNull(), ...owner } }),
      this.sessionRepo.count({ where: { deletedAt: IsNull(), startedAt: MoreThanOrEqual(todayStart), ...owner } }),
      this.sessionRepo.find({
        where: { deletedAt: IsNull(), ...owner },
        order: { startedAt: 'DESC' },
        take: DASHBOARD_SCAN_LIMIT,
        select: { startedAt: true, turnDebugTrace: true },
      }),
    ]);

    const aggregate = buildDashboardAggregate({
      totalSessions,
      todaySessions,
      rows: rows.map((row) => ({ startedAt: row.startedAt, traces: readTraces(row.turnDebugTrace) })),
      pricing: this.resolveCostPricing(),
    });

    return {
      ...aggregate,
      // PsyGUARD 子视图与 `/psyguard` 端点**同一份** (一份真相): 仪表盘上的
      // PsyGuard 卡片与监控页看到的东西必须一致, 不能各算各的.
      psyguard: await this.readPsyGuardStats(),
    };
  }

  /**
   * 近 7 天每天的会话数 (折线图).
   *
   * @param req 请求 (身份用于学员隔离)
   * @returns 趋势点 (行数恒等于 7, 没有会话的天补 0)
   */
  @Get('dashboard/weekly-sessions')
  async weeklySessions(@Req() req: AdminDebugRequest) {
    const now = new Date();
    // 窗口起点 = 上海时区"今天往前推 6 天"的 00:00.
    const cutoff = shanghaiDayStartUtc(now, WEEKLY_SESSIONS_DAYS - 1);
    const rows = await this.sessionRepo.find({
      where: { deletedAt: IsNull(), startedAt: MoreThanOrEqual(cutoff), ...buildOwnerFilter(req) },
      select: { startedAt: true },
    });
    return buildWeeklySessions(rows, WEEKLY_SESSIONS_DAYS, now);
  }

  /**
   * 全局记忆列表 (长时记忆).
   *
   * ⚠️ **口径 (必须让读的人看见)**:
   *   · 数据源是 **Qdrant** (`visitor_long_memory` collection) —— 即**长时记忆**;
   *   · 工作记忆 / 短时记忆落在进程内的会话级回落仓 (内核 `MemoryStore` 端口只有
   *     `remember` / `recall`, **没有 list-all**), 端口层看不到 → **拿不到**;
   *   · 所以 `scope` 恒为 `long_term` —— 面板别把它当"全部记忆".
   *   · `source: 'unavailable'` 表示**向量库读不到** (没配 / 不可达 / collection 不存在),
   *     与"读到了但 0 条"是**两件事** —— 前端据此显示不同的空态.
   *
   * @returns 记忆条目 + 口径标志
   */
  @Get('memories')
  async memories() {
    try {
      const points = await this.qdrant.scroll(VISITOR_LONG_MEMORY_COLLECTION, {}, MEMORY_LIST_LIMIT);
      const entries: AdminMemoryEntry[] = [];
      for (const point of points) {
        // payload 损坏的条目跳过 (脏数据不该让整页 500) —— 映射口径在 `insights-view.ts`.
        const entry = mapMemoryPoint(point);
        if (entry) entries.push(entry);
      }
      return {
        entries,
        scope: 'long_term' as const,
        source: 'qdrant' as const,
        total: entries.length,
        limit: MEMORY_LIST_LIMIT,
      };
    } catch (error) {
      // 向量库读不到 → 如实说"读不到", **不返空数组冒充"没有记忆"**.
      // 日志只出定位信息 (错误类型名), 不打 payload (心理内容).
      this.logger.warn(`[admin_insights] 记忆库读取失败, 返回 unavailable: ${errorName(error)}`);
      return {
        entries: [] as AdminMemoryEntry[],
        scope: 'long_term' as const,
        source: 'unavailable' as const,
        total: 0,
        limit: MEMORY_LIST_LIMIT,
      };
    }
  }

  /**
   * PsyGUARD 状态.
   *
   * 真值来自**实时探活** (`{baseUrl}/health`): 可达性 / 模型是否加载 / 标签口径是否一致.
   * ⚠️ 延迟 (p50/p90) / 请求数 / 类别计数后端**没有采集** → 恒 0, 并用
   *   `metricsAvailable: false` 明说"是没数, 不是 0 次" (交付记录 §缺口 G1).
   *
   * @returns PsyGUARD 状态视图
   */
  @Get('psyguard')
  async psyguard() {
    return this.readPsyGuardStats();
  }

  /**
   * PsyGUARD 近 7 天调用量趋势.
   *
   * ⚠️ 与 `/psyguard` 同源同口径: 指标未采集 → 7 行 0 + `metricsAvailable: false`.
   *
   * @returns 趋势视图
   */
  @Get('psyguard/trend')
  psyguardTrend() {
    return buildPsyGuardTrend(PSYGUARD_TREND_DAYS, new Date());
  }

  /**
   * 探一次 PsyGUARD → 状态视图.
   *
   * 为什么**每次请求都探**: 面板要看的是"现在"的状态; 启动期自检那份结论是
   * **几小时前**的 (进程启动那一刻), 拿它当现状就是拿旧数据说新话.
   * 探活代价是一次 HTTP (超时 3s, 见 `PSYGUARD_HEALTH_TIMEOUT_MS`).
   *
   * @returns 状态视图
   */
  private async readPsyGuardStats() {
    const health = await this.psyGuardHealth.check();
    return buildPsyGuardStats(health, new Date().toISOString());
  }

  /**
   * 成本单价 (元 / 千 token) —— 走 WP24 已有的两个 env, 与成本看板同一张表.
   *
   * @returns 单价
   */
  private resolveCostPricing(): SessionCostPricing {
    return resolveCostPricingFromEnv((key) => this.config.get<string>(key));
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
 * 错误类型名 (不取 message —— 隐私红线: 报错文案可能带内容片段).
 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
