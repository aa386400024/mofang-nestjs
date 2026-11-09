// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · admin 只读端点):
//   职责: 把闸门决策 (MySQL 真相源 + Redis 写时计数) 暴露给 admin 后台.
//   边界: 全部 GET, 无写操作; 不直接暴露 TypeORM 实体, 走视图对象.
//
//   端点:
//     GET /admin/api/gate/traces        — 闸门决策列表 (全维度筛选 + 分页)
//     GET /admin/api/gate/traces/:id    — 单条详情 (按 MySQL 自增 id)
//     GET /admin/api/gate/stats?days=N  — 按天聚合计数 (写时计数器, O(1) 读)
//
//   数据源 (双源口径, 任务单 §7 偏差 5):
//     · 列表 / 详情 → **MySQL** (`gate_decisions`, 真相源, 长期可查);
//     · 按天统计    → **Redis 日计数器** (`gate_stats:global:YYYY-MM-DD`, TTL 90 天).
//   为什么统计不查 MySQL: 看板要的是"最近 N 天的趋势", 写时计数器是 O(1) 读,
//     扫 MySQL 反而更慢; 而且计数器与列表是**两套口径** (计数器数"决策条数",
//     列表数"行数" —— 同一份数据, 但计数器按天预聚合, 列表按行查).
//
//   ⚠️ **会话 id 双口径**:
//     `sessionId` 参数**同时接受**引擎侧 session id 与落库 dbSessionId
//     (命中 session_id 或 db_session_id 任一列) —— 前端手上往往只有其中一个 id,
//     硬要前端"知道自己拿到的是哪种"没有意义, 后端认两种更稳.
//     `dbSessionId` 参数则**只**认落库 id (要精确查时用它).
//
//   ⚠️ **学员隔离**: 走 `buildOwnerFilter` 同款口径 (admin-scope.ts) ——
//     管理员 basic 凭据不过滤, 学员身份只看 `user_id = 自己`.
//     没有归属的行 (自动对练 / 无归属会话) 学员**看不到** (filter 是等值匹配, NULL 自然被排除).
//
//   ⚠️ **统计端点是全局口径** (写时计数器没有归属维度) —— 与仓库既有的
//     `GET /admin/api/deliberation/stats` 同款 (它也是全局的, 而 `/sessions` 是过滤的).
//
//   ⚠️ **详情端点不跨到审议 trace**: 不返回审议建议内容 (含心理内容, 越隐私红线).
//     本端点只返回闸门自身的字段 (枚举 / 数值 / 阈值 / 耗时).
//
//   鉴权: 中间件 `AdminBasicAuthMiddleware` (身份) + class 级 `AdminRoleGuard` (角色).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/wp26-admin-role-guard.spec.ts (路由清单含新端点)
//     3. test/admin-debug/gate-decisions.spec.ts (参数解析 / 视图映射 / 统计口径)
//
//   时间戳: 2026-11-09

import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, type Repository, type SelectQueryBuilder } from 'typeorm';

import type { AdminDebugRequest } from './admin-basic-auth.middleware.js';
import { buildOwnerFilter } from './admin-scope.js';
import { AdminRoleGuard } from './guards/admin-role.guard.js';
import { BizCode } from '../common/exceptions/biz-code.enum.js';
import { BizException } from '../common/exceptions/biz.exception.js';
import {
  buildGateStatsDateKeys,
  buildGateStatsDailyKey,
  buildGateStatsResponse,
  GATE_STATS_MAX_WINDOW_DAYS,
  type GateStatsResponse,
} from '../engine-adapters/deliberation-gate/gate-decision/gate-decision-stats.js';
import {
  parseGateTraceQuery,
  toGateTraceRecordView,
  type GateTraceFilters,
  type GateTraceQueryParams,
  type GateTraceRecordView,
} from '../engine-adapters/deliberation-gate/gate-decision/gate-decision-view.js';
import { GateDecisionEntity } from '../engine-adapters/deliberation-gate/gate-decision/gate-decision.entity.js';
import { RedisService } from '../shared/infra/redis/redis.service.js';

/**
 * 闸门决策列表的返回形状 (任务单 §3.2.1).
 */
