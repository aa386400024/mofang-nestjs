// V2026-11-07 治本 (影子模式数据统计面板 · 后端接口):
//   职责: 维护一个 Redis hash 计数器 —— 每轮审议写 trace 时**同步累加**,
//         统计接口直接读 hash (O(1)), **不扫全量 trace**.
//   边界: 纯适配层 (engine-adapters/), 不碰内核; 计数器里**只有数字**, 不是心理内容.
//
//   V2026-11-08 治本 (影子模式统计面板 · 时间窗口扩展):
//     切灰度前要看**最近 7 天**的趋势, 累计值看不出趋势 —— 于是:
//       ① 写入侧: 一次 Lua 脚本**同时**累加全局 key + 当日日 key (原子, 一次 RTT);
//       ② 读取侧: 接口加 `days` (最近 N 天) / `from`+`to` (自定义区间) 参数,
//          读 N 个日 key 聚合成窗口值; **不传参数仍返回全局累计值** (兼容现有前端).
//     ⚠️ **日 key 从 2026-11-08 才开始有** —— 更早的累计只在全局 key 里.
//       于是"最近 7 天"在头几天**天然少于 7 天数据**; 响应里的 `window.daysCovered`
//       就是为了让看板能如实显示"这 7 天里只有 N 天有数据", 而不是假装满窗.
//
//   为什么不用"扫全量 trace"统计:
//     ① 性能: 扫 1000 条 trace = 1000 次 Redis 读; 计数器是 O(1);
//     ② 不阻塞: KEYS 在生产是阻塞命令, SCAN 也要分批;
//     ③ 简单: 读端点不用写聚合逻辑.
//
//   ⚠️ **一次 Lua 脚本做完所有累加** (计数器 + 取大字段 + 两个 key):
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
//   ⚠️ **按天口径 = Asia/Shanghai (UTC+8)**:
//     不用服务器本地时区 (本地机 UTC+8 / 生产容器常是 UTC → 同一批数据落进不同的天),
//     不用 UTC (北京时间 08:00 前的轮次会被切到前一天). 详见 `shared/time/shanghai-date.ts`.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/deliberation-stats.spec.ts 覆盖写侧增量 / 读侧聚合 / 窗口 / 边界
//     3. test/admin-debug/deliberation-stats-redis.integration.spec.ts (真 Redis, 需 TEST_REDIS_URL)
//     4. git diff --stat HEAD -- src/engine-core 为空 (本单不动内核)

import { DELIBERATION_RISK_SKIP_ERROR_CODE } from './deliberation-types.js';
import type { DeliberationTraceRecord } from './llm-deliberation.service.js';
import type { RedisService } from '../../shared/infra/redis/redis.service.js';
import {
  DAY_MS,
  isShanghaiDateKey,
  shanghaiDateKey,
  shanghaiDateKeyRange,
  shanghaiDayStartUtc,
  shanghaiDayStartUtcOfKey,
} from '../../shared/time/shanghai-date.js';

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

/**
 * 当日统计计数器的 Redis key (`deliberation_stats:global:YYYY-MM-DD`).
 *
 * ⚠️ **日 key 是全局 key 的"子命名空间"**, 不用 hash tag: 任务单 §3.1 指定的形状,
 *   运营能用 `KEYS deliberation_stats:global:*` 直接捞出全部日 key.
 *   (单实例 Redis 下没有 cluster 的 CROSSSLOT 问题; 详见交付记录 §cluster 备注.)
 *
 * @param day 日期键 (`YYYY-MM-DD`, Asia/Shanghai)
 */
export function buildDeliberationStatsDailyKey(day: string): string {
  return `${buildDeliberationStatsKey()}:${day}`;
}

/**
 * 日 key 的保留时长 (90 天).
 *
 * 为什么是 90 天: 覆盖一个季度, 够看"最近三个月"的趋势; 再长只是把 Redis 的
 * 内存换成历史噪音 (统计 key 一个才几 KB, 但 key 数会线性涨).
 */
export const DELIBERATION_STATS_DAILY_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * 窗口查询的最大天数 (与日 key 的 TTL 对齐).
 *
 * ⚠️ 超过 90 天的窗口**必然**不完整 (日 key 已过期), 所以上限就是 90.
 */
