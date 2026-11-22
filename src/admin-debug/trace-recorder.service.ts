// V2026-10-29 (WP19 · 每轮 BDI 快照留痕):
//   职责: 记录每轮调试快照, 落 training_sessions.turn_debug_trace.
//   边界: 纯内存缓冲 + 写路径; 不查 DB (读路径由 AdminDebugController 直接查 DB).
//
//   V2026-10-30 治本 (WP19-R · 留痕链接通):
//   职责: 把"已声明但从未真正落库"的留痕链接上 —— 每轮 turn 结束即落库,
//         并把快照 JSON 契约改成 WP19 原单 §1.1 的**逐字**形状.
//   边界: 只做「缓冲 → 落库」; 失败只打 error 日志, **绝不**抛给对练主链路.
//
//   为什么改成"每轮落库"而不是"会话关闭时一次性 flush":
//     WP19 原本的设计是"内存缓冲 + closeSession 时一次写" —— 但对练中途断线 /
//     进程重启时, 缓冲里的快照**全丢**, 于是"每轮 BDI 快照落库"这件事实际上
//     一次都没发生过 (turn_debug_trace 恒空, 见 code-vs-blueprint-audit §4.1 D1).
//     调试数据的作用就是"出事那一刻能看见" —— 留到关会话才写, 恰恰写不到
//     最需要它的那一次. 所以改成: 每轮 turn 结束立刻把**累积数组**写回本列
//     (1 轮 1 次 UPDATE, 不新增表不新增列), 关会话时再 flush 一次收尾.
//
//   为什么写失败只打 error 日志 (不抛):
//     留痕是**观测**能力, 不是业务能力. 让它炸链 = 调试器反过来把对练搞挂 ——
//     那比"这一轮没留痕"严重得多. 语义与仓库既有降级口径一致 (记忆写失败 /
//     逐字稿写失败都不阻断会话).
//
//   快照 JSON 契约 (WP19 原单 §1.1, 逐字沿用 —— 已被 WP24 / 报告页依赖):
//     {
//       "turnIndex": 3,
//       "characterSlug": "vpt_intimate_avoidance_l1",
//       "bdiSnapshot": { "trust", "valence", "arousal", "resistance", "anxiousSecure" },
//       "renderSpec": { "taskKind", "promptPreview", "maxCompletionTokens", "reasoningEffort" },
//       "llmUsage": { "promptTokens", "completionTokens", "reasoningTokens", "ttftMs", "finishReason" },
//       "crisis": { "detected", "category" },
//       "ts": "2026-10-29T14:30:00.000Z"
//     }
//
//   V2026-11-05 治本 (WP30 · 快照契约补 trajectoryTrace):
//     契约**追加**一个可选字段 `trajectoryTrace` (内核 `TrajectoryTrace` 透传).
//     为什么: 调试器的"剧本轨迹"面板要的是"这场走到第几幕", 而留痕里没有这一项 ——
//     端点写得再准也只能返回空. 追加而非替换: 老会话读出来没有这一项 = 老数据,
//     不影响既有字段的读法.
//     反双胞胎: 不新造一份轨迹 DTO —— 直接透传内核出参, 适配层不改它的形状.
//
//   反双胞胎:
//     - 不加新表 / 不加新列: 沿用 training_sessions.turn_debug_trace (JSON 列, WP19 已建).
//     - 不存完整 system prompt / 完整逐字稿 / 音频: system 只留前 500 字预览.
//     - 不做"缓冲 + 关会话写"与"每轮写"两套口径: 只有一条写路径 (每轮写),
//       关会话的 flush 只是**同一写路径的收尾** (把最后一轮补齐).
//     - 不静默吞写库失败: 失败打 error 日志 (可被日志检索到), 但不炸链.
//
//   开关 (WP19 原单 §1.1): env `ENGINE_DEBUG_TRACE_ENABLED`
//     · 显式配了 → 按配的来 (true/1 开, false/0 关);
//     · 没配 → dev 缺省开, prod 缺省关.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/admin-debug/wp19r-trace-wiring.spec.ts 覆盖落库 / 失败不炸链 / 开关

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import type { TrajectoryTrace } from '../engine-core/index.js';

/**
 * 单轮调试快照 (WP19 原单 §1.1 契约, 逐字沿用).
 *
 * 为什么字段名这么"业务": 它是**对外契约** —— 调试器 SPA 与报告页都按这份形状读,
 * 改字段名 = 改契约. 所以本单只补齐字段, 不改名.
 */
export interface TurnTrace {
  /** 本轮序号 (内核累计轮次). */
  readonly turnIndex: number;
  /** 本场角色 key (`vpt_*` slug; 无角色时是中性基线 id). */
  readonly characterSlug: string;
  /** 本轮 BDI 快照 (四值 + 情绪标签). */
  readonly bdiSnapshot: {
    readonly trust: number;
    readonly valence: number;
    readonly arousal: number;
    readonly resistance: number;
    readonly anxiousSecure: string;
  };
  /** 本轮渲染规格摘要 (prompt 只留前 500 字预览). */
  readonly renderSpec: {
    readonly taskKind: string;
    readonly promptPreview: string;
    readonly maxCompletionTokens: number;
    readonly reasoningEffort: string;
  };
  /** 本轮模型用量. */
  readonly llmUsage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly reasoningTokens: number;
    readonly ttftMs: number;
    readonly finishReason: string;
  };
  /** 本轮危机判定. */
  readonly crisis: {
    readonly detected: boolean;
    readonly category: string | null;
  };
  /**
   * 本轮轨迹观测 (内核 `TrajectoryTrace` 透传).
   *
   * V2026-11-05 治本 (WP30 · 调试器要能看见剧本走到哪):
   *   为什么是**可选**: 没有注入剧本的会话 (BDI 自由运行) 本轮就没有轨迹观测块,
   *   字段整个不出现 —— 与既有 `renderSpec` / `llmUsage` 的"没有就不带"口径一致.
   *   为什么**不改名也不改位**: 快照 JSON 契约 (WP19 原单 §1.1) 是对外契约,
   *   调试器 SPA 与报告页都按这份形状读; 本字段是**追加**的可选项,
   *   老会话的留痕是在它加进来之前落的 → 读出来没有这一项 = "这场没剧本 / 老数据".
   *
   * 落这一项之前, 调试器的"剧本轨迹"面板**永远空着** —— 留痕里根本没有轨迹数据,
   *   端点再准也取不到东西 (WP30 §偏差 B1).
   */
  readonly trajectoryTrace?: TrajectoryTrace;
  /** 落库时刻 (ISO). */
  readonly ts: string;
}

