// AF-395: 调试页 TTS 编排服务。
// 责任：从真实会话/落盘记录里取该轮来访者文本 → 按 provider 适配 → 查缓存 → 只在上游未命中时调用。
// 安全：不接收前端自由文本；不把文本、音频、key 写进日志；音频只回管理端 base64。
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';

import { BUILTIN_CHARACTER_SEEDS } from '../../engine-adapters/wiring/character/builtin-character-registry.js';
import { getTtsProfileDefinition } from '../../voice/tts/runtime/tts-profile.registry.js';
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
import { PracticeSession } from '../../auto-practice/entities/practice-session.entity.js';
import { PracticeTurn } from '../../auto-practice/entities/practice-turn.entity.js';
import { CharacterProfileEntity } from '../../engine-adapters/wiring/character/character-profile.entity.js';
import { applyProsodyToSentence, buildProsodyPlan } from '../../shared/prosody/index.js';
import type { ProsodyEvent, ProsodyTurnPlan } from '../../shared/prosody/index.js';
import {
  buildVoiceDeliveryProfile,
  DOUBAO_2_CAPABILITIES,
  MINIMAX_CAPABILITIES,
  renderDoubaoDelivery,
  renderMiniMaxDelivery,
} from '../../shared/voice-delivery/index.js';
import type { VoiceDeliveryProfile, VoiceDeliveryRendererCapabilities, VoiceDeliveryInput } from '../../shared/voice-delivery/index.js';
import { splitSentences } from '../../voice/tts/tts-sentence-splitter.js';

/** 调试 TTS 来源. */
export type DebugTtsSource = 'auto_practice' | 'debug_session';

/** 单句的语音形态（调试页"语音形态"切换用）. */
export interface DebugTtsSpeechSentence {
  readonly index: number;
  readonly displayText: string;
  readonly speechText: string;
  /** 该 provider 实际会合成的形态（MiniMax 带 `<#x#>`；豆包为纯文本）. */
  readonly ttsText: string;
  readonly events: readonly ProsodyEvent[];
  /** 该句落下的静默总时长（毫秒；provider 不认长停顿时仍展示"计划值"）. */
  readonly silenceMs: number;
}

/** 语音形态预览：语义形态 + 厂商形态 + 逐句事件 + 实际交付参数. */
export interface DebugTtsSpeechPreview {
  readonly provider: DebugTtsProvider;
  /** AF-460: 该 provider 实际会用的模型名（speech-2.8-hd / speech-2.8-turbo / doubao-seed-tts-2.0）. */
  readonly model: string;
  /** AF-460: 本次实际音色 id（自定义音色覆盖后也回填真实值）. */
  readonly voiceId: string;
  readonly displayText: string;
  /** 语义形态（可读标记，气泡展示这一份）. */
  readonly speechText: string;
  /** 该 provider 实际合成用的文本（MiniMax 带 `<#x#>`；豆包为纯文本）. */
  readonly ttsText: string;
  readonly sentences: readonly DebugTtsSpeechSentence[];
  /** AF-460: 本轮交付档案（情绪/语速/音量/音调/风格/难度）. */
  readonly delivery: VoiceDeliveryProfile;
  /** AF-460: 该 provider 的能力声明；UI 据此显示"哪部分没落地". */
  readonly capabilities: VoiceDeliveryRendererCapabilities;
  /** AF-460: 计划静默总时长（毫秒，不区分 provider 是否支持）. */
  readonly plannedSilenceMs: number;
  /** AF-460: 真正会进音频的静默总时长（豆包 2.0 为 0）. */
  readonly appliedSilenceMs: number;
  /** AF-460: 粗略预计时长（正文按 ~4.5 字/秒 + 静默 + 标点）. */
  readonly estimatedDurationMs: number;
}

