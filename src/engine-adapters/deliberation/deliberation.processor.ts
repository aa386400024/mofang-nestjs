// V2026-11-05 治本 (WP65 · B 层 · 审议影子模式 BullMQ 队列化):
//   职责: 把影子审议的 LLM 调用从"fire-and-forget 直接调"改成"**入队 + Worker 异步跑**".
//         本类同时是编排门面的**影子审议端口实现** (`DeliberationShadowPort`) ——
//         门面调 `runShadowMode()` = 入队就返回, 真正跑 LLM 的事交给 Worker.
//
//   为什么要队列化 (WP64 之后暴露的三个问题):
//     ① 没有并发控制 —— 每轮直接发 LLM, 会话跑得快时瞬间一堆请求 → 打爆上游配额 (429);
//     ② 进程重启丢任务 —— fire-and-forget 的请求只在内存里, 重启即丢, PoC 数据不完整;
//     ③ 没有可观测性 —— 队列里有多少任务 / 跑了多少 / 失败多少, 全看不见.
//     BullMQ 三样全给: Worker 并发闸门 + Redis 持久化 + 队列指标.
//
//   照抄 `counselor-supervision.processor.ts` 的既定 pattern (任务单 §4.1):
//     · `onModuleInit` 建 Queue + Worker, `onModuleDestroy` 用 `Promise.allSettled` 关;
//     · `prefix: 'bullmq'` + 全项目统一的 `defaultJobOptions`
//       (attempts 3 / 指数退避 1000ms / removeOnComplete / removeOnFail);
//     · `enqueue()` 失败**不抛**, 只 warn —— 调用方降级, 不炸主流程;
//     · **不引 `@nestjs/bull`** —— 仓库既定用 bullmq 原生 Queue + Worker.
//
//   与仓库既有 worker 的两处**有意不同** (都在下面逐条标注了理由):
//     · **并发 3** (不是 supervisor 的 1, 不是 turn-analysis 的 2) ——
//       审议单次 3-8s (推理模型 thinking + 输出), 比督导的 30-120s 短, 可以并发;
//       但它要读完整状态快照做对比, 比每轮分析的轻档重 —— 3 是折中档, env 可调.
//     · **jobId 带 turnIndex** (任务单 §4.1 的注释写的是"不带") —— 见 `buildDeliberationJobId`.
//
//   反双胞胎:
//     - **不自己跑 LLM** —— Worker 回调里只调 `LlmDeliberationService.executeShadowMode()`,
//       结构化输出只有一条链 (仓库硬约束 6), 队列层不碰 client.
//     - **不自己写 trace** —— 观察面 (Redis trace 表) 仍归 service 写, 队列层只管搬运.
//     - **不把审议原文打进日志** —— job payload 里含对话原文 (它要随 job 冻结),
//       但日志只出 jobId / sessionId / turnIndex / 错误码 (隐私红线 AGENTS.md §5.4).
//     - **不在入队时读档位** —— 开关在**执行时**也要再判一次 (硬约束 12), 见
//       `LlmDeliberationService.executeShadowMode()`.
//
//   V2026-11-05 治本 (WP66 · 审议输出格式校验与重试):
//     本文件负责**重试的编排**, service 负责**判定该不该重试**:
//       · service 写完 trace 后, 若错误码值得重试 → 抛 `DeliberationRetryableError`;
//       · 本文件的 job handler **故意不 catch** → 异常自然冒到 BullMQ → 自动退避重试;
//       · `enqueue()` 用 **job 级** `attempts` 覆盖默认的 3 (全项目 defaultJobOptions 不动).
//     ⚠️ 这**推翻了 WP65 的"job handler 永不抛"** —— 但推翻得很有理:
//       WP65 拒绝抛是因为"任何失败都重试 = 白烧三次 LLM";
//       WP66 把范围收窄到"值得重试的那几种", 抛出去才有意义.
//
//   V2026-11-06 治本 (WP65 后半段 · per-session mutex + 快照版本号传递):
//     切灰度 (审议结果开始生效) 之前必须补的两个机制, 本单把**准备**做完:
//     · **per-session mutex** —— 同一会话同时只能有一个审议在跑.
//       Redis SETNX (原子) 拿锁, 拿不到就不入队 (省一次入队 + 一次 LLM 调用);
//       Worker 跑完释放, TTL 兜底防进程崩溃死锁.
//       ⚠️ mutex 是**优化** (省 LLM 调用), **不是正确性保证** ——
//         正确性靠切灰度时的**版本号校验** (审议结果过期就丢弃).
//         所以 mutex 失效的后果只是"多烧一次 LLM", 不是"状态写错".
//     · **快照版本号传递** —— EngineTurnOutput 多一个只读字段 revision,
//       门面把它当 baseRevision 传进审议入参, trace 里记下来.
//       本期只**传递 + 记录**, 不做过期判定 (结果还不生效, 判了也没地方用).
//
//   V2026-11-05 治本 (WP67 · 审议熔断与降级策略):
//     **会话级熔断器** —— 同一个会话连续失败 N 次后, 暂时不再跑影子审议,
//     等冷却时间过去再放**一个**请求进去试 (半开). 治的是"LLM 挂了还每轮白烧钱".
//     · 状态只存 `failureCount` + `openedAt`, 三态 (`closed` / `open` / `half-open`)
//       是**算出来的** (纯函数 `resolveCircuitStatus`), 不是存出来的 ——
//       存出来的状态容易与算出来的不一致, 算出来的永远是准的;
//     · 入队前判断: `open` 就不入队 (省一次入队 + 省一次 LLM 调用);
//     · 执行后记账: 成功清零, 失败累加 (**不管值不值得重试** —— 审议没成功就是在烧钱);
//     · 熔断时写一条 `circuit_open` 的 trace (由 **service** 写, 队列层不自己写 trace).
//     ⚠️ 熔断状态归本层, service **完全不知情** (它只多了两个能力:
//       返回结局 + 写一条 circuit_open 的 trace).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp65-deliberation-queue.spec.ts 覆盖入队 / 执行 /
//        Worker 配置 / 队列生命周期 / 隐私边界
//     3. test/engine-adapters/wp66-deliberation-retry.spec.ts 覆盖重试判定 /
//        trace retryCount / attempts 配置 / 边界
//     4. test/engine-adapters/wp67-deliberation-circuit-breaker.spec.ts 覆盖熔断三态 /
//        入队判断 / 状态记账 / 配置 / 边界
//     5. `git diff --stat HEAD -- src/engine-core` 为空 (本单不动内核)

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, Worker } from 'bullmq';

