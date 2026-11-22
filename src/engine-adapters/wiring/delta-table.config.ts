// V2026-11-08 治本 (WP60 · B 层 · delta 规则表配置装配):
//   职责: 把 env 里的 `ENGINE_DELTA_*` 键装配成内核的 `DeltaTableConfig` 端口.
//   边界: 只做"读 env → 解析 JSON → 校验 → 组装"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么这一层存在 (照 WP26 P2-14 / WP34 / WP42 / WP36 的先例):
//     内核不得有任何进程级外部依赖 —— DELTA_TABLE 的系数也不例外. 依赖方向是:
//       env → (本文件, 适配层) → DeltaTableConfig → (内核端口).
//     内核只认端口, 不认 env —— 于是"内核零 process.env"这条不变量继续成立
//     (boundary.spec.ts 断言⑩ 守着).
//
//   键名口径: 每个事件一个 JSON 键 —— `ENGINE_DELTA_<事件大写>`
//     例: `ENGINE_DELTA_EMPATHY={"trust":0.15,"safety":0.02}`
//   为什么不是"每个维度一个键":
//     11 事件 × 11 维度 = 121 个 env 键 —— 那是没法维护的清单.
//     每事件一个 JSON 键: 11 个键, 且**只写要改的维度**, 其余回基础值.
//
//   非法值一律**不覆写** (等价回退内核基础值, 不抛错):
//     填错一个 env 不该让整场对练的 BDI 迁移失真 —— 不覆写就是照常走 DELTA_TABLE
//     的基础系数, 行为仍然确定.
//
//   ⚠️ 但"静默忽略"是本仓最费时间的排障陷阱, 所以这里**每条被丢弃的覆写都喊一声**:
//     onWarn 回调把"哪个键的哪个维度被丢了、为什么"送出去 (装配层接 logger).
//     静默丢弃 = 运维改了半天不生效, 却什么提示都没有.
//
//   ⚠️ 系数是**工程种子值, 非临床标定** —— 待真实对练校准.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp60-delta-table-config.spec.ts 覆盖组装与非法值回退

import type { ConfigService } from '@nestjs/config';

import { DELTA_DIMENSIONS, type CounselorEventKind, type DeltaDimensionOverride, type DeltaTableConfig } from '../../engine-core/index.js';

/** 维度名单 (内核公开面 —— 两处各写一份 = 两张会漂的清单). */
const DIMENSIONS: readonly string[] = DELTA_DIMENSIONS;

/** 告警回调 (装配层接 logger; 缺省 = 不告警, 纯静默回退). */
export type DeltaTableWarn = (message: string) => void;

/**
 * 解析单个事件的 JSON 覆写.
 *
 * @param envKey env 键名 (告警里要指明是哪个键)
 * @param raw env 原值 (未设 / 空串 → 无覆写)
 * @param onWarn 告警回调 (可选)
 * @returns 有效覆写; undefined = 该事件走基础值
 */
function parseEventOverride(
  envKey: string,
  raw: string | undefined,
  onWarn: DeltaTableWarn | undefined,
): DeltaDimensionOverride | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    onWarn?.(`${envKey}: 不是合法 JSON, 该事件已忽略 (走内核基础系数)`);
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    onWarn?.(`${envKey}: 必须是一个 JSON 对象 (如 {"trust":0.15}), 该事件已忽略`);
    return undefined;
  }

  const source = parsed as Record<string, unknown>;
  const override: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!DIMENSIONS.includes(key)) {
      onWarn?.(`${envKey}: 维度名 "${key}" 不是合法维度 (合法维度: ${DIMENSIONS.join(' / ')}), 已忽略`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      onWarn?.(`${envKey}: 维度 "${key}" 的值必须是有限数, 已忽略 (该维度走内核基础系数)`);
      continue;
    }
    override[key] = value;
  }
  // 一个维度都没解析出来 → 不留空壳条目 (端口里只放真正生效的覆写).
  if (Object.keys(override).length === 0) return undefined;
  return override;
}

