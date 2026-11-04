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
//   为什么输入是**完整轮次** (咨询师一侧 + 来访者一侧, 绑成一个不可拆的单位):
//     WP37 时输入只有咨询师一侧 —— 内核的溢出回调只交出咨询师原话 (内核不渲染,
//     拿不到来访者的话). WP55 起, 门面的**轮次记录**补上了来访者那一半.
//     关键: 两侧必须**同一个数据结构**一起传, 不能拆成两个数组再按下标配对 ——
//     拆开就等于把"配对正确性"变成调用方的责任, 而实际会错配 (阻断/降级轮次
//     没有来访者发言, 下标就错位了). 详见交付记录 §2.2 的反例.
//
//   V2026-11-04 治本 (WP61 · 滚动纪要层次化):
//     纪要从"一段 ≤120 字的流水文字"改成**三层结构** (核心议题 / 关键事件 / 情绪转折点).
//     三个改动:
//       ① 返回类型 `string` → `RollingSummaryResult` (三段结构化对象);
//       ② 入参 `previousSummary` 同步改成结构化对象 —— 合并是**逐段合并**
//          (核心议题并进核心议题、关键事件并进关键事件), 不是把一坨文字塞进另一坨文字;
//       ③ 提示词改成要求三段 JSON 输出.
//     对外仍然只吐**一段字符串**: 结构化在服务层内部消化, 渲染成多行文本交给渲染层 ——
//     `RollingSummaryPort.latestSummary()` 签名一字未改 (渲染层与内核零改动).
//
//   退化口径 (模型偶尔不按 JSON 回):
//     三段 JSON 拿不到时 → 整段当**核心议题** (与 WP12 同款: 宁要一坨原文, 不要空白).
//     剥围栏与"整段当文本"复用 WP12 的解析 (session-summary.generator.ts) ——
//     那份只有一处, 这里**不**另写一个 JSON 解析器 (仓库既有纪律: 反双胞胎).
//
//   反双胞胎:
//     - 不自己写 JSON 解析 —— 复用 session-summary.generator.ts 的解析函数
//       (模型偶尔不按 JSON 回时的退化口径只有那一份).
//     - 不新造 LLM 客户端 —— 走既有 LlmRouterService (与 WP12 的摘要器同一条链).
//     - 不把 prompt 写进内核 —— 本文件在适配层, 内核零 prompt (boundary 断言④守着).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp37-rolling-session-summary.spec.ts 覆盖组装 / 退化 / 服务编排
//     3. test/engine-adapters/wp55-rolling-summary-both-sides.spec.ts 覆盖两侧输入与配对

import { parseJsonObject, parseSummaryResponse, readJsonString } from './session-summary.generator.js';
import { LLMTier } from '../../llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest } from '../../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../../llm/registry/llm-router.service.js';

/**
 * 一轮对话 (WP55 · 两侧纪要).
 *
 * 为什么两侧**绑在一个对象里** (而不是两个平行的字符串数组):
 *   配对必须**结构性正确** —— 摘要里"咨询师问了 X / 来访者答了 Y"必须是同一轮的事实.
 *   拆成两个数组后, 下标对齐就成了调用方的责任; 而现实中"某一轮没有来访者发言"
 *   (阻断轮次 / 渲染降级轮次) 会让下标错位, 摘要就会把 A 轮的问题和 B 轮的回答
 *   配成一对 —— 那是**凭空捏造因果**, 比丢上下文严重得多.
 *   绑成一个对象 = 配对正确性由类型系统保证, 调用方拆不了.
 */
export interface RollingSummaryRound {
  /** 本轮咨询师 (学员) 说的话. */
  readonly counselor: string;
  /**
   * 本轮来访者的回复.
   *
   * `null` = 这一轮来访者**没有发言** (阻断轮次 / 渲染降级轮次).
   * 用 `null` 而不是空串: "没说话"和"说了空话"是两回事, 空串会被当成一句发言.
   */
  readonly visitor: string | null;
}

/**
 * 滚动纪要 (WP61 · 三层结构).
 *
 * 为什么是**结构化对象**而不是一段字符串:
 *   一坨文字里模型要自己提炼重点, 后台也没法分组展示. 三段各有各的职责 ——
 *   核心议题 (来访者最关心什么) / 关键事件 (发生了什么) / 情绪转折点 (关系怎么变的).
 *
 * 为什么三段都是**必填** (而不是 `?`):
 *   "这一段没有内容"是**事实**, 用空串表达; 用 `undefined` 会让每个消费方都要写
 *   "到底是没有还是没给" —— 而这两种情况在这里**没有区别**.
 */
export interface RollingSummaryResult {
  /** 核心议题 (来访者最关心的 1-2 个话题). */
  readonly coreTopics: string;
  /** 关键事件 (对话中发生的 1-2 个重要事件). */
  readonly keyEvents: string;
  /** 情绪转折点 (情绪或关系发生明显变化的节点). */
  readonly emotionalTurningPoints: string;
}

/**
 * 空纪要 (三段都空).
 *
 * 共享同一个常量: 空纪要**没有内容可丢**, 造新对象只是多一次分配.
 */
