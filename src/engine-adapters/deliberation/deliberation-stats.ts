// V2026-11-07 治本 (影子模式数据统计面板 · 后端接口):
//   职责: 维护一个 Redis hash 计数器 —— 每轮审议写 trace 时**同步累加**,
//         统计接口直接读 hash (O(1)), **不扫全量 trace**.
//   边界: 纯适配层 (engine-adapters/), 不碰内核; 计数器里**只有数字**, 不是心理内容.
//
//   为什么不用"扫全量 trace"统计:
//     ① 性能: 扫 1000 条 trace = 1000 次 Redis 读; 计数器是 O(1);
//     ② 不阻塞: KEYS 在生产是阻塞命令, SCAN 也要分批;
//     ③ 简单: 读端点不用写聚合逻辑.
//
//   ⚠️ **一次 Lua 脚本做完所有累加** (计数器 + 取大字段):
//     计数用 HINCRBYFLOAT (Redis 侧原子); 但"取大"必须读-改-写 ——
//     两个审议并发收尾时, 后写的会把先写的覆盖掉 (**max 少算**, 而且**不报错**).
//     仓库纪律明令 disfavor 读-改-写 (RedisService.incrby 的注释就是范例).
//     而仓库**已有 EVAL 先例** (redis-bdi-state.repository.ts 的 CAS 脚本),
//     那个文件头写明了为什么走 getClient().eval() 而不是给 RedisService 加专用方法:
//     RedisService 是全仓共用基础设施, 为引擎加专用方法等于让基础设施认识业务;
//     getClient() 本来就是为 multi / pipeline / SCAN MATCH / EVAL 这类场景开的口子.
//
//   ⚠️ **统计写失败不影响审议** (影子模式不炸主流程):
//     累加逻辑的异常在 service 侧**单独 catch**, 只打 warn 日志 ——
//     trace 写成功 + 统计写失败 = 少几个计数, 不是会话失败.
//
//   ⚠️ **延迟直方图**: 任务单 §一 问的"P95 耗时多少"**计数器答不了**
//     (累加器只能算均值和极值) —— 所以额外记一组延迟桶, 从桶分布算分位数.
//     桶上界数组与桶字段名在**本文件**一处定义 (写入侧与读取侧共用), 避免两份真相.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/deliberation-stats.spec.ts 覆盖写侧增量 / 读侧聚合 / 边界
//     3. git diff --stat HEAD -- src/engine-core 为空 (本单不动内核)

import type { DeliberationTraceRecord } from './llm-deliberation.service.js';
import type { RedisService } from '../../shared/infra/redis/redis.service.js';

/**
 * 统计计数器的 key 前缀.
 *
 * ⚠️ 命名口径与 `DELIBERATION_TRACE_KEY_PREFIX` **同款** (仓库既有范式):
 *   trace 是 `deliberation_trace:{租户}:{会话}:{轮次}`, 统计是 `deliberation_stats:global`.
 *   统计**不做 tenant 隔离** (任务单 §七 4 —— 现在只有一个开发 tenant).
 */
export const DELIBERATION_STATS_KEY_PREFIX = 'deliberation_stats';

/** 统计计数器的 Redis key (全局一份). */
export function buildDeliberationStatsKey(): string {
  return `${DELIBERATION_STATS_KEY_PREFIX}:global`;
}

// ── 计数器字段名 (存储格式的**唯一定义处**) ───────────────────────────────

const FIELD_TOTAL_TURNS = 'total_turns';
const FIELD_SUCCESS_TURNS = 'success_turns';
const FIELD_FAILURE_TURNS = 'failure_turns';
const FIELD_TOTAL_DURATION_MS = 'total_duration_ms';
const FIELD_MAX_DURATION_MS = 'max_duration_ms';
const FIELD_STALE_TURNS = 'stale_turns';
const FIELD_TOTAL_RETRY_COUNT = 'total_retry_count';
const FIELD_TOTAL_PROMPT_TOKENS = 'total_prompt_tokens';
const FIELD_TOTAL_COMPLETION_TOKENS = 'total_completion_tokens';
const FIELD_SUM_DELTA_DIFF_ABS = 'sum_delta_diff_abs';
const FIELD_MAX_DELTA_DIFF_ABS = 'max_delta_diff_abs';
const FIELD_FLAGGED_TURNS = 'flagged_turns';

