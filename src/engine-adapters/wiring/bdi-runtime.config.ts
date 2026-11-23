// AF-354 (2026-11-23 · B 层 · BDI 运行时开关装配):
//   职责: 把 env 里的四族键装配成内核的调参端口 ——
//         ① 愿望演化 `DesireEvolutionConfig`
//         ② 跨轮意图锁 `IntentionLockConfig`
//         ③ 时序权重 `timingWeight`
//         ④ 短期信念生成 `BeliefOperatorConfig` (AF-357)
//   边界: 只做"读 env → 校验 → 组装"; 不读任何心理内容、不连 DB / Redis、不起 Nest 容器.
//
//   为什么这一层存在 (照 WP26 / WP34 / WP42 / WP60 / WP36 的先例):
//     内核不得有任何进程级外部依赖 —— 三项 AF-349 机制也不例外. 依赖方向固定为:
//       env → (本文件, 适配层) → 内核端口.
//     内核零 process.env (boundary.spec.ts 断言⑩守着).
//
//   ⚠️ **缺省 = 关闭 / 不折损**:
//     不配任何键 → 四族配置都返回 undefined → 内核走"根本没有这一步"的路径,
//     既有轨迹与落库 delta 逐字不变（不是"结果一样"，是"没走那条路"）.
//     这四项都是**未标定机制**：工程种子已落，临床斜率未标定，缺省必须关闭.
//
//   ⚠️ 数值是**工程种子，非临床标定**:
//     本解析口只负责把部署值送进去，不把任何默认值包装成临床结论.
//     非法值（非有限 / 越界 / 非整数 / 枚举外）逐项回退内核种子，并可选告警.
//
//   键名口径（四族共 16 个键）:
//     愿望演化: ENGINE_DESIRE_EVOLUTION_ENABLED / MAX_DELTA_PER_TURN /
//               BASELINE_PULL_PER_TURN / SITUATIONAL_TTL_TURNS / SITUATIONAL_PRIORITY_FLOOR
//     意图锁:   ENGINE_INTENTION_LOCK_ENABLED / TTL_TURNS
//     时序权重: ENGINE_TIMING_WEIGHT_KIND / SLOPE / WINDOW_TURNS
//     信念生成: ENGINE_BELIEF_FORMATION_ENABLED / BASE_CONFIDENCE / REINFORCEMENT /
//               MAX_PER_TURN / MIN_CHARS / MAX_CHARS
//
//   为什么逐个字面量读（而不是循环读计算键）:
//     仓库 env 治理约定 (typings/global.d.ts) 要求显式声明；计算键编译器拦不住，
//     而 `config.get<string>('字面量')` 能被 env 覆盖断言 (AST 抽取) 看到 ——
//     漏写一个键，`.env.example` 覆盖断言立刻变红.
//
//   如何验证:
//     1. pnpm typecheck 0 错
//     2. test/engine-adapters/af354-bdi-runtime-config.spec.ts 覆盖缺省 / 覆写 / 非法回退
//     3. test/config/wp25-env-example-coverage.spec.ts 守 env 与模板一一对应

import type { ConfigService } from '@nestjs/config';

import type { InMemoryEngineSession } from '../../engine-core/in-memory/in-memory-engine-session.js';
import { DEFAULT_BELIEF_OPERATOR_CONFIG, type BeliefOperatorConfig } from '../../engine-core/index.js';

/** 内核信念算子种子（形成字段在 DEFAULT 中已齐备; 这里只做类型收紧，不另造数值）. */
const BELIEF_FORMATION_DEFAULTS = DEFAULT_BELIEF_OPERATOR_CONFIG as Required<
  Pick<
    BeliefOperatorConfig,
    | 'formationEnabled'
    | 'formationBaseConfidence'
    | 'formationReinforcement'
    | 'formationMaxPerTurn'
    | 'formationMinChars'
    | 'formationMaxChars'
  >
>;

/** 内核会话构造选项（从实现反推，不新增 core 公开导出）. */
type EngineSessionOptions = ConstructorParameters<typeof InMemoryEngineSession>[0];
/** 愿望演化配置（内核端口的结构类型）. */
export type BdiDesireEvolutionConfig = NonNullable<EngineSessionOptions['desireEvolutionConfig']>;
/** 意图锁配置（内核端口的结构类型）. */
export type BdiIntentionLockConfig = NonNullable<EngineSessionOptions['intentionLockConfig']>;
/** 时序权重配置（内核端口的结构类型）. */
export type BdiTimingWeightConfig = NonNullable<EngineSessionOptions['timingWeightConfig']>;
/** 信念算子配置（内核端口的结构类型）. */
export type BdiBeliefConfig = NonNullable<EngineSessionOptions['beliefConfig']>;

