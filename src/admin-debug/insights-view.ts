// V2026-11-05 治本 (Admin Dashboard 剩余三页切真 API · 看板数据源):
//   职责: 把后端真值聚合成 admin-dashboard 三页要看的形状 ——
//         ① 仪表盘总览 (会话数 / token / 轮次 / 危机命中 / 成本)
//         ② 近 N 天会话趋势 (按天分桶)
//         ③ 全局记忆条目 (长时记忆, 来自 Qdrant payload)
//         ④ PsyGUARD 状态视图 (真实探活 + **诚实的"指标未采集"信号**)
//   边界: 纯函数 + 纯数据; 零 @nestjs/* / typeorm / IO / 日志.
//         定价**由调用方注入** —— 本模块不读 env (与 WP31 `cost-view.ts` 同纪律).
//
//   为什么开这个文件 (而不是把聚合塞进 controller):
//     ① controller 只做「取数 → 调聚合 → 返回」; 口径判定集中在纯函数里,
//        单测不用起 Nest 容器 (与 `cost-view.ts` / `trajectory-view.ts` 同款分层);
//     ② 仪表盘与成本看板**共用同一套按天分桶** (`shanghaiDateKey`), 不用各写一份.
//
//   时区口径 (与 WP31 逐字一致):
//     "按天" 按 **Asia/Shanghai (UTC+8)** 分桶 —— 不用 UTC (北京时间 08:00 前开的场
//     会被切到前一天), 不用服务器本地时区 (本地机 UTC+8 / 生产容器常是 UTC, 同一批
//     数据在两个环境落进不同的天, 不可比).
//
//   ⚠️ **留痕开关决定这些数字有没有值**:
//     `ENGINE_DEBUG_TRACE_ENABLED` 在生产环境缺省关 —— 于是 token / 轮次 / 危机命中
//     恒 0, 但"总会话数 / 今日会话数"来自会话表 (不受留痕开关影响).
//     于是运营会看到 "有场次但 0 token" —— 那正是"留痕关了"的信号, 不是 bug.
//
//   验证: npx vitest run test/admin-debug/admin-insights.spec.ts
//   时间戳: 2026-11-05 GMT+8

import { aggregateSessionCost, shanghaiDateKey, shanghaiDayStartUtc } from './cost-view.js';
import type { TurnTrace } from './trace-recorder.service.js';
import { roundCost, type SessionCostPricing } from '../engine-adapters/observability/session-cost.js';

/**
 * 仪表盘一次最多扫多少场会话.
 *
 * ⚠️ 这是**扫描窗口**, 不是"只看最近 N 场" —— 窗口内超出上限的会话不计入
 *   token / 轮次 / 成本聚合. 上限存在的原因是: 每场都要读 `turn_debug_trace`
 *   (JSON 列, 单场可能几 KB), 无上限地扫 = 一个看板请求把库拖垮.
 *   超限时按 startedAt 倒序取 (最近的优先).
 *   口径登记在交付记录 §偏差 B2 (与 WP31 的成本趋势窗口同款).
 */
export const DASHBOARD_SCAN_LIMIT = 2000;

/**
 * 近 N 天会话趋势的窗口天数.
 *
 * 缺省 7 天 (任务单 §2.1 明写"最近 7 天"); 不做成可配 —— 前端折线图固定 7 天,
 * 给一个永远没人改的 query 参数只是多一条会漂的口径.
 */
export const WEEKLY_SESSIONS_DAYS = 7;

/**
 * 全局记忆列表一次最多取多少条.
 *
 * 为什么封顶: `scroll` 是**无分页的全量取** —— 不封顶的话, 一个"什么都往同一个
 * topicKey 里塞"的来访者能把一次请求拖成全表扫描. 封顶后的失败方向是安全的:
 * 超出部分**不被返回** (少显示几条), 而不是把服务拖垮.
 *
 * ⚠️ 口径: 返回的是**长时记忆** (Qdrant). 工作记忆 / 短时记忆在进程内的会话级
 *   回落仓里 (内核 `MemoryStore` 端口只有 remember / recall, **没有 list-all**),
 *   端口层看不到 → 拿不到. 见交付记录 §偏差 B3.
 */
export const MEMORY_LIST_LIMIT = 500;

/**
 * PsyGUARD 趋势的窗口天数.
 */
export const PSYGUARD_TREND_DAYS = 7;

/**
 * 仪表盘聚合的输入 (一场会话).
 */
export interface DashboardSessionRow {
  /** 开场时刻 (可空 —— 没有开场时刻的会话落不进"某一天"). */
  readonly startedAt: Date | null;
  /** 本场逐轮留痕快照. */
  readonly traces: readonly TurnTrace[];
}

/**
 * 仪表盘总览的聚合结果.
 */
