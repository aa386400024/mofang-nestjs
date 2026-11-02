// V2026-10-30 治本 (WP12 · B 层 · 会话摘要生成):
//   职责: 把本场逐字稿交给 LLM, 产出一段 ≤200 字的会话摘要 (来访者核心议题 +
//         情绪基调 + 关键转折) + 一个核心议题短键 (冲突分组用).
//   边界: 只做"逐字稿 → 摘要"; 晋升 / 落库都在 session-closeout.service.ts.
//
//   为什么摘要要单独一个文件 (与收尾服务分开):
//     收尾服务关心的是**顺序与失败语义**(先落库, 再摘要, 失败各降各的);
//     摘要器关心的是**怎么问模型**. 两件事的变动频率差得很远:
//     换模型 / 改提示词 只动摘要器, 改收尾语义 只动收尾服务.
//     塞在一起 → 每次调提示词都要在一堆收尾逻辑里翻.
//
//   反双胞胎:
//     - 不自己写"怎么抽议题" —— 交给模型; 本文件只负责**把模型输出解析成结构**.
//     - 不在解析失败时抛错 —— 模型偶尔不按 JSON 格式回, 那时退化成"把原文当摘要",
//       比整场没收尾好 (收尾服务那边才决定要不要用).
//     - 不把逐字稿原文塞进记忆: 只落**摘要**, 不落原文 ——
//       逐字稿归逐字稿表 (业务侧落库), 记忆里只放"提炼过的事实".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp12-memory-closeout.spec.ts: JSON 解析 / 非 JSON 退化 / 空输出

import { Injectable } from '@nestjs/common';

import type { SessionSummary, SessionSummaryGenerator } from './session-closeout.service';
import type { TranscriptTurn } from '../../agent/supervisor/supervisor.types';
import { LLMTier } from '../../llm/common/enums/llm.enums';
import type { ChatCompletionRequest } from '../../llm/common/interfaces/chat-provider.interface';
import { LlmRouterService } from '../../llm/registry/llm-router.service';

/**
 * 摘要提示词 (系统段).
 *
 * 为什么要求 JSON 而不是自由文本: 摘要的**议题键**要拿去当冲突分组键 (topicKey),
 * 必须是稳定的短字符串; 让模型自由输出就一定会带出"议题：\n"这种噪声.
 * 用 JSON 把两个字段分开, 解析时可以各自兜底.
 *
 * 提示词里**不写**"来访者患有什么疾病"这类临床判断 —— 摘要只描述"来访者说了什么、
 * 情绪基调如何、有什么转折", 那是**观察**不是**诊断**.
 */
const SUMMARY_SYSTEM_PROMPT = [
  '你是一名咨询训练场景的会话纪要助手。请阅读一段咨询师与来访者的对话, 输出一段会话摘要。',
  '只输出一个 JSON 对象, 不要输出任何解释或代码块围栏:',
  '{"summary": "…", "topicKey": "…"}',
  '',
  'summary 字段 (不超过 200 字): 依次写清「来访者核心议题」「情绪基调」「关键转折」三件事,',
  '只描述来访者表达出来的内容与情绪, 不要做临床诊断, 不要给建议, 不要写具体话术。',
  '',
  'topicKey 字段 (不超过 16 个字): 本场核心议题的短标签, 用于跨会话归档同一主题;',
  '同一主题在不同场次应给出同一个标签; 实在概括不出就给空字符串。',
].join('\n');

/**
 * 摘要 token 上限种子值.
 *
 * 200 字中文 ≈ 300 token, 留出余量取 600 —— 够写摘要, 又不会让收尾路径上的
 * 单次 LLM 调用吃掉太多时间 (收尾是 fire-and-forget, 但仍不该成为资源黑洞).
 */
export const DEFAULT_SUMMARY_MAX_COMPLETION_TOKENS = 600;

/**
 * 摘要生成器构造入参.
 */
export interface LlmSessionSummaryGeneratorOptions {
  /** LLM 路由 (走既有 chat 出口, 不新造客户端). */
  readonly router: LlmRouterService;
  /** 模型名 (厂商相关, 由装配层解析后传入). */
  readonly model: string;
  /** 单次完成 token 上限 (缺省 = 种子值). */
  readonly maxCompletionTokens?: number;
}

/**
 * LLM 摘要生成器.
 */
@Injectable()
export class LlmSessionSummaryGenerator implements SessionSummaryGenerator {
  private readonly router: LlmRouterService;
  private readonly model: string;
  private readonly maxCompletionTokens: number;

  constructor(options: LlmSessionSummaryGeneratorOptions) {
    this.router = options.router;
    this.model = options.model;
    this.maxCompletionTokens = options.maxCompletionTokens ?? DEFAULT_SUMMARY_MAX_COMPLETION_TOKENS;
  }