/** 告警回调（装配层接 logger；缺省 = 静默回退）. */
export type BdiRuntimeWarn = (message: string) => void;

/**
 * 装配结果（三项都可缺省）.
 *
 * 缺省字段 = 不注入内核 = 内核根本不走那一步（逐字零回归）.
 */
export interface BdiRuntimeConfig {
  readonly desireEvolutionConfig?: BdiDesireEvolutionConfig;
  readonly intentionLockConfig?: BdiIntentionLockConfig;
  readonly timingWeightConfig?: BdiTimingWeightConfig;
  readonly beliefConfig?: BdiBeliefConfig;
}

/** env 原始值（undefined = 未配置；空串按未配置处理）. */
export interface BdiRuntimeConfigEnv {
  readonly desireEvolutionEnabled?: string;
  readonly desireMaxDeltaPerTurn?: string;
  readonly desireBaselinePullPerTurn?: string;
  readonly desireSituationalTtlTurns?: string;
  readonly desireSituationalPriorityFloor?: string;
  readonly intentionLockEnabled?: string;
  readonly intentionLockTtlTurns?: string;
  readonly timingWeightKind?: string;
  readonly timingWeightSlope?: string;
  readonly timingWeightWindowTurns?: string;
  readonly beliefFormationEnabled?: string;
  readonly beliefFormationBaseConfidence?: string;
  readonly beliefFormationReinforcement?: string;
  readonly beliefFormationMaxPerTurn?: string;
  readonly beliefFormationMinChars?: string;
  readonly beliefFormationMaxChars?: string;
}

/** 缺省关闭（工程种子；与内核 DEFAULT 保持一致，不在这里另造数值）. */
const DEFAULT_INTENTION_LOCK_TTL_TURNS = 3;

/** 空 / 未配置判定. */
function hasValue(raw: string | undefined): raw is string {
  return raw !== undefined && raw.trim() !== '';
}

/**
 * 解析布尔开关（非法 → 回退 fallback 并告警）.
 *
 * 接受 1/true/yes/on 与 0/false/no/off（忽略大小写）；其余值视为配置非法.
 */
function resolveBoolean(raw: string | undefined, fallback: boolean, envKey: string, onWarn?: BdiRuntimeWarn): boolean {
  if (!hasValue(raw)) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  onWarn?.(`${envKey}: 不是合法布尔值 (${raw})，已回退 ${fallback}`);
  return fallback;
}

/** 解析 [0,1] 数值（非法 → 回退 fallback 并告警）. */
function resolveUnit(raw: string | undefined, fallback: number, envKey: string, onWarn?: BdiRuntimeWarn): number {
  if (!hasValue(raw)) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    onWarn?.(`${envKey}: 必须是 [0,1] 内的有限数 (${raw})，已回退 ${fallback}`);
    return fallback;
  }
  return value;
}

/** 解析 1..20 整数（非法 → 回退 fallback 并告警）. */
function resolveTurnCount(raw: string | undefined, fallback: number, envKey: string, onWarn?: BdiRuntimeWarn): number {
  if (!hasValue(raw)) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 20) {
    onWarn?.(`${envKey}: 必须是 1..20 的整数 (${raw})，已回退 ${fallback}`);
    return fallback;
  }
  return value;
}

/** 解析整数（范围外 / 非整数 → 回退 fallback 并告警）. */
function resolveInteger(
  raw: string | undefined,
  fallback: number,
  envKey: string,
  min: number,
  max: number,
  onWarn?: BdiRuntimeWarn,
): number {
  if (!hasValue(raw)) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    onWarn?.(`${envKey}: 必须是 ${min}..${max} 的整数 (${raw})，已回退 ${fallback}`);
    return fallback;
  }
  return value;
}

/** 解析正数（0 / 负数 / NaN 非法；缺省回退 fallback）. */
function resolvePositive(raw: string | undefined, fallback: number, envKey: string, onWarn?: BdiRuntimeWarn): number {
  if (!hasValue(raw)) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) {
    onWarn?.(`${envKey}: 必须是正数 (${raw})，已回退 ${fallback}`);
    return fallback;
  }
  return value;
}

/**
 * 解析 BDI 运行时三族配置（纯函数）.
 *
 * @param env env 原始值
 * @param onWarn 可选告警回调
 * @returns 可注入内核的配置；未配置的族不出现
 */
