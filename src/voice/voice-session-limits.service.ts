// V2026-11-02 治本 (WP22 · voice 侧 · 语音对练限流闸门):
//   职责: 两道闸门, 都拦在"开会话"这一口 ——
//     ① 单用户并发上限: 同一 userId 同时只能有 N 场活跃语音会话 (默认 1);
//     ② 全局日 token 预算: 当日累计 completion tokens 超预算 → 拒开新会话.
//   边界: 只做"判定 + 记账", 不碰 WS 帧协议 / 引擎 / TTS.
//         帧的映射在 `voice-session-limit.error.ts`, 调用点在 `VoiceService`.
//
//   为什么并发用**内存 Map** 而预算用 **Redis**:
//     · 并发是**进程内**事实 —— 同一用户的两场会话必须落在同一个进程才能互斥,
//       上 Redis 反而更贵 (多一次往返), 且单实例 Phase1 本来就是单进程;
//     · 预算是**跨进程累计**事实 —— 重启不能让当日已烧掉的额度"复活",
//       所以它必须落在进程外 (Redis).
//     任务单 §5 明确不做分布式锁 —— 那是 Phase2.
//
//   为什么"拒绝"而不是"自动关掉旧会话":
//     自动关 = 用户的旧对练被**静默**掐掉, 进度丢了还没人告诉他.
//     直接拒 + 说清原因, 让他自己决定. (任务单 §2.1 / §5 的硬要求.)
//
//   反双胞胎:
//     - 不把预算做成令牌桶 / 滑动窗口: 那是 Phase2, 本期只做"当日累计上限".
//     - 不在 Redis 挂掉时**拒绝**开会话: 见 `readDailyUsage` 的失败语义 ——
//       可用性优先 (Redis 挂了不该让所有对练开不起来), 且并发闸门**不依赖 Redis**,
//       真正防"bug 循环狂开会话"的那道闸仍然在.
//     - 不用 "0 tokens" 冒充"没花钱": 上游没报用量 = 不可得, 不计入预算.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp22-voice-concurrency-budget.spec.ts 覆盖并发 / 预算 / env=0 / 释放后放行
//     3. git diff --stat HEAD -- src/engine-core 为空
//
//   时间戳: 2026-11-02 GMT+8

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { VoiceSessionLimitError } from './voice-session-limit.error.js';
import { RedisService } from '../shared/infra/redis/redis.service.js';

/** 日预算默认值 (completion tokens / 天). */
export const DEFAULT_DAILY_TOKEN_BUDGET = 500_000;

/** 单用户并发上限默认值 (本期恒为 1). */
export const DEFAULT_MAX_CONCURRENT_PER_USER = 1;

/**
 * 日预算计数器的 TTL (秒) = 48h.
 *
 * 为什么 48h 而不是 24h: key 按**自然日**命名, 跨零点后新一天用新 key.
 * 若 TTL 恰好等于 24h, 边界上 (23:59 写、00:00 后 TTL 到期) 可能把
 * "昨天最后一场"的记账**弄丢** —— 那正是最需要它的时候 (当天快结束).
 * 48h 让"昨天"的 key 一定活过今天一整天.
 */
export const DAILY_BUDGET_TTL_SEC = 48 * 60 * 60;

/**
 * 语音对练限流闸门.
 */
@Injectable()
export class VoiceSessionLimitsService {
  private readonly logger = new Logger(VoiceSessionLimitsService.name);

  /**
   * 学员 id → 活跃会话 id 集合 (并发反向索引).
   *
   * 为什么用集合而不是单值: 上限 env 可配 (默认 1), 集合才能表达"最多 N 场".
   * 单值版本在 N=2 时会直接丢掉第一场 —— 那不是"并发上限", 是"随机留一场".
   */
  private readonly activeByUser = new Map<string, Set<string>>();

  /** 当日全局 completion token 预算 (0 = 不限制). */
  private readonly dailyBudget: number;

