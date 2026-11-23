// AF-395: 调试页 TTS 编排服务。
// 责任：从真实会话/落盘记录里取该轮来访者文本 → 按 provider 适配 → 查缓存 → 只在上游未命中时调用。
// 安全：不接收前端自由文本；不把文本、音频、key 写进日志；音频只回管理端 base64。
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';

import { PracticeSession } from '../../auto-practice/entities/practice-session.entity.js';
import { PracticeTurn } from '../../auto-practice/entities/practice-turn.entity.js';
import { DebugSessionService } from '../debug-session.service.js';
import { AdminDebugTtsRenderEntity } from './admin-debug-tts-render.entity.js';
import {
  DebugTtsProviderError,
  synthesizeDoubao,
  synthesizeMiniMax,
  type DebugTtsProvider,
  type TtsSynthesisInput,
  type TtsSynthesisOutput,
} from './debug-tts.providers.js';

/** 调试 TTS 来源. */
export type DebugTtsSource = 'auto_practice' | 'debug_session';

/** 生成结果（前端只拿音频与可追溯元信息）. */
export interface DebugTtsRenderResult {
  readonly provider: DebugTtsProvider;
  readonly voiceId: string;
  readonly format: 'mp3';
  readonly sampleRate: number;
  readonly durationMs: number | null;
  readonly audioBase64: string;
  readonly cached: boolean;
  readonly textChars: number;
  readonly requestHash: string;
}

/** 单轮解析结果. */
interface ResolvedTurnText {
  readonly characterSlug: string;
  readonly displayText: string;
  readonly ttsText: string;
  readonly emotion: string | null;
}

/**
 * 调试 TTS 服务.
 */
@Injectable()
export class DebugTtsService {
  private readonly logger = new Logger(DebugTtsService.name);