export interface DashboardAggregate {
  /** 总会话数 (全量 count, **不受扫描窗口限制**). */
  readonly totalSessions: number;
  /** 今日会话数 (Asia/Shanghai 口径: 今天 00:00 之后开场的). */
  readonly todaySessions: number;
  /** token 总量 (来自留痕; 留痕关时恒 0). */
  readonly totalTokens: number;
  /** 平均每会话轮次 (分母 = **有留痕的会话数**; 见函数说明). */
  readonly avgTurnsPerSession: number;
  /** 危机命中轮数 (留痕里 `crisis.detected` 为真的轮次). */
  readonly crisisHits: number;
  /** 预估费用 (元; 与成本看板同一张定价表). */
  readonly estimatedCostCny: number;
  /** 实际参与聚合的会话数 (= 扫描窗口内读到的行数). */
  readonly sessionsScanned: number;
  /** 扫描窗口是否**截断**了 (true = 还有更早的会话没算进来). */
  readonly truncated: boolean;
}

/**
 * 聚合仪表盘总览.
 *
 * 为什么"平均每会话轮次"的**分母是有留痕的会话数**, 不是总会话数:
 *   没留痕的会话 (留痕开关关着的那批) 轮次是 0 —— 但那是"**没有数据**",
 *   不是"这场对话就 0 轮". 拿它当分母, 平均轮次会被"没数据的场次"稀释,
 *   读的人会以为咨询师平均只聊了两轮. 分母只取**有留痕的场次**, 口径才成立.
 *
 * 为什么轮次取 `traces.length` 而不是 `aggregate.turnCount`:
 *   `turnCount` 只数"带 llmUsage 的轮次" (上游没报用量的轮次不算), 那是**计费口径**;
 *   面板要看的"这场聊了几轮"是**对话口径** —— 一轮没报用量的对话也是一轮.
 *
 * @param input 会话总数 / 今日数 / 窗口内的会话行 / 单价
 * @returns 总览聚合
 */
export function buildDashboardAggregate(input: {
  readonly totalSessions: number;
  readonly todaySessions: number;
  readonly rows: readonly DashboardSessionRow[];
  readonly pricing: SessionCostPricing;
}): DashboardAggregate {
  let totalTokens = 0;
  let costCny = 0;
  let totalTurns = 0;
  let sessionsWithTraces = 0;
  let crisisHits = 0;

  for (const row of input.rows) {
    const aggregate = aggregateSessionCost(row.traces, input.pricing);
    totalTokens += aggregate.totalTokens;
    costCny += aggregate.costCny;
    totalTurns += row.traces.length;
    if (row.traces.length > 0) sessionsWithTraces += 1;
    for (const trace of row.traces) {
      if (trace.crisis?.detected) crisisHits += 1;
    }
  }

  return {
    totalSessions: input.totalSessions,
    todaySessions: input.todaySessions,
    totalTokens,
    avgTurnsPerSession: sessionsWithTraces > 0 ? round2(totalTurns / sessionsWithTraces) : 0,
    crisisHits,
    estimatedCostCny: roundCost(costCny),
    sessionsScanned: input.rows.length,
    truncated: input.rows.length >= DASHBOARD_SCAN_LIMIT,
  };
}

/**
 * 近 N 天会话趋势 (按天分桶).
 *
 * 为什么**补齐没有数据的天** (返回行数恒等于 `days`):
 *   折线图要的是**连续时间轴** —— 缺一天就断一截, 看的人会以为那天没开张,
 *   而不是"那天没有会话". 补 0 是如实的 (0 场会话 → 0), 不是编造.
 *   与 WP31 成本趋势同一口径 (同一套 `shanghaiDateKey` 分桶).
 *
 * @param sessions 窗口内的会话 (调用方按 startedAt 过滤好)
 * @param days 窗口天数 (含今天)
 * @param now 参考时刻 (决定窗口的末端)
 * @returns 趋势点 (按日期升序, 行数 = days)
 */
