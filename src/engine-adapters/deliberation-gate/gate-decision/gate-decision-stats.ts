// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · 按天预聚合计数):
//   职责: 写时把闸门决策累加进**日 key** (Lua 原子); 读侧一天一个 key, N 天一次 pipeline.
//   边界: 纯适配层 (engine-adapters/), 不碰内核; 计数器里**只有数字**.
//
//   为什么用写时计数器 (而不是"扫全量 trace 再聚合"):
//     ① 性能: 扫 1000 条 trace = 1000 次读; 计数器是 O(1) (一天一个 key);
//     ② 不阻塞: KEYS 在生产是阻塞命令, SCAN 也要分批;
//     ③ 闸门决策是"每轮 1~2 条"的量级, 按天聚合正是看板的标准形态.
//
//   ⚠️ **口径**: 同一个会话同一轮可能有 **两条** trace (shadow + effect 各自判一次)
//     —— 这里的计数是"闸门**决策条数**", 不是"审议轮次数".
//     要"触发了多少轮审议", 请按 mode=effect 过滤, 或按 (session_id, turn_index) 去重.
//     (任务单 §7 偏差 2 的同款登记; 看板画趋势图不受影响.)
//
//   ⚠️ **按天口径 = Asia/Shanghai (UTC+8)**: 复用 shared/time/shanghai-date.ts, 不另造日历.
//
//   ⚠️ **为什么一次 Lua 脚本做完所有累加** (同 deliberation-stats.ts 的理由):
//     计数用 HINCRBY (Redis 侧原子); 多个 key / 多个字段若拆成多条命令,
//     并发收尾时会出现"总数加了、分桶没加"的半截状态 —— 看板会看到互相矛盾的数字.
//     仓库既有先例: 审议统计 (DELIBERATION_STATS_LUA_SCRIPT) 与 BDI 状态仓储的 CAS 脚本.
//
//   ⚠️ **EVAL 的 KEYS 会被 ioredis 自动加 keyPrefix** —— 所以脚本里用**逻辑 key**即可
//     (与 deliberation-stats.ts 同款: 走 getClient().eval(), 不给 RedisService 加专用方法 ——
//      RedisService 是全仓共用基础设施, 为引擎加专用方法等于让基础设施认识业务).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/gate-decisions.spec.ts 覆盖参数解析 / 聚合 / 视图口径
//
//   时间戳: 2026-11-09

import type { RedisService } from '../../../shared/infra/redis/redis.service.js';
import { shanghaiDateKey, shanghaiDayStartUtc } from '../../../shared/time/shanghai-date.js';
import { GATE_REASON_VALUES, type GateDecision, type GateMode, type GateReason } from '../deliberation-gate.types.js';

/**
 * 闸门统计计数器的 key 前缀.
 *
 * ⚠️ 形状由任务单指定: `gate_stats:global:{YYYY-MM-DD}` —— 运维按前缀扫 key 的习惯不用改.
 */
export const GATE_STATS_KEY_PREFIX = 'gate_stats';

/**
 * 闸门统计计数器的 Redis key 前缀 (全局段).
 */
export function buildGateStatsKey(): string {
  return `${GATE_STATS_KEY_PREFIX}:global`;
}

/**
 * 当日统计计数器的 Redis key (`gate_stats:global:YYYY-MM-DD`).
 *
 * @param day 日期键 (`YYYY-MM-DD`, Asia/Shanghai)
 * @returns 日 key
 */
export function buildGateStatsDailyKey(day: string): string {
  return `${buildGateStatsKey()}:${day}`;
}

/**
 * 日 key 的保留时长 (90 天).
 *
 * 为什么是 90 天: 覆盖一个季度, 够看"最近三个月"的闸门行为; 再长只是把内存换成历史噪音.
 */
export const GATE_STATS_DAILY_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * 窗口查询的最大天数 (与日 key 的 TTL 对齐).
 *
 * ⚠️ 超过 90 天的窗口**必然**不完整 (日 key 已过期) —— 上限就是 90.
 */
export const GATE_STATS_MAX_WINDOW_DAYS = 90;