export const DELIBERATION_STATS_MAX_WINDOW_DAYS = 90;

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
/**
 * 被**合规闸门**拦下 (高风险轮次) 的轮次数 (WP-A).
 *
 * ⚠️ **为什么单列**: 它不是"审议失败" (LLM 压根没跑, 没烧钱), 但它也不是成功.
 *   混进失败率会把"失败率"这条切灰度决策指标**污染** —— 看板必须能把它减掉.
 */
const FIELD_RISK_SKIPPED_TURNS = 'risk_skipped_turns';

/**
 * **取大**字段名 (聚合时取最大值, 不是求和).
 *
 * ⚠️ 这个名单是"求和 vs 取大"的**唯一定义处** —— 写入侧 (取大字段) 与读取侧
 *   (多日聚合) 都从这里取, 两边不允许各写一份.
 */
export const DELIBERATION_STATS_MAX_FIELDS: readonly string[] = [FIELD_MAX_DURATION_MS, FIELD_MAX_DELTA_DIFF_ABS];

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
 * 一次原子累加的 Lua 脚本 (**两个 key**: 全局累计 + 当日日 key).
 *
 * KEYS: [1] = 全局 key, [2] = 当日日 key
 *
 * ARGV 编排: [日 key TTL 秒数, 计数器对数, (字段, 增量) × n, 取大对数, (字段, 候选值) × m]
 *
 * ⚠️ 为什么用 HINCRBYFLOAT 而不是 HINCRBY:
 *   同一个脚本要同时累加整数计数 (轮次) 与浮点累计 (deltaDiff 绝对值之和) ——
 *   HINCRBYFLOAT 对整数增量照样存成整数形态 ("3" 而不是 "3.0"), 一条命令通吃.
 *
 * ⚠️ **脚本本身没有 CI 测试** (仓库没有真 Redis 测试基础设施 —— 无 ioredis-mock /
 *   无 testcontainers; BDI 的 CAS 脚本同样未测). 所以脚本写得**极简**: 无分支、
 *   无循环嵌套, 只有四段平铺循环. 单测覆盖的是**参数编排** (最常见的错法),
 *   Lua 语义由 `deliberation-stats-redis.integration.spec.ts`
 *   (真 Redis, 需 `TEST_REDIS_URL`) 兜底 —— 部署前在 dev 环境跑那一轮.
 */
export const DELIBERATION_STATS_LUA_SCRIPT = [
  'local globalKey = KEYS[1]',
  'local dailyKey = KEYS[2]',
  'local dailyTtl = tonumber(ARGV[1])',
  'local i = 2',
  'local counterCount = tonumber(ARGV[i])',
  'i = i + 1',
  'local counters = {}',
  'for _ = 1, counterCount do',
  '  local field = ARGV[i]',
  '  local delta = ARGV[i + 1]',
  '  i = i + 2',
  '  counters[#counters + 1] = { field, delta }',
  'end',
  'local maxCount = tonumber(ARGV[i])',
  'i = i + 1',
  'local maxima = {}',
  'for _ = 1, maxCount do',
  '  local field = ARGV[i]',
  '  local value = ARGV[i + 1]',
  '  i = i + 2',
  '  maxima[#maxima + 1] = { field, value }',
  'end',
  'for _, key in ipairs({ globalKey, dailyKey }) do',
  '  for _, pair in ipairs(counters) do',
  "    redis.call('HINCRBYFLOAT', key, pair[1], pair[2])",
  '  end',
  '  for _, pair in ipairs(maxima) do',
  "    local currentValue = tonumber(redis.call('HGET', key, pair[1]))",
  '    if (currentValue == nil) or (currentValue < tonumber(pair[2])) then',
  "      redis.call('HSET', key, pair[1], pair[2])",
  '    end',
  '  end',
  'end',
  "redis.call('EXPIRE', dailyKey, math.floor(dailyTtl))",
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
    // WP-A: 合规闸门拦下的轮次**单列** —— "压根没跑" 与 "跑了没成" 是两回事.
    //   ⚠️ 它**仍然计入 failureTurns** (与 circuit_open 同款口径: 有一条 trace 就是一轮),
    //     看板用 riskSkippedTurns 减掉它, 得到"真实失败数".
    if (record.errorCode === DELIBERATION_RISK_SKIP_ERROR_CODE) {
      addCounter(counters, FIELD_RISK_SKIPPED_TURNS, 1);
    }
    return { counters, maxima };
  }

  // 成功轮次: deltaDiff 的绝对值 (逐维求和 → 累计; 逐维取最大 → 取大).
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
 * 取某轮审议落进**哪一天**的日 key (Asia/Shanghai).
 *
 * ⚠️ **按"结束时间"算** (任务单 §5.1): 统计是在 `writeTrace()` 里写的, 那时审议
 *   已经跑完 —— 所以用的是**记录时间戳** (轮次结束时刻), 不是会话开始时刻.
 *   一场会话跨天 (23:50 → 00:10) → 整轮落进**结束那天**的日 key.
 *
 * ⚠️ 时间戳解析失败**不抛错**: 落进"当前这一天"的日 key, 宁可归得粗一点,
 *   也不能因为一个坏时间戳把整轮统计丢掉 (统计写失败 = 少几个计数).
 *
 * @param timestamp 轮次时间戳 (ISO 字符串 / 毫秒 / Date)
 * @param fallback 解析失败时的兜底时刻 (默认 = 现在)
 * @returns 日期键 (`YYYY-MM-DD`, Asia/Shanghai)
 */