/** 生成结果基础字段（不含语音形态，缓存命中时由调用方合并）. */
export interface DebugTtsRenderBase {
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

/** 生成结果（音频 + 语音形态）. */
export interface DebugTtsRenderResult extends DebugTtsSpeechPreview, DebugTtsRenderBase {}

/** 单轮解析结果. */
interface ResolvedTurnText {
  readonly characterSlug: string;
  readonly displayText: string;
  readonly ttsText: string;
  readonly emotion: string | null;
  /** AF-460: 角色画像里可用于交付档案的维度（拿不到就是空对象）. */
  readonly deliveryHints: Omit<VoiceDeliveryInput, 'sessionId' | 'turnIndex' | 'emotion'>;
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
  async render(
    source: DebugTtsSource,
    sourceId: string,
    turnIndex: number,
    provider: DebugTtsProvider,
    voiceId?: string,
  ): Promise<DebugTtsRenderResult> {
    const resolved = await this.resolveTurnText(source, sourceId, turnIndex);
    if (resolved.displayText.length === 0) throw new BadRequestException('该轮没有可合成的文本');
    if (resolved.displayText.length > 1000) throw new BadRequestException('单轮文本超过 1000 字符，调试 TTS 不做拆分合成');
    const basePreview = buildSpeechPreview(
      resolved.displayText,
      sourceId,
      turnIndex,
      provider,
      this.deliveryInput(resolved, sourceId, turnIndex),
    );
    const providerConfig = this.providerConfig(provider, resolved, basePreview, voiceId);
    const preview: DebugTtsSpeechPreview = {
      ...basePreview,
      model: providerConfig.input.model,
      voiceId: providerConfig.voiceId,
    };
    const requestHash = hashRequest(provider, providerConfig.voiceId, resolved, preview, providerConfig.input);
    const cached = await this.findCached(source, sourceId, turnIndex, provider, requestHash);
    if (cached !== null) {
      return { ...toResult(cached, true), ...preview };
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
      usageJson: JSON.stringify(buildUsageSnapshot(output.usage, provider, providerConfig.voiceId, providerConfig.input, preview)).slice(
        0,
        2000,
      ),
      audio: output.audio,
    });
    try {
      await this.renderRepo.insert(row);
    } catch (error) {
      // 并发双击：唯一键冲突后重读缓存，避免重复计费.
      if (isDuplicateKey(error)) {
        const raced = await this.findCached(source, sourceId, turnIndex, provider, requestHash);
        if (raced !== null) return { ...toResult(raced, true), ...preview };
      }
      throw error;
    }
    this.logger.log(`[debug_tts] provider=${provider} chars=${resolved.displayText.length} bytes=${output.audio.length} cached=false`);
    return {
      ...preview,
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

  /**
   * 只读预览语音形态（AF-459）——不调上游、不计费.
   *
   * 用途：气泡"语音形态"切换点开时先拿到逐句标记与事件；
   * 用户点了某个模型之后再走 render 合成。
   *
   * @param source 来源
   * @param sourceId 会话 id
   * @param turnIndex 轮次
   * @param provider 目标模型（决定 ttsText 的厂商形态）
   * @returns 语音形态预览
   */
  async inspect(
    source: DebugTtsSource,
    sourceId: string,
    turnIndex: number,
    provider: DebugTtsProvider,
    voiceId?: string,
  ): Promise<DebugTtsSpeechPreview> {
    const resolved = await this.resolveTurnText(source, sourceId, turnIndex);
    if (resolved.displayText.length === 0) throw new BadRequestException('该轮没有可展示的文本');
    const basePreview = buildSpeechPreview(
      resolved.displayText,
      sourceId,
      turnIndex,
      provider,
      this.deliveryInput(resolved, sourceId, turnIndex),
    );
    const resolvedVoiceId = this.resolveVoiceId(provider, voiceId);
    const preview: DebugTtsSpeechPreview = { ...basePreview, voiceId: resolvedVoiceId };
    // 自定义音色覆盖时把真实值也写进 notes，合成前就能核对.
    return voiceId === undefined
      ? preview
      : { ...preview, delivery: { ...preview.delivery, notes: [...preview.delivery.notes, `voiceId=${resolvedVoiceId}`] } };
  }

  /**
   * 解析某 provider 本次实际会用的音色 id（不依赖 preview，供只读预览使用）.
   *
   * @param provider 目标模型
   * @param voiceIdOverride 调用方覆盖（自定义音色）
   * @returns 音色 id
   */
  private resolveVoiceId(provider: DebugTtsProvider, voiceIdOverride?: string): string {
    if (provider === 'doubao-seed-tts-2.0') {
      return firstNonEmpty(
        voiceIdOverride,
        this.config.get<string>('doubao.ttsVoiceId'),
        this.config.get<string>('ARK_AGENT_PLAN_TTS_SPEAKER'),
        'zh_female_vv_uranus_bigtts',
      );
    }
    return normalizeMiniMaxVoiceId(
      firstNonEmpty(
        voiceIdOverride,
        this.config.get<string>('MINIMAX_TTS_DEFAULT_VOICE'),
        this.config.get<string>('MINIMAX_TTS_VOICE_ID'),
        'Chinese (Mandarin)_Warm_Girl',
      ),
    );
  }

  /** 把角色画像/会话元数据收成交付档案输入. */
  private deliveryInput(resolved: ResolvedTurnText, sessionId: string, turnIndex: number): VoiceDeliveryInput {
    return {
      sessionId,
      turnIndex,
      emotion: resolved.emotion,
      ...resolved.deliveryHints,
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
      return {
        characterSlug: detail.characterSlug,
        displayText: text,
        ttsText: text,
        emotion: null,
        deliveryHints: await this.profileHintsOf(detail.characterSlug),
      };
    }

    const turn = await this.dataSource.getRepository(PracticeTurn).findOne({ where: { practiceSessionId: sourceId, turnIndex } });
    if (turn !== null && (turn.visitorDisplayText !== null || turn.visitorTtsText !== null)) {
      const display = normalizeSpokenText(turn.visitorDisplayText ?? turn.visitorTtsText ?? '');
      const characterSlug = await this.characterSlugOf(sourceId);
      return {
        characterSlug,
        displayText: display,
        ttsText: turn.visitorTtsText ?? display,
        emotion: readEmotion(turn.visitorSemanticJson),
        deliveryHints: await this.profileHintsOf(characterSlug),
      };
    }

    // 老场次没有 turn 行：回退到自动对练落盘的 debug 逐字稿.
    const session = await this.dataSource.getRepository(PracticeSession).findOne({ where: { id: sourceId } });
    if (session === null || session.debugSessionId.length === 0) throw new NotFoundException('该轮来访者消息不存在');
    const detail = await this.debugSessions.getPersistedSession(session.debugSessionId);
    const visitor = detail.messages.find((m) => m.role === 'visitor' && m.turnIndex === turnIndex);
    if (visitor === undefined) throw new NotFoundException('该轮来访者消息不存在');
    const text = normalizeSpokenText(visitor.text);
    return {
      characterSlug: session.characterSlug,
      displayText: text,
      ttsText: text,
      emotion: null,
      deliveryHints: await this.profileHintsOf(session.characterSlug),
    };
  }

  /**
   * 取角色画像里对交付档案有用的维度（拿不到就返回空对象，走保守默认）.
   *
   * 两种来源：
   *   · `character_profiles`（vpt 公共人物，按 templateId / displayName 匹配）；
   *   · 内置角色种子（auto-practice 的 builtin slug）。
   * 查库或字段缺失都不应让调试页报错，所以这里全部 catch 成空对象。
   *
   * @param characterSlug 角色 slug
   * @returns 交付档案输入片段
   */
  private async profileHintsOf(characterSlug: string): Promise<Omit<VoiceDeliveryInput, 'sessionId' | 'turnIndex' | 'emotion'>> {
    const slug = characterSlug.trim();
    if (slug.length === 0) return {};
    try {
      const row = await this.dataSource.getRepository(CharacterProfileEntity).findOne({
        where: [{ templateId: slug }, { displayName: slug }],
      });
      if (row !== null) {
        return {
          valence: row.baselineEmotionValence,
          arousal: row.baselineEmotionArousal,
          speechVolumeBaseline: row.speechVolumeBaseline,
          expressionTone: row.expressionTone,
          attachmentStyle: row.attachmentStyle,
        };
      }
    } catch {
      // 调试页不因画像表缺失而 500.
    }
    const seed = BUILTIN_CHARACTER_SEEDS.find((item) => item.key === slug);
    if (seed === undefined) return {};
    return {
      valence: seed.baseline.emotion.valence,
      arousal: seed.baseline.emotion.arousal,
      speechVolumeBaseline: seed.speechVolumeBaseline,
      expressionTone: seed.expressionTone,
      attachmentStyle: seed.attachmentStyle,
    };
  }

  /** 取场次角色 slug；查不到返回空串（音色走 provider 默认）. */
  private async characterSlugOf(practiceSessionId: string): Promise<string> {
    const session = await this.dataSource.getRepository(PracticeSession).findOne({ where: { id: practiceSessionId } });
    return session?.characterSlug ?? '';
  }

  /** provider 的模型 / 音色 / 参数 / 凭证. */
  private providerConfig(
    provider: DebugTtsProvider,
    resolved: ResolvedTurnText,
    preview: DebugTtsSpeechPreview,
    voiceIdOverride?: string,
  ): { voiceId: string; input: TtsSynthesisInput } {
    return provider === 'doubao-seed-tts-2.0'
      ? this.doubaoProviderConfig(resolved, preview, voiceIdOverride)
      : this.minimaxProviderConfig(provider, preview, voiceIdOverride);
  }

  /** 豆包 Agent Plan 配置. */
  private doubaoProviderConfig(
    resolved: ResolvedTurnText,
    preview: DebugTtsSpeechPreview,
    voiceIdOverride?: string,
  ): { voiceId: string; input: TtsSynthesisInput } {
    const apiKey = this.config.get<string>('doubao.ttsApiKey')?.trim() ?? '';
    if (apiKey.length === 0) throw new ServiceUnavailableException('豆包 Agent Plan API key 未配置');
    const voiceId = this.resolveVoiceId('doubao-seed-tts-2.0', voiceIdOverride);
    const profile = preview.delivery;
    return {
      voiceId,
      input: {
        // AF-460: 豆包 2.0 不认韵律标签，喂纯文本；停顿/长沉默虽计划存在但本请求不含.
        text: preview.ttsText,
        voiceId,
        emotion: resolved.emotion,
        model: 'doubao-seed-tts-2.0',
        speed: profile.speed,
        volume: profile.volume,
        pitch: profile.pitch,
        sampleRate: 24_000,
        apiKey,
        baseUrl: firstNonEmpty(
          this.config.get<string>('ARK_AGENT_PLAN_TTS_BASE_URL'),
          'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional',
        ),
        deliveryContext: profile.contextText,
        trailingSilenceMs: preview.sentences.at(-1)?.silenceMs ?? 0,
      },
    };
  }

  /** MiniMax 2.8 系列配置. */
  private minimaxProviderConfig(
    provider: DebugTtsProvider,
    preview: DebugTtsSpeechPreview,
    voiceIdOverride?: string,
  ): { voiceId: string; input: TtsSynthesisInput } {
    const apiKey = this.config.get<string>('MINIMAX_API_KEY')?.trim() ?? '';
    if (apiKey.length === 0) throw new ServiceUnavailableException('MiniMax API key 未配置');
    const voiceId = this.resolveVoiceId(provider, voiceIdOverride);
    const profile = preview.delivery;
    return {
      voiceId,
      input: {
        // AF-459: 喂厂商形态（带 <#x#> 停顿），不是展示正文.
        text: preview.ttsText,
        voiceId,
        emotion: mapMiniMaxEmotion(profile.emotion),
        // AF-557: 模型名来自 TTS registry, 不再在调试服务里硬编码.
        model: getTtsProfileDefinition(provider === 'minimax-hd' ? 'minimax-hd' : 'minimax-turbo').model,
        speed: profile.speed,
        volume: profile.volume,
        pitch: profile.pitch,
        sampleRate: 24_000,
        apiKey,
        baseUrl: firstNonEmpty(
          this.config.get<string>('minimax.ttsBaseUrl'),
          this.config.get<string>('minimax.baseUrl'),
          'https://api.minimax.cn',
        ),
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
function toResult(row: AdminDebugTtsRenderEntity, cached: boolean): DebugTtsRenderBase {
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

/**
 * 生成脱敏的真实请求快照（给调试页"这一轮实际发了什么"用）.
 *
 * 只留模型/音色/参数/文本形态与计划静默，不含 API key、base URL、完整音频。
 *
 * @param usage 上游 usage
 * @param provider 模型
 * @param voiceId 音色
 * @param input 合成输入
 * @param preview 预览
 * @returns 可 JSON 化的快照
 */
function buildUsageSnapshot(
  usage: Record<string, unknown> | null,
  provider: DebugTtsProvider,
  voiceId: string,
  input: TtsSynthesisInput,
  preview: DebugTtsSpeechPreview,
): Record<string, unknown> {
  return {
    usage,
    request: {
      provider,
      model: input.model,
      voiceId,
      text: input.text,
      emotion: input.emotion,
      speed: input.speed,
      volume: input.volume,
      pitch: input.pitch,
      sampleRate: input.sampleRate,
      deliveryContext: input.deliveryContext ?? null,
      trailingSilenceMs: input.trailingSilenceMs ?? 0,
      plannedSilenceMs: preview.plannedSilenceMs,
      estimatedDurationMs: preview.estimatedDurationMs,
    },
  };
}

/** 请求指纹：provider + 音色 + 文本 + 情绪 + 模型/参数. */
function hashRequest(
  provider: DebugTtsProvider,
  voiceId: string,
  resolved: ResolvedTurnText,
  preview: DebugTtsSpeechPreview,
  input: TtsSynthesisInput,
): string {
  const spoken = provider === 'doubao-seed-tts-2.0' ? preview.displayText : preview.ttsText;
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
        deliveryContext: input.deliveryContext ?? '',
        trailingSilenceMs: input.trailingSilenceMs ?? 0,
      }),
    )
    .digest('hex');
}

/**
 * 生成语音形态预览（AF-459）.
 *
 * 确定性：seed = 会话 id + 轮次，所以同一轮反复点开看到的停顿位置一致；
 * 只有 provider 改变时 `ttsText` 才变（MiniMax 有 `<#x#>`，豆包仍是纯文本）。
 *
 * @param displayText 该轮展示正文
 * @param sessionId 会话 id
 * @param turnIndex 轮次
 * @param provider 目标模型
 * @returns 预览
 */
function buildSpeechPreview(
  displayText: string,
  sessionId: string,
  turnIndex: number,
  provider: DebugTtsProvider,
  profileInput: VoiceDeliveryInput,
): DebugTtsSpeechPreview {
  const delivery = buildVoiceDeliveryProfile(profileInput);
  const plan: ProsodyTurnPlan = buildProsodyPlan({
    enabled: true,
    sessionId,
    turnIndex,
    style: delivery.style,
    difficulty: delivery.difficulty,
  });
  const split = splitSentences(displayText, 100).sentences;
  const rawSentences = split.length > 0 ? split : [displayText];
  let appliedEvents = 0;
  let lastEventSentenceIndex = -1;
  let thinkingBeats = 0;
  let longSilences = 0;
  let paralinguistic = 0;
  const sentences = rawSentences.map((text, index) => {
    const applied = applyProsodyToSentence(text, plan, {
      sentenceIndex: index,
      appliedEvents,
      lastEventSentenceIndex,
      appliedThinkingBeats: thinkingBeats,
      appliedLongSilences: longSilences,
      appliedParalinguistic: paralinguistic,
    });
    if (applied.events.length > 0) {
      appliedEvents += 1;
      lastEventSentenceIndex = index;
      for (const event of applied.events) {
        if (event.kind === 'thinking') thinkingBeats += 1;
        if (event.kind === 'silence') longSilences += 1;
        if (event.kind === 'breath' || event.kind === 'sigh') paralinguistic += 1;
      }
    }
    const silenceMs = sumEventSilenceMs(applied.events);
    // 逐句都走共享渲染器：调试页看到的 ttsText 与生产链路是同一套实现，
    //   避免"面板显示一套、真发出去另一套".
    const rendered =
      provider === 'doubao-seed-tts-2.0' ? renderDoubaoDelivery(applied.speechText) : renderMiniMaxDelivery(applied.speechText, delivery);
    return {
      index,
      displayText: applied.displayText,
      speechText: applied.speechText,
      ttsText: rendered.ttsText,
      events: applied.events,
      silenceMs,
    };
  });
  const speechText = sentences.map((sentence) => sentence.speechText).join('');
  const ttsText = sentences.map((sentence) => sentence.ttsText).join('');
  const plannedSilenceMs = sentences.reduce((total, sentence) => total + sentence.silenceMs, 0);
  const capabilities = provider === 'doubao-seed-tts-2.0' ? DOUBAO_2_CAPABILITIES : MINIMAX_CAPABILITIES;
  // 只有真正落在 ttsText 里的 `<#x#>` 才会进入这次同步合成；句末长沉默由流式链路的
  // 下发节奏承接，调试页单次合成不含，因此不能把 plannedSilenceMs 直接算成实际.
  const appliedSilenceMs = sumRenderedSilenceMs(ttsText);
  // 预计时长按"生产链路真正会发生"算：句末长沉默由下发节奏承接，仍计入整轮时长；
  //   单次同步合成的实际静默另由 appliedSilenceMs 单独暴露.
  const estimatedDurationMs = estimateDurationMs(displayText, delivery.speed, plannedSilenceMs);
  return {
    provider,
    model: modelOfProvider(provider),
    // 音色由调用方在拿到实际配置后回填；build 阶段不猜 env.
    voiceId: '',
    displayText,
    speechText,
    ttsText,
    sentences,
    delivery,
    capabilities,
    plannedSilenceMs,
    appliedSilenceMs,
    estimatedDurationMs,
  };
}

/** provider -> 实际模型名（调试页展示用，与实际请求保持一致）. */
function modelOfProvider(provider: DebugTtsProvider): string {
  if (provider === 'doubao-seed-tts-2.0') return 'doubao-seed-tts-2.0';
  return provider === 'minimax-hd' ? 'speech-2.8-hd' : 'speech-2.8-turbo';
}

/** 本句事件里的静默总时长. */
function sumEventSilenceMs(events: readonly ProsodyEvent[]): number {
  let total = 0;
  for (const event of events) {
    if (event.kind === 'silence' && typeof event.durationMs === 'number') total += event.durationMs;
  }
  return total;
}

/** MiniMax 渲染文本里真正落地的 `<#x#>` 总时长. */
function sumRenderedSilenceMs(ttsText: string): number {
  let total = 0;
  for (const match of ttsText.matchAll(/<#(\d+(?:\.\d+)?)#>/g)) {
    total += Number(match[1]) * 1000;
  }
  return total;
}

/** 粗略时长估算：中文约 4.5 字/秒（±标点），再按语速缩放并叠加真实静默. */
function estimateDurationMs(text: string, speed: number, silenceMs: number): number {
  const chars = text.replaceAll(/\s+/g, '').length;
  const base = (chars / 4.5 / Math.max(0.5, speed)) * 1000;
  return Math.round(base + silenceMs);
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
  // 官方合法枚举：happy / sad / angry / fearful / disgusted / surprised / calm
  // （fluent / whisper 仅 2.6 系列；neutral 不是合法值，历史映射会报 2013）。
  const supported = new Set(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']);
  if (supported.has(emotion)) return emotion;
  // 旧语义 JSON 里可能存了 neutral（历史调试数据），按官方的中性值 calm 处理.
  if (emotion === 'neutral') return 'calm';
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
