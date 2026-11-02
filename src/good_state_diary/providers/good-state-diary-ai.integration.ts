import { Injectable } from '@nestjs/common';

import { DiaryAiFeedbackDto, RequestDiaryAiFeedbackDto } from '../dto/good-state-diary.dto';
import { DiaryAiFeedbackSource } from '../enums/diary-ai-feedback-source.enum';
import { DiaryMoodLevel } from '../enums/diary-mood-level.enum';

/**
 * V2026-09-11 治本 (好状态日记 · LLM 注入骨架):
 *   原因: P0 阶段 GoodStateDiaryAiService 用启发式 stub (buildHeuristicFeedback).
 *         V3 接真 LLM 时需要:
 *           1. 注入 LlmOrchestratorService (来自 ai-engine 模块)
 *           2. 调 structured output (output schema = DiaryAiFeedbackDto)
 *           3. input 仅 metadata, 不传 body/title (PRD §11.1 隐私底线)
 *   修复:
 *     - 定义 DiaryLlmClient 抽象接口 (本模块), 任何实现都可以塞
 *     - HeuristicDiaryLlmClient 默认实现, P0 阶段 GoodStateDiaryAiService 调它
 *     - V3 接真 LLM 时, 在 app.module 里 provide 一个 LlmOrchestratorDiaryClient,
 *       useFactory 根据环境变量 (DIARY_AI_PROVIDER=stub|llm) 切换
 *     - 调用方不变: GoodStateDiaryAiService.generateFeedback 签名不变, 注入
 *       DiaryLlmClient (DI token) 而非直接 @Optional() LlmOrchestratorService
 *   反双胞胎:
 *     - 不直接 @Inject LlmOrchestratorService (避免 good_state_diary ↔ ai-engine
 *       双向耦合); 走 DI token 接口, ai-engine 在自己的 module 里 provide 适配器
 *   如何验证: P0 走 HeuristicDiaryLlmClient (行为不变); V3 替换为 LlmOrchestrator
 *             实现后, 上层 controller / DTO 零改动, 单测/e2e 沿用.
 */

/**
 * LLM 客户端抽象接口 — good_state_diary 模块只依赖本接口, 不直接依赖任何具体 LLM SDK.
 *
 * 实现方:
 *   - HeuristicDiaryLlmClient (本文件, P0 stub 默认)
 *   - LlmOrchestratorDiaryClient (ai-engine 模块提供, V3 接入)
 *
 * V3 切换: 在 app.module 里用 useFactory 根据环境变量切换 provider:
 *   {
 *     provide: DIARY_LLM_CLIENT,
 *     useFactory: (env) => env.DIARY_AI_PROVIDER === 'llm' ? new LlmOrchestratorDiaryClient(...) : new HeuristicDiaryLlmClient(),
 *     inject: [...],
 *   }
 */
export const DIARY_LLM_CLIENT = Symbol('DIARY_LLM_CLIENT');

export interface DiaryLlmClient {
  /**
   * 根据 metadata-only 入参生成 AI 反馈.
   *
   * 严格边界 (同 GoodStateDiaryAiService.generateFeedback):
   *   - 入参仅 themes / moodHint / localSummary / tags / entryId (无 body)
   *   - 出参严格 DiaryAiFeedbackDto 结构 (summary / perspectiveQuestions / observedThemes / crisisFlag)
   *   - 任何字段越界 (诊断 / 建议 / 评判) 都不允许, LLM 输出层 + OutputComplianceFilter 双校验
   */
  generateFeedback(request: RequestDiaryAiFeedbackDto): Promise<DiaryAiFeedbackDto>;
}

// ════════════════════════════════════════════════════════════════
// Heuristic 实现 — P0 stub, 行为跟原 GoodStateDiaryAiService.buildHeuristicFeedback 一致
// ════════════════════════════════════════════════════════════════

