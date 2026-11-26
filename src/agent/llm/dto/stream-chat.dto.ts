// AF-537 P1 6.21#3: `/agent/llm/stream` 之前用 interface 接请求体，运行时完全跳过校验。
// 改为 class-validator DTO，由全局 ValidationPipe 兜住形状 / 长度 / 枚举。

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** 单条消息（与 LlmMessage 字段对齐）。 */
export class StreamChatMessageDto {
  @IsIn(['system', 'user', 'assistant'])
  role!: 'system' | 'user' | 'assistant';

  @IsString()
  @MaxLength(100_000)
  content!: string;
}

/** POST /agent/llm/stream 请求体。 */
export class StreamChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StreamChatMessageDto)
  messages!: StreamChatMessageDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(32_000)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  topP?: number;
}