/**
 * 调试快照记录器 (WP19-R: 每轮落库 + 失败不炸链).
 */
@Injectable()
export class TraceRecorder {
  private readonly logger = new Logger(TraceRecorder.name);
  /** dbSessionId → 本场累积的 trace 数组. */
  private readonly buffer = new Map<string, TurnTrace[]>();
  /** dbSessionId → 该场串行写链 (保证多轮写入不乱序: 后写的不能被先写的盖掉). */
  private readonly writes = new Map<string, Promise<void>>();
  /** 留痕开关 (env `ENGINE_DEBUG_TRACE_ENABLED`; dev 缺省开 / prod 缺省关). */
  private readonly enabled: boolean;

  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    config: ConfigService,
  ) {
    this.enabled = resolveTraceEnabled(config);
    if (!this.enabled) {
      this.logger.warn('[trace] 留痕开关关闭 (ENGINE_DEBUG_TRACE_ENABLED), 本场不落调试快照');
    }
  }

  /**
   * 记录一轮快照: 进内存缓冲 + **立刻落库**.
   *
   * 落库是 fire-and-forget (返回的 promise 只用于测试等待): 主链路不等 IO.
   *
   * 失败语义: 写库异常只打 error 日志, **不抛** —— 留痕炸链比不留痕更糟.
   *
   * @param dbSessionId 稳定落库 id (training_sessions.id)
   * @param trace 本轮快照
   * @returns 落库完成信号 (永不 reject)
   */
  record(dbSessionId: string, trace: TurnTrace): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const list = this.buffer.get(dbSessionId) ?? [];
    list.push(trace);
    this.buffer.set(dbSessionId, list);
    return this.enqueueWrite(dbSessionId);
  }

  /**
   * 会话关闭时收尾: 把缓冲的 trace 数组写回 training_sessions.turn_debug_trace.
   *
   * 失败不抛 (调试数据写不进去不该影响主链路), 只打 error 日志.
   *
   * @param dbSessionId 稳定落库 id
   */
  async flush(dbSessionId: string): Promise<void> {
    await this.enqueueWrite(dbSessionId);
    this.buffer.delete(dbSessionId);
    this.writes.delete(dbSessionId);
  }

  /** 丢弃缓冲 (会话异常关闭, 不需要 flush). */
  discard(dbSessionId: string): void {
    this.buffer.delete(dbSessionId);
    this.writes.delete(dbSessionId);
  }

  /**
   * 串行写链: 同一场的多次写按调用顺序排队.
   *
   * 为什么必须串行: 每轮都写"累积数组", 若两次写并发, 先发起的写可能后落地 ——
   * 于是**轮次少的旧数组覆盖轮次多的新数组**, 库里就少了几轮快照, 而日志里
   * 两次都写着"已落库". 串行化是这条链路唯一正确的顺序保证.
   *
   * @param dbSessionId 稳定落库 id
   * @returns 写完成信号 (永不 reject)
   */
  private enqueueWrite(dbSessionId: string): Promise<void> {
    const previous = this.writes.get(dbSessionId) ?? Promise.resolve();
    const next = previous.then(() => this.persist(dbSessionId));
    this.writes.set(dbSessionId, next);
    return next;
  }

  /**
   * 把当前累积数组写回本列 (失败只打 error 日志).
   *
   * @param dbSessionId 稳定落库 id
   */
  private async persist(dbSessionId: string): Promise<void> {
    const traces = this.buffer.get(dbSessionId);
    if (!traces || traces.length === 0) return;
    try {
      // 拷贝一份再写: 避免把"还在被 push 的活数组"交给驱动层序列化.
      await this.sessionRepo.update({ id: dbSessionId }, { turnDebugTrace: [...traces] });
      this.logger.log(`[trace_persist] session=${dbSessionId} turns=${traces.length}`);
    } catch (error) {
      // 只打 error 日志 —— 调试器不能反过来把对练搞挂 (见文件头).
      this.logger.error(`[trace_persist_failed] session=${dbSessionId} err=${String(error)}`);
    }
  }
}

/**
 * 留痕开关解析 (env `ENGINE_DEBUG_TRACE_ENABLED`).
 *
 * 口径 (WP19 原单 §1.1): 显式配了按配的来; 没配则 dev 开 / prod 关.
 *
 * @param config 配置服务
 * @returns 是否落调试快照
 */
export function resolveTraceEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('ENGINE_DEBUG_TRACE_ENABLED') ?? '').trim().toLowerCase();
  if (raw.length > 0) return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  const env = (config.get<string>('NODE_ENV') ?? '').trim().toLowerCase();
  return env !== 'production' && env !== 'prod';
}