/** 被砍维度的计数字段前缀 (后面跟维度名). */
const FIELD_CAP_PREFIX = 'cap_';
/** 临床规则的计数字段前缀 (后面跟规则名). */
const FIELD_CLINICAL_PREFIX = 'clinical_';
/** 失败错误码的计数字段前缀 (后面跟错误码). */
const FIELD_ERROR_PREFIX = 'error_';

/**
 * 延迟桶的**上界** (毫秒).
 *
 * ⚠️ 桶 i 覆盖 [bounds[i-1], bounds[i]) (bounds[-1] 视为 0); 超过最大上界的
 *   归进**最后一个桶** (审议默认超时 3s, 超过 30s 已经是异常, 不再细分).
 *
 * 为什么要有桶: 任务单 §一 问的"P95 耗时多少"**计数器答不了** ——
 *   累加器只能算均值和极值, 分位数必须靠分布.
 */
export const DELIBERATION_LATENCY_BUCKET_BOUNDS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10_000, 30_000] as const;

/**
 * 一次原子累加的 Lua 脚本.
 *
 * ARGV 编排: [计数器对数, (字段, 增量) × n, 取大对数, (字段, 候选值) × m]
 *
 * ⚠️ 为什么用 HINCRBYFLOAT 而不是 HINCRBY:
 *   同一个脚本要同时累加整数计数 (轮次) 与浮点累计 (deltaDiff 绝对值之和) ——
 *   HINCRBYFLOAT 对整数增量照样存成整数形态 ("3" 而不是 "3.0"), 一条命令通吃.
 *
 * ⚠️ **脚本本身没有 CI 测试** (仓库没有真 Redis 测试基础设施 —— 无 ioredis-mock /
 *   无 testcontainers; BDI 的 CAS 脚本同样未测). 所以脚本写得**极简**: 无分支、
 *   无循环嵌套, 只有两段平铺循环. 单测覆盖的是**参数编排** (最常见的错法),
 *   Lua 语义建议部署前在 dev 环境跑一轮真 Redis 验证.
 */
export const DELIBERATION_STATS_LUA_SCRIPT = [
  'local key = KEYS[1]',
  'local i = 1',
  'local n = tonumber(ARGV[i])',
  'i = i + 1',
  'for _ = 1, n do',
  '  local field = ARGV[i]',
  '  local delta = ARGV[i + 1]',
  '  i = i + 2',
  "  redis.call('HINCRBYFLOAT', key, field, delta)",
  'end',
  'local m = tonumber(ARGV[i])',
  'i = i + 1',
  'for _ = 1, m do',
  '  local field = ARGV[i]',
  '  local value = tonumber(ARGV[i + 1])',
  '  i = i + 2',
  "  local current = redis.call('HGET', key, field)",
  '  if (current == false) or (tonumber(current) < value) then',
  "    redis.call('HSET', key, field, value)",
  '  end',
  'end',
  'return 1',
].join('\n');

/** 一轮审议对统计计数器产生的增量. */
export interface DeliberationStatsDeltas {
  /** 单调累加的计数器 (字段 → 增量). */
  readonly counters: Readonly<Record<string, number>>;
  /** 取大字段 (字段 → 候选值; 只有比现值大才覆盖). */
  readonly maxima: Readonly<Record<string, number>>;
}

