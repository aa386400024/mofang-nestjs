// V2026-11-05 治本 (Admin Dashboard 调试会话持久化 · 会话标题自动生成):
//   职责: 给跑了 N 轮的调试会话起一个**短标题** ("悲伤回避型来访者 - 初始访谈"),
//         让会话列表里一眼能认出这场会话.
//   边界: 只做「对话片段 → 标题」; 落盘与覆盖规则在 `debug-session-store.ts`.
//
//   为什么走**既有 LLM 路由** (`LlmRouterService`) 而不是新造客户端:
//     仓库的硬约束: 结构化输出只有一条链, 通用 LLM 调用走 `LlmRouterService`.
//     这里要的是**纯文本** (不是 JSON), 所以连结构化客户端都不用 — 直接 `router.chat`.
//     与 WP37 的滚动摘要生成器 (`LlmRollingSummaryGenerator`) 同一套接法.
//
//   为什么**复用 `MEMORY_SUMMARY_MODEL` 这个 env** (不新增 `DEBUG_TITLE_MODEL`):
//     "给一段对话起标题" 与 "把一段对话压成纪要" 是**同一族任务** —— 都是
//     "从长文本里抽要点". 仓库既有的纪律是: 同一族任务用**同一个键**
//     (见 `engine.module.ts` 里"摘要模型名与 WP12 的最终摘要同一个键"的注释).
//     再开一个键 = 两张会漂的模型表.
//
//   ⚠️ **心理内容边界**:
//     标题生成要把**对话原文**发给模型. 这是内部调试工具的既定用途 (面板本来
//     就把 prompt 全文显示出来), 但它意味着: 对话内容会**离开本进程**,
//     发到配置的 LLM 厂商. 因此:
//     · 只发**前 3 轮** (够看出这场在聊什么), 不发整场;
//     · 生成的标题里**不许**出现临床诊断 / 身份信息;
//     · 失败就兜底, 不重试到把额度烧光.
//
//   验证: npx vitest run test/admin-debug/debug-session-persistence.spec.ts
//   时间戳: 2026-11-05 GMT+8

import { LLMTier } from '../llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest } from '../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../llm/registry/llm-router.service.js';

/**
 * 标题生成的输入轮次 (一侧发言).
 */
export interface DebugSessionTitleTurn {
  /** 咨询师 (学员) 这一轮说的话. */
  readonly counselorText: string;
  /** 来访者 (AI 扮演) 这一轮的回应. */
  readonly visitorText: string;
}

/**
 * 标题生成入参.
 */
export interface DebugSessionTitleInput {
  /** 角色展示名 (如 "晚晴"). */
  readonly characterLabel: string;
  /** 前几轮的对话 (咨询师 + 来访者, 按轮次). */
  readonly turns: readonly DebugSessionTitleTurn[];
}

/**
 * 会话标题生成端口 (窄面).
 *
 * 为什么要窄面: 本文件不该知道"标题怎么生成"(LLM / 规则 / 人工),
 * 只该知道"给我一个标题". 单测用 stub, 换生成方式不用动服务编排.
 */
export interface DebugSessionTitleGenerator {
  /**
   * 生成标题.
   *
   * @param input 角色 + 前几轮对话
   * @returns 标题; 生成不出来应**抛错** (由调用方降级成兜底标题)
   */
  generate(input: DebugSessionTitleInput): Promise<string>;
}

/**
 * 标题生成端口的 DI token.
 *
 * 为什么用 **symbol**: 端口是 interface, 编译后**没有运行时值** ——
 * 拿它当 provider token 会在启动期炸 ("Cannot read properties of undefined").
 * 仓库既有的同款做法见 `engine.tokens.ts` (引擎端口一律用 symbol).
 */
export const DEBUG_SESSION_TITLE_GENERATOR = Symbol('DEBUG_SESSION_TITLE_GENERATOR');

/**
 * 标题生成器的构造入参.
 */
export interface LlmDebugSessionTitleGeneratorOptions {
  /** LLM 路由 (走既有 chat 出口, 不新造客户端). */
  readonly router: LlmRouterService;
  /** 模型名 (厂商相关, 由装配层解析后传入). */
  readonly model: string;
  /** 单次完成 token 上限 (缺省 = 种子值). */
  readonly maxCompletionTokens?: number;
}

