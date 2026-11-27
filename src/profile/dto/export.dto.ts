import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * 数据导出请求 DTO — V2.0 §Tab4 隐私与数据安全.
 *
 * Phase4 WP29 纵切:
 *   - 同步生成 JSON / 单文件 ZIP，任务与文件进 Redis，24h 过期
 *   - 对话原文 / 记忆等心理内容尚未纳入，文件内 scope 明示
 */
export class ExportDataDto {
  @ApiProperty({ description: '导出格式', enum: ['json', 'zip'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'zip'])
  format?: 'json' | 'zip';
}

export class ExportTaskDto {
  @ApiProperty({ description: '导出任务 id', example: 'export-task-uuid' })
  taskId!: string;

  @ApiProperty({ description: '任务状态', enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: 'pending' | 'processing' | 'completed' | 'failed';

  @ApiProperty({ description: '创建时间', example: '2026-08-28T09:30:00Z' })
  createdAt!: string;

  @ApiProperty({ description: '完成时间', nullable: true })
  completedAt!: string | null;

  @ApiProperty({ description: '下载 URL (完成后才有, 相对路径, 24h 有效)', nullable: true, example: '/profile/me/export/task/download' })
  downloadUrl!: string | null;

  @ApiProperty({ description: '文件大小 (字节)', nullable: true })
  sizeBytes!: number | null;
}

/**
 * 删除账户请求 DTO — V2.0 §Tab4 一键删除.
 *
 * 设计要点:
 *   - 二次确认由前端 dialog 触发, 后端仍校验字面值, 不信任前端
 *   - 删除立即软删并撤销会话 / JWT / OAuth, 冷静期到期后由 cron 全量擦除
 */
export class DeleteAccountDto {
  @ApiProperty({ description: '二次确认字符串, 必须是 "确认删除"', example: '确认删除' })
  @IsString()
  @IsNotEmpty()
  confirmation!: string;

  @ApiProperty({ description: '原因 (可选)', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DeleteAccountResponseDto {
  @ApiProperty({ description: '删除请求状态（软删 + 冷静期，cron 到期后真删）', example: 'deletion_requested' })
  status!: 'deletion_requested';

  @ApiProperty({ description: '软删时间', example: '2026-08-28T09:30:00Z' })
  deletedAt!: string;

  @ApiProperty({ description: '预计硬删时间（保留期后）', example: '2026-09-27T09:30:00Z' })
  purgeAt!: string;
}