// ── 计数器字段名 (存储格式的**唯一定义处**) ─────────────────────────────────

/** 总决策数. */
const FIELD_TOTAL = 'total';
/** 决策分桶前缀 (后面跟 run / skip). */
const FIELD_DECISION_PREFIX = 'decision:';
/** 理由分桶前缀 (后面跟 reason 枚举值). */
const FIELD_REASON_PREFIX = 'reason:';
/** 模式分桶前缀 (后面跟 shadow / effect). */
const FIELD_MODE_PREFIX = 'mode:';

/**
 * 一次原子累加的 Lua 脚本 (**一个 key**: 当日日 key).
 *
 * KEYS: [1] = 当日日 key
 *
 * ARGV: [1] TTL 秒数, [2] 决策字段名, [3] 理由字段名, [4] 模式字段名
 *
 * ⚠️ 脚本写得**极简** (无分支 / 无嵌套循环): 仓库没有真 Redis 测试基础设施
 *   (无 ioredis-mock / 无 testcontainers), 所以单测覆盖的是**参数编排**,
 *   Lua 语义靠 dev 环境手工核对 —— 简单的脚本比"聪明"的脚本更不容易错.
 */
export const GATE_STATS_LUA_SCRIPT = [
  'local key = KEYS[1]',
  'local ttl = tonumber(ARGV[1])',
  `redis.call('HINCRBY', key, '${FIELD_TOTAL}', 1)`,
  "redis.call('HINCRBY', key, ARGV[2], 1)",
  "redis.call('HINCRBY', key, ARGV[3], 1)",
  "redis.call('HINCRBY', key, ARGV[4], 1)",
  "redis.call('EXPIRE', key, math.floor(ttl))",
  'return 1',
].join('\n');

/**
 * 一条闸门决策对统计计数器产生的那几个增量 (纯数据).
 */
export interface GateStatsInput {
  /** 跑 / 不跑. */
  readonly decision: GateDecision;
  /** 决策理由. */
  readonly reason: GateReason;
  /** 模式. */
  readonly mode: GateMode;
  /** 落库时刻 (毫秒时间戳). */
  readonly recordedAt: number;
}

/**
 * 取某条决策落进**哪一天**的日 key (Asia/Shanghai).
 *
 * ⚠️ 时间戳解析失败**不抛错**: 落进"当前这一天", 宁可归得粗一点,
 *   也不能因为一个坏时间戳把整条统计丢掉 (统计写失败 = 少几个计数).
 *
 * @param recordedAt 落库时刻 (毫秒)
 * @param fallback 解析失败时的兜底时刻 (缺省 = 现在)
 * @returns 日期键 (`YYYY-MM-DD`)
 */
export function resolveGateStatsDay(recordedAt: number | undefined, fallback: Date = new Date()): string {
  if (recordedAt === undefined) return shanghaiDateKey(fallback);
  const date = new Date(recordedAt);
  if (!Number.isFinite(date.getTime())) return shanghaiDateKey(fallback);
  return shanghaiDateKey(date);
}

/**
 * 把一条决策累加进当日计数器 (**一次原子脚本, 一次往返**).
 *
 * ⚠️ 失败**往上抛** —— 由调用方 (trace 写入器) 决定怎么处理 (只打 warn, 不炸会话).
 *
 * @param redis Redis 门面
 * @param record 决策记录
 */
export async function applyGateStats(redis: RedisService, record: GateStatsInput): Promise<void> {
  const day = resolveGateStatsDay(record.recordedAt);
  await redis
    .getClient()
    .eval(
      GATE_STATS_LUA_SCRIPT,
      1,
      buildGateStatsDailyKey(day),
      GATE_STATS_DAILY_TTL_SECONDS,
      `${FIELD_DECISION_PREFIX}${record.decision}`,
      `${FIELD_REASON_PREFIX}${record.reason}`,
      `${FIELD_MODE_PREFIX}${record.mode}`,
    );
}

/**
 * 列出**最近 N 天**的日期键 (升序, 含今天).
 *
 * @param days 窗口天数 (≥ 1)
 * @param now 参考时刻 (决定窗口的末端)
 * @returns 日期键列表
 */
