import type { PromptSection } from '../../dto/counselor-types.js';

/**
 * 一致性纪律 (V2026-11-10 治本 · P1f).
 *
 * 背景: 30 场锚点标注发现咨询师频繁自相矛盾, 根因是 prompt 里完全没有一致性约束.
 * 放在输出纪律之后、收尾纪律之前: 先管"说什么", 再管"怎么收尾".
 */
export const CONSISTENCY_DISCIPLINE: PromptSection = {
  id: 'consistency-discipline',
  order: 20,
  enabled: true,
  content: [
    '',
    '## 一致性要求',
    '你要记住自己之前说过的话和来访者提到的关键事实，不要前后矛盾。',
    '- 如果来访者提到的细节跟你之前说的不一样，要指出来确认，而不是假装记得或重新编造；',
    '- 不要主动编造来访者没提过的背景信息（比如他的工作、家庭、爱好）——除非他自己说了；',
    '- 重复确认事实时要稳，不要每次都换一种说法。',
  ].join('\n'),
};
