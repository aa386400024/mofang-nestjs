// V2026-10-29 治本 (WP8-B · B 层 · 流式渲染端口):
//   职责: 定义渲染的**第二种交付形态** —— 在内核 `RenderPort` 之上追加一个
//         **可选**的 `streamRender`, 声明「怎么把增量交给消费方」的契约:
//         流式回调面 (onDelta / signal) / 流式收尾结果 / 前置预检结论.
//   边界: 纯类型 + 纯函数, 零 @nestjs / 零 IO / 零模型名; **不进 engine-core**
//         (内核整树零改动是本期红线).
//
//   为什么端口定义在适配层而不是内核 (与任务单 §1.2(c) 同口径):
//     内核的 `RenderPort` 是**渲染契约** (要什么 / 给什么), 它的实现方是适配层.
//     流式只是同一段渲染的**交付形态**, 不是第二条平行管线 —— 所以它是内核端口的
//     一个**可选扩展**, 而不是内核的新契约. 把它塞进内核会让内核多出一份
//     "消费方怎么接" 的知识, 而内核的边界原则是"零 IO / 零传输".
//     代价是: 适配层要有两个端口形状 —— 但它们同源 (StreamingRenderPort extends
//     RenderPort), 不会出现两份"渲染要什么"的真相.
//
//   为什么 `streamRender` 是**可选方法**而不是必实现:
//     必实现会立刻打破两处既有契约 —— ① 内核 RenderPort 的实现者 (WP6 之前的
//     任何实现 / 单测里的 mock) 全部要跟着改; ② 门面拿到的 renderer 类型被写死成
//     "一定有流式", 于是"没有流式能力"这件事只能靠运行时异常表达.
//     做成可选方法后: 没实现流式的渲染器 → 门面走"聚合收集成流"的兜底形态,
//     既有 mock 与既有单测零回归, 且降级是**显式**的而不是隐式的崩溃.
//
//   反双胞胎:
//     - 不把 `RenderGuardVerdict` 在两个文件各定义一份: 它原本住在
//       llm-render.adapter.ts, 本文件需要它 → 单一真相搬到这里, 适配器再 re-export
//       回原路径 (老 import 路径不断), 免得两份形状慢慢漂移.
//     - 不在流式端口里塞"句切规则": 切句是 TTS 的成熟资产 (voice/tts/tts-sentence-
//       splitter.ts), 渲染层再写一份切句就是第二个真相. 这里只提供**兜底**用的
//       文本分段 (仅在"渲染器没有流式能力"时才用), 与 TTS 切句互不干扰.
//     - 不给流式结果塞厂商私有字段: usage 只有内核约定的两个口径, providerHint 是
//       候选标识, 与 `RenderResult` 保持同一套语义.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8b-stream-render.spec.ts 覆盖流式状态机与降级
//     3. test/engine-adapters/wp8b-turn-stream.spec.ts 覆盖门面的流式出口

import type { RenderPort, RenderSpec, RenderTaskKind } from '../../engine-core';

/**
 * 输出侧校验结论 (只取内核约定的等级与类别, 不引入厂商私有结构).
 *
 * 原本住在 `llm-render.adapter.ts`; WP8-B 起由本文件持有 (流式收尾结果要带它),
 * 适配器保留 re-export, 老 import 路径不断.
 */
export interface RenderGuardVerdict {
  /** 判定等级. */
  readonly level: 'pass' | 'warn' | 'block';
  /** 命中的类别 (可选; 供观测定位, 不参与控制流). */
  readonly categories?: readonly string[];
}

/**
 * 前置静态预检结论 (首 delta 之前, 只基于 RenderSpec, 不调模型).
 *
 * 与 `RenderGuardVerdict` 同形但**语义不同**: 前置预检判的是"这一轮能不能开口",
 * 后置 guard 判的是"这段已经说出口的话安不安全". 两者共用一个形状是为了让上层
 * 只需要认识一种"等级 + 类别"的口径.
 */
export interface RenderPrecheckVerdict {
  /** 判定等级. */
  readonly level: 'pass' | 'warn' | 'block';
  /** 命中的类别 (可选; 供观测定位). */
  readonly categories?: readonly string[];
}

/**
 * 流式渲染的回调面.
 *
 * 为什么 `onDelta` 是**回调**而不是"返回一个 AsyncIterable":
 *   消费方 (voice) 需要在拿到增量的**当场**做三件事 —— 转发 `llm_text` 帧、
 *   喂 TTS 句合成、比对 generation (barge-in 后立刻丢弃迟到增量).
 *   若渲染层返回 AsyncIterable, 消费方得自己再包一层队列才能做这三件事;
 *   而"把 push 型回调转成 pull 型流"这件事在渲染侧做一次更省心 (只做一次).
 */
