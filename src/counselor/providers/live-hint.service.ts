// V2026-10-21 治本 (V1.2 VS-C — 实时督导轻提示 service):
//   原因: v1.2 spec §6.1 实时督导提示有 4 条防依赖硬约束, 其中 2 条要在后端落地:
//     1) 提示只给方向, 禁止输出替代话术原文 → 生成侧 (prompt) + 校验侧 (长度/枚举) 保证
//     4) **同一类提示 5 分钟内不重复推送** (防抖) → 本 service 落地
//   修法: LiveSupervisionHintService 3 method:
//     - record  落库 + 防抖判定 + SSE 推送
//     - list    历史提示 (前端断线重连后补拉)
//     - stream  订阅该 session 的实时流 (SSE)
//   反双胞胎:
//     - 不在 service 里做 LLM 调用: 分析在 turn-analysis.service (一次调用同时产 hint + mark),
//       本 service 只负责"存 + 防抖 + 推"三件事
//     - 防抖 key 用 (sessionId + category) 而不是 (sessionId): 不同类别的提示互不干扰
//       (连续封闭式提问 + 自伤线索, 两类都要出)
//     - 防抖查 DB 不查内存: 多实例下内存态会失效, DB 是唯一真值源 (hint 表本来就存了)
//     - 落库失败不抛: 提示是"锦上添花", 推不出去不该让整个分析任务失败 → 记日志后继续
//   验证:
//     1. tsc 0 错
//     2. 大炮连触发 2 次同类提示 → 第 2 次被防抖拦下 (list 里只有 1 条)
//     3. 大炮开 SSE 流 + 触发 1 次分析 → 收到 live_hint 事件
//   时间戳: 2026-10-21

import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Observable } from 'rxjs';
import { IsNull, Repository } from 'typeorm';

import { SessionCoreEventsService } from './session-core-events.service';
import type { LiveTurnHint } from '../domain/session-core/session-core.types';
import { type LiveSupervisionHintDto } from '../dto/session-core.dto';
import { LiveSupervisionHint } from '../entities/live-supervision-hint.entity';
import { LiveSupervisionHintTier } from '../enums/live-supervision-hint-tier.enum';

/**
 * 同类提示的防抖窗口 (spec §6.1 硬约束 4: 5 分钟内不重复推送).
 */
export const HINT_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * 实时督导轻提示 service.
 */
@Injectable()
export class LiveSupervisionHintService {
  private readonly logger = new Logger(LiveSupervisionHintService.name);

  constructor(
    @InjectRepository(LiveSupervisionHint)
    private readonly hintRepo: Repository<LiveSupervisionHint>,
    private readonly events: SessionCoreEventsService,
  ) {}

  /**
   * 记录 1 条轻提示 (含防抖判定 + SSE 推送).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param turnIndex 触发轮次
   * @param hint 分析器产出的提示
   * @param tier 触发时的档位
   * @returns 实际落库的提示 (被防抖拦下时返回 null)
   */
  async record(
    userId: string,
    sessionId: string,
    turnIndex: number,
    hint: LiveTurnHint,
    tier: LiveSupervisionHintTier,
  ): Promise<LiveSupervisionHintDto | null> {
    const duplicated = await this.isDuplicated(sessionId, hint.category);
    if (duplicated) {
      this.logger.debug(`[hint_debounced] session=${sessionId} category=${hint.category} 5 分钟内已推过同类提示`);
      return null;
    }

    const saved = await this.hintRepo.save(
      this.hintRepo.create({
        tenantId: userId,
        userId,
        sessionId,
        turnIndex,
        category: hint.category,
        hintText: hint.hintText,
        tier,
        bookmarkId: null,
      }),
    );
    const dto = this.toDto(saved);
    this.events.publish(sessionId, { event: 'live_hint', data: dto });
    return dto;
  }

  /**
   * 查该 session 的历史提示 (按时间线升序).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   */
  async list(userId: string, sessionId: string): Promise<LiveSupervisionHintDto[]> {
    const rows = await this.hintRepo.find({
      where: { sessionId, userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * 订阅该 session 的实时提示流 (SSE).
   *
   * @param sessionId 会话 id
   */
  stream(sessionId: string): Observable<MessageEvent> {
    return this.events.subscribe(sessionId);
  }

  /**
   * 防抖判定: 同 session 同 category 在窗口内是否已推过.
   *
   * @param sessionId 会话 id
   * @param category 命中规则类别
   */
  private async isDuplicated(sessionId: string, category: string): Promise<boolean> {
    const threshold = new Date(Date.now() - HINT_DEBOUNCE_MS);
    const recent = await this.hintRepo.findOne({
      where: {
        sessionId,
        category,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
    if (!recent) {
      return false;
    }
    return recent.createdAt.getTime() >= threshold.getTime();
  }

  /**
   * entity → DTO.
   *
   * @param row live_supervision_hints 表行
   */
  private toDto(row: LiveSupervisionHint): LiveSupervisionHintDto {
    return {
      id: row.id,
      sessionId: row.sessionId,
      turnIndex: row.turnIndex,
      category: row.category,
      hintText: row.hintText,
      tier: row.tier,
      createdAt: row.createdAt,
    };
  }
}
