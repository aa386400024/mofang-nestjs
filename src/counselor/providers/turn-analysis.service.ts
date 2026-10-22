// V2026-10-21 治本 (V1.2 VS-B2 — 每轮会谈分析器 service):
//   原因: v1.2 有 3 个"每轮都要跑"的分析需求, 读的是**同一段对话**:
//     - §6.1 实时督导轻提示: 每轮 counselor 发言后跑轻量 classifier, 命中规则写 live_hint 表
//     - §6.4 双向移情/阻抗标记: AI 自动标记 (来访侧) 在 transcript turn 上打 tag
//     - §4.2 动态解锁档案: 抽取本轮来访者主动披露了什么 (写 case_profile_entries)
//   修法: 本 service 一轮**只调一次 LLM**, 一次输出三段 (hint + mark + disclosures):
//     - 省一次调用成本 (每轮都跑, 成本是线性累加的)
//     - 更重要: 避免多次判定口径不一致 (同一条回复, 判提示说"没接住情绪"、判标记说"来访很平静"
//       = 自相矛盾; 而"来访说了童年被打"与"来访没有阻抗"也是同一段文本的两种解读)
//   **档位只控"是否展示", 不控"是否分析"** (V2026-10-21 修订 D9):
//     档案抽取与移情标记是**卷宗数据** (长程趋势图 / 动态解锁档案), 不是"实时提示";
//     它们对**关掉提示的进阶用户**同样有价值 —— 那类用户恰恰在做长程个案.
//     若 tier=off 就不跑分析, 档案永远不填, 信任度永远不涨, 信息暴露节奏永远停在第一档,
//     整个 M1 机制失效. → 分析**始终跑**, tier 只决定 hint 是否落库 + 推送.
//   反双胞胎:
//     - 不在 service 内直接调 LlmService: 统一走 CounselorLlmJsonClient (唯一结构化输出出口)
//     - 不把"取 transcript"写在 service 里各查各的: 统一走 SessionContextBuilder
//       (polymorphic, 单次训练 + 长程卷宗同一套), 顺带解决"长程会话 id 查不到"的问题
//     - 不用 fire-and-forget: 本方法由 BullMQ worker 调用 (可重试 / 不丢)
//   验证:
//     1. tsc 0 错
//     2. 大炮跑一轮真实会话 → 提示只给方向 (不含可直接照念的话术)
//     3. 长程会话跑一轮 → case_profile_entries 新增条目 + trust_level 上升
//   时间戳: 2026-10-21

import { Injectable, Logger } from '@nestjs/common';

import { LiveSupervisionHintService } from './live-hint.service';
import { CounselorLlmJsonClient } from './llm-json.client';
import { ProfileExtractionService } from './profile-extraction.service';
import { SessionContextBuilder } from './session-context.builder';
import { SessionCoreEventsService } from './session-core-events.service';
import { TransferenceMarkService } from './transference-mark.service';
import { COUNSELOR_LLM_PROFILES } from '../config/counselor-llm.config';
import { buildTurnAnalysisUserPrompt, TURN_ANALYZER_SCHEMA_DESCRIPTION, TURN_ANALYZER_SYSTEM_PROMPT } from '../config/session-core-prompts';
import { type LiveTurnAnalysis, validateLiveTurnAnalysis } from '../domain/session-core/session-core.types';
import { ChatRole } from '../enums/chat-role.enum';
import { LiveSupervisionHintTier } from '../enums/live-supervision-hint-tier.enum';

/**
 * 每轮分析结果 (给 worker 记日志用).
 */
export interface TurnAnalysisOutcome {
  /** 是否产出了轻提示 (被防抖拦下 / 档位关闭时为 false) */
  readonly hintPublished: boolean;
  /** 是否产出了移情/阻抗标记 */
  readonly markCreated: boolean;
  /** 本轮新披露落库条数 */
  readonly disclosureAdded: number;
}

/**
 * 每轮会谈分析器.
 */
@Injectable()
export class TurnAnalysisService {
  private readonly logger = new Logger(TurnAnalysisService.name);

  constructor(
    private readonly contextBuilder: SessionContextBuilder,
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly hintService: LiveSupervisionHintService,
    private readonly markService: TransferenceMarkService,
    private readonly extraction: ProfileExtractionService,
    private readonly events: SessionCoreEventsService,
  ) {}

