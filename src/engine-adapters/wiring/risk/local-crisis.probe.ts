// V2026-10-29 治本 (WP9-C · B 层 · 本地危机探测器):
//   职责: 实现内核 WP4 预留的 `RiskProbePort` —— 用**本地确定性规则**识别危机语言,
//         供内核 turn 决策产出风险信号 (safety 判定), 再由渲染层做路由.
//   边界: 纯计算, 零网络 / 零 IO / 零 @nestjs; 不改内核, 不改规则层.
//
//   为什么要有这个实现 (任务单 §2.3 / §5):
//     内核 WP4 预留了 `RiskProbePort` 作为"未来接 PsyGUARD-RoBERTa Python 服务"的
//     扩展点, 但本期那个服务还不存在 (WP11). 于是危机轮次**没有任何判定来源** ——
//     内核规则层在"咨询师输入面"只有专业性违规词典 (承诺治愈 / 双重关系 / …),
//     没有危机词典, 于是"我活着没什么意思"这种话在内核眼里是干净的.
//     本类就是那个"现在能跑的探测": 走**内核既有的扩展点**, 将来换 PsyGUARD 服务时,
//     换掉这一个实现即可, 内核与渲染层一行不动 (这正是 §5 想要的终局形态).
//
//   为什么词典分两层 (复用 + 补差):
//     ① **复用**内核规则层的来访侧词典 (`evaluateSafety(text, 'visitor_output')`) ——
//        那 11 类危机词是内核已经校准过的口径, 不该再抄一份;
//     ② **补差**: 咨询师输入面的常见说法 ("活着没什么意思" / "结束这一切"),
//        内核词典没收 (它只按来访侧口语列词). 这里补一小份**咨询师输入面**的补充词表.
//
//   反双胞胎:
//     - 不另写一套危机类别体系: 类别名一律用内核的 `VisitorRiskCategory`,
//       等级一律走内核的 `PSYGUARD_LEVEL_MAP` (不自己判"哪个更严重").
//     - 不在探测器里做"要不要拦"的决定: 内核 `assessSafety` 会把探测结果与规则
//       结果取**最高级**, 探测器只报"我看到了什么类别".
//     - 不做网络调用: 本期是本地规则, 未来换 Python 服务时这一层会被替换掉.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9c-risk-probe.spec.ts 覆盖命中/未命中/等级归一

import {
  PSYGUARD_LEVEL_MAP,
  evaluateSafety,
  maxSafetyLevel,
  type RiskProbePort,
  type RiskProbeResult,
  type SafetyLevel,
  type SafetySide,
  type VisitorRiskCategory,
} from '../../../engine-core';
import { CRISIS_RISK_CATEGORIES, isCrisisCategory } from '../../rendering/render-risk';

/**
 * 咨询师输入面的**补充**危机词表 (内核来访侧词典没收的说法).
 *
 * 定位: 这是"补差", 不是"另一套词典" —— 类别仍用内核 PsyGUARD 口径, 等级仍走内核映射表.
 * 为什么只收这么少: 词典越宽, 误报越多; 误报的代价是"把正常训练对话判成危机轮",
 * 那会直接毁掉可用性 (同内核规则层"宁少勿滥"的口径).
 */
const SUPPLEMENTARY_PATTERNS: readonly { readonly category: VisitorRiskCategory; readonly patterns: readonly string[] }[] = [
  {
    category: 'passive_ideation',
    patterns: ['活着没什么意思', '没意思活着', '结束这一切', '结束掉自己', '想结束自己', '想不开了', '没劲活着'],
  },
  { category: 'active_ideation', patterns: ['我要结束自己', '准备结束自己'] },
  { category: 'self_harm_ideation', patterns: ['拿刀划自己', '弄伤自己'] },
  { category: 'aggression_others', patterns: ['我要弄死他', '想弄死他'] },
];

/**
 * 本地危机探测器 (实现内核 `RiskProbePort`).
 *
 * 纯类: 可脱离 Nest 容器 `new` 出来跑 (单测友好).
 */
export class LocalCrisisProbe implements RiskProbePort {
  /**
   * 探测一段文本里的危机信号.
   *
   * @param text 待判定文本
   * @param _side 检测面 (本探测器**两侧同判**: 危机语言不因说话人是谁而改变性质)
   * @returns 归一后的等级与危机类别
   */
  async probe(text: string, _side: SafetySide): Promise<RiskProbeResult> {
    const categories = detectCrisisCategories(text);
    if (categories.length === 0) {
      return { level: 'pass', categories: [] };
    }
    const level = categories.reduce<SafetyLevel>((acc, category) => maxSafetyLevel(acc, PSYGUARD_LEVEL_MAP[category]), 'pass');
    return { level, categories };
  }
}

/**
 * 收集一段文本命中的危机类别 (去重, 保持内核清单的顺序).
 *
 * @param text 待判定文本
 * @returns 命中的危机类别
 */
export function detectCrisisCategories(text: string): VisitorRiskCategory[] {
  const haystack = text.trim().toLowerCase();
  if (!haystack) return [];

  // ① 复用内核规则层的来访侧词典 (危机词的既有口径).
  const ruleVerdict = evaluateSafety(text, 'visitor_output');
  const hits = new Set<VisitorRiskCategory>();
  for (const category of ruleVerdict.categories) {
    if (isCrisisCategory(category)) {
      hits.add(category as VisitorRiskCategory);
    }
  }

  // ② 补差: 咨询师输入面的补充词表.
  for (const entry of SUPPLEMENTARY_PATTERNS) {
    if (entry.patterns.some((pattern) => haystack.includes(pattern))) {
      hits.add(entry.category);
    }
  }

  // 按内核清单顺序输出 (结果稳定, 不随命中顺序抖动).
  return CRISIS_RISK_CATEGORIES.filter((category) => hits.has(category));
}