export function buildGateStatsDateKeys(days: number, now: Date): string[] {
  const dateKeys: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    dateKeys.push(shanghaiDateKey(new Date(shanghaiDayStartUtc(now, back))));
  }
  return dateKeys;
}

/**
 * 闸门统计接口的返回形状 (任务单 §3.2.3).
 *
 * ⚠️ **数组与 dates 一一对应** (等长) —— 看板画趋势图靠的就是"下标对齐",
 *   长度不齐的数组会让图错位 (而错位的图比没有图更危险).
 *
 * ⚠️ **byMode 恒为 `{shadow, effect}` 两键** (V2026-11-11 G-3 决策):
 *     结构性跳过会写 `mode=rule_only` 的行, 但**不新增 byMode 桶** ——
 *     响应契约不能为了新枚举悄悄变形 (前端按固定两键取数, 多一桶就崩).
 *     rule_only 行照样计入 `totalDecisions` 与 `byReason.rule_only_skip`,
 *     列表端点也支持 `?mode=rule_only` 过滤 —— 要不要在 byMode 加桶,
 *     登记为**前端后续单**, 不在本单做.
 */
export interface GateStatsResponse {
  /** 日期键列表 (Asia/Shanghai, `YYYY-MM-DD`). */
  readonly dates: string[];
  /** 每天的闸门决策总数. */
  readonly totalDecisions: number[];
  /** 每天 skip 的数量. */
  readonly skipDecisions: number[];
  /** 每天 run 的数量. */
  readonly runDecisions: number[];
  /** 按 reason 分桶 (每个 reason 一条与 dates 等长的数组). */
  readonly byReason: Record<string, number[]>;
  /** 按 mode 分桶 (shadow / effect 各一条与 dates 等长的数组). */
  readonly byMode: {
    readonly shadow: number[];
    readonly effect: number[];
  };
}

/**
 * 把多个日 key 的原始字段聚合成接口形状 (**纯函数**).
 *
 * ⚠️ **byReason 恒含全部 12 个 reason** (缺的补 0) —— 形状稳定, 看板不用判"这个桶在不在".
 *
 * @param dates 日期键列表 (升序)
 * @param hashes 各日 key 的原始字段
 * @returns 统计响应
 */
export function buildGateStatsResponse(
  dates: readonly string[],
  hashes: readonly Readonly<Record<string, string | undefined>>[],
): GateStatsResponse {
  const totalDecisions: number[] = [];
  const skipDecisions: number[] = [];
  const runDecisions: number[] = [];
  const shadow: number[] = [];
  const effect: number[] = [];

  for (const hash of hashes) {
    totalDecisions.push(readCounter(hash, FIELD_TOTAL));
    skipDecisions.push(readCounter(hash, `${FIELD_DECISION_PREFIX}skip`));
    runDecisions.push(readCounter(hash, `${FIELD_DECISION_PREFIX}run`));
    shadow.push(readCounter(hash, `${FIELD_MODE_PREFIX}shadow`));
    effect.push(readCounter(hash, `${FIELD_MODE_PREFIX}effect`));
  }

  const byReason: Record<string, number[]> = {};
  for (const reason of GATE_REASON_VALUES) {
    byReason[reason] = hashes.map((hash) => readCounter(hash, `${FIELD_REASON_PREFIX}${reason}`));
  }

  return {
    dates: [...dates],
    totalDecisions,
    skipDecisions,
    runDecisions,
    byReason,
    byMode: { shadow, effect },
  };
}

/**
 * 读一个计数字段 (缺失 / 非法一律 0).
 *
 * ⚠️ **不兜底成 0 的是"整条读失败"**, 那是 pipeline 层的错误 (读侧直接抛);
 *   这里只处理"这个字段本来就没有" (那天的 key 里没这个桶) —— 那是**真实的 0**.
 *
 * @param hash 原始字段
 * @param field 字段名
 * @returns 计数
 */
function readCounter(hash: Readonly<Record<string, string | undefined>>, field: string): number {
  const raw = hash[field];
  if (raw === undefined) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}
