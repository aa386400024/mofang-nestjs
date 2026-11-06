// V2026-11-06 治本 (WP43 · 评估引擎基础版 · 评估服务):
//   职责: ① 实现评估落库插槽 (引擎侧收尾时把本场内核出参交过来 → 算分 → 落库);
//         ② 提供查询 (单场详情 / 我的评估列表).
//   边界: 只做「编排 + 落库 + 查询」; **评分规则在 evaluation-engine.ts** (纯函数).
//
//   为什么数据是从 voice 层插槽过来的 (而不是引擎直接调本服务):
//     engine-adapters → counselor 是仓库明令禁止的反向依赖.
//     voice 层是两侧都能依赖的位置 (student-risk-audit-slot / character-version-slot 同款范式):
//     引擎侧只认插槽接口, 业务侧在 onModuleInit 注册实现, 两侧互不认识对方的具体类型.
//
//   为什么**覆盖写**而不是追加行:
//     一场会话只该有一份评估 —— 会话被重开/续接时会重算, 新的是全量, 旧的过时了.
//     堆行的话, 列表里会出现两行同一场, 用户看不懂哪份是真的.
//
//   反双胞胎:
//     - 不自己算分: 规则只有一份 (evaluation-engine.ts), 本服务只负责取数/落库/查询;
//     - 不在服务里塞 LLM: 这是**规则快评**, 与督导报告是两条链路 (互补, 不替代);
//     - 不落对话原文: raw_stats 只有计数与首末关键值;
//     - 不吞失败: 落库失败由插槽层记 warn (收尾不能被评估搞挂), 但**不假装写成功**.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/wp43-evaluation-engine.spec.ts 覆盖算分规则 + 落库 + 查询
//
//   时间戳: 2026-11-06

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository } from 'typeorm';

import { computeSessionEvaluation } from './evaluation-engine.js';
import type {
  SessionEvaluationDetailDto,
  SessionEvaluationListItemDto,
  SessionEvaluationListQueryDto,
  SessionEvaluationListResultDto,
} from './session-evaluation.dto.js';
import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import {
  SessionEvaluationRegistry,
  type SessionEvaluationSessionInput,
  type SessionEvaluationSink,
} from '../../voice/session-evaluation-slot.js';
import { SessionEvaluation } from '../entities/session-evaluation.entity.js';

/**
 * 评估服务 (算分结果的落库方 + 查询方).
 */
@Injectable()
export class SessionEvaluationService implements SessionEvaluationSink, OnModuleInit {
  /** 插槽实现标识 (注册表按名字去重). */
  readonly name = 'counselor-session-evaluation';

  private readonly logger = new Logger(SessionEvaluationService.name);

  constructor(
    @InjectRepository(SessionEvaluation) private readonly repo: Repository<SessionEvaluation>,
    private readonly registry: SessionEvaluationRegistry,
  ) {}

  /**
   * 注册到 voice 层插槽 (业务侧提供实现, 引擎侧只认插槽).
   */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 会话结束 → 算分并落库 (引擎侧收尾时调用).
   *
   * 两种"不落库"的口径 (都不是错误):
   *   · 一轮都没跑 → 没有事实 → 不写一条 0 分 (那会让人以为"这场表现极差");
   *   · 没有业务会话 id / 没有学员归属 → 挂不上训练会话 → 不落库.
   *
   * @param input 本场会话的评估输入
   */
  async finalize(input: SessionEvaluationSessionInput): Promise<void> {
    if (input.turns.length === 0) return;
    const dbSessionId = input.dbSessionId.trim();
    const userId = input.userId.trim();
    if (dbSessionId.length === 0 || userId.length === 0) return;

    const scores = computeSessionEvaluation(input.turns);
    const row = {
      sessionId: dbSessionId,
      userId,
      overallScore: scores.overall,
      technicalScores: scores.technical,
      bdiDeltaScores: scores.bdiDelta,
      ethicsScores: scores.ethics,
      rawStats: scores.raw,
    };
    const existing = await this.repo.findOne({ where: { sessionId: dbSessionId } });
    if (existing) {
      await this.repo.update({ id: existing.id }, row);
      this.logger.log(`[session_evaluation] 评估已覆盖写入 session=${dbSessionId} score=${scores.overall}`);
      return;
    }
    await this.repo.insert(row);
    this.logger.log(`[session_evaluation] 评估已落库 session=${dbSessionId} score=${scores.overall}`);
  }

  /**
   * 查某场会话的评估 (按**学员**归属查 —— 不是谁的评估谁看不到).
   *
   * @param userId 当前学员 id
   * @param sessionId 训练会话 id
   * @returns 评估详情; 没有 → 404
   * @throws BizException 评估不存在 (404)
   */
  async findBySession(userId: string, sessionId: string): Promise<SessionEvaluationDetailDto> {
    const row = await this.repo.findOne({ where: { sessionId, userId } });
    if (!row) {
      throw new BizException(BizCode.ResourceNotFound, '该训练会话暂无快速评估');
    }
    return {
      sessionId: row.sessionId,
      overallScore: row.overallScore,
      technical: row.technicalScores,
      bdiDelta: row.bdiDeltaScores,
      ethics: row.ethicsScores,
      rawStats: row.rawStats,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * 查我的评估列表 (按计算时间倒序, 分页).
   *
   * @param userId 当前学员 id
   * @param query 分页入参
   * @returns 列表 (分页信息 + 条目)
   */
  async listMine(userId: string, query: SessionEvaluationListQueryDto): Promise<SessionEvaluationListResultDto> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const [rows, total] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const items: SessionEvaluationListItemDto[] = rows.map((row) => ({
      sessionId: row.sessionId,
      overallScore: row.overallScore,
      safetyLabel: row.ethicsScores.label,
      crisisCount: row.ethicsScores.crisisCount,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, total, page, pageSize };
  }
}
