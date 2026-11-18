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

import { CounselorPromptBuilder } from './counselor/builder/counselor-prompt-builder.js';
import { CLOSE_TAG, CONTINUE_TAG } from './counselor/builder/prompt-sections/close-discipline.js';
import { sliceHistoryWindow } from './counselor/memory/history-window.js';
import { FallbackPolicy } from './counselor/policy/fallback-policy.js';
import { RETRY_GENERATION_POLICY, resolveGenerationPolicy } from './counselor/policy/generation-policy.js';
import { judgeVisibleOutput } from './counselor/policy/visible-output.js';
import type { CounselorMode } from './entities/counselor-mode.entity.js';
import { resolveSessionProfile, type SessionProfile } from './session-profile.js';
import { LLMTier } from '../llm/common/enums/llm.enums.js';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from '../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../llm/registry/llm-router.service.js';

import type {
  CounselorGenerateOptions,
  CounselorGenerationPolicy,
  CounselorHistoryTurn,
  CounselorReply,
} from './counselor/dto/counselor-types.js';

// 向后兼容: 原来从这个文件直接 import 类型的地方不用改.
export type { CounselorHistoryTurn, CounselorReply, CounselorGenerateOptions };

/** 历史窗口: 最多喂给咨询师最近 N 轮. */
const HISTORY_WINDOW_TURNS = 10;

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
    options?: CounselorGenerateOptions,
  ): Promise<CounselorReply> {
    const crisisMode = options?.crisisMode === true;
    // AF-091: 会话档案决定 prompt 里要不要加"长会话收尾纪律"块.
    //   ⚠️ 缺省 = legacy → prompt 与 2026-11-18 之前**逐字一致**.
    const profile = resolveSessionProfile(options?.sessionProfile);
    const messages = this.buildMessages(mode, history, crisisMode, profile, options?.turnIndex);
    const policy = resolveGenerationPolicy(profile.name);

    const first = await this.callModel(messages, policy);
    if (!first) {
      // 上游异常 → 直接兜底 (不重试: provider 层已有自己的退避重试链).
      return this.fallbackReply();
    }

    const firstJudgement = judgeVisibleOutput(first.content, first.finishReason);
    if (!firstJudgement.empty && !firstJudgement.truncated) {
      return this.toReply(firstJudgement.visible, false);
    }

    // 可见输出为空 (只有推理块) 或被长度截断 → 用更高预算重试一次.
    //   ⚠️ 日志只记布尔与长度, 不记任何台词 (隐私红线 AGENTS.md §5.4).
    this.logger.warn(
      `[counselor_agent] 可见输出异常 → 提高预算重试 empty=${firstJudgement.empty} truncated=${firstJudgement.truncated} raw_len=${first.content.length}`,
    );

    const retry = await this.callModel(messages, RETRY_GENERATION_POLICY);
    if (!retry) {
      return this.fallbackReply();
    }
    const retryJudgement = judgeVisibleOutput(retry.content, retry.finishReason);
    if (retryJudgement.empty) {
      // 重试后仍然只有推理块 → 兜底 + 降级 (这一轮会被 runner 记成降级轮).
      this.logger.warn(`[counselor_agent] 重试后仍无可见输出 → 兜底 raw_len=${retry.content.length}`);
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
   */
  private buildMessages(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    crisisMode: boolean,
    profile: SessionProfile,
    turnIndex?: number,
  ): ChatMessage[] {
    const systemContent = this.promptBuilder.build(mode, crisisMode, profile, turnIndex);
    const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

    // 裁剪历史窗口.
    const windowed = sliceHistoryWindow(history, HISTORY_WINDOW_TURNS);

    if (windowed.length === 0) {
      // 首轮: 没有历史, 给一个开场提示.
      messages.push({ role: 'user', content: OPENING_HINT });
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
