import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BurnoutSettingsDto, UpdateBurnoutSettingsDto } from '../dto/burnout-settings.dto';
import { BurnoutSettings } from '../entities/burnout-settings.entity';

/**
 * BurnoutSettings service — 心塑「我的」Tab 耗竭预警设置核心服务 (陪伴者专属).
 *
 * V3 接 cron:
 *   - dailyLimit 跟 actual 陪伴次数对比, 超阈值 → push 提醒
 *   - weeklyReport 周日晚 21:  推送本周陪伴强度统计
 *   - autoRestReminder 连续 3 次后强制休息
 */
@Injectable()
export class BurnoutSettingsService {
  constructor(
    @InjectRepository(BurnoutSettings)
    private readonly repo: Repository<BurnoutSettings>,
  ) {}

  async getSettings(uid: string): Promise<BurnoutSettingsDto> {
    const settings = await this.ensureSettings(uid);
    return this.toDto(settings);
  }

  async updateSettings(uid: string, dto: UpdateBurnoutSettingsDto): Promise<BurnoutSettingsDto> {
    const settings = await this.ensureSettings(uid);

    if (dto.enableWarning !== undefined) settings.enableWarning = dto.enableWarning;
    if (dto.enableWeeklyReport !== undefined) settings.enableWeeklyReport = dto.enableWeeklyReport;
    if (dto.autoRestReminder !== undefined) settings.autoRestReminder = dto.autoRestReminder;
    if (dto.dailyLimit !== undefined) settings.dailyLimit = dto.dailyLimit;

    const saved = await this.repo.save(settings);
    return this.toDto(saved);
  }

  private async ensureSettings(uid: string): Promise<BurnoutSettings> {
    const existing = await this.repo.findOne({ where: { uid } });
    if (existing) return existing;
    try {
      return await this.repo.save(
        this.repo.create({
          uid,
          enableWarning: true,
          enableWeeklyReport: true,
          autoRestReminder: true,
          dailyLimit: 5,
        }),
      );
    } catch {
      const retry = await this.repo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new Error('ensureBurnoutSettings race retry failed');
    }
  }

  private toDto(settings: BurnoutSettings): BurnoutSettingsDto {
    return {
      enableWarning: settings.enableWarning,
      enableWeeklyReport: settings.enableWeeklyReport,
      autoRestReminder: settings.autoRestReminder,
      dailyLimit: settings.dailyLimit,
    };
  }
}