@Injectable()
export class HeuristicDiaryLlmClient implements DiaryLlmClient {
  async generateFeedback(request: RequestDiaryAiFeedbackDto): Promise<DiaryAiFeedbackDto> {
    const moodHint: DiaryMoodLevel | null = request.moodHint ?? null;
    const themes = request.themes.filter((t) => t.length > 0);
    const tags = request.tags.filter((t) => t.length > 0);

    return {
      summary: this.buildSummary(moodHint, themes, tags, request.localSummary),
      perspectiveQuestions: this.buildQuestions(moodHint),
      observedThemes: themes.length > 0 ? themes : tags,
      generatedAt: new Date().toISOString(),
      source: DiaryAiFeedbackSource.Cloud,
      // V2026-09-11 治本 (sonarjs/different-types-comparison):
      //   moodHint 是 DiaryMoodLevel 枚举 (字面量类型 'great'|'okay'|'low'|'crisis'),
      //   不能跟裸字符串 'crisis' 比较 — sonarjs 标记 always false.
      //   用枚举常量 DiaryMoodLevel.Crisis 让 TS 强类型 + lint 通过.
      crisisFlag: moodHint === DiaryMoodLevel.Crisis,
    };
  }

  private buildSummary(moodHint: DiaryMoodLevel | null, themes: string[], tags: string[], localSummary: string): string {
    const moodText = this.moodText(moodHint);
    // V2026-09-11 治本 (sonarjs/no-nested-conditional):
    //   嵌套三元拆成独立 helper + early return, 语义不变, 可读性 + 测试性更好.
    const topicText = this.pickTopicText(themes, tags);
    const baseText = topicText ? `${moodText}, 提到了${topicText}方面的内容` : `${moodText}`;
    const trimmed = localSummary.trim();
    if (trimmed.length > 0) {
      return `${baseText}. 端侧观察: ${trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed}`;
    }
    return `${baseText}.`;
  }

  private pickTopicText(themes: string[], tags: string[]): string {
    if (themes.length > 0) return themes.slice(0, 3).join('、');
    if (tags.length > 0) return tags.slice(0, 3).join('、');
    return '';
  }

  private buildQuestions(moodHint: DiaryMoodLevel | null): string[] {
    if (moodHint === DiaryMoodLevel.Crisis) {
      return ['此刻, 你最需要的一种支持是什么?', '如果身边有一个完全接纳你的人, 你会想说什么?', '过去类似的时候, 是什么让你撑过来的?'];
    }
    return ['写下这段话的时候, 身体感觉如何?', '如果给这一刻取一个名字, 会是什么?', '过段时间回看, 你想对今天的自己说点什么?'];
  }

  private moodText(moodHint: DiaryMoodLevel | null): string {
    switch (moodHint) {
      case DiaryMoodLevel.Great:
        return '今天的状态是很好';
      case DiaryMoodLevel.Okay:
        return '今天的状态是一般';
      case DiaryMoodLevel.Low:
        return '今天的状态是不太好';
      case DiaryMoodLevel.Crisis:
        return '今天的状态是很差';
      default:
        return '今天记录了一段思绪';
    }
  }
}

// ════════════════════════════════════════════════════════════════
// LLM Provider 工厂 — P0 默认 stub, V3 接真 LLM 时切换
// ════════════════════════════════════════════════════════════════

/**
 * V2026-09-11 治本 (DI 工厂):
 *   原因: P0 / V3 切换不要散在 if (env.DIARY_AI_PROVIDER === 'llm') 各处,
 *         集中在 good_state_diary.module 里 useFactory 注入.
 *   修复: 提供 makeDiaryLlmClientProvider() 返回 Provider 对象,
 *         useClass 默认为 HeuristicDiaryLlmClient, V3 接入时把 useClass 改成
 *         LlmOrchestratorDiaryClient (来自 ai-engine 模块, 跨模块 import).
 *   如何验证: P0 启动后日志看到 DIARY_AI_PROVIDER=stub (默认), V3 改环境变量
 *             后切换到 llm 路径, controller 调用链零改动.
 */
export function makeDiaryLlmClientProvider() {
  return {
    provide: DIARY_LLM_CLIENT,
    useClass: HeuristicDiaryLlmClient,
  };
}

// ════════════════════════════════════════════════════════════════
// V3 接入参考 (注释, 非可执行代码 — 草稿, 实际接入时按 ai-engine API 调整)
// ════════════════════════════════════════════════════════════════

