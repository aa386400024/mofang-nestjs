import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateSelfcareRecordDto, ListSelfcareRecordsResponseDto, SelfcareRecordDto } from '../dto/selfcare-record.dto';
import { SelfcareRecord } from '../entities/selfcare-record.entity';

/**
 * SelfcareRecord service — 心塑「我的」Tab 自我关怀记录核心服务 (陪伴者专属).
 *
 * V3 接 BullMQ event bus:
 *   - 每次打卡 → emit 'selfcare.recorded' 事件
 *   - burnout 服务订阅: 7 天没打卡 → 触发预警通知
 */
@Injectable()
export class SelfcareRecordService {
  constructor(
    @InjectRepository(SelfcareRecord)
    private readonly repo: Repository<SelfcareRecord>,
  ) {}

  async create(uid: string, dto: CreateSelfcareRecordDto): Promise<SelfcareRecordDto> {
    const record = this.repo.create({
      uid,
      type: dto.type,
      date: dto.date,
      note: dto.note ?? null,
    });
    const saved = await this.repo.save(record);
    return this.toDto(saved);
  }

  async list(uid: string): Promise<ListSelfcareRecordsResponseDto> {
    const records = await this.repo.find({
      where: { uid },
      order: { date: 'DESC', createdAt: 'DESC' },
      take: 100,
    });
    return {
      totalCount: records.length,
      records: records.map((r) => this.toDto(r)),
    };
  }

  private toDto(record: SelfcareRecord): SelfcareRecordDto {
    return {
      id: record.id,
      type: record.type,
      date: record.date,
      note: record.note,
      createdAt: record.createdAt,
    };
  }
}
