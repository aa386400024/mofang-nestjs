// V2026-11-10 治本 (Phase2.5 P1f · 咨询师模块架构重构):
//   把原来硬编码在这个文件里的所有 prompt 构造 / 历史窗口 / 兜底逻辑,
//   抽到 counselor/ 子模块的各层 (builder / memory / policy).
//
//   这个文件现在只是一个**门面层 (Facade)**:
//     - 对外接口不变 (generate 方法签名不变, 构造函数参数不变)
//     - 内部委托到各层纯函数 / 策略类
//     - 以后微服务化时, 各层可以独立搬走
//
//   反双胞胎:
//     - 不走结构化输出 client: 咨询师要说的是一段自由口语, 不是 JSON.
//     - 不把引擎 trace 喂给咨询师: 咨询师只看到"来访者说了什么".
//     - 失败兜底不抛: LLM 挂了 → 回一句中性过渡语, 让这轮继续下去.
//
//   V2026-11-18 治本 (AF-102 · 可见输出):
//     · 生成预算按会话档案取 (long 档 2048, 不再共用 legacy 的 500);
//     · 可见输出为空 (只有推理块) 或被截断 → 提高预算重试一次, 仍失败才兜底并降级;
//     · 推理块不进台词 —— 它是模型内部思考, 不是"咨询师说的话".
//
//   验证: test/auto-practice/counselor-agent.spec.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CounselorPromptBuilder, type PromptBuildCue } from './counselor/builder/counselor-prompt-builder.js';
import { CLOSE_TAG, CONTINUE_TAG, type ClosingCue } from './counselor/builder/prompt-sections/close-discipline.js';
import type {
  CounselorGenerateOptions,
  CounselorGenerationPolicy,
  CounselorHistoryTurn,
  CounselorReply,
} from './counselor/dto/counselor-types.js';
import { sliceHistoryWindow } from './counselor/memory/history-window.js';
import { FallbackPolicy } from './counselor/policy/fallback-policy.js';
import { RETRY_GENERATION_POLICY, resolveGenerationPolicy } from './counselor/policy/generation-policy.js';
import { judgeVisibleOutput } from './counselor/policy/visible-output.js';
import type { CounselorMode } from './entities/counselor-mode.entity.js';
import { resolveSessionProfile, type SessionProfile } from './session-profile.js';
import { LLMTier } from '../llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from '../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../llm/registry/llm-router.service.js';
import { buildEncounterOpeningHint, type EncounterInput } from '../shared/encounter/encounter-scene.js';
import { inspectGeneratedOutput } from '../shared/text/output-integrity.js';

// 向后兼容: 原来从这个文件直接 import 类型的地方不用改.
export type { CounselorHistoryTurn, CounselorReply, CounselorGenerateOptions };
export type { ClosingCue };

/**
 * AF-133 · 生成上下文的扩展项.
 *
 * ⚠️ 为什么用扩展接口而不是直接改 `CounselorGenerateOptions` (dto/counselor-types.ts):
 *   AF-133 的任务单 scope 只放开了 counselor-agent.service.ts / prompt builder /
 *   prompt-sections / runner 四个源码面, DTO 文件不在 scope 内. 这里按
 *   "最小增量 + 不越 scope" 处理: 用扩展接口挂两个**可选**开关,
 *   老调用方 (只传 dto 里那三个字段) 的行为与 prompt 逐字不变.
 */
