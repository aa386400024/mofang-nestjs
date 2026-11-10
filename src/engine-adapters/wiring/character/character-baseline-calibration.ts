// V2026-11-10 治本 (WP-J · B 层 · 角色基线差异化标定 · 数值单一真相源):
//   职责: 8 个角色 (A 类 4 个有 seed 规格 + B 类 4 个 DB-only) 的**基线数值**唯一声明处,
//         外加"入库前必炸"的自检 (区间 / 情绪标签 / 可区分性 / 无维度塌缩).
//   边界: 纯数据 + 纯函数; 零 Nest 装饰器 / 零 IO / 零随机 / 零 prompt / 零 env.
//         **不改 engine-core** —— 情绪标签的判定阈值住内核, 本模块只**调用**它, 不重写.
//
//   为什么要有这个模块 (背景):
//     此前 character_profiles 的基线按"焦虑 / 回避两档一刀切": 同依恋风格的角色,
//     8 个基线字段一字不差 (晚晴 == 小满, 亦舟 == 念安) —— 同档角色在内核眼里是同一个人.
//     循证研究 (docs/reference/character-baseline-research.md v2) 用 20 篇文献 +
//     ECR-R 真实常模 (Fraley, N>17000) + 量化交叉核对, 给出 8 个角色各自独立的基线数值.
//     本模块把那张表**逐字**变成代码里的唯一真相源 (全仓再无第二份硬编码).
//
//   为什么"数值"与"内容"分开 (关注点分离 + 反双胞胎):
//     内容 (5Ps / 核心信念 / 底层愿望 / 负向约束 / 敏感议题 / 表达语态) 归 seed 模块;
//     数值 (trust / 三维阻抗 / valence / arousal / safety / bond) 归本模块.
//     两者唯一的接口 = **templateId** —— 内容与数值靠 templateId 对齐, 谁都不抄谁的数字.
//     于是"运营改文案"与"工程标数值"互不干扰, 也互不覆盖.
//
//   为什么情绪标签判定要**注入**而不是直接 import (与任务单 §三 的一处偏差, 见交付记录):
//     任务单要求"用真实 resolveEmotionLabel (从 engine-core/domain/emotion 导入), 不许重写阈值".
//     三条约束在这里互相打架:
//       ① 内核 barrel **没有**导出 resolveEmotionLabel (WP62 只补了 clamp01 / clampValence);
//       ② boundary.spec.ts 断言⑪ **禁止** adapter 深路径 import 内核内部模块
//          (只允许 barrel 与 in-memory/) —— 在 adapter 里写
//          `import ... from '../../../engine-core/domain/emotion.js'` 会让这条机器守卫变红;
//       ③ 给 barrel 补导出 = 改 engine-core (本单红线) + 改 boundary 断言白名单
//          (仓库明令"护栏不许自己拆").
//     结论: 采用**依赖注入** —— 阈值仍然只有内核一份, 调用方 (seed 脚本 / 单测) 把内核那个
//     **真函数**传进来. 本模块不含任何阈值副本, 也没有"没传就静默跳过"的分支
//     (参数是必填 → 忘了传编译期就报错).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/character-baseline-calibration.spec.ts 覆盖 8 行自检 +
//        真实标签逐行断言 (含沉舟 empty / 惊尘 hurt 两个边界) + 可区分性 + 无塌缩 + 负向用例
//     3. npm run seed:character-profiles 连跑两次 (第二次 B 类全"未变")
//
//   时间戳: 2026-11-10

import type { EmotionLabel } from '../../../engine-core/index.js';

/**
 * 一个角色的基线标定行 (8 个数值维度 + 期望情绪标签).
 *
 * 为什么**不带** displayName / attachmentStyle:
 *   这两样各有自己的真相源 (A 类在 seed 规格里, B 类在库里). 本模块再抄一份 = 第二份真相,
 *   迟早漂. 本模块只声明**数值** —— 数值是它唯一负责的东西.
 */
