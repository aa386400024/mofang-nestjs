// V2026-10-21 治本 (V1.2 VS-A — SessionContextBuilder, 上下文装配器的取数层):
//   原因: src/counselor/domain/session-context/session-context.ts 定义了 "会话上下文长什么样 +
//     怎么渲染成 prompt 块" (纯函数), 但还差 "怎么把一条 session 记录变成 SessionContext".
//     这一步必须有**单一取数入口**, 否则督导 / 来访者 / 未来的 M1 档案抽取各查各的,
//     会拿到口径不一致的 transcript (有的过滤了 system 轮, 有的没有).
//   修法: 本 provider 唯一职责 = 从 Repository 取 session 行 → 映射成不可变 SessionContext.
//     - polymorphic: 按 SessionType 走对应表 (TRAINING_SESSION → training_sessions,
//       LONG_TERM_CASE_SESSION → long_term_case_sessions + 父级 long_term_cases 取人设),
//       跟 supervision.service 的 polymorphic sessionType 契约 1:1
//     - 软删过滤: counselor 系用普通 deleted_at 列 (非 @DeleteDateColumn), 必须手写 IsNull()
//     - 跨用户访问: where 带 userId, 越权查不到 (返 NotFoundException, 不泄露存在性)
//     - transcript 统一: 两种表的 transcript 元素形状不同 (TrainingTranscriptTurn 5 字段
//       vs SessionTranscriptTurn 3 字段), 在本层统一成 SessionContextTurn 3 字段
//   反双胞胎:
//     - 不在 builder 里做业务判断 (如"会话是否结束"): 判断归 service, builder 只做取数 + 映射
//     - 不把长程人设硬塞进 training_sessions: 两者是不同业务域, 靠 SessionContext 抽象层收敛
//     - 不为 full_session 造假数据: 直接抛 400, 等真有第三种 session 再补
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 GET /counselor/training-sessions/:id → 返 transcript 数组
//     3. 生成督导反馈时日志可见 transcript 轮次数与截断标记
//   时间戳: 2026-10-21

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type {
  SessionContext,
  SessionContextEntry,
  SessionContextTurn,
  SessionPersonaContext,
} from '../domain/session-context/session-context';
import { CaseProfileEntry } from '../entities/case-profile-entry.entity';
import { LongTermCaseSession, type SessionTranscriptTurn } from '../entities/long-term-case-session.entity';
import { LongTermCase } from '../entities/long-term-case.entity';
import { TrainingSession } from '../entities/training-session.entity';
import { VisitorFullPersona } from '../entities/visitor-full-persona.entity';
import { ChatRole } from '../enums/chat-role.enum';
import { SessionType } from '../enums/session-type.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingSessionStatus } from '../enums/training-session-status.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

/**
 * training_sessions 行 → SessionContext.
 *
 * @param row training_sessions 表行
 */
export function toSessionContext(row: TrainingSession): SessionContext {
  const persona: SessionPersonaContext = {
    name: row.personaName,
    age: row.personaAge,
    occupation: row.personaOccupation,
    complaint: row.personaComplaint,
    background: row.personaBackground,
    visitorStyle: row.visitorStyle,
    difficulty: row.difficulty,
    emotionBaseline: row.emotionBaseline,
    defenseLevel: row.defenseLevel,
  };
  const transcript: SessionContextTurn[] = (row.transcript ?? []).map((turn) => ({
    role: turn.role,
    text: turn.text,
    timestamp: turn.timestamp,
  }));
  return {
    sessionId: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    scenarioId: row.scenarioId,
    status: row.status,
    difficulty: row.difficulty,
    durationMinutes: row.durationMinutes,
    persona,
    transcript,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    // V2026-10-21 治本 (V1.2 VS-B1 — 单次训练无长程关系 → 无信任度 / 无已解锁档案)
    trustLevel: null,
    unlockedEntries: [],
  };
}

/**
 * long_term_case_sessions + 父级 long_term_cases → SessionContext.
 *
 * 长程卷宗没有 "难度 / visitorStyle" 字段 (那是单次训练的 VisitorPreset 概念),
 * 这里用固定默认值占位, 并在 v1.2 M1 (分层人设) 落地后由全量人设覆盖.
 *
 * @param session long_term_case_sessions 表行
 * @param parent long_term_cases 表行 (人设来源)
 * @param trustLevel 咨访信任度 (来自 visitor_full_personas, 无则 null)
 * @param unlockedEntries 已解锁档案条目 (来访已主动披露的部分)
 */
