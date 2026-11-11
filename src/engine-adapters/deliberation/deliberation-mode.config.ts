// V2026-11-08 治本 (R9 · B 层 · 灰度切换配置):
//   职责: 决定"这一场会话走哪种审议模式", 以及"哪些会话在灰度名单里".
//   边界: 只做"读 env → 校验 → 装配"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么要有这一层 (与 delta-cap.config.ts 同款范式):
//     仓库纪律: **判定只有一份**. 生效模式 / 灰度名单如果散落在多处判定,
//     迟早漂移 (一处认 'llm_active' 一处只认 'active') —— 灰度期最怕这个:
//     "以为在灰度, 其实没生效" 或 "以为没生效, 其实在跑 LLM".
//     收口到这里, 装配层与钩子共用同一份真相.
//
//   ⚠️ **为什么用会话白名单, 不用用户名单**:
//     引擎会话端口 (`ENGINE_SESSION_PORT`) 是**单例** —— 装配期根本拿不到
//     "当前用户是谁". 而会话 id 在**每轮决策时**都拿得到 (内核 runtime 里有).
//     更要紧的是**同一场会话内模式必须恒定**: 若按用户判, 名单中途改一次,
//     同一场会话前半场规则、后半场 LLM → 状态轨迹不可复现 (实训平台命根子).
//     按会话判 + 名单只在**开场**读一次 = 一场会话一个模式, 全程恒定.
//     仓库既有范式也是会话白名单 (`ENGINE_STREAM_GRAYSCALE_SESSIONS`).
//
//   V2026-11-08 治本 (R9 · 总开关与模式的关系):
//     两个 env 键, 但**只有一个决定权**:
//       · `ENGINE_DELIBERATION_ENABLED` —— 总开关 (缺省 = 关). 关着 = 一次 LLM 都不发.
//       · `ENGINE_DELIBERATION_EFFECTIVE_MODE` —— 模式 (缺省 = `shadow`).
//     装配时把总开关**折叠进模式**: 总开关关着 → 模式一律降级成 `rule_only`.
//     为什么不给两个开关各管各的: 两个能互相打架的开关 = 一类最难查的运维坑
//     ("以为在灰度, 其实没生效" / "以为关了, 其实还在烧钱"). 少一个歧义源.
//     ⚠️ 缺省组合 (ENABLED 未配 + MODE 未配) = `rule_only` = 纯规则 —— 与改造前逐字一致.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/r9-deliberation-mode-config.spec.ts 覆盖三态解析 /
//        白名单解析 / 非法值回退 / 总开关折叠 / 场景路由判定

import type { ConfigService } from '@nestjs/config';

import { resolveDeliberationEnabled } from './llm-deliberation.service.js';

/**
 * 审议的**生效模式** (三态).
 *
 * ⚠️ **缺省 = `shadow`** —— 影子模式是当前的生产现状 (审议跑, 结果只观察不生效).
 *   缺省必须是它, 不能是 `llm_active` —— 换句话说, **不配 env = 行为与改造前一致**.
 */
export type DeliberationEffectiveMode = 'shadow' | 'rule_only' | 'llm_active';

/** 生效模式的**唯一**合法取值清单 (解析用的白名单). */
export const DELIBERATION_EFFECTIVE_MODES: readonly DeliberationEffectiveMode[] = ['shadow', 'rule_only', 'llm_active'];

/**
 * 审议侧的**规范场景类型** (适配层权威定义).
 *
 * ⚠️ **为什么放在这里**: 场景类型同时被三处消费 ——
 *   ① `ScenarioRouteConfig` 的三个键 (本文件);
 *   ② 逐场审议模式的判定 (本文件 `resolveSessionEffectiveMode`);
 *   ③ auto-practice 的 `ScenarioType` (业务层).
 *   三处各写一份字面量 = 迟早漂移 (加了一个新场景, 忘了改第三处 → 判定按旧场景跑).
 *   所以定义收口在这里, 业务层 import/re-export 本类型 (**不复制**).
 *
 * ⚠️ **值集合与 `ScenarioRouteConfig` 的键一一对应** —— 键名即场景名, 不另造别名.
 */
export type DeliberationScenarioType = 'freeform' | 'full_simulation' | 'exam';

/**
 * 场景类型的**运行时取值清单** (解析/校验用).
 *
 * ⚠️ 为什么类型之外还要清单: 类型是编译期的事, 清单才是运行期能遍历/校验的东西
 *   (落盘记录的字段解析、接口入参校验都用它) —— 与 `GATE_MODE_VALUES` 同款纪律.
 */
export const DELIBERATION_SCENARIO_TYPES: readonly DeliberationScenarioType[] = ['freeform', 'full_simulation', 'exam'];

