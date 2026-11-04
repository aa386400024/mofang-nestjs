// V2026-11-03 WP37 (B 层 · 滚动摘要生成):
//   职责: 把"被工作窗口挤出的咨询师发言"压缩成一段**滚动摘要** —— 每来一批新发言,
//         就把它并进上一版摘要, 产出一版覆盖全部已聊内容的新摘要.
//   边界: 只做"发言 → 摘要"; 攒批 / 写记忆仓储都在 rolling-session-summary.service.ts.
//
//   为什么要有"滚动"这个概念 (而不是每批各生成一段独立摘要):
//     独立摘要会**丢上下文** —— 第二批的摘要只覆盖第二批, 第一批说过的事没人记得了.
//     滚动摘要 = 每一版都覆盖"到目前为止聊过的全部", 于是越往后越完整, 且始终只有一段
//     (能塞进 prompt 的长度是固定的, 段落数不能随轮次增长).
//
//   为什么输入只有**咨询师一侧**的发言 (而 WP12 的最终摘要是两侧):
//     内核的溢出回调只交出咨询师原话 —— 内核不渲染, 拿不到来访者的话
//     (见 in-memory-engine-session.ts 的 rememberTurn 说明).
//     所以本摘要的口径必须**如实说明**: 它是"咨询师谈了什么"的摘要, 不是逐字稿摘要.
//     提示词里明确要求模型**不要替来访者编造**没说过的话 —— 否则摘要会变成凭空捏造,
//     而捏造出来的事实会被后续对话当真 (这是最坏的一种失真).
//
//   反双胞胎:
//     - 不自己写 JSON 解析 —— 复用 session-summary.generator.ts 的 parseSummaryResponse
//       (模型偶尔不按 JSON 回时的退化口径只有那一份).
//     - 不新造 LLM 客户端 —— 走既有 LlmRouterService (与 WP12 的摘要器同一条链).
//     - 不把 prompt 写进内核 —— 本文件在适配层, 内核零 prompt (boundary 断言④守着).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp37-rolling-session-summary.spec.ts 覆盖组装 / 退化 / 服务编排

import { parseSummaryResponse } from './session-summary.generator.js';
import { LLMTier } from '../../llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest } from '../../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../../llm/registry/llm-router.service.js';

/**
 * 滚动摘要生成入参.
 */
export interface RollingSummaryInput {
  /** 上一版滚动摘要 (首次生成时缺省). */
  readonly previousSummary?: string;
  /** 本次新增的咨询师发言 (按时间正序). */
  readonly newLines: readonly string[];
}

/**
 * 滚动摘要生成端口 (窄面).
 *
 * 为什么要窄面: 本文件不该知道"摘要怎么生成"(LLM / 规则 / 人工),
 * 只该知道"给我一段摘要". 单测用 stub, 换生成方式不用动服务编排.
 */
export interface RollingSummaryGenerator {
  /**
   * 生成滚动摘要.
   *
   * @param input 上一版摘要 + 本批新增发言
   * @returns 摘要正文; 生成不出来应**抛错** (由调用方降级)
   */
  generate(input: RollingSummaryInput): Promise<string>;
}

/**
 * 滚动摘要提示词 (系统段).
 *
 * 三条硬约束:
 *   1. 只写**已经出现过的**内容 —— 不替来访者编造经历或情绪 (输入里没有来访者的话,
 *      模型很容易顺着咨询师的话脑补出来访者"其实很焦虑"这种没依据的结论);
 *   2. 覆盖全部已聊内容 —— 给了上一版摘要时, 输出必须是**并入新内容后的完整版**;
 *   3. 长度上限 —— 摘要要塞进 prompt, 长度失控 = 每轮 prompt 都被撑大.
 */