  /** 单用户并发上限 (本期恒为 1). */
  private readonly maxConcurrentPerUser: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.dailyBudget = resolveBudget(config.get('voice.dailyTokenBudget'), DEFAULT_DAILY_TOKEN_BUDGET);
    this.maxConcurrentPerUser = Math.max(1, resolveBudget(config.get('voice.maxConcurrentPerUser'), DEFAULT_MAX_CONCURRENT_PER_USER));
  }

  /**
   * 开会话前的**两道闸门** (按顺序判, 失败即抛).
   *
   * 顺序: 先并发后预算 ——
   *   "您已有一场进行中的训练"比"今日额度已用完"更**可行动** (用户去结束旧会话即可),
   *   所以先报它; 真撞上额度时两道都会拒, 报哪个都不算错.
   *
   * @param userId 学员 id (空 = 无身份, 跳过按用户限流)
   * @param sessionId 本场会话 id
   * @throws {VoiceSessionLimitError} 被任一闸门拦下
   */
  async acquire(userId: string, sessionId: string): Promise<void> {
    // 闸门 ①: 单用户并发上限 (同步 + 原子: 判定与占位在同一步完成).
    this.reserve(userId, sessionId);
    try {
      // 闸门 ②: 当日全局 token 预算 (Redis 读).
      await this.assertDailyBudgetAvailable();
    } catch (error) {
      // 预算没过 → **不占位**: 否则用户明明没开成会话, 却占着一个并发名额,
      // 下一次自己都开不了 (占位泄漏 = 用户被自己的并发闸门锁死).
      this.release(userId, sessionId);
      throw error;
    }
  }

  /**
   * 释放并发占位 (会话结束时调).
   *
   * @param userId 学员 id
   * @param sessionId 会话 id
   */
  release(userId: string, sessionId: string): void {
    if (!userId) return;
    const active = this.activeByUser.get(userId);
    if (!active) return;
    active.delete(sessionId);
    if (active.size === 0) {
      this.activeByUser.delete(userId);
    }
  }

  /**
   * 把本场花费累加到当日预算计数器.
   *
   * 失败语义: **只记 warn, 不抛** ——
   *   收尾路径不能因为记账失败而失败 (那会让 `session_ended` 帧发不出去,
   *   前端会一直转圈). 代价是这一场的额度**没记上** —— 已知边界, 交付记录里登记.
   *
   * @param completionTokens 本场累计 completion tokens
   */
  async recordUsage(completionTokens: number): Promise<void> {
    if (!Number.isFinite(completionTokens) || completionTokens <= 0) return;
    const key = this.dailyKey();
    const delta = Math.floor(completionTokens);
    try {
      const total = await this.redis.incrby(key, delta);
      await this.redis.expire(key, DAILY_BUDGET_TTL_SEC);
      this.logger.log(`[daily_budget] 本场 ${delta} tokens, 当日累计 ${total}`);
    } catch (error) {
      this.logger.warn(`[daily_budget] 累计失败 (本场额度没记上, 不阻断收尾): ${messageOf(error)}`);
    }
  }

  /**
   * 当日已用 completion tokens (观测 / 测试用).
   *
   * @returns 当日累计值; Redis 读失败时按 0 返回 (fail-open, 同上)
   */
  async dailyUsage(): Promise<number> {
    return this.readDailyUsage();
  }

  /**
   * 当日预算计数器的 key.
   *
   * 按**服务器本地自然日**分桶: "今日额度"是给人看的, 服务器与运营在同一时区时
   * 两边口径一致. key 带日期 → 跨日自动换桶, 旧桶靠 TTL 自然过期.
   *
   * @param now 当前时间 (缺省 = 现在)
   * @returns Redis key
   */
  private dailyKey(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `voice:daily-token-budget:${year}-${month}-${day}`;
  }

  /**
   * 占位 + 判定并发上限 (同步, 原子).
   *
   * 同一个 sessionId 重复占位**不算超限** —— 那不是"第二场", 是同一场的
   * 重连 (前端重连会带着同一个 sessionId 再开一次). 把它当第二场拒掉,
   * 等于让用户**无法重连**.
   *
   * @param userId 学员 id
   * @param sessionId 会话 id
   * @throws {VoiceSessionLimitError} 已有别的活跃会话
   */
  private reserve(userId: string, sessionId: string): void {
    if (!userId) return;
    const active = this.activeByUser.get(userId) ?? new Set<string>();
    if (!active.has(sessionId) && active.size >= this.maxConcurrentPerUser) {
      throw new VoiceSessionLimitError('session_already_active', '您已有一场进行中的训练，请先结束再开始新的', true);
    }
    active.add(sessionId);
    this.activeByUser.set(userId, active);
  }

  /**
   * 闸门 ②: 当日累计是否已超预算.
   *
   * @throws {VoiceSessionLimitError} 已达预算上限
   */
  private async assertDailyBudgetAvailable(): Promise<void> {
    if (this.dailyBudget <= 0) return; // 0 = 不限制
    const used = await this.readDailyUsage();
    if (used >= this.dailyBudget) {
      throw new VoiceSessionLimitError('daily_budget_exceeded', '今日额度已用完，请明天再来', false);
    }
  }

  /**
   * 读当日累计值.
   *
   * 失败语义: **fail-open** (读失败 → 按 0 放行) ——
   *   理由: 这道闸门防的是"烧钱", 不是"越权"; Redis 抖动就让所有人开不了对练,
   *   代价远大于放行的代价. 而且并发闸门不依赖 Redis, 防"狂开会话"的那道闸还在.
   *   ⚠️ 已知边界: Redis 长时间不可用时, 日预算形同虚设 (交付记录登记).
   *
   * @returns 当日累计 completion tokens
   */
  private async readDailyUsage(): Promise<number> {
    try {
      const raw = await this.redis.get(this.dailyKey());
      const parsed = Number(raw ?? '0');
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (error) {
      this.logger.warn(`[daily_budget] 读取当日累计失败, 按放行处理: ${messageOf(error)}`);
      return 0;
    }
  }
}

/**
 * 解析一个非负整数配置 (非法 → 回退默认).
 *
 * @param raw 配置原始值
 * @param fallback 默认值
 * @returns 非负整数
 */
function resolveBudget(raw: unknown, fallback: number): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

/**
 * 取错误消息 (未知异常也能给出可读文本).
 *
 * @param error 未知异常
 * @returns 消息文本
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