export interface GateTraceListResponse {
  /** 命中总数 (筛选后). */
  readonly total: number;
  /** 当前页码. */
  readonly page: number;
  /** 每页条数. */
  readonly pageSize: number;
  /** 当前页的记录. */
  readonly items: readonly GateTraceRecordView[];
}

/**
 * 闸门决策只读端点 (列表 / 详情 / 按天统计).
 */
@Controller('admin/api/gate')
// 角色校验 (WP26 同款): 非 admin 角色 → 403.
@UseGuards(AdminRoleGuard)
export class GateTraceController {
  /**
   * @param repo gate_decisions 仓储 (只读这一张表)
   * @param redis Redis 门面 (只读日计数器)
   */
  constructor(
    @InjectRepository(GateDecisionEntity) private readonly repo: Repository<GateDecisionEntity>,
    private readonly redis: RedisService,
  ) {}

  /**
   * 闸门决策列表 (全维度筛选 + 分页).
   *
   * ⚠️ **查 MySQL, 不扫 Redis**: Redis 里是"每轮一个 key", 列全部只能 SCAN 全库
   *   (生产阻塞命令) —— 那是 WP-C 之前没有查询接口的根因, 不能重蹈.
   *
   * @param req 请求 (身份用于学员隔离)
   * @param query 查询参数
   * @returns 列表 (分页)
   */
  @Get('traces')
  async list(@Req() req: AdminDebugRequest, @Query() query: GateTraceQueryParams): Promise<GateTraceListResponse> {
    const filters = this.parseFilters(query);
    const builder = this.repo.createQueryBuilder('g');
    this.applyOwnerFilter(builder, req);

    const sessionId = filters.sessionId;
    if (sessionId !== undefined) {
      // 双口径: 引擎侧 session id **或** 落库 dbSessionId 命中即算 (前端手上往往只有一种).
      builder.andWhere(
        new Brackets((bracket) => {
          bracket.where('g.sessionId = :sessionId', { sessionId }).orWhere('g.dbSessionId = :sessionId', { sessionId });
        }),
      );
    }
    const dbSessionId = filters.dbSessionId;
    if (dbSessionId !== undefined) {
      builder.andWhere('g.dbSessionId = :dbSessionId', { dbSessionId });
    }
    const modes = filters.modes;
    if (modes !== undefined && modes.length > 0) {
      builder.andWhere('g.mode IN (:...modes)', { modes });
    }
    const reasons = filters.reasons;
    if (reasons !== undefined && reasons.length > 0) {
      builder.andWhere('g.reason IN (:...reasons)', { reasons });
    }
    const decision = filters.decision;
    if (decision !== undefined) {
      builder.andWhere('g.decision = :decision', { decision });
    }
    const startDay = filters.startDay;
    if (startDay !== undefined) {
      builder.andWhere('g.recordedDay >= :startDay', { startDay });
    }
    const endDay = filters.endDay;
    if (endDay !== undefined) {
      builder.andWhere('g.recordedDay <= :endDay', { endDay });
    }

    builder
      .orderBy('g.recordedAt', 'DESC')
      .addOrderBy('g.id', 'DESC')
      .skip((filters.page - 1) * filters.pageSize)
      .take(filters.pageSize);

    const [rows, total] = await builder.getManyAndCount();
    return {
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      items: rows.map((row) => toGateTraceRecordView(row)),
    };
  }

  /**
   * 单条详情 (按 MySQL 自增 id).
   *
   * ⚠️ **不跨到审议 trace** —— 不返回审议建议内容 (含心理内容, 越隐私红线).
   * ⚠️ **不存在 / 不属于该学员 → 404** (与 admin-debug 其余端点同款口径:
   *   返 403 等于告诉对方"这个 id 存在").
   *
   * @param req 请求 (身份用于学员隔离)
   * @param id 闸门决策 id
   * @returns 决策视图
   */
  @Get('traces/:id')
  async detail(@Req() req: AdminDebugRequest, @Param('id') id: string): Promise<GateTraceRecordView> {
    const recordId = parseRecordId(id);
    const builder = this.repo.createQueryBuilder('g');
    this.applyOwnerFilter(builder, req);
    builder.andWhere('g.id = :recordId', { recordId });

    const row = await builder.getOne();
    if (!row) {
      throw new BizException(BizCode.ResourceNotFound, '闸门决策记录不存在');
    }
    return toGateTraceRecordView(row);
  }

