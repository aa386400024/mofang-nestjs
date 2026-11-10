// V2026-11-10 治本 (Phase2.5 WP-H 第二波 · 新增 10 — 跑批期 TypeORM query 日志降噪):
//   原因: 昨晚一次 24 场的批次, 10 分钟内日志刷到 93KB, 全是 `query: SELECT ...`
//     逐条 SQL —— 真正的关键行 (渲染降级 / 队列状态) 被淹没, 只能靠 grep 捞.
//     批量跑 100 场时这个量级会失控.
//   口径:
//     · 缺省 = **关** query 日志 (跑批是常态, 噪音是常态);
//     · `error` / `warn` / `migration` **永远保留** —— 不许一并关掉:
//       慢查询 (maxQueryExecutionTime = 1000ms) 在 TypeORM 里是按 `warn` 级别落的,
//       关掉 warn 就等于把"这条 SQL 跑了 3 秒"这件事一起静音了;
//     · `DB_QUERY_LOGGING=true` 时才把 `query` 加回来 (排查 SQL 时临时开).
//
//   反双胞胎:
//     - 纯函数, 不碰 Nest 容器 —— 单测直接调;
//     - dev / prod 两个 env 装配层共用同一份解析口径 (别一个关了另一个还开着);
//     - 缺省零回归: 不配这个键时, 日志里不再出现 `query:` 行, 其余级别不变.
import type { LogLevel } from 'typeorm';

/**
 * 永远保留的 DB 日志级别 (跟 DB_QUERY_LOGGING 无关).
 *
 * `migration` 也留着: 迁移是运维唯一需要逐条看的东西, 且它只在启动时打, 不吵.
 */
export const ALWAYS_ON_DB_LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'migration'];

/**
 * 慢查询阈值 (毫秒): 超过就按 warn 级别落日志.
 *
 * 与 `error`/`warn` 保留是配套的 —— 关掉 warn 就等于把这道提示一起关掉.
 */
export const DB_SLOW_QUERY_THRESHOLD_MS = 1000;

/**
 * 解析 DB_QUERY_LOGGING 开关 (纯函数).
 *
 * 口径: 只有字面量 `true` (忽略大小写 / 首尾空白) 才开 —— 跟仓库里其他布尔 env
 *   的读法一致 (`=== 'true'`). 别的值一律当关, 不猜、不报错.
 *
 * @param raw env 原值
 * @returns 是否开 query 日志
 */
export function resolveDbQueryLogging(raw: string | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

/**
 * 解析 DB 日志级别列表 (纯函数).
 *
 * @param raw DB_QUERY_LOGGING 的 env 原值
 * @returns TypeORM 的 LogLevel 列表
 */
export function resolveDbLoggingLevels(raw: string | undefined): LogLevel[] {
  return resolveDbQueryLogging(raw) ? [...ALWAYS_ON_DB_LOG_LEVELS, 'query'] : [...ALWAYS_ON_DB_LOG_LEVELS];
}