export function resolveDeliberationStatsDay(timestamp: string | number | Date | undefined, fallback: Date = new Date()): string {
  if (timestamp === undefined) return shanghaiDateKey(fallback);
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return shanghaiDateKey(fallback);
  return shanghaiDateKey(date);
}

/**
 * 把增量应用到 Redis 计数器 (**一次原子脚本, 一次往返, 两个 key**).
 *
 * 写入的 key:
 *   ① `deliberation_stats:global`          —— 全局累计 (永久, 兼容现有接口)
 *   ② `deliberation_stats:global:YYYY-MM-DD` —— 当日日 key (TTL 90 天)
 *
 * ⚠️ 失败**往上抛** —— 由调用方 (审议 service) 决定怎么处理 (影子模式: 只打日志).
 */
export async function applyDeliberationStats(redis: RedisService, record: DeliberationTraceRecord): Promise<void> {
  const { counters, maxima } = buildDeliberationStatsDeltas(record);
  const counterEntries = Object.entries(counters);
  const maxEntries = Object.entries(maxima);
  if (counterEntries.length === 0 && maxEntries.length === 0) return;

  const args: (string | number)[] = [DELIBERATION_STATS_DAILY_TTL_SECONDS, counterEntries.length];
  for (const [field, delta] of counterEntries) args.push(field, delta);
  args.push(maxEntries.length);
  for (const [field, value] of maxEntries) args.push(field, value);

  const dailyKey = buildDeliberationStatsDailyKey(resolveDeliberationStatsDay(record.timestamp));
  await redis.getClient().eval(DELIBERATION_STATS_LUA_SCRIPT, 2, buildDeliberationStatsKey(), dailyKey, ...args);
}

/**
 * 列出**最近 N 天**的日期键 (升序, 含今天).
 *
 * ⚠️ 含今天: "最近 7 天" = 今天 + 前 6 天. 今天的数据是**不完整**的 (到此刻为止),
 *   但那正是运营此刻想看的.
 *
 * @param days 窗口天数 (≥ 1)
 * @param now 参考时刻 (决定窗口的末端)
 */
export function buildDeliberationStatsDateKeys(days: number, now: Date): string[] {
  const dateKeys: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    dateKeys.push(shanghaiDateKey(new Date(shanghaiDayStartUtc(now, back))));
  }
  return dateKeys;
}

/**
 * 列出**自定义区间** (闭区间) 的日期键 (升序).
 *
 * @param from 起始日 (`YYYY-MM-DD`, 含)
 * @param to 结束日 (`YYYY-MM-DD`, 含)
 */
export function buildDeliberationStatsDateKeysBetween(from: string, to: string): string[] {
  return shanghaiDateKeyRange(from, to);
}

/**
 * 日期键 → 日 key (Redis key).
 *
 * @param dateKeys 日期键 (升序)
 */
export function buildDeliberationStatsDayKeys(dateKeys: readonly string[]): string[] {
  return dateKeys.map((day) => buildDeliberationStatsDailyKey(day));
}

