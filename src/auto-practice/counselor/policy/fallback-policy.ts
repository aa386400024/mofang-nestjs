import { randomInt } from 'node:crypto';

/**
 * 兜底策略: LLM 失败时的中性过渡语池.
 *
 * 为什么"随机 + 避开上一句":
 *   纯随机在相邻两次兜底时仍可能取到同一句 —— 那就等于没改 (复读照旧).
 *   避开上一句后, 相邻两次兜底保证不同.
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
export class FallbackPolicy {
  private lastIndex = -1;

  constructor(private readonly replies: readonly string[] = DEFAULT_REPLIES) {
    if (replies.length === 0) {
      throw new Error('FallbackPolicy: replies 不能为空');
    }
  }

  /**
   * 取一句兜底台词, 主动避开上一句.
   */
  pick(): string {
    const size = this.replies.length;
    let index = randomInt(size);
    if (index === this.lastIndex) {
      index = (index + 1) % size;
    }
    this.lastIndex = index;
    return this.replies[index];
  }
}

/** 默认兜底台词池 (5 句中性过渡). */
const DEFAULT_REPLIES: readonly string[] = [
  '嗯，我在听。你可以接着说。',
  '我在这儿听着，你慢慢说。',
  '好，这部分我听到了。你想接着说哪儿都行。',
  '嗯……你慢慢讲，我不打断你。',
  '收到。你说，我听着。',
];
