// V2026-10-29 治本 (WP8-B · B 层 · 引擎 → voice 对话后端适配):
//   职责: 实现 voice 侧的窄接口 `VoiceTurnBackend` —— 把新引擎的"决策 → 流式渲染"
//         翻译成语音链路熟悉的三态 chunk (content / done / error), 并维护
//         逐字稿副本 (供督导报告).
//   边界: 装配层 (src/engine-adapters/wiring/); 只做**翻译与记账**, 不写决策、
//         不拼 prompt、不碰 TTS/ASR/帧协议.
//
//   为什么这个适配器住在 wiring 而不是 rendering:
//     它依赖 `EngineTurnService` (wiring 层的东西), 而 wiring 又依赖 rendering ——
//     若把适配器放在 rendering, 就成了 rendering → wiring → rendering 的**目录环**.
//     它的职责本来就是"装配": 把一个子系统 (引擎) 的形状翻译成另一个子系统
//     (语音) 的形状, 这正是 wiring 层的定义.
//
//   为什么"翻译点只有一处":
//     语音消费器 (`VoiceService.consumeLlmStream`) 只认三态 chunk, 且**零改动**
//     (成熟资产). 于是所有"引擎语义 → 语音语义"的转换必须收敛在本文件:
//       增量文本 → content chunk;
//       本轮结束 → done chunk (带 usage);
//       引擎侧失败 → error chunk (带 code / message / retryable).
//     若在 voice 层里写"如果是新引擎就怎样", 语音层就得知道引擎的内部语义 ——
//     那是把两个子系统的知识搅在一起, 灰度一关就全是死代码.
//
//   为什么"降级兜底句"也要出声 (而不是静默 done):
//     任务单 §2.4 要求全挂时"仍正常返回收尾结果, 让上层能发 done, TTS 不悬挂".
//     若降级时一个字都不吐, 前端会看到"开始了 → 结束了, 但没有任何话", 用户
//     以为程序卡了. 兜底句本身就是为这一刻准备的 (中性、不越界).
//
//   反双胞胎:
//     - 不在 voice 层判断"这是不是新引擎": 本文件已经把一切翻译成三态 chunk,
//       voice 层拿到的两条链路**形状完全一样**, 于是"选哪条"只剩灰度开关一个决定.
//     - 不自己写逐字稿格式: 直接复用 `TranscriptTurn` (agent/supervisor 的既有类型),
//       督导报告那条链路的解析口径不用改.
//     - 不在失败时把半句写进逐字稿: 与旧链路对齐 —— 旧链路在早退时回滚 user 消息,
//       净效果是"这一轮不落逐字稿". 这里只在整轮成功时落, 语义一致.
//     - 不吞引擎侧的内核错误: 内核错误 (SESSION_NOT_FOUND / ABORTED) 转成 error chunk
//       交给既有消费器处理, 与旧链路"LLM 流错误 → error 帧"同形.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp8b-grayscale.spec.ts 覆盖 delta → content / 结束 → done / 失败 → error

import { Injectable, Logger } from '@nestjs/common';

import type { EngineTurnService } from './engine-turn.service';
import type { LlmStream, LlmStreamChunk } from '../../agent/llm/llm.types';
import type { TranscriptTurn } from '../../agent/supervisor/supervisor.types';
import type {
  VoiceTurnBackend,
  VoiceTurnBackendCloseResult,
  VoiceTurnBackendOpenOptions,
  VoiceTurnBackendTurnOptions,
} from '../../voice/voice-turn-backend.port';
import type { VoiceSessionPersona } from '../../voice/voice.types';

/**
 * 中性基线来访者身份 (WP8-B: 角色剧本注入归 WP9).
 *
 * 为什么是中性基线而不是"读 persona 实体":
 *   本期只要求"新引擎能跑通一条链路", 角色资产 (5Ps / 难度 / 情绪基线) 的解析
 *   与注入归 WP9. 这里给一个**不越界**的中性身份: 它不承诺任何角色特征,
 *   也不伪造一个看起来很像角色的假身份 (那会让报告里的人名与真实设定对不上).
 */
const NEUTRAL_PERSONA: VoiceSessionPersona = {
  id: 'voice_visitor',
  name: '来访者',
  voiceId: '',
  difficulty: 'L1',
};

/**
 * 引擎版对话后端 (实现 voice 侧窄接口).
 */
@Injectable()
export class EngineStreamBackend implements VoiceTurnBackend {
  private readonly logger = new Logger(EngineStreamBackend.name);
  /** 语音会话 id → 内核句柄 id. */
  private readonly handles = new Map<string, string>();
  /** 语音会话 id → 逐字稿 (一问一答两条). */
  private readonly transcripts = new Map<string, TranscriptTurn[]>();

  constructor(private readonly engine: EngineTurnService) {}

  /**
   * 开场: 内核开会话 (中性基线, 不塞剧本).
   *
   * 重复开会话 → 先关掉旧句柄再开新的 (与旧 visitor "覆盖 memory" 的行为对齐;
   * 不对齐的话, 第二条 `user_text` 之前的一次 startSession 重连就会撞上
   * `SESSION_ALREADY_OPEN`, 而那本该是无感的重连).
   */
  async openSession(opts: VoiceTurnBackendOpenOptions): Promise<VoiceSessionPersona> {
    const previous = this.handles.get(opts.sessionId);
    if (previous) {
      this.handles.delete(opts.sessionId);
      this.engine.close(previous);
    }

    const trimmed = opts.personaId?.trim() ?? '';
    const visitorId = trimmed.length > 0 ? trimmed : NEUTRAL_PERSONA.id;
    const handle = this.engine.open({
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      visitorId,
    });
    this.handles.set(opts.sessionId, handle.handleId);
    this.transcripts.set(opts.sessionId, []);
    this.logger.log(`[openSession] session=${opts.sessionId} handle=${handle.handleId} visitor=${visitorId}`);
    return { ...NEUTRAL_PERSONA, id: visitorId };
  }

