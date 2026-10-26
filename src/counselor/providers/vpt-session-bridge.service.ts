// V2026-10-26 治本 (vpt 会话落库桥 — counselor 侧实现, spec 任务 1):
//   原因: 任务 1 要求「vpt 建连成功 (ready 前) 写一条 `training_sessions` 记录」, 让
//     vpt 从"纯内存、结束即清"变成有稳定落库 id 的会话 —— 否则:
//       · 督导报告无处存 (fire-and-forget 生成完就丢)
//       · 4 流派反馈没有 sessionId 可挂
//       · 实时提示 / 技术统计 / 移情标记没有会话归属
//   修法: 本 service 实现 voice 侧的 `VoiceSessionBridge` 插槽 (依赖倒置):
//     - open       建一条 training_sessions 记录 (scenario_id = 'vpt_voice') → 返回稳定 id
//     - appendTurn 追加一轮逐字稿 (咨询师 + 来访者) → 入队该轮分析
//     - close      回写结束状态 / 结束时间
//   复用现有体系 (不另造轮子):
//     - 落 `training_sessions` 表 (已有 transcript json / tech_stats json / started_at /
//       ended_at / supervision_report_id 列) —— **0 新表、0 新列、0 migration**
//     - 逐字稿格式沿用 `TrainingTranscriptTurn` (ChatRole 3 档), 与单次训练同一口径
//     - 该轮分析沿用既有 `TurnAnalysisProcessor` (BullMQ) —— 轻提示 / 移情标记 / 技术统计
//       三段产出**全部**复用既有分析器, 本期不重写
//   反双胞胎:
//     - 不新建 `vpt_sessions` 表: vpt 与单次训练同属"训练会话", 逐字稿 / 统计 / 标记 /
//       督导全在同一套体系里; 另开一张表 = 两套逐字稿格式 + 两套分析入口, 必然漂移
//     - 不用内存 sessionId 当主键: 客户端给的 id 不是稳定落库 id, 报告 / 反馈都要按它查
//     - 不在 open 里同步跑分析: 分析是 LLM 调用 (3-8s), 建连关键路径上不能等
//     - 不覆盖 `duration_minutes` (那是**计划**时长 L1=10/L2=15/L3=20): 实际时长由
//       started_at → ended_at 推导, 覆盖计划值会让"计划 vs 实际"两个语义撞在一起
//   验证:
//     1. tsc 0 错
//     2. vpt 建连 → training_sessions 出现 1 条 scenario_id='vpt_voice' 的行
//     3. 会话结束 → 该行 status=finished, ended_at 有值
//     4. 跨用户查该 sessionId → 404 (归属校验在查询侧, 不靠前端)
//   时间戳: 2026-10-26

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { IsNull, type Repository } from 'typeorm';

import { CounselorSupervisionProcessor } from './counselor-supervision.processor';
import { TurnAnalysisProcessor } from './turn-analysis.processor';
import {
  VoiceSessionBridgeRegistry,
  type VoiceSessionBridge,
  type VoiceSessionCloseInput,
  type VoiceSessionOpenInput,
  type VoiceSessionOpenResult,
  type VoiceSessionTurnInput,
} from '../../voice/voice-session-bridge';
import type { VoiceDifficulty, VoiceVisitorStyle } from '../../voice/voice-session.types';
import { VPT_SCENARIO_ID } from '../config/vpt.config';
import { TrainingSession, type TrainingTranscriptTurn } from '../entities/training-session.entity';
import { ChatRole } from '../enums/chat-role.enum';
import { DimensionVariance } from '../enums/dimension-variance.enum';
import { SessionType } from '../enums/session-type.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingSessionStatus } from '../enums/training-session-status.enum';
import { VisitorMode } from '../enums/visitor-mode.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

/**
 * vpt 会话在 `training_sessions` 表里的场景标识 → 见 `../config/vpt.config`.
 * 放在 config 而不放在本文件: 写方 (本桥) 与读方 (报告查询, 据此判定 sessionType)
 * 都要用它, 两边各写一份字面量, 改一处就断链.
 */