export function resolveBdiRuntimeConfigFromEnv(env: BdiRuntimeConfigEnv = {}, onWarn?: BdiRuntimeWarn): BdiRuntimeConfig {
  const desireKeys = [
    env.desireEvolutionEnabled,
    env.desireMaxDeltaPerTurn,
    env.desireBaselinePullPerTurn,
    env.desireSituationalTtlTurns,
    env.desireSituationalPriorityFloor,
  ];
  const lockKeys = [env.intentionLockEnabled, env.intentionLockTtlTurns];
  const timingKeys = [env.timingWeightKind, env.timingWeightSlope, env.timingWeightWindowTurns];
  const beliefKeys = [
    env.beliefFormationEnabled,
    env.beliefFormationBaseConfidence,
    env.beliefFormationReinforcement,
    env.beliefFormationMaxPerTurn,
    env.beliefFormationMinChars,
    env.beliefFormationMaxChars,
  ];

  // 愿望演化：只有显式配置了任一键才装配；缺省不注入 = 内核没有这一步.
  const desireEvolutionConfig: BdiDesireEvolutionConfig | undefined = desireKeys.every((value) => !hasValue(value))
    ? undefined
    : {
        enabled: resolveBoolean(env.desireEvolutionEnabled, false, 'ENGINE_DESIRE_EVOLUTION_ENABLED', onWarn),
        // 缺省值来自内核种子（构造时若缺字段由内核 DEFAULT 兜底，这里显式写出来是为了类型完整）.
        maxUnderlyingDeltaPerTurn: resolveUnit(env.desireMaxDeltaPerTurn, 0.02, 'ENGINE_DESIRE_MAX_DELTA_PER_TURN', onWarn),
        baselinePullPerTurn: resolveUnit(env.desireBaselinePullPerTurn, 0.01, 'ENGINE_DESIRE_BASELINE_PULL_PER_TURN', onWarn),
        situationalTtlTurns: resolveTurnCount(env.desireSituationalTtlTurns, 3, 'ENGINE_DESIRE_SITUATIONAL_TTL_TURNS', onWarn),
        situationalPriorityFloor: resolveUnit(env.desireSituationalPriorityFloor, 0.4, 'ENGINE_DESIRE_SITUATIONAL_PRIORITY_FLOOR', onWarn),
      };

  const intentionLockConfig: BdiIntentionLockConfig | undefined = lockKeys.every((value) => !hasValue(value))
    ? undefined
    : {
        enabled: resolveBoolean(env.intentionLockEnabled, false, 'ENGINE_INTENTION_LOCK_ENABLED', onWarn),
        ttlTurns: resolveTurnCount(env.intentionLockTtlTurns, DEFAULT_INTENTION_LOCK_TTL_TURNS, 'ENGINE_INTENTION_LOCK_TTL_TURNS', onWarn),
      };

  let timingWeightConfig: BdiTimingWeightConfig | undefined;
  if (!timingKeys.every((value) => !hasValue(value))) {
    const kind = (env.timingWeightKind ?? '').trim();
    const validKinds = ['none', 'linear_decay', 'recency', 'window'] as const;
    if (kind === '' || !validKinds.includes(kind as (typeof validKinds)[number])) {
      if (kind !== '') {
        onWarn?.(`ENGINE_TIMING_WEIGHT_KIND: 非法形态 (${kind})，已按不折损处理 (合法值: ${validKinds.join(' | ')})`);
      }
    } else if (kind !== 'none') {
      timingWeightConfig = {
        kind: kind as (typeof validKinds)[number],
        slope: resolvePositive(env.timingWeightSlope, kind === 'recency' ? 0.25 : 0.1, 'ENGINE_TIMING_WEIGHT_SLOPE', onWarn),
        windowTurns: resolveTurnCount(env.timingWeightWindowTurns, 6, 'ENGINE_TIMING_WEIGHT_WINDOW_TURNS', onWarn),
      };
    }
  }

  let beliefConfig: BdiBeliefConfig | undefined;
  if (!beliefKeys.every((value) => !hasValue(value))) {
    const formationMinChars = resolveInteger(
      env.beliefFormationMinChars,
      BELIEF_FORMATION_DEFAULTS.formationMinChars,
      'ENGINE_BELIEF_FORMATION_MIN_CHARS',
      1,
      200,
      onWarn,
    );
    const formationMaxChars = resolveInteger(
      env.beliefFormationMaxChars,
      Math.max(formationMinChars, BELIEF_FORMATION_DEFAULTS.formationMaxChars),
      'ENGINE_BELIEF_FORMATION_MAX_CHARS',
      formationMinChars,
      500,
      onWarn,
    );
    beliefConfig = {
      ...DEFAULT_BELIEF_OPERATOR_CONFIG,
      formationEnabled: resolveBoolean(env.beliefFormationEnabled, false, 'ENGINE_BELIEF_FORMATION_ENABLED', onWarn),
      formationBaseConfidence: resolveUnit(
        env.beliefFormationBaseConfidence,
        BELIEF_FORMATION_DEFAULTS.formationBaseConfidence,
        'ENGINE_BELIEF_FORMATION_BASE_CONFIDENCE',
        onWarn,
      ),
      formationReinforcement: resolveUnit(
        env.beliefFormationReinforcement,
        BELIEF_FORMATION_DEFAULTS.formationReinforcement,
        'ENGINE_BELIEF_FORMATION_REINFORCEMENT',
        onWarn,
      ),
      formationMaxPerTurn: resolveInteger(
        env.beliefFormationMaxPerTurn,
        BELIEF_FORMATION_DEFAULTS.formationMaxPerTurn,
        'ENGINE_BELIEF_FORMATION_MAX_PER_TURN',
        0,
        10,
        onWarn,
      ),
      formationMinChars,
      formationMaxChars,
    };
  }

  return {
    ...(desireEvolutionConfig ? { desireEvolutionConfig } : {}),
    ...(intentionLockConfig ? { intentionLockConfig } : {}),
    ...(timingWeightConfig ? { timingWeightConfig } : {}),
    ...(beliefConfig ? { beliefConfig } : {}),
  };
}