import {
  DeliberationRetryableError,
  LlmDeliberationService,
  resolveDeliberationEnabled,
  type DeliberationShadowInput,
  type DeliberationShadowPort,
} from './llm-deliberation.service.js';
import { QUEUE_NAMES } from '../../shared/infra/redis/redis.constants.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';

/**
 * Worker 并发数的默认值.
 *
 * 口径: 审议单次 LLM 调用 3-8s (推理模型 thinking + 输出). 并发 3 = 最多同时 3 个审议在跑,
 * 既压得住上游 (不像 fire-and-forget 那样一轮一个请求地堆), 又不至于把上游打满.
 */
export const DEFAULT_DELIBERATION_WORKER_CONCURRENCY = 3;

/**
 * 最大重试次数的默认值 (WP66).
 *
 * 口径: **1 次重试** (总共跑 2 次) —— 不是全项目统一的 `attempts: 3`.
 * 审议一次 LLM 调用是真金白银, 重试 3 次 = 3 倍成本; 而"模型输出形状不对"
 * 这种失败, 换一次采样大概就好了 (所以重试 1 次足够).
 * env `ENGINE_DELIBERATION_MAX_RETRIES` 可调.
 */
export const DEFAULT_DELIBERATION_MAX_RETRIES = 1;

/**
 * 熔断失败阈值的默认值 (WP67) —— 连续失败 3 次就熔断.
 *
 * 口径: **连续**失败 (不是累计) —— 成功一次就清零. 累计 3 次太严格:
 * 某个会话内容特殊, 偶尔失败一次后来又好了, 不该因此被熔断.
 */
export const DEFAULT_DELIBERATION_FAILURE_THRESHOLD = 3;

/**
 * 熔断冷却时间的默认值 (WP67) —— 10 分钟.
 *
 * 口径: 熔断打开后, 这个会话的影子审议**完全不入队** (省一次入队 + 省一次 LLM 调用),
 * 直到冷却时间过去才放**一个**请求进去试 (半开).
 */
export const DEFAULT_DELIBERATION_COOLDOWN_MS = 600_000;

/**
 * 熔断状态的 Redis key 前缀 (WP67).
 *
 * ⚠️ 与 trace key **同构**: 都带租户长度前缀 + 会话长度前缀 (防撞键).
 */
export const DELIBERATION_CIRCUIT_KEY_PREFIX = 'deliberation_circuit';

/**
 * 熔断状态 (Redis 里存的东西 —— **只有两个字段**).
 *
 * ⚠️ 为什么不存 `state` (closed/open/half-open):
 *   存出来的状态容易与算出来的不一致 (并发更新时尤其明显) —— 算出来的永远是准的.
 */
export interface DeliberationCircuitState {
  /** 连续失败次数 (成功一次就清零). */
  readonly failureCount: number;
  /** 熔断开始时刻 (ms); 未达阈值时为 null. */
  readonly openedAt: number | null;
}

/**
 * 熔断器三态.
 *
 * - `closed`   —— 正常跑;
 * - `open`     —— 熔断中, 不入队;
 * - `half-open`—— 冷却已过, 放**一个**请求进去试.
 */