/**
 * 场景路由配置 (蓝图 §6 Phase 3A "两种模式可配置切换" 的**预留结构**).
 *
 * ⚠️ **这张表是"预留结构", 不是判定依据** —— 逐场判定只由
 *   `resolveSessionEffectiveMode` 出值 (见下), 这张表不参与判定.
 *
 * ⚠️ **考核场景恒为 `rule_only`** —— 蓝图 §7 红线 4: "考核场景必须能锁版本、
 *   锁温度、逐字复现". LLM 审议做不到逐字复现 (模型输出不可复现), 所以考核场景
 *   **永远不切 LLM** —— 这条写死在类型里, 不是靠配置自觉.
 */
export interface ScenarioRouteConfig {
  /** 自由练习 (零压域). */
  readonly freeform: DeliberationEffectiveMode;
  /** 全真执业 (零压域). */
  readonly full_simulation: DeliberationEffectiveMode;
  /** 考核 —— **恒为 rule_only** (可复现性红线), 不接受配置覆盖. */
  readonly exam: 'rule_only';
}

/**
 * 灰度切换的装配结果.
 *
 * ⚠️ `grayscaleSessions` 为**空集**时的语义:
 *     空 = **全量生效** (全局模式说了算) —— 与 `ENGINE_STREAM_GRAYSCALE_SESSIONS`
 *     同一口径 (空 = 总开关打开即全量). 灰度期运维要么配名单 (局部), 要么清空 (全量),
 *     两条路都走得通, 不用猜.
 */
export interface DeliberationModeConfig {
  /** 全局生效模式 (缺省 shadow). */
  readonly effectiveMode: DeliberationEffectiveMode;
  /** 灰度会话白名单 (空 = 全量). */
  readonly grayscaleSessions: ReadonlySet<string>;
  /** 单场会话的审议超时上限 (ms) —— 超时即回退规则 delta. */
  readonly timeoutMs: number;
  /** 场景路由 (预留; 本单不接). */
  readonly scenarioRoutes: ScenarioRouteConfig;
}

/** 审议超时的缺省值 (ms) —— 与影子模式 `DEFAULT_DELIBERATION_TIMEOUT_MS` 同值. */
export const DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS = 3000;

/**
 * 解析生效模式.
 *
 * ⚠️ **非法值 → 回退 `shadow`** (不抛错):
 *     `shadow` 是**最保守**的方向 (审议跑但不生效) —— 填错一个 env 不该让整场
 *     对练的行为面目全非. 回退到 shadow = 退回当前生产现状, 零回归.
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns 合法生效模式
 */
export function resolveDeliberationEffectiveMode(raw: string | undefined): DeliberationEffectiveMode {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized.length === 0) return 'shadow';
  return (DELIBERATION_EFFECTIVE_MODES as readonly string[]).includes(normalized) ? (normalized as DeliberationEffectiveMode) : 'shadow';
}

/**
 * 解析灰度会话白名单 (逗号分隔).
 *
 * 与 `voice.service.ts` 的 `parseSessionWhitelist` 同一口径:
 *   空串 / 缺省 → **空集合** (= 全量生效).
 *
 * @param raw env 原值
 * @returns 会话 id 集合
 */
