import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { PasswordHistory } from '../entities/password-history.entity';
import { User } from '../entities/user.entity';

/**
 * Password history service — 密码历史 + 强制重置周期 (大厂安全合规).
 *
 * 职责:
 *   1. 改密时检查新密码是否复用最近 N 次的历史密码 (大厂标配, 防 ABC123 → ABC1234 → ABC12345 模式)
 *   2. 改密成功时把旧密码 hash 写到历史
 *   3. 检查密码是否在强制重置周期到期 (e.g. 90 天)
 *   4. 检查密码最小间隔 (e.g. 5 分钟, 防止用户被脚本秒改)
 *   5. trimOldHistory: 保留最近 N 条, 多余的删掉 (避免无限增长)
 *
 * NIST 800-63B 友好做法:
 *   - 不强制周期改密 (已废弃)
 *   - 但检测"密码重用"和"已泄漏密码" (Have I Been Pwned API, V3 加)
 *   - 大厂 + 国内合规: 同时启用周期 + 历史 (本项目采用)
 */
@Injectable()
export class PasswordHistoryService {
  constructor(
    @InjectRepository(PasswordHistory)
    private readonly repo: Repository<PasswordHistory>,
    private readonly config: ConfigService,
  ) {}

  // ========================================================================
  // 改密前校验
  // ========================================================================

  /**
   * 检查新密码是否与最近 N 次重复.
   * @throws BizException(PasswordReused) 重复则拒绝
   */
  async assertNotReused(userId: string, newPassword: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const limit = this.config.get('password').historyLimit;
    const history = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      take: limit,
    });
    if (history.length === 0) {
      return;
    }
    for (const entry of history) {
      const match = await bcrypt.compare(newPassword, entry.passwordHash);
      if (match) {
        throw new BizException(BizCode.PasswordReused);
      }
    }
  }

  // ========================================================================
  // 改密后记录
  // ========================================================================

  /**
   * 把旧密码写入历史 (改密成功后调用).
   * 同时清理超出的历史 (保留最近 N 条).
   */
  async recordOldPassword(userId: string, oldPasswordHash: string): Promise<void> {
    const entry = this.repo.create({ userId, passwordHash: oldPasswordHash });
    await this.repo.save(entry);
    await this.trimOldHistory(userId);
  }

  /**
   * 保留最近 N 条, 多余删掉.
   */
  private async trimOldHistory(userId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const limit = this.config.get('password').historyLimit;

    const total = await this.repo.count({ where: { userId } });
    if (total <= limit) {
      return;
    }
    // 取要保留的 N 条 ID, 删其余
    const keep = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      take: limit,
      select: { id: true },
    });
    const keepIds = new Set(keep.map((k) => k.id));
    const all = await this.repo.find({ where: { userId }, select: { id: true } });
    const toDelete = all.filter((a) => !keepIds.has(a.id)).map((a) => a.id);
    if (toDelete.length > 0) {
      await this.repo.delete(toDelete);
    }
  }

  // ========================================================================
  // 强制重置周期
  // ========================================================================

  /**
   * 检查密码是否在强制重置周期到期.
   * @returns true 表示密码已过期, 业务层应强制改密
   */
  isPasswordExpired(user: User): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const cycleDays = this.config.get('password').resetCycleDays;
    if (cycleDays <= 0) {
      return false;
    }
    // 首次登录没改密记录, 用 createdAt
    const since = user.passwordChangedAt ?? user.createdAt;
    const ageDays = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
    return ageDays >= cycleDays;
  }

  /**
   * 检查密码最小间隔 (防用户被脚本秒改).
   * @returns true 表示距上次改密不到最小间隔, 拒绝改密
   */
  isMinAgeViolation(user: User): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const minAgeMin = this.config.get('password').minAgeMinutes;
    if (minAgeMin <= 0 || !user.passwordChangedAt) {
      return false;
    }
    const ageMin = (Date.now() - user.passwordChangedAt.getTime()) / (60 * 1000);
    return ageMin < minAgeMin;
  }
}
