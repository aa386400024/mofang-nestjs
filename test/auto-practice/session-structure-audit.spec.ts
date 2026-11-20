// V2026-11-19 建立 (AF-127 · 长会谈开场框架与收束结构审计 · 纯函数单测):
//   覆盖 parsePacketMarkdown / auditSessionStructure / aggregateSessionStructure 三条口径:
//   ① 正例: 开场 5 项 + 收束 3 项齐全 → openingComplete / closingComplete 为 true;
//   ② 反例: 同一句话出现在**错误位置**（开场要素落在后 10 轮 / 收束要素落在前 10 轮）→ 不算覆盖;
//   ③ 边界轮次: 开场第 10 轮命中 / 第 11 轮不命中; 收束倒数第 10 轮命中 / 倒数第 11 轮不命中;
//   ④ 缺咨询师文本: 该轮没有咨询师台词 → 不算命中, counselorTurns 计数正确;
//   ⑤ 只有部分要素: 只命中一个子组 → covered=false, 且 matchedGroups / missingGroups 如实输出;
//   ⑥ 误报防护: "不会说话的人" / "能不能" / "一直记住我" / "把下一步交给她" / 来访者自己的
//      "想停下来" 这类会话内语句都不得算成结构;
//   ⑦ 聚合: 覆盖率 / 完整性计数 / status=candidate / gateEligible=false / 免责声明.
//
//   纯函数 / 零 IO / 不起 Nest / 不连 DB / 不调 LLM.
//
//   验证: pnpm exec vitest run test/auto-practice/session-structure-audit.spec.ts

import { describe, expect, it } from 'vitest';

import {
  aggregateSessionStructure,
  auditSessionStructure,
  CLOSING_WINDOW_TURNS,
  OPENING_WINDOW_TURNS,
  parsePacketMarkdown,
  SESSION_STRUCTURE_DISCLAIMER,
  type SessionStructureTurn,
} from '../../src/auto-practice/metrics/session-structure-audit.js';

/** 造一轮。 */
function turn(index: number, counselor: string, visitor = '嗯。'): SessionStructureTurn {
  return { turnIndex: index, counselor, visitor };
}

/** 造一段空白轮次。 */
function filler(count: number, from: number): SessionStructureTurn[] {
  return Array.from({ length: count }, (_, offset) => turn(from + offset, '我们继续。'));
}

/** 开场 5 项齐全的台词（按元素分行, 落在前 10 轮）。 */
const OPENING_LINES = [
  '这次谈话的内容我会保密，不会告诉别人，除非出现自伤或生命危险的情况。',
  '我们先约定一下工作方式和边界：我不做评判，也不替你做决定。',
  '每次会谈五十分钟，我们每周一次。',
  '过程中你随时可以喊停，也可以不回答任何不想答的问题。',
  '这次会谈可能会录音，你同意吗？',
];

/** 收束 3 项齐全的台词（落在后 10 轮）。 */
const CLOSING_LINES = [
  '我总结一下：我的理解是，你今天最在意的是被看见。',
  '你可以先记住：下次警报响起时，先认出那个念头。',
  '下次我们再约，下周的练习继续。',
];

/** 造一场 25 轮、开场与收束都齐全的会话（开场在前 10 轮, 收束在后 10 轮）。 */
function compliantTurns(): SessionStructureTurn[] {
  const opening = OPENING_LINES.map((line, index) => turn(index + 1, line));
  const closing = CLOSING_LINES.map((line, index) => turn(23 + index, line));
  return [...opening, ...filler(10, 6), ...filler(7, 16), ...closing];
}

