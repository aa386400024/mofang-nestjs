import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

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
}