  /**
   * 生成本场摘要.
   *
   * @param transcript 本场逐字稿
   * @returns 摘要 (解析失败时退化为"原文当摘要")
   * @throws LLM 调用失败时抛错 (由收尾服务降级为"不晋升")
   */
  async generate(transcript: readonly TranscriptTurn[]): Promise<SessionSummary> {
    const request: ChatCompletionRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: formatTranscript(transcript) },
      ],
      temperature: 0.2,
      maxCompletionTokens: this.maxCompletionTokens,
      stream: false,
    };

    const response = await this.router.chat(request);
    return parseSummaryResponse(response.content);
  }
}

/**
 * 解析摘要用的模型名 (WP12).
 *
 * 口径: **env 优先, 否则问 router 自己**的 tier→model 映射.
 *
 * 为什么不在装配层硬编码模型名: 模型名是**厂商相关**的事实 (deepseek 是 'deepseek-chat',
 * qwen 是 'qwen-plus'), 各厂商有什么模型只有 router 知道 —— 装配层再写一份模型名表,
 * 就是第二份真相, 厂商一改就漂移 (与 `render-config.factory.ts` 的 `modelFor()` 同款理由).
 *
 * 用 **RAG 分层**: 摘要是"从长文本里抽要点"的任务, 归 RAG 层最贴; 不单独开一层,
 * 因为摘要不是核心推理, 没必要动 ADVANCED 那种长时模型.
 *
 * @param explicit env 配置的模型名 (缺省 / 空白 = 走 router 默认)
 * @param router LLM 路由
 * @returns 模型名
 */
export function resolveSummaryModel(explicit: string | undefined, router: LlmRouterService): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  return router.getDefaultModelForTier(LLMTier.RAG);
}

/**
 * 逐字稿 → 提示词正文.
 *
 * 角色标注必须显式: 引擎链路的逐字稿里 role='user' 是**咨询师**、role='assistant' 是
 * **来访者** (AI 扮演来访者). 不标注的话, 模型会把两边读反 —— 摘要把咨询师的话
 * 当成来访者的事实, 那条记忆就从根上错了.
 */
export function formatTranscript(transcript: readonly TranscriptTurn[]): string {
  return transcript
    .map((turn) => {
      const speaker = turn.role === 'user' ? '咨询师' : '来访者';
      return `${speaker}: ${turn.content}`;
    })
    .join('\n');
}

/**
 * 解析模型输出 → 摘要.
 *
 * 容错顺序 (从严到宽):
 *   1. 剥掉 ```json 代码块围栏 → JSON.parse → 取两个字段;
 *   2. 剥围栏后仍不是 JSON → 把整段文本当摘要 (模型自由发挥也是一种可用输出);
 *   3. JSON 但缺字段 → 缺的字段按"空"处理.
 *
 * @param raw 模型原始输出
 * @returns 摘要 (content 恒为非空字符串的 trim 结果, 除非原始输出就是空的)
 */
export function parseSummaryResponse(raw: string): SessionSummary {
  const text = raw.trim();
  if (text.length === 0) {
    return { content: '' };
  }

  const unfenced = stripCodeFence(text);
  const parsed = tryParseJson(unfenced);
  if (parsed) {
    const content = readString(parsed['summary']);
    const topicKey = readString(parsed['topicKey']);
    if (content.length > 0) {
      return topicKey.length > 0 ? { content, topicKey } : { content };
    }
  }

  // 模型没按 JSON 回 → 整段当摘要. 摘要质量不如结构化输出, 但总比没有强.
  return { content: unfenced };
}

/**
 * 剥掉 ``` 围栏 (模型很爱加).
 *
 * 为什么不用一条大正则 (`/^```(?:json)?\s*([\s\S]*?)\s*```$/`):
 *   那个写法有**嵌套量词** (惰性组 + `\s*`), 回溯是超线性的 —— 一段几百字的模型输出
 *   就能把正则引擎拖进指数级回溯 (sonarjs/super-linear-regex).
 *   改成"前缀去掉 + 后缀切掉"两步, 代价是常数级的字符串操作, 结果完全一样.
 *
 * @param text 原始文本
 * @returns 剥掉围栏后的文本 (不是围栏 → 原样返回)
 */
function stripCodeFence(text: string): string {
  const OPEN = '```';
  if (!text.startsWith(OPEN)) return text;
  const body = text.slice(OPEN.length).replace(/^(?:json)?\s*/i, '');
  if (!body.endsWith(OPEN)) return text;
  return body.slice(0, body.length - OPEN.length).trim();
}

/**
 * 尝试 JSON.parse (失败 → null, 不抛).
 */
function tryParseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 读字符串字段 (非字符串 / 空 → 空串).
 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
