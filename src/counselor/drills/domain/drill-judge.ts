// V2026-10-27 治本 (情景演练 · 确定性判定引擎 — 纯函数层):
//   原因: 任务单 §2.2 把三档判定写成一条**优先级规则**:
//     "先看是否命中'答应/同意'类反向词 → over_compromise;
//      再看是否有共情表达且守住设置 → steady_firm;
//      否则（拒绝但生硬）→ abrupt_refusal"
//     而 §2.2 同时要求「规则写成**纯函数可单测**」, §8.2 又要求"三档各有一条确定性用例命中正确 verdict".
//     这条规则如果写在 service 里 (带 DI / 带 LLM), 就只能靠"起服务 + mock 上游"来测 ——
//     而档位判定是**零压红线**的核心: 判错档位 = 前端渲染出"得分/不及格"式的结论.
//     它必须是**无状态、无 IO、可单测**的.
//   修法: 本文件是判定引擎的唯一实现 (纯函数, 无 Nest 依赖):
//     - matchDrillAnchors(): 逐锚点做关键词命中 (正向命中 = 做到; 反向命中 = 越位)
//     - judgeDrillVerdict(): boundary 三档优先级判定 (crisis 恒 null)
//     - buildDrillItems(): 由锚点命中结果生成 3-5 条零压技术批注
//     - judgeDrill(): 上面三步的组合 (对外唯一入口)
//
//   ── 反双胞胎 ──
//   - **不在 service 里写判定分支**: service 只做"取剧本 → 调 judgeDrill → 可选润色 → 出参",
//     判定规则只存在这一份 (改档位语义只改这里, 不会出现 service 与测试各写一份).
//   - **不让 LLM 参与档位判定**: LLM 只能改写批注**措辞** (见 drill-evaluator.service.ts),
//     档位/覆盖清单永远来自本文件的确定性结果 —— 任务单 §2.2 明令"不得由 LLM 直接改判档位".
//   - **不把"命中"交给模糊打分**: 只做字符串包含命中 (与 practice 引擎同款口径),
//     同一个回应任意次判定结果恒等 (零随机, 可复盘).
//   - **不把文案模板散进 config**: 通用模板与分档说明留在本文件 (产品级固定串),
//     逐场景内容 (人设 / 来访者原话 / 提示语) 留在 config/scripts 下的剧本里.
//
//   验证:
//     1. tsc 0 错
//     2. npx jest test/counselor/drill-judge.spec.ts 全绿 (三档各正例/反例 + crisis 覆盖清单)
//     3. 同一份回应连判 2 次 → 逐字相同
//   时间戳: 2026-10-27 19:45 GMT+8

import {
  DRILL_BOUNDARY_ANCHOR_KEYS,
  type DrillItem,
  type DrillJudgement,
  type DrillPoint,
  type DrillScript,
  type DrillVerdict,
} from './drill.types';
import { PracticeFeedbackTone } from '../../enums/practice-feedback-tone.enum';

/**
 * 单个锚点的命中结果.
 */
export interface DrillAnchorSignal {
  /** 锚点 key (对应 requiredPoints[].key). */
  readonly pointKey: string;
  /** 锚点中文名. */
  readonly label: string;
  /** 是否"做到" (命中任一正向关键词). */
  readonly covered: boolean;
  /** 命中的正向关键词 (未命中为 null). */
  readonly positiveHit: string | null;
  /** 命中的反向关键词 (未命中为 null). */
  readonly antiHit: string | null;
}

/**
 * 否定语气词表 (命中关键词**紧邻之前**时, 该次命中视为被否定).
 *
 * 为什么需要它: 纯"包含即命中"在中文里有一类系统性误判 ——
 * "**不**加个微信" 里也含 "加个微信", "**不**容易" 里也含 "不容易".
 * 若不处理, 一句明确的拒绝会被判成"松口" (over_compromise), 一句共情里的
 * 自我贬低会被判成"共情做到" —— 两处都直接歪曲零压反馈的内容.
 *
 * 判定口径 (确定, 可单测): 只看关键词**紧邻前 2 个字**是否含否定词;
 * 更远的否定 ("我不行, 我加你微信") 不影响判定 —— 距离远的否定通常已换话题.
 */
export const DRILL_NEGATION_CUES: readonly string[] = ['不', '别', '没', '无', '未', '勿', '非', '莫'];

/**
 * 否定守卫的观察窗口 (关键词之前多少字内算"紧邻").
 */
const NEGATION_WINDOW = 2;