/**
 * 把一轮审议的 trace 翻译成统计增量 (**纯函数**).
 *
 * ⚠️ **口径: 累加"记录里有的东西"** —— 成功轮次与失败轮次走**同一套**规则:
 *   durationMs / retryCount / tokenUsage 在失败记录里**同样有值**, 一并累加.
 *   (任务单 §4.3 的失败清单只列了三项, 漏了 retryCount 与 tokenUsage ——
 *    漏了会让"平均重试次数"和"平均 token"的分母与分子对不上.)
 *
 * ⚠️ **只有成功轮次才有** deltaDiff / capEntries / clinicalFlags 的语义
 *   (失败记录里它们是空壳) —— 所以这三个只在 ok=true 时累加.
 */
export function buildDeliberationStatsDeltas(record: DeliberationTraceRecord): DeliberationStatsDeltas {
  const counters: Record<string, number> = {};
  const maxima: Record<string, number> = {};

  addCounter(counters, FIELD_TOTAL_TURNS, 1);
  addCounter(counters, record.ok ? FIELD_SUCCESS_TURNS : FIELD_FAILURE_TURNS, 1);
  addCounter(counters, FIELD_TOTAL_DURATION_MS, record.durationMs);
  maxima[FIELD_MAX_DURATION_MS] = record.durationMs;
  // 延迟桶: **所有轮次都记** (成功 + 失败) —— 与 avgDurationMs 的分母 (总轮次) 同口径.
  addCounter(counters, latencyBucketField(record.durationMs), 1);
  addCounter(counters, FIELD_TOTAL_RETRY_COUNT, record.retryCount);
  if (record.tokenUsage) {
    addCounter(counters, FIELD_TOTAL_PROMPT_TOKENS, record.tokenUsage.promptTokens);
    addCounter(counters, FIELD_TOTAL_COMPLETION_TOKENS, record.tokenUsage.completionTokens);
  }

  if (!record.ok) {
    // 失败轮次: 记错误码分布 (答"失败的主要原因是什么").
    if (record.errorCode) addCounter(counters, `${FIELD_ERROR_PREFIX}${record.errorCode}`, 1);
    return { counters, maxima };
  }

  // 成功轮次: deltaDiff 的绝对值 (逐维求和 → 累计; 逐维求最大 → 取大).
  const diffAbs = Object.values(record.deltaDiff).map((value) => Math.abs(value));
  // 过期计数 (只有成功轮次才有"过期"这个概念 —— 失败轮次压根没产出结果).
  if (record.stale) addCounter(counters, FIELD_STALE_TURNS, 1);
  const sumAbs = diffAbs.reduce((sum, value) => sum + value, 0);
  addCounter(counters, FIELD_SUM_DELTA_DIFF_ABS, sumAbs);
  maxima[FIELD_MAX_DELTA_DIFF_ABS] = diffAbs.length > 0 ? Math.max(...diffAbs) : 0;
  for (const entry of record.capEntries) addCounter(counters, `${FIELD_CAP_PREFIX}${entry.dimension}`, 1);
  for (const flag of record.clinicalFlags) addCounter(counters, `${FIELD_CLINICAL_PREFIX}${flag.rule}`, 1);
  if (record.clinicalFlags.length > 0) addCounter(counters, FIELD_FLAGGED_TURNS, 1);

  return { counters, maxima };
}

/**
 * 把增量应用到 Redis 计数器 (**一次原子脚本, 一次往返**).
 *
 * ⚠️ 失败**往上抛** —— 由调用方 (审议 service) 决定怎么处理 (影子模式: 只打日志).
 */
export async function applyDeliberationStats(redis: RedisService, record: DeliberationTraceRecord): Promise<void> {
  const { counters, maxima } = buildDeliberationStatsDeltas(record);
  const counterEntries = Object.entries(counters);
  const maxEntries = Object.entries(maxima);
  if (counterEntries.length === 0 && maxEntries.length === 0) return;

  const args: (string | number)[] = [counterEntries.length];
  for (const [field, delta] of counterEntries) args.push(field, delta);
  args.push(maxEntries.length);
  for (const [field, value] of maxEntries) args.push(field, value);

  await redis.getClient().eval(DELIBERATION_STATS_LUA_SCRIPT, 1, buildDeliberationStatsKey(), ...args);
}