describe('AF-127 · parsePacketMarkdown（纯函数）', () => {
  it('① 解析轮号与咨询师/来访者台词', () => {
    const markdown = [
      '# packet-01',
      '',
      '> 候选口径',
      '',
      '## 会谈记录',
      '',
      '### 第 1 轮',
      '',
      '**咨询师**：今天想聊什么？',
      '',
      '**来访者**：工作的事。',
      '',
      '### 第 2 轮',
      '',
      '**咨询师**：哪一部分最压着你？',
      '',
      '**来访者**：开会。',
      '',
    ].join('\n');
    const turns = parsePacketMarkdown(markdown);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ turnIndex: 1, counselor: '今天想聊什么？', visitor: '工作的事。' });
    expect(turns[1].turnIndex).toBe(2);
  });

  it('② 台词跨多行时归属它上面最近的那个角色行', () => {
    const markdown = [
      '### 第 1 轮',
      '',
      '**咨询师**：先说说发生了什么。',
      '',
      '**来访者**：有件小事吧。',
      '',
      '前天下班我在楼下站了很久。',
      '',
      '现在想想挺累的。',
      '',
    ].join('\n');
    const turns = parsePacketMarkdown(markdown);
    expect(turns).toHaveLength(1);
    expect(turns[0].visitor).toContain('前天下班我在楼下站了很久。');
    expect(turns[0].visitor).toContain('现在想想挺累的。');
    expect(turns[0].counselor).toBe('先说说发生了什么。');
  });

  it('③ 缺咨询师台词的轮次, 咨询师侧为空串', () => {
    const markdown = ['### 第 1 轮', '', '**来访者**：我先说。', '', '### 第 2 轮', '', '**咨询师**：嗯。', ''].join('\n');
    const turns = parsePacketMarkdown(markdown);
    expect(turns).toHaveLength(2);
    expect(turns[0].counselor).toBe('');
    expect(turns[0].visitor).toBe('我先说。');
    expect(turns[1].counselor).toBe('嗯。');
  });

  it('④ 轮次标题之前的自由文本不产生轮次', () => {
    const markdown = ['# packet-01', '', '> 说明文字', '', '### 第 1 轮', '', '**咨询师**：开始。', ''].join('\n');
    const turns = parsePacketMarkdown(markdown);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnIndex).toBe(1);
  });
});