export interface CharacterBaselineCalibration {
  /** 公共模板 id (`vpt_*` slug) —— 内容与数值唯一的对齐键. */
  readonly templateId: string;
  /** 初始信任 [0,1]. */
  readonly trust: number;
  /** 三维阻抗基线 [0,1]. */
  readonly resistance: {
    readonly verbal: number;
    readonly depth: number;
    readonly style: number;
  };
  /** 情绪基调 (valence [-1,1] / arousal [0,1]). */
  readonly emotion: {
    readonly valence: number;
    readonly arousal: number;
  };
  /** 关系安全感基线 [0,1]. */
  readonly safety: number;
  /** 关系联结基线 [0,1]. */
  readonly bond: number;
  /** 期望的离散情绪标签 (由**真实**内核函数 resolveEmotionLabel 核对). */
  readonly expectedLabel: EmotionLabel;
}

/**
 * 情绪标签解析函数 (内核 `resolveEmotionLabel` 的形状).
 *
 * 为什么是端口而不是直接 import: 见文件头"为什么情绪标签判定要注入".
 * 调用方必须传**内核那个真函数** —— 于是阈值永远只有一份, 本模块无法偷偷重写.
 */
export type EmotionLabelResolver = (valence: number, arousal: number) => EmotionLabel;

/**
 * 区间自检的输入形状 (safety / bond 可选).
 *
 * 为什么 safety / bond 可选: seed 侧的类型把这两项声明为**可选** (缺省 = 走 DB DEFAULT),
 * 复用同一份区间校验时不能强行要求它们存在. 完整的标定行 (safety / bond 必填) 自然满足本形状.
 */
export interface BaselineRangeTarget {
  readonly templateId: string;
  readonly trust: number;
  readonly resistance: {
    readonly verbal: number;
    readonly depth: number;
    readonly style: number;
  };
  readonly emotion: {
    readonly valence: number;
    readonly arousal: number;
  };
  readonly safety?: number;
  readonly bond?: number;
}

/** 8 个基线维度的名字 (顺序 = 向量下标顺序). */
export const BASELINE_DIMENSION_KEYS = ['trust', 'verbal', 'depth', 'style', 'valence', 'arousal', 'safety', 'bond'] as const;

/** 基线维度名. */
export type BaselineDimensionKey = (typeof BASELINE_DIMENSION_KEYS)[number];

/**
 * 角色两两可区分阈值 (单维绝对差).
 *
 * 为什么是 0.05: 低于此值内核行为基本不可区分 (数值在快照里四舍五入后就是同一个数).
 * 这是**工程口径**, 不是临床结论.
 */
export const MIN_ROLE_DIMENSION_DISTANCE = 0.05;

/**
 * 浮点比较容差.
 *
 * 为什么需要: 十进制小数在 IEEE-754 下做减法会差最后一位 —— 0.70 − 0.30 实际算得
 * 0.39999999999999997, 比"精确的 0.40"小一点点. 若直接 `spread < 0.40` 判定, 一张
 * **完全合规**的表会被误判成"维度塌缩" —— 那是浮点误差, 不是标定问题.
 *
 * 容差取 1e-9: 比任何有意义的标定差值 (最小刻度 0.01) 小 7 个数量级,
 * 既不放过真正的塌缩 (0.399 仍会被判红), 又不让表示误差变成假红灯.
 */
const FLOAT_TOLERANCE = 1e-9;

/**
 * 数据库单精度 FLOAT 列的往返容差 (供"漂移判定"使用, 不用于跨度/可区分性判定).
 *
 * 为什么需要 (而且是 1e-6 而不是 1e-9): `character_profiles` 的基线列是 MySQL
 * **FLOAT (4 字节单精度)**. 0.65 写进去, 用 binary protocol 读回来是
 * `0.6499999761581421` —— 与字面值相差约 2.4e-8. 若漂移判定用裸 `!==` 或 1e-9 级容差,
 * "值其实没变"会被判成"有漂移" → 每次 seed 都 UPDATE. 当前 TypeORM 走 text protocol
 * (服务器把 FLOAT 格式化成 "0.65" 再解析) 所以该误差暂时不显现, 但这**依赖驱动的读取路径**,
 * 换成 prepared statement 就会暴露 —— 属于静默破功类风险, 必须显式容差兜住.
 *
 * 为什么 1e-6: 比单精度最大绝对误差 (约 6e-8) 大一个数量级, 又比标定最小刻度 (0.01)
 * 小 4 个数量级 —— 既不把存储误差当成真改动, 也不放过任何有意义的标定差异.
 */