export function toLongTermSessionContext(
  session: LongTermCaseSession,
  parent: LongTermCase,
  trustLevel: number | null,
  unlockedEntries: readonly SessionContextEntry[],
): SessionContext {
  const persona: SessionPersonaContext = {
    name: parent.visitorPersona?.name ?? '来访者',
    age: parent.visitorPersona?.age ?? 0,
    occupation: parent.visitorPersona?.occupation ?? '',
    complaint: parent.visitorPersona?.complaint ?? '',
    background: parent.visitorPersona?.background ?? '',
    visitorStyle: VisitorStyle.MIXED,
    difficulty: TrainingDifficulty.L2,
    emotionBaseline: parent.visitorPersona?.emotionBaseline ?? 0.5,
    defenseLevel: parent.visitorPersona?.defenseLevel ?? 0.3,
  };
  const transcript: SessionContextTurn[] = (session.transcript ?? []).map((turn: SessionTranscriptTurn) => ({
    role: turn.role === 'visitor' ? ChatRole.VISITOR : ChatRole.COUNSELOR,
    text: turn.content,
    timestamp: turn.ts,
  }));
  return {
    sessionId: session.id,
    tenantId: session.tenantId,
    userId: parent.userId,
    scenarioId: parent.caseType,
    // 长程 session 没有 5 态状态机 (那是单次训练概念), 统一映射成 finished 语义
    status: TrainingSessionStatus.FINISHED,
    difficulty: TrainingDifficulty.L2,
    durationMinutes: Math.round((session.durationSeconds ?? 0) / 60),
    persona,
    transcript,
    startedAt: null,
    endedAt: null,
    trustLevel,
    unlockedEntries,
  };
}

/**
 * 会话上下文装配器 — counselor 端唯一取数入口.
 */
@Injectable()
export class SessionContextBuilder {
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    @InjectRepository(LongTermCaseSession)
    private readonly longTermSessionRepo: Repository<LongTermCaseSession>,
    @InjectRepository(LongTermCase)
    private readonly longTermCaseRepo: Repository<LongTermCase>,
    // V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设: 装信任度 + 已解锁档案)
    @InjectRepository(VisitorFullPersona)
    private readonly personaRepo: Repository<VisitorFullPersona>,
    @InjectRepository(CaseProfileEntry)
    private readonly entryRepo: Repository<CaseProfileEntry>,
  ) {}

  /**
   * 装载 1 个会话的完整上下文 (polymorphic).
   *
   * @param userId 当前用户 id (越权查不到)
   * @param sessionId 会话 id
   * @param sessionType session 类型 (polymorphic, 跟 supervision DTO 1:1)
   * @throws NotFoundException 会话不存在 / 已软删 / 不属于当前用户
   * @throws BadRequestException sessionType 暂不支持
   */
  async build(userId: string, sessionId: string, sessionType: SessionType): Promise<SessionContext> {
    if (sessionType === SessionType.TRAINING_SESSION) {
      const row = await this.sessionRepo.findOne({
        where: { id: sessionId, userId, deletedAt: IsNull() },
      });
      if (!row) {
        throw new NotFoundException(`训练会话 ${sessionId} 不存在或不属于当前用户`);
      }
      return toSessionContext(row);
    }

    if (sessionType === SessionType.LONG_TERM_CASE_SESSION) {
      const session = await this.longTermSessionRepo.findOne({
        where: { id: sessionId, tenantId: userId, deletedAt: IsNull() },
      });
      if (!session) {
        throw new NotFoundException(`长程会谈 ${sessionId} 不存在或不属于当前用户`);
      }
      const parent = await this.longTermCaseRepo.findOne({
        where: { id: session.caseId, userId, deletedAt: IsNull() },
      });
      if (!parent) {
        throw new NotFoundException(`长程个案 ${session.caseId} 不存在或不属于当前用户`);
      }
      // V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设接入装配器):
      //   原因: v1.2 §4.1 的"信息暴露节奏"需要信任度, §4.2 的"动态解锁档案"需要已解锁条目,
      //     两者都只存在于长程关系里 (单次训练没有) → 装在长程分支.
      //   修法: 并行取 visitor_full_personas.trust_level + case_profile_entries(layer=self_disclosed).
      //   反双胞胎:
      //     - **只装 self_disclosed**: therapist_note 是咨询师自己的观察, 不是"来访披露",
      //       混进"来访已披露"会污染 AI 对来访者的认知模型
      //     - 不装未解锁的深层人设 (innerWorkingModel 等): 督导报告是给用户看的,
      //       放进去等于变相泄露来访者没说出口的内心戏, 摧毁信息探索价值 (v1.2 §2.2 原则 1/2)
      const [persona, entries] = await Promise.all([
        this.personaRepo.findOne({
          where: { caseId: session.caseId, userId, deletedAt: IsNull() },
        }),
        this.entryRepo.find({
          where: { caseId: session.caseId, userId, layer: 'self_disclosed', deletedAt: IsNull() },
          order: { createdAt: 'ASC' },
        }),
      ]);
      const unlockedEntries: SessionContextEntry[] = entries.map((e) => ({
        anchorKey: e.anchorKey,
        content: e.content,
        sessionId: e.sessionId,
      }));
      return toLongTermSessionContext(session, parent, persona?.trustLevel ?? null, unlockedEntries);
    }

    throw new BadRequestException(`暂不支持的 sessionType: ${sessionType}`);
  }
}
