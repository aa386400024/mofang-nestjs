// V2026-11-03 WP42 (引擎内核 · 咨询同盟三维 · 端口):
//   职责: 同盟三维 (信任 / 安全感 / 纽带感) 的**系数与门槛端口** —— 内核只认这个
//         对象, 不认 env, 不认"写死在算子里"的数字.
//   边界: 纯 TS, 零 env / 零 IO / 零随机 / 零全局状态. 与 WP26 P2-14 的
//         DeltaCapConfig、WP34 的 PersonalityModulatorConfig 同一范式.
//
//   为什么要有这一层 (任务单 §4 "新字段走注入, 不硬编码到内核"):
//     同盟三维的系数与门槛是**部署形态**的决定 —— 内测期要按真实对练校准,
//     那是改配置的事, 不是改算子逻辑的事. 依赖方向固定为:
//       env → (适配层) → AllianceConfig → (内核端口).
//     内核零 env 读取 (boundary.spec.ts 断言⑩ 守着).
//
//   两块内容:
//     ① deltas —— 每种事件对 safety / bond 的增量**覆写**.
//        为什么是"覆写"而不是"整表": 基础系数表在 `state-transition.ts` 的
//        DELTA_TABLE (任务单 §3.3 的表逐字照搬在那里), 端口只做覆写 ——
//        两处各写一份完整表 = 两个会漂移的真相源 (仓库反双胞胎纪律).
//        覆写按**维度**生效: 只给 safety 时, bond 仍走 DELTA_TABLE 的基础值.
//     ② thresholds —— 意图规划的门槛 (探索 / 抗拒).
//        门槛也是部署级参数: "多信任一点才敢探索"这条线, 内测期大概率要调.
//
//   反双胞胎:
//     - 不在这里重写 DELTA_TABLE 的基础系数 (单一真相源);
//     - 不在这里读 env (内核零进程级依赖);
//     - 不把人格调节搬进来 (任务单 §3.5: 依恋系数本期只调 trust, safety / bond
//       不调 —— 任务单没给依恋对安全感 / 纽带的影响系数, 不发明临床数字).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp42-alliance-three-dimensions.spec.ts 覆盖覆写 / 回落 / 门槛
//     3. test/engine-adapters/wp42-alliance-config.spec.ts 覆盖 env 组装与非法值回退

import type { CounselorEventKind } from '../domain/events/session-event.js';

/**
 * 单个事件对同盟三维的增量**覆写** (两个维度各自可缺省).
 *
 * 缺省的维度 = 走 DELTA_TABLE 的基础值 (见文件头"覆写"说明).
 */
export interface AllianceDeltaOverride {
  /** 安全感增量覆写 (缺省 = 基础值). */
  readonly safety?: number;
  /** 纽带感增量覆写 (缺省 = 基础值). */
  readonly bond?: number;
}

/**
 * 每种事件的同盟三维增量覆写表.
 *
 * 缺整项 = 该事件走 DELTA_TABLE 的基础值.
 */
export type AllianceDeltaOverrides = Readonly<Partial<Record<CounselorEventKind, AllianceDeltaOverride>>>;

/**
 * 同盟三维的**决策门槛**.
 *
 * 门槛与系数分开: 系数管"每轮动多少", 门槛管"什么时候换策略" —— 两者调参节奏不同.
 */
export interface AllianceThresholds {
  /**
   * 探索门槛: `min(trust, safety) >= open` 才进探索模式.
   *
   * 为什么取 min 而不是只看 trust: 来访可能相信咨询师的专业 (trust 高),
   * 但在这段关系里仍不敢说真话 (safety 低) —— 这时探索是逼问, 不是帮助.
   */
  readonly open: number;
  /** 抗拒门槛 (信任维): `trust < resistanceTrust` 即倾向抗拒. */
  readonly resistanceTrust: number;
  /** 抗拒门槛 (安全感维): `safety < resistanceSafety` 即倾向抗拒. */
  readonly resistanceSafety: number;
}

/**
 * 同盟三维端口 (内核只认这个对象, 不认 env).
 *
 * 缺省 = `DEFAULT_ALLIANCE_CONFIG` (内核种子值), env 只做覆写.
 */
export interface AllianceConfig {
  /** 每种事件的 safety / bond 增量覆写 (缺项 = DELTA_TABLE 的基础值). */
  readonly deltas: AllianceDeltaOverrides;
  /** 意图规划的门槛. */
  readonly thresholds: AllianceThresholds;
}

/**
 * 内核种子值 (工程种子值, **非临床标定** —— 待真实对练校准).
 *
 * 门槛数值来自任务单 §3.4 (0.6 / 0.4 / 0.3); 系数不在这里 ——
 * 基础系数表的真相源是 `state-transition.ts` 的 DELTA_TABLE (任务单 §3.3).
 */
export const DEFAULT_ALLIANCE_CONFIG: AllianceConfig = {
  deltas: {},
  thresholds: {
    open: 0.6,
    resistanceTrust: 0.4,
    resistanceSafety: 0.3,
  },
};

/**
 * 阈值校验 (非法 → 回退种子值).
 *
 * 为什么内核还要再校验一遍 (适配层已经校验过 env):
 *   端口是**公开契约**, 任何人都能 new 一个配置塞进来. 一个越界阈值
 *   (open = 5) 若直接生效, 会让探索模式永远进不去 —— 而调用方以为"配好了".
 *   内核这层兜底保证**无论谁注入, 门槛都落在 [0,1]**.
 */
function sanitizeThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * 解析同盟三维的有效门槛 (端口缺项 / 非法 → 逐项回退内核种子值).
 */
export function resolveAllianceThresholds(config: AllianceConfig | undefined): AllianceThresholds {
  const seed = DEFAULT_ALLIANCE_CONFIG.thresholds;
  const provided = config?.thresholds;
  if (!provided) return seed;
  return {
    open: sanitizeThreshold(provided.open, seed.open),
    resistanceTrust: sanitizeThreshold(provided.resistanceTrust, seed.resistanceTrust),
    resistanceSafety: sanitizeThreshold(provided.resistanceSafety, seed.resistanceSafety),
  };
}

/**
 * 解析某事件的同盟三维增量 (端口覆写优先, 缺项回基础值).
 *
 * @param kind 事件类型
 * @param base DELTA_TABLE 的基础增量 (safety / bond 两项)
 * @param overrides 端口给的覆写表
 */
export function resolveAllianceDelta(
  kind: CounselorEventKind,
  base: { readonly safety: number; readonly bond: number },
  overrides: AllianceDeltaOverrides | undefined,
): { readonly safety: number; readonly bond: number } {
  const override = overrides?.[kind];
  if (!override) return base;
  return {
    safety: override.safety ?? base.safety,
    bond: override.bond ?? base.bond,
  };
}