/**
 * 把多个日 key 的原始字段聚合成一份 (**纯函数**).
 *
 * ⚠️ **聚合口径** (与写入侧一一对应):
 *   · 计数器字段 (total_turns / total_duration_ms / latency_b* / error_* / cap_* / clinical_*)
 *     → **求和**;
 *   · 取大字段 (max_duration_ms / max_delta_diff_abs) → **取最大值**
 *     (求和会把"最慢的那轮"算成"所有轮次加起来", 语义就错了).
 *
 * ⚠️ **浮点求和会攒出小数尾巴** (0.1 + 0.2 = 0.30000000000000004) ——
 *   统一四舍五入到 6 位小数再存回去, 让"多天求和"与"一天直接累加"的结果一致.
 *
 * @param hashes 各日 key 的原始字段
 * @returns 聚合后的字段 (字段名 → 字符串数值)
 */
export function aggregateDeliberationStatsHashes(hashes: readonly Readonly<Record<string, string | undefined>>[]): Record<string, string> {
  const maxFields = new Set(DELIBERATION_STATS_MAX_FIELDS);
  const merged = new Map<string, number>();

  for (const hash of hashes) {
    for (const [field, raw] of Object.entries(hash)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const current = merged.get(field);
      if (current === undefined) {
        merged.set(field, value);
        continue;
      }
      merged.set(field, maxFields.has(field) ? Math.max(current, value) : current + value);
    }
  }

  const result: Record<string, string> = {};
  for (const [field, value] of merged) result[field] = formatStatsNumber(value);
  return result;
}

/** 统计接口的返回形状 (切灰度决策要看的那几个数). */
export interface DeliberationStatsResponse {
  /** 总轮次 (成功 + 失败). */
  readonly totalTurns: number;
  /** 成功轮次. */
  readonly successTurns: number;
  /** 失败轮次. */
  readonly failureTurns: number;
  /**
   * 被**合规闸门**拦下的轮次 (高风险轮次, 压根没跑 LLM 审议) (WP-A).
   *
   * ⚠️ 它**含在** `failureTurns` 里 (一条 trace = 一轮) —— 真实失败数 =
   *   `failureTurns - riskSkippedTurns`. 单列出来是为了让看板能减.
   */
  readonly riskSkippedTurns: number;
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
  /**
   * **统计窗口口径** (这批数是哪一段时间的).
   *
   * ⚠️ 为什么必须写在数据里 (仓库纪律: "口径要写在数据里, 不能只靠看文档的人记得"):
   *   · 不传 days → 全局累计值 (跟"最近 7 天"完全是两回事, 数值不可比);
   *   · 日 key 从 2026-11-08 才开始有 → "最近 7 天"在头几天**不满 7 天**;
   *     `daysCovered` 如实告诉看板"这 7 天里只有 N 天有数据".
   */
  readonly window: DeliberationStatsWindow;
}

/** 统计窗口的口径. */
export interface DeliberationStatsWindow {
  /** `all` = 全局累计 / `days` = 最近 N 天 / `range` = 自定义日期区间. */
  readonly mode: 'all' | 'days' | 'range';
  /** 窗口天数 (mode='days' 时有效; 已按 90 天上限截断). */
  readonly days: number | null;
  /** 窗口起始日 (Asia/Shanghai, `YYYY-MM-DD`). */
  readonly from: string | null;
  /** 窗口结束日 (Asia/Shanghai, `YYYY-MM-DD`). */
  readonly to: string | null;
  /** 窗口内**有日 key 的天数** (历史边界: 日 key 从 2026-11-08 才开始有). */
  readonly daysCovered: number | null;
}

/** 全局累计窗口 (不带 days 参数时的默认口径). */
export const DELIBERATION_STATS_ALL_WINDOW: DeliberationStatsWindow = {
  mode: 'all',
  days: null,
  from: null,
  to: null,
  daysCovered: null,
};

/**
 * 把 Redis hash 的原始字段聚合成接口形状 (**纯函数**).
 *
 * ⚠️ **空数据不崩**: 计数器一个字段都没有时, 全部返回 0 (**不返回 NaN**).
 *
 * ⚠️ **分母口径** (为什么有的除 successTurns, 有的除 totalTurns):
 *   · durationMs / retryCount / tokenUsage —— 失败轮次**也有**这些值 → 分母用总轮次;
 *   · deltaDiff / stale / clinical —— 只有成功轮次才有意义 → 分母用成功轮次.
 *
 * @param hash 原始字段
 * @param window 窗口口径 (缺省 = 全局累计)
 */
