// V2026-11-08 WP60 (引擎内核 · delta 规则表配置端口):
//   职责: 事件 → delta 增量的**系数端口** —— 内核只认这个对象, 不认 env,
//         不认"写死在算子里"的数字.
//   边界: 纯 TS, 零 env / 零 IO / 零随机 / 零全局状态. 与 WP26 P2-14 的
//         DeltaCapConfig、WP34 的 PersonalityModulatorConfig、WP42 的
//         AllianceConfig、WP36 的 SessionDecayConfig 同一范式.
//
//   为什么要有这一层 (任务单 §1.1 的动机):
//     DELTA_TABLE 里那 11 个事件的系数是**工程种子值** —— 内测期要按真实对练
//     校准, 那是改配置的事, 不是改算子逻辑的事. 改一个数字要发版, 太慢.
//     依赖方向固定为:
//       env → (适配层) → DeltaTableConfig → (内核端口).
//     内核零 env 读取 (boundary.spec.ts 断言⑩ 守着).
//
//   反双胞胎 (与 alliance-config.ts 同一纪律):
//     - 不在这里重写 DELTA_TABLE 的基础系数 (单一真相源: 基础表仍住
//       state-transition.ts, 端口只做**覆写**);
//     - 不在这里读 env (内核零进程级依赖);
//     - 不把 alliance 的 safety / bond 逻辑搬进来 (那两个维度的优先级由
//       resolveDeltaVector 一处裁决, 不在两个文件里各写一遍).
//
//   覆写**按维度**生效 (不是按事件整体覆盖):
//     只配了 trust → trust 走覆写值, safety / bond / 其余维度走基础值.
//     这与 AllianceConfig 的覆写语义一致 —— 两处各管各的维度, 不互相打架.
//
//   优先级 (逐维度, 从高到低):
//     1. DeltaTableConfig 的覆写 (env 配置, 本端口)
//     2. AllianceConfig 的覆写 (safety / bond 两个维度, WP42 的旧端口)
//     3. DELTA_TABLE 的基础值 (内核种子值)
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp60-delta-table-config.spec.ts 覆盖覆写 / 优先级 / 回落
//     3. test/engine-adapters/wp60-delta-table-config.spec.ts 覆盖 env 组装与非法值回退

import { resolveAllianceDelta, type AllianceConfig } from './alliance-config.js';
import type { DeltaVector } from './state-transition.js';
import type { CounselorEventKind } from '../domain/events/session-event.js';

/**
 * delta 的 11 个维度 (与 state-transition.ts 的 CAP_DIMS 同一集合).
 *
 * 为什么把它**导出**并让 cap 那边也用它:
 *   覆写表要按维度名索引, 适配层也要按维度名校验 env 里的 JSON 键 ——
 *   两处各写一份维度名单 = 两张会漂的清单 (仓库既有纪律:
 *   "两处各算一遍 = 两张会漂的定价表").
 *   名单只有这一份, 适配层从内核公开面拿.
 *
 * ⚠️ 顺序 = cap 报告的维度顺序 (与 state-transition.ts 的 CAP_DIMS 同序).
 */
export const DELTA_DIMENSIONS = [
  'trust',
  'safety',
  'bond',
  'verbal',
  'depth',
  'style',
  'valence',
  'arousal',
  'positive',
  'negative',
  'dependency',
] as const;

/** delta 维度名. */
export type DeltaDimension = (typeof DELTA_DIMENSIONS)[number];

/**
 * 编译期断言: DELTA_DIMENSIONS 与 DeltaVector 的维度集合必须**逐字一致**.
 *
 * 为什么要有这条断言:
 *   覆写表按维度名索引 —— 名单少一个维度 = 那个维度永远配不上 (静默失效);
 *   名单多一个维度 = 覆写值会被存下来却**没有任何地方消费** (同样是静默失效).
 *   两条都是"配了不生效", 所以在编译期就钉死.
 */
export type DeltaDimensionsMatch =
  Exclude<keyof DeltaVector, DeltaDimension> extends never
    ? Exclude<DeltaDimension, keyof DeltaVector> extends never
      ? true
      : never
    : never;

/**
 * 让上面那条断言**被求值**的运行时常量 (恒为 true).
 *
 * 为什么需要一个死常量: 类型别名是**惰性**的 —— 没人引用它就不会求值,
 * 断言也就不会真的报错. 这里给它一个值位置 (const 标注), 类型就必须求值:
 * 维度名单与 DeltaVector 对不上时, DeltaDimensionsMatch 解析成 never,
 * 于是变成"给 never 赋值" → **编译期直接报错**.
 *
 * ⚠️ 运行时它没有任何作用 (纯死代码) —— 它的唯一职责是让类型断言生效.
 */