  /**
   * 分析一轮对话, 产出并落库「轻提示」+「移情/阻抗标记」+「本轮披露」.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id (单次训练 / 长程卷宗皆可)
   * @param turnIndex 来访者这一轮的轮次序号
   * @param tier 当前轻提示档位 (off → 不落库 hint, 但 mark / 披露照常产出)
   * @returns 分析产出摘要
   */
  async analyze(userId: string, sessionId: string, turnIndex: number, tier: LiveSupervisionHintTier): Promise<TurnAnalysisOutcome> {
    // 1. 取统一会话上下文 (polymorphic: 单次训练 / 长程卷宗)
    const ctx = await this.contextBuilder.loadBySessionId(userId, sessionId);
    if (!ctx) {
      this.logger.warn(`[turn_analysis_no_context] session=${sessionId}`);
      return { hintPublished: false, markCreated: false, disclosureAdded: 0 };
    }
    const transcript = ctx.transcript;
    const visitorTurn = transcript[turnIndex];
    if (!visitorTurn || visitorTurn.role !== ChatRole.VISITOR) {
      // 轮次对不上 (用户重传了 transcript / 顺序变了) → 不分析, 不报错
      this.logger.warn(`[turn_analysis_turn_mismatch] session=${sessionId} turn=${turnIndex} ` + `role=${visitorTurn?.role ?? 'n/a'}`);
      return { hintPublished: false, markCreated: false, disclosureAdded: 0 };
    }
    // 找来访这一轮之前的最后一句咨询师发言
    let counselorText = '';
    for (let i = turnIndex - 1; i >= 0; i--) {
      const turn = transcript[i];
      if (turn && turn.role === ChatRole.COUNSELOR) {
        counselorText = turn.text;
        break;
      }
    }
    if (!counselorText) {
      // 没有咨询师发言可分析 (首轮就是来访?) → 跳过
      return { hintPublished: false, markCreated: false, disclosureAdded: 0 };
    }
    const recentTurns = transcript.slice(Math.max(0, turnIndex - 4), turnIndex);

    // 2. 一次 LLM, 三段输出
    const profile = COUNSELOR_LLM_PROFILES.liveTurnAnalysis;
    const result = await this.llmJson.requestJson<LiveTurnAnalysis>({
      systemPrompt: TURN_ANALYZER_SYSTEM_PROMPT,
      userPrompt: buildTurnAnalysisUserPrompt({
        turnIndex,
        counselorText,
        visitorText: visitorTurn.text,
        recentTurns,
        tier,
      }),
      schemaDescription: TURN_ANALYZER_SCHEMA_DESCRIPTION,
      validate: validateLiveTurnAnalysis,
      maxCompletionTokens: profile.maxCompletionTokens,
      reasoningEffort: profile.reasoningEffort,
      timeoutMs: profile.timeoutMs,
      tenantId: ctx.tenantId,
      userId,
    });

    if (!result.ok || result.data === null) {
      // 分析失败不抛: 提示/标记/披露都是"锦上添花", 不该让 worker 无限重试一条分析不出来的对话.
      this.logger.warn(`[turn_analysis_failed] session=${sessionId} turn=${turnIndex} ` + `code=${result.errorCode ?? 'unknown'}`);
      return { hintPublished: false, markCreated: false, disclosureAdded: 0 };
    }

    const analysis = result.data;

    // 3. 轻提示 (档位 off → 不落库不推送; 落库走 5 分钟防抖)
    let hintPublished = false;
    if (analysis.hint && tier === LiveSupervisionHintTier.LIGHT) {
      const published = await this.hintService.record(userId, sessionId, turnIndex, analysis.hint, tier);
      hintPublished = published !== null;
    }

    // 4. 移情/阻抗标记 (方向固定 visitor_auto, 由 service 入口决定)
    let markCreated = false;
    if (analysis.mark) {
      const created = await this.markService.appendVisitorMark(userId, sessionId, turnIndex, analysis.mark.markType, analysis.mark.note);
      this.events.publish(sessionId, { event: 'transference_mark', data: created });
      markCreated = true;
    }

    // 5. 本轮披露 → 动态解锁档案 + 信任度推进
    const persisted = await this.extraction.persistDisclosures({
      userId,
      sessionId,
      caseId: ctx.caseId,
      turnIndex,
      disclosures: analysis.disclosures,
    });

    this.logger.log(
      `[turn_analysis_done] session=${sessionId} turn=${turnIndex} ` +
        `hint=${hintPublished ? 'y' : 'n'} mark=${markCreated ? 'y' : 'n'} ` +
        `disclosed=${persisted.addedCount} trust ${persisted.trustBefore.toFixed(2)}→${persisted.trustAfter.toFixed(2)}`,
    );
    return {
      hintPublished,
      markCreated,
      disclosureAdded: persisted.addedCount,
    };
  }
}