/**
 * 标题的 token 上限种子值.
 *
 * 40 token 足够写一个 20 字的中文标题 —— 上限**故意压得小**:
 * 标题生成是"锦上添花", 不该因为它一次吃掉几百 token.
 */
export const DEFAULT_DEBUG_SESSION_TITLE_MAX_COMPLETION_TOKENS = 256;

/**
 * 标题的**字数**上限 (硬口径, 超出就截断).
 *
 * 为什么截断而不是让模型自己保证: 模型不保证. 一个 60 字的标题会把会话列表
 * 的布局撑坏, 而截断是**确定的**行为.
 */
export const MAX_DEBUG_SESSION_TITLE_LENGTH = 24;

/**
 * 兜底标题的前缀 (LLM 生成失败 / 还没到生成阈值时用).
 *
 * ⚠️ 兜底标题**在建会话时就写上** (来源标 `fallback`) —— 列表里永远有一行能看,
 *   而不是空白. LLM 成功后再覆盖 (来源变 `llm`); 用户手动改过就不再被覆盖 (来源 `manual`).
 */
export const DEBUG_SESSION_FALLBACK_TITLE_PREFIX = '未命名会话';

/**
 * 兜底标题里的时刻格式化器 (Asia/Shanghai).
 *
 * 为什么固定 UTC+8: 与仓库其余按天分桶的口径一致 (见 `cost-view.ts`) ——
 * 同一个"今天"在看板和调试列表里必须是同一天.
 */
const SHANGHAI_MINUTE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * 兜底标题 ("未命名会话 - 2026-11-05 20:00").
 *
 * @param createdAt 创建时刻 (ISO)
 * @returns 兜底标题
 */
export function buildFallbackTitle(createdAt: string): string {
  return `${DEBUG_SESSION_FALLBACK_TITLE_PREFIX} - ${formatShanghaiMinute(createdAt)}`;
}

/**
 * 时刻 → 上海时区的 "YYYY-MM-DD HH:mm".
 *
 * @param iso ISO 时刻
 * @returns 格式化结果 (解析失败 → 原样返回)
 */
export function formatShanghaiMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = SHANGHAI_MINUTE_FORMATTER.formatToParts(date);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/**
 * 标题生成提示词 (系统段).
 *
 * 四条硬约束:
 *   1. 只写**已经出现过的**内容 —— 不编造对话里没有的经历 / 诊断 / 承诺;
 *   2. 长度 ≤ 20 字 —— 列表要一行放得下;
 *   3. 不做临床诊断、不给建议 —— 这是**标签**, 不是评估;
 *   4. 只输出标题本身 —— 不加引号、不加解释、不加"标题:"前缀.
 */
const TITLE_SYSTEM_PROMPT = [
  '你给心理咨询训练场景的调试会话起标题。',
  '',
  '要求：',
  '1. 只根据下面已经出现的对话内容起标题，不编造对话里没有的经历、感受或诊断。',
  '2. 标题不超过 20 个字，尽量点出「来访者特征 + 话题/阶段」这两件事。',
  '3. 不要写具体话术，不要做临床判断或建议。',
  '4. 只输出标题本身，不要加引号、解释、标点结尾或任何前缀。',
].join('\n');

/**
 * LLM 会话标题生成器.
 */
export class LlmDebugSessionTitleGenerator implements DebugSessionTitleGenerator {
  private readonly router: LlmRouterService;
  private readonly model: string;
  private readonly maxCompletionTokens: number;

  constructor(options: LlmDebugSessionTitleGeneratorOptions) {
    this.router = options.router;
    this.model = options.model;
    this.maxCompletionTokens = options.maxCompletionTokens ?? DEFAULT_DEBUG_SESSION_TITLE_MAX_COMPLETION_TOKENS;
  }