const EMPTY_ROLLING_SUMMARY: RollingSummaryResult = {
  coreTopics: '',
  keyEvents: '',
  emotionalTurningPoints: '',
};

/**
 * 纪要是否为空 (三段都没内容).
 *
 * 为什么单独一个函数: "空"的判定口径只有**一处** —— 生成器用它判断"模型没给东西",
 * 服务层用它判断"这一批留待下次". 两处各写一遍 = 两个口径迟早对不上.
 *
 * @param summary 纪要
 * @returns 三段都空 → true
 */
export function isEmptyRollingSummary(summary: RollingSummaryResult): boolean {
  return (
    summary.coreTopics.trim().length === 0 && summary.keyEvents.trim().length === 0 && summary.emotionalTurningPoints.trim().length === 0
  );
}

/**
 * 滚动摘要生成入参.
 */
export interface RollingSummaryInput {
  /**
   * 上一版滚动纪要 (首次生成时缺省).
   *
   * 为什么是**结构化对象**而不是字符串 (WP61):
   *   滚动摘要的动作是"把新内容并进上一版", 而三段结构的合并是**逐段合并**
   *   (核心议题并进核心议题、关键事件并进关键事件...). 上一版若是一坨文字,
   *   模型就无从"逐段并" —— 只能把两坨文字搅在一起, 合并质量断崖式下降.
   */
  readonly previousSummary?: RollingSummaryResult;
  /** 本批新增的对话轮次 (按时间正序). */
  readonly rounds: readonly RollingSummaryRound[];
}

/**
 * 滚动摘要生成端口 (窄面).
 *
 * 为什么要窄面: 本文件不该知道"摘要怎么生成"(LLM / 规则 / 人工),
 * 只该知道"给我一段摘要". 单测用 stub, 换生成方式不用动服务编排.
 */
export interface RollingSummaryGenerator {
  /**
   * 生成滚动纪要.
   *
   * @param input 上一版纪要 + 本批新增发言
   * @returns 三段纪要; 生成不出来应**抛错** (由调用方降级)
   */
  generate(input: RollingSummaryInput): Promise<RollingSummaryResult>;
}

/**
 * 滚动纪要提示词 (系统段).
 *
 * 三条硬约束:
 *   1. 只写**已经出现过的**内容 —— 不编造对话里没有的经历、感受或承诺
 *      (WP37 时输入只有咨询师一侧, 模型很容易顺着咨询师的话脑补出来访者
 *      "其实很焦虑"这种没依据的结论; WP55 起两侧都在输入里, 这条约束从
 *      "别替来访者编造"收紧为"别编造对话之外的东西");
 *   2. 覆盖全部已聊内容 —— 给了上一版纪要时, 输出必须是**并入新内容后的完整版**;
 *   3. 长度上限 —— 纪要塞进 prompt, 长度失控 = 每轮 prompt 都被撑大.
 *
 * WP61 (层次化): 新增两段式输出与**逐段合并**的要求, 并保留 WP37 的
 * "不要写具体话术，不要做临床诊断" —— 那条护栏**不能**因为改成三段就丢掉.
 */
const ROLLING_SUMMARY_SYSTEM_PROMPT = [
  '你是一名咨询训练场景的会话纪要助手。下面给你的是一段**咨询师与来访者的对话记录**（问答交替）。',
  '请把它压缩成一份结构化的滚动纪要，供来访者角色在后续对话里保持话题连续。',
  '',
  '要求：',
  '1. 只写已经出现过的内容：谈到的议题、情绪线索、关系进展。不要编造对话里没有提到的经历、感受或承诺。',
  '2. 如果给了上一版纪要，输出必须是把新内容**逐段并进去**之后的**完整版**纪要，不要只写新增部分。',
  '3. 分三段输出，每段不超过 60 字，总长度不超过 180 字：',
  '   - 核心议题：来访者最关心的 1-2 个核心话题',
  '   - 关键事件：对话中发生的 1-2 个重要事件',
  '   - 情绪转折点：情绪或关系发生明显变化的节点',
  '4. 不要写具体话术，不要做临床诊断。',
  '5. 某一段确实没有内容时给空字符串，不要编内容填满它。',
  '',
  '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：',
  '{"coreTopics": "…", "keyEvents": "…", "emotionalTurningPoints": "…"}',
].join('\n');

/**
 * 滚动摘要 token 上限种子值.
 *
 * 120 字中文 ≈ 180 token, 留出余量取 400 —— 够写摘要, 又不会让"每 3 轮一次"的
 * 摘要调用吃掉太多额度 (滚动摘要是**高频**调用, 不是收尾路径上的一次性调用).
 *
 * WP61: 三段共 ≤180 字 ≈ 270 token, 加 JSON 键名与围栏仍在 400 以内 ——
 * 上限**不用改** (改了就是让摘要调用多吃额度, 而它本来就够用).
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
   * 生成滚动纪要.
   *
   * @param input 上一版纪要 + 本批新增发言
   * @returns 三段纪要 (模型不按 JSON 回时退化为"整段当核心议题", 与 WP12 同款口径)
   * @throws LLM 调用失败时抛错 (由服务降级为"本批不摘要")
   */
  async generate(input: RollingSummaryInput): Promise<RollingSummaryResult> {
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
    return parseRollingSummaryResponse(response.content);
  }
}