describe('AF-127 · auditSessionStructure（纯函数）', () => {
  it('① 正例: 开场 5 项 + 收束 3 项齐全', () => {
    const audit = auditSessionStructure('packet-01', compliantTurns());
    expect(audit.turnCount).toBe(25);
    expect(audit.counselorTurns).toBe(25);
    expect(audit.opening.confidentiality.covered).toBe(true);
    expect(audit.opening.boundary.covered).toBe(true);
    expect(audit.opening.duration.covered).toBe(true);
    expect(audit.opening.pauseRefusal.covered).toBe(true);
    expect(audit.opening.recording.covered).toBe(true);
    expect(audit.openingComplete).toBe(true);
    expect(audit.closing.summary.covered).toBe(true);
    expect(audit.closing.takeaway.covered).toBe(true);
    expect(audit.closing.nextStep.covered).toBe(true);
    expect(audit.closingComplete).toBe(true);
  });

  it('① 证据带轮号与原文短句, 且短句不含整段原文', () => {
    const audit = auditSessionStructure('packet-01', compliantTurns());
    expect(audit.opening.confidentiality.evidenceTurns).toEqual([1]);
    expect(audit.opening.confidentiality.evidence).toContain('保密');
    expect(audit.opening.confidentiality.evidence.length).toBeLessThanOrEqual(200);
    expect(audit.closing.takeaway.evidenceTurns).toEqual([24]);
  });

  it('② 反例: 开场要素落在后 10 轮 → 不算开场覆盖', () => {
    const turns = [...filler(24, 1), turn(25, OPENING_LINES[0])];
    const audit = auditSessionStructure('packet-late', turns);
    expect(audit.opening.confidentiality.covered).toBe(false);
    expect(audit.opening.confidentiality.evidence).toBe('');
    expect(audit.openingComplete).toBe(false);
  });

  it('② 反例: 收束要素落在前 10 轮 → 不算收束覆盖', () => {
    const turns = [turn(1, CLOSING_LINES[0]), ...filler(24, 2)];
    const audit = auditSessionStructure('packet-early', turns);
    expect(audit.closing.summary.covered).toBe(false);
    expect(audit.closingComplete).toBe(false);
  });

  it('③ 边界轮次: 开场第 10 轮命中, 第 11 轮不命中', () => {
    const atTen = auditSessionStructure('packet-10', [...filler(9, 1), turn(10, OPENING_LINES[0]), ...filler(14, 11)]);
    expect(atTen.opening.confidentiality.covered).toBe(true);
    const atEleven = auditSessionStructure('packet-11', [...filler(10, 1), turn(11, OPENING_LINES[0]), ...filler(13, 12)]);
    expect(atEleven.opening.confidentiality.covered).toBe(false);
    expect(atEleven.openingWindow).toEqual({ from: 1, to: OPENING_WINDOW_TURNS });
  });

  it('③ 边界轮次: 收束倒数第 10 轮命中, 倒数第 11 轮不命中', () => {
    const total = 25;
    const closingStart = total - CLOSING_WINDOW_TURNS + 1;
    const inside = auditSessionStructure('packet-in', [
      ...filler(closingStart - 1, 1),
      turn(closingStart, CLOSING_LINES[1]),
      ...filler(total - closingStart, closingStart + 1),
    ]);
    expect(inside.closing.takeaway.covered).toBe(true);
    const outside = auditSessionStructure('packet-out', [
      ...filler(closingStart - 2, 1),
      turn(closingStart - 1, CLOSING_LINES[1]),
      ...filler(total - closingStart + 1, closingStart),
    ]);
    expect(outside.closing.takeaway.covered).toBe(false);
    expect(outside.closingWindow).toEqual({ from: closingStart, to: total });
  });

  it('④ 缺咨询师文本: 该轮没有咨询师台词 → 不算命中, 计数正确', () => {
    const turns = [...filler(9, 1), { turnIndex: 10, counselor: '', visitor: '只有来访者在说话。' }, ...filler(15, 11)];
    const audit = auditSessionStructure('packet-nocounselor', turns);
    expect(audit.turnCount).toBe(25);
    expect(audit.counselorTurns).toBe(24);
    expect(audit.opening.confidentiality.covered).toBe(false);
    expect(audit.opening.confidentiality.evidenceTurns).toEqual([]);
  });

  it('⑤ 只有部分要素: 缺一个子组 → covered=false 且子组如实输出', () => {
    const turns = [turn(1, '这次谈话的内容我会保密，不会告诉别人。'), ...filler(24, 2)];
    const audit = auditSessionStructure('packet-partial', turns);
    const element = audit.opening.confidentiality;
    expect(element.covered).toBe(false);
    expect(element.matchedGroups).toEqual(['secrecy']);
    expect(element.missingGroups).toEqual(['exception']);
    expect(element.evidence).toContain('保密');
    expect(element.evidenceTurns).toEqual([1]);
  });

  it('⑥ 误报防护: "不会说话的人" 不算保密承诺', () => {
    const turns = [turn(1, '即使她有一点不舒服，也不等于已经把你固定成不会说话的人。'), ...filler(24, 2)];
    const audit = auditSessionStructure('packet-fp-1', turns);
    expect(audit.opening.confidentiality.covered).toBe(false);
    expect(audit.opening.confidentiality.matchedGroups).toEqual([]);
  });

  it('⑥ 误报防护: "能不能" 是提问, 不算边界限制', () => {
    const turns = [turn(1, '我们能不能把类似的情况说清楚。'), ...filler(24, 2)];
    const audit = auditSessionStructure('packet-fp-2', turns);
    expect(audit.opening.boundary.covered).toBe(false);
    expect(audit.opening.boundary.matchedGroups).toEqual([]);
  });

  it('⑥ 误报防护: "一直记住我" 不算带走内容; "你可以先记住：" 算', () => {
    const negative = auditSessionStructure('packet-fp-3', [
      ...filler(14, 1),
      ...filler(10, 16),
      turn(25, '他们会不会从此一直记住我，觉得我奇怪。'),
    ]);
    expect(negative.closing.takeaway.covered).toBe(false);
    const positive = auditSessionStructure('packet-fp-3b', [
      ...filler(14, 1),
      ...filler(10, 16),
      turn(25, '你可以先记住：警报催你证明自己有用时，先认出那个念头。'),
    ]);
    expect(positive.closing.takeaway.covered).toBe(true);
  });

  it('⑥ 误报防护: "把下一步交给她" / "再决定下一步" 不算下一步安排', () => {
    const audit = auditSessionStructure('packet-fp-4', [
      ...filler(14, 1),
      ...filler(10, 16),
      turn(24, '晚点聊只是不关门，却还是把下一步交给她。'),
      turn(25, '让这十分钟过去，再决定下一步。'),
    ]);
    expect(audit.closing.nextStep.covered).toBe(false);
    expect(audit.closing.nextStep.matchedGroups).toEqual([]);
  });

  it('⑥ 误报防护: 来访者自己的"想停下来" 不算咨询师提供的暂停权', () => {
    const audit = auditSessionStructure('packet-fp-5', [turn(1, '我不会评判你现在这种疲惫和想停下来的感觉。'), ...filler(24, 2)]);
    expect(audit.opening.pauseRefusal.covered).toBe(false);
    expect(audit.opening.pauseRefusal.matchedGroups).toEqual([]);
  });

  it('⑦ 空输入: 零轮次, 全部要素不覆盖', () => {
    const audit = auditSessionStructure('packet-empty', []);
    expect(audit.turnCount).toBe(0);
    expect(audit.counselorTurns).toBe(0);
    expect(audit.openingWindow).toEqual({ from: 0, to: 0 });
    expect(audit.closingWindow).toEqual({ from: 0, to: 0 });
    expect(audit.openingComplete).toBe(false);
    expect(audit.closingComplete).toBe(false);
    expect(audit.opening.confidentiality.covered).toBe(false);
  });

  it('⑦ 短会话（少于窗口）: 两个窗口都覆盖全部轮次', () => {
    const audit = auditSessionStructure('packet-short', [turn(1, '我们继续。'), turn(2, '还是那样。')]);
    expect(audit.turnCount).toBe(2);
    expect(audit.openingWindow).toEqual({ from: 1, to: 2 });
    expect(audit.closingWindow).toEqual({ from: 1, to: 2 });
    expect(audit.opening.confidentiality.covered).toBe(false);
    expect(audit.closing.summary.covered).toBe(false);
  });

  it('⑧ 危机收束: 热线 + 联系人 + 不独处 → closingMode=risk', () => {
    const turns = [
      ...filler(21, 1),
      turn(22, '你现在有伤害自己的想法吗？', '我不想活了。'),
      turn(23, '先把药放到楼下，剪刀推远，门打开。'),
      turn(24, '打 12356，或者 120。'),
      turn(25, '联系家人过来陪你，不要一个人待着。'),
    ];
    const audit = auditSessionStructure('packet-risk', turns);
    expect(audit.crisisDetected).toBe(true);
    expect(audit.riskClosingComplete).toBe(true);
    expect(audit.closingMode).toBe('risk');
    expect(audit.closingComplete).toBe(true);
    expect(audit.riskClosing.means.covered).toBe(true);
    expect(audit.riskClosing.channel.covered).toBe(true);
    expect(audit.riskClosing.contact.covered).toBe(true);
    expect(audit.riskClosing.noAlone.covered).toBe(true);
  });

  it('⑧ 危机收束: 只有"身边有人吗"没有具体计划 → risk-incomplete', () => {
    const turns = [
      ...filler(21, 1),
      turn(22, '你现在有伤害自己的想法吗？', '有时候不想活。'),
      turn(23, '你身边有人能陪着你吗？'),
      turn(24, '我们继续说说。'),
      turn(25, '今天先到这里。'),
    ];
    const audit = auditSessionStructure('packet-risk-incomplete', turns);
    expect(audit.crisisDetected).toBe(true);
    expect(audit.riskClosingComplete).toBe(false);
    expect(audit.closingMode).toBe('risk-incomplete');
    expect(audit.closingComplete).toBe(false);
  });

  it('⑧ 危机识别: 咨询师确认安全 + 来访者"就是想过" → crisisDetected=true', () => {
    const turns = [
      ...filler(21, 1),
      turn(
        22,
        '我需要确认你的安全。现在独处有没有可能伤害自己的东西，比如药物、刀具或高处？以前有没有实施过？',
        '家里没药，也没刀。以前没实施过，就是想过。',
      ),
      turn(23, '好，先联系你姐，今晚让她过来陪你。'),
      turn(24, '如果她不方便，就马上联系第二个可信任的人，并直接打 12356 或 120。'),
      turn(25, '不要继续独处，先去客厅。'),
    ];
    const audit = auditSessionStructure('packet-crisis-counselor', turns);
    expect(audit.crisisDetected).toBe(true);
    expect(audit.closingMode).toBe('risk');
    expect(audit.riskClosingComplete).toBe(true);
  });

  it('⑨ summary 误报: 中间轮"梳理 + 我听到"不算收尾总结', () => {
    const turns = [...filler(21, 1), turn(22, '我们梳理一下，我听到你说最近很累。'), ...filler(2, 23), turn(25, '今天先到这里。')];
    const audit = auditSessionStructure('packet-summary-fp', turns);
    expect(audit.closing.summary.covered).toBe(false);
  });

  it('⑨ summary 邻近约束: 总结动作与理解复述跨 2 轮不算', () => {
    const turns = [
      ...filler(20, 1),
      turn(21, '我们总结一下。'),
      ...filler(2, 22),
      turn(24, '我的理解是，你今天很累。'),
      turn(25, '今天先到这里。'),
    ];
    const audit = auditSessionStructure('packet-summary-distance', turns);
    expect(audit.closing.summary.covered).toBe(false);
  });

  it('⑨ summary 正例: 总结动作与理解复述同轮 → 覆盖', () => {
    const turns = [
      ...filler(22, 1),
      turn(23, '我总结一下：我的理解是，你今天最在意的是被看见。'),
      turn(24, '你可以先记住那个念头。'),
      turn(25, '下次我们再约。'),
    ];
    const audit = auditSessionStructure('packet-summary-ok', turns);
    expect(audit.closing.summary.covered).toBe(true);
    expect(audit.closing.summary.matchedGroups).toEqual(['summaryAction', 'understanding']);
  });
});

