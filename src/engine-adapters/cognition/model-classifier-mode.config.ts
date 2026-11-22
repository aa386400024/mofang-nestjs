// V2026-11-12 治本 (D-1 第二段 · 模型轨事件分类器 · 灰度切换配置):
//   职责: 决定「这场会话走哪种模型轨模式」, 以及「哪些会话在灰度名单里」.
//   边界: 只做「读 env → 校验 → 装配」; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么与审议 (deliberation-mode.config.ts) **同构但方向相反**:
//     · 结构照抄 (三态 + 名单 + 超时 + 逐场判定链) —— 同一套心智模型, 排查口径一致;
//     · **缺省不同**: 审议缺省 shadow (审议在生产里本来就跑影子), 模型轨缺省 rule_only
//       (模型轨是**新能力**, 生产现状就是规则轨 → 不配 env = 改造前**逐字一致**);
//     · **非法值回落方向不同**: 审议非法 → shadow, 模型轨非法 → rule_only.
//       ⚠️ 两边理由**一致** (回落到各自「现状」= 零回归), 只是「现状」不同.
//
//   ⚠️ **考核场景红线 (exam → 恒 rule_only) 写死在判定链第 0 条**:
//     模型输出不可复现 → 考核数据集要能锁版本、锁温度、逐字复现.
//     这条**不接受任何配置覆盖, 也不接受名单覆盖** —— 名单是运维手段,
//     灰度期有人把考核场次误加进名单, 考核就悄悄烧起了 LLM, 事后没人查得出来.
//
//   如何验证:
//     1. pnpm exec tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/model-event-classifier.spec.ts 覆盖三态解析 / 名单 / 非法值回退 / 场景红线
//     3. test/config/wp25-env-example-coverage.spec.ts 断言①② 守住「模板与代码一一对应」

import type { ConfigService } from '@nestjs/config';

import type { DeliberationScenarioType } from '../deliberation/deliberation-mode.config.js';

/**
 * 模型轨的**生效模式** (三态).
 *
 * ⚠️ **缺省 = rule_only** —— 不配任何 env = 改造前逐字一致 (零回归).
 *   绝不能缺省 shadow: 那意味着默认就烧 LLM, 且「以为在灰度, 其实在生效」.
 */
export type ModelClassifierEffectiveMode = 'shadow' | 'rule_only' | 'llm_active';

/** 生效模式的**唯一**合法取值清单 (解析用的白名单). */
export const MODEL_CLASSIFIER_EFFECTIVE_MODES: readonly ModelClassifierEffectiveMode[] = ['shadow', 'rule_only', 'llm_active'];

/**
 * 灰度切换的装配结果.
 *
 * ⚠️ `grayscaleSessions` 为**空集**时的语义: 空 = **全量生效** (全局模式说了算).
 *   与 ENGINE_DELIBERATION_GRAYSCALE_SESSIONS 同一口径 (空 = 总开关打开即全量).
 */
export interface ModelClassifierModeConfig {
  /** 全局生效模式 (缺省 rule_only). */
  readonly effectiveMode: ModelClassifierEffectiveMode;
  /** 灰度会话白名单 (空 = 全量). */
  readonly grayscaleSessions: ReadonlySet<string>;
  /** 单场会话的模型轨超时上限 (ms) —— 超时即回退规则轨. */
  readonly timeoutMs: number;
}

/** 模型轨超时的缺省值 (ms) —— 与审议的 DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS 同值. */
export const DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS = 3000;

/**
 * 解析布尔开关 (非法 / 缺省 → 关).
 *
 * 口径与仓库既有开关一致 (true / 1 / yes / on = 开; 见 turn-delta-audit.config.ts 同一套写法).
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns true = 开
 */
export function resolveModelClassifierEnabled(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * 解析生效模式.
 *
 * ⚠️ **非法值 → 回退 rule_only** (不抛错): 模型轨的「现状」就是规则轨,
 *   回退到现状 = 零回归. 填错一个 env 不该让整场对练的行为面目全非.
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns 合法生效模式
 */
export function resolveModelClassifierEffectiveMode(raw: string | undefined): ModelClassifierEffectiveMode {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized.length === 0) return 'rule_only';
  return (MODEL_CLASSIFIER_EFFECTIVE_MODES as readonly string[]).includes(normalized)
    ? (normalized as ModelClassifierEffectiveMode)
    : 'rule_only';
}