export const STORAGE_FLOAT_TOLERANCE = 1e-6;

/**
 * 单维度跨角色的最小跨度 (max − min).
 *
 * 为什么是 0.40: 某一维若在 8 个角色上跨度不足, 说明这一维被压成了常数 —— 它对
 * "区分不同角色"毫无贡献, 要么白占一列, 要么说明标定漏了这一维. 同样是工程口径.
 */
export const MIN_DIMENSION_SPREAD = 0.4;

/**
 * 8 个角色的基线标定表 (唯一真相源).
 *
 * 数值来源: docs/reference/character-baseline-research.md §6 (v2 循证推导) 与任务单 §四,
 * **逐字照抄, 一个数都没改**. 其中两处是研究阶段做的真实函数边界修正:
 *   · 沉舟 arousal 0.18 (< 0.2) → 内核落 `empty` (迟滞空洞), 不是 `sad`;
 *   · 惊尘 arousal 0.64 (< 0.65) → 内核落 `hurt` (创伤以恐惧为主), 不是 `angry`.
 *
 * ⚠️ 数值是**工程标定值** (文献给排序 / 方向 / 剖面形状, 小数是工程锚点),
 *    不是临床标定 —— 待真实对练数据回来后再校准.
 */
export const CHARACTER_BASELINE_CALIBRATION: readonly CharacterBaselineCalibration[] = [
  {
    templateId: 'vpt_general_secure_l1',
    trust: 0.65,
    resistance: { verbal: 0.25, depth: 0.25, style: 0.3 },
    emotion: { valence: -0.15, arousal: 0.45 },
    safety: 0.7,
    bond: 0.5,
    expectedLabel: 'guarded',
  },
  {
    templateId: 'vpt_intimate_avoidance_l1',
    trust: 0.32,
    resistance: { verbal: 0.45, depth: 0.4, style: 0.35 },
    emotion: { valence: -0.45, arousal: 0.55 },
    safety: 0.35,
    bond: 0.65,
    expectedLabel: 'guarded',
  },
  {
    templateId: 'vpt_self_worth_intellectualization_l1',
    trust: 0.3,
    resistance: { verbal: 0.4, depth: 0.55, style: 0.65 },
    emotion: { valence: -0.48, arousal: 0.5 },
    safety: 0.35,
    bond: 0.55,
    expectedLabel: 'guarded',
  },
  {
    templateId: 'vpt_social_anxious_l1',
    trust: 0.35,
    resistance: { verbal: 0.55, depth: 0.3, style: 0.3 },
    emotion: { valence: -0.4, arousal: 0.72 },
    safety: 0.4,
    bond: 0.5,
    expectedLabel: 'anxious',
  },
  {
    templateId: 'vpt_depression_avoidant_l1',
    trust: 0.18,
    resistance: { verbal: 0.65, depth: 0.7, style: 0.55 },
    emotion: { valence: -0.65, arousal: 0.18 },
    safety: 0.2,
    bond: 0.15,
    expectedLabel: 'empty',
  },
  {
    templateId: 'vpt_grief_avoidance_l1',
    trust: 0.25,
    resistance: { verbal: 0.55, depth: 0.5, style: 0.5 },
    emotion: { valence: -0.55, arousal: 0.35 },
    safety: 0.25,
    bond: 0.2,
    expectedLabel: 'sad',
  },
  {
    templateId: 'vpt_workplace_intellectualization_l1',
    trust: 0.22,
    resistance: { verbal: 0.5, depth: 0.65, style: 0.7 },
    emotion: { valence: -0.55, arousal: 0.25 },
    safety: 0.25,
    bond: 0.1,
    expectedLabel: 'sad',
  },
  {
    templateId: 'vpt_trauma_disorganized_l1',
    trust: 0.1,
    resistance: { verbal: 0.5, depth: 0.6, style: 0.45 },
    emotion: { valence: -0.6, arousal: 0.64 },
    safety: 0.1,
    bond: 0.45,
    expectedLabel: 'hurt',
  },
];