describe('AF-127 · aggregateSessionStructure（纯函数）', () => {
  it('① 覆盖率 / 完整性计数 / candidate 状态 / 免责声明', () => {
    const compliant = auditSessionStructure('packet-01', compliantTurns());
    const bare = auditSessionStructure('packet-02', filler(25, 1));
    const aggregate = aggregateSessionStructure([compliant, bare]);
    expect(aggregate.packetCount).toBe(2);
    expect(aggregate.openingCoverage.confidentiality).toEqual({ covered: 1, total: 2, rate: 0.5 });
    expect(aggregate.closingCoverage.nextStep).toEqual({ covered: 1, total: 2, rate: 0.5 });
    expect(aggregate.openingCompletePackets).toBe(1);
    expect(aggregate.closingCompletePackets).toBe(1);
    expect(aggregate.routineClosingCompletePackets).toBe(1);
    expect(aggregate.riskDetectedPackets).toBe(0);
    expect(aggregate.riskClosingCompletePackets).toBe(0);
    expect(aggregate.closingModeCounts).toEqual({ risk: 0, routine: 1, 'risk-incomplete': 0, none: 1 });
    expect(aggregate.fullyCoveredPackets).toBe(1);
    expect(aggregate.partiallyCoveredPackets).toBe(0);
    expect(aggregate.status).toBe('candidate');
    expect(aggregate.gateEligible).toBe(false);
    expect(aggregate.disclaimer).toBe(SESSION_STRUCTURE_DISCLAIMER);
    expect(aggregate.disclaimer.length).toBeGreaterThan(0);
  });

  it('② 部分覆盖计数: 命中 1 项但没全项覆盖的 packet 计入 partially', () => {
    const partial = auditSessionStructure('packet-partial', [turn(1, '这次谈话的内容我会保密。'), ...filler(24, 2)]);
    const aggregate = aggregateSessionStructure([partial]);
    expect(aggregate.openingCompletePackets).toBe(0);
    expect(aggregate.fullyCoveredPackets).toBe(0);
    expect(aggregate.partiallyCoveredPackets).toBe(1);
  });

  it('③ 空集合: 覆盖率全 0, 状态仍是 candidate', () => {
    const aggregate = aggregateSessionStructure([]);
    expect(aggregate.packetCount).toBe(0);
    expect(aggregate.openingCoverage.confidentiality).toEqual({ covered: 0, total: 0, rate: 0 });
    expect(aggregate.status).toBe('candidate');
    expect(aggregate.gateEligible).toBe(false);
  });
});