export type DeliberationCircuitStatus = 'closed' | 'open' | 'half-open';

/**
 * 构造熔断状态的 Redis key (与 trace key 同构, 带租户 + 会话长度前缀).
 *
 * @param tenantId 租户隔离键
 * @param sessionId 业务会话 id
 * @returns 熔断状态的 key
 */
export function buildDeliberationCircuitKey(tenantId: string, sessionId: string): string {
  return `${DELIBERATION_CIRCUIT_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}`;
}

/**
 * 算熔断器当前处于哪一态 (纯函数, 可单测).
 *
 * 口径 (任务单 §2 D1):
 *   - 没有状态 / 连续失败数 < 阈值 → `closed`
 *   - 连续失败数 >= 阈值 且 距 openedAt 还没到冷却 → `open`
 *   - 连续失败数 >= 阈值 且 冷却已过 → `half-open`
 *
 * @param state 熔断状态 (读不到 = null)
 * @param threshold 失败阈值
 * @param cooldownMs 冷却时长 (ms)
 * @param now 当前时刻 (ms), 便于测试注入
 * @returns 三态之一
 */
export function resolveCircuitStatus(
  state: DeliberationCircuitState | null,
  threshold: number,
  cooldownMs: number,
  now: number = Date.now(),
): DeliberationCircuitStatus {
  if (!state || state.failureCount < threshold) return 'closed';
  // 防御: 到了阈值却没有 openedAt —— 视为闭合 (不该发生, 但不能因此把会话永久熔断).
  if (state.openedAt === null) return 'closed';
  const elapsed = now - state.openedAt;
  if (elapsed < cooldownMs) return 'open';
  return 'half-open';
}

/**
 * per-session mutex 的 Redis key 前缀 (WP65 后半段).
 *
 * 语义: 同一会话同时只能有一个审议在跑.
 * 入队前 SETNX 拿锁, 拿不到就不入队; Worker 跑完后释放.
 *
 * ⚠️ 与 trace key / 熔断 key **同构**: 都带租户长度前缀 + 会话长度前缀 (防撞键).
 */
export const DELIBERATION_MUTEX_KEY_PREFIX = 'deliberation_mutex';

/**
 * mutex 的 TTL (秒) = 30 秒 (WP65 后半段).
 *
 * 为什么是 30 秒:
 *   审议单次 3-8 秒 (推理模型 thinking + 输出), 加上重试也就 20 秒顶天.
 *   30 秒是**兜底** —— 进程崩了 / job 被丢弃, mutex 不会永不释放, 30 秒后自动过期.
 *
 * ⚠️ 代价 (知情取舍): 队列积压超过 30 秒时, 锁会在 job 开跑**之前**就过期 →
 *   mutex 失效 → 同一会话可能并发跑两个审议.
 *   可接受: mutex 是**优化** (省 LLM 调用), 不是正确性手段 ——
 *   并发审议的结果在切灰度时会被**版本号校验**挡掉.
 */
export const DELIBERATION_MUTEX_TTL_SECONDS = 30;

/**
 * 构造 per-session mutex 的 Redis key (与熔断 key / trace key 同构).
 *
 * @param tenantId 租户隔离键
 * @param sessionId 业务会话 id
 * @returns mutex 的 key
 */
export function buildDeliberationMutexKey(tenantId: string, sessionId: string): string {
  return `${DELIBERATION_MUTEX_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}`;
}

/**
 * per-session mutex 拿锁的结果 (三态).
 *
 * - `acquired`    —— 拿到锁, 本轮**持有**它 (job 跑完必须释放);
 * - `busy`        —— 锁在别人手里 (同一会话已有审议在跑) → 本轮不入队;
 * - `unavailable` —— Redis 不可用 → **按"没有锁"处理 (放行)**, 且本轮**不持有**它.
 *
 * ⚠️ 为什么要分三态而不是一个 boolean: "被占用"与"Redis 挂了"的**处置完全不同** ——
 *   前者要拦下 (省一次 LLM 调用), 后者要放行 (Redis 抖一下不该让所有会话的审议全停).
 *   合成一个 boolean = 必须二选一, 无论选哪个都会错一半.
 */
type MutexAcquireResult = 'acquired' | 'busy' | 'unavailable';

/**
 * 审议 job 的名字 (BullMQ 的 job name, 队列面板上按它分组).
 */
export const DELIBERATION_JOB_NAME = 'shadow';