export function buildWeeklySessions(
  sessions: readonly { readonly startedAt: Date | null }[],
  days: number,
  now: Date,
): { readonly date: string; readonly count: number }[] {
  const buckets = new Map<string, number>();

  for (let back = days - 1; back >= 0; back -= 1) {
    buckets.set(shanghaiDateKey(new Date(shanghaiDayStartUtc(now, back))), 0);
  }

  for (const session of sessions) {
    // 没有开场时刻的会话**无法落到某一天** —— 不硬塞进"今天", 也不编日期.
    if (!session.startedAt) continue;
    const key = shanghaiDateKey(session.startedAt);
    const bucket = buckets.get(key);
    // 窗口外 (调用方已按 startedAt 过滤, 这里兜底).
    if (bucket === undefined) continue;
    buckets.set(key, bucket + 1);
  }

  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

/**
 * 记忆分层 (内核口径).
 *
 * ⚠️ 内核 `MemoryTier` 的短时值是 `shortTerm` (驼峰), 这里**转成下划线** (`short_term`)
 *   —— 前端契约用下划线风格 (`long_term` / `short_term`), 与 `source` 字段同款.
 *   映射只有这一处 (`mapMemoryPoint`): 两份实现迟早漂.
 */
export type AdminMemoryTier = 'working' | 'short_term' | 'long_term';

/**
 * 记忆来源 (内核 `MemorySource` 口径: 这条记忆从哪来).
 */
export type AdminMemorySource = 'turn' | 'summary' | 'manual';

/**
 * admin 调试面的一条记忆条目 (面板视图).
 */
export interface AdminMemoryEntry {
  /** 条目 id (= Qdrant point id). */
  readonly id: string;
  /**
   * 归属作用域 (= 内核 `visitorId`).
   *
   * ⚠️ 它的形状是 `"{学员id}:{角色key}"` (见 `buildMemoryScope`) —— 是**归属键**,
   *   不是"来访者档案 id". 面板按它分组, 展示时别当成人类可读的名字.
   */
  readonly visitorId: string;
  /** 记忆正文 (心理内容). */
  readonly content: string;
  /** 记忆分层. */
  readonly tier: AdminMemoryTier;
  /** 记忆来源. */
  readonly source: AdminMemorySource;
  /** 重要度 [0,1]. */
  readonly importance: number;
  /** 来源会话 id (可空). */
  readonly sessionId?: string;
  /** 发生时刻 (ISO). */
  readonly createdAt: string;
  /** 被谁取代 (冲突消解标记; null = 仍是存活条目). */
  readonly supersededBy?: string;
}

/**
 * Qdrant point → 面板记忆条目.
 *
 * payload 形状由 `qdrant-memory.store.ts` 的 `toPayload` 决定 (那是**唯一**写侧真相):
 *   `{ tenantId, visitorId, sessionId, tier, source, content, importance,
 *      occurredAt, topicKey, supersededBy, expiresAt }`.
 *
 * 为什么要**逐字段校验**而不是直接透传 payload:
 *   payload 是 JSON 列, 里面可能有脏数据 / 老版本写法的字段. 校验不过就**跳过这条**
 *   (返 null), 而不是把半截数据端到面板上 —— 一条脏记忆不该让整页 500.
 *
 * @param point Qdrant 点 (id + payload)
 * @returns 面板条目; payload 不可用 → null
 */
export function mapMemoryPoint(point: { readonly id: string; readonly payload: Record<string, unknown> }): AdminMemoryEntry | null {
  const payload = point.payload ?? {};
  const content = readString(payload['content']);
  const visitorId = readString(payload['visitorId']);
  const tier = readTier(payload['tier']);
  const source = readSource(payload['source']);
  const importance = readNumber(payload['importance']);
  const occurredAt = readNumber(payload['occurredAt']);
  if (content === null || tier === null || source === null || importance === null || occurredAt === null) {
    return null;
  }
  const sessionId = readString(payload['sessionId']);
  const supersededBy = readString(payload['supersededBy']);
  return {
    id: point.id,
    visitorId: visitorId ?? '',
    content,
    tier,
    source,
    importance: Math.min(Math.max(importance, 0), 1),
    ...(sessionId ? { sessionId } : {}),
    createdAt: new Date(occurredAt).toISOString(),
    ...(supersededBy ? { supersededBy } : {}),
  };
}

/**
 * PsyGUARD 服务状态.
 */
export type AdminPsyGuardStatus = 'ok' | 'degraded' | 'down';

/**
 * PsyGUARD 探活结论 (来自 `PsyGuardHealthChecker.check()`).
 */
export interface PsyGuardHealthSnapshot {
  /** 服务可达. */
  readonly reachable: boolean;
  /** 模型已加载. */
  readonly modelLoaded: boolean;
  /** 11 类标签口径与内核一致. */
  readonly contractOk: boolean;
}

/**
 * PsyGUARD 监控面板的统计视图.
 */
export interface AdminPsyGuardStats {
  /** 综合状态: `ok` (可达 + 模型在 + 口径一致) / `degraded` (可达但有问题) / `down` (不可达). */
  readonly status: AdminPsyGuardStatus;
  /** 模型是否已加载 (真值: 探 `/health` 的 `model_loaded`). */
  readonly modelLoaded: boolean;
  /** 标签口径是否与内核一致 (真值: 启动自检同一份比对). */
  readonly contractOk: boolean;
  /**
   * **延迟 / 请求量指标是否已采集**.
   *
   * ⚠️ 当前恒 `false`: 后端**没有** PsyGUARD 的指标采集 (延迟直方图 / 计数器),
   *   全仓 grep 无 p50/p90/totalRequests 的采集点. 于是下面三个数**恒 0**,
   *   但那不是"调用了 0 次" —— 是"**没数**". 这个标志位就是那个区别.
   *   登记在交付记录 §缺口 G1 (真指标要另开单).
   */
  readonly metricsAvailable: boolean;
  /** p50 延迟 (ms); 指标未采集 → 0. */
  readonly p50Ms: number;
  /** p90 延迟 (ms); 指标未采集 → 0. */
  readonly p90Ms: number;
  /** 总请求数; 指标未采集 → 0. */
  readonly totalRequests: number;
  /** 各类别计数; 指标未采集 → 空. */
  readonly byCategory: Record<string, number>;
  /** 本次探活时刻 (ISO). */
  readonly checkedAt: string;
}

/**
 * 构 PsyGUARD 统计视图.
 *
 * 状态判定口径:
 *   · `ok`       = 可达 **且** 模型已加载 **且** 标签口径一致 —— 探测完全正常;
 *   · `degraded` = 可达, 但模型没加载**或**口径漂了 —— 服务在, 但**不能全信**
 *     (内核会过滤掉它不认识的类别, 于是"看起来在工作, 其实细节全丢");
 *   · `down`     = 不可达 —— 运行时回落本地规则.
 *
 * @param health 探活结论
 * @param checkedAt 探活时刻 (ISO)
 * @returns 统计视图
 */
export function buildPsyGuardStats(health: PsyGuardHealthSnapshot, checkedAt: string): AdminPsyGuardStats {
  // 状态判定拆成语句 (不写嵌套三元): 三档各有各的条件, 压进一个表达式里读起来要倒着读.
  let status: AdminPsyGuardStatus = 'degraded';
  if (!health.reachable) {
    status = 'down';
  } else if (health.modelLoaded && health.contractOk) {
    status = 'ok';
  }
  return {
    status,
    modelLoaded: health.modelLoaded,
    contractOk: health.contractOk,
    // 真值: 后端目前**没有**指标采集 (见类型注释里的缺口 G1).
    metricsAvailable: false,
    p50Ms: 0,
    p90Ms: 0,
    totalRequests: 0,
    byCategory: {},
    checkedAt,
  };
}

/**
 * PsyGUARD 趋势的一行.
 */
export interface AdminPsyGuardTrendPoint {
  /** 日期键 (`YYYY-MM-DD`, Asia/Shanghai). */
  readonly ts: string;
  /** p50 延迟 (ms). */
  readonly p50Ms: number;
  /** p90 延迟 (ms). */
  readonly p90Ms: number;
  /** 当天调用量. */
  readonly requests: number;
}

/**
 * PsyGUARD 趋势视图.
 */
export interface AdminPsyGuardTrend {
  /** 指标是否已采集 (当前恒 false —— 见 `AdminPsyGuardStats.metricsAvailable`). */
  readonly metricsAvailable: boolean;
  /** 趋势点 (按日期升序, 行数 = days). */
  readonly points: readonly AdminPsyGuardTrendPoint[];
}

/**
 * 构造 PsyGUARD 趋势 (按天分桶).
 *
 * ⚠️ 当前恒返回**全 0** 的 7 行 —— 因为后端没有指标采集 (缺口 G1).
 *   为什么**仍然返回 7 行**而不是空数组:
 *   空数组 = "这段时间没有调用", 那是在编造; 7 行 0 + `metricsAvailable: false`
 *   = "这段时间**没有数据**", 那是事实. 前端据此显示"指标未采集"而不是画一条
 *   贴着 0 的假曲线 (那条线看着像"服务很闲", 实际是"我们没在数").
 *
 * @param days 窗口天数 (含今天)
 * @param now 参考时刻
 * @returns 趋势视图
 */
export function buildPsyGuardTrend(days: number, now: Date): AdminPsyGuardTrend {
  const points: AdminPsyGuardTrendPoint[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    points.push({
      ts: shanghaiDateKey(new Date(shanghaiDayStartUtc(now, back))),
      p50Ms: 0,
      p90Ms: 0,
      requests: 0,
    });
  }
  return { metricsAvailable: false, points };
}

/**
 * 读字符串 (非空).
 */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 读数字 (有限).
 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 读记忆分层 (非法值 → null).
 */
function readTier(value: unknown): AdminMemoryTier | null {
  if (value === 'working') return 'working';
  if (value === 'shortTerm') return 'short_term';
  if (value === 'longTerm') return 'long_term';
  return null;
}

/**
 * 读记忆来源 (非法值 → null).
 */
function readSource(value: unknown): AdminMemorySource | null {
  if (value === 'turn') return 'turn';
  if (value === 'summary') return 'summary';
  if (value === 'manual') return 'manual';
  return null;
}

/**
 * 保留两位小数.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
