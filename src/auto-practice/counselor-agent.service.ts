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
import { randomInt } from 'node:crypto';

import type { CounselorMode } from '../auto-practice/entities/counselor-mode.entity.js';
import { LLMTier } from '../llm/common/enums/llm.enums.js';
import type { ChatMessage } from '../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../llm/registry/llm-router.service.js';

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

/**
 * 生成咨询师台词的附加上下文 (WP-J).
 */
export interface CounselorGenerateOptions {
  /**
   * 是否处于危机后置练习窗.
   *
   * true 时追加"危机已披露 → 稳定化"阶段任务: 只做安全确认 / 稳定化 / 下一步,
   * 不推进新议题、不深挖细节. 由 runner 在检测到危机后逐轮传入.
   */
  readonly crisisMode?: boolean;
}

/** 历史窗口: 最多喂给咨询师最近 N 轮. */
const HISTORY_WINDOW_TURNS = 10;

/** 首轮用户提示 (让模型知道这是开场). */
const OPENING_HINT = '（咨询室场景，来访者刚坐下。请说你的开场第一句。）';

/**
 * LLM 失败时的兜底咨询师台词池 (中性过渡, 不让对话冷场).
 *
 * V2026-11-09 治本 (Phase2.5 WP-G · 改动 1):
 *   原来只有**一句** —— 396 场批量跑里这句出现 5018 次 (占咨询师消息 65.3%),
 *   "咨询师复读"直接爆表, 而且模型很容易把它当成安全牌一直复读.
 *   现在备 5 句中性过渡语, 每次失败取一句.
 *
 * 为什么"随机取"还不够:
 *   纯随机相邻两次仍然可能撞同一句 —— 那就等于没改. 所以取用时**主动避开上一句**
 *   (见 pickFallbackReply), 保证相邻两次兜底一定不同.
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const FALLBACK_REPLIES: readonly string[] = [
  '嗯，我在听。你可以接着说。',
  '我在这儿听着，你慢慢说。',
  '好，这部分我听到了。你想接着说哪儿都行。',
  '嗯……你慢慢讲，我不打断你。',
  '收到。你说，我听着。',
];

/** 收尾标记: 模型每轮必须在末尾选一个状态 ("结束" / "还要继续"). */
const CLOSE_TAG = '[[STATE:END]]';
const CONTINUE_TAG = '[[STATE:MORE]]';

/**
 * 危机应对协议 (V2026-11-09 治本 · Phase2.5 WP-G · 改动 5).
 *
 * 为什么要有:
 *   396 场里有 9 场触发了危机探测, 但咨询师的应对**因模式而异** —— 有的绕开话题,
 *   有的直接收尾, 有的把危机当普通焦虑处理. 危机应对是有临床共识的四步,
 *   不应该让"咨询师今天状态如何"来决定.
 *
 * 放在**收尾纪律之后** (指最终 prompt 里的位置):
 *   收尾纪律先定义 "[[STATE:END]] / [[STATE:MORE]]" 这套标记, 危机协议后引用
 *   [[STATE:MORE]] 才不会让模型看到"没定义过的标记".
 *
 * 为什么危机轮要显式说"输出 MORE":
 *   收尾纪律要求每轮表态, 但危机情境下**收尾是不对的** —— 危机还在处理中,
 *   这时候结束咨询等于把来访者一个人留在危机里. 显式钉死比让模型自己判断可靠.
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const CRISIS_PROTOCOL = [
  '',
  '## 危机应对',
  '如果来访者提到自伤、自杀念头、伤害他人的想法或严重的心理危机，你必须按标准危机干预流程回应：',
  '① 表达关心和重视 —— 让来访者感到你听到了、你在意他的安全，而不是在处理一件普通的事；',
  '② 评估安全性 —— 直接、平静地询问他此刻有没有伤害自己的打算、有没有具体计划、身边有没有人；',
  '③ 建议寻求专业帮助 —— 明确建议联系心理援助热线、寻求专业医疗帮助，或请可信赖的人陪着他；',
  '④ 不要轻视或回避 —— 不评判、不说"想开点""别想太多"，也不因为对方提到危机就草草结束这次咨询。',
  '出现危机时，这一轮输出 ' + CONTINUE_TAG + '（不要收尾）—— 你还要继续跟来访者在一起。',
].join('\n');

/**
 * 危机后置练习窗的**阶段任务** (WP-J 改动 B).
 *
 * 为什么不能复用 CRISIS_PROTOCOL:
 *   ① 那段说的是"怎么回应一次危机", 没有说"危机之后这几轮练什么";
 *   ② 后置窗里的任务与常规轮**不一样** —— 这一阶段不推进新议题、不做解释性诠释,
 *      只做安全确认 / 稳定化 / 下一步. 不写清楚, 咨询师会顺着剧情继续深挖,
 *      把训练目标从"危机应对"带成"创伤暴露"(那是另一个训练模块的事).
 *
 * 只约束"做什么", **不注入任何剧情内容** —— 剧情归引擎, 咨询师只负责动作标准.
 *
 * ⚠️ 文案是**工程种子值, 非临床标定** —— 待真实对练校准.
 */
