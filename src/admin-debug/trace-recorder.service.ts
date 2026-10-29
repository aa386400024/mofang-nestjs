// V2026-10-29 (WP19 · 每轮 BDI 快照留痕):
//   职责: 内存缓冲每轮调试快照, 会话关闭时 flush 到 training_sessions.turn_debug_trace.
//   边界: 纯内存服务, 不查 DB (写路径); 读路径由 AdminDebugController 直接查 DB.
//
//   为什么内存缓冲而不是每轮写 DB:
//     调试快照是观测数据, 不是业务数据. 每轮写一次 DB = 每场 3 轮 × 2 次写,
//     对主链路是无谓的 IO 开销. 内存缓冲 + 关闭时一次写 = 主链路零额外查询.
//     代价: 进程崩溃丢失未 flush 的 trace —— 调试场景可接受.
//
//   反双胞胎:
//     - 不查 DB: 本服务只写, 不读. 读走 AdminDebugController 的 repository.
//     - 不做事件总线: 直接注入 EngineStreamBackend, 它在每轮完成后调 record().
//     - 不持久化到 Redis: 调试器是本地工具, 不需要跨进程.

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TrainingSession } from '../counselor/entities/training-session.entity';

/** 单轮调试快照 (与前端 admin-dashboard types.ts TurnTrace 对齐). */
export interface TurnTrace {
  readonly turnIndex: number;
  readonly bdi: {
    readonly trust: number;
    readonly valence: number;
    readonly arousal: number;
    readonly resistance: number;
    readonly attachmentType: string;
  };
  readonly usage: {
    readonly completionTokens: number;
    readonly reasoningTokens: number;
    readonly totalTokens: number;
  };
  readonly crisis: {
    readonly detected: boolean;
    readonly category: string | null;
  };
  readonly ts: string;
}

@Injectable()
export class TraceRecorder {
  private readonly logger = new Logger(TraceRecorder.name);
  /** dbSessionId → 本轮会话累积的 trace 数组. */
  private readonly buffer = new Map<string, TurnTrace[]>();

  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
  ) {}

  /**
   * 记录一轮快照 (会话进行中, 只写内存).
   *
   * @param dbSessionId 稳定落库 id (training_sessions.id)
   * @param trace 本轮快照
   */
  record(dbSessionId: string, trace: TurnTrace): void {
    const list = this.buffer.get(dbSessionId) ?? [];
    list.push(trace);
    this.buffer.set(dbSessionId, list);
  }

  /**
   * 会话关闭时 flush: 把缓冲的 trace 数组写回 training_sessions.turn_debug_trace.
   *
   * 失败不抛 (调试数据写不进去不该影响主链路), 只 warn.
   *
   * @param dbSessionId 稳定落库 id
   */
  async flush(dbSessionId: string): Promise<void> {
    const traces = this.buffer.get(dbSessionId);
    if (!traces || traces.length === 0) return;
    try {
      await this.sessionRepo.update({ id: dbSessionId }, { turnDebugTrace: traces });
      this.buffer.delete(dbSessionId);
      this.logger.log(`[trace_flush] session=${dbSessionId} turns=${traces.length}`);
    } catch (error) {
      this.logger.warn(`[trace_flush_failed] session=${dbSessionId} err=${String(error)}`);
    }
  }

  /** 丢弃缓冲 (会话异常关闭, 不需要 flush). */
  discard(dbSessionId: string): void {
    this.buffer.delete(dbSessionId);
  }
}
