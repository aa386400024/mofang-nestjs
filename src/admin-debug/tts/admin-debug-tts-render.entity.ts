// AF-395 (2026-11-24 · 引擎调试三模型 TTS 对比):
//   调试页点击生成的历史音频记录。唯一键 = 来源 + 轮次 + provider + 请求指纹，
//   所以同一轮同一模型二次点击命中缓存，文本/参数变了才会重新生成。
//
//   音频只用于调试回放：单条 MP3 通常几十到几百 KB，MEDIUMBLOB 足够；
//   不写正式训练表，不把心理文本或音频进日志。
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('admin_debug_tts_renders')
@Index('uk_admin_debug_tts_render', ['sourceType', 'sourceId', 'turnIndex', 'provider', 'requestHash'], { unique: true })
@Index('idx_admin_debug_tts_source', ['sourceType', 'sourceId', 'turnIndex'])
export class AdminDebugTtsRenderEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 16, name: 'source_type' })
  sourceType!: string;

  @Column({ type: 'varchar', length: 128, name: 'source_id' })
  sourceId!: string;

  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ type: 'char', length: 64, name: 'request_hash' })
  requestHash!: string;

  @Column({ type: 'varchar', length: 128, name: 'voice_id' })
  voiceId!: string;

  @Column({ type: 'varchar', length: 8, name: 'audio_format', default: 'mp3' })
  audioFormat!: string;

  @Column({ type: 'int', name: 'sample_rate', default: 24_000 })
  sampleRate!: number;

  @Column({ type: 'int', name: 'duration_ms', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'int', name: 'text_chars' })
  textChars!: number;

  @Column({ type: 'text', name: 'usage_json', nullable: true })
  usageJson!: string | null;

  @Column({ type: 'mediumblob' })
  audio!: Buffer;

  @CreateDateColumn({ type: 'datetime', precision: 3, name: 'created_at' })
  createdAt!: Date;
}
