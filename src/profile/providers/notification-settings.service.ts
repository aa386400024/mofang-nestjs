import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationSettingsDto, UpdateNotificationSettingsDto } from '../dto/notification-settings.dto';
import { NotificationSettings } from '../entities/notification-settings.entity';

/**
 * NotificationSettings service — 心塑「我的」Tab 通知设置核心服务.
 *
 * 职责 (V3):
 *   - getSettings(uid): 拉取 (找不到自动建默认行)
 *   - updateSettings(uid, dto): 部分更新
 *
 * 大厂做法:
 *   - 1:1 表用 ensure upsert, 避免 null 判空
 *   - 默认值在 entity 声明 (新用户自动套默认)
 */
@Injectable()
export class NotificationSettingsService {
  constructor(
    @InjectRepository(NotificationSettings)
    private readonly repo: Repository<NotificationSettings>,
  ) {}

  async getSettings(uid: string): Promise<NotificationSettingsDto> {
    const settings = await this.ensureSettings(uid);
    return this.toDto(settings);
  }

  async updateSettings(uid: string, dto: UpdateNotificationSettingsDto): Promise<NotificationSettingsDto> {
    const settings = await this.ensureSettings(uid);

    if (dto.practiceReminder !== undefined) settings.practiceReminder = dto.practiceReminder;
    if (dto.statusUpdate !== undefined) settings.statusUpdate = dto.statusUpdate;
    if (dto.companionMessage !== undefined) settings.companionMessage = dto.companionMessage;
    if (dto.quietStart !== undefined) settings.quietStart = dto.quietStart;
    if (dto.quietEnd !== undefined) settings.quietEnd = dto.quietEnd;
    if (dto.reminderIntensity !== undefined) settings.reminderIntensity = dto.reminderIntensity;

    const saved = await this.repo.save(settings);
    return this.toDto(saved);
  }

  private async ensureSettings(uid: string): Promise<NotificationSettings> {
    const existing = await this.repo.findOne({ where: { uid } });
    if (existing) return existing;
    try {
      return await this.repo.save(this.repo.create({ uid }));
    } catch {
      const retry = await this.repo.findOne({ where: { uid } });
      if (retry) return retry;
      throw new Error('ensureSettings race retry failed');
    }
  }

  private toDto(settings: NotificationSettings): NotificationSettingsDto {
    return {
      practiceReminder: settings.practiceReminder,
      statusUpdate: settings.statusUpdate,
      companionMessage: settings.companionMessage,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      reminderIntensity: settings.reminderIntensity,
    };
  }
}