export const DELTA_DIMENSIONS_MATCH: DeltaDimensionsMatch = true;

/**
 * 单个事件的**维度级**增量覆写.
 *
 * 为什么是 Partial 而不是整个 DeltaVector:
 *   覆写的意义就是"只改要改的那几维" —— 全部 11 维都必填的话,
 *   "只配 trust" 这件事在类型层面就表达不了.
 */
export type DeltaDimensionOverride = Readonly<Partial<DeltaVector>>;

/**
 * 每种事件的维度级增量覆写表.
 *
 * 缺整项 = 该事件走 DELTA_TABLE 的基础值.
 */
export type DeltaTableOverrides = Readonly<Partial<Record<CounselorEventKind, DeltaDimensionOverride>>>;

/**
 * delta 规则表端口 (内核只认这个对象, 不认 env).
 *
 * 缺省 = `DEFAULT_DELTA_TABLE_CONFIG` (内核种子值), env 只做覆写.
 */
export interface DeltaTableConfig {
  /** 每种事件的维度级增量覆写 (缺项 / 缺维度 = DELTA_TABLE 的基础值). */
  readonly deltas: DeltaTableOverrides;
}

/**
 * 内核默认端口 (空覆写 = 全走基础值).
 *
 * ⚠️ 系数本体 (DELTA_TABLE) **不在这里** —— 它的真相源是
 *   state-transition.ts. 这里只声明"没有覆写"这件事.
 */
export const DEFAULT_DELTA_TABLE_CONFIG: DeltaTableConfig = {
  deltas: {},
};

/**
 * 取一个覆写值 (非法 → 回退基础值).
 *
 * 为什么内核还要再校验一遍 (适配层已经校验过 env):
 *   端口是**公开契约**, 任何人都能 new 一个配置塞进来. 一个 NaN 增量若直接生效,
 *   会让整轮 delta 变成 NaN —— 而 NaN 会被 clamp01 静默吞成 0,
 *   表现为"这一轮什么也没发生" (最难查的那一类静默失效).
 *   内核这层兜底保证**无论谁注入, 增量永远是有限数**.
 *
 * @param value 覆写值 (undefined = 没配这一维)
 * @param fallback 基础值
 * @returns 有效增量
 */
function pickOverride(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 解析某事件在某配置下**实际生效**的 delta 向量 (逐维度).
 *
 * 优先级 (逐维度, 从高到低):
 *   1. `table` 的覆写 (DeltaTableConfig · env 配置)
 *   2. `alliance` 的覆写 (AllianceConfig · 只管 safety / bond 两个维度)
 *   3. `base` (DELTA_TABLE 的基础值)
 *
 * 为什么 alliance 只参与 safety / bond:
 *   AllianceConfig 的端口形状本来就只暴露这两个维度 (WP42 的设计:
 *   同盟三维的**系数**只覆写 safety / bond, trust 归基础表).
 *   也就是说"两者各管各的维度"这件事不是本函数临时定的规矩,
 *   而是两个端口的**类型**已经把它定死了 —— 本函数只是把这条规则写在一处.
 *
 * @param kind 事件类型
 * @param base DELTA_TABLE 的基础增量 (11 维齐全)
 * @param table delta 规则表端口 (缺省 = 不覆写)
 * @param alliance 同盟三维端口 (缺省 = 不覆写)
 * @returns 生效的 delta 向量 (11 维齐全, 值全部是有限数)
 */
export function resolveDeltaVector(
  kind: CounselorEventKind,
  base: DeltaVector,
  table?: DeltaTableConfig,
  alliance?: AllianceConfig,
): DeltaVector {
  const tableOverride = table?.deltas[kind];
  // WP42 的旧端口只管 safety / bond —— **复用**内核已有的解析, 不在这里重写一遍
  //   (两处各算一遍 alliance = 两张会漂的表).
  const allianceDelta = resolveAllianceDelta(kind, base, alliance?.deltas);
  return {
    trust: pickOverride(tableOverride?.trust, base.trust),
    safety: pickOverride(tableOverride?.safety, allianceDelta.safety),
    bond: pickOverride(tableOverride?.bond, allianceDelta.bond),
    verbal: pickOverride(tableOverride?.verbal, base.verbal),
    depth: pickOverride(tableOverride?.depth, base.depth),
    style: pickOverride(tableOverride?.style, base.style),
    valence: pickOverride(tableOverride?.valence, base.valence),
    arousal: pickOverride(tableOverride?.arousal, base.arousal),
    positive: pickOverride(tableOverride?.positive, base.positive),
    negative: pickOverride(tableOverride?.negative, base.negative),
    dependency: pickOverride(tableOverride?.dependency, base.dependency),
  };
}
