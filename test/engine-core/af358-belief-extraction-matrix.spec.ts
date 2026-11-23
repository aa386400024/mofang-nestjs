// AF-358 · 短期信念提取矩阵（30 条中文句式）
//   目的：把“问句 / 否定 / 第三人称转述 / 边界”从零散用例升级为可审计矩阵，
//   每条断言“是否被提取”，并对关键口径钉死（否定宾语要保留、第三方观察要保留）.
//   边界：纯函数，不读真实咨询原文，不连 DB/Redis，不读 env.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BELIEF_OPERATOR_CONFIG,
  extractReflectiveStatements,
  type BeliefOperatorConfig,
} from '../../src/engine-core/cognition/state-transition.js';

const CFG: BeliefOperatorConfig = {
  ...DEFAULT_BELIEF_OPERATOR_CONFIG,
  formationEnabled: true,
  formationMinChars: 6,
  formationMaxChars: 80,
};

interface Case {
  readonly group: '否定' | '问句' | '第三人称' | '边界';
  readonly text: string;
  readonly extracted: boolean;
  readonly note: string;
}

const CASES: readonly Case[] = [
  // 否定 8
  { group: '否定', text: '我似乎没有意识到我很容易焦虑', extracted: false, note: '标记后置否定' },
  { group: '否定', text: '我好像没发现自己很生气', extracted: false, note: '标记后置否定' },
  { group: '否定', text: '我并未发现我一直在讨好别人', extracted: false, note: '否定插在标记中间 → 无连续标记' },
  { group: '否定', text: '我没发现我总是焦虑', extracted: false, note: '无连续标记' },
  { group: '否定', text: '我似乎从来没有意识到自己会这样', extracted: false, note: '标记后置否定（从来没有）' },
  { group: '否定', text: '我似乎并不觉得自己被排斥', extracted: false, note: '标记后置否定（并不）' },
  { group: '否定', text: '我发现我并不开心', extracted: true, note: '否定的是宾语，不是标记' },
  { group: '否定', text: '我意识到自己不想再讨好了', extracted: true, note: '否定宾语，不是标记' },
  // 问句 8
  { group: '问句', text: '我发现我是不是太敏感了', extracted: false, note: '句中疑问结构' },
  { group: '问句', text: '我意识到我有没有在讨好别人', extracted: false, note: '句中疑问结构' },
  { group: '问句', text: '我觉察到我会不会太在意评价', extracted: false, note: '句中疑问结构' },
  { group: '问句', text: '我注意到我能不能拒绝别人', extracted: false, note: '句中疑问结构' },
  { group: '问句', text: '我开始意识到我为什么总在道歉', extracted: false, note: '句中疑问结构' },
  { group: '问句', text: '我发现我该怎么办', extracted: false, note: '句中疑问结构' },
  { group: '问句', text: '我发现我一直在讨好别人吗', extracted: false, note: '句尾语气词' },
  { group: '问句', text: '我意识到我总在回避冲突呢', extracted: false, note: '句尾语气词' },
  // 第三人称 6
  { group: '第三人称', text: '我发现我朋友说我一直在讨好别人', extracted: false, note: '第三方转述' },
  { group: '第三人称', text: '我意识到老师认为我很焦虑', extracted: false, note: '第三方转述' },
  { group: '第三人称', text: '我注意到妈妈觉得我不够好', extracted: false, note: '第三方转述' },
  { group: '第三人称', text: '我发现同事提到我总是退让', extracted: false, note: '第三方转述' },
  { group: '第三人称', text: '我发现她总是这样', extracted: true, note: '来访对第三方的观察，不是转述' },
  { group: '第三人称', text: '我意识到他很难过', extracted: true, note: '来访对第三方的观察' },
  // 边界 8
  { group: '边界', text: '我发现我累', extracted: false, note: '过短' },
  { group: '边界', text: `我发现${'我'.repeat(100)}`, extracted: false, note: '过长' },
  { group: '边界', text: '发现一直在讨好别人', extracted: false, note: '无第一人称' },
  { group: '边界', text: '我一直在讨好别人', extracted: false, note: '无标记' },
  { group: '边界', text: '我意识到我想死', extracted: false, note: '危机词' },
  { group: '边界', text: '我注意到我一直在讨好别人，这让我很累', extracted: true, note: '逗号切句后前半句合法' },
  { group: '边界', text: '我意识到我一直在讨好别人。', extracted: true, note: '正常陈述' },
  { group: '边界', text: '我觉察到我总在回避冲突；这让我很累', extracted: true, note: '分号切句后前半句合法' },
];

describe('AF-358 · 提取矩阵（30 条）', () => {
  it('矩阵共 30 条，四组齐全', () => {
    expect(CASES).toHaveLength(30);
    expect(new Set(CASES.map((item) => item.group))).toEqual(new Set(['否定', '问句', '第三人称', '边界']));
  });

  for (const item of CASES) {
    it(`${item.group} · ${item.note} → ${item.extracted ? '保留' : '排除'}`, () => {
      const result = extractReflectiveStatements(item.text, CFG);
      expect(result.length > 0).toBe(item.extracted);
    });
  }

  it('逗号后的续写不拆句；后半句出现新标记才拆', () => {
    expect(extractReflectiveStatements('我意识到我一直在讨好别人，这让我很累', CFG)).toEqual(['我意识到我一直在讨好别人，这让我很累']);
    expect(extractReflectiveStatements('我意识到我一直在讨好别人，我发现我很难拒绝', CFG)).toEqual([
      '我意识到我一直在讨好别人',
      '我发现我很难拒绝',
    ]);
  });
});
