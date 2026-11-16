// V2026-11-10 治本 (WP-J P1e Phase2 — 流式语义预处理器):
//   职责: LLM 逐 token 流式输出时, **缓冲到语义标签闭合**, 把标签翻译成厂商格式,
//         再把可以立刻发给 TTS 的文本吐出去.
//
// ── 为什么需要它 (问题出在哪) ─────────────────────────────────────────────
//   LLM 逐 token 吐字时, 一个标签会被拆成好几个 chunk:
//     "[pa" + "use:0.5]" + "我最近"
//   如果把 "[pa" 直接发给 TTS, 它会被当成**普通文字念出来** ("[pa" = 字母念法),
//   听感事故 —— 而且这种事故只在流式下出现, 离线全量文本永远看不出来.
//   所以: 遇到 '[' 就**停下往外吐**, 缓冲到对应的 ']' 闭合, 整段解析完再一次性吐出去.
//
// ── 为什么不自己切句 ───────────────────────────────────────────────────────
//   我们用的是 MiniMax 的**双向流式**接口 (/ws/v1/t2a_v2_bidi):
//     · 客户端可以逐 token 发;
//     · **服务端自己攒句**, 并通过 sentence_start / sentence_end 告诉客户端它怎么切的.
//   句边界是**服务端**的事 —— 客户端自己切句 = 两套切法打架 (切点对不上, 句被劈开).
//   本类**只管标签闭合**, 一个字都不切句.
//
// ── 与 P1e 解析层的关系 (不漂移) ──────────────────────────────────────────
//   标签的语义判定复用 `classifySemanticTag` / `parseSemanticTagFragment`
//   (与离线扫描同一份判定), 标签→厂商格式的翻译复用 `MiniMaxTtsAdapter` ——
//   于是**流式与离线对同一段文本产出一致的 TTS 文本**.
//   ⚠️ 一处**故意的差异**: 流式**不丢句尾停顿** —— 离线整段解析会丢掉
//     "停顿出现在整段末尾" 的情形 (最后一句停了没意义), 而流式里片段末尾
//     常常不是整句末尾 (整句还没说完) —— 按句级规则丢掉会把停顿吞掉.
//
// ── 边界 ────────────────────────────────────────────────────────────────
//   · **本批只写类 + 单测**: 不接 tts-bidi-client / tts.service / voice.gateway
//     (在线语音链路是生产路径, 下一批再合).
//   · 厂商语气标签 `(sighs)` **原样透传** —— 它们本来就是 TTS-ready 的, 不归本类管.
//   · 情绪标记 `[emotion:sad]` 不进文本 (情绪走 voice_setting.emotion 参数),
//     通过 `detectedEmotion` 暴露给调用方.
//   · 未闭合的 '[' 在 `flush()` 时按**纯文本**吐出去 (不丢字).
//
//   时间戳: 2026-11-10 GMT+8

import { parseSemanticTagFragment } from './semantic-tag-parser.js';
import type { SemanticEmotion } from './semantic-tag-parser.js';
import { MiniMaxTtsAdapter } from '../adapters/minimax-tts-adapter.js';

/** 流式预处理的计数 (纯计数 —— 可安全进日志). */
export interface StreamingSemanticStats {
  /** 识别出的标记数 (含控制标记 —— 认出来了, 只是不念). */
  readonly tags: number;
  /** 形态像标记但不认识的 (已丢弃, 不让 TTS 念出来). */
  readonly unknownTags: number;
  /** 根本不是标记的方括号 (原样透传). */
  readonly plainBrackets: number;
  /** 控制标记数 (TTS 看不见, 只计数). */
  readonly controlTags: number;
  /** flush() 时按纯文本吐出去的字符数. */
  readonly flushedChars: number;
}

/**
 * 流式语义预处理器 —— 缓冲到语义标签闭合, 再翻译成厂商格式吐出.
 *
 * 用法:
 *   const pre = new StreamingSemanticPreprocessor();
 *   for await (const token of llmStream) {
 *     const ready = pre.pushToken(token);
 *     if (ready.length > 0) await tts.send(ready);
 *   }
 *   const tail = pre.flush();
 *   if (tail.length > 0) await tts.send(tail);
 */
