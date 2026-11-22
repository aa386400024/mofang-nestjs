// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 配额与熔断 · Redis 层):
//   职责: 闸门的**全部状态存取** —— 会话冷却 / 会话计数 / 全局每分钟配额 / 熔断状态.
//   边界: 只读写 Redis, **一个比较都不做** (比较全在 evaluator.ts 的纯判定里).
//
//   为什么状态必须全在 Redis (任务单 §六红线 3):
//     冷却 / 计数 / 熔断是"**跨进程的事实**" —— 同一场会话可能被两个实例先后服务,
//     同一分钟的全局配额更是跨实例共享. 放进程内存 = 换实例就失忆,
//     于是"限流"在多实例部署下形同虚设 (而且是**静默**失效: 单实例测试全绿).
//     放 Redis = 以后把闸门拆成独立微服务时, 逻辑一行都不用改.
//
//   ⚠️ **读失败一律按"最宽松"处理 (放行)** —— 与仓库既有口径一致:
//     Redis 抖一下就把**所有**会话的审议停掉, 那是更大的事故;
//     闸门是**省钱**手段, 不是正确性手段 (读不到状态就不该让审议全停).
//     代价: Redis 抖动期间闸门会放行 (多花点钱), 换来的是"审议链路不因 Redis 抖动而停摆".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/quotas.spec.ts 覆盖冷却/计数/配额/熔断

import { Logger } from '@nestjs/common';

import type { GateMode, GateRuntimeState } from './deliberation-gate.types.js';
import type { RedisService } from '../../shared/infra/redis/redis.service.js';

/**
 * 闸门状态 key 的统一前缀.
 */
export const GATE_KEY_PREFIX = 'deliberation:gate';

/**
 * 会话级状态 key 的存活时长 (秒) —— 24 小时.
 *
 * ⚠️ 为什么要 TTL: 会话状态是"这 24 小时内还在跑这场会话"的临时事实,
 *   攒着不清理 = Redis 里堆一堆没人再碰的 key.
 */
export const GATE_SESSION_STATE_TTL_SECONDS = 86_400;

/**
 * 全局每分钟计数 key 的存活时长 (秒) —— 2 分钟.
 *
 * ⚠️ 为什么要 > 1 分钟: 分钟桶切换时上一个桶的 key 还得活一小会儿
 *   (否则"跨桶的那一次"会丢计数). 2 分钟足够.
 */
export const GATE_RPM_TTL_SECONDS = 120;

/**
 * 构造会话级状态 key (冷却轮次 / 会话计数).
 *
 * ⚠️ 长度前缀复合键 (与审议 trace / 熔断 key / BDI 状态仓储同一套纪律):
 *   直接用 ':' 拼的话, (会话 "a" + 模式 "b") 与 (会话 "a:b") 可能撞键 ——
 *   撞键 = **跨会话串状态** (A 场的冷却压住 B 场, 或 B 场的计数算到 A 场头上),
 *   而且是静默的 (没有任何报错, 只是限流乱套).
 *
 * @param sessionId 业务会话 id
 * @param mode 模式 (影子 / 生效) —— 两套状态互不干扰
 * @param suffix 状态名 (last_turn / count)
 * @returns Redis key
 */
export function buildGateSessionKey(sessionId: string, mode: GateMode, suffix: string): string {
  return `${GATE_KEY_PREFIX}:${sessionId.length}:${sessionId}:${mode}:${suffix}`;
}

/**
 * 构造全局每分钟配额的 key.
 *
 * @param minute 分钟桶 (floor(now / 60000))
 * @returns Redis key
 */
export function buildGateGlobalRpmKey(minute: number): string {
  return `${GATE_KEY_PREFIX}:global:rpm:${minute}`;
}

/**
 * 熔断连续失败计数的 key.
 *
 * @returns Redis key
 */
export function buildGateCircuitFailCountKey(): string {
  return `${GATE_KEY_PREFIX}:circuit:fail_count`;
}

/**
 * 熔断截止时间的 key (毫秒时间戳).
 *
 * @returns Redis key
 */
export function buildGateCircuitOpenUntilKey(): string {
  return `${GATE_KEY_PREFIX}:circuit:open_until`;
}

/**
 * 闸门的配额 / 冷却 / 熔断存取器.
 */
export class DeliberationGateQuotas {
  private readonly logger = new Logger('DeliberationGateQuotas');

  /**
   * @param redis Redis 客户端 (基础设施窄面)
   */
  constructor(private readonly redis: RedisService) {}

  /**
   * 读上次跑审议的轮次.
   *
   * @param sessionId 业务会话 id
   * @param mode 模式
   * @returns 上次轮次; 从没跑过 / 读失败 → null
   */
  async readLastTurn(sessionId: string, mode: GateMode): Promise<number | null> {
    try {
      const raw = await this.redis.get(buildGateSessionKey(sessionId, mode, 'last_turn'));
      if (raw === null || raw.trim().length === 0) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      this.logger.warn(`[deliberation_gate_read_failed] last_turn: ${messageOf(error)}`);
      return null;
    }
  }