/**
 * 滚动摘要生成器构造入参 → 提示词正文.
 *
 * 为什么每轮**两行** (咨询师 / 来访者):
 *   问答交替的形状本身就是信息 —— 模型看到"问"紧跟"答", 才知道那句话是在回应什么.
 *   标角色也是 WP37 就有的必要防线 (不标的话模型会把咨询师的话当成来访者的自述);
 *   WP55 起两边都在, 标角色从"防误认"变成"还原对话".
 *
 * 为什么来访者没发言时写「（本轮来访者无回复）」而不是留空:
 *   留空 = 模型看到一段没有回答的提问, 很可能**脑补**一个回答 (然后写进摘要).
 *   显式写明"没回复" = 事实, 模型不会替它编.
 *
 * WP61: 上一版纪要用**同一份三段渲染**给模型看 —— 模型要"逐段并", 就得先看到
 * **逐段**的上一版 (给它一坨文字, 它无从逐段并).
 */
export function formatRollingSummaryInput(input: RollingSummaryInput): string {
  const parts: string[] = [];
  if (input.previousSummary && !isEmptyRollingSummary(input.previousSummary)) {
    parts.push(`[上一版摘要]\n${formatRollingSummaryForPrompt(input.previousSummary)}`);
  }
  const dialogue = input.rounds
    .map((round) => {
      const counselor = round.counselor.trim();
      const visitor = round.visitor !== null && round.visitor.trim().length > 0 ? round.visitor.trim() : '（本轮来访者无回复）';
      return `咨询师: ${counselor}\n来访者: ${visitor}`;
    })
    .join('\n');
  parts.push(`[新增的对话记录]\n${dialogue}`);
  return parts.join('\n\n');
}

/**
 * 纪要 → 多行文本 (核心议题 / 关键事件 / 情绪转折点).
 *
 * 为什么放在**生成器**文件而不是服务文件:
 *   同一份渲染要用在两处 —— ① 提示词里的「上一版摘要」(生成器自己用);
 *   ② `RollingSummaryPort.latestSummary()` 对外吐的字符串 (服务层用).
 *   放服务文件会让服务 ↔ 生成器**循环依赖** (服务本来就要 import 生成器的类型).
 *   放在形状旁边 = 一处真相, 谁用都拿到同一个格式.
 *
 * 空段落渲染成「（无）」而不是留空:
 *   留空 = 模型看到"关键事件："后面什么都没有, 会当成"格式坏了";
 *   「（无）」是**事实** (这一段确实没有内容) —— 与同族提示词里的
 *   「（本轮来访者无回复）」同一套写法.
 *
 * @param summary 纪要
 * @returns 三行文本
 */
export function formatRollingSummaryForPrompt(summary: RollingSummaryResult): string {
  return [
    `核心议题：${summary.coreTopics.trim() || '（无）'}`,
    `关键事件：${summary.keyEvents.trim() || '（无）'}`,
    `情绪转折点：${summary.emotionalTurningPoints.trim() || '（无）'}`,
  ].join('\n');
}

/**
 * 解析模型输出 → 滚动纪要 (WP61).
 *
 * 容错顺序 (从严到宽):
 *   1. 剥围栏 + JSON.parse → 取三段 (缺的段按空处理);
 *   2. JSON 但三段全空 → 接住**旧单段格式** (`{"summary": ...}`) 的那一段;
 *      连旧格式也没有 → 当空纪要 (调用方按"摘要为空"处理: 本批留待下次);
 *   3. 不是 JSON → 整段当**核心议题** (模型偶尔不按 JSON 回时的退化口径,
 *      与 WP12 同款: 拿不到结构化三段, 但总比空白强).
 *
 * @param raw 模型原始输出
 * @returns 三段纪要 (三段都空 = 模型没给出可用内容)
 */
export function parseRollingSummaryResponse(raw: string): RollingSummaryResult {
  const text = raw.trim();
  if (text.length === 0) return EMPTY_ROLLING_SUMMARY;

  const parsed = parseJsonObject(text);
  if (parsed) {
    const coreTopics = readJsonString(parsed['coreTopics']);
    const keyEvents = readJsonString(parsed['keyEvents']);
    const emotionalTurningPoints = readJsonString(parsed['emotionalTurningPoints']);
    if (coreTopics.length > 0 || keyEvents.length > 0 || emotionalTurningPoints.length > 0) {
      return { coreTopics, keyEvents, emotionalTurningPoints };
    }
    // JSON 但三段全空: 只有模型回的是**旧单段格式**时才接得住.
    const legacy = readJsonString(parsed['summary']);
    return { coreTopics: legacy, keyEvents: '', emotionalTurningPoints: '' };
  }

  // 不是 JSON → 整段当核心议题 (剥围栏; 复用 WP12 那份的退化口径).
  const blob = parseSummaryResponse(text).content.trim();
  return { coreTopics: blob, keyEvents: '', emotionalTurningPoints: '' };
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
