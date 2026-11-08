// V2026-11-08 治本 (Phase2.5 WP-D · AI 咨询师生成):
//   职责: 把"人在调试面板里输入咨询师台词"换成"LLM 按 CounselorMode 自动生成咨询师台词".
//         它不知道引擎 / 不知道 BDI / 不知道来访者是谁 —— 只收"模式 + 对话历史",
//         吐出"咨询师这一轮该说什么".
//
//   为什么不直接在 runner 里拼 prompt:
//     ① 拼 prompt 的规则 (system 怎么写 / 历史怎么排 / 首轮怎么开场 / 失败兜底)
//       是一块独立的纯逻辑, 单测好覆盖;
//     ② runner 只管"循环 + 结束条件", 不掺"咨询师该说什么"的细节.
//
//   反双胞胎:
//     - **不走结构化输出 client**: 咨询师要说的是一段自由口语, 不是 JSON.
//       仓库硬约束"结构化输出只有一条链"只管 JSON, 纯文本走 router.chat.
//     - **不把引擎 trace 喂给咨询师**: 咨询师不需要知道 BDI / delta / 同盟分,
//       它只看到"来访者说了什么" (跟真实现场一样 —— 咨询师靠听来访说话工作,
//       不是靠看仪表盘).
//     - **失败兜底不抛**: LLM 挂了 (超时 / 429 / 空回复) → 回一句中性过渡语,
//       让这轮继续下去 (批量跑不能因为一次 LLM 抖动就整批崩).
//     - **历史窗口封顶**: 最近 10 轮喂给咨询师 (20 条消息), 再早的不喂 ——
//       长程记忆归引擎的记忆仓储, 咨询师靠"刚听到的话"工作.
//
//   验证: test/auto-practice/counselor-agent.spec.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LLMTier } from '../llm/common/enums/llm.enums.js';
import type { ChatMessage } from '../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../llm/registry/llm-router.service.js';
import type { CounselorMode } from '../auto-practice/entities/counselor-mode.entity.js';

/**
 * 一段对话历史 (一侧发言).
 */
export interface CounselorHistoryTurn {
  /** 谁说的. */
  readonly role: 'counselor' | 'visitor';
  /** 说的话. */
  readonly text: string;
}

/**
 * 咨询师生成的输出.
 */
export interface CounselorReply {
  /** 咨询师这一轮说的话. */
  readonly text: string;
  /** 本次 LLM 用的模型名 (落 PracticeSession.model_version). */
  readonly model: string;
  /** 是否走了兜底 (LLM 失败时). */
  readonly degraded: boolean;
  /** 咨询师是否判断"本次咨询可以自然收尾" (由模型输出 END 标记). */
  readonly closeRequested: boolean;
}

/** 历史窗口: 最多喂给咨询师最近 N 轮. */
const HISTORY_WINDOW_TURNS = 10;

/** 首轮用户提示 (让模型知道这是开场). */
const OPENING_HINT = '（咨询室场景，来访者刚坐下。请说你的开场第一句。）';

/** LLM 失败时的兜底咨询师台词 (中性过渡, 不让对话冷场). */
const FALLBACK_REPLY = '嗯，我在听。你可以接着说。';

/** 收尾标记: 模型每轮必须在末尾选一个状态 ("结束" / "还要继续"). */
const CLOSE_TAG = '[[STATE:END]]';
const CONTINUE_TAG = '[[STATE:MORE]]';

/**
 * 收尾纪律 (拼在 system 末尾).
 *
 * 现状问题: 结束条件只有 危机 / 来访复读 / 跑满轮数, 于是 maxTurns 一到就硬停,
 * 对话往往停在半句上, 不像真实咨询结束. 这里让"该不该收尾"由咨询师自己判断 ——
 * 和真人咨询师一样: 议题澄清、情绪被承接、给出方向之后主动收尾.
 *
 * 为什么用"强制二选一"而不是"可选标记": 实测可选标记几乎不会被输出 (模型默认认为
 * 对话还在继续), 强制每轮表态才会真的执行.
 */
const CLOSE_DISCIPLINE = [
  '',
  '## 收尾纪律',
  '每一轮回复的**最后一行**都必须只写一个状态标记（正文与标记之间空一行）：',
  `- ${CONTINUE_TAG} —— 议题还在展开，本轮结束后还要继续；`,
  `- ${CLOSE_TAG} —— 本轮你说的话就是这次咨询的收尾：已经做了总结、给了方向或约定了下一步，来访者的主要议题已经落地，再来一轮就是没必要的拖长。`,
  '判断标准偏向"该收就收"：真人在这种情况会说"今天先到这里"，而不是继续追问细节。',
  '标记只能出现在最后一行，正文里不要解释它、不要复述它。',
].join('\n');

