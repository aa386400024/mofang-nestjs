import { Injectable } from '@nestjs/common';

import { GoodStateDiaryService } from './good-state-diary.service';
import { DiaryAiFeedbackDto } from '../dto/good-state-diary.dto';
import { RequestDiaryAiFeedbackDto } from '../dto/good-state-diary.dto';
import { DiaryAiFeedbackSource } from '../enums/diary-ai-feedback-source.enum';
import { DiaryMoodLevel } from '../enums/diary-mood-level.enum';

/**
 * V2026-09-11 治本 (好状态日记 · AI 反馈 service):
 *   原因: 心理产品对 AI 输出的合规要求极高 (PRD §11.3 AI 伦理专项规范):
 *     - 不诊断、不开处方、不给医疗建议
 *     - 不评判用户感受, 不灌输价值观
 *     - 所有回复标注「AI 生成, 仅供参考」 — 客户端在 UI 层展示
 *   DiaryAiFeedbackDto 字段已锁死契约 (summary / perspectiveQuestions / observedThemes),
 *   不存在「advice / diagnosis / you_should」等评价字段. 任何 AI 输出层违此契约
 *   PR review 必拒.
 *
 *   修复 (P0 阶段):
 *     - 启发式 stub, 严格基于 themes / moodHint / tags / localSummary 生成输出
 *     - crisisFlag: 当 moodHint === crisis 时强制 true, 触发 /crisis/alert 流程
 *     - 端侧 _detectCrisisStub 已在前端跑过, 服务端复检防客户端被改包
 *   V3 接真 LLM:
 *     - 注入 AiEngineModule 的 LlmOrchestratorService
 *     - outputSchema = DiaryAiFeedbackDto (structured output)
 *     - 输入 payload = themes + moodHint + localSummary + tags + author_id (uid 匿迹)
 *
 *   如何验证: P0 阶段: 输入 moodHint='low' tags=['challenge'] → 返回
 *             summary 含「状态一般」+ themes=['工作','挑战'], crisisFlag=false.
 *             输入 moodHint='crisis' → crisisFlag=true, 触发危机干预路径.
 */
@Injectable()
export class GoodStateDiaryAiService {
  constructor(private readonly diaryService: GoodStateDiaryService) {}

  /**
   * 生成 AI 反馈 — 输入 metadata-only (PRD §11.1 隐私底线: 不传 body / title).
   *
   * 严格边界:
   *   - 不诊断 (不输出「抑郁症」「焦虑症」等)
   *   - 不评判 (不输出「你应该」「建议你」「你有问题」)
   *   - 不预测未来 (不输出「你以后会...」)
   *   - 不强行积极 (不输出「加油」「明天会更好」)
   */
  async generateFeedback(uid: string, request: RequestDiaryAiFeedbackDto): Promise<DiaryAiFeedbackDto> {
    // 1. 校验 entry 所有权 — 防止越权读别人日记的 metadata.
    //    用 findOwnedOrThrow 而非 getById: 软删的也拒绝 (避免已删日记的 metadata 仍触发 AI).
    await this.diaryService.findOwnedOrThrow(uid, request.entryId);

    // 2. 生成 (P0 启发式; V3 替换为 LLM 调用).
    return this.buildHeuristicFeedback(request);
  }

  // ════════════════════════════════════════════════════════════════
  // 内部: P0 启发式生成 (V3 接 LLM 后整段替换)
  // ════════════════════════════════════════════════════════════════

  private buildHeuristicFeedback(req: RequestDiaryAiFeedbackDto): DiaryAiFeedbackDto {
    const moodHint = req.moodHint ?? null;
    const themes = req.themes.filter((t) => t.length > 0);
    const tags = req.tags.filter((t) => t.length > 0);

    return {
      summary: this.buildSummary(moodHint, themes, tags, req.localSummary),
      perspectiveQuestions: this.buildQuestions(moodHint),
      observedThemes: themes.length > 0 ? themes : tags,
      generatedAt: new Date().toISOString(),
      source: DiaryAiFeedbackSource.Cloud,
      crisisFlag: moodHint === DiaryMoodLevel.Crisis,
    };
  }

  /**
   * 中性总结 — 1-2 句, 无评判.
   *
   * 设计原则 (大厂 spec):
   *   - 不用「你」做评价主语 (避免引导自责归因)
   *   - 描述观察到的事实, 不做因果归因
   *   - 留白让用户决定如何理解
   */
  private buildSummary(moodHint: DiaryMoodLevel | null, themes: string[], tags: string[], localSummary: string): string {
    const moodText = this.moodText(moodHint);
    const topicText = this.topicText(themes, tags);
    const baseText = topicText ? `${moodText}, 提到了${topicText}方面的内容` : `${moodText}`;
    // 若端侧给了 localSummary, 拼一句观察; 否则只返 mood + topic
    const trimmed = localSummary.trim();
    if (trimmed.length > 0) {
      return `${baseText}. 端侧观察: ${trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed}`;
    }
    return `${baseText}.`;
  }

  /**
   * 3 个开放问题 — PRD §10.1 闭环逻辑 + 强约束 3 个.
   *
   * 设计原则 (积极心理学 + ACT 认知解离):
   *   - 「是什么」类问题优先于「为什么」类 (避免引导自责归因)
   *   - 「如果... 你会...」类假设性问题, 打开可能性
   *   - 禁用「你为什么不...」「你怎么会...」类评判性反问
   */
  private buildQuestions(moodHint: DiaryMoodLevel | null): string[] {
    const baseQuestions = [
      '写下这段话的时候, 身体感觉如何?',
      '如果给这一刻取一个名字, 会是什么?',
      '过段时间回看, 你想对今天的自己说点什么?',
    ];
    if (moodHint === DiaryMoodLevel.Crisis) {
      // crisis 档时, 替换最尖锐的一个问题为更温和的「你想被怎么支持」
      return ['此刻, 你最需要的一种支持是什么?', '如果身边有一个完全接纳你的人, 你会想说什么?', '过去类似的时候, 是什么让你撑过来的?'];
    }
    return baseQuestions;
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

  private topicText(themes: string[], tags: string[]): string {
    if (themes.length > 0) return themes.slice(0, 3).join('、');
    if (tags.length > 0) return tags.slice(0, 3).join('、');
    return '';
  }
}