export function buildDeliberationStatsResponse(
  hash: Readonly<Record<string, string | undefined>>,
  window: DeliberationStatsWindow = DELIBERATION_STATS_ALL_WINDOW,
): DeliberationStatsResponse {
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
    riskSkippedTurns: readCounter(hash, FIELD_RISK_SKIPPED_TURNS),
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
    window,
  };
}

/** 窗口查询参数 (HTTP query). */
export interface DeliberationStatsWindowQuery {
  /** 最近 N 天 (含今天). */
  readonly days?: string;
  /** 自定义区间起始日 (`YYYY-MM-DD`, 含). */
  readonly from?: string;
  /** 自定义区间结束日 (`YYYY-MM-DD`, 含). */
  readonly to?: string;
}

/** 解析后的窗口请求. */
export type DeliberationStatsWindowRequest =
  | { readonly kind: 'all' }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'range'; readonly from: string; readonly to: string };

/**
 * 解析窗口查询参数 (**纯函数**; 非法参数抛 `Error`, 由 controller 转成 400).
 *
 * ⚠️ **不传参数 = 全局累计** (兼容现有前端与现有接口行为) —— 不是"默认 7 天".
 *   这两件事语义完全不同: 累计值是"影子模式开到现在", 窗口值是"最近 N 天".
 *   混在一起, 看板上的数字会**不可比** (切灰度决策就废了).
 *
 * ⚠️ **非法参数宁可报错也不静默兜底**: `days=abc` 如果静默退回全局累计,
 *   看板会把"全局累计"当成"最近 7 天"显示 —— 那比报错危险得多
 *   (仓库既有纪律: "看板宁可报错, 也不能装作一切正常").
 *
 * @param query 查询参数
 * @returns 窗口请求
 * @throws Error 参数非法 (message 是可直接展示给运营的中文)
 */
export function parseDeliberationStatsWindow(query: DeliberationStatsWindowQuery): DeliberationStatsWindowRequest {
  const days = query.days?.trim();
  const from = query.from?.trim();
  const to = query.to?.trim();

  if (days !== undefined && days !== '') {
    if (from !== undefined && from !== '') {
      throw new Error('days 与 from/to 不能同时传 (要么"最近 N 天", 要么自定义日期区间)');
    }
    const parsed = Number(days);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`days 参数不合法: "${days}" (要正整数)`);
    }
    const truncated = Math.trunc(parsed);
    if (truncated < 1) {
      throw new Error(`days 参数不合法: "${days}" (要正整数)`);
    }
    // 上限 = 日 key 的保留天数: 超过的部分**必然**没有数据, 截断而不是报错
    // (与同仓 `cost/trend?days=` 同款口径), 实际生效值会写进 `window.days`.
    return { kind: 'days', days: Math.min(truncated, DELIBERATION_STATS_MAX_WINDOW_DAYS) };
  }

  const hasFrom = from !== undefined && from !== '';
  const hasTo = to !== undefined && to !== '';
  if (!hasFrom && !hasTo) return { kind: 'all' };

  if (!hasFrom || !hasTo) {
    throw new Error('from 与 to 必须成对传 (自定义日期区间要两个端点)');
  }
  if (!isShanghaiDateKey(from) || !isShanghaiDateKey(to)) {
    throw new Error(`from/to 格式不合法: "${from}" / "${to}" (要 YYYY-MM-DD)`);
  }
  const start = shanghaiDayStartUtcOfKey(from).getTime();
  const end = shanghaiDayStartUtcOfKey(to).getTime();
  if (start > end) {
    throw new Error('from 不能晚于 to');
  }
  const span = Math.round((end - start) / DAY_MS) + 1;
  if (span > DELIBERATION_STATS_MAX_WINDOW_DAYS) {
    throw new Error(`日期区间最长 ${DELIBERATION_STATS_MAX_WINDOW_DAYS} 天 (当前 ${span} 天)`);
  }
  return { kind: 'range', from, to };
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

/**
 * 数值 → 存回 hash 的字符串 (整数就存整数, 浮点四舍五入到 6 位).
 *
 * ⚠️ 为什么不给浮点补零: Redis 里 `HINCRBYFLOAT` 对整数增量存的就是 "3" 而不是 "3.0" ——
 *   两边格式不一致的话, 同一份数据换个入口读出来长得不一样.
 */
function formatStatsNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}
