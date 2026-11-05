// V2026-11-05 治本 (WP31 · 成本看板数据源):
//   职责: 把留痕快照 (`turn_debug_trace[].llmUsage`) 聚合成
//         ① 每场会话的 token / 成本 (含**成本口径**)
//         ② 按天的成本趋势 (tokens / costCny / sessions)
//   边界: 纯函数 + 纯数据; 零 @nestjs/* / typeorm / IO / 日志.
//         定价**由调用方注入** —— 本模块不读 env (与 WP24 `session-cost.ts` 同纪律).
//
//   为什么数据源是留痕 (而不是 `training_sessions.tech_stats`):
//     grep 核实 (`src/counselor/entities/training-session.entity.ts`): tech_stats 里
//     **没有 token 统计** (只有提问类型 / 干预技术 / 行为指标 / 督导点评).
//     全仓唯一带 token 的地方是留痕快照的 `llmUsage` —— 于是成本看板 = 留痕的聚合视图.
//
//   ⚠️ **留痕开关决定看板有没有数据**:
//     `ENGINE_DEBUG_TRACE_ENABLED` 在生产环境**缺省关** —— 于是生产的成本看板是空的.
//     这是设计如此 (留痕是调试能力, 不是生产监控), 不是 bug.
//     要让生产看板有数, 得在 `tech_stats` 里补 token 统计 —— 登记缺口 G1.
//
//   为什么**复用** WP24 的 `session-cost.ts` 而不是自己算一遍:
//     ① 定价只有一份 env (`LLM_PRICE_INPUT_PER_1K` / `LLM_PRICE_OUTPUT_PER_1K`);
//        两处各算一遍 = 两张会漂的定价表.
//     ② "输入侧不可得 → 成本口径落成 `output_only`" 这条纪律**自动成立** ——
//        本模块不自己判断口径, 直接调 `estimateSessionCost`.
//     ③ 取整口径 (6 位小数) 也只有一份 (`roundCost`).
//
//   时区口径 (登记在 WP31 交付记录 §偏差 B3):
//     "按天" 按 **Asia/Shanghai (UTC+8)** 分桶, 不用 UTC, 也不用服务器本地时区.
//     · 不用 UTC: 北京时间 08:00 之前开的场会被切到前一天, 运营看"今天"会觉得数字对不上.
//     · 不用服务器本地时区: 本地开发机 (UTC+8) 与生产容器 (常是 UTC) 的分桶边界不同
//       → 同一批数据在两个环境里落进不同的天, 不可比.
//     · 固定 UTC+8: 无 DST, 边界确定, 与运行环境无关.
//
//   验证: npx vitest run test/admin-debug/wp31-cost-board.spec.ts
//   时间戳: 2026-11-05 GMT+8

import type { TurnTrace } from './trace-recorder.service.js';
import {
  estimateSessionCost,
  roundCost,
  type SessionCostBasis,
  type SessionCostPricing,
  type SessionUsageTotals,
} from '../engine-adapters/observability/session-cost.js';

/**
 * 一场会话的用量与成本聚合结果.
 */
export interface SessionCostAggregate {
  /** 有 LLM 用量记录的轮数. */
  readonly turnCount: number;
  /** 输入 token 合计. */
  readonly promptTokens: number;
  /** 输出 token 合计. */
  readonly completionTokens: number;
  /** 思考 token 合计 (已含在输出侧里, 不重复计入 totalTokens). */
  readonly reasoningTokens: number;
  /** token 总量 (输入 + 输出; 与 `GET /admin/api/sessions` 的 `totalTokens` 同口径). */
  readonly totalTokens: number;
  /** 预估费用 (元). */
  readonly costCny: number;
  /** 成本口径 (`full` = 输入输出都计; `output_only` = 只含输出侧, 是下界). */
  readonly costBasis: SessionCostBasis;
}

/**
 * 成本看板的一行 (会话成本列表).
 */
export interface AdminSessionCost {
  readonly sessionId: string;
  readonly visitorAlias: string;
  readonly startedAt: Date | null;
  readonly totalTokens: number;
  readonly costCny: number;
  readonly costBasis: SessionCostBasis;
}

/**
 * 成本趋势的一行 (按天聚合).
 */
export interface AdminCostTrendPoint {
  /** 日期键 (`YYYY-MM-DD`, Asia/Shanghai). */
  readonly date: string;
  /** 当天 token 总量 (来自留痕; 留痕关时恒 0). */
  readonly tokens: number;
  /** 当天预估费用 (元). */
  readonly costCny: number;
  /** 当天启动的会话数 (**来自会话表**, 不受留痕开关影响). */
  readonly sessions: number;
}

/**
 * 趋势聚合的输入 (一场会话).
 */
export interface CostTrendSession {
  readonly startedAt: Date | null;
  readonly traces: readonly TurnTrace[];
}

/** Asia/Shanghai 的 UTC 偏移 (毫秒); 该时区无 DST, 固定偏移成立. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 一天的毫秒数. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 日期格式化器 (Asia/Shanghai → `YYYY-MM-DD`).
 *
 * 为什么用 `en-CA`: 这个 locale 的短日期格式**就是** `YYYY-MM-DD` (ISO 序),
 * 不用自己拼 `getFullYear()` + 补零 —— 那样在别的 locale 下就散了.
 * 用 `Intl` 而不是引 luxon: 仓库既有做法 (`home-micro-intervention-stats.service.ts`).
 */
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 取某时刻在 Asia/Shanghai 的日期键 (`YYYY-MM-DD`).
 *
 * @param date 时刻
 * @returns 日期键
 */