  /**
   * 读本会话本模式的已跑次数.
   *
   * @param sessionId 业务会话 id
   * @param mode 模式
   * @returns 次数; 读失败 → 0
   */
  async readSessionRunCount(sessionId: string, mode: GateMode): Promise<number> {
    try {
      const raw = await this.redis.get(buildGateSessionKey(sessionId, mode, 'count'));
      if (raw === null || raw.trim().length === 0) return 0;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (error) {
      this.logger.warn(`[deliberation_gate_read_failed] session_count: ${messageOf(error)}`);
      return 0;
    }
  }

  /**
   * 读全局本分钟已跑次数.
   *
   * @param now 当前时刻 (毫秒)
   * @returns 次数; 读失败 → 0
   */
  async readGlobalRunCount(now: number): Promise<number> {
    try {
      const raw = await this.redis.get(buildGateGlobalRpmKey(Math.floor(now / 60_000)));
      if (raw === null || raw.trim().length === 0) return 0;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (error) {
      this.logger.warn(`[deliberation_gate_read_failed] global_rpm: ${messageOf(error)}`);
      return 0;
    }
  }

  /**
   * 读熔断状态.
   *
   * @param now 当前时刻 (毫秒)
   * @returns true = 熔断中; 读失败 → false (不阻断)
   */
  async readCircuitOpen(now: number): Promise<boolean> {
    try {
      const raw = await this.redis.get(buildGateCircuitOpenUntilKey());
      if (raw === null || raw.trim().length === 0) return false;
      const openUntil = Number(raw);
      if (!Number.isFinite(openUntil)) return false;
      return now < openUntil;
    } catch (error) {
      this.logger.warn(`[deliberation_gate_read_failed] circuit: ${messageOf(error)}`);
      return false;
    }
  }

  /**
   * 读齐运行时状态 (给纯判定函数当输入).
   *
   * @param sessionId 业务会话 id
   * @param mode 模式
   * @param now 当前时刻 (毫秒)
   * @returns 运行时状态快照
   */
  async loadRuntimeState(sessionId: string, mode: GateMode, now: number): Promise<GateRuntimeState> {
    const [lastTurn, sessionRunCount, globalRunCount, circuitOpen] = await Promise.all([
      this.readLastTurn(sessionId, mode),
      this.readSessionRunCount(sessionId, mode),
      this.readGlobalRunCount(now),
      this.readCircuitOpen(now),
    ]);
    return { lastTurn, sessionRunCount, globalRunCount, circuitOpen };
  }

  /**
   * 记一次"这轮跑了审议".
   *
   * ⚠️ **影子模式不占全局配额** (任务单 §2.1: 影子不限配额):
   *   全局每分钟 key 不带 mode 段 (那是任务单定的 key 形状), 所以只能靠"谁写"来分流 ——
   *   只有生效模式写它, 影子模式的调用不会挤占生效模式的预算.
   *
   * @param sessionId 业务会话 id
   * @param mode 模式
   * @param turnIndex 本轮轮次
   * @param now 当前时刻 (毫秒)
   */
  async recordRun(sessionId: string, mode: GateMode, turnIndex: number, now: number): Promise<void> {
    try {
      await this.redis.set(buildGateSessionKey(sessionId, mode, 'last_turn'), String(turnIndex), GATE_SESSION_STATE_TTL_SECONDS);
      const countKey = buildGateSessionKey(sessionId, mode, 'count');
      await this.redis.incr(countKey);
      await this.redis.expire(countKey, GATE_SESSION_STATE_TTL_SECONDS);
      if (mode === 'effect') {
        const rpmKey = buildGateGlobalRpmKey(Math.floor(now / 60_000));
        await this.redis.incr(rpmKey);
        await this.redis.expire(rpmKey, GATE_RPM_TTL_SECONDS);
      }
    } catch (error) {
      // 计数写不进去 = 限流退化成"不限", 不是会话失败 (观察面 / 辅助面挂了就挂了).
      this.logger.warn(`[deliberation_gate_write_failed] record_run: ${messageOf(error)}`);
    }
  }

  /**
   * 记一次审议失败 (连续失败计数 +1; 达阈值则熔断).
   *
   * ⚠️ **连续**失败才熔断 (成功一次由 resetCircuit 清零), 不是累计失败 ——
   *   累计失败会把"偶发失败但整体健康"的链路误判成不健康.
   *
   * @param threshold 连续失败多少次熔断
   * @param cooldownMs 熔断持续时长 (毫秒)
   * @param now 当前时刻 (毫秒)
   */
  async recordCircuitFailure(threshold: number, cooldownMs: number, now: number): Promise<void> {
    try {
      const failCountKey = buildGateCircuitFailCountKey();
      const count = await this.redis.incr(failCountKey);
      const ttlSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
      await this.redis.expire(failCountKey, ttlSeconds);
      if (count < threshold) return;
      // 达阈值 → 打开熔断 (截止时间 = 现在 + 冷却时长).
      const openUntilKey = buildGateCircuitOpenUntilKey();
      await this.redis.set(openUntilKey, String(now + cooldownMs), ttlSeconds);
      this.logger.warn(`[deliberation_gate_circuit_open] failCount=${count} cooldownMs=${cooldownMs}`);
    } catch (error) {
      this.logger.warn(`[deliberation_gate_write_failed] circuit_failure: ${messageOf(error)}`);
    }
  }

  /**
   * 熔断恢复 (审议成功一次 → 连续失败计数与截止时间都清掉).
   */
  async resetCircuit(): Promise<void> {
    try {
      await this.redis.del(buildGateCircuitFailCountKey());
      await this.redis.del(buildGateCircuitOpenUntilKey());
    } catch (error) {
      this.logger.warn(`[deliberation_gate_write_failed] circuit_reset: ${messageOf(error)}`);
    }
  }
}

/**
 * 把异常压成一行短消息 (日志里不堆栈).
 *
 * @param error 异常
 * @returns 短消息
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
