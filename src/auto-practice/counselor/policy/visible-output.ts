// V2026-11-18 治本 (AF-102 · 长会话咨询师可见输出):
//   职责: 判定"这一轮模型到底有没有**可见台词**", 并把"只有推理块"的输出认出来.
//
// ── 为什么需要它 (真实故障现场) ────────────────────────────────────────────
//   AF-095 的 3 场 long 会话 (146 轮) 里, 咨询师可见输出为空 53 轮 (36.3%).
//   只读复核那 3 份逐字稿的结果: 150 条咨询师消息里 **57 条带 `<think>` 推理块**,
//   其中 57 条**剥掉推理块后可见台词为空** (推理块独占整条 content).
//
//   于是原来的判据 `raw.length === 0` **一次都没命中过** —— content 非空 (装的是推理),
//   代码当成"正常回复"返回, 于是:
//     ① 没有兜底, 没有降级计数 (空输出在链路里**看不出来**);
//     ② 更糟: 咨询师的**内部推理**被当成"咨询师说的话"喂给了来访者引擎.
//
// ── 本模块的口径 ───────────────────────────────────────────────────────────
//   · "可见台词" = content 去掉推理块之后剩下的东西;
//   · 推理块既不算台词, 也不该进逐字稿 (那不是"咨询师说的话");
//   · 截断 (finishReason=length) 单独一维 —— 截断的回复**非空但不可信**, 不能静默当正常.
//
// 反双胞胎:
//   - 纯函数, 零 IO / 零 env / 零 NestJS;
//   - 不做内容改写 (只删推理块), 不润色、不补全 —— 那是模型的事.

/**
 * 去掉模型推理块 (`<think>...</think>`).
 *
 * ⚠️ 为什么要处理**未闭合**的推理块:
 *   输出被长度上限截断时, 推理块往往只开了头没结尾 (`<think>...` 就没了).
 *   只处理闭合块的话, 截断的推理会**留在**台词里 —— 正是最该被清掉的那种.
 *
 * @param text 原始 content
 * @returns 去掉推理块后的可见文本 (已 trim)
 */
export function stripReasoningBlocks(text: string): string {
  const withoutClosed = text.replaceAll(/<think>[\s\S]*?<\/think>/gi, '');
  // 未闭合的推理块: 从 `<think>` 一直删到结尾 (它后面本来就没有别的内容了).
  const withoutOpenTail = withoutClosed.replace(/<think>[\s\S]*$/i, '');
  return withoutOpenTail.trim();
}

/**
 * 一次生成的"可见输出"判定结果.
 */
export interface VisibleOutputJudgement {
  /** 去掉推理块后的可见文本 (还没剥状态标记). */
  readonly visible: string;
  /** 可见文本是否为空 (只有推理块 / 什么都没有). */
  readonly empty: boolean;
  /** 是否被长度上限截断 (finishReason=length). */
  readonly truncated: boolean;
}

/**
 * 判定一次生成有没有可见输出 (纯函数).
 *
 * @param content 模型返回的原始 content
 * @param finishReason 上游终止原因 (截断时为 'length'; 缺省 = 未截断)
 * @returns 判定结果
 */
export function judgeVisibleOutput(content: string, finishReason?: string): VisibleOutputJudgement {
  const visible = stripReasoningBlocks(content);
  return {
    visible,
    empty: visible.length === 0,
    truncated: finishReason === 'length',
  };
}