/** 统计接口的返回形状 (切灰度决策要看的那几个数). */
export interface DeliberationStatsResponse {
  /** 总轮次 (成功 + 失败). */
  readonly totalTurns: number;
  /** 成功轮次. */
  readonly successTurns: number;
  /** 失败轮次. */
  readonly failureTurns: number;
  /** 成功率 (0-1) = successTurns / totalTurns. */
  readonly successRate: number;
  /** 失败原因分布 (错误码 → 次数) —— 答"失败的主要原因是什么". */
  readonly failureByErrorCode: Record<string, number>;
  /** 平均耗时 (ms) = totalDurationMs / totalTurns (含失败轮次). */
  readonly avgDurationMs: number;
  /** 最大耗时 (ms) (精确值). */
  readonly maxDurationMs: number;
  /** P50 耗时 (ms) —— **桶上界估计** (桶内均匀分布假设). */
  readonly p50DurationMs: number;
  /** P95 耗时 (ms) —— **桶上界估计** (桶内均匀分布假设). */
  readonly p95DurationMs: number;
  /** 平均重试次数 = totalRetryCount / totalTurns. */
  readonly avgRetryCount: number;
  /** 平均 prompt tokens = totalPromptTokens / totalTurns. */
  readonly avgPromptTokens: number;
  /** 平均 completion tokens = totalCompletionTokens / totalTurns. */
  readonly avgCompletionTokens: number;
  /** deltaDiff 平均绝对值 = sumDeltaDiffAbs / **successTurns** (只有成功轮次有 deltaDiff). */
  readonly avgDeltaDiffAbs: number;
  /** deltaDiff 最大绝对值 (精确值). */
  readonly maxDeltaDiffAbs: number;
  /** 过期率 (0-1) = staleTurns / **successTurns** (只有成功轮次有"过期"这个概念). */
  readonly staleRate: number;
  /** 被砍维度分布 (维度 → 次数). */
  readonly capByDimension: Record<string, number>;
  /** 临床 flagged 分布 (规则 → 次数). */
  readonly clinicalByRule: Record<string, number>;
  /** 被 flag 的轮次占比 (0-1) = flaggedTurns / **successTurns**. */
  readonly flaggedTurnRate: number;
}

/**
 * 把 Redis hash 的原始字段聚合成接口形状 (**纯函数**).
 *
 * ⚠️ **空数据不崩**: 计数器一个字段都没有时, 全部返回 0 (**不返回 NaN**).
 *
 * ⚠️ **分母口径** (为什么有的除 successTurns, 有的除 totalTurns):
 *   · durationMs / retryCount / tokenUsage —— 失败轮次**也有**这些值 → 分母用总轮次;
 *   · deltaDiff / stale / clinical —— 只有成功轮次才有意义 → 分母用成功轮次.
 */
