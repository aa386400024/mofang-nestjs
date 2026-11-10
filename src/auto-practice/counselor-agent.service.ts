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
//   验证: test/auto-practice/counselor-agent.spec.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CounselorPromptBuilder } from './counselor/builder/counselor-prompt-builder.js';
import { CLOSE_TAG, CONTINUE_TAG } from './counselor/builder/prompt-sections/close-discipline.js';
import { sliceHistoryWindow } from './counselor/memory/history-window.js';
import { FallbackPolicy } from './counselor/policy/fallback-policy.js';
import { DEFAULT_GENERATION_POLICY } from './counselor/policy/generation-policy.js';
import type { CounselorMode } from './entities/counselor-mode.entity.js';
import { LLMTier } from '../llm/common/enums/llm.enums.js';
import type { ChatMessage } from '../llm/common/interfaces/chat-provider.interface.js';
import { LlmRouterService } from '../llm/registry/llm-router.service.js';

import type { CounselorGenerateOptions, CounselorHistoryTurn, CounselorReply } from './counselor/dto/counselor-types.js';

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
   */
  async generate(
    mode: CounselorMode,
    history: readonly CounselorHistoryTurn[],
    options?: CounselorGenerateOptions,
  ): Promise<CounselorReply> {
    const crisisMode = options?.crisisMode === true;
    const messages = this.buildMessages(mode, history, crisisMode);

    try {
      const response = await this.router.chat({
        model: this.model,
        messages,
        ...DEFAULT_GENERATION_POLICY,
      });

      const raw = response.content.trim();
      if (raw.length === 0) {
        return {
          text: this.fallbackPolicy.pick(),
          model: this.model,
          degraded: true,
          closeRequested: false,
        };
      }

      // 剔除状态标记: 标记只作控制信号, 绝不进对话文本.
      let closeRequested = raw.includes(CLOSE_TAG);

      // 防御: finishReason==='length' 时回复是被硬截断的, 不可能是完整收尾.
      if (response.finishReason === 'length') {
        closeRequested = false;
      }

      // 只记"选了什么 + 长度", 不记内容 (隐私红线).
      this.logger.debug(`[counselor_agent] close=${closeRequested} raw_len=${raw.length} finish=${response.finishReason}`);

      const text = raw.split(CLOSE_TAG).join('').split(CONTINUE_TAG).join('').trim();
      if (text.length === 0) {
        return {
          text: this.fallbackPolicy.pick(),
          model: this.model,
          degraded: true,
          closeRequested: false,
        };
      }

      return { text, model: this.model, degraded: false, closeRequested };
    } catch (error) {
      // 不打原文 (隐私红线): 只记错误类型.
      this.logger.warn(`[counselor_agent] LLM 生成失败, 走兜底 (${errorName(error)})`);
      return {
        text: this.fallbackPolicy.pick(),
        model: this.model,
        degraded: true,
        closeRequested: false,
      };
    }
  }

  /**
   * 拼 chat messages.
   *
   * 结构:
   *   system  = 模式 systemPrompt + 所有纪律块 (由 builder 组装)
   *   历史    = assistant(咨询师旧话) / user(来访旧话) 交替, 最近 N 轮
   *   首轮    = 额外加一条 user(OPENING_HINT) 让模型开口
   */
  private buildMessages(mode: CounselorMode, history: readonly CounselorHistoryTurn[], crisisMode: boolean): ChatMessage[] {
    const systemContent = this.promptBuilder.build(mode, crisisMode);
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
