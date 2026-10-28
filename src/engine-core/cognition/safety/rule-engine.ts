// V2026-10-28 治本 (WP4 · 引擎内核 · 安全规则引擎):
//   职责: 用**确定性硬规则**判定一段文本的安全等级 (pass / warn / block),
//         命中取最高级别, 类别与规则 id 去重聚合. 纯函数, 无 IO, 无随机.
//
//   规则词典为什么是"内核种子常量"而不是配置:
//     本期零落库、零运营后台 (任务单 §1.2), 规则是**代码里的常量表** ——
//     改规则 = 改代码 = 走 review, 不会有人在线上偷偷加一条规则.
//     后期要做热更新/灰度, 再把这份表搬到存储与运营后台, 接口形状不用变.
//
//   词典为什么**保守** (宁少勿滥):
//     block 只放最硬的越界 (承诺治愈 / 双重关系 / 违法指导 / 自杀自残指导 / 歧视),
//     warn 只放明显的说教与过早建议. 误报的代价是"把正常训练对话判成高危",
//     漏报的代价是"督导事后看报告时少看到一条" —— 前者会直接毁掉可用性,
//     所以宁可漏报给督导事后看, 也不误拦.
//
//   匹配口径:
//     一律 `text.trim().toLowerCase()` 后做**小写子串包含**判断, 本期不上正则.
//     理由: 正则会带来灾难性回溯与不可预期的误报, 且规则行为随引擎版本漂移;
//     词典运营轮(带真实误报样本)再引入正则, 那时才有数据支撑怎么写.
//
//   反双胞胎:
//     - **来访侧与咨询师侧共用同一个规则器**, 只靠 `side` 分组 ——
//       两套规则器迟早给出不同口径的判定, 而"同一句话在两个侧被判不同等级"
//       是没法向督导解释的.
//     - 等级比较统一走 maxSafetyLevel (domain/safety/safety-types.ts),
//       不在规则引擎里另写一份"谁比谁严重".
//     - 规则 id 唯一: 报告里的 matchedRules 要能定位到具体规则, 重名会让报告失真.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp4-safety.spec.ts 覆盖分级命中、多规则取最高、干净文本 pass

import {
  maxSafetyLevel,
  type SafetyCategory,
  type SafetyLevel,
  type SafetySide,
  type SafetyVerdict,
} from '../../domain/safety/safety-types';

/**
 * 一条安全规则 (种子词典的元素).
 */
export interface SafetyRule {
  /** 规则 id (报告里可定位, 全局唯一). */
  readonly id: string;
  /** 适用检测面. */
  readonly side: SafetySide;
  /** 命中类别. */
  readonly category: SafetyCategory;
  /** 命中后的等级. */
  readonly level: SafetyLevel;
  /** 小写子串 (本期不上正则: 可测、可控误报; 正则留后期规则运营轮). */
  readonly patterns: readonly string[];
}

/**
 * 咨询师侧规则 (最硬的越界 + 明显说教).
 *
 * 注释里的括号是**误报提示**: 这些词要足够特指, 不能是日常对话里常出现的短语.
 */
const COUNSELOR_RULES: readonly SafetyRule[] = [
  {
    id: 'counselor.promise_cure',
    side: 'counselor_input',
    category: 'promise_cure',
    level: 'block',
    // 承诺治愈的常见说法: "我保证你能治好" 里 "保证" 与 "能治好" 之间夹着 "你",
    // 所以 "保证能治好" 匹配不到 —— 种子里必须按**真实口语形态**列全, 而不是只列一种.
    patterns: [
      '肯定能治好',
      '肯定你能治好',
      '保证能治好',
      '保证你能治好',
      '保证治愈',
      '保证治好',
      '肯定能好',
      '保证你能好',
      '一定没问题',
      '我担保你会好',
      '包治好',
    ],
  },
  {
    id: 'counselor.double_relationship',
    side: 'counselor_input',
    category: 'double_relationship',
    level: 'block',
    patterns: ['加我微信', '私下联系', '我们私下', '下班见面', '跟你约会', '留你私人电话', '转账给我'],
  },
  {
    id: 'counselor.illegal_guidance',
    side: 'counselor_input',
    category: 'illegal_guidance',
    level: 'block',
    patterns: ['伪造诊断证明', '伪造病历', '弄到处方药', '教你怎么割', '教你怎么烧', '帮你实施'],
  },
  {
    id: 'counselor.suicide_coaching',
    side: 'counselor_input',
    category: 'suicide_coaching',
    level: 'block',
    patterns: [
      '自杀的方法',
      '自残的方法',
      '教你自杀',
      '教你自残',
      '怎么自杀',
      '自杀步骤',
      '割腕的方法',
      '跳楼的方法',
      '致死剂量',
      '哪里能买到安眠药',
    ],
  },
  {
    id: 'counselor.discrimination',
    side: 'counselor_input',
    category: 'discrimination',
    level: 'block',
    patterns: ['女人天生就', '男人都一个样', '同性恋就是有病', '你们乡下人', '得了这种病就是', '残废', '你们这种病'],
  },
  {
    id: 'counselor.value_judgment',
    side: 'counselor_input',
    category: 'value_judgment',
    level: 'warn',
    patterns: ['你就是太矫情', '这有什么想不开的', '你这种人', '别这么矫情', '你就是想不开', '你就是玻璃心'],
  },
  {
    id: 'counselor.premature_advice',
    side: 'counselor_input',
    category: 'premature_advice',
    level: 'warn',
    patterns: ['你该吃药', '你该吃安眠药', '你这就是抑郁症', '你这就是焦虑症', '按我说的做', '按我说的吃'],
  },
];

