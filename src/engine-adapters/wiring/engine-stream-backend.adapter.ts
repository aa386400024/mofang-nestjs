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
//     - V2026-10-29 (WP9-A): 角色解析**失败不抛**, 只 warn + 回退中性基线.
//       角色是**可选增强**, 不是会话的前置条件 —— 抛错会把"没有角色"升级成
//       "会话开不起来", 那是一个可选能力不该有的失败半径.
//
//   V2026-10-29 治本 (WP9-A · B 层 · 角色解析注入):
//   职责: 开场时把"角色定义"解析成内核 `CharacterProfile` 并注入内核, 让人格基线
//         (信念 / 阻抗 / 情绪 / 信任) 在**第一轮之前**就位; 解析不到就走中性基线.
//   边界: 只做"解析 → 注入 → 快照命名"; 角色语义 (种子/映射口径) 全在
//         `wiring/character/`, 本文件**不认识**任何具体角色.
//
//   为什么解析点收敛在这一个文件:
//     翻译点只有一处是 WP8-B 立下的纪律 —— 引擎语义 → 语音语义必须收敛.
//     角色解析同属"引擎语义": 窄接口只透传"角色 key + 临场参数"这**原始事实**,
//     "这个 key 意味着什么样的阻抗与信念"是引擎侧的事. voice 层若自己去解析角色,
//     voice 层就得知道角色语义, 灰度一关就全是死代码.
//
//   反双胞胎 (WP9-A):
//     - 不用 @nestjs 的 useClass 装配 resolver: 它的构造参数带默认值, Nest 会把
//       Object 当成待注入依赖而报错 —— 走 useFactory 显式 new (与仓库既有做法一致).
//     - 不把"查不到角色"当错误: DB 角色池未接时这是**常态**, warn 即可.
//     - 不手改内核快照: 初始快照由内核 `buildInitialSnapshot` 装配 (含 label 重算),
//       适配层只交出纯对象, 不在外部拼快照.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/voice/wp8b-grayscale.spec.ts 覆盖 delta → content / 结束 → done / 失败 → error
//     3. test/engine-adapters/wp9a-open-profile.spec.ts 覆盖角色注入 / 中性回退 / 快照一致性

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { CHARACTER_PROFILE_RESOLVER, type CharacterProfileResolver, type ResolvedCharacter } from './character';
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
 * 中性基线来访者身份 (无角色时的回落形态).
 *
 * 为什么是中性基线而不是"读 persona 实体":
 *   角色资产 (5Ps / 难度 / 情绪基线) 的解析由 `CharacterProfileResolver` 负责
 *   (WP9-A: 内置种子; WP9-B: DB 角色池). 解析不到时给一个**不越界**的中性身份:
 *   它不承诺任何角色特征, 也不伪造一个看起来很像角色的假身份 (那会让报告里的
 *   人名与真实设定对不上). 中性基线 = WP8-B 的现状行为, 逐字不变.
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

  constructor(
    private readonly engine: EngineTurnService,
    /**
     * 角色解析器 (WP9-A).
     *
     * 为什么 @Optional: 角色是**可选增强**. 装配缺失 (旧装配 / 独立单测) 时必须
     * 仍然能开会话 —— 等同"无角色 → 中性基线", 而不是 500.
     */
    @Optional() @Inject(CHARACTER_PROFILE_RESOLVER) private readonly resolver?: CharacterProfileResolver,
  ) {}

  /**
   * 开场: 内核开会话 (有角色 → 注入角色基线; 无角色 → 中性基线).
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
    const character = await this.resolveCharacter(opts);
    const handle = this.engine.open({
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      visitorId,
      // 有角色才带 profile/seed; 无角色时**不传这两个字段** (缺省 = 中性默认基线),
      // 与 WP8-B 的调用形态逐字一致.
      ...(character
        ? {
            characterProfile: character.characterProfile,
            ...(character.seed === undefined ? {} : { seed: character.seed }),
          }
        : {}),
    });
    this.handles.set(opts.sessionId, handle.handleId);
    this.transcripts.set(opts.sessionId, []);
    this.logger.log(
      `[openSession] session=${opts.sessionId} handle=${handle.handleId} visitor=${visitorId} ` +
        `character=${character?.displayName ?? 'neutral'}`,
    );
    return character ? { ...NEUTRAL_PERSONA, id: visitorId, name: character.displayName } : { ...NEUTRAL_PERSONA, id: visitorId };
  }

  /**
   * 解析本场角色 (WP9-A).
   *
   * 三种"没有角色"的口径统一收敛到 null (走中性基线), 且**都不抛错**:
   *   1. resolver 未装配 (@Optional 缺省);
   *   2. 本场没有任何角色参数 (普通 voice session);
   *   3. 角色 key 查不到 (DB 角色池未接时的常态) / 解析过程抛错.
   *
   * @param opts 开场参数
   * @returns 解析结果; 无角色 → null
   */
  private async resolveCharacter(opts: VoiceTurnBackendOpenOptions): Promise<ResolvedCharacter | null> {
    if (!this.resolver) return null;
    try {
      const resolved = await this.resolver.resolve({
        templateId: opts.templateId,
        skillCode: opts.skillCode,
        preset: opts.preset,
      });
      if (!resolved) {
        // 查不到是常态 (角色池未接), 但带了 templateId 仍值得记一笔:
        // 线上排查"为什么这场没上角色"时, 这是唯一的线索.
        if (opts.templateId?.trim()) {
          this.logger.warn(`[openSession] 未解析到角色 templateId=${opts.templateId}, 回退中性基线`);
        }
        return null;
      }
      return resolved;
    } catch (error) {
      this.logger.warn(`[openSession] 角色解析异常, 回退中性基线: ${messageOf(error)}`);
      return null;
    }
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
