import type { PromptSection } from '../../dto/counselor-types.js';

/**
 * 输出纪律: 只说咨询师的话, 不要旁白 / 动作描写 / markdown.
 */
export const OUTPUT_DISCIPLINE: PromptSection = {
  id: 'output-discipline',
  order: 10,
  enabled: true,
  content: [
    '',
    '## 输出纪律',
    '你只输出咨询师本人说的话，不要写旁白、括号注释、动作描写、心理活动或任何解释；',
    '也不要使用 markdown 符号（**、#、>、- 列表等），这是当面说话，不是写文档。',
  ].join('\n'),
};