/**
 * V3 接入参考 — 在 ai-engine 内提供 LlmOrchestratorDiaryClient:
 *
 * ```ts
 * // ai-engine/providers/llm-orchestrator-diary-client.ts
 * import { Injectable } from '@nestjs/common';
 * import { LlmOrchestratorService } from './llm-orchestrator.service';
 * import {
 *   DiaryLlmClient,
 *   RequestDiaryAiFeedbackDto,
 *   DiaryAiFeedbackDto,
 * } from '../../good_state_diary/providers/good-state-diary-ai.integration';
 *
 * @Injectable()
 * export class LlmOrchestratorDiaryClient implements DiaryLlmClient {
 *   constructor(private readonly llm: LlmOrchestratorService) {}
 *
 *   async generateFeedback(req: RequestDiaryAiFeedbackDto): Promise<DiaryAiFeedbackDto> {
 *     const schema = {
 *       type: 'object',
 *       properties: {
 *         summary: { type: 'string', maxLength: 500 },
 *         perspectiveQuestions: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
 *         observedThemes: { type: 'array', items: { type: 'string' } },
 *         crisisFlag: { type: 'boolean' },
 *       },
 *       required: ['summary', 'perspectiveQuestions', 'observedThemes', 'crisisFlag'],
 *     };
 *
 *     const result = await this.llm.chatOnceWithSchema({
 *       tier: 'cloud',
 *       systemPrompt: DIARY_AI_SYSTEM_PROMPT,
 *       userPrompt: JSON.stringify({
 *         themes: req.themes,
 *         moodHint: req.moodHint,
 *         localSummary: req.localSummary,
 *         tags: req.tags,
 *         // ⚠️ 永远不上传 entryId 之外的实体字段 (body / title / author_id)
 *       }),
 *       outputSchema: schema,
 *     });
 *
 *     return {
 *       summary: result.summary,
 *       perspectiveQuestions: result.perspectiveQuestions,
 *       observedThemes: result.observedThemes,
 *       generatedAt: new Date().toISOString(),
 *       source: 'cloud',
 *       crisisFlag: result.crisisFlag,
 *     };
 *   }
 * }
 * ```
 *
 * 然后在 app.module 里 useFactory 切换:
 * ```ts
 * {
 *   provide: DIARY_LLM_CLIENT,
 *   useFactory: (env) => env.DIARY_AI_PROVIDER === 'llm'
 *     ? new LlmOrchestratorDiaryClient(...)
 *     : new HeuristicDiaryLlmClient(),
 *   inject: [...],
 * }
 * ```
 *
 * 注意:
 *   - LlmOrchestratorDiaryClient 必须放在 ai-engine 模块的 providers 里,
 *     不能放在 good_state_diary (反向耦合)
 *   - V3 接入时 LlmOrchestratorService.chatOnceWithSchema 的真实签名需要确认,
 *     上面是推测, 实际以 ai-engine 当前 API 为准
 */

// ════════════════════════════════════════════════════════════════
// P0 system prompt 草案 (V3 接入 LLM 时用, 给前端/PM 评审)
// ════════════════════════════════════════════════════════════════

/**
 * V2026-09-11 LLM system prompt 草案 — V3 接入时跟产品 / 心理顾问 review 后定稿.
 *
 * 强约束 (PRD §11.3 AI 伦理专项规范):
 *   - 不诊断 / 不开处方 / 不给医疗建议
 *   - 不评判用户感受 / 不灌输价值观
 *   - 不用「你应该」「建议你」「你有问题」类评价词
 *   - 不预测未来 / 不强行积极
 *   - 危机信号 (crisis mood) 不上报原文, 仅触发 /crisis/alert 流程
 *
 * Draft (仅参考, 不进 production):
 *
 * ```
 * 你是「好状态日记」AI 助手, 一个中性的「觉察陪练」.
 *
 * 边界:
 *   - 你不是医生, 不诊断任何心理障碍
 *   - 你不是教练, 不给行动建议
 *   - 你只描述观察到的事实, 不做因果归因
 *
 * 输入 (用户已隐去身份, 仅元数据):
 *   - themes: 用户日记中提到的主题词
 *   - moodHint: 用户的情绪档位 (great/okay/low/crisis)
 *   - localSummary: 用户端侧生成的 1-2 句摘要
 *   - tags: 用户选择的日记标签
 *
 * 输出 (严格 JSON schema):
 *   - summary: 1-2 句中性观察, 主语用「这段日记」「今天」, 不用「你」做评价主语
 *   - perspectiveQuestions: 3 个开放问题, 「是什么」类优先, 禁用「你为什么不...」
 *   - observedThemes: 主题词列表, 不含评价词
 *   - crisisFlag: 当 moodHint=crisis 时必须 true
 * ```
 */
