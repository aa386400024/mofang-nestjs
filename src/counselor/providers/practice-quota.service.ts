// V2026-10-22 治本 (V1.3 §7.4 — 练习域的日粒度配额服务):
//   原因: spec §7.4 原文「沿用现有 `quota_usage` 配额体系统计, 默认每用户每天 5 次;
//     超额时前端不弹「今日已用完」红条, 而是软降级回标准题库 (零压红线)」.
//     这条要求落在 `quota_usage` 表上, 但**不能**直接复用 `BillingService.consumeQuota`,
//     原因有三条, 每条都是硬伤:
//       ① 粒度不同: consumeQuota 走的是会员档位的**月度**配额 (period='YYYY-MM'),
//          §7.4 要的是**日**配额 (period='YYYY-MM-DD').
//       ② 语义不同: consumeQuota 超额时 `limit === 0` 会直接 throw BadRequestException
//          (当前会员档写死 NONE, 限额为 0) —— 那是"硬拒绝"语义, 而 §7.4 要求的是
//          "软降级"语义, 两者在同一段代码里没法共存.
//       ③ 上限来源不同: 会员配额来自 MEMBERSHIP_TIER_PRESETS (可售卖权益);
//          日配额来自本域的运行参数 (防滥用 + 控成本), 不该被"升级会员"放大.
//     故练习域自建本 service, 但**复用同一张 quota_usage 表** (spec §7.4 的原意),
//     配额类型走 PracticeQuotaType (见 practice-quota-type.enum.ts 的口径说明).
//
//   修法:
//     - ensureRow(): INSERT IGNORE 建当日行 (idempotent, 靠 UNIQUE 索引)
//     - consumeToday(): 单条**条件 UPDATE** 完成"检查 + 自增" (原子, 不存在
//       "先查后写"的竞态窗口); affected=0 即代表已到上限
//     - getTodayUsage(): 只读, 供 UI 展示"今天还能生成几次"
//
//   反双胞胎:
//     - 不用 "SELECT 后再 UPDATE" 的写法: 两个并发请求会同时读到 used=4,
//       然后都写成 5 (少扣) 或都写成 6 (超扣); 条件 UPDATE 把判断和自增压成一条语句
//     - 不用 select + save 的 TypeORM 常规写法做扣减: 那是读改写, 同样有竞态
//     - 不抛异常表达"超额": 超额是**可预期的业务状态**, 由调用方走降级分支;
//       异常应该留给"系统坏了"
//     - 不在 service 里决定上限值: 上限由调用方从 config 传入, 本 service 只管计数,
//       保持它对"练习域"之外也可复用
//
//   验证:
//     1. tsc 0 错
//     2. 连续 consume 5 次 → 第 5 次 success=true, 第 6 次 success=false
//     3. 两个并发 consume (各 limit=1) → 恰好 1 个 success
//     4. 跨天再调 → used 归零 (period 变了, 新行)
//     5. 会员状态接口的 quotas 数组仍只有 3 项 (不受本 service 影响)
//
//   时间戳: 2026-10-22
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, type Repository } from 'typeorm';

import { practiceDailyPeriod } from '../config/practice-custom-scenario.config';
import { QuotaUsage } from '../entities/quota-usage.entity';
import { PracticeQuotaType } from '../enums/practice-quota-type.enum';

/**
 * 日配额计数结果.
 */
export interface PracticeQuotaUsage {
  /** 今日已用次数 */
  used: number;
  /** 今日上限 */
  limit: number;
  /** 今日剩余次数 */
  remaining: number;
}

/**
 * 扣减结果 (success=false 即代表已到上限).
 */
export interface PracticeQuotaConsumeResult extends PracticeQuotaUsage {
  /** 本次是否成功扣减 */
  success: boolean;
}

/**
 * 练习域配额服务 (日粒度, 复用 quota_usage 表).
 */
@Injectable()
export class PracticeQuotaService {
  constructor(
    @InjectRepository(QuotaUsage)
    private readonly quotaRepo: Repository<QuotaUsage>,
  ) {}

  /**
   * 查今日配额用量 (只读).
   *
   * @param userId 用户 id
   * @param quotaType 配额类型
   * @param limit 今日上限
   * @returns 用量快照
   */
  async getTodayUsage(userId: string, quotaType: PracticeQuotaType, limit: number): Promise<PracticeQuotaUsage> {
    const usage = await this.quotaRepo.findOne({
      where: { userId, quotaType, period: practiceDailyPeriod(), deletedAt: IsNull() },
    });
    const used = usage?.used ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /**
   * 扣减今日配额 1 次 (原子).
   *
   * 实现要点: 用**单条条件 UPDATE** 把"检查上限"和"自增"合成一步 ——
   * `UPDATE ... SET used = used + 1 WHERE used + 1 <= \`limit\``,
   * affected=0 即说明已到上限 (或行不存在, 已由 ensureRow 兜底建好).
   * 读改写写法在并发下会少扣或超扣, 这里不用.
   *
   * @param userId 用户 id
   * @param quotaType 配额类型
   * @param limit 今日上限
   * @param amount 本次扣减次数
   * @returns 扣减结果
   */
  async consumeToday(userId: string, quotaType: PracticeQuotaType, limit: number, amount = 1): Promise<PracticeQuotaConsumeResult> {
    const period = practiceDailyPeriod();
    await this.ensureRow(userId, quotaType, period, limit);

    const result = await this.quotaRepo
      .createQueryBuilder()
      .update(QuotaUsage)
      // used 自增用**原生表达式** (不是读改写), 把"检查上限"与"自增"压成一条语句.
      // updated_at 不在这里显式赋值: 该列在 DDL 上是 ON UPDATE CURRENT_TIMESTAMP(6),
      // 由 MySQL 自动维护, 显式赋值反而要多绕一层 TypeORM 的 Date 类型转换.
      .set({ used: () => 'used + :amount' })
      .where('user_id = :userId', { userId })
      .andWhere('quota_type = :quotaType', { quotaType })
      .andWhere('period = :period', { period })
      .andWhere('deleted_at IS NULL')
      .andWhere('used + :amount <= `limit`', { amount })
      .execute();

    const affected = result.affected ?? 0;
    const snapshot = await this.getTodayUsage(userId, quotaType, limit);

    return { success: affected > 0, ...snapshot };
  }

  /**
   * 确保当日配额行存在 (幂等).
   *
   * 用 INSERT IGNORE 而不是 "先 findOne 再 create": 后者在并发下会撞 UNIQUE 索引.
   * `limit` 是 MySQL 保留字, 裸 SQL 里必须加反引号.
   *
   * @param userId 用户 id
   * @param quotaType 配额类型
   * @param period 周期串
   * @param limit 上限
   */
  private async ensureRow(userId: string, quotaType: PracticeQuotaType, period: string, limit: number): Promise<void> {
    await this.quotaRepo.query(
      'INSERT IGNORE INTO quota_usage ' +
        '(id, tenant_id, user_id, quota_type, period, used, `limit`, created_at, updated_at, deleted_at) ' +
        'VALUES (?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6), NULL)',
      [randomUUID(), userId, userId, quotaType, period, limit],
    );
  }
}
