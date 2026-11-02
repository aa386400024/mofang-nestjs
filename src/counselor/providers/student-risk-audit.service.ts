// V2026-11-02 治本 (WP14 · 学员风险事件审计落库 — counselor 侧实现):
//   职责: 把引擎判出的"学员风险事件"写进 `student_risk_events` (append-only 审计表),
//         并支持回写学员在弹窗后的选择.
//   边界: 只做落库 + 回写; **不做**任何判定 (判定在引擎适配层) 与**不做**任何展示.
//
//   为什么实现住在 counselor 侧:
//     审计表跟 `training_sessions` 是同一族业务数据 (都按 user_id 隔离学员),
//     住在 counselor 域最自然; 而引擎装配层零 ORM (WP8-A §8-9 护栏) ——
//     它只认 `StudentRiskAuditSink` 这个插槽, 实现由本类注册进去.
//
//   append-only 的落法:
//     · `record` 只 **INSERT**, 永不 UPDATE / DELETE;
//     · `markUserChoice` 是**唯一**的 UPDATE —— 且只碰 `user_choice` 一列
//       (任务单 §1.3 拍板: 它是用户主动反馈, 不是审计篡改).
//
//   失败语义:
//     写不进去 → **只打 error 日志**, 不抛给对练主链路 ——
//     留痕是审计能力, 不是会话能力 (与引擎侧"写库失败只打日志"同款纪律).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. 大炮跑 pnpm migration:run 后: 学员发"我想死" → 表里出现 1 行 level=high / action_taken=modal
//   时间戳: 2026-11-02

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import {
  StudentRiskAuditRegistry,
  type StudentRiskAuditChoice,
  type StudentRiskAuditEventInput,
  type StudentRiskAuditSink,
} from '../../voice/student-risk-audit-slot.js';
import { StudentRiskEvent } from '../entities/student-risk-event.entity.js';

/**
 * 学员风险事件审计服务 (业务侧实现 `StudentRiskAuditSink`).
 */
@Injectable()
export class StudentRiskAuditService implements StudentRiskAuditSink, OnModuleInit {
  private readonly logger = new Logger(StudentRiskAuditService.name);

  /**
   * @param repo student_risk_events 仓储
   * @param registry voice 侧审计插槽 (@Global; 引擎装配层通过它拿到本实现)
   */
  constructor(
    @InjectRepository(StudentRiskEvent)
    private readonly repo: Repository<StudentRiskEvent>,
    private readonly registry: StudentRiskAuditRegistry,
  ) {}

  /** 启动时注册进 voice 侧插槽 (业务侧提供实现, 同 VoiceSessionBridge 范式). */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 记一条风险事件 (只 INSERT).
   *
   * @param event 事件内容
   */
  async record(event: StudentRiskAuditEventInput): Promise<void> {
    try {
      await this.repo.insert({
        sessionId: event.sessionId,
        userId: event.userId,
        turnIndex: event.turnIndex,
        level: event.level,
        category: event.category,
        snippet: event.snippet,
        source: event.source,
        actionTaken: event.actionTaken,
        userChoice: null,
        monitoredAfter: event.monitoredAfter,
        reviewedBy: null,
      });
      this.logger.warn(
        `[risk_recorded] session=${event.sessionId} turn=${event.turnIndex} level=${event.level} ` +
          `category=${event.category} action=${event.actionTaken} source=${event.source}`,
      );
    } catch (error) {
      // 只打 error 日志, 不抛 —— 留痕写不进去不该把对练搞挂.
      this.logger.error(`[risk_record_failed] session=${event.sessionId} err=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 回写学员在弹窗后的选择 (只碰 `user_choice` 一列).
   *
   * 写哪一行: 该会话里**最新一条还没写过选择**的行 —— 那就是弹窗对应的那条.
   * 用"最新 + 未写"而不是"最后一条": 弹窗可能重复出现 (学员又说了同一句),
   * 逐条回写才对得上"学员对哪一次弹窗做的选择".
   *
   * @param sessionId 训练会话 id
   * @param choice 学员的选择
   */
  async markUserChoice(sessionId: string, choice: StudentRiskAuditChoice): Promise<void> {
    try {
      const result = await this.repo
        .createQueryBuilder()
        .update(StudentRiskEvent)
        .set({ userChoice: choice })
        .where('session_id = :sessionId', { sessionId })
        .andWhere('user_choice IS NULL')
        .orderBy('id', 'DESC')
        .limit(1)
        .execute();
      this.logger.warn(`[risk_choice_recorded] session=${sessionId} choice=${choice} affected=${result.affected ?? 0}`);
    } catch (error) {
      this.logger.error(`[risk_choice_failed] session=${sessionId} err=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 取某场会话的风险事件 (给报告标注用).
   *
   * @param sessionId 训练会话 id
   * @returns 事件列表 (按写入顺序; 无则空数组)
   */
  async listBySession(sessionId: string): Promise<readonly StudentRiskEvent[]> {
    return this.repo.find({
      where: { sessionId },
      order: { id: 'ASC' },
    });
  }

  /**
   * 取某场会话里还没写过选择的事件 (给报告标注用).
   *
   * @param sessionId 训练会话 id
   * @returns 事件列表
   */
  async listPendingChoiceBySession(sessionId: string): Promise<readonly StudentRiskEvent[]> {
    return this.repo.find({
      where: { sessionId, userChoice: IsNull() },
      order: { id: 'ASC' },
    });
  }
}