export function parseDeliberationGrayscaleSessions(raw: string | undefined): ReadonlySet<string> {
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
 * ⚠️ 与 `llm-deliberation.service.ts` 的 `resolveTimeoutMs` 同一思路 (填错不抛错),
 *   但**本单刻意不复用那个函数** —— 那是影子模式服务的私有方法, 跨类复用会把它
 *   的实现细节暴露出去. 两处口径一致 (都取同一个 env 键, 都回退 3000), 判定仍是**一份**
 *   (都读 `ENGINE_DELIBERATION_TIMEOUT_MS`).
 *
 * @param raw env 原值
 * @returns 合法超时 (ms), 恒 > 0
 */
export function resolveDeliberationEffectiveTimeoutMs(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIBERATION_EFFECTIVE_TIMEOUT_MS;
  return Math.floor(parsed);
}

/**
 * 装配灰度切换配置.
 *
 * ⚠️ **场景路由表在本单恒为全 `rule_only`** —— 场景类型机制还没建, 现在配任何
 *   场景路由都是猜. Phase 4 建好场景类型后再接这张表 (本函数是唯一的接入口).
 *
 * @param config 配置服务 (读 env)
 * @returns 灰度切换配置
 */
export function resolveDeliberationModeConfig(config: ConfigService): DeliberationModeConfig {
  // ⚠️ **总开关先于模式**: `ENGINE_DELIBERATION_ENABLED` 关着 = **一次 LLM 都不发** ——
  //   哪怕模式写着 `llm_active` 也不跑.
  //   为什么不是"两个开关各管各的": 两个开关能互相打架时, 运维会踩到最难查的那种坑
  //   ("以为在灰度, 其实没生效" / "以为关了, 其实还在烧钱"). 少一个开关 = 少一类歧义.
  //   缺省 (ENABLED 未配 = 关) → 模式一律降级成 `rule_only` → 行为与改造前逐字一致.
  const enabled = resolveDeliberationEnabled(config.get<string>('ENGINE_DELIBERATION_ENABLED'));
  const mode = resolveDeliberationEffectiveMode(config.get<string>('ENGINE_DELIBERATION_EFFECTIVE_MODE'));
  return {
    effectiveMode: enabled ? mode : 'rule_only',
    grayscaleSessions: parseDeliberationGrayscaleSessions(config.get<string>('ENGINE_DELIBERATION_GRAYSCALE_SESSIONS')),
    timeoutMs: resolveDeliberationEffectiveTimeoutMs(config.get<string>('ENGINE_DELIBERATION_TIMEOUT_MS')),
    scenarioRoutes: {
      freeform: 'rule_only',
      full_simulation: 'rule_only',
      exam: 'rule_only',
    },
  };
}

/**
 * 判定**某一场会话**最终走哪个生效模式.
 *
 * ⚠️ **本函数是逐场审议模式的唯一真相源** —— 运行时钩子与落库指纹都调它,
 *   谁也不另抄一份 (抄一份 = 迟早漂移, 于是"记录说谎": 库写着 rule_only,
 *   实际在跑 LLM 审议).
 *
 * 判定链 (自上而下, 第一个命中即返回):
 *   0. **场景 = `exam` → `rule_only`** (考核场景红线, **优先于一切全局/白名单判定**);
 *   1. 全局模式 = `rule_only` → `rule_only` (纯规则; 灰度名单无关 —— 运维说全关就全关);
 *   2. 全局模式 = `shadow` → `shadow` (影子; 灰度名单无关 —— 影子不影响任何行为);
 *   3. 全局模式 = `llm_active` → 名单内会话 `llm_active`, 名单外 `rule_only`.
 *      (名单为空 = 全量 → 全部 `llm_active`).
 *
 * ⚠️ **名单外为什么是 `rule_only` 而不是 `shadow`**:
 *     名单外会话此刻是**纯规则**状态 —— 它没跑过审议, 也不该跑. 若让它跑影子模式,
 *     就等于"名单外也在烧 LLM" (成本白花) 且让人误以为灰度范围没生效.
 *
 * ⚠️ **为什么 exam 排在第 0 条 (而不是跟全局模式并列)**:
 *     考核场景要"锁版本、逐字复现" (蓝图 §7 红线 4) —— 只要**有任何**路径能让它
 *     跑 LLM 审议, 逐字复现就没了. 而白名单是运维手段: 灰度期有人把某场考核会话
 *     误加进名单 (或者名单本来就是"全部会话"), 考核就悄悄烧起了 LLM ——
 *     不可复现的数据混进考核数据集, 事后没人查得出来. 所以 exam 是**红线**:
 *     不接受任何配置覆盖, 也不接受名单覆盖.
 *
 * @param modeConfig 装配好的配置
 * @param sessionId 会话 id (引擎侧口径 —— 与运行时钩子、白名单匹配同一口径)
 * @param scenarioType 本场场景类型
 * @returns 该会话的生效模式
 */
export function resolveSessionEffectiveMode(
  modeConfig: DeliberationModeConfig,
  sessionId: string,
  scenarioType: DeliberationScenarioType,
): DeliberationEffectiveMode {
  // 场景红线: 考核场景恒 rule_only (可复现性, 优先于一切全局/白名单判定).
  if (scenarioType === 'exam') return 'rule_only';
  if (modeConfig.effectiveMode === 'rule_only') return 'rule_only';
  if (modeConfig.effectiveMode === 'shadow') return 'shadow';
  if (modeConfig.grayscaleSessions.size === 0) return 'llm_active';
  return modeConfig.grayscaleSessions.has(sessionId) ? 'llm_active' : 'rule_only';
}

/**
 * 判定**某一场会话**是否启用 LLM 审议生效.
 *
 * 便捷判定 —— 与 `resolveSessionEffectiveMode(...) === 'llm_active'` 等价.
 *
 * @param modeConfig 装配好的配置
 * @param sessionId 会话 id (引擎侧口径)
 * @param scenarioType 本场场景类型
 * @returns true = 该会话走 LLM 审议生效
 */
export function isLlmDeliberationActiveForSession(
  modeConfig: DeliberationModeConfig,
  sessionId: string,
  scenarioType: DeliberationScenarioType,
): boolean {
  return resolveSessionEffectiveMode(modeConfig, sessionId, scenarioType) === 'llm_active';
}