/**
 * 来访侧规则 (本期 turn 内**不调用**, 备 WP5 渲染后接入).
 *
 * 类别与 §4.2 的 PsyGUARD 11 类一一对应 (neutral 无规则: 无命中即 neutral).
 */
const VISITOR_RULES: readonly SafetyRule[] = [
  {
    id: 'visitor.suicide_attempt',
    side: 'visitor_output',
    category: 'suicide_attempt',
    level: 'block',
    patterns: ['我割腕了', '我试过自杀', '已经自杀过', '我上次自杀'],
  },
  {
    id: 'visitor.suicide_plan',
    side: 'visitor_output',
    category: 'suicide_plan',
    level: 'block',
    patterns: ['我的自杀计划', '我准备自杀', '想好怎么自杀', '打算自杀', '我已经想好怎么死'],
  },
  {
    id: 'visitor.suicide_preparation',
    side: 'visitor_output',
    category: 'suicide_preparation',
    level: 'block',
    patterns: ['准备了安眠药', '买了刀片', '整理遗书', '把药都准备好了', '绳子都准备好了'],
  },
  {
    id: 'visitor.active_ideation',
    side: 'visitor_output',
    category: 'active_ideation',
    level: 'block',
    patterns: ['我要自杀', '我想要自杀', '我要去死', '我要死了'],
  },
  {
    id: 'visitor.self_harm_behavior',
    side: 'visitor_output',
    category: 'self_harm_behavior',
    level: 'block',
    patterns: ['我在伤害自己', '我划伤了', '我一直在割自己'],
  },
  {
    id: 'visitor.passive_ideation',
    side: 'visitor_output',
    category: 'passive_ideation',
    level: 'warn',
    patterns: ['不想活了', '活着没意思', '想消失', '活着好累'],
  },
  {
    id: 'visitor.suicide_exploration',
    side: 'visitor_output',
    category: 'suicide_exploration',
    level: 'warn',
    patterns: ['想了解一下自杀', '自杀会痛吗', '好奇自杀', '想问问自杀'],
  },
  {
    id: 'visitor.self_harm_ideation',
    side: 'visitor_output',
    category: 'self_harm_ideation',
    level: 'warn',
    patterns: ['想伤害自己', '想割自己', '想砸东西伤害自己'],
  },
  {
    id: 'visitor.aggression_others',
    side: 'visitor_output',
    category: 'aggression_others',
    level: 'block',
    patterns: ['我要杀了他', '我想弄死他', '我要打他一顿', '我想揍他'],
  },
  {
    id: 'visitor.aggression_self',
    side: 'visitor_output',
    category: 'aggression_self',
    level: 'warn',
    patterns: ['我想打自己', '我想扇自己', '想砸自己'],
  },
];

/** 全部规则 (两侧合并). */
const SAFETY_RULES: readonly SafetyRule[] = [...COUNSELOR_RULES, ...VISITOR_RULES];

/**
 * 确定性规则判定 (纯函数, 无 IO).
 *
 * 命中取最高级别, 类别 / 规则去重聚合; 无命中 → pass / 空集合 / source='rule'.
 *
 * @param text 待判定文本
 * @param side 检测面
 * @returns 本轮规则判定
 */
export function evaluateSafety(text: string, side: SafetySide): SafetyVerdict {
  const haystack = text.trim().toLowerCase();
  if (!haystack) return passVerdict(side);

  const matched = SAFETY_RULES.filter((rule) => rule.side === side && rule.patterns.some((pattern) => haystack.includes(pattern)));
  if (matched.length === 0) return passVerdict(side);

  const level = matched.reduce<SafetyLevel>((acc, rule) => maxSafetyLevel(acc, rule.level), 'pass');
  const categories = [...new Set(matched.map((rule) => rule.category))];
  const matchedRules = [...new Set(matched.map((rule) => rule.id))];
  return {
    level,
    side,
    categories,
    matchedRules,
    source: 'rule',
    reason: `规则命中: ${categories.join(', ')}`,
  };
}

/** 空判定 (pass / 无类别 / 无规则). */
function passVerdict(side: SafetySide): SafetyVerdict {
  return { level: 'pass', side, categories: [], matchedRules: [], source: 'rule' };
}