/** 标定表按 templateId 索引 (查表 O(1), 装配时按 id 取值). */
export const BASELINE_CALIBRATION_BY_TEMPLATE_ID: ReadonlyMap<string, CharacterBaselineCalibration> = new Map(
  CHARACTER_BASELINE_CALIBRATION.map((row) => [row.templateId, row]),
);

/**
 * 按 templateId 取一行标定.
 *
 * 为什么找不到就抛: "角色内容存在, 但数值标定缺一行" 是**结构性错误** —— 那种角色会静默
 * 落回 DB DEFAULT, 变成"又一个平庸角色". 与其在库里等人发现, 不如当场炸.
 *
 * @param templateId 公共模板 id
 * @returns 该角色的标定行
 * @throws Error 标定表里没有这个 templateId
 */
export function getBaselineCalibration(templateId: string): CharacterBaselineCalibration {
  const row = BASELINE_CALIBRATION_BY_TEMPLATE_ID.get(templateId);
  if (!row) {
    throw new Error(`角色基线标定表缺少模板 ${templateId}`);
  }
  return row;
}

/**
 * 标定表自检 (入库前必炸).
 *
 * 四条规则:
 *   ① 区间: trust / 三维阻抗 / safety / bond / arousal ∈ [0,1]; valence ∈ [-1,1];
 *   ② 情绪标签: 用**真实**内核函数逐行核对 resolveEmotionLabel(valence, arousal) === expectedLabel;
 *   ③ 可区分性: 任意两个角色, 8 个维度中至少有一维绝对差 ≥ 0.05;
 *   ④ 无维度塌缩: 每个维度在全部角色上的 (max − min) ≥ 0.40.
 *
 * @param resolveLabel 情绪标签解析函数 (必须是内核那个真函数)
 * @param calibration 待检标定表 (缺省 = 权威表本身)
 * @returns 首条错误描述; 全部通过 → null
 */
export function validateBaselineCalibration(
  resolveLabel: EmotionLabelResolver,
  calibration: readonly CharacterBaselineCalibration[] = CHARACTER_BASELINE_CALIBRATION,
): string | null {
  const duplicate = findDuplicateTemplateId(calibration);
  if (duplicate) {
    return `角色基线标定表重复: ${duplicate}`;
  }

  for (const row of calibration) {
    const rangeError = validateBaselineRowRanges(row);
    if (rangeError) {
      return rangeError;
    }
    const labelError = validateBaselineRowLabel(resolveLabel, row);
    if (labelError) {
      return labelError;
    }
  }

  const distinguishError = validateBaselineDistinguishability(calibration);
  if (distinguishError) {
    return distinguishError;
  }

  return validateBaselineDimensionSpread(calibration);
}

/**
 * 单行区间自检 (标定行与 seed 规格共用这一份 —— 不写第二份区间逻辑).
 *
 * @param row 待检行
 * @returns 错误描述; 通过 → null
 */
export function validateBaselineRowRanges(row: BaselineRangeTarget): string | null {
  const unitValues: readonly { readonly name: string; readonly value: number }[] = [
    { name: '初始信任', value: row.trust },
    { name: 'verbal 阻抗', value: row.resistance.verbal },
    { name: 'depth 阻抗', value: row.resistance.depth },
    { name: 'style 阻抗', value: row.resistance.style },
    { name: '情绪唤醒', value: row.emotion.arousal },
  ];
  for (const { name, value } of unitValues) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return `角色 ${row.templateId} 的${name}越界: ${value}`;
    }
  }
  if (!Number.isFinite(row.emotion.valence) || row.emotion.valence < -1 || row.emotion.valence > 1) {
    return `角色 ${row.templateId} 的情绪效价越界: ${row.emotion.valence}`;
  }
  if (row.safety !== undefined && (!Number.isFinite(row.safety) || row.safety < 0 || row.safety > 1)) {
    return `角色 ${row.templateId} 的安全感基线越界: ${row.safety}`;
  }
  if (row.bond !== undefined && (!Number.isFinite(row.bond) || row.bond < 0 || row.bond > 1)) {
    return `角色 ${row.templateId} 的联结感基线越界: ${row.bond}`;
  }
  return null;
}