  constructor(
    @InjectRepository(AdminDebugTtsRenderEntity)
    private readonly renderRepo: Repository<AdminDebugTtsRenderEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly debugSessions: DebugSessionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 生成或读取缓存.
   *
   * @param source 来源
   * @param sourceId 自动对练传 practiceSessionId，手动调试传 debugSessionId
   * @param turnIndex 轮次（从 1 开始）
   * @param provider 三个模型之一
   */
  async render(source: DebugTtsSource, sourceId: string, turnIndex: number, provider: DebugTtsProvider): Promise<DebugTtsRenderResult> {
    const resolved = await this.resolveTurnText(source, sourceId, turnIndex);
    if (resolved.displayText.length === 0) throw new BadRequestException('该轮没有可合成的文本');
    if (resolved.displayText.length > 1000) throw new BadRequestException('单轮文本超过 1000 字符，调试 TTS 不做拆分合成');
    const providerConfig = this.providerConfig(provider, resolved);
    const requestHash = hashRequest(provider, providerConfig.voiceId, resolved, providerConfig.input);
    const cached = await this.findCached(source, sourceId, turnIndex, provider, requestHash);
    if (cached !== null) {
      return toResult(cached, true);
    }
    const output = await this.synthesize(provider, providerConfig.input);
    const row = this.renderRepo.create({
      id: randomUUID(),
      sourceType: source,
      sourceId,
      turnIndex,
      provider,
      requestHash,
      voiceId: providerConfig.voiceId,
      audioFormat: output.format,
      sampleRate: output.sampleRate,
      durationMs: output.durationMs,
      textChars: resolved.displayText.length,
      usageJson: output.usage === null ? null : JSON.stringify(output.usage).slice(0, 2000),
      audio: output.audio,
    });
    try {
      await this.renderRepo.insert(row);
    } catch (error) {
      // 并发双击：唯一键冲突后重读缓存，避免重复计费.
      if (isDuplicateKey(error)) {
        const raced = await this.findCached(source, sourceId, turnIndex, provider, requestHash);
        if (raced !== null) return toResult(raced, true);
      }
      throw error;
    }
    this.logger.log(`[debug_tts] provider=${provider} chars=${resolved.displayText.length} bytes=${output.audio.length} cached=false`);
    return {
      provider,
      voiceId: providerConfig.voiceId,
      format: output.format,
      sampleRate: output.sampleRate,
      durationMs: output.durationMs,
      audioBase64: output.audio.toString('base64'),
      cached: false,
      textChars: resolved.displayText.length,
      requestHash,
    };
  }

  /** 查历史生成；只有请求指纹一致才算命中，文本/参数变了不冒充旧音频. */
  private async findCached(
    source: DebugTtsSource,
    sourceId: string,
    turnIndex: number,
    provider: DebugTtsProvider,
    requestHash: string,
  ): Promise<AdminDebugTtsRenderEntity | null> {
    return this.renderRepo.findOne({
      where: { sourceType: source, sourceId, turnIndex, provider, requestHash },
    });
  }

  /** 解析该轮文本：自动对练优先读 turn 表，缺失时回退落盘调试记录. */
  private async resolveTurnText(source: DebugTtsSource, sourceId: string, turnIndex: number): Promise<ResolvedTurnText> {
    if (source === 'debug_session') {
      const detail = await this.debugSessions.getPersistedSession(sourceId);
      const visitor = detail.messages.find((m) => m.role === 'visitor' && m.turnIndex === turnIndex);
      if (visitor === undefined) throw new NotFoundException('该轮来访者消息不存在');
      const text = normalizeSpokenText(visitor.text);
      return { characterSlug: detail.characterSlug, displayText: text, ttsText: text, emotion: null };
    }

    const turn = await this.dataSource.getRepository(PracticeTurn).findOne({ where: { practiceSessionId: sourceId, turnIndex } });
    if (turn !== null && (turn.visitorDisplayText !== null || turn.visitorTtsText !== null)) {
      const display = normalizeSpokenText(turn.visitorDisplayText ?? turn.visitorTtsText ?? '');
      return {
        characterSlug: await this.characterSlugOf(sourceId),
        displayText: display,
        ttsText: turn.visitorTtsText ?? display,
        emotion: readEmotion(turn.visitorSemanticJson),
      };
    }

    // 老场次没有 turn 行：回退到自动对练落盘的 debug 逐字稿.
    const session = await this.dataSource.getRepository(PracticeSession).findOne({ where: { id: sourceId } });
    if (session === null || session.debugSessionId.length === 0) throw new NotFoundException('该轮来访者消息不存在');
    const detail = await this.debugSessions.getPersistedSession(session.debugSessionId);
    const visitor = detail.messages.find((m) => m.role === 'visitor' && m.turnIndex === turnIndex);
    if (visitor === undefined) throw new NotFoundException('该轮来访者消息不存在');
    const text = normalizeSpokenText(visitor.text);
    return { characterSlug: session.characterSlug, displayText: text, ttsText: text, emotion: null };
  }

  /** 取场次角色 slug；查不到返回空串（音色走 provider 默认）. */
  private async characterSlugOf(practiceSessionId: string): Promise<string> {
    const session = await this.dataSource.getRepository(PracticeSession).findOne({ where: { id: practiceSessionId } });
    return session?.characterSlug ?? '';
  }

  /** provider 的模型 / 音色 / 参数 / 凭证. */
  private providerConfig(provider: DebugTtsProvider, resolved: ResolvedTurnText): { voiceId: string; input: TtsSynthesisInput } {
    return provider === 'doubao-seed-tts-2.0' ? this.doubaoProviderConfig(resolved) : this.minimaxProviderConfig(provider, resolved);
  }

  /** 豆包 Agent Plan 配置. */
  private doubaoProviderConfig(resolved: ResolvedTurnText): { voiceId: string; input: TtsSynthesisInput } {
    const apiKey = this.config.get<string>('ARK_AGENT_PLAN_API_KEY')?.trim() ?? '';
    if (apiKey.length === 0) throw new ServiceUnavailableException('豆包 Agent Plan API key 未配置');
    const voiceId = firstNonEmpty(this.config.get<string>('ARK_AGENT_PLAN_TTS_SPEAKER'), 'zh_female_vv_uranus_bigtts');
    return {
      voiceId,
      input: {
        text: resolved.displayText,
        voiceId,
        emotion: resolved.emotion,
        model: 'doubao-seed-tts-2.0',
        speed: 1,
        volume: 1,
        pitch: 0,
        sampleRate: 24_000,
        apiKey,
        baseUrl: firstNonEmpty(
          this.config.get<string>('ARK_AGENT_PLAN_TTS_BASE_URL'),
          'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional',
        ),
      },
    };
  }

  /** MiniMax 2.8 系列配置. */
  private minimaxProviderConfig(provider: DebugTtsProvider, resolved: ResolvedTurnText): { voiceId: string; input: TtsSynthesisInput } {
    const apiKey = this.config.get<string>('MINIMAX_API_KEY')?.trim() ?? '';
    if (apiKey.length === 0) throw new ServiceUnavailableException('MiniMax API key 未配置');
    const voiceId = normalizeMiniMaxVoiceId(
      firstNonEmpty(
        this.config.get<string>('MINIMAX_TTS_VOICE_ID'),
        this.config.get<string>('MINIMAX_TTS_DEFAULT_VOICE'),
        'Chinese (Mandarin)_Warm_Girl',
      ),
    );
    return {
      voiceId,
      input: {
        text: resolved.ttsText,
        voiceId,
        emotion: mapMiniMaxEmotion(resolved.emotion),
        model: provider === 'minimax-hd' ? 'speech-2.8-hd' : 'speech-2.8-turbo',
        speed: this.config.get<number>('minimax.ttsSpeed') ?? 1,
        volume: this.config.get<number>('minimax.ttsVolume') ?? 1,
        pitch: this.config.get<number>('minimax.ttsPitch') ?? 0,
        sampleRate: 24_000,
        apiKey,
        baseUrl: firstNonEmpty(this.config.get<string>('minimax.baseUrl'), 'https://api.minimax.cn'),
      },
    };
  }

  /** 按 provider 调上游；错误统一转成脱敏的 502. */
  private async synthesize(provider: DebugTtsProvider, base: TtsSynthesisInput): Promise<TtsSynthesisOutput> {
    try {
      return provider === 'doubao-seed-tts-2.0' ? await synthesizeDoubao(base, provider) : await synthesizeMiniMax(base, provider);
    } catch (error) {
      if (error instanceof DebugTtsProviderError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}

/** 组装最终返回值. */
function toResult(row: AdminDebugTtsRenderEntity, cached: boolean): DebugTtsRenderResult {
  return {
    provider: row.provider as DebugTtsProvider,
    voiceId: row.voiceId,
    format: 'mp3',
    sampleRate: row.sampleRate,
    durationMs: row.durationMs,
    audioBase64: row.audio.toString('base64'),
    cached,
    textChars: row.textChars,
    requestHash: row.requestHash,
  };
}

/** 请求指纹：provider + 音色 + 文本 + 情绪 + 模型/参数. */
function hashRequest(provider: DebugTtsProvider, voiceId: string, resolved: ResolvedTurnText, input: TtsSynthesisInput): string {
  const spoken = provider === 'doubao-seed-tts-2.0' ? resolved.displayText : resolved.ttsText;
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider,
        voiceId,
        model: input.model,
        text: spoken,
        emotion: resolved.emotion,
        speed: input.speed,
        volume: input.volume,
        pitch: input.pitch,
        sampleRate: input.sampleRate,
      }),
    )
    .digest('hex');
}

/** 取第一个非空字符串；用于 env 的空串兜底，避免 `||` 触发宽松判断. */
function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return '';
}

