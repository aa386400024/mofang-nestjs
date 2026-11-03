// V2026-11-03 WP42 (B 层 · 咨询同盟三维系数装配):
//   职责: 把 env 里的 `ENGINE_ALLIANCE_*` 键装配成内核的 `AllianceConfig` 端口.
//   边界: 只做"读 env → 校验 → 组装"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么这一层存在 (照 WP26 P2-14 / WP34 的先例):
//     内核不得有任何进程级外部依赖 —— 同盟三维的系数与门槛也不例外. 依赖方向是:
//       env → (本文件, 适配层) → AllianceConfig → (内核端口).
//     内核只认端口, 不认 env —— 于是"内核零 process.env"这条不变量继续成立
//     (boundary.spec.ts 断言⑩ 守着).
//
//   为什么 25 个键**逐个显式读** (而不是循环读计算键):
//     仓库 env 治理约定 (typings/global.d.ts) 要求"显式声明到 ProcessEnv, 不用
//     bracket 访问绕过". 计算键 (`ENGINE_ALLIANCE_${kind}_${dim}`) 编译器拦不住,
//     属静默偏离; 而 `config.get<string>('字面量')` 能被 env 覆盖断言
//     (test/config/wp25-env-example-coverage.spec.ts) 的 AST 抽取看到 ——
//     漏写一个键, 那个断言立刻变红.
//
//   非法值一律**不覆写** (等价回退内核基础值, 不抛错):
//     填错一个 env 不该让整场对练的 BDI 迁移失真 —— 不覆写就是照常走 DELTA_TABLE
//     的基础系数, 行为仍然确定.
//
//   ⚠️ 系数是**工程种子值, 非临床标定** —— 待真实对练校准.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp42-alliance-config.spec.ts 覆盖组装与非法值回退
//     3. test/config/wp25-env-example-coverage.spec.ts 断言③d 守住"逐个字面量读 + 内核零 env"

import type { ConfigService } from '@nestjs/config';

import { DEFAULT_ALLIANCE_CONFIG, type AllianceConfig, type AllianceDeltaOverride } from '../../engine-core/index.js';
import type { CounselorEventKind } from '../../engine-core/index.js';

/**
 * 解析一个同盟三维的增量覆写值.
 *
 * @param raw env 原值 (未设 / 空串 / 非数字 → 不覆写, 走内核基础值)
 * @returns 有效增量; undefined = 不覆写
 */
function resolveDelta(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return undefined;
  return value;
}

/**
 * 解析一个 [0,1] 区间的门槛 (非法 → 回退内核种子值).
 */
function resolveThreshold(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * 装配单个事件的覆写项 (两个 env 值 → 一个可选的覆写对象).
 *
 * 两个维度都非法 → 返回 undefined (该事件完全走内核基础值).
 */
function resolveOverride(safetyRaw: string | undefined, bondRaw: string | undefined): AllianceDeltaOverride | undefined {
  const safety = resolveDelta(safetyRaw);
  const bond = resolveDelta(bondRaw);
  if (safety === undefined && bond === undefined) return undefined;
  return {
    ...(safety === undefined ? {} : { safety }),
    ...(bond === undefined ? {} : { bond }),
  };
}

/**
 * 装配同盟三维端口 (11 种事件 × 2 维覆写 + 3 个门槛 = 25 个 env 键).
 *
 * 键名口径:
 *   · 系数覆写: `ENGINE_ALLIANCE_<事件>_SAFETY` / `ENGINE_ALLIANCE_<事件>_BOND`
 *     (事件大写: EMPATHY / ACCEPTANCE / NORMALIZATION / OPEN_PROBE / AFFIRMATION /
 *      JUDGMENT / PREACHING / MINIMIZING / BOUNDARY_CROSS / SENSITIVE_TOUCH / NEUTRAL);
 *   · 门槛: `ENGINE_ALLIANCE_OPEN_THRESHOLD` /
 *     `ENGINE_ALLIANCE_RESIST_TRUST_THRESHOLD` /
 *     `ENGINE_ALLIANCE_RESIST_SAFETY_THRESHOLD`.
 *
 * @param config 配置服务 (读 env)
 * @returns 内核的同盟三维端口 (缺省 = 内核种子值)
 */
export function resolveAllianceConfig(config: ConfigService): AllianceConfig {
  const deltas: Partial<Record<CounselorEventKind, AllianceDeltaOverride>> = {};

  const empathy = resolveOverride(config.get<string>('ENGINE_ALLIANCE_EMPATHY_SAFETY'), config.get<string>('ENGINE_ALLIANCE_EMPATHY_BOND'));
  if (empathy) deltas.empathy = empathy;

  const acceptance = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_ACCEPTANCE_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_ACCEPTANCE_BOND'),
  );
  if (acceptance) deltas.acceptance = acceptance;

  const normalization = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_NORMALIZATION_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_NORMALIZATION_BOND'),
  );
  if (normalization) deltas.normalization = normalization;

  const openProbe = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_OPEN_PROBE_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_OPEN_PROBE_BOND'),
  );
  if (openProbe) deltas.open_probe = openProbe;

  const affirmation = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_AFFIRMATION_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_AFFIRMATION_BOND'),
  );
  if (affirmation) deltas.affirmation = affirmation;

  const judgment = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_JUDGMENT_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_JUDGMENT_BOND'),
  );
  if (judgment) deltas.judgment = judgment;

  const preaching = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_PREACHING_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_PREACHING_BOND'),
  );
  if (preaching) deltas.preaching = preaching;

  const minimizing = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_MINIMIZING_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_MINIMIZING_BOND'),
  );
  if (minimizing) deltas.minimizing = minimizing;

  const boundaryCross = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_BOUNDARY_CROSS_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_BOUNDARY_CROSS_BOND'),
  );
  if (boundaryCross) deltas.boundary_cross = boundaryCross;

  const sensitiveTouch = resolveOverride(
    config.get<string>('ENGINE_ALLIANCE_SENSITIVE_TOUCH_SAFETY'),
    config.get<string>('ENGINE_ALLIANCE_SENSITIVE_TOUCH_BOND'),
  );
  if (sensitiveTouch) deltas.sensitive_touch = sensitiveTouch;

  const neutral = resolveOverride(config.get<string>('ENGINE_ALLIANCE_NEUTRAL_SAFETY'), config.get<string>('ENGINE_ALLIANCE_NEUTRAL_BOND'));
  if (neutral) deltas.neutral = neutral;

  const seed = DEFAULT_ALLIANCE_CONFIG.thresholds;
  return {
    deltas,
    thresholds: {
      open: resolveThreshold(config.get<string>('ENGINE_ALLIANCE_OPEN_THRESHOLD'), seed.open),
      resistanceTrust: resolveThreshold(config.get<string>('ENGINE_ALLIANCE_RESIST_TRUST_THRESHOLD'), seed.resistanceTrust),
      resistanceSafety: resolveThreshold(config.get<string>('ENGINE_ALLIANCE_RESIST_SAFETY_THRESHOLD'), seed.resistanceSafety),
    },
  };
}
