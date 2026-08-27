import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CompanionRecordDto, CreateCompanionRecordDto, ListCompanionRecordsResponseDto } from '../dto/companion-record.dto';
import { CompanionRecord } from '../entities/companion-record.entity';

/**
 * CompanionRecord service — 心塑「我的」Tab 陪伴记录核心服务 (陪伴者专属).
 *
 * 职责 (V3):
 *   - create: 新增陪伴记录
 *   - list: 列出当前陪伴者的所有记录 (按 date DESC)
 *
 * V2.0 占位: 客户端 mock 数据, 服务端真接.
 *
 * 大厂做法:
 *   - 列表加 cache (V3: Redis 缓存陪伴者前 20 条, 写时失效)
 *   - 写操作加 audit log (V3: AuditLogService)
 *   - 双方端推送 (V3: Redis pub/sub + WebSocket)
 */
@Injectable()
export class CompanionRecordService {
  constructor(
    @InjectRepository(CompanionRecord)
    private readonly repo: Repository<CompanionRecord>,
  ) {}

  async create(uid: string, dto: CreateCompanionRecordDto): Promise<CompanionRecordDto> {
    const record = this.repo.create({
      companionUid: uid,
      companionToUid: dto.companionToUid,
      date: dto.date,
      title: dto.title,
      summary: dto.summary,
      tag: dto.tag ?? '已完成',
    });
    const saved = await this.repo.save(record);
    return this.toDto(saved);
  }

  async list(uid: string): Promise<ListCompanionRecordsResponseDto> {
    const records = await this.repo.find({
      where: { companionUid: uid },
      order: { date: 'DESC', createdAt: 'DESC' },
      take: 50,
    });
    return {
      totalCount: records.length,
      records: records.map((r) => this.toDto(r)),
    };
  }

  private toDto(record: CompanionRecord): CompanionRecordDto {
    return {
      id: record.id,
      companionToUid: record.companionToUid,
      date: record.date,
      title: record.title,
      summary: record.summary,
      tag: record.tag,
      createdAt: record.createdAt,
    };
  }
}
