// V2026-11-09 治本 (Phase2.5 WP-C · 触发式审议闸门 · 配置层):
//   职责: 把 env 里的闸门参数装配成**纯数据** (GateConfig) —— 两种模式各一套策略.
//   边界: 只做"读 env → 校验 → 装配"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么要有这一层 (与 delta-cap.config.ts / alliance-config.ts 同款范式):
//     仓库纪律: **不写死阈值** + **判定只有一份**. 阈值散落在判定代码里 = 迟早有人
//     改了一处忘了另一处, 于是"影子按 0.03 判、生效按 0.05 判"这种漂移没人查得出来.
//     收口到这里, 判定层只认 GatePolicy, 不知道 env 的存在.
//
//   ⚠️ **env 键逐个字面量读** (不是拼接出来的计算键):
//     WP25 的 env 覆盖守卫用 TypeScript AST 抽取读取点 —— 计算键它看不见,
//     "漏写一个键"这条缺口就没人守了. 所以这里 12 个键一个一个写出来.
//
//   ⚠️ **非法值一律回退缺省, 不抛错** (与仓库既有配置层同款口径):
//     填错一个 env 不该让整场对练起不来.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/deliberation-gate/evaluator.spec.ts 覆盖解析口径

import type { ConfigService } from '@nestjs/config';

import type { GateConfig } from './deliberation-gate.types.js';

/** 同盟三维触发阈值缺省值 (生效模式). */
export const DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT = 0.05;
/** 同盟三维触发阈值缺省值 (影子模式). */
export const DEFAULT_GATE_ALLIANCE_THRESHOLD_SHADOW = 0.03;
/** 阻抗三维触发阈值缺省值 (生效模式). */
export const DEFAULT_GATE_RESISTANCE_THRESHOLD_EFFECT = 0.08;
/** 阻抗三维触发阈值缺省值 (影子模式). */
export const DEFAULT_GATE_RESISTANCE_THRESHOLD_SHADOW = 0.05;
/** "全平静"阈值缺省值 (生效模式) —— 任务单 §2.2 流程图写的是 0.03. */
export const DEFAULT_GATE_CALM_THRESHOLD_EFFECT = 0.03;
/** "全平静"阈值缺省值 (影子模式). */
export const DEFAULT_GATE_CALM_THRESHOLD_SHADOW = 0.03;
/** 冷却轮数缺省值 (生效模式). */
export const DEFAULT_GATE_COOLDOWN_TURNS_EFFECT = 4;
/** 冷却轮数缺省值 (影子模式). */
export const DEFAULT_GATE_COOLDOWN_TURNS_SHADOW = 1;
/** 每会话最大生效次数缺省值 (仅生效模式; 影子不限). */
export const DEFAULT_GATE_MAX_PER_SESSION_EFFECT = 6;
/** 全局每分钟配额缺省值 (仅生效模式; 影子不限). */
export const DEFAULT_GATE_GLOBAL_RPM = 20;
/** 熔断阈值缺省值 (连续失败多少次熔断). */
export const DEFAULT_GATE_CIRCUIT_FAIL_COUNT = 5;
/** 熔断冷却时长缺省值 (毫秒). */
export const DEFAULT_GATE_CIRCUIT_COOLDOWN_MS = 600_000;

/**
 * "不限制"的哨兵值.
 *
 * ⚠️ 为什么不用 0 / Infinity:
 *   · 0 = "一次都不许跑" (那是另一个意思, 会把影子模式整个废掉);
 *   · Infinity = JSON 序列化会变成 null (trace 里会看到 null 而不是"不限").
 *   极大哨兵值在比较里天然成立 ("次数 >= 哨兵" 永远为假), 又能安全进 JSON.
 */
export const GATE_UNLIMITED = Number.MAX_SAFE_INTEGER;

/**
 * 解析一个有限数 (空串 / 非数字 → 缺省).
 *
 * @param raw env 原值
 * @param fallback 缺省值
 * @returns 有限数
 */