export class StreamingSemanticPreprocessor {
  /** 未闭合的标记缓冲 (以 '[' 开头). */
  private buffer = '';
  /** 当前是否处在"标签缓冲"状态. */
  private pending = false;
  /** 最近一次解析出的情绪 (给 TTS 请求的 voice_setting.emotion 用). */
  private emotion: SemanticEmotion | null = null;
  /** 计数. */
  private counters = { tags: 0, unknownTags: 0, plainBrackets: 0, controlTags: 0, flushedChars: 0 };
  /** 适配器 (标签→厂商格式的唯一翻译口). */
  private readonly adapter = new MiniMaxTtsAdapter();

  /**
   * 最近一次解析出的情绪.
   *
   * ⚠️ 情绪**不在文本里** —— 它是 TTS 请求的 `voice_setting.emotion` 参数.
   *   调用方要在发请求时读这个值.
   */
  get detectedEmotion(): SemanticEmotion | null {
    return this.emotion;
  }

  /**
   * 处理计数 (纯计数, 不含任何原文).
   *
   * @returns 计数快照
   */
  get stats(): StreamingSemanticStats {
    return { ...this.counters };
  }

  /**
   * 喂一段 LLM 增量 token, 返回**可以立即发给 TTS** 的文本 (可能是空串).
   *
   * @param chunk 增量文本
   * @returns 可发送文本 (空串 = 本次没有可发的)
   */
  pushToken(chunk: string): string {
    let out = '';
    let index = 0;
    while (index < chunk.length) {
      if (!this.pending) {
        const open = chunk.indexOf('[', index);
        if (open === -1) {
          out += chunk.slice(index);
          break;
        }
        // '[' 之前的内容是普通文本 → 直接透传.
        out += chunk.slice(index, open);
        this.buffer = '[';
        this.pending = true;
        index = open + 1;
        continue;
      }
      // 标签缓冲中: 逐字符找闭合.
      this.buffer += chunk[index];
      index += 1;
      if (this.isTagClosed(this.buffer)) {
        out += this.renderTag(this.buffer);
        this.buffer = '';
        this.pending = false;
      }
    }
    return out;
  }

  /**
   * 本轮结束: 把残余缓冲按**纯文本** flush 出去 (不丢字).
   *
   * @returns 需要补发的文本 (空串 = 没有残余)
   */
  flush(): string {
    if (!this.pending || this.buffer.length === 0) {
      return '';
    }
    // 未闭合的 '[' —— 按纯文本吐出去: 宁可让 TTS 念一段怪文字, 也不能吞掉字.
    const residual = this.buffer;
    this.buffer = '';
    this.pending = false;
    this.counters.flushedChars += residual.length;
    return residual;
  }

  /**
   * 会话切换: 重置内部状态.
   */
  reset(): void {
    this.buffer = '';
    this.pending = false;
    this.emotion = null;
    this.counters = { tags: 0, unknownTags: 0, plainBrackets: 0, controlTags: 0, flushedChars: 0 };
  }

  /**
   * 缓冲是否已经闭合.
   *
   * 双括号形态 (`[[STATE:END]]`) 要等**两个** ']' —— 只等到一个说明还没闭合.
   *
   * @param buffer 当前缓冲
   * @returns 是否闭合
   */
  private isTagClosed(buffer: string): boolean {
    if (buffer.startsWith('[[')) {
      return buffer.length >= 4 && buffer.endsWith(']]');
    }
    return buffer.length >= 2 && buffer.endsWith(']');
  }

  /**
   * 把一个**闭合的**标记翻译成可发给 TTS 的文本.
   *
   * @param raw 完整标记
   * @returns 可发送文本 (空串 = 这段不该发给 TTS)
   */
  private renderTag(raw: string): string {
    const fragment = parseSemanticTagFragment(raw);
    if (fragment.kind === 'plain') {
      // 不是标记 (如 '[1]' / '[你好]') → 原样透传, 一个字都不改.
      this.counters.plainBrackets += 1;
      return raw;
    }
    if (fragment.kind === 'unknown') {
      // 形态像标记但不认识 → 丢弃 (让 TTS 念出 "[xyzzy]" 是听感事故).
      this.counters.unknownTags += 1;
      return '';
    }
    this.counters.tags += 1;
    if (fragment.turn.controlTags.length > 0) {
      // 控制标记是**引擎**的信号, TTS 看不见.
      this.counters.controlTags += 1;
      return '';
    }
    if (fragment.turn.emotion) {
      this.emotion = fragment.turn.emotion;
    }
    const rendered = this.adapter.render(fragment.turn, { baseVoiceParams: {} });
    return rendered.ttsText;
  }
}