export interface CounselorGenerateContext extends CounselorGenerateOptions {
  /**
   * AF-133: 强制收束 cue.
   *
   * runner 在 maxTurns 之前最后 2 轮传 'forced' —— prompt 会明确告诉模型
   * "本场即将结束, 这两轮内完成收束三件套并输出 END" (AF-131 §2.2:
   * 8/16 场次被 max_turns 硬切, 而模型**无从知道**自己会被切).
   */
  readonly closingCue?: ClosingCue;
  /**
   * AF-133: 强制收束时从本轮起还剩几轮 (含本轮).
   *
   * 让 prompt 能说准数字 —— 显式 maxTurns 可以小于档案上限, 所以这个数只能
   * 由 runner 算, 不能由 prompt builder 从档案反推.
   */
  readonly remainingTurns?: number;
  /**
   * AF-133: 这一轮是不是**风险收束轮**.
   *
   * true 时 prompt 要求模型把风险收束五项 (移除危险物 / 求助渠道 / 可联系的人 /
   * 不要独处 / 安全承诺) 逐项落地, 而不是只做 grounding.
   */
  readonly crisisClosing?: boolean;
  /**
   * AF-137: 升级后第几个风险收束轮 (1 = 评估轮, 2 = 计划轮).
   * 仅升级路径传入; 普通危机窗用满的收束轮不传, prompt 行为保持原样.
   */
  readonly crisisClosingRound?: number;
  /**
   * AF-138: 修复轮要逐项补齐的缺失要素（中文标签）。
   * 仅当升级后计划轮仍缺安全要素时传入；普通风险收束轮不传。
   */
  readonly crisisMissing?: readonly string[];
  /**
   * AF-140: 常规收束三件套仍缺的要素（中文标签）。
   * 仅强制收束窗内、三件套不齐时传入；prompt 要求下一轮逐项补齐。
   */
  readonly closingMissing?: readonly string[];
  /**
   * AF-140: 本场最后一次收束（runner 在 maxTurns + 2 仍不齐时调用）。
   * prompt 只要求输出总结 / 带走 / 下一步三段，不再提问、不再开新议题。
   */
  readonly finalClosing?: boolean;
}

/** 历史窗口: 最多喂给咨询师最近 N 轮. */
const HISTORY_WINDOW_TURNS = 10;

/** 最终收束通道只喂最近 6 条消息（3 轮）摘要，避免模型把长历史当成继续对话。 */
const FINAL_CLOSING_WINDOW_MESSAGES = 6;

/** 首轮用户提示 (让模型知道这是开场). */
const OPENING_HINT = '（咨询室场景，来访者刚坐下。请说你的开场第一句。）';

/**
 * AI 咨询师 —— 按模式生成咨询师台词.
 *
 * 这是一个 Facade: 所有具体逻辑都委托到 counselor/ 子模块.
 * 对外接口保持不变, 内部实现已重构为企业级分层架构.
 */
@Injectable()
export class CounselorAgentService {
  private readonly logger = new Logger('CounselorAgentService');
  private readonly model: string;

  // 各层依赖 (在构造函数里实例化, 保持对外接口不变).
  private readonly promptBuilder = new CounselorPromptBuilder();
  private readonly fallbackPolicy = new FallbackPolicy();

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
   * V2026-11-18 治本 (AF-102 · 可见输出治本):
   *   ① **按档案取预算**: long 档用 2048 (推理 token 计入上限, 500 会被 thinking 吃光);
   *   ② **可见输出为空 / 被截断 → 提高预算重试一次** (至少 4096);
   *   ③ **重试后仍没有可见台词 → 才兜底并降级** (可被 runner 计数);
   *   ④ **截断但非空 → 不静默当正常回复**: 保留文本但标 degraded;
   *   ⑤ **推理块不进台词**: 只有 `<think>...</think>` 的输出等于"没说话",
   *      而且那些推理**不该**被当成咨询师的话喂给来访者.
   */
  async generate(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    options?: CounselorGenerateContext,
  ): Promise<CounselorReply> {
    const crisisMode = options?.crisisMode === true;
    // AF-091: 会话档案决定 prompt 里要不要加"长会话收尾纪律"块.
    //   ⚠️ 缺省 = legacy → prompt 与 2026-11-18 之前**逐字一致**.
    const profile = resolveSessionProfile(options?.sessionProfile);
    const messages =
      options?.finalClosing === true
        ? this.buildFinalClosingMessages(mode, history, profile, options)
        : this.buildMessages(mode, history, crisisMode, profile, options?.turnIndex, {
            closingCue: options?.closingCue,
            remainingTurns: options?.remainingTurns,
            crisisClosing: options?.crisisClosing === true,
            crisisClosingRound: options?.crisisClosingRound,
            crisisMissing: options?.crisisMissing,
            closingMissing: options?.closingMissing,
            finalClosing: false,
            encounter: options?.encounter,
          });
    const policy = resolveGenerationPolicy(profile.name);
    return this.generateWithMessages(messages, policy, options?.encounter);
  }

