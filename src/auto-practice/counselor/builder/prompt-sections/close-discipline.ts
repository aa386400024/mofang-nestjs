import type { PromptSection } from '../../dto/counselor-types.js';

/** 收尾标记: 模型每轮必须在末尾选一个状态. */
export const CLOSE_TAG = '[[STATE:END]]';
export const CONTINUE_TAG = '[[STATE:MORE]]';

/**
 * 收尾纪律: 每轮末尾强制二选一 (END / MORE).
 *
 * 为什么用"强制二选一"而不是"可选标记": 实测可选标记几乎不会被输出,
 * 强制每轮表态才会真的执行.
 */
export const CLOSE_DISCIPLINE: PromptSection = {
  id: 'close-discipline',
  order: 30,
  enabled: true,
  content: [
    '',
    '## 收尾纪律',
    '每一轮回复的**最后一行**都必须只写一个状态标记（正文与标记之间空一行）：',
    `- ${CONTINUE_TAG} —— 议题还在展开，本轮结束后还要继续；`,
    `- ${CLOSE_TAG} —— 本轮你说的话就是这次咨询的收尾：已经做了总结、给了方向或约定了下一步，`,
    '  来访者的主要议题已经落地，再来一轮就是没必要的拖长。',
    '判断标准偏向"该收就收"：真人在这种情况会说"今天先到这里"，而不是继续追问细节。',
    '标记只能出现在最后一行，正文里不要解释它、不要复述它。',
  ].join('\n'),
};