/** 难度 → 计划时长 (分钟), 跟单次训练同一口径 (L1=10 / L2=15 / L3=20). */
const DURATION_BY_DIFFICULTY: Readonly<Record<TrainingDifficulty, number>> = {
  [TrainingDifficulty.L1]: 10,
  [TrainingDifficulty.L2]: 15,
  [TrainingDifficulty.L3]: 20,
};

/** 年龄区间解析不出时的兜底年龄 (与单次训练 create 的缺省一致). */
const DEFAULT_PERSONA_AGE = 28;

/**
 * voice 侧难度 → counselor 侧难度 (显式映射, 不 cast).
 *
 * @param difficulty voice 侧难度
 */
function toTrainingDifficulty(difficulty: VoiceDifficulty): TrainingDifficulty {
  switch (difficulty) {
    case 'L1': {
      return TrainingDifficulty.L1;
    }
    case 'L2': {
      return TrainingDifficulty.L2;
    }
    case 'L3': {
      return TrainingDifficulty.L3;
    }
  }
}

/**
 * voice 侧配合风格 → counselor 侧配合风格 (显式映射, 不 cast).
 *
 * @param style voice 侧风格
 */
function toVisitorStyle(style: VoiceVisitorStyle): VisitorStyle {
  switch (style) {
    case 'defensive': {
      return VisitorStyle.DEFENSIVE;
    }
    case 'cooperative': {
      return VisitorStyle.COOPERATIVE;
    }
    case 'resistant': {
      return VisitorStyle.RESISTANT;
    }
    case 'avoidant': {
      return VisitorStyle.AVOIDANT;
    }
    case 'mixed': {
      return VisitorStyle.MIXED;
    }
  }
}

/**
 * vpt 会话落库桥 (counselor 侧实现).
 */
@Injectable()
export class VptSessionBridgeService implements OnModuleInit, VoiceSessionBridge {
  /** 桥标识 (日志用). */
  readonly name = 'counselor-vpt';

  private readonly logger = new Logger(VptSessionBridgeService.name);

