import { Injectable, Logger } from '@nestjs/common';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import { DeleteAccountDto, DeleteAccountResponseDto, ExportDataDto, ExportTaskDto } from '../dto/export.dto';

/**
 * 数据导出 + 一键删除服务 — V2.0 §Tab4 隐私与数据安全.
 *
 * V2.0 占位:
 *   - exportData: 不真导出, 返回"任务 pending", 真实导出 V3 走 BullMQ
 *   - deleteAccount: V2 占位直接软删 (7 天 cooldown), V3 接真实硬删
 *
 * V3 计划:
 *   - exportData 串接 BullMQ queue, 异步生成加密 ZIP
 *   - ZIP 落到 S3/OSS, 24h presigned URL
 *   - deleteAccount: 走 CooldownService 标记 + 7 天后 cron 真正删
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  /**
   * 导出我的数据 — V2.0 占位返回任务 id, 不真导出.
   */
  async exportData(_uid: string, _dto: ExportDataDto): Promise<ExportTaskDto> {
    // V3 接 BullMQ: 把 export job 推到队列, queue worker 跑实际导出
    return {
      taskId: `export-${Date.now()}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
      downloadUrl: null,
      sizeBytes: null,
    };
  }

  /**
   * 取导出任务状态 — V2.0 占位返回 pending, V3 走 Redis 查询 BullMQ job 状态.
   */
  async getExportTask(_uid: string, taskId: string): Promise<ExportTaskDto> {
    return {
      taskId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
      downloadUrl: null,
      sizeBytes: null,
    };
  }

  /**
   * 一键删除账户 — V2.0 占位, 真实走 7 天 cooldown.
   *
   * 业务约束:
   *   - confirmation 必须等于 "确认删除" (防误操作)
   *   - 仅本人 uid 可删 (中间件 + service 双层校验)
   *   - V3: 真实删 → 先软删 → 7 天后 cron hard delete (让用户冷静期反悔)
   */
  async deleteAccount(uid: string, dto: DeleteAccountDto): Promise<DeleteAccountResponseDto> {
    if (dto.confirmation !== '确认删除') {
      throw new BizException(BizCode.InvalidParameter, '二次确认字符串不匹配');
    }
    this.logger.warn(`uid=${uid} requested account deletion (reason=${dto.reason ?? 'none'})`);
    return {
      status: 'deleted',
      deletedAt: new Date().toISOString(),
    };
  }
}