/**
 * 单行情绪标签自检 (用真实内核函数核对, 本模块不持有任何阈值).
 *
 * @param resolveLabel 情绪标签解析函数
 * @param row 待检行
 * @returns 错误描述; 通过 → null
 */
function validateBaselineRowLabel(resolveLabel: EmotionLabelResolver, row: CharacterBaselineCalibration): string | null {
  const actual = resolveLabel(row.emotion.valence, row.emotion.arousal);
  if (actual !== row.expectedLabel) {
    return (
      `角色 ${row.templateId} 的情绪标签不符: 期望 ${row.expectedLabel}, 实际 ${actual}` +
      ` (valence ${row.emotion.valence} / arousal ${row.emotion.arousal})`
    );
  }
  return null;
}

/**
 * 可区分性自检 (任意两角色至少一维差 ≥ 0.05).
 *
 * @param calibration 待检标定表
 * @returns 错误描述; 通过 → null
 */
function validateBaselineDistinguishability(calibration: readonly CharacterBaselineCalibration[]): string | null {
  for (let left = 0; left < calibration.length; left += 1) {
    for (let right = left + 1; right < calibration.length; right += 1) {
      const first = calibration[left];
      const second = calibration[right];
      if (!first || !second) continue;
      const distance = maxDimensionDistance(first, second);
      if (distance < MIN_ROLE_DIMENSION_DISTANCE - FLOAT_TOLERANCE) {
        return (
          `角色 ${first.templateId} 与 ${second.templateId} 在 8 个维度上差异都 < ` +
          `${MIN_ROLE_DIMENSION_DISTANCE} (最大差 ${distance.toFixed(4)}) —— 内核行为不可区分`
        );
      }
    }
  }
  return null;
}

/**
 * 无维度塌缩自检 (每维跨度 ≥ 0.40).
 *
 * @param calibration 待检标定表
 * @returns 错误描述; 通过 → null
 */
function validateBaselineDimensionSpread(calibration: readonly CharacterBaselineCalibration[]): string | null {
  if (calibration.length === 0) {
    return '角色基线标定表为空';
  }
  for (const key of BASELINE_DIMENSION_KEYS) {
    const values = calibration.map((row) => dimensionValue(row, key));
    const spread = Math.max(...values) - Math.min(...values);
    if (spread < MIN_DIMENSION_SPREAD - FLOAT_TOLERANCE) {
      return `基线维度 ${key} 在 ${calibration.length} 个角色上被压成常数 ` + `(跨度 ${spread.toFixed(4)} < ${MIN_DIMENSION_SPREAD})`;
    }
  }
  return null;
}

/**
 * 重复 templateId 自检.
 *
 * @param calibration 待检标定表
 * @returns 重复的 templateId; 无重复 → null
 */
function findDuplicateTemplateId(calibration: readonly CharacterBaselineCalibration[]): string | null {
  const seen = new Set<string>();
  for (const row of calibration) {
    if (seen.has(row.templateId)) {
      return row.templateId;
    }
    seen.add(row.templateId);
  }
  return null;
}

/**
 * 两行之间最大的单维绝对差.
 *
 * @param first 第一行
 * @param second 第二行
 * @returns 最大单维差
 */
function maxDimensionDistance(first: CharacterBaselineCalibration, second: CharacterBaselineCalibration): number {
  let max = 0;
  for (const key of BASELINE_DIMENSION_KEYS) {
    const diff = Math.abs(dimensionValue(first, key) - dimensionValue(second, key));
    if (diff > max) {
      max = diff;
    }
  }
  return max;
}

/**
 * 取某一行某一维的数值.
 *
 * @param row 标定行
 * @param key 维度名
 * @returns 该维数值
 */
function dimensionValue(row: CharacterBaselineCalibration, key: BaselineDimensionKey): number {
  switch (key) {
    case 'trust':
      return row.trust;
    case 'verbal':
      return row.resistance.verbal;
    case 'depth':
      return row.resistance.depth;
    case 'style':
      return row.resistance.style;
    case 'valence':
      return row.emotion.valence;
    case 'arousal':
      return row.emotion.arousal;
    case 'safety':
      return row.safety;
    case 'bond':
      return row.bond;
  }
}