  /**
   * 按天聚合计数 (最近 N 天, 含今天).
   *
   * ⚠️ **读失败直接抛** —— 与 `/admin/api/deliberation/stats` 同款纪律:
   *   兜底成 0 会让看板显示"零决策零触发", 那是**误导**;
   *   看板宁可报错, 也不能装作一切正常.
   *
   * @param days 窗口天数 (缺省 7; 上限 90 = 日 key 保留期)
   * @returns 按天聚合
   */
  @Get('stats')
  async stats(@Query('days') days?: string | string[]): Promise<GateStatsResponse> {
    const span = parseStatsDays(days);
    const dates = buildGateStatsDateKeys(span, new Date());
    const hashes = await this.readDailyHashes(dates);
    return buildGateStatsResponse(dates, hashes);
  }

  /**
   * 批量读多个日 key (**一次 pipeline 往返**).
   *
   * @param dates 日期键列表
   * @returns 各日 key 的原始字段
   */
  private async readDailyHashes(dates: readonly string[]): Promise<Record<string, string>[]> {
    if (dates.length === 0) return [];
    const pipeline = this.redis.getClient().pipeline();
    for (const day of dates) pipeline.hgetall(buildGateStatsDailyKey(day));
    const results = await pipeline.exec();
    // ⚠️ ioredis 的 exec() 在 pipeline 被中断时返回 **null** —— 那不是"没有数据", 是"没读成".
    if (!results) throw new Error('闸门统计日 key 批量读取失败 (pipeline 返回空)');
    return results.map(([error, value]) => {
      if (error) throw error;
      return (value ?? {}) as Record<string, string>;
    });
  }

  /**
   * 学员隔离 (与 `/admin/api/sessions` 同款口径, 且只有一份实现).
   *
   * @param builder 查询构造器
   * @param req 请求
   */
  private applyOwnerFilter(builder: SelectQueryBuilder<GateDecisionEntity>, req: AdminDebugRequest): void {
    const owner = buildOwnerFilter(req);
    if (owner.userId === undefined) return;
    builder.andWhere('g.userId = :ownerUserId', { ownerUserId: owner.userId });
  }

  /**
   * 解析查询参数 (非法参数 → 400).
   *
   * ⚠️ **非法参数不静默兜底**: `mode=xxx` 被静默忽略的话, 看板显示的是"全部模式",
   *   而运营以为在看"只看 effect" —— 那比报错危险得多.
   *
   * @param query 查询参数
   * @returns 过滤条件
   */
  private parseFilters(query: GateTraceQueryParams): GateTraceFilters {
    try {
      return parseGateTraceQuery(query);
    } catch (error) {
      throw new BizException(BizCode.InvalidParameter, error instanceof Error ? error.message : '查询参数不合法');
    }
  }
}

/**
 * 解析统计窗口天数 (非法参数 → 400; 超上限 → 截断).
 *
 * ⚠️ **超上限截断而不是报错** (与 `/admin/api/deliberation/stats` 同款):
 *   日 key 只留 90 天, 再长的窗口**必然**没有数据 —— 截断即可, 实际生效的窗口
 *   会如实体现在响应里 (`dates` 数组长度), 看板自己看得出来.
 *
 * @param raw 原始参数
 * @returns 窗口天数
 */
function parseStatsDays(raw: string | string[] | undefined): number {
  const source = Array.isArray(raw) ? raw[0] : raw;
  const text = (source ?? '').trim();
  if (text.length === 0) return 7;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new BizException(BizCode.InvalidParameter, `days 参数不合法: "${text}" (要正整数)`);
  }
  return Math.min(parsed, GATE_STATS_MAX_WINDOW_DAYS);
}

/**
 * 解析闸门决策 id (非法 → 400).
 *
 * @param raw 原始参数
 * @returns 正整数 id
 */
function parseRecordId(raw: string): number {
  const text = (raw ?? '').trim();
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new BizException(BizCode.InvalidParameter, `闸门决策 id 不合法: "${text}"`);
  }
  return parsed;
}
