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
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp65-deliberation-queue.spec.ts 覆盖入队 / 执行 /
//        Worker 配置 / 队列生命周期 / 隐私边界
//     3. `git diff --stat HEAD -- src/engine-core` 为空 (本单不动内核)

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, Worker } from 'bullmq';

import {
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
   * @param input job payload (审议所需的全部上下文)
   * @returns true = 入队成功 (或已存在同 id 的 job → 幂等跳过); false = 入队失败
   */
  async enqueue(input: DeliberationShadowInput): Promise<boolean> {
    try {
      await this.queue.add(DELIBERATION_JOB_NAME, input, {
        // jobId 幂等: 同一会话同一轮不重复堆 job (跨进程重启也成立).
        jobId: buildDeliberationJobId(input.tenantId, input.sessionId, input.turnIndex),
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `[deliberation_enqueue_failed] sessionId=${input.sessionId} turn=${input.turnIndex} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * job handler —— 真正跑审议 (LLM + 写 trace).
   *
   * ⚠️ 这一步**永不抛**: `executeShadowMode()` 内部把所有异常吃掉了 ——
   *   审议失败不该把 job 打成 failed (那会触发 BullMQ 的无意义重试, 再烧三次 LLM).
   */
  private async processJob(job: Job<DeliberationShadowInput>): Promise<void> {
    await this.llmDeliberation.executeShadowMode(job.data);
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