  /**
   * 一轮: 把引擎的流式渲染翻译成三态 chunk.
   */
  async streamTurn(opts: VoiceTurnBackendTurnOptions): Promise<{ readonly stream: LlmStream }> {
    const handleId = this.handles.get(opts.sessionId);
    if (!handleId) {
      // 会话没开 → 直接抛 (调用方负责回落旧链路); 静默返回一个空流会让上层
      // 以为"这一轮正常结束但没话说", 那是最难排查的一种坏.
      throw new Error(`EngineStreamBackend.streamTurn: sessionId=${opts.sessionId} 未开启`);
    }
    return { stream: this.buildStream(handleId, opts) };
  }

  /**
   * 收尾: 关内核句柄 + 清逐字稿, 返回本场统计.
   */
  closeSession(sessionId: string): VoiceTurnBackendCloseResult {
    const turns = this.transcripts.get(sessionId) ?? [];
    const result: VoiceTurnBackendCloseResult = {
      finalTurnCount: turns.filter((turn) => turn.role === 'assistant').length,
      finalMessageCount: turns.length,
    };
    this.transcripts.delete(sessionId);
    const handleId = this.handles.get(sessionId);
    if (handleId) {
      this.handles.delete(sessionId);
      this.engine.close(handleId);
    }
    this.logger.log(`[closeSession] session=${sessionId} turns=${result.finalTurnCount} msgs=${result.finalMessageCount}`);
    return result;
  }

  /**
   * 逐字稿副本 (督导报告用).
   */
  transcript(sessionId: string): readonly TranscriptTurn[] {
    return this.transcripts.get(sessionId) ?? [];
  }

  /**
   * 引擎流 → 三态 chunk 的翻译体.
   */
  private async *buildStream(handleId: string, opts: VoiceTurnBackendTurnOptions): AsyncIterable<LlmStreamChunk> {
    const queue = new DeltaQueue();
    const pending = this.engine
      .turnStream(
        handleId,
        { userText: opts.userText, traceId: opts.traceId, ...(opts.signal ? { signal: opts.signal } : {}) },
        { onDelta: (delta) => queue.push(delta), ...(opts.signal ? { signal: opts.signal } : {}) },
      )
      .then((result) => {
        queue.close();
        return { ok: true as const, result };
      })
      .catch((error: unknown) => {
        queue.close();
        return { ok: false as const, error };
      });

    const spoken: string[] = [];
    for await (const delta of queue) {
      spoken.push(delta);
      yield { type: 'content', content: delta };
    }

    const settled = await pending;
    if (!settled.ok) {
      this.logger.warn(`[streamTurn] session=${opts.sessionId} 引擎流失败: ${messageOf(settled.error)}`);
      yield {
        type: 'error',
        error: { code: 'engine_stream_error', message: messageOf(settled.error), retryable: true },
      };
      return;
    }

    const reply = settled.result.reply;
    if (spoken.length === 0 && reply.length > 0) {
      // 一个增量都没吐但有正文 → 降级兜底句 (引擎全挂时走这条路).
      // 把它当 content 吐出去, 否则前端会看到"开始了 → 结束了, 却没有任何话".
      spoken.push(reply);
      yield { type: 'content', content: reply };
    }

    const degraded = settled.result.render.providerHint === 'degraded';
    if (!degraded) {
      this.appendTurn(opts.sessionId, opts.userText, spoken.join(''));
    }

    const usage = settled.result.render.usage;
    yield {
      type: 'done',
      usage: {
        promptTokens: 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      },
    };
  }

  /**
   * 追加一问一答到逐字稿 (只记**完整跑完**的轮次, 与旧链路同口径).
   */
  private appendTurn(sessionId: string, counselorText: string, visitorText: string): void {
    const turns = this.transcripts.get(sessionId) ?? [];
    const at = Date.now();
    turns.push({ role: 'user', content: counselorText, at }, { role: 'assistant', content: visitorText, at });
    this.transcripts.set(sessionId, turns);
  }
}

/**
 * 极简异步队列 —— 把「push 型 onDelta 回调」翻译成「pull 型 AsyncIterable」.
 *
 * 为什么需要它: 引擎的流式接口是**回调**形态 (`onDelta`), 而 voice 的消费接口是
 * **拉取**形态 (AsyncIterable). 两边形态不同, 中间必须有一座转换. 放在这里而不是
 * 引擎侧, 是因为"推 → 拉"的转换是**消费侧**的责任 (谁在消费, 谁决定怎么拉).
 *
 * 反双胞胎: 不引第三方队列库 (为一个几十行的需求加依赖不划算), 也不复用 TTS 的
 * 事件队列 (那是 bidi 协议专用, 语义与生命周期都不同).
 */
class DeltaQueue {
  private readonly buffer: string[] = [];
  private notify: (() => void) | null = null;
  private closed = false;

  /** 推入一段增量. */
  push(delta: string): void {
    if (this.closed || delta.length === 0) return;
    this.buffer.push(delta);
    this.notify?.();
  }

  /** 关闭队列 (生产者结束). */
  close(): void {
    this.closed = true;
    this.notify?.();
  }

  /** 拉取增量 (直到队列关闭). */
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    for (;;) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
      this.notify = null;
    }
  }
}

/**
 * 错误转可读文案.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