export function shanghaiDateKey(date: Date): string {
  return SHANGHAI_DATE_FORMATTER.format(date);
}

/**
 * 取 Asia/Shanghai 某天的 00:00 对应的 **UTC 时刻**.
 *
 * @param now 参考时刻 (取它的上海日期)
 * @param daysBack 往前推几天 (0 = 今天)
 * @returns UTC 时刻
 */
export function shanghaiDayStartUtc(now: Date, daysBack: number): Date {
  const [year, month, day] = shanghaiDateKey(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS - daysBack * DAY_MS);
}

/**
 * 聚合一**场**会话的用量与成本.
 *
 * @param traces 本场逐轮留痕快照
 * @param pricing 单价 (元 / 千 token)
 * @returns 用量 + 成本 + 口径
 */
export function aggregateSessionCost(traces: readonly TurnTrace[], pricing: SessionCostPricing): SessionCostAggregate {
  const usage = traces.reduce(
    (acc, trace) => {
      const llm = trace.llmUsage;
      // 留痕里没有这一轮 (老数据 / 没留痕) → 不计入, 也不补 0.
      if (!llm) return acc;
      return {
        turnCount: acc.turnCount + 1,
        promptTokens: acc.promptTokens + (llm.promptTokens ?? 0),
        completionTokens: acc.completionTokens + (llm.completionTokens ?? 0),
        reasoningTokens: acc.reasoningTokens + (llm.reasoningTokens ?? 0),
      };
    },
    { turnCount: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
  );

  const totals: SessionUsageTotals = {
    turnCount: usage.turnCount,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    // totalTokens = 输入 + 输出: 与 `GET /admin/api/sessions` 的 `totalTokens` 同口径
    // (思考 token 已含在输出侧, 不重复加 —— 既有 `sumTokens` 也是这么算的).
    totalTokens: usage.promptTokens + usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    // 输入侧可得的口径: 留痕契约里 `promptTokens` 是**必填数字** (上游没报时被填成 0),
    // 所以"整场 promptTokens 都是 0" = 上游没报输入侧 → 成本口径如实落成 `output_only`
    // (只是下界). 不拿 0 冒充"输入侧免费" —— 与 WP24 的同款纪律.
    promptTokensAvailable: usage.promptTokens > 0,
  };

  const cost = estimateSessionCost(totals, pricing);
  return {
    ...usage,
    totalTokens: totals.totalTokens,
    costCny: cost.estimatedCostCny,
    costBasis: cost.costBasis,
  };
}

/**
 * 构造成本趋势 (按天聚合).
 *
 * 为什么**补齐没有数据的天** (返回行数恒等于 `days`):
 *   趋势图要的是**连续时间轴** —— 缺一天就断一截, 看的人会以为那天没开张,
 *   而不是"那天没有会话". 补 0 是如实的 (0 场会话 → 0 token → 0 成本),
 *   不是编造.
 *
 * 为什么 `sessions` 来自会话表而 `tokens` / `costCny` 来自留痕:
 *   两者**来源不同, 口径必须分开**: 会话数是表里的事实 (留痕关也有),
 *   token / 成本是留痕里的事实 (留痕关就为 0).
 *   于是留痕关时会看到 "sessions > 0 但 tokens = 0" —— 那正是"留痕关了"的信号.
 *
 * @param sessions 窗口内的会话 (调用方按 startedAt 过滤好)
 * @param pricing 单价 (元 / 千 token)
 * @param days 窗口天数 (含今天)
 * @param now 参考时刻 (决定窗口的末端)
 * @returns 趋势点 (按日期升序, 行数 = days)
 */
export function buildCostTrend(
  sessions: readonly CostTrendSession[],
  pricing: SessionCostPricing,
  days: number,
  now: Date,
): AdminCostTrendPoint[] {
  const buckets = new Map<string, { tokens: number; costCny: number; sessions: number }>();

  // 先把窗口内的每一天建出来 (最老 → 最新), 缺数据的天补 0.
  for (let back = days - 1; back >= 0; back -= 1) {
    buckets.set(shanghaiDateKey(new Date(shanghaiDayStartUtc(now, back))), { tokens: 0, costCny: 0, sessions: 0 });
  }

  for (const session of sessions) {
    // 没有开场时刻的会话**无法落到某一天** —— 不硬塞进"今天", 也不编日期.
    if (!session.startedAt) continue;
    const bucket = buckets.get(shanghaiDateKey(session.startedAt));
    // 窗口外 (调用方已按 startedAt 过滤, 这里兜底).
    if (!bucket) continue;
    bucket.sessions += 1;
    const aggregate = aggregateSessionCost(session.traces, pricing);
    bucket.tokens += aggregate.totalTokens;
    bucket.costCny += aggregate.costCny;
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    tokens: bucket.tokens,
    costCny: roundCost(bucket.costCny),
    sessions: bucket.sessions,
  }));
}