export function buildDeliberationStatsResponse(hash: Readonly<Record<string, string | undefined>>): DeliberationStatsResponse {
  const totalTurns = readCounter(hash, FIELD_TOTAL_TURNS);
  const successTurns = readCounter(hash, FIELD_SUCCESS_TURNS);
  const failureTurns = readCounter(hash, FIELD_FAILURE_TURNS);
  const totalDurationMs = readCounter(hash, FIELD_TOTAL_DURATION_MS);
  const totalRetryCount = readCounter(hash, FIELD_TOTAL_RETRY_COUNT);
  const totalPromptTokens = readCounter(hash, FIELD_TOTAL_PROMPT_TOKENS);
  const totalCompletionTokens = readCounter(hash, FIELD_TOTAL_COMPLETION_TOKENS);
  const sumDeltaDiffAbs = readCounter(hash, FIELD_SUM_DELTA_DIFF_ABS);
  const staleTurns = readCounter(hash, FIELD_STALE_TURNS);
  const flaggedTurns = readCounter(hash, FIELD_FLAGGED_TURNS);

  return {
    totalTurns,
    successTurns,
    failureTurns,
    successRate: ratio(successTurns, totalTurns),
    failureByErrorCode: readPrefixedCounters(hash, FIELD_ERROR_PREFIX),
    avgDurationMs: ratio(totalDurationMs, totalTurns),
    maxDurationMs: readCounter(hash, FIELD_MAX_DURATION_MS),
    p50DurationMs: readPercentile(hash, 0.5),
    p95DurationMs: readPercentile(hash, 0.95),
    avgRetryCount: ratio(totalRetryCount, totalTurns),
    avgPromptTokens: ratio(totalPromptTokens, totalTurns),
    avgCompletionTokens: ratio(totalCompletionTokens, totalTurns),
    avgDeltaDiffAbs: ratio(sumDeltaDiffAbs, successTurns),
    maxDeltaDiffAbs: readCounter(hash, FIELD_MAX_DELTA_DIFF_ABS),
    staleRate: ratio(staleTurns, successTurns),
    capByDimension: readPrefixedCounters(hash, FIELD_CAP_PREFIX),
    clinicalByRule: readPrefixedCounters(hash, FIELD_CLINICAL_PREFIX),
    flaggedTurnRate: ratio(flaggedTurns, successTurns),
  };
}

/** 累加一个计数器 (0 增量直接跳过 —— 不给 hash 造无意义的字段). */
function addCounter(target: Record<string, number>, field: string, delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  target[field] = (target[field] ?? 0) + delta;
}

/** 延迟落在哪个桶 (返回桶下标). */
function latencyBucketIndex(durationMs: number): number {
  const bounds = DELIBERATION_LATENCY_BUCKET_BOUNDS;
  for (let index = 0; index < bounds.length; index++) {
    if (durationMs < bounds[index]) return index;
  }
  return bounds.length - 1;
}

/** 延迟桶的计数字段名. */
function latencyBucketField(durationMs: number): string {
  return `latency_b${latencyBucketIndex(durationMs)}`;
}

/** 读一个计数器 (读不到 / 不是有限数 → 0). */
function readCounter(hash: Readonly<Record<string, string | undefined>>, field: string): number {
  const raw = hash[field];
  if (raw === undefined) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 读一组带前缀的计数器 (前缀后面的部分作为 key). */
function readPrefixedCounters(hash: Readonly<Record<string, string | undefined>>, prefix: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [field, raw] of Object.entries(hash)) {
    if (!field.startsWith(prefix)) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    result[field.slice(prefix.length)] = parsed;
  }
  return result;
}

/** 除法 (分母为 0 → 0, **不返回 NaN**). */
function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

/**
 * 从延迟桶分布算分位数 (**桶上界估计**).
 *
 * ⚠️ 桶内均匀分布的假设下, 返回命中桶的**上界** —— 对"会不会太慢"这类问题,
 *   偏保守 (报出来的数 ≥ 真实分位数), 不会把慢轮次报快.
 */
function readPercentile(hash: Readonly<Record<string, string | undefined>>, quantile: number): number {
  const total = readCounter(hash, FIELD_TOTAL_TURNS);
  if (total <= 0) return 0;
  const bounds = DELIBERATION_LATENCY_BUCKET_BOUNDS;
  const target = total * quantile;
  let cumulative = 0;
  for (let index = 0; index < bounds.length; index++) {
    cumulative += readCounter(hash, `latency_b${index}`);
    if (cumulative >= target) return bounds[index];
  }
  // 兜底: 全部轮次都落在最后一个桶 (桶计数没记全时也不会返回 undefined).
  return bounds.at(-1) ?? 0;
}
