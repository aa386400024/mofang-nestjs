// V2026-10-26 治本 (vpt WS 帧出口注册表 — 依赖倒置, spec 任务 2 / 任务 4):
//   原因: 实时督导轻提示 (任务 2) 与移情/阻抗标记 (任务 4) 要**经 vpt 的 WS 连接**推给前端,
//     但这两段逻辑产在 counselor 侧 (turn-analysis BullMQ worker → live-hint / mark service),
//     而 WS 连接在 voice (agent) 侧 —— 又是 agent ↔ business 的方向问题.
//   修法: 与 `voice-session-bridge.ts` 同一套范式, 反向再开一个口子:
//     - voice 侧声明"我这里有一个能接收帧的出口"这个注册表 (VoiceFrameRegistry)
//     - voice 侧网关在建连成功时登记自己的 sink (按**稳定落库 id** 登记)
//     - counselor 侧产完提示/标记后调 `publish(dbSessionId, frame)` → 找到 sink → 下发
//   为什么按**落库 id** 而不是 WS 会话 id 登记:
//     产出提示/标记的是 BullMQ worker, 它只知道 training_sessions.id (逐字稿在库里);
//     WS 会话 id 是客户端给的内存 id, worker 侧根本无从得知. 用落库 id 登记, 两端才说得通.
//   反双胞胎:
//     - 不让 counselor 直接持有 socket: socket 归 voice 侧管 (连接生命周期 / 鉴权 / 关闭),
//       跨模块摸 socket 会让两边的生命周期互相牵制
//     - 不用事件总线全局广播: 必须**按会话精确路由** —— A 会话的提示推给 B 会话的用户
//       是严重隐私事故 (仓库既有 SSE 总线 `SessionCoreEventsService` 也是这个口径)
//     - 不用 Redis Pub/Sub: 当前单实例部署 (跟仓库既有 SSE 总线同款取舍); 多实例时
//       只有连在本实例的客户端收得到, 升级路径是换 Pub/Sub (仓库当前无 pub/sub 频道)
//   验证:
//     1. tsc 0 错
//     2. vpt 建连后, 命中规则的轻提示经 WS `supervision_hint` 帧下发
//     3. 非 vpt 会话 (普通 training_session) 不会收到 WS 帧 (没登记 sink)
//   时间戳: 2026-10-26

import { Injectable, Logger } from '@nestjs/common';

import type { VoiceServerMessage } from './voice.types';

/**
 * 帧出口 (网关把自己的 socket 包装成这个函数登记进来).
 */
export type VoiceFrameSink = (frame: VoiceServerMessage) => void;

/**
 * vpt WS 帧出口注册表 (@Global).
 */
@Injectable()
export class VoiceFrameRegistry {
  private readonly logger = new Logger(VoiceFrameRegistry.name);
  /** 稳定落库 id → 帧出口. */
  private readonly sinks = new Map<string, VoiceFrameSink>();

  /**
   * 登记一个帧出口.
   *
   * @param sessionId 稳定落库 id (training_sessions.id)
   * @param sink 帧出口
   * @returns 注销函数 (连接断开时调用)
   */
  register(sessionId: string, sink: VoiceFrameSink): () => void {
    this.sinks.set(sessionId, sink);
    this.logger.log(`[registered] voice frame sink session=${sessionId}`);
    return () => {
      this.unregister(sessionId);
    };
  }

  /**
   * 注销一个帧出口 (连接断开时调用).
   *
   * @param sessionId 稳定落库 id
   */
  unregister(sessionId: string): void {
    if (this.sinks.delete(sessionId)) {
      this.logger.log(`[unregistered] voice frame sink session=${sessionId}`);
    }
  }

  /**
   * 推一帧给该会话的 WS 连接.
   *
   * 没有登记 = 这个会话不是 vpt (或连接已断) → 静默丢弃, 不报错.
   *
   * @param sessionId 稳定落库 id
   * @param frame 帧
   * @returns true = 已下发; false = 无出口 (丢弃)
   */
  publish(sessionId: string, frame: VoiceServerMessage): boolean {
    const sink = this.sinks.get(sessionId);
    if (!sink) {
      this.logger.debug(`[publish_dropped] session=${sessionId} frame=${frame.type} 无 WS 出口`);
      return false;
    }
    try {
      sink(frame);
      return true;
    } catch (error) {
      this.logger.warn(
        `[publish_failed] session=${sessionId} frame=${frame.type} ` + `err=${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** 当前登记的出口数 (诊断用). */
  size(): number {
    return this.sinks.size;
  }
}