/**
 * 解析灰度会话白名单 (逗号分隔).
 *
 * 空串 / 缺省 → **空集合** (= 全量生效).
 *
 * @param raw env 原值
 * @returns 会话 id 集合
 */
export function parseModelClassifierGrayscaleSessions(raw: string | undefined): ReadonlySet<string> {
  if (typeof raw !== 'string') return new Set<string>();
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return new Set(ids);
}

/**
 * 解析超时上限 (非法值 → 缺省 3000).
 *
 * @param raw env 原值
 * @returns 合法超时 (ms), 恒 > 0
 */
export function resolveModelClassifierTimeoutMs(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MODEL_CLASSIFIER_TIMEOUT_MS;
  return Math.floor(parsed);
}

/**
 * 装配模型轨的灰度切换配置.
 *
 * ⚠️ **总开关先于模式**: ENGINE_MODEL_CLASSIFIER_ENABLED 关着 = **一次 LLM 都不发**,
 *   哪怕模式写着 llm_active 也不跑. 两个开关各管各的 = 一类最难查的运维坑
 *   (「以为在灰度, 其实没生效」/「以为关了, 其实还在烧钱」). 少一个歧义源.
 *
 * @param config 配置服务 (读 env)
 * @returns 模型轨灰度配置
 */
export function resolveModelClassifierModeConfig(config: ConfigService): ModelClassifierModeConfig {
  const enabled = resolveModelClassifierEnabled(config.get<string>('ENGINE_MODEL_CLASSIFIER_ENABLED'));
  const mode = resolveModelClassifierEffectiveMode(config.get<string>('ENGINE_MODEL_CLASSIFIER_EFFECTIVE_MODE'));
  return {
    effectiveMode: enabled ? mode : 'rule_only',
    grayscaleSessions: parseModelClassifierGrayscaleSessions(config.get<string>('ENGINE_MODEL_CLASSIFIER_GRAYSCALE_SESSIONS')),
    timeoutMs: resolveModelClassifierTimeoutMs(config.get<string>('ENGINE_MODEL_CLASSIFIER_TIMEOUT_MS')),
  };
}

/**
 * 判定**某一场会话**最终走哪个模型轨模式.
 *
 * ⚠️ **本函数是逐场模型轨模式的唯一真相源** —— 装配层与分类器共用同一份判定.
 *
 * 判定链 (自上而下, 第一个命中即返回):
 *   0. **场景 = exam → rule_only** (考核红线, **优先于一切全局 / 白名单判定**);
 *      场景**查不到** (undefined) → 也按 rule_only 处理 (保守: 没法证明它不是考核场);
 *   1. 全局模式 = rule_only → rule_only (纯规则; 灰度名单无关 —— 运维说全关就全关);
 *   2. 全局模式 = shadow → shadow (影子: 只观测, 不改 delta);
 *   3. 全局模式 = llm_active → 名单内会话 llm_active, 名单外 rule_only.
 *      (名单为空 = 全量 → 全部 llm_active).
 *
 * @param modeConfig 装配好的配置
 * @param sessionId 业务会话 id (与内核 runtime 上的口径一致)
 * @param scenarioType 本场场景类型; undefined = 查不到 (按考核红线保守处理)
 * @returns 该会话的生效模式
 */
export function resolveModelClassifierSessionMode(
  modeConfig: ModelClassifierModeConfig,
  sessionId: string,
  scenarioType: DeliberationScenarioType | undefined,
): ModelClassifierEffectiveMode {
  // 场景红线: 考核场景恒 rule_only (可复现性, 优先于一切全局 / 白名单判定).
  //   查不到场景也按红线处理 —— 没法证明它不是考核场, 就别烧 LLM.
  if (scenarioType === 'exam' || scenarioType === undefined) return 'rule_only';
  if (modeConfig.effectiveMode === 'rule_only') return 'rule_only';
  if (modeConfig.effectiveMode === 'shadow') return 'shadow';
  if (modeConfig.grayscaleSessions.size === 0) return 'llm_active';
  return modeConfig.grayscaleSessions.has(sessionId) ? 'llm_active' : 'rule_only';
}
