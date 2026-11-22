import { ApiProperty } from '@nestjs/swagger';

/**
 * 数据导出请求 DTO — V2.0 §Tab4 隐私与数据安全.
 *
 * 设计要点:
 *   - 数据导出走异步任务 (BullMQ), 前端轮询任务状态
 *   - 任务结果 = 一份加密 ZIP, 24h 后过期
 *   - V2.0 占位: 不真做导出, 只记录"用户请求了导出" + 返回任务 id
 */
export class ExportDataDto {
  @ApiProperty({ description: '导出格式', enum: ['json', 'zip'], default: 'zip' })
  format!: 'json' | 'zip';
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

  @ApiProperty({ description: '下载 URL (完成后才有, 24h 有效)', nullable: true })
  downloadUrl!: string | null;

  @ApiProperty({ description: '文件大小 (字节)', nullable: true })
  sizeBytes!: number | null;
}

/**
 * 删除账户请求 DTO — V2.0 §Tab4 一键删除.
 *
 * 设计要点:
 *   - 二次确认由前端负责 (alertDialog)
 *   - 后端做最终校验 (密码 / 验证码 V3)
 *   - 真实删除走 7 天 cooldown, V2.0 占位直接 hard delete
 */
export class DeleteAccountDto {
  @ApiProperty({ description: '二次确认字符串, 必须是 "确认删除"', example: '确认删除' })
  confirmation!: string;

  @ApiProperty({ description: '原因 (可选)', required: false })
  reason?: string;
}

export class DeleteAccountResponseDto {
  @ApiProperty({ description: '删除执行状态', example: 'deleted' })
  status!: 'deleted';

  @ApiProperty({ description: '删除时间', example: '2026-08-28T09:30:00Z' })
  deletedAt!: string;
}