/**
 * 归一化用户提交的回应文本.
 *
 * 只做首尾空白裁剪 —— 不做标点剥离 / 同义词归一:
 * 判定锚点是**教学口径的关键词**, 裁剪空白即可; 再"聪明"一点就会让"我没答应"这类
 * 反讽句被误判, 而这类误判在零压场景里代价很高 (会把"守住边界"说成"松口").
 *
 * @param text 原始提交文本
 * @returns 归一化后的文本
 */
export function normalizeDrillText(text: string): string {
  return text.trim();
}

/**
 * 逐锚点做关键词命中.
 *
 * 判定口径 (与 practice 引擎一致): **包含即命中**, 正向与反向分别记录,
 * 反向命中优先级更高 (同一锚点上同时出现正向与反向 → 以反向为准, 因为
 * "嘴上答应"压过"嘴上说守边界"; 例如"我可以加你微信, 但我们还是按约定来"实为松口).
 *
 * @param script 情景剧本
 * @param text 已归一化的回应文本
 * @returns 每个锚点的命中结果 (顺序与 requiredPoints 一致)
 */
export function matchDrillAnchors(script: DrillScript, text: string): DrillAnchorSignal[] {
  return script.requiredPoints.map((point: DrillPoint) => {
    const antiHit = findFirstHit(text, point.antiKeywords);
    const positiveHit = findFirstHit(text, point.positiveKeywords);
    return {
      pointKey: point.key,
      label: point.label,
      covered: antiHit === null && positiveHit !== null,
      positiveHit,
      antiHit,
    };
  });
}

/**
 * boundary 三档判定 (任务单 §2.2 优先级规则).
 *
 * 1. 命中"答应/同意"类反向词 → `over_compromise` (边界被放开)
 * 2. 有共情表达 **且** 守住设置 → `steady_firm` (温和坚定)
 * 3. 其余 → `abrupt_refusal` (守住但生硬 / 未形成温和坚定)
 *
 * 第 3 档是**兜底档**: 三档形态是任务单 §2.2 拍板的封闭集合, 不存在"第四档".
 * 兜底时具体缺哪一步, 由批注 (missedPointKeys + items) 逐条说清 —— 档位标签本身
 * 不承担"扣分"语义 (零压红线: verdict 只是技术形态标签).
 *
 * @param script 情景剧本
 * @param signals 锚点命中结果
 * @returns 档位标签 (crisis 恒为 null)
 */
export function judgeDrillVerdict(script: DrillScript, signals: readonly DrillAnchorSignal[]): DrillVerdict | null {
  if (script.track !== 'boundary') {
    return null;
  }

  const holdsBoundary = signals.find((signal) => signal.pointKey === DRILL_BOUNDARY_ANCHOR_KEYS.HOLDS_BOUNDARY);
  const namesEmotion = signals.find((signal) => signal.pointKey === DRILL_BOUNDARY_ANCHOR_KEYS.EMPATHY);

  // 1) 松口 (反向词命中) → over_compromise
  if (holdsBoundary?.antiHit) {
    return 'over_compromise';
  }
  // 2) 共情 + 守住设置 → steady_firm
  if (namesEmotion?.covered && holdsBoundary?.covered) {
    return 'steady_firm';
  }
  // 3) 兜底 → abrupt_refusal
  return 'abrupt_refusal';
}

/**
 * 生成零压技术批注 (3-5 条).
 *
 * 组成:
 *   - 每个锚点 1 条 (做到 → positive; 越位 → warning; 未出现 → warning + 方向提示)
 *   - boundary 额外 1 条"形态说明" (info), 解释这一轮落在哪一档形态上
 *   - crisis 额外 1 条"范围说明" (info), 说明本场景只练识别与探问
 *
 * 零压红线: 批注只描述**技术动作**, 不评价人; 不出现分数 / 等级 / 对错.
 *
 * @param script 情景剧本
 * @param signals 锚点命中结果
 * @param verdict 档位 (crisis 为 null)
 * @returns 批注清单
 */
export function buildDrillItems(script: DrillScript, signals: readonly DrillAnchorSignal[], verdict: DrillVerdict | null): DrillItem[] {
  const items: DrillItem[] = signals.map((signal) => buildAnchorItem(script, signal));

  if (script.track === 'boundary') {
    items.unshift({
      tone: PracticeFeedbackTone.INFO,
      pointKey: 'verdictShape',
      text: DRILL_VERDICT_NOTES[verdict ?? 'abrupt_refusal'],
    });
  } else {
    items.unshift({
      tone: PracticeFeedbackTone.INFO,
      pointKey: 'practiceScope',
      text: DRILL_CRISIS_SCOPE_NOTE,
    });
  }

  return items;
}