/**
 * 构造审议 job 的 jobId (幂等键).
 *
 * ⚠️ **必须带 turnIndex** (任务单 §4.1 的注释写的是"不带", 那是错的 —— 见交付记录偏差 D2):
 *   BullMQ 的 `removeOnComplete: { count: 1000, age: 24h }` 会把**已完成的 job 在 Redis 里
 *   留 24 小时**. 而 `queue.add()` 遇到**已存在的 jobId** 会**静默跳过** (不报错、不覆盖).
 *   所以若 jobId 只有 sessionId: 第 1 轮入队后, 第 2 轮起的 job 全部被去重丢弃 ——
 *   **审议只跑第一轮**, 而且没有任何报错 (最难查的一类 bug).
 *   带上 turnIndex 后, 幂等的粒度才落到"同一场会话的同一轮" (仓库硬约束 13: jobId 要幂等).
 *
 * @param tenantId 租户隔离键
 * @param sessionId 业务会话 id
 * @param turnIndex 本轮序号 (从 1 起)
 * @returns 全局唯一的 jobId (不含 ':')
 */
export function buildDeliberationJobId(tenantId: string, sessionId: string, turnIndex: number): string {
  //   长度前缀防撞键 + 转义防非法字符, 两道都上:
  //     · 长度前缀: (租户="a-b", 会话="c") 与 (租户="a", 会话="b-c") 不能算出同一个 jobId;
  //     · 转义: BullMQ 的自定义 jobId **基本不能含 ':'** (bullmq job.js 只在
  //       "恰好 3 段" 的历史兼容分支放行, 我们的 jobId 段数不固定 → 一律当非法),
  //       而这两个 id 是外部传入的字符串, 不保证干净.
  return `d-shadow-${tenantId.length}-${encodeJobIdPart(tenantId)}-${sessionId.length}-${encodeJobIdPart(sessionId)}-${turnIndex}`;
}

/**
 * 熔断状态的 TTL (秒) = 冷却时长的 2 倍.
 *
 * ⚠️ 口径: 每次更新都**刷新** TTL —— 活跃会话的状态永不过期;
 *   不活跃的会话 (冷却早已过去、也没再来过) 自动被 Redis 清掉, 不留垃圾 key.
 *   取 2 倍: 冷却期内 (1 倍) + 半开窗口 (1 倍) 都要留得住.
 *
 * ⚠️ `RedisService.set(key, value, ttlSec)` 的 TTL 单位是**秒** ('EX'),
 *   不是毫秒 —— 这里从 ms 换算成秒, 且向上取整 (宁可多留一会儿, 别在冷却期内过期).
 */
function circuitStateTtlSeconds(cooldownMs: number): number {
  return Math.max(1, Math.ceil((cooldownMs * 2) / 1000));
}

/**
 * jobId 片段转义 (**单射**: 不同输入永远算出不同片段).
 *
 * ⚠️ 顺序不能反: 必须**先转 '%' 再转 ':'**. 反过来的话, 字面量 '%3A' 与 ':' 会编码成
 *   同一个串 → 两个不同的 (租户, 会话) 算出同一个 jobId → 后者被静默去重丢弃.
 *   转义必须可逆且无歧义, 否则幂等键就变成了"随机丢 job 的机器".
 */
function encodeJobIdPart(value: string): string {
  return value.replaceAll('%', '%25').replaceAll(':', '%3A');
}

/**
 * 审议影子模式的 BullMQ worker.
 *
 * 同时实现 `DeliberationShadowPort` —— 编排门面只认这一个接口,
 * 内部是"直接跑"还是"入队"对它**完全透明** (WP65 的核心约束).
 */