const ROLLING_SUMMARY_SYSTEM_PROMPT = [
  '你是一名咨询训练场景的会话纪要助手。下面给你的是一段**咨询师一侧**的发言记录（来访者的话没有出现在这里）。',
  '请把它压缩成一段「此前我们聊过什么」的滚动摘要，供来访者角色在后续对话里保持话题连续。',
  '',
  '要求：',
  '1. 只写已经出现过的内容：谈到的议题、情绪线索、关系进展。不要替来访者编造他没说过的经历、感受或承诺。',
  '2. 如果给了上一版摘要，输出必须是把新内容并进去之后的**完整版**摘要，不要只写新增部分。',
  '3. 不超过 120 字。不要写具体话术，不要做临床诊断。',
  '',
  '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：',
  '{"summary": "…"}',
].join('\n');

/**
 * 滚动摘要 token 上限种子值.
 *
 * 120 字中文 ≈ 180 token, 留出余量取 400 —— 够写摘要, 又不会让"每 3 轮一次"的
 * 摘要调用吃掉太多额度 (滚动摘要是**高频**调用, 不是收尾路径上的一次性调用).
 */
export const DEFAULT_ROLLING_SUMMARY_MAX_COMPLETION_TOKENS = 400;

/**
 * 滚动摘要生成器构造入参.
 */
export interface LlmRollingSummaryGeneratorOptions {
  /** LLM 路由 (走既有 chat 出口, 不新造客户端). */
  readonly router: LlmRouterService;
  /** 模型名 (厂商相关, 由装配层解析后传入). */
  readonly model: string;
  /** 单次完成 token 上限 (缺省 = 种子值). */
  readonly maxCompletionTokens?: number;
}

/**
 * LLM 滚动摘要生成器.
 */
export class LlmRollingSummaryGenerator implements RollingSummaryGenerator {
  private readonly router: LlmRouterService;
  private readonly model: string;
  private readonly maxCompletionTokens: number;

  constructor(options: LlmRollingSummaryGeneratorOptions) {
    this.router = options.router;
    this.model = options.model;
    this.maxCompletionTokens = options.maxCompletionTokens ?? DEFAULT_ROLLING_SUMMARY_MAX_COMPLETION_TOKENS;
  }

  /**
   * 生成滚动摘要.
   *
   * @param input 上一版摘要 + 本批新增发言
   * @returns 摘要正文 (模型不按 JSON 回时退化为"原文当摘要", 与 WP12 同款口径)
   * @throws LLM 调用失败时抛错 (由服务降级为"本批不摘要")
   */
  async generate(input: RollingSummaryInput): Promise<string> {
    const request: ChatCompletionRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: ROLLING_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: formatRollingSummaryInput(input) },
      ],
      temperature: 0.2,
      maxCompletionTokens: this.maxCompletionTokens,
      stream: false,
    };

    const response = await this.router.chat(request);
    return parseSummaryResponse(response.content).content;
  }
}

/**
 * 滚动摘要生成器构造入参 → 提示词正文.
 *
 * 为什么显式标注"咨询师: "前缀: 输入里只有咨询师一侧的话, 不标角色的话,
 * 模型会以为这是完整对话, 从而把咨询师的话当成来访者的自述 —— 那就正好触发了
 * "不要编造"这条约束要防的事.
 */
export function formatRollingSummaryInput(input: RollingSummaryInput): string {
  const parts: string[] = [];
  if (input.previousSummary && input.previousSummary.trim().length > 0) {
    parts.push(`[上一版摘要]\n${input.previousSummary.trim()}`);
  }
  const lines = input.newLines.map((line) => `咨询师: ${line.trim()}`).join('\n');
  parts.push(`[新增的咨询师发言]\n${lines}`);
  return parts.join('\n\n');
}

/**
 * 解析滚动摘要用的模型名 (与 WP12 的最终摘要同一口径).
 *
 * env 优先, 否则问 router 的 tier→model 映射 (RAG 层: 摘要是"从长文本抽要点"的任务).
 *
 * @param explicit env 配置的模型名 (缺省 / 空白 = 走 router 默认)
 * @param router LLM 路由
 * @returns 模型名
 */
export function resolveRollingSummaryModel(explicit: string | undefined, router: LlmRouterService): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  return router.getDefaultModelForTier(LLMTier.RAG);
}