/**
 * 判定入口 (唯一对外出口).
 *
 * @param script 情景剧本
 * @param submittedText 用户提交的回应原文
 * @returns 判定结果 (档位 / 覆盖清单 / 批注)
 */
export function judgeDrill(script: DrillScript, submittedText: string): DrillJudgement {
  const text = normalizeDrillText(submittedText);
  const signals = matchDrillAnchors(script, text);
  const verdict = judgeDrillVerdict(script, signals);
  const coveredPointKeys = signals.filter((signal) => signal.covered).map((signal) => signal.pointKey);
  const missedPointKeys = signals.filter((signal) => !signal.covered).map((signal) => signal.pointKey);

  return {
    verdict,
    coveredPointKeys,
    missedPointKeys,
    items: buildDrillItems(script, signals, verdict),
  };
}

/**
 * 三档形态的产品级固定说明 (逐档给建设性反馈, 不评价人).
 *
 * 任务单 §2.3: "三档都给建设性反馈, abrupt_refusal 与 over_compromise 同样先肯定可取之处."
 */
export const DRILL_VERDICT_NOTES: Readonly<Record<DrillVerdict, string>> = {
  over_compromise:
    '这一轮的形态是边界被放开了: 你先照顾到了来访者的处境, 这份心意值得保留; 只是设置一旦松开, 后面每一次都要额外解释, 来访者也分不清哪些能谈、哪些不能谈。可以用参考回应里那种温和而坚定的说法再试一次。',
  steady_firm: '这一轮的形态是温和而坚定: 共情、边界、可行替代三处都在。保持这个节奏, 下一轮可以再打磨一下措辞。',
  abrupt_refusal:
    '这一轮守住了设置, 但表达偏生硬, 来访者可能会觉得被推开。可以先接住他的感受, 再把设置说出来 —— 守住边界与让人靠近并不冲突。',
};

/**
 * crisis 赛道的范围说明 (只识别与探问, 不做干预).
 *
 * 任务单 §3.1 合规红线: "只练识别信号 + 开放式探问 + 平稳引导求助, 不训练干预/治疗技术".
 */
export const DRILL_CRISIS_SCOPE_NOTE =
  '这一场景只练三件事: 识别信号、开放式探问、平稳引导到专业求助。不做风险评估、不做干预技术、也不代替真实临床判断。';

/**
 * 单个锚点的批注生成.
 */
function buildAnchorItem(script: DrillScript, signal: DrillAnchorSignal): DrillItem {
  if (signal.antiHit) {
    return {
      tone: PracticeFeedbackTone.WARNING,
      pointKey: signal.pointKey,
      text: `出现了「${signal.antiHit}」这类措辞 —— ${signal.label}这一层要留意, 越位之后来访者通常不会再往下说。`,
    };
  }

  if (signal.covered) {
    return {
      tone: PracticeFeedbackTone.POSITIVE,
      pointKey: signal.pointKey,
      text: `「${signal.positiveHit}」这个动作出现了 —— ${signal.label}。`,
    };
  }

  const point = script.requiredPoints.find((item) => item.key === signal.pointKey);
  const hint = point?.missedHint ?? '这一步还没有出现, 可以留到下一轮再专门盯住它。';
  return {
    tone: PracticeFeedbackTone.WARNING,
    pointKey: signal.pointKey,
    text: `${signal.label}这一步还没有出现 —— ${hint}`,
  };
}

/**
 * 找出首个**未被否定**的命中关键词.
 *
 * @param text 已归一化的回应文本
 * @param keywords 关键词清单
 * @returns 命中的关键词原文 (未命中为 null)
 */
function findFirstHit(text: string, keywords: readonly string[]): string | null {
  for (const keyword of keywords) {
    if (keyword.length === 0) {
      continue;
    }
    let index = text.indexOf(keyword);
    while (index !== -1) {
      if (!isNegatedHit(text, index)) {
        return keyword;
      }
      index = text.indexOf(keyword, index + keyword.length);
    }
  }
  return null;
}

/**
 * 判断某次命中是否被紧邻的否定词否掉.
 *
 * @param text 全文
 * @param index 关键词起始下标
 * @returns true = 该次命中处于否定语境 (不计入)
 */
export function isNegatedHit(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - NEGATION_WINDOW), index);
  return DRILL_NEGATION_CUES.some((cue) => before.includes(cue));
}
