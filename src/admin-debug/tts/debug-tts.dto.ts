import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 三个调试 TTS 模型. */
export const DEBUG_TTS_PROVIDERS = ['minimax-hd', 'minimax-turbo', 'doubao-seed-tts-2.0'] as const;

/** 调试 TTS 生成请求. */
export class DebugTtsRenderDto {
  @IsIn(['auto_practice', 'debug_session'])
  source!: 'auto_practice' | 'debug_session';

  @IsString()
  @MaxLength(128)
  sessionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  turnIndex!: number;

  @IsIn(DEBUG_TTS_PROVIDERS)
  provider!: (typeof DEBUG_TTS_PROVIDERS)[number];

  /**
   * AF-460: 可选音色覆盖（自定义音色扩展位）.
   *
   * 不传 = 按 provider 默认音色，行为与 AF-459 一致；传了 = 只影响本次合成，
   * 缓存键会带上它，避免不同音色串用历史音频。
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  voiceId?: string;
}
