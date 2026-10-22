// V2026-10-21 治本 (V1.2 VS-C — 会谈核心实时事件总线 (SSE)):
//   原因: v1.2 §6.1 实时督导轻提示「前端通过 SSE / WebSocket 拉取」—— counselor 端**目前 0 实时通道**
//     (现成只有 src/voice/voice.gateway.ts 的 WS /voice/training 与 src/ai-engine 的 @Sse('completions')).
//     选 SSE 而不是 WS 的理由 (已在 v1.2 排期 §4 拍板):
//       1) 轻提示是**单向**推送 → SSE 正是这个语义, 不需要双向协议
//       2) 复用既有 REST 鉴权 (@UseGuards(JwtAuthGuard) + Bearer header), 不必再写一遍 WS 握手鉴权
//       3) 前端已有现成解析范式 (xin_su_app lib/features/ai_engine/data/llm/llm_client.dart
//          用 http.Request + text/event-stream 手动解析) → 0 新依赖
//       4) 走 WS 的话要么把 hint 塞进 voice WS (造成 voice → counselor 的反向依赖,
//          违反 voice.module.ts "不在 VoiceModule 里 import 业务模块" 的既有原则),
//          要么新开一个 WS 网关 + 前端再连第 2 条连接
//   修法: 本 service 是 counselor 端唯一的会话级事件总线:
//     - publish(sessionId, event): 把事件推给该 session 的所有订阅者
//     - subscribe(sessionId): 返回 Observable<MessageEvent>, 供 controller 的 @Sse() 包一层
//   反双胞胎:
//     - 不用 WebSocket: 见上面 4 条理由; 且 WS 要处理重连/心跳/背压, SSE 这些都由浏览器/客户端兜住
//     - 不用 Redis Pub/Sub: 当前是**单实例**部署 (跟 src/agent/visitor/visitor.service.ts 的
//       内存 session memory 同款取舍). 多实例部署时 hint 只会推到连在本实例的客户端 →
//       已在下面标注升级点, 不假装现在就是分布式安全的
//     - 不用 Nest 的 EventEmitter 全局广播: 需要**按 session 精确路由**, 全局广播会串会话
//       (A 会话的提示推给 B 会话的用户 = 严重隐私事故)
//   验证:
//     1. tsc 0 错
//     2. 大炮开 GET /counselor/training-sessions/:id/hints/stream, 另一端触发一轮分析 → 收到事件
//     3. 两个不同 session 同时订阅 → 互不串台
//   时间戳: 2026-10-21

import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import type { LiveSupervisionHintDto, TransferenceMarkDto } from '../dto/session-core.dto';
import type { CaseProfileEntryDto } from '../dto/visitor-persona.dto';

/**
 * 会谈核心实时事件 (SSE event 名 + 载荷).
 *
 * 用 SSE 的 `event:` 字段做事件名, 前端按名分派 —— 比在 data 里塞一个 type 字段更标准,
 * 且 EventSource / 手动解析都能直接用.
 */
export type SessionCoreEvent =
  | { readonly event: 'live_hint'; readonly data: LiveSupervisionHintDto }
  | { readonly event: 'transference_mark'; readonly data: TransferenceMarkDto }
  // V2026-10-21 治本 (V1.2 VS-B2 — 档案新解锁事件):
  //   原因: 每轮抽出的新披露要能实时推给前端, 卷宗页才能做"新解锁"动效 (spec §4.2 视图 B).
  | { readonly event: 'profile_entry'; readonly data: CaseProfileEntryDto };

/**
 * 会谈核心事件总线 (进程内).
 *
 * **单实例前提**: 多实例部署时, 事件只推给连在本实例的客户端. 升级路径 = 换 Redis Pub/Sub
 * (仓库已有 RedisService, 但当前无任何 pub/sub 频道, 属独立改造范围).
 */
@Injectable()
export class SessionCoreEventsService {
  private readonly logger = new Logger(SessionCoreEventsService.name);
  /** sessionId → 订阅者 Subject. */
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  /**
   * 推送 1 个事件给该 session 的所有订阅者.
   *
   * @param sessionId 会话 id
   * @param event 事件
   */
  publish(sessionId: string, event: SessionCoreEvent): void {
    const subject = this.subjects.get(sessionId);
    if (!subject) {
      // 没有订阅者 = 前端没开这个流 (或已经断开) → 不报错, 静默丢弃.
      // 事件本身已经落库, 前端可以用 GET /hints 补拉, 不依赖实时通道做数据完整性.
      this.logger.debug(`[publish_dropped] session=${sessionId} event=${event.event} 无订阅者`);
      return;
    }
    subject.next({ type: event.event, data: event.data });
  }

  /**
   * 订阅某 session 的事件流.
   *
   * @param sessionId 会话 id
   * @returns SSE 事件流 (断开时自动清理 Subject)
   */
  subscribe(sessionId: string): Observable<MessageEvent> {
    const subject = this.subjectOf(sessionId);
    return new Observable<MessageEvent>((subscriber) => {
      const subscription = subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        this.cleanupIfIdle(sessionId, subject);
      };
    });
  }

  /**
   * 取 (或建) 某 session 的 Subject.
   *
   * @param sessionId 会话 id
   */
  private subjectOf(sessionId: string): Subject<MessageEvent> {
    const existing = this.subjects.get(sessionId);
    if (existing) {
      return existing;
    }
    const created = new Subject<MessageEvent>();
    this.subjects.set(sessionId, created);
    return created;
  }

  /**
   * 最后一个订阅者断开时清掉 Subject (防内存泄漏: 会话数会随训练次数增长).
   *
   * @param sessionId 会话 id
   * @param subject 该 session 的 Subject
   */
  private cleanupIfIdle(sessionId: string, subject: Subject<MessageEvent>): void {
    if (subject.observed) {
      return;
    }
    subject.complete();
    this.subjects.delete(sessionId);
  }
}