  /**
   * 内部串行链 (V2026-10-26, spec 任务 6 — 顺序保证).
   *
   * 原因: voice 侧对桥的调用是 **fire-and-forget** (`void bridges.appendTurn(...)` /
   *   `void bridges.close(...)`), 两者可以**并发**在飞. 而:
   *     - `appendTurn` 往 training_sessions 追加逐字稿
   *     - `close` 回写结束状态, 并派发 4 流派任务 (它要**读库里的逐字稿**)
   *   若 close 抢在最后一轮 appendTurn 之前落地, 流派任务读到的逐字稿就是**截断的**
   *   —— 技术统计 / 反馈会基于半句话算, 且报告里的轮次数对不上.
   *   治本: 桥内部用一条 promise 链串行化, 保证 appendTurn → close 的先后.
   *   (单次训练没这个问题: 它的 finish 是 HTTP 端点, 逐字稿早就写完了.)
   */
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param sessionRepo training_sessions 仓储
   * @param turnAnalysisProcessor 每轮分析入队器
   * @param supervisionProcessor 4 流派反馈入队器 (技术统计的唯一来源)
   * @param registry voice 侧落库桥注册表 (@Global)
   */
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly turnAnalysisProcessor: TurnAnalysisProcessor,
    private readonly supervisionProcessor: CounselorSupervisionProcessor,
    private readonly registry: VoiceSessionBridgeRegistry,
  ) {}

  /** 启动时注册进 voice 侧全局注册表. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 建会话 (落一条 training_sessions 记录).
   *
   * @param input 建连输入
   * @returns 落库结果
   */
  async open(input: VoiceSessionOpenInput): Promise<VoiceSessionOpenResult> {
    const difficulty = toTrainingDifficulty(input.preset.difficulty);
    const entity = this.sessionRepo.create({
      // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
      tenantId: input.tenantId,
      userId: input.userId,
      scenarioId: VPT_SCENARIO_ID,
      difficulty,
      durationMinutes: DURATION_BY_DIFFICULTY[difficulty],
      status: TrainingSessionStatus.IDLE,
      // 来访者表层字段来自速查卡 (可公开的那几项); 没有卡 (兜底通道) 时用中性缺省.
      personaName: input.visitor.codename || '来访者',
      personaAge: input.visitor.ageLowerBound ?? DEFAULT_PERSONA_AGE,
      personaOccupation: input.visitor.occupation,
      personaComplaint: input.visitor.presentingComplaint,
      // 背景不落: 公共人物只对外呈现区间 + 居住状态, 完整背景属 7 大块剧本 (不下发).
      personaBackground: '',
      visitorStyle: toVisitorStyle(input.preset.style),
      emotionBaseline: input.preset.emotionBaseline,
      defenseLevel: input.preset.defenseLevel,
      randomSeed: this.generateRandomSeed(),
      mode: VisitorMode.USE_MY_SETTINGS,
      styleVariance: DimensionVariance.MEDIUM,
      emotionVariance: DimensionVariance.MEDIUM,
      defenseVariance: DimensionVariance.MEDIUM,
      transcript: [],
      supervisionReportId: null,
      // 建连成功即计时起点 (与语音侧的墙钟起点一致).
      startedAt: new Date(),
      endedAt: null,
    });
    const saved = await this.sessionRepo.save(entity);
    this.logger.log(
      `[open] ws_session=${input.sessionId} db_session=${saved.id} user=${input.userId} ` +
        `template=${input.templateId ?? '<fallback>'} skill=${input.skillCode ?? '<none>'}`,
    );
    return { persisted: true, dbSessionId: saved.id };
  }

  /**
   * 追加一轮对话 (逐字稿落库 + 入队该轮分析).
   *
   * @param input 一轮对话
   */
  async appendTurn(input: VoiceSessionTurnInput): Promise<void> {
    await this.enqueueOp(() => this.doAppendTurn(input));
  }

  /**
   * 结束会话 (回写结束状态 / 结束时间 + 派发 4 流派反馈).
   *
   * @param input 结束输入
   */
  async close(input: VoiceSessionCloseInput): Promise<void> {
    await this.enqueueOp(() => this.doClose(input));
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 把一个操作挂到内部串行链上.
   *
   * 单个 op 失败**不能断链** —— 否则后面的 close 永远不执行, 会话永远收不了尾
   * (逐字稿停在最后一轮, 状态永远不是 finished).
   *
   * @param op 操作
   */
  private async enqueueOp(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op).catch((err) => {
      this.logger.warn(`[chain_op_failed] err=${err instanceof Error ? err.message : String(err)}`);
    });
    this.chain = next;
    return next;
  }

  /**
   * 追加一轮对话 (实际执行体).
   *
   * @param input 一轮对话
   */
  private async doAppendTurn(input: VoiceSessionTurnInput): Promise<void> {
    const dbSessionId = input.dbSessionId;
    if (!dbSessionId) {
      // 未落库 (降级) → 无处可写, 直接跳过 (逐字稿仍然在 agent 侧内存里, 报告仍能生成)
      return;
    }
    const row = await this.sessionRepo.findOne({
      where: { id: dbSessionId, userId: input.userId, deletedAt: IsNull() },
    });
    if (!row) {
      this.logger.warn(`[append_turn_no_row] db_session=${dbSessionId} user=${input.userId}`);
      return;
    }

    const now = Date.now();
    const turns: TrainingTranscriptTurn[] = [
      {
        id: randomUUID(),
        role: ChatRole.COUNSELOR,
        text: input.counselorText,
        timestamp: now,
      },
      {
        id: randomUUID(),
        role: ChatRole.VISITOR,
        text: input.visitorText,
        timestamp: now,
      },
    ];
    row.transcript = [...(row.transcript ?? []), ...turns];
    // 首次发言即视为进入"会谈中" (跟单次训练的 LISTENING 语义一致).
    if (row.status === TrainingSessionStatus.IDLE) {
      row.status = TrainingSessionStatus.LISTENING;
    }
    await this.sessionRepo.save(row);

    // 该轮分析: 触发点是"来访者那一轮落库后" (与单次训练同款口径 ——
    // 咨询师发言本身不足以判定, 提示要看来访者的反应).
    const visitorTurnIndex = row.transcript.length - 1;
    const enqueued = await this.turnAnalysisProcessor.enqueue({
      sessionId: dbSessionId,
      userId: input.userId,
      turnIndex: visitorTurnIndex,
    });
    if (!enqueued) {
      this.logger.warn(`[turn_analysis_enqueue_failed] db_session=${dbSessionId} turn=${visitorTurnIndex}`);
    }
  }

  /**
   * 结束会话 (实际执行体).
   *
   * @param input 结束输入
   */
  private async doClose(input: VoiceSessionCloseInput): Promise<void> {
    const dbSessionId = input.dbSessionId;
    if (!dbSessionId) {
      return;
    }
    const row = await this.sessionRepo.findOne({
      where: { id: dbSessionId, userId: input.userId, deletedAt: IsNull() },
    });
    if (!row) {
      this.logger.warn(`[close_no_row] db_session=${dbSessionId} user=${input.userId}`);
      return;
    }
    if (row.status === TrainingSessionStatus.FINISHED) {
      return;
    }
    row.status = TrainingSessionStatus.FINISHED;
    row.endedAt = row.endedAt ?? new Date();
    await this.sessionRepo.save(row);
    this.logger.log(`[close] db_session=${dbSessionId} reason=${input.reason} turns=${input.turnCount} duration_ms=${input.durationMs}`);

    // V2026-10-26 治本 (spec 任务 6 — 补上「技术统计」的来源):
    //   **技术统计 (techStats) 的唯一来源是 4 流派那一次 LLM 调用** —— 它一次同时产
    //   反馈 + 技术统计 + 错误分类 + 成长建议, 然后 `writeTechStats` 写回 session 行.
    //   主报告链路 (agent/supervisor) 只产亮点 / 建议 / 标注, **不产**技术统计.
    //   所以 vpt 不派发流派队列 → training_sessions.tech_stats 永远为 null →
    //   报告里的技术统计是空的, 学员复盘时看不到「你今天问了几次开放提问」这类最关键的量.
    //   派发缺省流派 (CBT, 与单次训练 finish 同款口径); 其余流派前端可随时调
    //   POST /counselor/supervision/feedback 现生成 (jobId 幂等, 不会堆重复 job).
    //
    //   放在**保存 row 之后**: 流派任务要读库里的逐字稿 + 状态, 必须看到收尾后的行.
    const enqueued = await this.supervisionProcessor.enqueue({
      sessionId: dbSessionId,
      sessionType: SessionType.VPT_VOICE,
      schoolCode: SupervisionSchoolCode.CBT,
      userId: input.userId,
      tenantId: input.tenantId,
    });
    if (!enqueued) {
      this.logger.warn(`[supervision_enqueue_failed] db_session=${dbSessionId} school=${SupervisionSchoolCode.CBT}`);
    }
  }

  /**
   * 生成 randomSeed (跟单次训练同格式 'YYYY-MM-DD-HH-mm-ss-{0-99}').
   *
   * 用 node:crypto 的 randomInt 而不是 Math.random: 后者是非密码学安全的伪随机源,
   * 种子可被观测输出反推 (仓库既有 4 处历史 disable 是压错不是治本, 新代码不复制).
   *
   * @returns 随机种子
   */
  private generateRandomSeed(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const base =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    // randomInt 的 max 是开区间 → randomInt(0, 100) 产出 0-99 闭区间.
    return `${base}-${String(randomInt(0, 100)).padStart(2, '0')}`;
  }
}