/** 旧版 MiniMax 音色 id -> 2.8 系列可用音色（debug 专用，避免历史环境变量直接 2054）. */
function normalizeMiniMaxVoiceId(value: string): string {
  if (value.length === 0) return 'Chinese (Mandarin)_Warm_Girl';
  const legacy: Record<string, string> = {
    mandarin_female_001: 'Chinese (Mandarin)_Warm_Girl',
  };
  return legacy[value] ?? value;
}

/** 语义情绪 -> MiniMax 2.8 `voice_setting.emotion` 封闭枚举；不支持的返回 null. */
function mapMiniMaxEmotion(emotion: string | null): string | null {
  if (emotion === null) return null;
  const supported = new Set(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral']);
  if (supported.has(emotion)) return emotion;
  if (emotion === 'calm') return 'neutral';
  return null;
}

/** 未落库文本做最小清洗：去 MiniMax 标记，保留自然语言. */
function normalizeSpokenText(value: string): string {
  const cleaned = value
    .replaceAll(/<#\d+#>/g, '')
    .replaceAll(/\[(?:emotion|pause|pre_speech|control|breath|sigh|laugh|cry|whisper|shout)[^\]]*\]/gi, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return cleaned;
}

/** 从语义 JSON 只读 emotion；坏 JSON/未知值一律 null. */
function readEmotion(json: string | null): string | null {
  if (json === null || json.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(json) as { emotion?: unknown };
    return typeof parsed.emotion === 'string' ? parsed.emotion : null;
  } catch {
    return null;
  }
}

/** MySQL 唯一键冲突. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}