function readFinite(raw: string | undefined, fallback: number): number {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 解析一个非负有限数 (负数 → 缺省).
 *
 * ⚠️ 负阈值没有意义 (|delta| 永远 ≥ 0, 阈值 ≤ 0 = 每轮都触发 = 闸门形同虚设).
 *
 * @param raw env 原值
 * @param fallback 缺省值
 * @returns 非负有限数
 */
function readNonNegative(raw: string | undefined, fallback: number): number {
  const parsed = readFinite(raw, fallback);
  return parsed < 0 ? fallback : parsed;
}

/**
 * 解析一个非负整数 (非法 → 缺省).
 *
 * @param raw env 原值
 * @param fallback 缺省值
 * @returns 非负整数
 */
function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = readNonNegative(raw, fallback);
  return Math.floor(parsed);
}

/**
 * 解析一个正整数 (非法 → 缺省).
 *
 * ⚠️ 熔断阈值必须 ≥ 1 —— 0 会变成"失败一次就熔断", 1 则等于"永不熔断".
 *
 * @param raw env 原值
 * @param fallback 缺省值
 * @returns 正整数
 */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = readFinite(raw, fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/**
 * 装配闸门配置.
 *
 * ⚠️ **影子模式的三项"不限制"在这里写死成哨兵值** (会话次数 / 全局配额 / 不熔断):
 *   任务单 §2.1 参数表就是这么定的 (影子低门槛多收集数据, 不设限).
 *   写成显式数字而不是"运行时按 mode 分支" —— 纯判定层因此不需要知道模式差异.
 *
 * @param config 配置服务 (读 env)
 * @returns 闸门配置
 */
export function resolveDeliberationGateConfig(config: ConfigService): GateConfig {
  return {
    shadow: {
      thresholds: {
        alliance: readNonNegative(
          config.get<string>('ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_SHADOW'),
          DEFAULT_GATE_ALLIANCE_THRESHOLD_SHADOW,
        ),
        resistance: readNonNegative(
          config.get<string>('ENGINE_DELIBERATION_GATE_RESISTANCE_THRESHOLD_SHADOW'),
          DEFAULT_GATE_RESISTANCE_THRESHOLD_SHADOW,
        ),
        calm: readNonNegative(config.get<string>('ENGINE_DELIBERATION_GATE_CALM_THRESHOLD_SHADOW'), DEFAULT_GATE_CALM_THRESHOLD_SHADOW),
      },
      cooldownTurns: readNonNegativeInt(config.get<string>('ENGINE_DELIBERATION_GATE_COOLDOWN_SHADOW'), DEFAULT_GATE_COOLDOWN_TURNS_SHADOW),
      maxPerSession: GATE_UNLIMITED,
      globalRpm: GATE_UNLIMITED,
      circuitEnabled: false,
    },
    effect: {
      thresholds: {
        alliance: readNonNegative(
          config.get<string>('ENGINE_DELIBERATION_GATE_ALLIANCE_THRESHOLD_EFFECT'),
          DEFAULT_GATE_ALLIANCE_THRESHOLD_EFFECT,
        ),
        resistance: readNonNegative(
          config.get<string>('ENGINE_DELIBERATION_GATE_RESISTANCE_THRESHOLD_EFFECT'),
          DEFAULT_GATE_RESISTANCE_THRESHOLD_EFFECT,
        ),
        calm: readNonNegative(config.get<string>('ENGINE_DELIBERATION_GATE_CALM_THRESHOLD_EFFECT'), DEFAULT_GATE_CALM_THRESHOLD_EFFECT),
      },
      cooldownTurns: readNonNegativeInt(config.get<string>('ENGINE_DELIBERATION_GATE_COOLDOWN_EFFECT'), DEFAULT_GATE_COOLDOWN_TURNS_EFFECT),
      maxPerSession: readNonNegativeInt(
        config.get<string>('ENGINE_DELIBERATION_GATE_MAX_PER_SESSION_EFFECT'),
        DEFAULT_GATE_MAX_PER_SESSION_EFFECT,
      ),
      globalRpm: readNonNegativeInt(config.get<string>('ENGINE_DELIBERATION_GATE_GLOBAL_RPM'), DEFAULT_GATE_GLOBAL_RPM),
      circuitEnabled: true,
    },
    circuitFailCount: readPositiveInt(config.get<string>('ENGINE_DELIBERATION_GATE_CIRCUIT_FAIL_COUNT'), DEFAULT_GATE_CIRCUIT_FAIL_COUNT),
    circuitCooldownMs: readNonNegativeInt(
      config.get<string>('ENGINE_DELIBERATION_GATE_CIRCUIT_COOLDOWN_MS'),
      DEFAULT_GATE_CIRCUIT_COOLDOWN_MS,
    ),
  };
}