/**
 * 从 ConfigService 装配四族配置（适配层入口）.
 *
 * @param config 配置服务（读 env）
 * @param onWarn 可选告警回调
 * @returns 可注入内核的配置
 */
export function resolveBdiRuntimeConfig(config: ConfigService, onWarn?: BdiRuntimeWarn): BdiRuntimeConfig {
  return resolveBdiRuntimeConfigFromEnv(
    {
      desireEvolutionEnabled: config.get<string>('ENGINE_DESIRE_EVOLUTION_ENABLED'),
      desireMaxDeltaPerTurn: config.get<string>('ENGINE_DESIRE_MAX_DELTA_PER_TURN'),
      desireBaselinePullPerTurn: config.get<string>('ENGINE_DESIRE_BASELINE_PULL_PER_TURN'),
      desireSituationalTtlTurns: config.get<string>('ENGINE_DESIRE_SITUATIONAL_TTL_TURNS'),
      desireSituationalPriorityFloor: config.get<string>('ENGINE_DESIRE_SITUATIONAL_PRIORITY_FLOOR'),
      intentionLockEnabled: config.get<string>('ENGINE_INTENTION_LOCK_ENABLED'),
      intentionLockTtlTurns: config.get<string>('ENGINE_INTENTION_LOCK_TTL_TURNS'),
      timingWeightKind: config.get<string>('ENGINE_TIMING_WEIGHT_KIND'),
      timingWeightSlope: config.get<string>('ENGINE_TIMING_WEIGHT_SLOPE'),
      timingWeightWindowTurns: config.get<string>('ENGINE_TIMING_WEIGHT_WINDOW_TURNS'),
      beliefFormationEnabled: config.get<string>('ENGINE_BELIEF_FORMATION_ENABLED'),
      beliefFormationBaseConfidence: config.get<string>('ENGINE_BELIEF_FORMATION_BASE_CONFIDENCE'),
      beliefFormationReinforcement: config.get<string>('ENGINE_BELIEF_FORMATION_REINFORCEMENT'),
      beliefFormationMaxPerTurn: config.get<string>('ENGINE_BELIEF_FORMATION_MAX_PER_TURN'),
      beliefFormationMinChars: config.get<string>('ENGINE_BELIEF_FORMATION_MIN_CHARS'),
      beliefFormationMaxChars: config.get<string>('ENGINE_BELIEF_FORMATION_MAX_CHARS'),
    },
    onWarn,
  );
}

/**
 * 内核跨轮意图锁是否开启（唯一解析口径，审议侧复用）.
 *
 * 为什么单独导出: 内核意图锁与 WP68 的 Redis 审议锁是两套机制，同时开启会产生
 * 双重锁语义。审议侧必须用**同一份**解析结果判断"内核锁是否已接管"，否则两侧各自
 * 解析同一个 env 字符串，遇到非法值会得出不同结论.
 *
 * @param config 配置服务
 * @returns 内核意图锁是否开启（缺省 / 非法 = false）
 */
export function isKernelIntentionLockEnabled(config: ConfigService): boolean {
  return resolveBoolean(config.get<string>('ENGINE_INTENTION_LOCK_ENABLED'), false, 'ENGINE_INTENTION_LOCK_ENABLED');
}