/**
 * AI 咨询师 —— 按模式生成咨询师台词.
 */
@Injectable()
export class CounselorAgentService {
  private readonly logger = new Logger('CounselorAgentService');
  private readonly model: string;

  constructor(
    private readonly router: LlmRouterService,
    config: ConfigService,
  ) {
    // env 优先, 否则走 router 的 CORE 层默认模型 (咨询师在做临床工作, 用中档模型).
    const explicit = (config.get<string>('AUTO_PRACTICE_COUNSELOR_MODEL') ?? '').trim();
    this.model = explicit.length > 0 ? explicit : router.getDefaultModelForTier(LLMTier.ADVANCED);
  }

  /**
   * 生成咨询师这一轮的台词.
   *
   * @param mode 咨询师模式 (system prompt 来源)
   * @param history 到上一轮为止的对话 (counselor/visitor 交替; 首轮为空数组)
   * @returns 咨询师台词
   */
  async generate(mode: CounselorMode, history: readonly CounselorHistoryTurn[]): Promise<CounselorReply> {
    const messages = this.buildMessages(mode, history);
    try {
      const response = await this.router.chat({
        model: this.model,
        messages,
        temperature: 0.7,
        // 500 而不是 300: 收尾标记在回复最后一行, 上限太小时长回复会被截断, 标记被一起截掉,
        // 上层永远拿不到"该结束了"的信号 (实测 30 轮一场就是这笔账).
        maxCompletionTokens: 500,
      });
      const raw = response.content.trim();
      if (raw.length === 0) {
        return { text: FALLBACK_REPLY, model: this.model, degraded: true, closeRequested: false };
      }
      // 剔除状态标记: 标记只作控制信号, 绝不进对话文本.
      const closeRequested = raw.includes(CLOSE_TAG);
      // 只记"选了什么 + 长度", 不记内容 (隐私红线); 标记丢了能一眼看出是没输出还是被截断.
      this.logger.debug(`[counselor_agent] close=${closeRequested} raw_len=${raw.length}`);
      const text = raw.split(CLOSE_TAG).join('').split(CONTINUE_TAG).join('').trim();
      if (text.length === 0) {
        return { text: FALLBACK_REPLY, model: this.model, degraded: true, closeRequested: false };
      }
      return { text, model: this.model, degraded: false, closeRequested };
    } catch (error) {      // 不打原文 (隐私红线): 只记错误类型.
      this.logger.warn(`[counselor_agent] LLM 生成失败, 走兜底 (${errorName(error)})`);
      return { text: FALLBACK_REPLY, model: this.model, degraded: true, closeRequested: false };
    }
  }

  /**
   * 拼 chat messages.
   *
   * 结构:
   *   system  = 模式 systemPrompt + 输出纪律 (只说咨询师的话)
   *   历史    = assistant(咨询师旧话) / user(来访旧话) 交替, 最近 HISTORY_WINDOW_TURNS 轮
   *   首轮    = 额外加一条 user(OPENING_HINT) 让模型开口
   *
   * @param mode 咨询师模式
   * @param history 对话历史
   * @returns chat messages
   */
  private buildMessages(mode: CounselorMode, history: readonly CounselorHistoryTurn[]): ChatMessage[] {
    const systemContent = `${mode.systemPrompt}\n\n输出纪律：你只输出咨询师本人说的话，不要写旁白、括号注释、动作描写、心理活动或任何解释；也不要使用 markdown 符号（**、#、>、- 列表等），这是当面说话，不是写文档。${CLOSE_DISCIPLINE}`;
    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

    // 截断到最近 N 轮.
    const windowed = history.length > HISTORY_WINDOW_TURNS * 2 ? history.slice(-HISTORY_WINDOW_TURNS * 2) : history;

    if (windowed.length === 0) {
      // 首轮: 没有历史, 给一个开场提示.
      messages.push({ role: 'user', content: OPENING_HINT });
      return messages;
    }

    for (const turn of windowed) {
      // 咨询师说的话 = assistant (LLM 自己), 来访说的话 = user.
      messages.push({
        role: turn.role === 'counselor' ? 'assistant' : 'user',
        content: turn.text,
      });
    }
    return messages;
  }
}

/** 错误类型名 (不取 message —— 隐私红线). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