export interface StreamRenderHandlers {
  /** 增量文本回调 (按到达顺序调用; 允许同步或异步). */
  readonly onDelta: (delta: string) => void | Promise<void>;
  /** 中断信号 (barge-in 触发; 已出声的内容无法撤回, 只用于停止继续取数). */
  readonly signal?: AbortSignal;
}

/**
 * 流式渲染的收尾结果 (与 `RenderResult` 同构, 多两个流式专属字段).
 */
export interface StreamRenderOutcome {
  /** 本轮累计文本 (降级时为兜底句或已出声的残句). */
  readonly text: string;
  /** 本轮任务分层. */
  readonly taskKind: RenderTaskKind;
  /** 用量 (仅供观测; 流式无 prompt/completion 拆分, 两个口径同源). */
  readonly usage: {
    readonly completionTokens: number;
    readonly totalTokens: number;
    /**
     * 思考 token 数 (推理模型专用; 缺省 = 上游没报).
     *
     * V2026-10-29 治本 (WP9-C): 与 completionTokens 分开上报 —— 后者含思考,
     * 两者混在一起就看不出"输出被截断"还是"思考吃光了预算".
     */
    readonly reasoningTokens?: number;
  };
  /** 是否走过备用路径 (切过备 / 走过降级). */
  readonly fallbackUsed: boolean;
  /** 实际提供服务的候选标识 (全挂降级时为 'degraded'). */
  readonly providerHint?: string;
  /**
   * 是否降级产物 (兜底句 / 中断的残句).
   *
   * 上层据此决定要不要把本轮"来访者说的话"落进历史与工作记忆 ——
   * 系统兜底句不是来访真说的话, 写进记忆等于教模型输出兜底话术.
   */
  readonly degraded: boolean;
  /** 后置全文 guard 判定 (观测用; 流式路径只记信号, 不 regen 不撤回). */
  readonly guardVerdict?: RenderGuardVerdict;
}

/**
 * 流式渲染端口 (在内核 `RenderPort` 之上追加**可选**的流式扩展).
 *
 * 反双胞胎: 不另立一个与 `RenderPort` 平行的"流式端口" —— 那会让"渲染要什么"
 * 有两份真相. 流式端口是内核端口的**子类型**, 任何实现了流式的渲染器同时也是
 * 一个聚合渲染器.
 */
export interface StreamingRenderPort extends RenderPort {
  /**
   * 流式渲染 (可选; 未实现时调用方走"聚合收集成流"的兜底形态).
   *
   * 契约:
   *   - 永不 reject: 全挂 / 出错一律返回降级结果 (fallbackUsed=true, degraded=true);
   *   - 已吐出的内容不可撤回, 所以首 delta 之后不再切备;
   *   - `onDelta` 的调用顺序 = 文本到达顺序.
   */
  streamRender?(spec: RenderSpec, handlers: StreamRenderHandlers): Promise<StreamRenderOutcome>;
}

/**
 * 兜底用的文本分段 (仅在"渲染器没有流式能力"时使用).
 *
 * 切点: 句末标点立即成段; 超长段按 `maxChars` 硬切.
 * 为什么不复用 TTS 的切句器: TTS 切句是**出声**口径 (与上游攒句协议逐字对齐,
 * 切早会让那句永不合成), 而这里是**字幕**口径 (给 llm_text 帧分段);
 * 两者的切点集合与长度上限本就不同, 强行合并会把上游协议的风险带进字幕层.
 *
 * @param text 完整文本
 * @param maxChars 单段最大长度 (超长硬切)
 * @returns 文本分段 (顺序即原文顺序)
 */
export function splitTextIntoDeltas(text: string, maxChars = 24): string[] {
  const limit = Math.max(1, Math.trunc(maxChars));
  const chunks: string[] = [];
  let buffer = '';
  for (const char of text) {
    buffer += char;
    if (isDeltaBoundary(char)) {
      chunks.push(buffer);
      buffer = '';
      continue;
    }
    if (buffer.length >= limit) {
      chunks.push(buffer);
      buffer = '';
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks;
}

/**
 * 是否是分段边界字符 (句末标点 / 换行).
 *
 * 说明: 用 `Set` 查表而不是正则 —— 正则在本仓有 `sonarjs/super-linear-regex` 红线,
 * 而且这里就是逐字符判定, 没有任何需要正则的表达力.
 */
const DELTA_BOUNDARIES: ReadonlySet<string> = new Set(['。', '！', '？', '…', '；', '!', '?', '\n']);

/** 该字符是否是分段边界. */
function isDeltaBoundary(char: string): boolean {
  return DELTA_BOUNDARIES.has(char);
}