/**
 * 装配 delta 规则表端口 (11 个事件 = 11 个 env 键).
 *
 * 键名口径: `ENGINE_DELTA_<事件大写>`
 *   (事件大写: EMPATHY / ACCEPTANCE / NORMALIZATION / OPEN_PROBE / AFFIRMATION /
 *    JUDGMENT / PREACHING / MINIMIZING / BOUNDARY_CROSS / SENSITIVE_TOUCH / NEUTRAL).
 *
 * ⚠️ **逐个字面量读** (而不是循环读计算键): 与 cap / 人格 / 同盟 / 衰减族同一治本 ——
 *   计算键 (`ENGINE_DELTA_${kind}`) 编译器拦不住, 属静默偏离; 而
 *   `config.get<string>('字面量')` 能被 env 覆盖断言 (AST 抽取) 直接看到 ——
 *   漏写一个键, 那条断言立刻变红.
 *
 * @param config 配置服务 (读 env)
 * @param onWarn 可选告警回调 (每条被丢弃的覆写喊一声; 缺省 = 静默)
 * @returns 内核的 delta 规则表端口 (缺省 = 内核基础系数)
 */
export function resolveDeltaTableConfig(config: ConfigService, onWarn?: DeltaTableWarn): DeltaTableConfig {
  const deltas: Partial<Record<CounselorEventKind, DeltaDimensionOverride>> = {};

  const empathy = parseEventOverride('ENGINE_DELTA_EMPATHY', config.get<string>('ENGINE_DELTA_EMPATHY'), onWarn);
  if (empathy) deltas.empathy = empathy;

  const acceptance = parseEventOverride('ENGINE_DELTA_ACCEPTANCE', config.get<string>('ENGINE_DELTA_ACCEPTANCE'), onWarn);
  if (acceptance) deltas.acceptance = acceptance;

  const normalization = parseEventOverride('ENGINE_DELTA_NORMALIZATION', config.get<string>('ENGINE_DELTA_NORMALIZATION'), onWarn);
  if (normalization) deltas.normalization = normalization;

  const openProbe = parseEventOverride('ENGINE_DELTA_OPEN_PROBE', config.get<string>('ENGINE_DELTA_OPEN_PROBE'), onWarn);
  if (openProbe) deltas.open_probe = openProbe;

  const affirmation = parseEventOverride('ENGINE_DELTA_AFFIRMATION', config.get<string>('ENGINE_DELTA_AFFIRMATION'), onWarn);
  if (affirmation) deltas.affirmation = affirmation;

  const judgment = parseEventOverride('ENGINE_DELTA_JUDGMENT', config.get<string>('ENGINE_DELTA_JUDGMENT'), onWarn);
  if (judgment) deltas.judgment = judgment;

  const preaching = parseEventOverride('ENGINE_DELTA_PREACHING', config.get<string>('ENGINE_DELTA_PREACHING'), onWarn);
  if (preaching) deltas.preaching = preaching;

  const minimizing = parseEventOverride('ENGINE_DELTA_MINIMIZING', config.get<string>('ENGINE_DELTA_MINIMIZING'), onWarn);
  if (minimizing) deltas.minimizing = minimizing;

  const boundaryCross = parseEventOverride('ENGINE_DELTA_BOUNDARY_CROSS', config.get<string>('ENGINE_DELTA_BOUNDARY_CROSS'), onWarn);
  if (boundaryCross) deltas.boundary_cross = boundaryCross;

  const sensitiveTouch = parseEventOverride('ENGINE_DELTA_SENSITIVE_TOUCH', config.get<string>('ENGINE_DELTA_SENSITIVE_TOUCH'), onWarn);
  if (sensitiveTouch) deltas.sensitive_touch = sensitiveTouch;

  const neutral = parseEventOverride('ENGINE_DELTA_NEUTRAL', config.get<string>('ENGINE_DELTA_NEUTRAL'), onWarn);
  if (neutral) deltas.neutral = neutral;

  return { deltas };
}