  /**
   * 生成标题.
   *
   * @param input 角色 + 前几轮对话
   * @returns 标题 (已剥围栏 / 截断)
   * @throws LLM 调用失败时抛错 (由调用方降级)
   */
  async generate(input: DebugSessionTitleInput): Promise<string> {
    const request: ChatCompletionRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: formatTitleInput(input) },
      ],
      temperature: 0.2,
      maxCompletionTokens: this.maxCompletionTokens,
      stream: false,
    };

    const response = await this.router.chat(request);
    return parseDebugSessionTitle(response.content);
  }
}

/**
 * 解析调试会话标题用的模型名 (与摘要同一口径).
 *
 * env 优先, 否则问 router 的 tier→model 映射 (RAG 层: 抽要点正是这一层的活).
 *
 * @param explicit env 配置的模型名 (缺省 / 空白 = 走 router 默认)
 * @param router LLM 路由
 * @returns 模型名
 */
export function resolveDebugSessionTitleModel(explicit: string | undefined, router: LlmRouterService): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed.length > 0) return trimmed;
  return router.getDefaultModelForTier(LLMTier.RAG);
}

/**
 * 标题生成入参 → 提示词正文.
 *
 * 为什么每轮**两行**并标角色: 模型看到"问"紧跟"答"才知道那句话在回应什么;
 * 标角色 ("咨询师" / "来访者") 还能防止模型把学员的话当成来访者的自述.
 *
 * @param input 角色 + 前几轮对话
 * @returns 提示词正文
 */
export function formatTitleInput(input: DebugSessionTitleInput): string {
  const label = input.characterLabel.trim();
  const header = label.length > 0 ? [`来访者角色：${label}`, '', '对话记录：'] : ['对话记录：'];
  const dialogue: string[] = [];
  for (const turn of input.turns) {
    dialogue.push(`咨询师：${turn.counselorText.trim()}`, `来访者：${turn.visitorText.trim()}`);
  }
  return [...header, ...dialogue].join('\n');
}

/**
 * 可能出现在标题首尾的引号 / 括号字符.
 */
const LEADING_QUOTE_CHARS = '\'"「『【《';
const TRAILING_QUOTE_CHARS = '\'"」』】》';

/**
 * 剥掉标题首尾的引号 / 括号.
 *
 * ⚠️ 为什么**不用正则** (`/["'」』】》]+$/`): 那个写法在末尾字符**不匹配**时
 *   会把 `+` 的每个切分点都试一遍 —— 指数级回溯的形状 (sonarjs 的
 *   "super-linear regex" 红线). 逐字符剥是**线性**的, 行为还更确定.
 *
 * @param text 原始文本
 * @returns 剥掉首尾引号后的文本
 */
function stripWrappingQuotes(text: string): string {
  let start = 0;
  while (start < text.length && LEADING_QUOTE_CHARS.includes(text[start] ?? '')) start += 1;
  let end = text.length;
  while (end > start && TRAILING_QUOTE_CHARS.includes(text[end - 1] ?? '')) end -= 1;
  return text.slice(start, end);
}

/**
 * 解析模型输出 → 标题.
 *
 * 容错顺序:
 *   1. 剥空白 / 引号 / 常见前缀 ("标题:" / "标题：");
 *   2. 去掉换行 (模型偶尔把标题和解释分两行输出);
 *   3. 截断到 24 字;
 *   4. 全空 → 返空串 (**不编一个** —— 兜底由调用方用固定文案补).
 *
 * @param raw 模型原始输出
 * @returns 标题 (可能为空串)
 */
export function parseDebugSessionTitle(raw: string): string {
  let text = raw.trim();
  // 剥代码块围栏 (模型偶尔包一层 ```).
  text = text
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/```$/, '')
    .trim();
  // 剥常见前缀.
  text = text.replace(/^(标题|题目|title)\s*[:：]\s*/i, '').trim();
  // 只取第一行 (模型偶尔把标题和解释分两行).
  text = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  // 剥首尾引号 (中文/英文引号都算).
  text = stripWrappingQuotes(text).trim();
  if (text.length > MAX_DEBUG_SESSION_TITLE_LENGTH) {
    text = text.slice(0, MAX_DEBUG_SESSION_TITLE_LENGTH);
  }
  return text;
}