  /**
   * 最终收束的独立单轮通道。
   *
   * 为什么不复用 {@link generate}：最后 10 轮历史会被模型当成“继续聊”的上下文，
   * 即使 system 末尾有最高优先级的最终收束块，模型仍会接着提问（AF-140 实测
   * 13/16 场次在 maxTurns+1/+2 仍在探索）。这里只喂最近 6 轮的**摘要记录**，
   * 作为一次性指令，不构成连续对话，模型只能执行三段收束。
   *
   * @param mode 咨询模式
   * @param history 会话历史
   * @param options 生成上下文（finalClosing 强制为 true）
   * @returns 咨询师回复
   */
  async generateFinalClosing(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    options?: CounselorGenerateContext,
  ): Promise<CounselorReply> {
    return this.generate(mode, history, { ...options, finalClosing: true });
  }

  /**
   * 最终收束通道的 messages：system 走最高优先级收束块，user 只放最近 6 条
   * 消息摘要，明确声明“不要继续对话”，避免模型按连续会话续写。
   */
  private buildFinalClosingMessages(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    profile: SessionProfile,
    options?: CounselorGenerateContext,
  ): ChatMessage[] {
    const cue: PromptBuildCue = {
      closingCue: 'forced',
      remainingTurns: 1,
      crisisClosing: options?.crisisClosing === true,
      crisisClosingRound: options?.crisisClosingRound,
      crisisMissing: options?.crisisMissing,
      closingMissing: options?.closingMissing,
      finalClosing: true,
      encounter: options?.encounter,
    };
    const systemContent = this.promptBuilder.build(mode, false, profile, options?.turnIndex, cue);
    const windowed = history.slice(-FINAL_CLOSING_WINDOW_MESSAGES);
    const recap = windowed.length
      ? windowed.map((turn) => `${turn.role === 'counselor' ? '咨询师' : '来访者'}：${turn.text.trim().slice(0, 240)}`).join('\n')
      : '（本次会谈没有可用的最近记录）';
    return [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: [
          '以下是本次会谈最后几轮的记录，只用于写最终收束，不要继续对话，也不要提问：',
          recap,
          '',
          `请直接输出三段收束，并在最后一行输出 ${CLOSE_TAG}。`,
        ].join('\n'),
      },
    ];
  }

  /**
   * 对给定 messages 做一次生成 + 可见输出校验 + 一次预算重试。
   *
   * 抽出来是为了让普通轮与最终收束轮共用同一套空输出/截断处理，
   * 不在两条路径上各写一遍（AF-140 的收束失败有一半来自“只出推理块”）。
   */
  private async generateWithMessages(
    messages: ChatMessage[],
    policy: CounselorGenerationPolicy,
    encounter?: EncounterInput,
  ): Promise<CounselorReply> {
    const first = await this.callModel(messages, policy);
    if (!first) {
      // 上游异常 → 直接兜底 (不重试: provider 层已有自己的退避重试链).
      return this.fallbackReply();
    }

    const firstJudgement = judgeVisibleOutput(first.content, first.finishReason);
    const firstLeak = inspectGeneratedOutput(firstJudgement.visible, 'counselor', encounter);
    if (!firstJudgement.empty && !firstJudgement.truncated && !firstLeak.invalid) {
      return this.toReply(firstJudgement.visible, false);
    }

    // 可见输出为空 (只有推理块)、被长度截断或命中输出泄漏 → 用更高预算重试一次.
    //   ⚠️ 日志只记布尔与长度, 不记任何台词 (隐私红线 AGENTS.md §5.4).
    this.logger.warn(
      `[counselor_agent] 可见输出异常 → 提高预算重试 empty=${firstJudgement.empty} truncated=${firstJudgement.truncated} leak=${firstLeak.invalid} raw_len=${first.content.length}`,
    );

    const retry = await this.callModel(messages, RETRY_GENERATION_POLICY);
    if (!retry) {
      return this.fallbackReply();
    }
    const retryJudgement = judgeVisibleOutput(retry.content, retry.finishReason);
    const retryLeak = inspectGeneratedOutput(retryJudgement.visible, 'counselor', encounter);
    if (retryJudgement.empty || retryLeak.invalid) {
      // 重试后仍然只有推理块 / 仍然泄漏 → 兜底 + 降级 (这一轮会被 runner 记成降级轮).
      this.logger.warn(`[counselor_agent] 重试后仍无可用输出 → 兜底 raw_len=${retry.content.length} leak=${retryLeak.invalid}`);
      return this.fallbackReply();
    }
    // 截断但非空 → 保留文本, 但**标降级**: 不许静默当正常回复.
    return this.toReply(retryJudgement.visible, retryJudgement.truncated);
  }

  /**
   * 调一次模型 (异常统一吞掉, 交调用方兜底).
   *
   * @param messages chat 消息
   * @param policy 生成策略 (含预算与思考强度)
   * @returns 响应; 上游异常时返回 null
   */
  private async callModel(messages: ChatMessage[], policy: CounselorGenerationPolicy): Promise<ChatCompletionResponse | null> {
    const request: ChatCompletionRequest = {
      model: this.model,
      messages,
      ...policy,
    };
    try {
      return await this.router.chat(request);
    } catch (error) {
      // 不打原文 (隐私红线): 只记错误类型.
      this.logger.warn(`[counselor_agent] LLM 生成失败 (${errorName(error)})`);
      return null;
    }
  }

  /**
   * 把可见文本转成一条回复 (剥状态标记; 截断 → 标降级).
   *
   * @param visible 去掉推理块后的可见文本 (含状态标记)
   * @param truncated 是否被长度上限截断
   * @returns 回复
   */
  private toReply(visible: string, truncated: boolean): CounselorReply {
    // 剔除状态标记: 标记只作控制信号, 绝不进对话文本.
    let closeRequested = visible.includes(CLOSE_TAG);
    // 防御: finishReason==='length' 时回复是被硬截断的, 不可能是完整收尾.
    if (truncated) {
      closeRequested = false;
    }
    const text = visible.split(CLOSE_TAG).join('').split(CONTINUE_TAG).join('').trim();
    if (text.length === 0) {
      // 只有状态标记没有正文 → 等于没说话 → 兜底.
      return this.fallbackReply();
    }
    // 只记"选了什么 + 长度", 不记内容 (隐私红线).
    this.logger.debug(`[counselor_agent] close=${closeRequested} text_len=${text.length} truncated=${truncated}`);
    return { text, model: this.model, degraded: truncated, closeRequested };
  }

  /**
   * 兜底回复 (中性过渡语 + 降级标记).
   *
   * ⚠️ `degraded: true` 的含义是"这一轮**不是正常的咨询师输出**"
   *   (兜底句 / 被截断的残句) —— runner 据此把它计入降级轮数.
   */
  private fallbackReply(): CounselorReply {
    return {
      text: this.fallbackPolicy.pick(),
      model: this.model,
      degraded: true,
      closeRequested: false,
    };
  }

  /**
   * 拼 chat messages.
   *
   * 结构:
   *   system  = 模式 systemPrompt + 所有纪律块 (由 builder 组装)
   *   历史    = assistant(咨询师旧话) / user(来访旧话) 交替, 最近 N 轮
   *   首轮    = 额外加一条 user(OPENING_HINT) 让模型开口
   *
   * @param mode 咨询师模式
   * @param history 对话历史
   * @param crisisMode 是否处于危机后置练习窗
   * @param profile 会话档案 (AF-091: 决定要不要加长会话收尾纪律块)
   * @param turnIndex 当前轮次 (长会话纪律块会写进 prompt)
   * @param cue AF-133 动态开关 (强制收束 cue / 风险收束轮)
   */
  private buildMessages(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    crisisMode: boolean,
    profile: SessionProfile,
    turnIndex?: number,
    cue?: PromptBuildCue,
  ): ChatMessage[] {
    const systemContent = this.promptBuilder.build(mode, crisisMode, profile, turnIndex, cue);
    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

    // 裁剪历史窗口.
    const windowed = sliceHistoryWindow(history, HISTORY_WINDOW_TURNS);

    if (windowed.length === 0) {
      // 首轮: 没有历史, 给一个开场提示.
      // AF-187: 登记场景后按场景给提示；未登记保持旧文案（legacy 逐字不变）.
      messages.push({
        role: 'user',
        content: cue?.encounter === undefined ? OPENING_HINT : buildEncounterOpeningHint(cue.encounter),
      });
      return messages;
    }

    for (const turn of windowed) {
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
