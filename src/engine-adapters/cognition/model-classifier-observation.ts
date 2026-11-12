// V2026-11-12 治本 (D-1 第二段 · 模型轨事件分类器 · 旁路观测记录):
//   职责: 定义模型轨「两轨对照」的观测记录形状 + Redis trace 写入器.
//   边界: 只写观测; 不改内核状态 / 不改 delta / 不参与任何决策.
//
//   ⚠️ **隐私红线 (风险 Q · AGENTS.md §5.1)**: 观测表里**禁含**:
//     · 咨询师 / 来访原文;
//     · matchedTerms (命中词 —— 它可能命中角色敏感议题词表, 属心理内容衍生);
//     · 解释性文本 (只出码, 不出话);
//     · kernelState (BDI 快照);
//     · 展示名 (title / characterLabel).
//   形状本身装不下这些 —— 审查者不必信任注释, 看类型即可.
//
//   ⚠️ **trace key 必须与审议错开**: 审议写 deliberation_trace, 模型轨写 model_classifier_trace.
//   两条路径写同一个 key → 互相覆盖, 灰度期的对比数据会丢一半 (仓库既有踩坑记录).
//
//   如何验证:
//     1. pnpm exec tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/model-event-classifier.spec.ts 覆盖字段白名单 / 耗时桶 / key 前缀

import { Logger } from '@nestjs/common';

import { RedisService } from '../../shared/infra/redis/redis.service.js';

/** Redis key 的逻辑前缀 (与审议的 deliberation_trace **错开**). */
export const MODEL_CLASSIFIER_TRACE_KEY_PREFIX = 'model_classifier_trace';

/**
 * trace 数据的存活时长 (秒) —— 30 天 (与审议 trace 同口径, 便于同一批数据一起分析).
 */
export const DEFAULT_MODEL_CLASSIFIER_TRACE_TTL_SECONDS = 2_592_000;

/**
 * 一轮模型轨对照的观测记录.
 *
 * ⚠️ **字段白名单**: 形状里只有码 / 计数 / 布尔 / 枚举 —— 一条心理内容都装不下.
 */
export interface ModelClassifierObservation {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 业务会话 id. */
  readonly sessionId: string;
  /** 轮次 (模型轨自己的计数口径). */
  readonly turnIndex: number;
  /** 规则轨判出的事件种类. */
  readonly ruleKinds: readonly string[];
  /** 模型轨判出的标签 (core kind + 旁路标签, 合并去重). */
  readonly modelKinds: readonly string[];
  /** 两轨是否一致 (核心对照指标). */
  readonly agreement: boolean;
  /** 模型置信度 [0,1] (回落时 = 0). */
  readonly confidence: number;
  /** 回落原因码 (真实码表, 不自造); null = 没回落. */
  readonly fallbackReason: string | null;
  /** 耗时桶. */
  readonly latencyBucket: string;
  /** 用的模型标识. */
  readonly modelId: string;
  /** prompt 版本 (口径核对用). */
  readonly promptVersion: string;
  /** 事件强度 —— 首版恒 1 (不参与 delta 缩放). */
  readonly strength: number;
  /**
   * 本轮是否**降级** (模型轨没给出可用判定).
   *
   * ⚠️ 与 fallbackReason 同义但更直白: 统计时按第一段的「剔除降级轮」口径过滤.
   */
  readonly degraded: boolean;
}

/**
 * 观测写入端口 (窄面).
 *
 * 分类器只认这一个方法 —— 换存储 (Redis / 文件 / 不写) 不影响判定链, 也不影响测试.
 */
export interface ModelClassifierObserver {
  /**
   * 写一条观测记录 (fire-and-forget: 失败不影响本轮判定).
   *
   * @param observation 本轮对照记录
   */
  record(observation: ModelClassifierObservation): void | Promise<void>;
}

/**
 * 构造 trace key (与审议的 buildDeliberationTraceKey **同构**: 长度前缀复合键).
 *
 * ⚠️ 为什么加长度前缀: 直接用 ':' 拼的话, (租户=a:b, 会话=c) 与 (租户=a, 会话=b:c) 会**撞键**
 *   → 跨租户串数据 (静默的隐私事故).
 *
 * @param tenantId 租户隔离键
 * @param sessionId 业务会话 id
 * @param turnIndex 轮次
 * @returns Redis key
 */
export function buildModelClassifierTraceKey(tenantId: string, sessionId: string, turnIndex: number): string {
  return `${MODEL_CLASSIFIER_TRACE_KEY_PREFIX}:${tenantId.length}:${tenantId}:${sessionId.length}:${sessionId}:${turnIndex}`;
}

/**
 * 把耗时归桶.
 *
 * ⚠️ 桶边界**故意不对称**: 500ms 以内算「很快」, 3000ms 以上算「超时区」
 *   (默认超时就是 3000ms —— 超过它必然走了回落).
 *
 * @param latencyMs 实耗 (ms)
 * @returns 耗时桶
 */
export function resolveLatencyBucket(latencyMs: number): string {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return 'lt_500ms';
  if (latencyMs < 500) return 'lt_500ms';
  if (latencyMs < 1500) return 'lt_1500ms';
  if (latencyMs < 3000) return 'lt_3000ms';
  return 'gt_3000ms';
}

/**
 * Redis 版观测写入器.
 *
 * ⚠️ **写失败只打日志, 不抛** —— 观察面写不进去不是会话失败 (与审议 trace 同一纪律).
 */
export class RedisModelClassifierObserver implements ModelClassifierObserver {
  private readonly logger = new Logger(RedisModelClassifierObserver.name);

  /**
   * @param redis Redis 客户端
   * @param ttlSeconds trace 存活时长 (秒)
   */
  constructor(
    private readonly redis: RedisService,
    private readonly ttlSeconds: number = DEFAULT_MODEL_CLASSIFIER_TRACE_TTL_SECONDS,
  ) {}

  /**
   * 写一条观测记录.
   *
   * @param observation 本轮对照记录
   */
  record(observation: ModelClassifierObservation): void {
    const key = buildModelClassifierTraceKey(observation.tenantId, observation.sessionId, observation.turnIndex);
    void this.write(key, observation);
  }

  /**
   * 真正写 Redis (失败静默).
   *
   * @param key trace key
   * @param observation 本轮对照记录
   */
  private async write(key: string, observation: ModelClassifierObservation): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(observation), this.ttlSeconds);
    } catch (error) {
      this.logger.warn(
        '[model_classifier_trace_failed] session=' +
          observation.sessionId +
          ' turn=' +
          observation.turnIndex +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}