@Injectable()
export class DeliberationProcessor implements DeliberationShadowPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliberationProcessor.name);
  private queue!: Queue<DeliberationShadowInput>;
  private worker!: Worker<DeliberationShadowInput>;

  constructor(
    private readonly redis: RedisService,
    private readonly llmDeliberation: LlmDeliberationService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.getBullClient();
    const bullPrefix = 'bullmq';

    this.queue = new Queue<DeliberationShadowInput>(QUEUE_NAMES.deliberation, {
      connection,
      prefix: bullPrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    });

    this.worker = new Worker<DeliberationShadowInput>(QUEUE_NAMES.deliberation, async (job) => this.processJob(job), {
      connection,
      prefix: bullPrefix,
      // 并发 3 (env 可配): 审议单次 3-8s, 比督导的 30-120s 短 → 可以并发.
      concurrency: this.resolveWorkerConcurrency(),
    });

    this.worker.on('failed', (job, err) => {
      // ⚠️ 日志只出定位信息 —— job payload 里含对话原文, 绝不打出来 (隐私红线 AGENTS.md §5.4).
      this.logger.error(
        `[deliberation_shadow_failed] jobId=${job?.id ?? 'n/a'} sessionId=${job?.data?.sessionId ?? 'n/a'} ` +
          `turn=${job?.data?.turnIndex ?? 'n/a'} err=${err.message}`,
      );
    });

    this.logger.log(`DeliberationProcessor started: queue=${QUEUE_NAMES.deliberation} concurrency=${this.resolveWorkerConcurrency()}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  /**
   * 影子审议端口的实现 —— **入队就返回**, 不跑 LLM.
   *
   * 编排门面 (fire-and-forget) 调它: 主流程不 await, 不受影响.
   *
   * **永不抛穿**: 入队失败只 warn + 返回 false —— 影子模式挂了不能炸主流程.
   *
   * @param input 本轮审议所需的全部上下文
   */
  async runShadowMode(input: DeliberationShadowInput): Promise<void> {
    // 开关在**入队前**先判一次: 关着就不入队 —— 白占队列 + 白等上游都不值当.
    // (执行时还会再判一次, 见 `LlmDeliberationService.executeShadowMode`.)
    if (!this.isEnabled()) return;
    await this.enqueue(input);
  }

  /**
   * 入队 1 个审议任务.
   *
   * ⚠️ V2026-11-05 (WP67): 入队前先看**熔断状态** —— 熔断中就**不入队**
   *   (省一次入队 + 省一次 LLM 调用). 熔断状态归本层, service 完全不知情.
   *
   * @param input job payload (审议所需的全部上下文)
   * @returns true = 入队成功 (或已存在同 id 的 job → 幂等跳过); false = 入队失败 / 熔断中
   */
  async enqueue(input: DeliberationShadowInput): Promise<boolean> {
    // 开关先判: 关着就**不跑熔断判断** (连 Redis 都不碰) —— 影子模式整体停掉时
    // 熔断状态毫无意义.
    if (!this.isEnabled()) return false;

    const threshold = this.resolveFailureThreshold();
    const cooldownMs = this.resolveCooldownMs();
    const state = await this.loadCircuitState(input.tenantId, input.sessionId);
    const status = resolveCircuitStatus(state, threshold, cooldownMs);

    if (status === 'open') {
      // 熔断中: 不入队. 写一条 `circuit_open` 的 trace —— 督导能看到"这个会话为什么没跑审议",
      // PoC 统计时也能把"根本没跑"与"跑了但失败"分开 (D6).
      await this.llmDeliberation.recordCircuitOpen(input);
      this.logger.warn(
        `[deliberation_circuit_open] sessionId=${input.sessionId} turn=${input.turnIndex} ` +
          `failureCount=${state?.failureCount ?? 'n/a'}`,
      );
      return false;
    }

    if (status === 'half-open') {
      // 半开: 只放**一个**请求进去试 (D4) —— 把 openedAt 刷新成 now, 消费掉这次半开机会.
      // 下一个请求再来看就是 open (冷却重新开始), 不会一起涌进去烧钱.
      await this.claimHalfOpenProbe(input.tenantId, input.sessionId, cooldownMs);
    }

    // V2026-11-06 (WP65 后半段): per-session mutex —— 同一会话同时只能有一个审议在跑.
    //   拿不到锁 = 这一场会话已经有审议在跑 → **不入队** (省一次入队 + 一次 LLM 调用).
    //   ⚠️ mutex 是优化不是正确性保证: 拿不到锁只是"这次不观测", 不影响主链路.
    const mutex = await this.acquireMutex(input.tenantId, input.sessionId, input.turnIndex);
    if (mutex === 'busy') {
      this.logger.warn(`[deliberation_mutex_busy] sessionId=${input.sessionId} turn=${input.turnIndex}`);
      return false;
    }

    try {
      await this.queue.add(DELIBERATION_JOB_NAME, input, {
        // jobId 幂等: 同一会话同一轮不重复堆 job (跨进程重启也成立).
        jobId: buildDeliberationJobId(input.tenantId, input.sessionId, input.turnIndex),
        // ⚠️ job 级覆盖 (WP66): `defaultJobOptions.attempts = 3` 是全项目统一口径,
        //   但那是给审计日志那种轻任务用的 —— 审议一次 LLM 调用就是真金白银,
        //   重试 3 次 = 3 倍成本. 这里按 "第一次跑 + N 次重试" 覆盖:
        //   N = ENGINE_DELIBERATION_MAX_RETRIES (默认 1 → 总共跑 2 次).
        //   全项目统一的 defaultJobOptions **一个字不动** (只在本 job 上覆盖).
        attempts: this.resolveMaxRetries() + 1,
        backoff: { type: 'exponential', delay: 1000 },
      });
      return true;
    } catch (err) {
      // 入队失败 → **立刻释放锁**: 一次入队失败不该连累这场会话后面 30 秒的每一轮
      // (否则它只能等 TTL 到期才能再观测).
      await this.releaseMutex(input.tenantId, input.sessionId, input.turnIndex);
      this.logger.warn(
        `[deliberation_enqueue_failed] sessionId=${input.sessionId} turn=${input.turnIndex} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * job handler —— 真正跑审议 (LLM + 写 trace) + **给熔断器记账**.
   *
   * ⚠️ V2026-11-05 (WP66): `executeShadowMode()` 只抛 `DeliberationRetryableError`
   *   (值得重试的失败), 让它自然抛出去, BullMQ 就会按 job 的 `attempts` 自动退避重试.
   *   不值得重试的失败 (鉴权 / 超时 / 代码 bug) 在 service 里已经被吃掉了,
   *   只会通过**返回值**告诉我们 —— 所以 WP67 起这里要读返回值.
   *
   *   ⚠️ 别再加"吞异常"的 try/catch: 加了就把重试机制废掉
   *   (WP65 的"永不抛"在 WP66 被**故意**推翻).
   *
   * ⚠️ V2026-11-05 (WP67): 熔断记账口径 ——
   *   · 成功 → 清零 (连续失败才熔断, 不是累计失败);
   *   · 失败 (值得重试的 / 不值得重试的 / 代码异常) → **一律累加**:
   *     熔断的目的是"别再烧钱", 只要审议没成功就是在烧钱;
   *   · 开关被关掉 (`skipped`) → **不动**熔断状态: 这一轮压根没跑, 没烧钱.
   */
  private async processJob(job: Job<DeliberationShadowInput>): Promise<void> {
    // `job.attemptsMade` = 已经尝试过几次 (**首次执行时为 0**) —— 正好就是"已重试次数",
    // 直接当 retryCount 传给 service 写进 trace (仓库既有口径, 见 counselor-supervision.processor.ts).
    const data = job.data;
    // V2026-11-06 (WP65 后半段): mutex **跨重试持有** —— 只有"这一轮彻底结束"才释放.
    //   WP66 的重试会把 handler 的异常抛回 BullMQ, 退避后再跑一次;
    //   若第一次尝试失败就释放锁, 退避窗口里同一会话能再进一个审议 → mutex 失效.
    let keepMutex = false;
    try {
      const outcome = await this.llmDeliberation.executeShadowMode(data, job.attemptsMade);
      if (outcome.kind === 'ok') {
        await this.recordSuccess(data.tenantId, data.sessionId);
        return;
      }
      if (outcome.kind === 'skipped') {
        // 开关在执行时被关了 —— 这一轮**没跑**审议, 没烧钱, 熔断状态不动.
        return;
      }
      // failed / exception —— 都算失败, 一律累加熔断计数.
      await this.recordFailure(data.tenantId, data.sessionId);
    } catch (error) {
      // 走到这里 = "值得重试"的失败 (`DeliberationRetryableError`) —— 先累加计数,
      // 再**原样抛出**, 让 BullMQ 按 attempts 退避重试.
      await this.recordFailure(data.tenantId, data.sessionId);
      if (error instanceof DeliberationRetryableError) {
        // 会重试 → 锁**继续持有** (退避窗口里同一会话不该再进一个审议).
        keepMutex = this.hasAttemptsLeft(job);
        throw error;
      }
      // 其余异常 (service 里的意外错误): 记账, 但不重试 (重试同一个 bug 还是会挂).
      this.logger.warn(
        `[deliberation_shadow_error] sessionId=${data.sessionId} turn=${data.turnIndex} ` +
          `err=${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // 锁的释放放在 finally: 成功 / 失败 / 异常 / 跳过, 都要放 (WP65 后半段).
      // ⚠️ 唯一例外: 这次失败**还会重试** (keepMutex) → 锁继续持有到重试结束.
      if (!keepMutex) {
        await this.releaseMutex(data.tenantId, data.sessionId, data.turnIndex);
      }
    }
  }

  /**
   * 读熔断状态 (读不到 = 没有熔断).
   *
   * ⚠️ **读失败按"没有熔断"处理** (放行), 理由:
   *   · 熔断是**省钱**手段, 不是正确性手段 —— 读不到状态不该让审议全停;
   *   · Redis 抖动时 trace 也写不进去, 观察面本来就在丢数据;
   *   · 仓库既有口径: Redis 不可用 → 业务层降级放行 (RedisService 文件头).
   *   反过来 (读失败就阻断) 的话, 一次 Redis 抖动会把**所有**会话的审议停掉 —— 那是更大的事故.
   */
  private async loadCircuitState(tenantId: string, sessionId: string): Promise<DeliberationCircuitState | null> {
    try {
      const raw = await this.redis.get(buildDeliberationCircuitKey(tenantId, sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DeliberationCircuitState>;
      return {
        failureCount: typeof parsed.failureCount === 'number' && Number.isFinite(parsed.failureCount) ? parsed.failureCount : 0,
        openedAt: typeof parsed.openedAt === 'number' && Number.isFinite(parsed.openedAt) ? parsed.openedAt : null,
      };
    } catch (error) {
      this.logger.warn(
        `[deliberation_circuit_read_failed] sessionId=${sessionId} ` + `err=${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 成功一次 → 连续失败计数**清零** (删掉 key).
   *
   * 口径: **连续**失败才熔断, 不是累计失败 (D3) —— 成功一次就当没失败过.
   */
  private async recordSuccess(tenantId: string, sessionId: string): Promise<void> {
    try {
      await this.redis.del(buildDeliberationCircuitKey(tenantId, sessionId));
    } catch (error) {
      this.logger.warn(
        `[deliberation_circuit_write_failed] sessionId=${sessionId} ` + `err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 失败一次 → 连续失败计数 +1, 并按当前状态决定 `openedAt` 怎么更新.
   *
   * ⚠️ `openedAt` 的三种走向:
   *   · 还没到阈值        → `openedAt` 保持 null (还没熔断);
   *   · 首次熔断 / 半开失败 → `openedAt = now` (**重新开始冷却**);
   *   · 熔断中再失败      → `openedAt` **保留原来的** (冷却继续走, 不重置).
   *
   * ⚠️ 半开失败必须重置冷却时间: 半开放一个请求进去试, 失败说明 LLM 还没恢复 ——
   *   不能接着等原来的冷却时间, 要重新记 openedAt, 重新等完整的一个冷却周期.
   */
  private async recordFailure(tenantId: string, sessionId: string): Promise<void> {
    const threshold = this.resolveFailureThreshold();
    const cooldownMs = this.resolveCooldownMs();
    try {
      const state = await this.loadCircuitState(tenantId, sessionId);
      const newCount = (state?.failureCount ?? 0) + 1;
      const currentStatus = resolveCircuitStatus(state, threshold, cooldownMs);

      let openedAt: number | null;
      if (newCount < threshold) {
        openedAt = null;
      } else if (currentStatus === 'closed' || currentStatus === 'half-open') {
        openedAt = Date.now();
      } else {
        // 熔断中: 保留原来的 openedAt (冷却继续走, 不重置).
        openedAt = state?.openedAt ?? Date.now();
      }

      await this.redis.set(
        buildDeliberationCircuitKey(tenantId, sessionId),
        JSON.stringify({ failureCount: newCount, openedAt }),
        circuitStateTtlSeconds(cooldownMs),
      );
    } catch (error) {
      this.logger.warn(
        `[deliberation_circuit_write_failed] sessionId=${sessionId} ` + `err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 半开时**消费**掉这次半开机会 (D4: 只放一个请求进去试).
   *
   * 做法: 把 `openedAt` 刷新成 now —— 下一个请求再来看就是 `open` (冷却重新开始),
   * 于是同一冷却窗口里只有**第一个**请求能进, 不会一起涌进去烧钱.
   *
   * ⚠️ 这是读-改-写, **不是原子**的. 风险窗口: 同一会话的两轮**并发**入队.
   *   引擎侧同会话的轮次是串行的 (一次 turn 一轮), 所以实际不会并发;
   *   真要并发, 得换成 Lua 脚本做条件更新 (本单不值得为此引入脚本).
   */
  private async claimHalfOpenProbe(tenantId: string, sessionId: string, cooldownMs: number): Promise<void> {
    const state = await this.loadCircuitState(tenantId, sessionId);
    if (!state) return;
    try {
      await this.redis.set(
        buildDeliberationCircuitKey(tenantId, sessionId),
        JSON.stringify({ failureCount: state.failureCount, openedAt: Date.now() }),
        circuitStateTtlSeconds(cooldownMs),
      );
    } catch (error) {
      this.logger.warn(
        `[deliberation_circuit_write_failed] sessionId=${sessionId} ` + `err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 尝试拿 per-session mutex (WP65 后半段).
   *
   * ⚠️ **Redis 不可用时放行** (返回 'unavailable'), 与熔断状态同一纪律:
   *   mutex 是**省钱**手段, 不是正确性手段 —— 读不到锁不该让审议全停.
   *   反过来 (Redis 一抖就阻断) 的话, 一次抖动会把**所有**会话的审议停掉 —— 那是更大的事故.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @param turnIndex 本轮序号 (写进锁的值 —— 用来判断"这把锁是不是我的")
   * @returns 三态 (见 MutexAcquireResult)
   */
  private async acquireMutex(tenantId: string, sessionId: string, turnIndex: number): Promise<MutexAcquireResult> {
    try {
      const acquired = await this.redis.setnx(
        buildDeliberationMutexKey(tenantId, sessionId),
        String(turnIndex),
        DELIBERATION_MUTEX_TTL_SECONDS,
      );
      return acquired ? 'acquired' : 'busy';
    } catch (error) {
      this.logger.warn(
        `[deliberation_mutex_write_failed] sessionId=${sessionId} turn=${turnIndex} ` +
          `err=${error instanceof Error ? error.message : String(error)}`,
      );
      return 'unavailable';
    }
  }

  /**
   * 释放 per-session mutex (WP65 后半段).
   *
   * ⚠️ **只删自己的锁**: 先读值, 值不等于本轮序号就不删 ——
   *   锁的 TTL 可能已经过期、期间被**别的**轮次拿走了; 这时无脑 DEL = 把别人的锁删了
   *   (那一轮正在跑, 却被当成"没锁" → 又能进一个 → mutex 静默失效).
   *   读-改-写不是原子的, 但这里的后果只是"偶尔提前释放" (mutex 提前失效),
   *   不是正确性问题 (正确性靠切灰度时的版本号校验) —— 值得这点代价.
   *
   * ⚠️ 释放失败只 warn 不抛: 反正有 30 秒 TTL 兜底, 抛了也换不来什么.
   *
   * @param tenantId 租户隔离键
   * @param sessionId 业务会话 id
   * @param turnIndex 本轮序号 (持有者标识)
   */
  private async releaseMutex(tenantId: string, sessionId: string, turnIndex: number): Promise<void> {
    try {
      const key = buildDeliberationMutexKey(tenantId, sessionId);
      const holder = await this.redis.get(key);
      if (holder === null || holder !== String(turnIndex)) return;
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(
        `[deliberation_mutex_release_failed] sessionId=${sessionId} turn=${turnIndex} ` +
          `err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 这个 job 还会不会再试一次 (WP65 后半段 · mutex 跨重试持有用).
   *
   * 口径: BullMQ 的 `job.attemptsMade` = **已经失败过几次** (首次执行时为 0),
   *   `job.opts.attempts` = 总共允许跑几次 → 当前是第 `attemptsMade + 1` 次.
   *   还有剩余次数 → 还会重试 → mutex **不释放** (退避窗口里同一会话不该再进一个审议).
   *
   * @param job 当前 job
   * @returns true = 还会再试 (锁要继续持有)
   */
  private hasAttemptsLeft(job: Job<DeliberationShadowInput>): boolean {
    // ⚠️ `job.opts` / `job.attemptsMade` 在真实 BullMQ 里一定有, 但这里**防御**一下:
    //   读不到就按"没有剩余次数"处理 —— 宁可早释放锁 (mutex 提前失效, 只是多烧一次 LLM),
    //   也不能因为一个 TypeError 把原本要抛的 DeliberationRetryableError **顶掉**:
    //   顶掉 = BullMQ 看不到真正的失败原因, 排查时只剩一脸懵 (而且"值不值得重试"也判错了).
    const maxAttempts = job.opts?.attempts ?? 1;
    const attemptsMade = job.attemptsMade ?? 0;
    return attemptsMade + 1 < maxAttempts;
  }

  /**
   * 失败阈值 (`ENGINE_DELIBERATION_FAILURE_THRESHOLD`).
   *
   * 缺省 = **3** (连续失败 3 次熔断). 非法值 → 回退默认 (**不抛错**).
   */
  private resolveFailureThreshold(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_FAILURE_THRESHOLD') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_FAILURE_THRESHOLD;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIBERATION_FAILURE_THRESHOLD;
    return Math.floor(parsed);
  }

  /**
   * 冷却时长 (`ENGINE_DELIBERATION_COOLDOWN_MS`).
   *
   * 缺省 = **600000** (10 分钟). 非法值 → 回退默认 (**不抛错**).
   */
  private resolveCooldownMs(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_COOLDOWN_MS') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_COOLDOWN_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIBERATION_COOLDOWN_MS;
    return Math.floor(parsed);
  }

  /**
   * 最大重试次数 (`ENGINE_DELIBERATION_MAX_RETRIES`).
   *
   * 缺省 = **1** (总共跑 2 次): 审议一次几毛钱, 重试 3 次就是 3 倍成本.
   * 非法值 → 回退默认 1 (**不抛错**): 填错一个 env 不该让服务起不来.
   *
   * ⚠️ 这个值只能在**入队时**读 —— `attempts` 是 job 选项, 入队后就固定了,
   *   改 env 对已经在队列里的 job 无效 (与"偏好在执行时读"那条硬约束的唯一例外:
   *   开关仍在执行时读, 见 `LlmDeliberationService.executeShadowMode`).
   */
  private resolveMaxRetries(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_MAX_RETRIES') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_MAX_RETRIES;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DELIBERATION_MAX_RETRIES;
    return Math.floor(parsed);
  }

  /**
   * Worker 并发数 (`ENGINE_DELIBERATION_WORKER_CONCURRENCY`).
   *
   * 非法值 → 回退默认 3 (**不抛错**): 填错一个 env 不该让服务起不来.
   */
  private resolveWorkerConcurrency(): number {
    const raw = (this.config.get<string>('ENGINE_DELIBERATION_WORKER_CONCURRENCY') ?? '').trim();
    if (raw.length === 0) return DEFAULT_DELIBERATION_WORKER_CONCURRENCY;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIBERATION_WORKER_CONCURRENCY;
    return Math.floor(parsed);
  }

  /**
   * 影子模式开关 (`ENGINE_DELIBERATION_ENABLED`) —— 与执行时**共用同一份判定口径**.
   */
  private isEnabled(): boolean {
    return resolveDeliberationEnabled(this.config.get<string>('ENGINE_DELIBERATION_ENABLED'));
  }
}