const CRISIS_STABILIZATION = [
  '',
  '## 当前阶段：危机已披露，进入稳定化',
  '来访者刚才表达了危机。接下来的几轮，你的任务只有三件，按顺序推进：',
  '① 安全确认 —— 直接、平静地确认他此刻是否安全：有没有实施伤害自己的打算、有没有具体计划、身边有没有人可以陪着；',
  '② 稳定化 —— 帮他回到当下：呼吸、身边能摸到看到的具体物件、此刻能联系上的人；',
  '③ 下一步 —— 明确今天/今晚的行动安排与求助渠道：可信任的人、心理援助热线、必要时就医。',
  '这一阶段**不**推进新议题、**不**深挖创伤细节、**不**做解释性诠释；没有完成安全确认之前不要收尾。',
  `每一轮仍然按上面的收尾纪律标注状态，但这一阶段通常应输出 ${CONTINUE_TAG}。`,
].join('\n');

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
  /** 上一句兜底台词的下标 (避免相邻两次兜底撞同一句). */
  private lastFallbackIndex = -1;

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
   * @param options 附加上下文 (危机后置练习窗)
   * @returns 咨询师台词
   */
  async generate(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    options?: CounselorGenerateOptions,
  ): Promise<CounselorReply> {
    const messages = this.buildMessages(mode, history, options?.crisisMode === true);
    try {
      const response = await this.router.chat({
        model: this.model,
        messages,
        temperature: 0.7,
        // 500 而不是 300: 收尾标记在回复最后一行, 上限太小时长回复会被截断, 标记被一起截掉,
        // 上层永远拿不到"该结束了"的信号 (实测 30 轮一场就是这笔账).
        maxCompletionTokens: 500,
        // V2026-11-09 P2-2 根因修复: 不传 reasoningEffort 时 MiniMax M3.1-Flash 默认 max 思考档,
        // 思考 token 计入生成长度上限, 500 token 预算被思考吃光 → 正文被硬截断
        // (28 场里 5 条 preachy 全断在 [[STATE:M). 显式 low: 思考 token 94→39 (2026-10-29 实测),
        // 首字更快, 成本更低, 正文预算不再被思考挤掉.
        reasoningEffort: 'low',
      });
      const raw = response.content.trim();
      if (raw.length === 0) {
        return { text: this.pickFallbackReply(), model: this.model, degraded: true, closeRequested: false };
      }
      // 剔除状态标记: 标记只作控制信号, 绝不进对话文本.
      let closeRequested = raw.includes(CLOSE_TAG);
      // V2026-11-09 P2-2 防御: finishReason==='length' 时回复是被硬截断的, 不可能是完整收尾;
      // 即使模型碰巧吐了 [[STATE:END]] 也不能信 (它没说完). 按"继续"处理, 避免截断轮误判 natural_close.
      if (response.finishReason === 'length') {
        closeRequested = false;
      }
      // 只记"选了什么 + 长度", 不记内容 (隐私红线); 标记丢了能一眼看出是没输出还是被截断.
      this.logger.debug(`[counselor_agent] close=${closeRequested} raw_len=${raw.length} finish=${response.finishReason}`);
      const text = raw.split(CLOSE_TAG).join('').split(CONTINUE_TAG).join('').trim();
      if (text.length === 0) {
        return { text: this.pickFallbackReply(), model: this.model, degraded: true, closeRequested: false };
      }
      return { text, model: this.model, degraded: false, closeRequested };
    } catch (error) {
      // 不打原文 (隐私红线): 只记错误类型.
      this.logger.warn(`[counselor_agent] LLM 生成失败, 走兜底 (${errorName(error)})`);
      return { text: this.pickFallbackReply(), model: this.model, degraded: true, closeRequested: false };
    }
  }

  /**
   * 取一句兜底台词.
   *
   * 为什么"随机 + 避开上一句":
   *   纯随机在相邻两次兜底时仍可能取到同一句 —— 那就等于没改 (复读照旧).
   *   避开上一句后, 相邻两次兜底**保证不同**, 于是"连续 N 次失败全是同一句"
   *   这种退化形态在结构上就不可能再出现.
   *
   * @returns 兜底台词
   */
  private pickFallbackReply(): string {
    const size = FALLBACK_REPLIES.length;
    // 用 node:crypto 的 randomInt 而不是 Math.random: 后者是非密码学安全的伪随机源
    // (sonarjs/pseudo-random), 与仓库既有口径一致 (practice-scenario / login-code 等).
    let index = randomInt(size);
    if (index === this.lastFallbackIndex) {
      index = (index + 1) % size;
    }
    this.lastFallbackIndex = index;
    return FALLBACK_REPLIES[index];
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
   * @param crisisMode 是否处于危机后置练习窗
   * @returns chat messages
   */
  private buildMessages(mode: CounselorMode, history: readonly CounselorHistoryTurn[], crisisMode: boolean): ChatMessage[] {
    const systemContent =
      `${mode.systemPrompt}\n\n输出纪律：你只输出咨询师本人说的话，不要写旁白、括号注释、动作描写、心理活动或任何解释；也不要使用 markdown 符号（**、#、>、- 列表等），这是当面说话，不是写文档。` +
      `${CLOSE_DISCIPLINE}${CRISIS_PROTOCOL}${crisisMode ? CRISIS_STABILIZATION : ''}`;
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
