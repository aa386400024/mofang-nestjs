// V2026-10-21 治本 (V1.2 VS-C — M3.4 双向移情/阻抗标记 service):
//   原因: v1.2 spec §6.4 双向移情/阻抗标记系统 —— 两类来源:
//     - AI 自动标记 (来访侧): 由每轮分析器产出, 本 service 提供 appendVisitorMark 落库
//     - 咨询师手动标记 (反移情侧): 会谈中用户点「反移情觉察」+ 简短备注, 走 create
//     两侧标记要能在同一条时间线上看, 且长程卷宗要按 sessionNumber 聚合出趋势图.
//   修法: TransferenceMarkService 3 method:
//     - create            咨询师手动标记 (direction 固定 counselor_manual)
//     - appendVisitorMark AI 自动标记 (direction 固定 visitor_auto)
//     - list              查该 session 的全部标记 (按时间线升序)
//   反双胞胎:
//     - **方向由调用入口决定, 不接受请求方指定**: 跟 case_profile_entries 的 layer 同款 ——
//       前端若能传 visitor_auto, 就等于用户能伪造"AI 判定来访者有阻抗"; 两层语义必须可信
//     - 不拆 2 张表: 两侧字段结构一样, 拆表会让"按时间线看全部标记"变成 UNION
//     - 不用 markedBy 自由字符串: 会漏拼写, 且没法按方向做索引/统计 (趋势图要按方向聚合)
//     - 手动标记的 note 不强制非空: spec §6.4 说"简短备注", 但强制非空会让用户被卡在弹窗里;
//       备注缺失不降低标记本身的教学价值
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST 手动标记 → GET 能查到, direction=counselor_manual
//   时间戳: 2026-10-21

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { type CreateTransferenceMarkDto, type TransferenceMarkDto } from '../dto/session-core.dto';
import { TrainingSession } from '../entities/training-session.entity';
import { TransferenceResistanceMark } from '../entities/transference-resistance-mark.entity';
import { TransferenceMarkDirection } from '../enums/transference-mark.enum';

/**
 * 双向移情/阻抗标记 service.
 */
@Injectable()
export class TransferenceMarkService {
  constructor(
    @InjectRepository(TransferenceResistanceMark)
    private readonly markRepo: Repository<TransferenceResistanceMark>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
  ) {}

  /**
   * 咨询师手动标记 (反移情侧).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 标记内容
   * @returns 新建的标记
   */
  async create(userId: string, sessionId: string, input: CreateTransferenceMarkDto): Promise<TransferenceMarkDto> {
    return this.save(userId, sessionId, input, TransferenceMarkDirection.COUNSELOR_MANUAL);
  }

  /**
   * AI 自动标记 (来访侧) —— 由每轮分析器调用.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param turnIndex 轮次
   * @param markType 标记类型
   * @param note 备注
   * @returns 新建的标记
   */
  async appendVisitorMark(
    userId: string,
    sessionId: string,
    turnIndex: number,
    markType: TransferenceMarkDto['markType'],
    note: string,
  ): Promise<TransferenceMarkDto> {
    return this.save(userId, sessionId, { turnIndex, markType, note }, TransferenceMarkDirection.VISITOR_AUTO);
  }

  /**
   * 查该 session 的全部标记 (按时间线升序).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   */
  async list(userId: string, sessionId: string): Promise<TransferenceMarkDto[]> {
    const rows = await this.markRepo.find({
      where: { sessionId, userId, deletedAt: IsNull() },
      order: { turnIndex: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * 落库 (两个入口共用).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 标记内容
   * @param direction 方向 (由入口决定)
   */
  private async save(
    userId: string,
    sessionId: string,
    input: { turnIndex: number; markType: TransferenceMarkDto['markType']; note?: string | undefined },
    direction: TransferenceMarkDirection,
  ): Promise<TransferenceMarkDto> {
    const session = await this.assertSessionOwned(userId, sessionId);
    const saved = await this.markRepo.save(
      this.markRepo.create({
        tenantId: session.tenantId,
        userId,
        sessionId,
        turnIndex: input.turnIndex,
        direction,
        markType: input.markType,
        note: input.note ?? null,
      }),
    );
    return this.toDto(saved);
  }

  /**
   * 校验会话归属 (跨用户访问检测).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  private async assertSessionOwned(userId: string, sessionId: string): Promise<TrainingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, deletedAt: IsNull() },
    });
    if (!session) {
      throw new NotFoundException(`训练会话 ${sessionId} 不存在或不属于当前用户`);
    }
    return session;
  }

  /**
   * entity → DTO.
   *
   * @param row transference_resistance_marks 表行
   */
  private toDto(row: TransferenceResistanceMark): TransferenceMarkDto {
    return {
      id: row.id,
      sessionId: row.sessionId,
      turnIndex: row.turnIndex,
      direction: row.direction,
      markType: row.markType,
      note: row.note,
      createdAt: row.createdAt,
    };
  }
}
