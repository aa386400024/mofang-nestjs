import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import { MoodLog } from '../entities/mood-log.entity';
import type { HomeEmotionLevel } from '../home.constants';

/**
 * 心塑首页「情绪打卡」核心服务.
 *
 * 职责:
 *   - logMood(uid, level, note, triggeredMicroInterventionId): 写入新一条打卡
 *   - getTodayLatest(uid): 读今天最新一条打卡 (供首页 + 陪伴者端共用)
 *
 * 关键设计:
 *   - 每日多次打卡: 心理产品原则「允许多次改主意」, 不限制次数
 *   - 「今天」= 本地时区 0 点起, 用服务器本地时区简化 (后续可改 timezone 入参)
 *   - 微干预 id 透明化: 选了 crisis 自动推「2 分钟平稳」, 把干预 id 一起记下
 */
@Injectable()
export class HomeMoodLogService {
  private readonly logger = new Logger(HomeMoodLogService.name);

  constructor(
    @InjectRepository(MoodLog)
    private readonly repo: Repository<MoodLog>,
  ) {}

  /**
   * 写入一条打卡.
   *
   * 大厂做法:
   *   - 真存 (不软删): 心理数据保留可追溯
   *   - note 限长 280 字 (DTO 校验过)
   *   - 多次打卡: 用户改主意 → 新增一条, 历史保留
   */
  async logMood(uid: string, level: HomeEmotionLevel, note: string | null, triggeredMicroInterventionId: string | null): Promise<MoodLog> {
    if (!['great', 'okay', 'low', 'crisis'].includes(level)) {
      throw new BizException(BizCode.InvalidParameter, `未知的情绪档位: ${level}`);
    }
    const saved = await this.repo.save(
      this.repo.create({
        uid,
        level,
        note,
        triggeredMicroInterventionId,
      }),
    );
    this.logger.log(`logMood uid=${uid} level=${level} intervention=${triggeredMicroInterventionId ?? 'none'}`);
    return saved;
  }

  /**
   * 读今天最新一条打卡.
   *
   * 「今天」用服务端本地时间 0 点划分 (避免 UTC 跨天误差).
   * V3 升级: 接 timezone 入参, 让客户端传时区.
   *
   * 大厂做法: 用 MoreThanOrEqual 走 SQL 比较, 不在内存二次过滤 (索引走得到).
   */
  async getTodayLatest(uid: string, now: Date = new Date()): Promise<MoodLog | null> {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const row = await this.repo.findOne({
      where: { uid, createdAt: MoreThanOrEqual(startOfDay) },
      order: { createdAt: 'DESC' },
    });
    return row ?? null;
  }

  /**
   * 陪者端读最近 7 天的情绪曲线 (L3 权限可见).
   */
  async getRecentTrend(uid: string, days = 7): Promise<HomeEmotionLevel[]> {
    const start = new Date();
    start.setDate(start.getDate() - days);
    const rows = await this.repo.find({
      where: { uid, createdAt: MoreThanOrEqual(start) },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => r.level);
  }

  /**
   * 转 DTO — 给 HomeOverviewDto 用的字段.
   */
  toOverviewFields(log: MoodLog | null): {
    emotionLevel: HomeEmotionLevel | null;
    emotionNote: string | null;
    emotionLoggedAt: string | null;
  } {
    if (!log) {
      return { emotionLevel: null, emotionNote: null, emotionLoggedAt: null };
    }
    return {
      emotionLevel: log.level,
      emotionNote: log.note,
      emotionLoggedAt: log.createdAt.toISOString(),
    };
  }

  /**
   * 合规: 用户一键删除 → 清所有打卡.
   *
   * V2.0: 物理删除 (心理数据 — 用户主动删除不保留).
   * V3: 接 users.deleted_at cascade 兜底.
   */
  async clearForUser(uid: string): Promise<{ deletedCount: number }> {
    const result = await this.repo.delete({ uid });
    return { deletedCount: result.affected ?? 0 };
  }
}
